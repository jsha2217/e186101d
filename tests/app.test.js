const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {webcrypto} = require('node:crypto');

const root = path.join(__dirname, '..');

function createApp(){
  const elements = new Map();
  const listeners = new Map();
  const writes = [];
  const alerts = [];
  let rejectWrites = false;
  let nextKey = 0;
  const element = id=>{
    if(!elements.has(id)){
      const classes = new Set();
      const attributes = new Map();
      elements.set(id, {
        value:'', textContent:'', innerHTML:'', style:{}, dataset:{}, scrollHeight:0, hidden:false, isConnected:true,
        classList:{add:cls=>classes.add(cls), remove:cls=>classes.delete(cls), toggle:(cls,on)=>on ? classes.add(cls) : classes.delete(cls), contains:cls=>classes.has(cls)},
        addEventListener(){}, querySelectorAll:()=>[], querySelector:()=>null, focus(){}, after(){}, remove(){},
        setAttribute:(name,value)=>attributes.set(name,value),
        getAttribute:name=>attributes.get(name) || null,
        removeAttribute:name=>attributes.delete(name),
      });
    }
    return elements.get(id);
  };
  const db = {ref(refPath=''){
    return {
      on(type, callback){ listeners.set(refPath, callback); },
      off(type, callback){ if(listeners.get(refPath) === callback) listeners.delete(refPath); },
      push(){ return {key:`new${++nextKey}`, set:data=>write('set', refPath, data)}; },
      update:data=>write('update', refPath, data),
      remove:()=>write('remove', refPath, null),
    };
  }};
  function write(method, refPath, data){
    writes.push({method, refPath, data});
    return rejectWrites ? Promise.reject(new Error('offline')) : Promise.resolve();
  }
  const firebase = {apps:[], initializeApp(){ this.apps.push({}); }, database(){ return db; }};
  const context = vm.createContext({
    document:{getElementById:element, createElement:()=>element(`created${elements.size}`), body:element('body'), querySelectorAll:()=>[], addEventListener(){}},
    firebase, localStorage:{getItem:()=>null, setItem(){}, removeItem(){}},
    crypto:webcrypto, TextEncoder, console:{error(){}}, alert:message=>alerts.push(message),
    confirm:()=>true, setInterval:()=>1, clearInterval(){}, setTimeout:()=>1, clearTimeout(){}, Date,
  });
  for(const file of ['core.js','contacts.js','appointments.js','validations.js','paging.js','bootstrap.js']){
    vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'), context, {filename:file});
  }
  return {context, elements, element, listeners, writes, alerts, setReject:value=>{rejectWrites=value;}};
}

test('every rendered action has a delegated handler', ()=>{
  const app = createApp();
  const files = ['index.html','js/contacts.js','js/appointments.js','js/validations.js'];
  const actions = new Set(files.flatMap(file=>[...fs.readFileSync(path.join(root,file),'utf8').matchAll(/data-action="([^"]+)"/g)].map(match=>match[1])));
  for(const action of actions){
    assert.equal(vm.runInContext(`typeof clickActions[${JSON.stringify(action)}]`, app.context), 'function', action);
  }
});

test('logout clears listeners and a different user sees the right contacts', ()=>{
  const app = createApp();
  vm.runInContext('enterApp("Joy")', app.context);
  assert.equal(app.listeners.size, 3);
  vm.runInContext('logout()', app.context);
  assert.equal(app.listeners.size, 0);
  vm.runInContext('enterApp("Sam")', app.context);
  assert.equal(app.listeners.size, 3);
  vm.runInContext('loadState.contacts=true; contacts = {a:{name:"A",mainGuide:"Joy"},b:{name:"B",mainGuide:"Sam"}}; renderContacts()', app.context);
  assert.match(app.element('contactList').innerHTML, /B/);
  assert.doesNotMatch(app.element('contactList').innerHTML, /data-id="a"/);
});

test('contact deletion updates related records in one request', async ()=>{
  const app = createApp();
  vm.runInContext('enterApp("Joy")', app.context);
  vm.runInContext('contacts={c1:{name:"A"}}; appointments={a1:{contactId:"c1"},a2:{contactId:"c2"}}; validations={v1:{contactId:"c1"}}', app.context);
  await vm.runInContext('deleteContact("c1")', app.context);
  assert.equal(app.writes.length, 1);
  assert.deepEqual({...app.writes[0].data}, {'contacts/c1':null,'appointments/a1':null,'validations/v1':null,'validationSummaries/c1':null});
});

test('validation save preserves metadata and applies add, edit, delete atomically', async ()=>{
  const app = createApp();
  vm.runInContext('enterApp("Joy")', app.context);
  app.element('vContactId').value = 'c1';
  app.element('validationModal').classList.add('show');
  vm.runInContext('currentUser="Joy"; contacts={c1:{name:"A"}}; validations={v1:{contactId:"c1",date:"2026-01-01",topic:"old",createdBy:"Sam"},v2:{contactId:"c1",date:"2026-02-01",topic:"remove"}}', app.context);
  vm.runInContext('getValidationRoundValues=()=>[{id:"v1",date:"2026-03-01",topic:"edit"},{id:"",date:"2026-04-01",topic:"new"}]', app.context);
  await vm.runInContext('saveValidation()', app.context);
  assert.equal(app.writes.length, 1);
  const updates = app.writes[0].data;
  assert.equal(updates['validations/v1'].createdBy, 'Sam');
  assert.equal(updates['validations/v1'].topic, 'edit');
  assert.equal(updates['validations/v2'], null);
  assert.equal(updates['validations/new1'].createdBy, 'Joy');
  assert.equal(app.element('validationModal').classList.contains('show'), false);
});

test('failed save keeps the edit modal open', async ()=>{
  const app = createApp();
  vm.runInContext('enterApp("Joy")', app.context);
  app.setReject(true);
  app.element('cName').value = 'A';
  app.element('cMainGuide').value = 'Joy';
  app.element('cConnectDate').value = '2026-09-30';
  app.element('contactModal').classList.add('show');
  vm.runInContext('currentUser="Joy"', app.context);
  await vm.runInContext('saveContact()', app.context);
  assert.equal(app.element('contactModal').classList.contains('show'), true);
  assert.match(app.element('appStatus').textContent, /완료하지 못했습니다/);
});

test('cards escape user supplied text and dates', ()=>{
  const app = createApp();
  vm.runInContext('currentUser="Joy"; contacts={c1:{name:"<img src=x>",mainGuide:"Joy",connectAt:"<svg onload=alert(1)>"}}; validations={v1:{contactId:"c1",date:"<img src=x>",topic:"<b>bad</b>"}}', app.context);
  const html = vm.runInContext('renderValidationCard("c1",0)', app.context);
  assert.doesNotMatch(html, /<img|<b>bad|<svg/);
  assert.match(html, /&lt;img/);
});

test('day detail and edit dialogs have an explicit stack', ()=>{
  const app = createApp();
  vm.runInContext('openModal("dayModal"); openModal("apptModal")', app.context);
  assert.equal(app.element('dayModal').style.zIndex, '70');
  assert.equal(app.element('apptModal').style.zIndex, '80');
  assert.equal(app.element('dayModal').inert, true);
  vm.runInContext('closeModal("apptModal",true)', app.context);
  assert.equal(app.element('dayModal').inert, false);
  assert.equal(app.element('dayModal').classList.contains('show'), true);
});

test('appointment cannot be saved without a date and time', async ()=>{
  const app = createApp();
  vm.runInContext('enterApp("Joy"); contacts={c1:{name:"A",mainGuide:"Joy"}}', app.context);
  app.element('aContactId').value = 'c1';
  await vm.runInContext('saveAppt()', app.context);
  assert.equal(app.writes.length, 0);
  app.element('aDate').value = '2026-09-30';
  await vm.runInContext('saveAppt()', app.context);
  assert.equal(app.writes.length, 0);
});

test('saving an empty validation form cannot delete all existing rounds', async ()=>{
  const app = createApp();
  vm.runInContext('enterApp("Joy"); contacts={c1:{name:"A",mainGuide:"Joy"}}; validations={v1:{contactId:"c1",date:"2026-09-01"}}; getValidationRoundValues=()=>[]', app.context);
  app.element('vContactId').value = 'c1';
  await vm.runInContext('saveValidation()', app.context);
  assert.equal(app.writes.length, 0);
  assert.match(app.element('validationModalError').textContent, /삭제 버튼/);
});

test('contact lists show a page at a time and empty dates do not open dialogs', ()=>{
  const app = createApp();
  vm.runInContext('currentUser="Joy"; loadState.contacts=true; contacts=Object.fromEntries(Array.from({length:30},(_,i)=>["c"+i,{name:"A"+i,mainGuide:"Joy"}])); renderContacts()',app.context);
  assert.match(app.element('contactCount').textContent, /15건 표시/);
  assert.equal(app.element('contactMore').hidden, false);
  vm.runInContext('moreContacts(true); renderCalendar([]); renderValidationCalendar([])',app.context);
  assert.match(app.element('contactCount').textContent, /30건 표시/);
  assert.equal(app.element('contactMore').hidden, true);
  assert.doesNotMatch(app.element('calGrid').innerHTML, /data-action="appt-day"/);
  assert.doesNotMatch(app.element('vCalGrid').innerHTML, /data-action="validation-day"/);
});

test('contact summary updates when appointments and validation rounds arrive', ()=>{
  const app = createApp();
  vm.runInContext('enterApp("Joy")', app.context);
  app.listeners.get('contacts')({val:()=>({c1:{name:'A',mainGuide:'Joy',connectAt:'2026-09-01'}})});
  app.listeners.get('appointments')({val:()=>({a1:{contactId:'c1',apptDate:'2099-01-02',apptTime:'10:00'}})});
  app.listeners.get('validations')({val:()=>({v1:{contactId:'c1',date:'2026-09-25'}})});
  const html = app.element('contactList').innerHTML;
  assert.match(html, /다음 약속 2099-01-02/);
  assert.match(html, /최근 유효 2026-09-25/);
});

test('remote pages contain 15 unique records even when sort values tie', async ()=>{
  const app = createApp();
  const records = Object.fromEntries(Array.from({length:35},(_,i)=>[
    `c${String(i+1).padStart(2,'0')}`, {connectAt:'2026-09-30T10:00'},
  ]));
  app.context.fakeDb = {ref(){
    const options = {};
    return {
      orderByChild(field){ options.field = field; return this; },
      startAt(value,key){ options.start = [value,key]; return this; },
      endAt(value,key){ options.end = [value,key]; return this; },
      limitToFirst(count){ options.first = count; return this; },
      limitToLast(count){ options.last = count; return this; },
      once(){
        let entries = Object.entries(records).sort(([a],[b])=>a.localeCompare(b));
        const tuple = ([key,value])=>[value[options.field],key];
        const compare = (a,b)=>String(a[0]).localeCompare(String(b[0])) || a[1].localeCompare(b[1]);
        entries.sort((a,b)=>compare(tuple(a),tuple(b)));
        if(options.start) entries = entries.filter(entry=>compare(tuple(entry),options.start)>=0);
        if(options.end) entries = entries.filter(entry=>compare(tuple(entry),options.end)<=0);
        if(options.first) entries = entries.slice(0,options.first);
        if(options.last) entries = entries.slice(-options.last);
        return Promise.resolve({forEach(callback){ entries.forEach(([key,value])=>callback({key,val:()=>value})); }});
      },
    };
  }};
  vm.runInContext('db = fakeDb',app.context);
  const pages = [];
  let cursor = null;
  for(let i=0;i<3;i++){
    const page = await vm.runInContext(`readPage('contacts','connectAt','desc',${cursor ? JSON.stringify(cursor) : 'null'})`,app.context);
    pages.push(page);
    cursor = page.cursor;
  }
  assert.deepEqual(pages.map(page=>page.items.length),[15,15,5]);
  assert.deepEqual(pages.map(page=>page.hasMore),[true,true,false]);
  assert.equal(new Set(pages.flatMap(page=>page.items.map(item=>item.key))).size,35);

  for(const id of Object.keys(records)) delete records[id];
  for(let i=0;i<16;i++) records[`a${String(i).padStart(2,'0')}`] = {apptAt:`2026-09-29T${String(i).padStart(2,'0')}:00`};
  records.now = {apptAt:'2026-09-30T10:00'};
  assert.equal(vm.runInContext('minuteKey(new Date(2026,8,30,0,0))',app.context),'2026-09-30T00:00');
  assert.equal(vm.runInContext('minuteKey(new Date(new Date(2026,8,30,0,0).getTime()-60_000))',app.context),'2026-09-29T23:59');
  const archive = await vm.runInContext("readPage('appointments','apptAt','desc',null,null,'2026-09-30T09:59')",app.context);
  assert.equal(archive.items.length,15);
  assert.equal(archive.hasMore,true);
  assert.equal(archive.items.some(item=>item.key==='now'),false);
});

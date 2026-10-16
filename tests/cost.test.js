const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {createApp} = require('./helpers/app.cjs');
const {queryDb} = require('./helpers/query-db.cjs');
const settle = async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};

function setup(data={}){
  const app = createApp();
  const network = queryDb(data);
  app.context.networkDb = network.db;
  vm.runInContext('db=networkDb; currentUser="Joy"; pagedMode=true;',app.context);
  for(const id of ['contactRelation','allContactRelation']) app.element(id).value='all';
  for(const id of ['contactSort','allContactSort']) app.element(id).value='newest';
  const run = code=>vm.runInContext(code,app.context);
  return {...app,network,run,close:()=>run('stopApp()')};
}

function records(count=15){
  const contacts={}, guide={},validations={},summaries={};
  for(let i=1;i<=count;i++){
    const id='c'+String(i).padStart(2,'0');
    contacts[id]={name:'Contact '+i,mainGuide:'Joy',connectAt:'2026-10-16T10:00'};
    guide[id]=contacts[id].connectAt;
    validations['v'+i]={contactId:id,date:'2026-10-16',topic:'Topic '+i};
    summaries[id]={firstDate:'2026-10-16',latestDate:'2026-10-16',count:1};
  }
  return {contacts,guideContacts:{joy:{all:guide}},validations,validationSummaries:summaries};
}

test('concurrent and repeated contact/history reads share three live resources',async()=>{
  const app=setup(records(1));
  try {
    await Promise.all(Array.from({length:5},()=>app.run('Promise.all([fetchContact("c01"),fetchRelatedForContact("c01")])')));
    assert.equal(app.network.requests.length,3);
    await app.run('fetchRelatedForContact("c01")');
    assert.equal(app.network.requests.length,3);
    app.network.write('validations/v1/topic','Changed remotely');
    await settle();
    assert.equal(app.run('validations.v1.topic'),'Changed remotely');
    assert.equal(app.network.requests.length,3);
  } finally {app.close();}
});

test('visiting mine and all lists reuses contact-related queries',async()=>{
  const app=setup(records());
  try {
    await app.run('loadContactPage("mine")');
    const count=app.network.requests.length;
    await app.run('loadContactPage("all")');
    assert.equal(app.network.requests.length-count,1);
    assert.equal(app.network.requests.filter(r=>r.method==='once').length,0);
    assert.equal(app.network.requests.filter(r=>r.path==='appointments').length,15);
    assert.equal(app.network.requests.filter(r=>r.path==='validations').length,15);
  } finally {app.close();}
});

test('validation pages load histories without requesting appointments',async()=>{
  const app=setup(records());
  try {
    await app.run('loadValidationPage()');
    assert.equal(app.network.requests.filter(r=>r.path==='appointments').length,0);
    assert.equal(app.network.requests.filter(r=>r.path==='validations').length,15);
    assert.equal(app.run('pageState.validations.ids.length'),15);
  } finally {app.close();}
});

test('contact and appointment searches subscribe only to required full collections',async()=>{
  const app=setup(records(2));
  try {
    await Promise.all([app.run('ensureFullData("contacts")'),app.run('ensureFullData("contacts")')]);
    assert.deepEqual(app.network.requests.map(r=>r.path),['contacts']);
    await app.run('ensureFullData("appointments")');
    assert.deepEqual(app.network.requests.map(r=>r.path),['contacts','appointments']);
    assert.equal(app.network.requests.some(r=>r.path==='validations'),false);
    const count=app.network.requests.length;
    app.network.write('contacts/c01/phone','010-0000-0000');
    app.network.write('appointments/a1',{contactId:'c01',apptAt:'2099-01-01T10:00'});
    await settle();
    app.run('refreshAfterMutation("appointments","contacts")');
    await settle();
    assert.equal(app.run('contacts.c01.phone'),'010-0000-0000');
    assert.equal(app.network.requests.length,count);
  } finally {app.close();}
});

test('a full collection replaces narrower subscriptions instead of duplicating them',async()=>{
  const app=setup(records(1));
  try {
    await app.run('fetchRelatedCollection("appointments","c01")');
    await app.run('ensureFullData("appointments")');
    assert.equal(app.network.watchers.size,2);
    assert.equal(app.run('liveQueries.has("related:appointments:c01")'),false);
    app.close();
    assert.equal(app.network.watchers.size,0);
  } finally {app.close();}
});

test('changing a first-page record in place does not re-read pages or histories',async()=>{
  const app=setup(records(16));
  try {
    await app.run('loadContactPage("all")');
    const count=app.network.requests.length;
    app.network.write('contacts/c16/phone','Updated remotely');
    await settle();
    assert.equal(app.run('contacts.c16.phone'),'Updated remotely');
    assert.equal(app.network.requests.length,count);
    assert.equal(app.network.requests.filter(r=>r.method==='once').length,0);
  } finally {app.close();}
});

test('cursor pagination keeps 35 tied records unique and reads only appended pages once',async()=>{
  const app=setup(records(35));
  try {
    for(let i=0;i<3;i++) await app.run('loadContactPage("all")');
    assert.equal(app.run('pageState.all.ids.length'),35);
    assert.equal(app.run('new Set(pageState.all.ids).size'),35);
    assert.equal(app.run('pageState.all.hasMore'),false);
    assert.equal(app.network.requests.filter(r=>r.path==='contacts' && r.method==='on').length,1);
    assert.equal(app.network.requests.filter(r=>r.path==='contacts' && r.method==='once').length,2);
  } finally {app.close();}
});

test('same-month calendar requests share one query and receive updates without reload',async()=>{
  const data=records(1);
  data.appointments={a1:{contactId:'c01',apptDate:'2026-10-16',apptAt:'2026-10-16T10:00'}};
  const app=setup(data);
  app.element('apptCalendarPanel').open=true;
  app.run('calYear=2026;calMonth=9');
  try {
    await Promise.all([app.run('loadAppointmentMonth()'),app.run('loadAppointmentMonth()')]);
    await app.run('loadAppointmentMonth()');
    assert.equal(app.network.requests.filter(r=>r.path==='appointments').length,1);
    app.network.write('appointments/a1/memo','New memo');
    await settle();
    assert.equal(app.run('appointments.a1.memo'),'New memo');
    assert.equal(app.network.requests.filter(r=>r.path==='appointments').length,1);
  } finally {app.close();}
});

test('metadata changes do not rewrite identical guide indexes',()=>{
  const app=setup();
  try {
    app.run('contacts.c1={name:"A",mainGuide:"Joy",subGuide:["Sam"],connectAt:"2026-10-16T10:00"}');
    const patch=app.run('guideIndexPatch("c1",contacts.c1,{...contacts.c1,phone:"new"})');
    assert.equal(Object.keys(patch).length,0);
    const moved=app.run('guideIndexPatch("c1",contacts.c1,{...contacts.c1,mainGuide:"Sam"})');
    assert.equal(moved['guideContacts/joy/all/c1'],null);
    assert.equal(moved['guideContacts/sam/main/c1'],'2026-10-16T10:00');
  } finally {app.close();}
});

test('deleting a first-page contact fills the gap using the cached page snapshot',async()=>{
  const app=setup(records(35));
  try {
    await app.run('loadContactPage("all")');
    const before=app.network.requests.length;
    app.network.write('contacts/c35',null);
    await settle();
    assert.equal(app.run('pageState.all.ids.length'),15);
    assert.equal(app.run('pageState.all.ids.includes("c35")'),false);
    assert.equal(app.run('pageState.all.ids.includes("c20")'),true);
    assert.equal(app.network.requests.filter(r=>r.method==='once').length,0);
    assert.equal(app.network.requests.length-before,3); // Only the newly visible person's data.
  } finally {app.close();}
});

test('absent contacts are cached and late results cannot enter a different session',async()=>{
  const app=setup();
  try {
    assert.equal(await app.run('fetchContact("missing")'),null);
    assert.equal(await app.run('fetchContact("missing")'),null);
    assert.equal(app.network.requests.length,1);
    const pending=app.run('fetchContact("late")');
    app.close();
    await assert.rejects(pending);
    await settle();
    assert.equal(app.run('Object.keys(contacts).length'),0);
    assert.equal(app.network.watchers.size,0);
  } finally {app.close();}
});

test('history subscriptions that no view needs are released after the grace period',async()=>{
  const app=setup(records(1));
  try {
    await app.run('fetchRelatedForContact("c01")');
    app.run('for(const entry of liveQueries.values()) entry.lastUsedAt=0; pruneDataQueries()');
    assert.equal(app.network.watchers.size,0);
    assert.equal(app.run('liveQueries.size'),0);
  } finally {app.close();}
});

test('editing a phone number preserves other fields and writes no unchanged guide index',async()=>{
  const app=createApp();
  vm.runInContext('enterApp("Joy"); contacts={c1:{name:"A",phone:"old",org:"",topic:"",mainGuide:"Joy",subGuide:[],connectAt:"2026-10-16T10:00",trait:"",baptism:1,createdBy:"Sam"}}',app.context);
  for(const [id,value] of Object.entries({contactId:'c1',cName:'A',cPhone:'new',cMainGuide:'Joy',cConnectDate:'2026-10-16',cConnectTime:'10:00'})) app.element(id).value=value;
  await vm.runInContext('saveContact()',app.context);
  assert.equal(app.writes.length,1);
  assert.equal(app.writes[0].data['contacts/c1/phone'],'new');
  assert.equal(Object.keys(app.writes[0].data).some(path=>path.startsWith('guideContacts/')),false);
  assert.equal(Object.hasOwn(app.writes[0].data,'contacts/c1'),false);
  assert.equal(vm.runInContext('contacts.c1.baptism',app.context),1);
  assert.equal(vm.runInContext('contacts.c1.createdBy',app.context),'Sam');
});

test('editing one validation topic leaves other rounds and summary indexes untouched',async()=>{
  const app=createApp();
  vm.runInContext('enterApp("Joy"); contacts={c1:{name:"A"}}; validations={v1:{contactId:"c1",date:"2026-10-16",topic:"old",createdBy:"Sam"},v2:{contactId:"c1",date:"2026-10-17",topic:"same",updatedAt:123}}; getValidationRoundValues=()=>[{id:"v1",date:"2026-10-16",topic:"changed"},{id:"v2",date:"2026-10-17",topic:"same"}]',app.context);
  app.element('vContactId').value='c1';
  await vm.runInContext('saveValidation()',app.context);
  assert.equal(app.writes.length,1);
  assert.deepEqual(Object.keys(app.writes[0].data),['validations/v1']);
  assert.equal(app.writes[0].data['validations/v1'].createdBy,'Sam');
  assert.equal(vm.runInContext('validations.v2.updatedAt',app.context),123);
});

test('saving an unchanged appointment makes no database write',async()=>{
  const app=createApp();
  vm.runInContext('enterApp("Joy"); contacts={c1:{name:"A"}}; appointments={a1:{contactId:"c1",apptDate:"2099-10-16",apptTime:"10:00",apptAt:"2099-10-16T10:00",memo:"same"}}',app.context);
  for(const [id,value] of Object.entries({apptId:'a1',aContactId:'c1',aDate:'2099-10-16',aTime:'10:00',aMemo:'same'})) app.element(id).value=value;
  await vm.runInContext('saveAppt()',app.context);
  assert.equal(app.writes.length,0);
  assert.match(app.element('appStatus').textContent,/변경 사항이 없습니다/);
});

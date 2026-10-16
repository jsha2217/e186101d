// Deterministic Firebase query simulator with logical request counts.
const clone = value=>JSON.parse(JSON.stringify(value ?? null));
function queryDb(initial={}){
  const data = clone(initial);
  const requests = [];
  const watchers = new Set();
  function valueAt(path){return path.split('/').filter(Boolean).reduce((value,key)=>value?.[key],data) ?? null;}
  function snapshot(path,options){
    const raw = valueAt(path);
    let entries = raw && typeof raw==='object' ? Object.entries(raw) : [];
    const ordered = options.field != null;
    const sortValue = ([key,value])=>options.field==='$value' ? value : options.field ? value?.[options.field] ?? '' : key;
    const compare = (a,b)=>String(a[0]).localeCompare(String(b[0])) || a[1].localeCompare(b[1]);
    entries.sort((a,b)=>compare([sortValue(a),a[0]],[sortValue(b),b[0]]));
    if(options.equal != null) entries = entries.filter(entry=>sortValue(entry)===options.equal);
    if(options.start) entries = entries.filter(entry=>compare([sortValue(entry),entry[0]],[options.start[0],options.start[1] || ''])>=0);
    if(options.end) entries = entries.filter(entry=>compare([sortValue(entry),entry[0]],[options.end[0],options.end[1] || '\uffff'])<=0);
    if(options.first) entries = entries.slice(0,options.first);
    if(options.last) entries = entries.slice(-options.last);
    const value = ordered ? (entries.length ? Object.fromEntries(entries) : null) : raw;
    const copy = clone(value);
    const orderedEntries = clone(entries);
    return {val:()=>clone(copy), forEach(callback){for(const [key,value] of orderedEntries) callback({key,val:()=>clone(value)});}};
  }
  function notify(){
    for(const entry of [...watchers]){
      const snap = snapshot(entry.path,entry.options);
      const encoded = JSON.stringify(snap.val());
      if(encoded===entry.encoded) continue;
      entry.encoded = encoded;
      Promise.resolve().then(()=>{if(watchers.has(entry)) entry.callback(snap);});
    }
  }
  function put(path,value){
    const parts = path.split('/').filter(Boolean);
    let parent=data;
    for(const part of parts.slice(0,-1)) parent = parent[part] ||= {};
    if(value==null) delete parent[parts.at(-1)]; else parent[parts.at(-1)] = clone(value);
  }
  let nextId=0;
  const db = {ref(path=''){
    const options = {};
    const query = {
      key:path.split('/').at(-1),
      orderByChild(field){options.field=field;return this;}, orderByValue(){options.field='$value';return this;},
      equalTo(value){options.equal=value;return this;},
      startAt(value,key){options.start=[value,key];return this;},endAt(value,key){options.end=[value,key];return this;},
      limitToFirst(count){options.first=count;return this;},limitToLast(count){options.last=count;return this;},
      once(){requests.push({method:'once',path,options:{...options}});return Promise.resolve(snapshot(path,options));},
      on(_event,callback){
        requests.push({method:'on',path,options:{...options}});
        const snap=snapshot(path,options);
        const entry={path,options:{...options},callback,query,encoded:JSON.stringify(snap.val())};
        watchers.add(entry);
        Promise.resolve().then(()=>{if(watchers.has(entry)) callback(snap);});
      },
      off(_event,callback){for(const entry of watchers) if(entry.query===query && entry.callback===callback) watchers.delete(entry);},
      async update(patch){for(const [key,value] of Object.entries(patch)) put([path,key].filter(Boolean).join('/'),value);notify();},
      async set(value){put(path,value);notify();},async remove(){put(path,null);notify();},
      push(){return db.ref(path+'/new'+(++nextId));},
    };
    return query;
  }};
  return {db,data,requests,watchers,write(path,value){put(path,value);notify();}};
}
module.exports = {queryDb};

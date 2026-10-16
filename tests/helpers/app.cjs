const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const root = path.join(__dirname, '../..');

function createApp(options={}){
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
  const teamUser = {uid:'connector-team', getIdTokenResult:async()=>({claims:{firebase:{sign_in_provider:'password'},auth_time:1700000000}})};
  const storage = new Map(options.savedName ? [['connectorAuthUser',options.savedName]] : []);
  let authCallback;
  const authCalls = [];
  let authError = null;
  const auth = {
    currentUser:options.user || null,
    onAuthStateChanged(callback){authCallback=callback;},
    async setPersistence(value){authCalls.push({method:'persistence',value});},
    async signInWithEmailAndPassword(email,password){
      authCalls.push({method:'signIn',email,password});
      if(authError) throw Object.assign(new Error('auth failed'), {code:authError});
      const user = options.signIn ? await options.signIn() : teamUser;
      this.currentUser=user;
      if(authCallback) await authCallback(user);
      return {user};
    },
    async signOut(){this.currentUser=null;authCalls.push({method:'signOut'});if(authCallback) await authCallback(null);},
  };
  const authFn = ()=>auth;
  authFn.Auth = {Persistence:{LOCAL:'local'}};
  const firebase = {apps:[], initializeApp(){ this.apps.push({}); }, database(){ return db; }, auth:authFn};
  const context = vm.createContext({
    document:{getElementById:element, createElement:()=>element(`created${elements.size}`), body:element('body'), querySelectorAll:()=>[], addEventListener(){}},
    firebase, localStorage:{getItem:key=>storage.get(key)||null, setItem:(key,value)=>storage.set(key,value), removeItem:key=>storage.delete(key)},
    crypto:webcrypto, TextEncoder, console:{error(){}}, alert:message=>alerts.push(message),
    confirm:()=>true, setInterval:()=>1, clearInterval(){}, setTimeout:()=>1, clearTimeout(){}, Date,
  });
  for(const file of ['core.js','auth.js','contacts.js','appointments.js','validations.js','paging.js','bootstrap.js']){
    vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'), context, {filename:file});
  }
  // Business-logic tests begin after a verified team login; auth tests opt out.
  if(options.trustedSession !== false) vm.runInContext('teamSessionReady=true',context);
  return {context, elements, element, listeners, writes, alerts, auth, authCalls, storage, teamUser,
    emitAuth:async user=>{auth.currentUser=user;await authCallback(user);},
    setAuthError:value=>{authError=value;}, setReject:value=>{rejectWrites=value;}};
}


module.exports={createApp};

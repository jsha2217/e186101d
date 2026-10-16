const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {createApp} = require('./helpers/app.cjs');

test('a saved name alone never starts database reads or enters the app', async ()=>{
  const app = createApp({savedName:'Joy', trustedSession:false});
  await app.emitAuth(null);
  vm.runInContext('enterApp("Joy"); initApp()', app.context);
  assert.equal(app.listeners.size, 0);
  assert.equal(vm.runInContext('currentUser', app.context), null);
  assert.equal(app.element('lockScreen').style.display, 'flex');
  assert.equal(app.element('nameInput').value, 'Joy');
});

test('the server verifies the shared password and the name remains freely chosen', async ()=>{
  const app = createApp({trustedSession:false});
  app.element('nameInput').value = '  Any teammate  ';
  app.element('pwInput').value = 'shared-password';
  await vm.runInContext('login()', app.context);
  const call = app.authCalls.find(call=>call.method==='signIn');
  assert.equal(call.email, 'connector-team@paw-hello-sy.invalid');
  assert.equal(call.password, 'shared-password');
  assert.equal(app.storage.get('connectorAuthUser'), 'Any teammate');
  assert.equal(app.element('pwInput').value, '');
  assert.equal(app.listeners.size, 3);
  assert.equal(app.element('app').style.display, 'block');
});

test('invalid passwords, throttling, and network failures keep the database closed', async ()=>{
  for(const [code,message] of [['auth/invalid-credential',/확인해주세요/],
    ['auth/too-many-requests',/시도가 많습니다/], ['auth/network-request-failed',/연결하지 못했습니다/]]){
    const app = createApp({trustedSession:false});
    app.element('nameInput').value='Joy'; app.element('pwInput').value='wrong';
    app.setAuthError(code);
    await vm.runInContext('login()', app.context);
    assert.equal(app.listeners.size, 0);
    assert.equal(app.storage.has('connectorAuthUser'), false);
    assert.match(app.element('pwError').textContent, message);
  }
});

test('automatic login requires the designated team account and password provider', async ()=>{
  const app = createApp({savedName:'Sam',trustedSession:false});
  await app.emitAuth(app.teamUser);
  assert.equal(vm.runInContext('currentUser',app.context),'Sam');
  assert.equal(app.listeners.size,3);
  for(const user of [{...app.teamUser, uid:'stranger'},
    {...app.teamUser,getIdTokenResult:async()=>({claims:{firebase:{sign_in_provider:'anonymous'}}})}]){
    const blocked = createApp({savedName:'Joy',trustedSession:false});
    await blocked.emitAuth(user);
    assert.equal(blocked.listeners.size,0);
    assert.equal(vm.runInContext('currentUser',blocked.context),null);
  }
});

test('logout signs out of Firebase and clears name, data, and subscriptions', async ()=>{
  const app = createApp({savedName:'Joy',trustedSession:false});
  await app.emitAuth(app.teamUser);
  app.element('contactList').innerHTML = 'private contact';
  app.element('dayModalList').innerHTML = 'private appointment';
  await vm.runInContext('logout()',app.context);
  assert.equal(app.auth.currentUser,null);
  assert.equal(app.storage.has('connectorAuthUser'),false);
  assert.equal(app.listeners.size,0);
  assert.equal(vm.runInContext('teamSessionReady',app.context),false);
  assert.equal(app.element('contactList').innerHTML,'');
  assert.equal(app.element('dayModalList').innerHTML,'');
});

test('logout during a slow login cannot reopen the application', async ()=>{
  let finish;
  const pending = new Promise(resolve=>{finish=resolve;});
  const app = createApp({trustedSession:false,signIn:()=>pending});
  app.element('nameInput').value='Joy'; app.element('pwInput').value='shared-password';
  const login = vm.runInContext('login()',app.context);
  await Promise.resolve();
  await vm.runInContext('logout()',app.context);
  finish(app.teamUser);
  await login;
  assert.equal(app.listeners.size,0);
  assert.equal(app.storage.has('connectorAuthUser'),false);
  assert.equal(app.auth.currentUser,null);
});

test('revoked database access clears cached data and prompts for a fresh password', async ()=>{
  const app = createApp({savedName:'Joy',trustedSession:false});
  await app.emitAuth(app.teamUser);
  vm.runInContext('contacts={c1:{name:"Private"}}; handleDatabaseError({code:"PERMISSION_DENIED"},"error")',app.context);
  assert.equal(app.listeners.size,0);
  assert.equal(vm.runInContext('Object.keys(contacts).length',app.context),0);
  assert.equal(app.element('nameInput').value,'Joy');
  assert.match(app.element('pwError').textContent,/다시 입력/);
});

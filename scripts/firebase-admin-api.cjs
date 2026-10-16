// Reuse the administrator's Firebase CLI login without printing or persisting its tokens.
const {execFileSync} = require('node:child_process');
const {realpathSync} = require('node:fs');
const {createRequire} = require('node:module');

let credentials;
async function firebaseAdminRequest(url, {method='GET', body}={}){
  if(!credentials){
    const executable = realpathSync(execFileSync('which',['firebase'],{encoding:'utf8'}).trim());
    const cliRequire = createRequire(executable);
    const auth = cliRequire('../auth');
    const account = auth.getGlobalDefaultAccount();
    if(!account) throw new Error('Run firebase login first');
    const options = {project:'paw-hello-sy'};
    auth.setActiveAccount(options, account);
    await cliRequire('../requireAuth').requireAuth(options);
    credentials = {auth, account, scopes:options.authScopes};
  }
  const {auth, account, scopes} = credentials;
  const {access_token} = await auth.getAccessToken(account.tokens.refresh_token, scopes);
  const response = await fetch(url, {
    method, headers:{Authorization:'Bearer '+access_token, 'Content-Type':'application/json'},
    body:body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if(!response.ok) throw new Error(`Firebase admin HTTP ${response.status}: ${data.error?.message || 'request failed'}`);
  return data;
}

module.exports = {firebaseAdminRequest};

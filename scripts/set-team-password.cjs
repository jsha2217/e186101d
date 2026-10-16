#!/usr/bin/env node
// Administrative password rotation: hidden terminal input, never command-line arguments.
const readline = require('node:readline');
const {Writable} = require('node:stream');
const {firebaseAdminRequest:request} = require('./firebase-admin-api.cjs');

function readSecret(prompt){
  return new Promise((resolve, reject)=>{
    process.stdout.write(prompt);
    const output = new Writable({write(_chunk, _encoding, done){done();}});
    const rl = readline.createInterface({input:process.stdin,output,terminal:true});
    rl.once('SIGINT', ()=>{rl.close();process.stdout.write('\n');reject(new Error('취소했습니다.'));});
    rl.question('', value=>{rl.close();process.stdout.write('\n');resolve(value);});
  });
}

(async()=>{
  if(!process.stdin.isTTY || process.argv.length !== 2){
    throw new Error('터미널에서 node scripts/set-team-password.cjs 로 실행해주세요. 비밀번호를 인자로 전달하지 마세요.');
  }
  const password = await readSecret('새 공용 비밀번호 (화면에 표시되지 않음): ');
  const confirmation = await readSecret('새 공용 비밀번호 확인: ');
  if(password.length < 6) throw new Error('비밀번호는 최소 6자여야 합니다.');
  if(password !== confirmation) throw new Error('비밀번호가 일치하지 않습니다. 변경하지 않았습니다.');
  await request('https://identitytoolkit.googleapis.com/v1/projects/paw-hello-sy/accounts:update', {
    method:'POST',body:{localId:'connector-team',password},
  });
  // Reject all earlier ID tokens at the rules layer, without waiting for token expiry.
  await request('https://paw-hello-sy-default-rtdb.europe-west1.firebasedatabase.app/_security.json', {
    method:'PATCH',body:{minAuthTime:Math.floor(Date.now()/1000)+1},
  });
  console.log('공용 비밀번호를 변경하고 기존 세션의 DB 접근을 해제했습니다. 1초 후 새 비밀번호로 로그인해주세요.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});

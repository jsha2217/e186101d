#!/usr/bin/env node
import {readAdmin, updateAdmin} from './admin-db.mjs';

const args = process.argv.slice(2);
if(args.length === 0){
  const contacts = await readAdmin('contacts') || {};
  const patch = {};
  for(const [id, contact] of Object.entries(contacts)){
    if(contact.baptism == null) patch[`contacts/${id}/baptism`] = 0;
  }
  if(Object.keys(patch).length) await updateAdmin(patch);
  console.log(`완료: ${Object.keys(patch).length}건 백필`);
} else if(args.length === 2 && /^[^.#$\[\]/\u0000-\u001f\u007f]+$/.test(args[0]) && /^[01]$/.test(args[1])){
  const [id, value] = args;
  if(!await readAdmin(`contacts/${id}`)) throw new Error('연결자를 찾을 수 없습니다.');
  await updateAdmin({[`contacts/${id}/baptism`]:Number(value)});
  console.log(`완료: ${id} baptism -> ${value}`);
} else {
  console.error('사용법: scripts/set-baptism.sh [<contactId> <0|1>]');
  process.exitCode = 1;
}

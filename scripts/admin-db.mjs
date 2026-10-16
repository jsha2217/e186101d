// Administrative scripts use the Firebase CLI login, never unauthenticated REST.
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, rm, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const exec = promisify(execFile);
const projectArgs = ['--project', 'paw-hello-sy', '--non-interactive'];

export async function readAdmin(path){
  const dir = await mkdtemp(join(tmpdir(), 'connector-admin-'));
  const output = join(dir, 'data.json');
  try {
    await exec('firebase', ['database:get', '/'+path, '--output', output, ...projectArgs]);
    await chmod(output, 0o600);
    return JSON.parse(await readFile(output, 'utf8'));
  } finally { await rm(dir, {recursive:true, force:true}); }
}

export function updateAdmin(patch){
  return new Promise((resolve, reject)=>{
    const child = spawn('firebase', ['database:update', '/', '--force', ...projectArgs], {stdio:['pipe','pipe','pipe']});
    // Keep database data out of terminal output and process arguments.
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code=>code === 0 ? resolve() : reject(new Error('관리자 저장 실패: firebase login 및 프로젝트 권한을 확인해주세요.')));
    child.stdin.on('error', ()=>{});
    child.stdin.end(JSON.stringify(patch));
  });
}

#!/usr/bin/env node
// 기존 RTDB 기록을 15건 단위 조회에 필요한 인덱스로 백필한다.
// 기본 동작은 읽기 전용 점검이며, --apply일 때만 쓰기를 수행한다.
const DB_URL = 'https://paw-hello-sy-default-rtdb.europe-west1.firebasedatabase.app';
const apply = process.argv.includes('--apply');

async function read(path){
  const response = await fetch(`${DB_URL}/${path}.json`);
  if(!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return await response.json() || {};
}

function guideKey(name){
  return encodeURIComponent((name || '').trim().toLowerCase()).replace(/[.#$\[\]]/g, char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function subGuides(contact){
  if(Array.isArray(contact.subGuide)) return contact.subGuide.filter(Boolean);
  return String(contact.subGuide || '').split(',').map(value=>value.trim()).filter(Boolean);
}

const [contacts, appointments, validations, currentVersion] = await Promise.all([
  read('contacts'), read('appointments'), read('validations'), read('meta/paginationVersion'),
]);
if(currentVersion === 1){
  console.log('페이지 조회 인덱스가 이미 적용되어 있습니다.');
  process.exit(0);
}

const guideContacts = {};
for(const [id, contact] of Object.entries(contacts)){
  const main = guideKey(contact.mainGuide);
  const guides = new Map();
  if(main) guides.set(main,new Set(['all','main']));
  for(const name of subGuides(contact)){
    const key = guideKey(name);
    if(!key) continue;
    if(!guides.has(key)) guides.set(key,new Set());
    guides.get(key).add('all');
    guides.get(key).add('sub');
  }
  for(const [key, roles] of guides){
    for(const role of roles){
      guideContacts[key] ||= {};
      guideContacts[key][role] ||= {};
      guideContacts[key][role][id] = contact.connectAt || '';
    }
  }
}

const roundGroups = {};
for(const validation of Object.values(validations)){
  if(!validation.contactId) continue;
  (roundGroups[validation.contactId] ||= []).push(validation.date || '');
}
const validationSummaries = {};
for(const [id, dates] of Object.entries(roundGroups)){
  dates.sort();
  validationSummaries[id] = {firstDate:dates[0],latestDate:dates.at(-1),count:dates.length};
}

const patch = {
  guideContacts,
  validationSummaries,
  'meta/paginationVersion':1,
};
for(const [id, appointment] of Object.entries(appointments)){
  patch[`appointments/${id}/apptAt`] = appointment.apptDate && appointment.apptTime
    ? `${appointment.apptDate}T${appointment.apptTime}` : '9999-99-99T00:00';
}

console.log(JSON.stringify({contacts:Object.keys(contacts).length,
  appointments:Object.keys(appointments).length,
  validations:Object.keys(validations).length,
  guideGroups:Object.keys(guideContacts).length,
  validationSummaries:Object.keys(validationSummaries).length,
  writeRequested:apply},null,2));
if(!apply) process.exit(0);

const response = await fetch(`${DB_URL}/.json`,{
  method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(patch),
});
if(!response.ok) throw new Error(`Migration write failed: HTTP ${response.status}`);
console.log('페이지 조회 인덱스를 적용했습니다.');

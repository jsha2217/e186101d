import {test, before, after, beforeEach} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {ref, get, set, update, query, orderByChild, orderByValue, equalTo, limitToLast} from 'firebase/database';

let env;
const minAuthTime = 1700000000;
const claims = {auth_time:minAuthTime, firebase:{sign_in_provider:'password'}};
const database = (uid='connector-team', token=claims)=>env.authenticatedContext(uid, token).database();
before(async()=>{
  env = await initializeTestEnvironment({projectId:'demo-connector', database:{
    host:'127.0.0.1',port:9000,rules:await readFile(new URL('../database.rules.json',import.meta.url),'utf8'),
  }});
});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context=>{
    await set(ref(context.database()), {
      _security:{minAuthTime}, _authRateLimits:{private:true},
      contacts:{c1:{name:'A',mainGuide:'Joy',connectAt:'2026-10-01'},c2:{name:'B',mainGuide:'Sam',connectAt:'2026-10-02'}},
      appointments:{a1:{contactId:'c1',apptDate:'2026-10-16',apptAt:'2026-10-16T10:00'}},
      validations:{v1:{contactId:'c1',date:'2026-10-16'}},
      validationSummaries:{c1:{firstDate:'2026-10-16',latestDate:'2026-10-16',count:1}},
      guideContacts:{joy:{all:{c1:'2026-10-01'},main:{c1:'2026-10-01'}}},
      meta:{paginationVersion:1},
    });
  });
});

test('unauthenticated users and unrelated signed-in users cannot read or write',async()=>{
  for(const db of [env.unauthenticatedContext().database(),database('stranger')]){
    for(const path of ['/', 'contacts', 'appointments', 'validations', 'validationSummaries', 'guideContacts/joy/all', 'meta/paginationVersion']){
      await assertFails(get(ref(db,path)));
      await assertFails(set(ref(db,path),null));
    }
  }
});

test('team sessions keep full sharing, pagination, related queries and calendars',async()=>{
  const db=database();
  for(const path of ['contacts','appointments','validations','validationSummaries','guideContacts/joy/all','meta/paginationVersion']){
    await assertSucceeds(get(ref(db,path)));
  }
  for(const request of [query(ref(db,'contacts'),orderByChild('connectAt'),limitToLast(15)),
    query(ref(db,'appointments'),orderByChild('contactId'),equalTo('c1')),
    query(ref(db,'appointments'),orderByChild('apptDate'),equalTo('2026-10-16')),
    query(ref(db,'validations'),orderByChild('contactId'),equalTo('c1')),
    query(ref(db,'validationSummaries'),orderByChild('latestDate'),limitToLast(15)),
    query(ref(db,'guideContacts/joy/all'),orderByValue(),limitToLast(15))]){
    await assertSucceeds(get(request));
  }
  // Shared teammates may edit other guides' records, as in the existing application.
  await assertSucceeds(update(ref(db,'contacts/c2'),{name:'Edited by team'}));
});

test('contact and validation multi-path writes and cascade deletion remain atomic',async()=>{
  const db=database();
  await assertSucceeds(update(ref(db),{
    'contacts/c3':{name:'C',mainGuide:'Joy',connectAt:'2026-10-16'},
    'guideContacts/joy/all/c3':'2026-10-16', 'guideContacts/joy/main/c3':'2026-10-16',
    'validations/v3':{contactId:'c3',date:'2026-10-17'},
    'validationSummaries/c3':{firstDate:'2026-10-17',latestDate:'2026-10-17',count:1},
  }));
  await assertSucceeds(set(ref(db,'appointments/a2'),{contactId:'c3',apptAt:'2026-10-18T10:00'}));
  await assertSucceeds(update(ref(db),{
    'contacts/c3':null,'appointments/a2':null,'validations/v3':null,'validationSummaries/c3':null,
    'guideContacts/joy/all/c3':null,'guideContacts/joy/main/c3':null,
  }));
});

test('team sessions cannot read root, alter settings, or self-grant access',async()=>{
  const db=database();
  for(const path of ['/', '_security', '_authRateLimits', 'unknown']) await assertFails(get(ref(db,path)));
  for(const path of ['/', '_security/minAuthTime', '_authRateLimits/x', 'meta/paginationVersion', 'unknown']){
    await assertFails(set(ref(db,path),1));
  }
  await assertFails(update(ref(db),{'contacts/c1/name':'Changed','_security/minAuthTime':0}));
});

test('revoked sessions, custom tokens and anonymous tokens cannot use the shared uid',async()=>{
  for(const token of [{...claims,auth_time:minAuthTime-1},
    {...claims,firebase:{sign_in_provider:'anonymous'}}, {...claims,firebase:{sign_in_provider:'custom'}}]){
    const db=database('connector-team',token);
    await assertFails(get(ref(db,'contacts')));
    await assertFails(set(ref(db,'contacts/c1'),null));
  }
});

test('missing or malformed authentication cutoff fails closed',async()=>{
  const db=database();
  for(const cutoff of [null,'invalid']){
    await env.withSecurityRulesDisabled(async context=>{
      await set(ref(context.database(),'_security/minAuthTime'),cutoff);
    });
    await assertFails(get(ref(db,'contacts')));
    await assertFails(set(ref(db,'contacts/c1'),null));
  }
});

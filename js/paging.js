const PAGE_SIZE = 15;
let pagedMode = false;
let pagingGeneration = 0;
const pageState = {};
const refreshingKinds = new Set();
let calendarApptIds = [];
let calendarValidationIds = [];
let validationRoundsLoading = false;
let appointmentMonthRequest = 0;
let validationMonthRequest = 0;

function freshPage(){ return {ids:[], cursor:null, hasMore:true, loading:false, ready:false}; }
function resetPagedData(){
  pagingGeneration++;
  pagedMode = false;
  for(const key of ['mine','all','upcoming','archive','validations']) pageState[key] = freshPage();
  refreshingKinds.clear();
  calendarApptIds = [];
  calendarValidationIds = [];
  validationRoundsLoading = false;
  appointmentMonthRequest++;
  validationMonthRequest++;
}
resetPagedData();

function guideIndexKey(name){
  return encodeURIComponent((name || '').trim().toLowerCase()).replace(/[.#$\[\]]/g, char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function initializePagedData(){
  const generation = pagingGeneration;
  const versionRef = db.ref('meta/paginationVersion');
  if(typeof versionRef.once !== 'function'){ subscribeLegacyData(); return; }
  try {
    const version = await versionRef.once('value');
    if(generation !== pagingGeneration || !currentUser) return;
    if(version.val() !== 1){ subscribeLegacyData(); return; }
    pagedMode = true;
    await loadContactPage('mine');
    observeMoreButtons();
  } catch(error){
    console.error('Pagination initialization failed:', error);
    if(generation === pagingGeneration && currentUser) handleDatabaseError(error, '데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.');
  }
}

function snapshotEntries(snapshot){
  const entries = [];
  snapshot.forEach(child=>{ entries.push({key:child.key, value:child.val()}); });
  return entries;
}

function minuteKey(date){
  const local = new Date(date.getTime() - date.getTimezoneOffset()*60_000);
  return local.toISOString().slice(0,16);
}

async function readPage(path, field, direction, cursor, lowerBound, upperBound, kind=null){
  let query = field === '$value' ? db.ref(path).orderByValue() : db.ref(path).orderByChild(field);
  const ascending = direction === 'asc';
  if(cursor) query = ascending ? query.startAt(cursor.value, cursor.key) : query.endAt(cursor.value, cursor.key);
  else if(lowerBound) query = query.startAt(lowerBound);
  else if(upperBound) query = query.endAt(upperBound);
  query = ascending ? query.limitToFirst(PAGE_SIZE + (cursor ? 2 : 1)) : query.limitToLast(PAGE_SIZE + (cursor ? 2 : 1));
  const snapshot = kind && !cursor
    ? await firstPageSnapshot(kind,path,field,direction,lowerBound,upperBound)
    : await query.once('value');
  let entries = snapshotEntries(snapshot);
  if(cursor) entries = entries.filter(entry=>entry.key !== cursor.key);
  if(!ascending) entries.reverse();
  const hasMore = entries.length > PAGE_SIZE;
  const items = entries.slice(0,PAGE_SIZE);
  const last = items.at(-1);
  return {items, hasMore, cursor:last ? {key:last.key, value:field==='$value' ? last.value : last.value?.[field] || ''} : cursor};
}

async function fetchContact(id){
  if(!id) return null;
  if(completeCollections.has('contacts')) return contacts[id] || null;
  const entry = liveQuery('record:contacts:'+id,id,db.ref('contacts/'+id),snapshot=>{
    if(completeCollections.has('contacts')) return;
    const value = snapshot.val();
    if(value) contacts[id] = value;
    else {
      delete contacts[id];
      for(const kind of ['mine','all']) if(pageState[kind].ready && pageState[kind].ids.includes(id)) queuePageRefresh(kind);
    }
  });
  await entry.promise;
  return contacts[id] || null;
}

async function fetchRelatedForContact(id){
  await Promise.all([fetchRelatedCollection('appointments',id),fetchRelatedCollection('validations',id)]);
}

function guideIndexPaths(id, contact){
  if(!contact) return [];
  const paths = new Set();
  const main = guideIndexKey(contact.mainGuide);
  if(main){
    paths.add(`guideContacts/${main}/all/${id}`);
    paths.add(`guideContacts/${main}/main/${id}`);
  }
  subGuideArray(contact).forEach(name=>{
    const key = guideIndexKey(name);
    if(key){
      paths.add(`guideContacts/${key}/all/${id}`);
      paths.add(`guideContacts/${key}/sub/${id}`);
    }
  });
  return [...paths];
}

function guideIndexPatch(id, oldContact, newContact){
  const patch = {};
  const before = new Map(guideIndexPaths(id,oldContact).map(path=>[path,oldContact.connectAt || '']));
  const after = new Map(guideIndexPaths(id,newContact).map(path=>[path,newContact.connectAt || '']));
  for(const path of new Set([...before.keys(),...after.keys()])){
    if(before.get(path) !== after.get(path)) patch[path] = after.has(path) ? after.get(path) : null;
  }
  return patch;
}

async function loadContactPage(kind){
  const page = pageState[kind];
  if(!pagedMode || hasFullData('contacts') || page.loading || !page.hasMore) return;
  page.loading = true;
  document.getElementById(kind==='mine'?'contactMore':'allContactMore').disabled = true;
  const generation = pagingGeneration;
  try {
    const mine = kind === 'mine';
    const path = mine ? `guideContacts/${guideIndexKey(currentUser)}/all` : 'contacts';
    const result = await readPage(path, mine ? '$value' : 'connectAt', 'desc', page.cursor, null, null, kind);
    if(generation !== pagingGeneration) return;
    for(const item of result.items){
      if(!mine) contacts[item.key] = item.value;
    }
    await Promise.all(result.items.map(item=>fetchContact(item.key)));
    await Promise.all(result.items.map(item=>fetchRelatedForContact(item.key)));
    if(generation !== pagingGeneration) return;
    page.ids.push(...result.items.map(item=>item.key).filter(id=>contacts[id] && !page.ids.includes(id)));
    page.cursor = result.cursor;
    page.hasMore = result.hasMore;
    page.ready = true;
    loadState.contacts = true;
    renderAll();
    updateLoadingStatus();

  } catch(error){
    if(generation !== pagingGeneration) return;
    console.error('Contact page failed:', error);
    handleDatabaseError(error, '연결자 목록을 불러오지 못했습니다. 다시 시도해주세요.');
  } finally { page.loading = false; pruneDataQueries(); drainPageRefreshes(); document.getElementById(kind==='mine'?'contactMore':'allContactMore').disabled = false; }
}

async function ensureAppointmentData(){
  if(!pagedMode || hasFullData('appointments') || pageState.upcoming.ready || pageState.upcoming.loading) return;
  await loadAppointmentPage('upcoming');
}

async function loadAppointmentPage(kind){
  const page = pageState[kind];
  if(!pagedMode || hasFullData('appointments') || page.loading || !page.hasMore) return;
  page.loading = true;
  const generation = pagingGeneration;
  try {
    const upcoming = kind === 'upcoming';
    const now = new Date();
    const nowKey = minuteKey(now);
    const archiveBound = minuteKey(new Date(now.getTime()-60_000));
    const result = await readPage('appointments','apptAt',upcoming ? 'asc' : 'desc',page.cursor,upcoming ? nowKey : null,upcoming ? null : archiveBound, kind);
    if(generation !== pagingGeneration) return;
    const items = result.items;
    for(const item of items) appointments[item.key] = item.value;
    await Promise.all(items.map(item=>fetchContact(item.value.contactId)));
    if(generation !== pagingGeneration) return;
    page.ids.push(...items.map(item=>item.key).filter(id=>!page.ids.includes(id)));
    page.cursor = result.cursor;
    page.hasMore = result.hasMore;
    page.ready = true;
    loadState.appointments = true;
    renderAppointments(); renderContacts(); renderAllContacts();

  } catch(error){
    if(generation !== pagingGeneration) return;
    console.error('Appointment page failed:', error);
    handleDatabaseError(error, '약속 목록을 불러오지 못했습니다. 다시 시도해주세요.');
  } finally { page.loading = false; pruneDataQueries(); drainPageRefreshes(); }
}

async function ensureArchiveData(){
  if(pagedMode && !hasFullData('appointments') && !pageState.archive.ready) await loadAppointmentPage('archive');
}

async function ensureValidationData(){
  if(!pagedMode || hasFullData('validations') || pageState.validations.ready || pageState.validations.loading) return;
  await loadValidationPage();
}

async function loadValidationPage(){
  const page = pageState.validations;
  if(!pagedMode || hasFullData('validations') || page.loading || !page.hasMore) return;
  page.loading = true;
  const generation = pagingGeneration;
  try {
    const result = await readPage('validationSummaries','latestDate','desc',page.cursor,null,null,'validations');
    if(generation !== pagingGeneration) return;
    await Promise.all(result.items.map(async item=>{
      await fetchContact(item.key);
      await fetchRelatedCollection('validations',item.key);
    }));
    if(generation !== pagingGeneration) return;
    page.ids.push(...result.items.map(item=>item.key).filter(id=>contacts[id] && !page.ids.includes(id)));
    page.cursor = result.cursor;
    page.hasMore = result.hasMore;
    page.ready = true;
    loadState.validations = true;
    renderValidations();

  } catch(error){
    if(generation !== pagingGeneration) return;
    console.error('Validation page failed:', error);
    handleDatabaseError(error, '유효 목록을 불러오지 못했습니다. 다시 시도해주세요.');
  } finally { page.loading = false; pruneDataQueries(); drainPageRefreshes(); }
}

async function loadAppointmentMonth(){
  if(!pagedMode || !document.getElementById('apptCalendarPanel').open) return;
  if(hasFullData('appointments')){ renderAppointments(); return; }
  ensureCalendarState();
  const generation = pagingGeneration;
  const request = ++appointmentMonthRequest;
  const month = `${calYear}-${String(calMonth+1).padStart(2,'0')}`;
  const entry = liveQuery('month:appointments',month,
    db.ref('appointments').orderByChild('apptDate').startAt(month+'-01').endAt(month+'-31'),(snapshot,_initial,resource)=>{
      const entries = snapshotEntries(snapshot);
      const ids = new Set(entries.map(item=>item.key));
      for(const id of calendarApptIds){
        if(!ids.has(id) && appointments[id]?.apptDate?.startsWith(month)) delete appointments[id];
      }
      calendarApptIds = [...ids];
      for(const item of entries) appointments[item.key] = item.value;
      resource.hydration = Promise.all(entries.map(item=>fetchContact(item.value.contactId))).then(()=>{
        if(generation === pagingGeneration && month === `${calYear}-${String(calMonth+1).padStart(2,'0')}`) renderAppointments();
      }).catch(error=>{ if(generation===pagingGeneration) handleDatabaseError(error,'달력 기록을 불러오지 못했습니다.'); });
    });
  try { await entry.promise; await entry.hydration; }
  catch(error){
    if(generation===pagingGeneration && error.code!=='SESSION_CHANGED') handleDatabaseError(error,'달력 기록을 불러오지 못했습니다.');
    return;
  }
  if(generation === pagingGeneration && request === appointmentMonthRequest) renderAppointments();
}

async function loadValidationMonth(){
  if(!pagedMode || !document.getElementById('validationCalendarPanel').open) return;
  if(hasFullData('validations')){ renderValidations(); return; }
  ensureValidationCalendarState();
  const generation = pagingGeneration;
  const request = ++validationMonthRequest;
  const month = `${vCalYear}-${String(vCalMonth+1).padStart(2,'0')}`;
  const entry = liveQuery('month:validations',month,
    db.ref('validationSummaries').orderByChild('firstDate').startAt(month+'-01').endAt(month+'-31'),(snapshot,_initial,resource)=>{
      const entries = snapshotEntries(snapshot);
      calendarValidationIds = entries.map(item=>item.key);
      resource.hydration = Promise.all(entries.map(async item=>{
        await fetchContact(item.key);
        await fetchRelatedCollection('validations',item.key);
      })).then(()=>{
        if(generation===pagingGeneration && month===`${vCalYear}-${String(vCalMonth+1).padStart(2,'0')}`) renderValidations();
      }).catch(error=>{ if(generation===pagingGeneration) handleDatabaseError(error,'달력 기록을 불러오지 못했습니다.'); });
    });
  try { await entry.promise; await entry.hydration; }
  catch(error){
    if(generation===pagingGeneration && error.code!=='SESSION_CHANGED') handleDatabaseError(error,'달력 기록을 불러오지 못했습니다.');
    return;
  }
  if(generation === pagingGeneration && request === validationMonthRequest) renderValidations();
}

async function ensureFullData(kind='contacts'){
  if(!pagedMode || hasFullData(kind)) return;
  const generation = pagingGeneration;
  setAppStatus('전체 검색 데이터를 불러오는 중입니다.', 'progress');
  try {
    const sources = kind==='contacts' ? ['contacts'] : ['contacts',kind];
    await Promise.all(sources.map(readFullCollection));
    if(generation !== pagingGeneration) return;
    if(document.getElementById('appStatus').textContent==='전체 검색 데이터를 불러오는 중입니다.') setAppStatus('');
    renderAll();
  } catch(error){
    if(generation !== pagingGeneration) return;
    handleDatabaseError(error,'전체 검색 데이터를 불러오지 못했습니다.');
  }
}

function needsFullContactData(mine){
  if(!pagedMode) return false;
  const searchId = mine ? 'contactSearch' : 'allContactSearch';
  const relationId = mine ? 'contactRelation' : 'allContactRelation';
  const sortId = mine ? 'contactSort' : 'allContactSort';
  return !!document.getElementById(searchId).value.trim() || document.getElementById(relationId).value !== 'all' || document.getElementById(sortId).value !== 'newest';
}

function maybeLoadFullData(){
  if(!pagedMode) return;
  if(searchLoadTimer) clearTimeout(searchLoadTimer);
  searchLoadTimer = setTimeout(()=>{
    searchLoadTimer = null;
    if(document.getElementById('contactsView').classList.contains('active')){
      const mine = document.getElementById('myContactsBlock').classList.contains('active');
      if(needsFullContactData(mine)) ensureFullData('contacts');
    } else if(document.getElementById('appointmentsView').classList.contains('active')){
      if(document.getElementById('apptSearch').value.trim()) ensureFullData('appointments');
    } else if(document.getElementById('validationsView').classList.contains('active')){
      if(document.getElementById('validationSearch').value.trim()) ensureFullData('validations');
    }
  },200);
}

function observeMoreButtons(){
  if(!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries=>{
    entries.forEach(entry=>{ if(entry.isIntersecting && !entry.target.hidden && !entry.target.disabled) entry.target.click(); });
  }, {rootMargin:'160px'});
  ['contactMore','allContactMore','apptMore','archiveMore','validationMore'].forEach(id=>observer.observe(document.getElementById(id)));
  subscriptions.push({ref:{off(){ observer.disconnect(); }}, callback:null});
}

async function refreshPagedData(kind){
  if(!pagedMode || refreshingKinds.has(kind)) return;
  refreshingKinds.add(kind);
  const generation = pagingGeneration;
  try {
    const group = kind==='contacts' ? ['mine','all'] : kind==='appointments' ? ['upcoming','archive'] : [kind];
    for(const key of group){
      const type = key==='mine' || key==='all' ? 'contacts' : key==='validations' ? 'validations' : 'appointments';
      if(hasFullData(type)) continue;
      if(key==='all' && !pageState.all.ready && !document.getElementById('allContactsBlock').classList.contains('active')) continue;
      if(key==='archive' && !pageState.archive.ready && !archiveOpen) continue;
      if(key==='validations' && !pageState.validations.ready && !document.getElementById('validationsView').classList.contains('active')) continue;
      if(key==='upcoming' && !pageState.upcoming.ready && !document.getElementById('appointmentsView').classList.contains('active')) continue;
      const count = key==='mine' || key==='all' ? contactLimits[key] : key==='upcoming' ? apptLimit : key==='archive' ? archiveLimit : validationLimit;
      pageState[key] = freshPage();
      const load = key==='mine' || key==='all' ? ()=>loadContactPage(key)
        : key==='validations' ? loadValidationPage : ()=>loadAppointmentPage(key);
      await load();
      while(generation===pagingGeneration && pageState[key].hasMore && pageState[key].ids.length<count){
        const before = pageState[key].ids.length;
        await load();
        if(pageState[key].ids.length===before) break;
      }
      if(generation !== pagingGeneration) return;
    }
  } finally { refreshingKinds.delete(kind); drainPageRefreshes(); }
}

function refreshAfterMutation(...kinds){
  if(!pagedMode) return;
  const options = typeof kinds.at(-1)==='object' ? kinds.pop() : {};
  queueDataRender();
  if(options.membershipChanged === false) return;
  for(const kind of new Set(kinds)){
    if(kind==='contacts' && !hasFullData('contacts')){
      queuePageRefresh('mine');
      if(pageState.all.ready) queuePageRefresh('all');
    } else if(kind==='appointments' && !hasFullData('appointments')){
      if(pageState.upcoming.ready) queuePageRefresh('upcoming');
      if(pageState.archive.ready) queuePageRefresh('archive');
    } else if(kind==='validations' && !hasFullData('validations') && pageState.validations.ready){
      queuePageRefresh('validations');
    }
  }
}

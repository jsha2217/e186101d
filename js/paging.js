const PAGE_SIZE = 15;
let pagedMode = false;
let fullDataLoaded = false;
let fullDataPromise = null;
let pagingGeneration = 0;
const pageState = {};
const pageWatchers = {};
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
  fullDataLoaded = false;
  fullDataPromise = null;
  for(const key of ['mine','all','upcoming','archive','validations']) pageState[key] = freshPage();
  Object.keys(pageWatchers).forEach(key=>{ delete pageWatchers[key]; });
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
    if(generation === pagingGeneration && currentUser) setAppStatus('데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.', 'error');
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

function watchFirstPage(kind, query, refreshKind){
  if(pageWatchers[kind]) return;
  let initial = true;
  const callback = ()=>{
    if(initial){ initial = false; return; }
    if(pagedMode && currentUser && !pageState[kind].loading) refreshPagedData(refreshKind);
  };
  query.on('value', callback, error=>{
    console.error(`${kind} live page failed:`,error);
    setAppStatus('실시간 목록을 갱신하지 못했습니다. 새로고침 후 다시 시도해주세요.', 'error');
  });
  subscriptions.push({ref:query, callback});
  pageWatchers[kind] = true;
}

async function readPage(path, field, direction, cursor, lowerBound, upperBound){
  let query = field === '$value' ? db.ref(path).orderByValue() : db.ref(path).orderByChild(field);
  const ascending = direction === 'asc';
  if(cursor) query = ascending ? query.startAt(cursor.value, cursor.key) : query.endAt(cursor.value, cursor.key);
  else if(lowerBound) query = query.startAt(lowerBound);
  else if(upperBound) query = query.endAt(upperBound);
  query = ascending ? query.limitToFirst(PAGE_SIZE + (cursor ? 2 : 1)) : query.limitToLast(PAGE_SIZE + (cursor ? 2 : 1));
  let entries = snapshotEntries(await query.once('value'));
  if(cursor) entries = entries.filter(entry=>entry.key !== cursor.key);
  if(!ascending) entries.reverse();
  const hasMore = entries.length > PAGE_SIZE;
  const items = entries.slice(0,PAGE_SIZE);
  const last = items.at(-1);
  return {items, hasMore, cursor:last ? {key:last.key, value:field==='$value' ? last.value : last.value?.[field] || ''} : cursor};
}

async function fetchContact(id){
  if(contacts[id]) return contacts[id];
  const value = (await db.ref('contacts/'+id).once('value')).val();
  if(value) contacts[id] = value;
  return value;
}

async function fetchRelatedForContact(id){
  const [apptSnap, validationSnap] = await Promise.all([
    db.ref('appointments').orderByChild('contactId').equalTo(id).once('value'),
    db.ref('validations').orderByChild('contactId').equalTo(id).once('value'),
  ]);
  Object.keys(appointments).forEach(key=>{ if(appointments[key].contactId===id) delete appointments[key]; });
  Object.keys(validations).forEach(key=>{ if(validations[key].contactId===id) delete validations[key]; });
  Object.assign(appointments, apptSnap.val() || {});
  Object.assign(validations, validationSnap.val() || {});
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
  guideIndexPaths(id,oldContact).forEach(path=>{ patch[path] = null; });
  guideIndexPaths(id,newContact).forEach(path=>{ patch[path] = newContact.connectAt || ''; });
  return patch;
}

async function loadContactPage(kind){
  const page = pageState[kind];
  if(!pagedMode || page.loading || !page.hasMore) return;
  page.loading = true;
  document.getElementById(kind==='mine'?'contactMore':'allContactMore').disabled = true;
  const generation = pagingGeneration;
  try {
    const mine = kind === 'mine';
    const path = mine ? `guideContacts/${guideIndexKey(currentUser)}/all` : 'contacts';
    const result = await readPage(path, mine ? '$value' : 'connectAt', 'desc', page.cursor);
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
    if(!pageWatchers[kind]){
      const query = mine
        ? db.ref(path).orderByValue().limitToLast(PAGE_SIZE)
        : db.ref(path).orderByChild('connectAt').limitToLast(PAGE_SIZE);
      watchFirstPage(kind,query,'contacts');
    }
  } catch(error){
    console.error('Contact page failed:', error);
    setAppStatus('연결자 목록을 불러오지 못했습니다. 다시 시도해주세요.', 'error');
  } finally { page.loading = false; document.getElementById(kind==='mine'?'contactMore':'allContactMore').disabled = false; }
}

async function ensureAppointmentData(){
  if(!pagedMode || pageState.upcoming.ready || pageState.upcoming.loading) return;
  await loadAppointmentPage('upcoming');
}

async function loadAppointmentPage(kind){
  const page = pageState[kind];
  if(!pagedMode || page.loading || !page.hasMore) return;
  page.loading = true;
  const generation = pagingGeneration;
  try {
    const upcoming = kind === 'upcoming';
    const now = new Date();
    const nowKey = minuteKey(now);
    const archiveBound = minuteKey(new Date(now.getTime()-60_000));
    const result = await readPage('appointments','apptAt',upcoming ? 'asc' : 'desc',page.cursor,upcoming ? nowKey : null,upcoming ? null : archiveBound);
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
    if(upcoming && !pageWatchers.upcoming){
      const query = db.ref('appointments').orderByChild('apptAt').startAt(nowKey).limitToFirst(PAGE_SIZE);
      watchFirstPage('upcoming',query,'appointments');
    }
  } catch(error){
    console.error('Appointment page failed:', error);
    setAppStatus('약속 목록을 불러오지 못했습니다. 다시 시도해주세요.', 'error');
  } finally { page.loading = false; }
}

async function ensureArchiveData(){
  if(pagedMode && !pageState.archive.ready) await loadAppointmentPage('archive');
}

async function ensureValidationData(){
  if(!pagedMode || pageState.validations.ready || pageState.validations.loading) return;
  await loadValidationPage();
}

async function loadValidationPage(){
  const page = pageState.validations;
  if(!pagedMode || page.loading || !page.hasMore) return;
  page.loading = true;
  const generation = pagingGeneration;
  try {
    const result = await readPage('validationSummaries','latestDate','desc',page.cursor);
    if(generation !== pagingGeneration) return;
    await Promise.all(result.items.map(async item=>{
      await fetchContact(item.key);
      await fetchRelatedForContact(item.key);
    }));
    if(generation !== pagingGeneration) return;
    page.ids.push(...result.items.map(item=>item.key).filter(id=>contacts[id] && !page.ids.includes(id)));
    page.cursor = result.cursor;
    page.hasMore = result.hasMore;
    page.ready = true;
    loadState.validations = true;
    renderValidations();
    if(!pageWatchers.validations){
      const query = db.ref('validationSummaries').orderByChild('latestDate').limitToLast(PAGE_SIZE);
      watchFirstPage('validations',query,'validations');
    }
  } catch(error){
    console.error('Validation page failed:', error);
    setAppStatus('유효 목록을 불러오지 못했습니다. 다시 시도해주세요.', 'error');
  } finally { page.loading = false; }
}

async function loadAppointmentMonth(){
  if(!pagedMode || !document.getElementById('apptCalendarPanel').open) return;
  ensureCalendarState();
  const generation = pagingGeneration;
  const request = ++appointmentMonthRequest;
  const month = `${calYear}-${String(calMonth+1).padStart(2,'0')}`;
  const snapshot = await db.ref('appointments').orderByChild('apptDate').startAt(month+'-01').endAt(month+'-31').once('value');
  if(generation !== pagingGeneration || request !== appointmentMonthRequest || month !== `${calYear}-${String(calMonth+1).padStart(2,'0')}`) return;
  const entries = snapshotEntries(snapshot);
  calendarApptIds = entries.map(item=>item.key);
  for(const item of entries) appointments[item.key] = item.value;
  await Promise.all(entries.map(item=>fetchContact(item.value.contactId)));
  if(generation === pagingGeneration && request === appointmentMonthRequest) renderAppointments();
}

async function loadValidationMonth(){
  if(!pagedMode || !document.getElementById('validationCalendarPanel').open) return;
  ensureValidationCalendarState();
  const generation = pagingGeneration;
  const request = ++validationMonthRequest;
  const month = `${vCalYear}-${String(vCalMonth+1).padStart(2,'0')}`;
  const snapshot = await db.ref('validationSummaries').orderByChild('firstDate').startAt(month+'-01').endAt(month+'-31').once('value');
  if(generation !== pagingGeneration || request !== validationMonthRequest || month !== `${vCalYear}-${String(vCalMonth+1).padStart(2,'0')}`) return;
  const entries = snapshotEntries(snapshot);
  calendarValidationIds = entries.map(item=>item.key);
  await Promise.all(entries.map(async item=>{ await fetchContact(item.key); await fetchRelatedForContact(item.key); }));
  if(generation === pagingGeneration && request === validationMonthRequest) renderValidations();
}

async function ensureFullData(){
  if(!pagedMode || fullDataLoaded) return;
  if(fullDataPromise) return fullDataPromise;
  const generation = pagingGeneration;
  setAppStatus('전체 검색 데이터를 불러오는 중입니다.', 'progress');
  fullDataPromise = Promise.all(['contacts','appointments','validations'].map(path=>db.ref(path).once('value'))).then(snapshots=>{
    if(generation !== pagingGeneration) return;
    [contacts,appointments,validations] = snapshots.map(snap=>snap.val() || {});
    fullDataLoaded = true;
    loadState.contacts = loadState.appointments = loadState.validations = true;
    setAppStatus('');
    renderAll();
  }).catch(error=>{
    console.error('Full search failed:', error);
    setAppStatus('전체 검색 데이터를 불러오지 못했습니다.', 'error');
  }).finally(()=>{ fullDataPromise = null; });
  return fullDataPromise;
}

function needsFullContactData(mine){
  if(!pagedMode) return false;
  const searchId = mine ? 'contactSearch' : 'allContactSearch';
  const relationId = mine ? 'contactRelation' : 'allContactRelation';
  const sortId = mine ? 'contactSort' : 'allContactSort';
  return !!document.getElementById(searchId).value.trim() || document.getElementById(relationId).value !== 'all' || document.getElementById(sortId).value !== 'newest';
}

function maybeLoadFullData(){
  if(!pagedMode || fullDataLoaded) return;
  if(needsFullContactData(true) || needsFullContactData(false)
    || document.getElementById('apptSearch').value.trim()
    || document.getElementById('validationSearch').value.trim()) ensureFullData();
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
  try {
    if(fullDataLoaded){
      fullDataLoaded = false;
      await ensureFullData();
      return;
    }
    if(kind==='contacts'){
      const mineCount = contactLimits.mine;
      const allCount = contactLimits.all;
      const allWasLoaded = pageState.all.ready;
      pageState.mine = freshPage(); pageState.all = freshPage();
      contactLimits.mine = contactLimits.all = 15;
      await loadContactPage('mine');
      while(pageState.mine.hasMore && pageState.mine.ids.length < mineCount){
        const before = pageState.mine.ids.length;
        contactLimits.mine += 15;
        await loadContactPage('mine');
        if(pageState.mine.ids.length === before) break;
      }
      if(allWasLoaded || document.getElementById('allContactsBlock').classList.contains('active')){
        await loadContactPage('all');
        while(pageState.all.hasMore && pageState.all.ids.length < allCount){
          const before = pageState.all.ids.length;
          contactLimits.all += 15;
          await loadContactPage('all');
          if(pageState.all.ids.length === before) break;
        }
      }
    } else if(kind==='appointments'){
      const upcomingCount = apptLimit;
      const archiveCount = archiveLimit;
      const archiveWasLoaded = pageState.archive.ready;
      pageState.upcoming = freshPage(); pageState.archive = freshPage();
      apptLimit = archiveLimit = 15;
      await loadAppointmentPage('upcoming');
      while(pageState.upcoming.hasMore && pageState.upcoming.ids.length < upcomingCount){
        const before = pageState.upcoming.ids.length;
        apptLimit += 15;
        await loadAppointmentPage('upcoming');
        if(pageState.upcoming.ids.length === before) break;
      }
      if(archiveWasLoaded || archiveOpen){
        await loadAppointmentPage('archive');
        while(pageState.archive.hasMore && pageState.archive.ids.length < archiveCount){
          const before = pageState.archive.ids.length;
          archiveLimit += 15;
          await loadAppointmentPage('archive');
          if(pageState.archive.ids.length === before) break;
        }
      }
      await loadAppointmentMonth();
    } else if(kind==='validations'){
      const count = validationLimit;
      pageState.validations = freshPage();
      validationLimit = 15;
      await loadValidationPage();
      while(pageState.validations.hasMore && pageState.validations.ids.length < count){
        const before = pageState.validations.ids.length;
        validationLimit += 15;
        await loadValidationPage();
        if(pageState.validations.ids.length === before) break;
      }
      await loadValidationMonth();
    }
  } finally { refreshingKinds.delete(kind); }
}

async function refreshAfterMutation(...kinds){
  if(!pagedMode) return;
  if(fullDataLoaded){
    fullDataLoaded = false;
    await ensureFullData();
    return;
  }
  for(const kind of [...new Set(kinds)]) await refreshPagedData(kind);
}

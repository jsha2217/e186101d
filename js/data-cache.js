// One live query per resource in a login session. Firebase sends later changes as deltas.
const liveQueries = new Map();
const completeCollections = new Set();
const pendingPageRefreshes = new Set();
const contactActivityTargets = new Map();
let renderQueued = false;
let refreshQueued = false;
let searchLoadTimer = null;

function hasFullData(kind='contacts'){
  return completeCollections.has('contacts') && (kind==='contacts' || completeCollections.has(kind));
}

function cachedCollection(kind){ return kind==='contacts' ? contacts : kind==='appointments' ? appointments : validations; }
function replaceCollection(kind, value){
  if(kind==='contacts') contacts = value;
  else if(kind==='appointments') appointments = value;
  else validations = value;
}

function queueDataRender(){
  if(renderQueued) return;
  renderQueued = true;
  const generation = pagingGeneration;
  Promise.resolve().then(()=>{
    if(generation !== pagingGeneration) return;
    renderQueued = false;
    if(currentUser){ renderAll(); pruneDataQueries(); }
  });
}

function releaseLiveQuery(key){
  const entry = liveQueries.get(key);
  if(!entry) return;
  liveQueries.delete(key);
  entry.ref.off('value', entry.callback);
  const index = subscriptions.indexOf(entry.subscription);
  if(index !== -1) subscriptions.splice(index,1);
  if(!entry.ready) entry.reject(Object.assign(new Error('Session or query changed'), {code:'SESSION_CHANGED'}));
}

function liveQuery(key, signature, query, apply){
  let entry = liveQueries.get(key);
  if(entry && entry.signature === signature){ entry.lastUsedAt=Date.now(); return entry; }
  if(entry) releaseLiveQuery(key);
  const generation = pagingGeneration;
  entry = {ref:query,signature,ready:false,snapshot:null,lastUsedAt:Date.now()};
  entry.promise = new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;});
  // Some resources are observed for their live changes without awaiting the initial value.
  entry.promise.catch(()=>{});
  entry.callback = snapshot=>{
    if(generation !== pagingGeneration || liveQueries.get(key) !== entry) return;
    const initial = !entry.ready;
    entry.snapshot = snapshot;
    entry.ready = true;
    apply(snapshot, initial, entry);
    if(initial) entry.resolve(snapshot);
    queueDataRender();
  };
  entry.subscription = {ref:query, callback:entry.callback};
  liveQueries.set(key,entry);
  subscriptions.push(entry.subscription);
  query.on('value',entry.callback,error=>{
    if(generation !== pagingGeneration || liveQueries.get(key) !== entry) return;
    if(!entry.ready) entry.reject(error);
    releaseLiveQuery(key);
    handleDatabaseError(error,'데이터를 불러오지 못했습니다. 다시 시도해주세요.');
  });
  return entry;
}

function resetDataCache(){
  for(const key of [...liveQueries.keys()]) releaseLiveQuery(key);
  completeCollections.clear();
  contactActivityTargets.clear();
  pendingPageRefreshes.clear();
  renderQueued = refreshQueued = false;
  if(searchLoadTimer) clearTimeout(searchLoadTimer);
  searchLoadTimer = null;
}

function pruneDataQueries(){
  if(Object.values(pageState).some(page=>page.loading)) return;
  const activity = new Set([...contactActivityTargets.values()].flatMap(ids=>[...ids]));
  if(!hasFullData('contacts')){
    for(const kind of ['mine','all']) for(const id of pageState[kind].ids) activity.add(id);
  }
  const histories = new Set([...activity,...pageState.validations.ids,...calendarValidationIds]);
  const requiredContacts = new Set(histories);
  for(const id of [...pageState.upcoming.ids,...pageState.archive.ids,...calendarApptIds]){
    if(appointments[id]?.contactId) requiredContacts.add(appointments[id].contactId);
  }
  const selected = document.getElementById('vContactId').value;
  if(selected && document.getElementById('validationModal').classList.contains('show')){
    histories.add(selected); requiredContacts.add(selected);
  }
  const now = Date.now();
  for(const [key,entry] of [...liveQueries]){
    if(!entry.ready || now-entry.lastUsedAt<60000) continue;
    const parts = key.split(':');
    if(parts[0]==='record' && parts[1]==='contacts' && !requiredContacts.has(parts[2])) releaseLiveQuery(key);
    if(parts[0]==='related' && !(parts[1]==='appointments' ? activity : histories).has(parts[2])) releaseLiveQuery(key);
  }
}

async function fetchRelatedCollection(kind, contactId){
  if(completeCollections.has(kind)) return;
  const entry = liveQuery(`related:${kind}:${contactId}`,contactId,
    db.ref(kind).orderByChild('contactId').equalTo(contactId), snapshot=>{
      if(completeCollections.has(kind)) return;
      const records = cachedCollection(kind);
      for(const [id, record] of Object.entries(records)) if(record.contactId===contactId) delete records[id];
      Object.assign(records,snapshot.val() || {});
    });
  await entry.promise;
}

function ensureContactActivities(ids){
  if(!pagedMode) return;
  const generation = pagingGeneration;
  Promise.all(ids.map(id=>fetchRelatedForContact(id))).catch(error=>{
    if(generation === pagingGeneration && currentUser) handleDatabaseError(error,'연결자 기록을 불러오지 못했습니다. 다시 시도해주세요.');
  });
}

async function readFullCollection(kind){
  const entry = liveQuery('full:'+kind,kind,db.ref(kind), snapshot=>{
    replaceCollection(kind,snapshot.val() || {});
    completeCollections.add(kind);
    loadState[kind] = true;
    // A full live collection already covers these narrower subscriptions.
    for(const [key,resource] of [...liveQueries]){
      const redundant = key.startsWith(`record:${kind}:`) || key.startsWith(`related:${kind}:`)
        || (kind==='contacts' && (key==='page:mine' || key==='page:all'))
        || (kind==='appointments' && (key==='page:upcoming' || key==='page:archive' || key==='month:appointments'))
        || (kind==='validations' && (key==='page:validations' || key==='month:validations'));
      if(redundant && resource.ready) releaseLiveQuery(key);
    }
  });
  await entry.promise;
}

function queuePageRefresh(kind){
  pendingPageRefreshes.add(kind);
  drainPageRefreshes();
}

function drainPageRefreshes(){
  if(refreshQueued || !pendingPageRefreshes.size) return;
  refreshQueued = true;
  const generation = pagingGeneration;
  Promise.resolve().then(async()=>{
    if(generation !== pagingGeneration) return;
    refreshQueued = false;
    for(const kind of [...pendingPageRefreshes]){
      if(!pendingPageRefreshes.has(kind)) continue;
      if(pageState[kind]?.loading || refreshingKinds.has(kind)) continue;
      pendingPageRefreshes.delete(kind);
      try { await refreshPagedData(kind); }
      catch(error){
        if(generation === pagingGeneration) handleDatabaseError(error,'목록을 갱신하지 못했습니다. 다시 시도해주세요.');
      }
      if(generation !== pagingGeneration) return;
    }
  });
}

function pageSnapshotEntries(snapshot, direction){
  const entries = snapshotEntries(snapshot);
  if(direction==='desc') entries.reverse();
  return entries;
}

async function firstPageSnapshot(kind, path, field, direction, lowerBound, upperBound){
  let query = field==='$value' ? db.ref(path).orderByValue() : db.ref(path).orderByChild(field);
  if(lowerBound) query = query.startAt(lowerBound);
  if(upperBound) query = query.endAt(upperBound);
  query = direction==='asc' ? query.limitToFirst(PAGE_SIZE+1) : query.limitToLast(PAGE_SIZE+1);
  // Keep a stable lower bound until an upcoming appointment actually expires.
  const signature = JSON.stringify([path,field,direction,lowerBound || '',upperBound || '']);
  const entry = liveQuery('page:'+kind,signature,query,(snapshot,initial,resource)=>{
    const entries = pageSnapshotEntries(snapshot,direction);
    const ids = entries.slice(0,PAGE_SIZE).map(item=>item.key);
    if(path==='contacts' && !completeCollections.has('contacts')){
      for(const item of entries) contacts[item.key] = item.value;
    }
    if(path==='appointments' && !completeCollections.has('appointments')){
      for(const item of entries) appointments[item.key] = item.value;
    }
    if(!initial && resource.headIds){
      const previous = resource.headIds;
      const membershipChanged = previous.length !== ids.length || previous.some(id=>!ids.includes(id));
      if(membershipChanged) queuePageRefresh(kind);
      else if(pageState[kind]?.ready && pageState[kind].ids.length<=PAGE_SIZE){
        pageState[kind].ids = ids;
        pageState[kind].hasMore = entries.length>PAGE_SIZE;
        const last = entries[Math.min(PAGE_SIZE,entries.length)-1];
        pageState[kind].cursor = last ? {key:last.key,value:field==='$value' ? last.value : last.value?.[field] || ''} : null;
      }
    }
    resource.headIds = ids;
  });
  await entry.promise;
  return entry.snapshot;
}

function matchesContact(c, term){
  return matchesSearch([c.name, c.phone, c.org, c.topic, c.mainGuide,
    subGuideDisplay(c), c.connectAt ? c.connectAt.replace('T',' ') : '', c.trait], term);
}

const contactLimits = {mine:15, all:15};

function contactActivitySummary(id){
  const nowKey = todayDateValue() + 'T' + nowTimeValue();
  const nextAppt = Object.values(appointments)
    .filter(a=>a.contactId===id && a.apptDate && a.apptTime && `${a.apptDate}T${a.apptTime}` >= nowKey)
    .sort((a,b)=>`${a.apptDate}T${a.apptTime}`.localeCompare(`${b.apptDate}T${b.apptTime}`))[0];
  const latestValidation = Object.values(validations)
    .filter(v=>v.contactId===id && v.date)
    .sort((a,b)=>b.date.localeCompare(a.date))[0];
  const parts = [];
  if(nextAppt) parts.push(`다음 약속 ${formatDateWithWeekday(`${nextAppt.apptDate}T${nextAppt.apptTime}`)}`);
  if(latestValidation) parts.push(`최근 유효 ${formatDateWithWeekday(latestValidation.date)}`);
  return parts.join(' · ');
}

function renderContactCard(id, index, editable){
  const c = contacts[id];
  const relationship = isMainGuide(c) ? '메인 인도' : (isSubGuide(c) ? '서브 인도' : '전체 연결자');
  const activity = contactActivitySummary(id);
  return `${cardOpen(c, index)}
    <div class="card-summary">
      <strong>${escapeHtml(c.name)}</strong>
      <span class="summary-meta">${escapeHtml(relationship)} · ${escapeHtml(c.org || '소속 없음')} · ${escapeHtml(formatDateWithWeekday(c.connectAt) || '날짜 없음')}</span>
      ${activity ? `<span class="summary-activity">${escapeHtml(activity)}</span>` : ''}
    </div>
    <div class="card-footer"><details class="card-details" data-record-id="${escapeHtml(id)}"><summary>상세 정보 보기</summary><div class="card-inner">${contactFields(c, false)}</div></details>
    ${editable ? `<div class="card-actions">
      <button class="icon-btn edit" data-action="edit-contact" data-id="${escapeHtml(id)}">수정</button>
      <button class="icon-btn delete" data-action="delete-contact" data-id="${escapeHtml(id)}">삭제</button>
    </div>` : ''}</div>
  </div>`;
}

function renderContactList({searchId, listId, emptyId, countId, moreId, relationId, sortId, mine}){
  const term = document.getElementById(searchId).value.trim();
  const list = document.getElementById(listId);
  const emptyEl = document.getElementById(emptyId);
  const countEl = document.getElementById(countId);
  const moreEl = document.getElementById(moreId);
  if(!loadState.contacts){
    list.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.textContent = '연결자를 불러오는 중입니다.';
    countEl.textContent = '';
    moreEl.hidden = true;
    return;
  }
  const needsFull = needsFullContactData(mine);
  if(needsFull && !fullDataLoaded){
    list.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.textContent = '전체 결과를 불러오는 중입니다.';
    countEl.textContent = '';
    moreEl.hidden = true;
    return;
  }
  const sourceIds = pagedMode && !fullDataLoaded ? pageState[mine?'mine':'all'].ids : Object.keys(contacts);
  const allIds = sourceIds.filter(id => contacts[id] && (!mine || isMainGuide(contacts[id]) || isSubGuide(contacts[id])));
  const relation = document.getElementById(relationId).value;
  const ids = allIds.filter(id => {
    const c = contacts[id];
    if(relation==='main' && !isMainGuide(c)) return false;
    if(relation==='sub' && !isSubGuide(c)) return false;
    if(relation==='other' && (isMainGuide(c) || isSubGuide(c))) return false;
    return matchesContact(c,term);
  });
  const sort = document.getElementById(sortId).value;
  if(sort==='name') ids.sort((a,b)=>(contacts[a].name||'').localeCompare(contacts[b].name||'', 'ko'));
  else ids.sort((a,b)=>sort==='oldest'
    ? (contacts[a].connectAt||'').localeCompare(contacts[b].connectAt||'')
    : (contacts[b].connectAt||'').localeCompare(contacts[a].connectAt||''));
  emptyEl.style.display = ids.length ? 'none' : 'block';
  emptyEl.textContent = allIds.length ? '검색 결과가 없습니다.'
    : mine ? '아직 내가 인도자로 등록된 연결자가 없습니다.' : '아직 등록된 연결자가 없습니다.';
  const shown = Math.min(ids.length, contactLimits[mine?'mine':'all']);
  countEl.textContent = pagedMode && !fullDataLoaded ? `${shown}건 불러옴` : `총 ${ids.length}건 · ${shown}건 표시`;
  setListHtml(list, ids.slice(0,shown).map((id,i)=>renderContactCard(id,i,mine)).join(''));
  moreEl.hidden = pagedMode && !fullDataLoaded ? !pageState[mine?'mine':'all'].hasMore : shown >= ids.length;
}

function renderContacts(){
  renderContactList({searchId:'contactSearch', listId:'contactList', emptyId:'contactEmpty', countId:'contactCount', moreId:'contactMore', relationId:'contactRelation', sortId:'contactSort', mine:true});
}

function renderAllContacts(){
  renderContactList({searchId:'allContactSearch', listId:'allContactList', emptyId:'allContactEmpty', countId:'allContactCount', moreId:'allContactMore', relationId:'allContactRelation', sortId:'allContactSort', mine:false});
}

function resetContactPage(mine){
  contactLimits[mine?'mine':'all'] = 15;
  (mine ? renderContacts : renderAllContacts)();
}

function moreContacts(mine){
  if(pagedMode && !fullDataLoaded){
    if(pageState[mine?'mine':'all'].loading) return;
    contactLimits[mine?'mine':'all'] += 15;
    loadContactPage(mine?'mine':'all');
    return;
  }
  contactLimits[mine?'mine':'all'] += 15;
  (mine ? renderContacts : renderAllContacts)();
}

function addSubGuideRow(value){
  const list = document.getElementById('cSubGuideList');
  const row = document.createElement('div');
  row.className = 'subguide-row';
  row.innerHTML = `<input type="text" class="subguide-input" value="${escapeHtml(value)}"><button type="button" class="icon-btn delete" data-action="remove-sub-guide" aria-label="서브 인도자 삭제">✕</button>`;
  list.appendChild(row);
}
function renderSubGuideRows(values){
  const list = document.getElementById('cSubGuideList');
  list.innerHTML = '';
  (values.length ? values : ['']).forEach(v => addSubGuideRow(v));
}
function getSubGuideValues(){
  return Array.from(document.querySelectorAll('#cSubGuideList .subguide-input')).map(i=>i.value.trim()).filter(Boolean);
}

function openContactModal(id){
  document.getElementById('contactId').value = id || '';
  if(id){
    const c = contacts[id];
    document.getElementById('contactModalTitle').textContent = '연결자 수정';
    document.getElementById('cName').value = c.name || '';
    document.getElementById('cPhone').value = c.phone || '';
    document.getElementById('cOrg').value = c.org || '';
    document.getElementById('cTopic').value = c.topic || '';
    document.getElementById('cMainGuide').value = c.mainGuide || '';
    renderSubGuideRows(subGuideArray(c));
    const [connDate, connTime] = (c.connectAt || '').split('T');
    document.getElementById('cConnectDate').value = connDate || '';
    document.getElementById('cConnectTime').value = connTime || '';
    document.getElementById('cTrait').value = c.trait || '';
  } else {
    document.getElementById('contactModalTitle').textContent = '연결자 등록';
    document.getElementById('cName').value = '';
    document.getElementById('cPhone').value = '';
    document.getElementById('cOrg').value = '';
    document.getElementById('cTopic').value = '';
    document.getElementById('cMainGuide').value = currentUser || '';
    renderSubGuideRows([]);
    document.getElementById('cConnectDate').value = todayDateValue();
    document.getElementById('cConnectTime').value = nowTimeValue();
    document.getElementById('cTrait').value = '';
  }
  openModal('contactModal');
  autosize(document.getElementById('cTrait'));
}
function closeContactModal(){ closeModal('contactModal'); }

async function saveContact(){
  const name = document.getElementById('cName').value.trim();
  if(!name){ showFieldError('contactModal',document.getElementById('cName'),'이름을 입력해주세요.'); return; }
  const mainGuide = document.getElementById('cMainGuide').value.trim();
  if(!mainGuide){ showFieldError('contactModal',document.getElementById('cMainGuide'),'메인 인도자를 입력해주세요.'); return; }
  const connectDate = document.getElementById('cConnectDate').value;
  if(!connectDate){ showFieldError('contactModal',document.getElementById('cConnectDate'),'연결 날짜를 선택해주세요.'); return; }
  const id = document.getElementById('contactId').value;
  const data = {
    name,
    phone: document.getElementById('cPhone').value.trim(),
    org: document.getElementById('cOrg').value.trim(),
    topic: document.getElementById('cTopic').value.trim(),
    mainGuide,
    subGuide: getSubGuideValues(),
    connectAt: [connectDate, document.getElementById('cConnectTime').value].filter(Boolean).join('T'),
    trait: document.getElementById('cTrait').value.trim(),
    updatedBy: currentUser,
    updatedAt: Date.now(),
  };
  if(!id){
    data.createdBy = currentUser;
    data.baptism = 0;
  }
  const contactId = id || db.ref('contacts').push().key;
  const updatedContact = id ? {...contacts[id], ...data} : data;
  const updates = {['contacts/'+contactId]: updatedContact,
    ...guideIndexPatch(contactId, id ? contacts[id] : null, updatedContact)};
  await writeData(()=>db.ref().update(updates), ()=>{
    closeModal('contactModal', true);
    contacts[contactId] = updatedContact;
    if(pagedMode) refreshAfterMutation('contacts');
  });
}

async function deleteContact(id){
  if(!contacts[id]) return;
  let apptIds, validationIds;
  if(pagedMode){
    const [apptSnap, validationSnap] = await Promise.all([
      db.ref('appointments').orderByChild('contactId').equalTo(id).once('value'),
      db.ref('validations').orderByChild('contactId').equalTo(id).once('value'),
    ]);
    apptIds = Object.keys(apptSnap.val() || {});
    validationIds = Object.keys(validationSnap.val() || {});
  } else {
    apptIds = Object.keys(appointments).filter(aid=>appointments[aid].contactId===id);
    validationIds = Object.keys(validations).filter(vid=>validations[vid].contactId===id);
  }
  if(!confirm(`${contacts[id].name} 연결자를 삭제할까요? 약속 ${apptIds.length}건과 유효 기록 ${validationIds.length}건도 함께 삭제됩니다.`)) return;
  const updates = {['contacts/'+id]: null, ['validationSummaries/'+id]:null,
    ...guideIndexPatch(id, contacts[id], null)};
  apptIds.forEach(aid=>{ updates['appointments/'+aid] = null; });
  validationIds.forEach(vid=>{ updates['validations/'+vid] = null; });
  await writeData(()=>db.ref().update(updates), ()=>{
    delete contacts[id];
    apptIds.forEach(aid=>{ delete appointments[aid]; });
    validationIds.forEach(vid=>{ delete validations[vid]; });
    if(pagedMode) refreshAfterMutation('contacts','appointments','validations');
  }, '삭제');
}

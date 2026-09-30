let archiveOpen = false;
let apptLimit = 15;
let archiveLimit = 15;

function resetApptPage(){ apptLimit = 15; archiveLimit = 15; renderAppointments(); }
function moreAppts(){
  if(pagedMode && !fullDataLoaded){
    if(pageState.upcoming.loading) return;
    apptLimit += 15; loadAppointmentPage('upcoming'); return;
  }
  apptLimit += 15; renderAppointments();
}
function moreArchive(){
  if(pagedMode && !fullDataLoaded){
    if(pageState.archive.loading) return;
    archiveLimit += 15; loadAppointmentPage('archive'); return;
  }
  archiveLimit += 15; renderAppointments();
}

function toggleArchive(){
  archiveOpen = !archiveOpen;
  document.getElementById('archiveList').style.display = archiveOpen ? 'block' : 'none';
  if(archiveOpen) ensureArchiveData();
  renderAppointments();
}

function ensureCalendarState(){
  if(calYear === undefined){
    const d = new Date();
    calYear = d.getFullYear();
    calMonth = d.getMonth();
  }
}

function colorForString(str){
  const s = String(str || '');
  let hash = 0;
  for(let i=0;i<s.length;i++){ hash = s.charCodeAt(i) + ((hash<<5)-hash); hash |= 0; }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 42%)`;
}

const CAL_MAX_CHIPS = 2;

function renderCalendar(idsForDots){
  ensureCalendarState();
  const y = calYear, m = calMonth;
  const startDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const todayStr = todayDateValue();

  const contactsByDate = {};
  idsForDots.forEach(id=>{
    const a = appointments[id];
    if(!a || !a.apptDate) return;
    const c = contacts[a.contactId];
    if(!c) return;
    if(!contactsByDate[a.apptDate]) contactsByDate[a.apptDate] = new Map();
    if(!contactsByDate[a.apptDate].has(a.contactId)) contactsByDate[a.apptDate].set(a.contactId, c.name);
  });

  let cells = '';
  for(let i=0;i<startDow;i++) cells += `<div class="cal-cell empty"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayContacts = contactsByDate[dateStr] ? Array.from(contactsByDate[dateStr].values()) : [];
    const classes = ['cal-cell'];
    if(dateStr === todayStr) classes.push('today');
    if(dayContacts.length) classes.push('has-appt');
    const shown = dayContacts.slice(0, CAL_MAX_CHIPS);
    const extra = dayContacts.length - shown.length;
    const chips = shown.map(name => `<span class="cal-chip" style="background:${colorForString(name)}">${escapeHtml(name)}</span>`).join('')
      + (extra > 0 ? `<span class="cal-more">+${extra}</span>` : '');
    cells += dayContacts.length
      ? `<button type="button" class="${classes.join(' ')}" data-action="appt-day" data-date="${dateStr}" aria-label="${dateStr} 약속 ${dayContacts.length}명 보기"><span class="cal-day">${d}</span><span class="cal-chips">${chips}</span></button>`
      : `<div class="cal-cell empty-day"><span class="cal-day">${d}</span></div>`;
  }

  document.getElementById('calGrid').innerHTML = cells;
  document.getElementById('calLabel').textContent = `${y}년 ${m+1}월`;
}

function calPrevMonth(){
  ensureCalendarState();
  calMonth--;
  if(calMonth < 0){ calMonth = 11; calYear--; }
  calendarApptIds = [];
  renderAppointments();
  loadAppointmentMonth();
}
function calNextMonth(){
  ensureCalendarState();
  calMonth++;
  if(calMonth > 11){ calMonth = 0; calYear++; }
  calendarApptIds = [];
  renderAppointments();
  loadAppointmentMonth();
}
function calToday(){
  const d = new Date();
  calYear = d.getFullYear();
  calMonth = d.getMonth();
  calendarApptIds = [];
  renderAppointments();
  loadAppointmentMonth();
}

function renderDayModal(dateStr){
  const dayIds = Object.keys(appointments)
    .filter(id => contacts[appointments[id].contactId] && appointments[id].apptDate === dateStr)
    .sort((a,b)=> (appointments[a].apptTime||'').localeCompare(appointments[b].apptTime||''));
  document.getElementById('dayModalTitle').textContent = formatDateWithWeekday(dateStr) + ' 약속';
  setListHtml(document.getElementById('dayModalList'), dayIds.length
    ? dayIds.map((id,i)=>renderCard(id,i,urgencyInfo(appointments[id]))).join('')
    : `<div class="empty">이 날짜에 등록된 약속이 없습니다.</div>`);
  document.getElementById('dayModal').dataset.date = dateStr;
}
function openDayModal(dateStr){ renderDayModal(dateStr); openModal('dayModal'); }
function closeDayModal(){ closeModal('dayModal'); }

function renderCard(id, i, urgency){
  const a = appointments[id];
  const c = contacts[a.contactId] || {};
  const urgencyClass = urgency ? ` urgency-${urgency.tier}` : '';
  const badge = urgency ? `<div class="urgency-badge ${urgency.tier}">${urgency.label}</div>` : '';
  return `${cardOpen(c, i, urgencyClass)}
    ${badge}
    <div class="card-summary">
      <strong>${escapeHtml(c.name || '연결자 없음')}</strong>
      <span class="summary-meta">${escapeHtml(formatDateWithWeekday([a.apptDate, a.apptTime].filter(Boolean).join('T')) || '날짜 미정')} · ${escapeHtml(c.org || '소속 없음')}</span>
      ${a.memo ? `<span class="summary-note">${escapeHtml(a.memo)}</span>` : ''}
    </div>
    <div class="card-footer"><details class="card-details" data-record-id="${escapeHtml(id)}"><summary>상세 정보 보기</summary><div class="card-inner">
      ${contactFields(c, false)}
      ${fieldRow('약속 날짜', formatDateWithWeekday([a.apptDate, a.apptTime].filter(Boolean).join('T')), true)}
      ${fieldRow('메모', a.memo)}
    </div></details>
    <div class="card-actions">
      <button class="icon-btn edit" data-action="edit-appt" data-id="${escapeHtml(id)}">수정</button>
      <button class="icon-btn delete" data-action="delete-appt" data-id="${escapeHtml(id)}">삭제</button>
    </div></div>
  </div>`;
}

function renderAppointments(){
  const term = document.getElementById('apptSearch').value.trim();
  const apptEmptyEl = document.getElementById('apptEmpty');
  const archiveBtn = document.getElementById('archiveToggle');
  if(!loadState.contacts || !loadState.appointments){
    document.getElementById('apptList').innerHTML = '';
    document.getElementById('archiveList').innerHTML = '';
    document.getElementById('apptCount').textContent = '';
    apptEmptyEl.style.display = 'block';
    apptEmptyEl.textContent = '약속을 불러오는 중입니다.';
    archiveBtn.style.display = 'none';
    document.getElementById('apptMore').hidden = true;
    document.getElementById('archiveMore').hidden = true;
    return;
  }
  const nowKey = todayDateValue() + 'T' + nowTimeValue();
  const sourceIds = pagedMode && !fullDataLoaded
    ? [...pageState.upcoming.ids, ...pageState.archive.ids]
    : Object.keys(appointments);
  const allIds = sourceIds.filter(id => appointments[id] && contacts[appointments[id].contactId]);
  const ids = allIds.filter(id=>{
    const a = appointments[id];
    const c = contacts[a.contactId];
    return matchesSearch([c.name, c.phone, c.org, c.topic, c.mainGuide, subGuideDisplay(c), c.connectAt ? c.connectAt.replace('T',' ') : '', c.trait, a.apptDate, a.apptTime, a.memo], term);
  });

  const calendarIds = pagedMode && !fullDataLoaded
    ? calendarApptIds.filter(id=>appointments[id] && contacts[appointments[id].contactId] && (!term || matchesSearch([contacts[appointments[id].contactId].name,appointments[id].memo],term)))
    : ids;
  renderCalendar(calendarIds);

  const upcoming = [];
  const past = [];
  ids.forEach(id=>{
    const a = appointments[id];
    const key = (a.apptDate || '9999-99-99') + 'T' + (a.apptTime || '00:00');
    (key >= nowKey ? upcoming : past).push({id, key});
  });
  upcoming.sort((x,y)=> x.key.localeCompare(y.key));
  past.sort((x,y)=> y.key.localeCompare(x.key));

  apptEmptyEl.style.display = upcoming.length ? 'none' : 'block';
  apptEmptyEl.textContent = !allIds.length ? (pagedMode ? '현재 예정된 약속이 없습니다.' : '아직 등록된 약속이 없습니다.')
    : past.length ? '예정된 약속은 없습니다. 아래 보관함에서 지난 약속을 확인하세요.'
    : term ? '검색 결과가 없습니다.' : '예정된 약속이 없습니다.';
  const shownUpcoming = Math.min(upcoming.length, apptLimit);
  document.getElementById('apptCount').textContent = pagedMode && !fullDataLoaded
    ? `예정 ${upcoming.length}건 불러옴` : `예정 ${upcoming.length}건 · 지난 약속 ${past.length}건`;
  setListHtml(document.getElementById('apptList'), upcoming.slice(0,shownUpcoming).map((x,i)=>renderCard(x.id,i,urgencyInfo(appointments[x.id]))).join(''));
  document.getElementById('apptMore').hidden = pagedMode && !fullDataLoaded ? !pageState.upcoming.hasMore : shownUpcoming >= upcoming.length;

  if(past.length || (pagedMode && !fullDataLoaded && !pageState.archive.ready)){
    archiveBtn.style.display = 'block';
    archiveBtn.textContent = (archiveOpen ? '▲ ' : '▼ ') + (pagedMode && !fullDataLoaded ? `지난 약속 보관함${pageState.archive.ready ? ` (${past.length}건 불러옴)` : ''}` : `지난 약속 보관함 (${past.length})`);
  } else {
    archiveBtn.style.display = 'none';
  }
  document.getElementById('archiveList').style.display = archiveOpen ? 'block' : 'none';
  const shownPast = Math.min(past.length, archiveLimit);
  setListHtml(document.getElementById('archiveList'), archiveOpen ? past.slice(0,shownPast).map((x,i)=>renderCard(x.id,i)).join('') : '');
  document.getElementById('archiveMore').hidden = !archiveOpen || (pagedMode && !fullDataLoaded ? !pageState.archive.hasMore : shownPast >= past.length);
}

function urgencyInfo(a){
  const target = new Date(`${a.apptDate}T${a.apptTime || '00:00'}`);
  const diffMs = target - new Date();
  if(diffMs < 0) return null;
  const mins = diffMs / 60000;
  if(mins < 60) return { tier:'critical', label:`${Math.max(1, Math.round(mins))}분 후` };
  const hours = mins / 60;
  if(hours < 24) return { tier:'soon', label:`${Math.round(hours)}시간 후` };
  const days = hours / 24;
  if(days < 3) return { tier:'upcoming', label:`${Math.round(days)}일 후` };
  return null;
}

function contactOptionLabel(c){
  const guides = [c.mainGuide, ...subGuideArray(c)].filter(Boolean);
  return guides.length ? `${c.name} - ${guides.join(', ')}` : c.name;
}

function populateContactSelect(selectedId, filterTerm=''){
  const sel = document.getElementById('aContactId');
  const term = filterTerm.trim().toLowerCase();
  const ids = Object.keys(contacts).filter(id =>
    (isMainGuide(contacts[id]) || isSubGuide(contacts[id]) || id === selectedId)
    && (!term || contactOptionLabel(contacts[id]).toLowerCase().includes(term) || id === selectedId)
  ).sort((a,b)=>contactOptionLabel(contacts[a]).localeCompare(contactOptionLabel(contacts[b]),'ko'));
  const placeholder = `<option value="" ${selectedId?'':'selected'}>연결자를 선택해주세요</option>`;
  sel.innerHTML = placeholder + ids.map(id=>`<option value="${escapeHtml(id)}" ${id===selectedId?'selected':''}>${escapeHtml(contactOptionLabel(contacts[id]))}</option>`).join('');
}

function openApptModal(id){
  document.getElementById('aContactFilter').value = '';
  populateContactSelect(id ? appointments[id].contactId : null);
  document.getElementById('apptId').value = id || '';
  if(id){
    const a = appointments[id];
    document.getElementById('apptModalTitle').textContent = '약속 수정';
    document.getElementById('aDate').value = a.apptDate || '';
    document.getElementById('aTime').value = a.apptTime || '';
    document.getElementById('aMemo').value = a.memo || '';
  } else {
    document.getElementById('apptModalTitle').textContent = '약속 등록';
    document.getElementById('aDate').value = todayDateValue();
    document.getElementById('aTime').value = nowTimeValue();
    document.getElementById('aMemo').value = '';
  }
  openModal('apptModal');
  autosize(document.getElementById('aMemo'));
}
function closeApptModal(){ closeModal('apptModal'); }

async function saveAppt(){
  const contactId = document.getElementById('aContactId').value;
  if(!contactId || !contacts[contactId]){ showFieldError('apptModal',document.getElementById('aContactId'),'연결자를 선택해주세요.'); return; }
  const apptDate = document.getElementById('aDate').value;
  if(!apptDate){ showFieldError('apptModal',document.getElementById('aDate'),'약속 날짜를 선택해주세요.'); return; }
  const apptTime = document.getElementById('aTime').value;
  if(!apptTime){ showFieldError('apptModal',document.getElementById('aTime'),'약속 시간을 선택해주세요.'); return; }
  const id = document.getElementById('apptId').value;
  const data = {
    contactId,
    apptDate,
    apptTime,
    apptAt: `${apptDate}T${apptTime}`,
    memo: document.getElementById('aMemo').value.trim(),
    updatedBy: currentUser,
    updatedAt: Date.now(),
  };
  if(id){
    await writeData(()=>db.ref('appointments/'+id).update(data), ()=>{
      closeModal('apptModal', true);
      if(pagedMode) refreshAfterMutation('appointments','contacts');
    });
  } else {
    data.createdBy = currentUser;
    await writeData(()=>db.ref('appointments').push().set(data), ()=>{
      closeModal('apptModal', true);
      if(pagedMode) refreshAfterMutation('appointments','contacts');
    });
  }
}

async function deleteAppt(id){
  const a = appointments[id];
  if(!a) return;
  const name = contacts[a.contactId]?.name || '연결자';
  if(confirm(`${name}의 ${a.apptDate || '날짜 미정'} 약속을 삭제할까요?`)) await writeData(()=>db.ref('appointments/'+id).remove(), ()=>{
    delete appointments[id];
    if(pagedMode) refreshAfterMutation('appointments','contacts');
  }, '삭제');
}

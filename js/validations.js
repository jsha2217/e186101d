function validationIdsForContact(contactId){
  return Object.keys(validations).filter(id => validations[id].contactId === contactId);
}
function sortedValidationRounds(contactId){
  return validationIdsForContact(contactId)
    .slice()
    .sort((a,b)=> (validations[a].date||'').localeCompare(validations[b].date||'') || a.localeCompare(b));
}
function latestValidationDate(contactId){
  const ids = sortedValidationRounds(contactId);
  return ids.length ? (validations[ids[ids.length-1]].date || '') : '';
}

// 2차(=최초 유효)가 달성된 날짜와, 3차 이상까지 진행됐는지 여부. 2차가 아직 없으면 null.
function validationAnchorInfo(contactId){
  const roundIds = sortedValidationRounds(contactId);
  if(!roundIds.length) return null;
  return { date: validations[roundIds[0]].date || '', advanced: roundIds.length >= 2 };
}

function renderValidationCard(id, i){
  const c = contacts[id];
  const canRegister = isMainGuide(c) || isSubGuide(c);
  const roundIds = sortedValidationRounds(id);
  const rounds = [{ date: c.connectAt, topic: c.topic }, ...roundIds.map(rid=>({ date: validations[rid].date, topic: validations[rid].topic }))];
  const historyHtml = rounds.map((r, idx)=>{
    const color = ROUND_COLORS[Math.min(idx, ROUND_COLORS.length - 1)];
    return `
      <div class="validation-item">
        <div class="validation-round"><span class="validation-dot" style="background:${color}"></span>${idx+1}차</div>
        <div class="validation-meta">
          <div class="validation-date">${escapeHtml(formatDateWithWeekday(r.date))}</div>
          <div class="validation-topic">${escapeHtml(r.topic)}</div>
        </div>
      </div>`;
  }).join('');
  const latestDate = roundIds.length ? validations[roundIds.at(-1)].date : '';
  return `${cardOpen(c, i)}
      <div class="card-summary">
        <strong>${escapeHtml(c.name)}</strong>
        <span class="summary-meta">${roundIds.length+1}차까지 기록 · 최근 ${escapeHtml(formatDateWithWeekday(latestDate) || '날짜 미정')} · ${escapeHtml(c.org || '소속 없음')}</span>
      </div>
      <div class="card-footer"><details class="card-details" data-record-id="${escapeHtml(id)}"><summary>회차 및 상세 보기</summary><div class="card-inner">
        ${fieldRow('전화번호', c.phone, true)}
        ${fieldRow('소속', c.org)}
        ${fieldRow('메인 인도자', c.mainGuide)}
        ${fieldRow('서브 인도자', subGuideDisplay(c))}
        <div class="validation-list">${historyHtml}</div>
      </div></details>
      ${canRegister ? `<div class="card-actions">
        <button class="icon-btn edit" data-action="edit-validation" data-id="${escapeHtml(id)}">수정</button>
        <button class="icon-btn delete" data-action="delete-validation" data-id="${escapeHtml(id)}">삭제</button>
      </div>` : ''}</div>
    </div>`;
}

let validationLimit = 15;
function resetValidationPage(){ validationLimit = 15; renderValidations(); }
function moreValidations(){
  if(pagedMode && !fullDataLoaded){
    if(pageState.validations.loading) return;
    validationLimit += 15; loadValidationPage(); return;
  }
  validationLimit += 15; renderValidations();
}

function renderValidations(){
  const term = document.getElementById('validationSearch').value.trim();
  const list = document.getElementById('validationList');
  const emptyEl = document.getElementById('validationEmpty');
  if(!loadState.contacts || !loadState.validations){
    list.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.textContent = '유효 기록을 불러오는 중입니다.';
    document.getElementById('validationCount').textContent = '';
    document.getElementById('validationMore').hidden = true;
    return;
  }
  const sourceIds = pagedMode && !fullDataLoaded ? pageState.validations.ids : Object.keys(contacts);
  const registeredIds = sourceIds.filter(id => contacts[id] && sortedValidationRounds(id).length > 0);
  const ids = registeredIds.filter(id=>{
    const c = contacts[id];
    const roundIds = sortedValidationRounds(id);
    const historyText = roundIds.map(rid=>`${validations[rid].date||''} ${validations[rid].topic||''}`).join(' ');
    return matchesSearch([c.name, c.phone, c.org, c.topic, c.mainGuide, subGuideDisplay(c), historyText], term);
  }).sort((a,b)=> latestValidationDate(b).localeCompare(latestValidationDate(a)));

  renderValidationCalendar(pagedMode && !fullDataLoaded ? calendarValidationIds : ids);

  emptyEl.style.display = ids.length ? 'none' : 'block';
  emptyEl.textContent = registeredIds.length ? '검색 결과가 없습니다.' : '아직 유효가 등록된 연결자가 없습니다.';

  const shown = Math.min(ids.length,validationLimit);
  document.getElementById('validationCount').textContent = pagedMode && !fullDataLoaded ? `${shown}명 불러옴` : `총 ${ids.length}명 · ${shown}명 표시`;
  setListHtml(list, ids.slice(0,shown).map((id,i)=>renderValidationCard(id,i)).join(''));
  document.getElementById('validationMore').hidden = pagedMode && !fullDataLoaded ? !pageState.validations.hasMore : shown >= ids.length;
}

let vCalYear, vCalMonth;
const CAL_MAX_ICONS = 4;

function ensureValidationCalendarState(){
  if(vCalYear === undefined){
    const d = new Date();
    vCalYear = d.getFullYear();
    vCalMonth = d.getMonth();
  }
}

function smileyIcon(color){
  return `<svg class="v-smiley" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="${color}"/><circle cx="8.5" cy="10" r="1.6" fill="#2a2a2a"/><circle cx="15.5" cy="10" r="1.6" fill="#2a2a2a"/><path d="M7.5 14.5 Q12 18.5 16.5 14.5" stroke="#2a2a2a" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`;
}

function renderValidationCalendar(idsForIcons){
  ensureValidationCalendarState();
  const y = vCalYear, m = vCalMonth;
  const startDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const todayStr = todayDateValue();

  const colorsByDate = {};
  idsForIcons.forEach(id=>{
    const info = validationAnchorInfo(id);
    if(!info || !info.date) return;
    if(!colorsByDate[info.date]) colorsByDate[info.date] = [];
    colorsByDate[info.date].push(info.advanced ? '#2ecc71' : '#f1c40f');
  });

  let cells = '';
  for(let i=0;i<startDow;i++) cells += `<div class="cal-cell empty"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayColors = colorsByDate[dateStr] || [];
    const classes = ['cal-cell'];
    if(dateStr === todayStr) classes.push('today');
    if(dayColors.length) classes.push('has-appt');
    const shown = dayColors.slice(0, CAL_MAX_ICONS);
    const extra = dayColors.length - shown.length;
    const icons = shown.map(c=>smileyIcon(c)).join('')
      + (extra > 0 ? `<span class="cal-more">+${extra}</span>` : '');
    cells += dayColors.length
      ? `<button type="button" class="${classes.join(' ')}" data-action="validation-day" data-date="${dateStr}" aria-label="${dateStr} 유효 ${dayColors.length}명 보기"><span class="cal-day">${d}</span><span class="v-cal-smileys">${icons}</span></button>`
      : `<div class="cal-cell empty-day"><span class="cal-day">${d}</span></div>`;
  }

  document.getElementById('vCalGrid').innerHTML = cells;
  document.getElementById('vCalLabel').textContent = `${y}년 ${m+1}월`;
}

function vCalPrevMonth(){
  ensureValidationCalendarState();
  vCalMonth--;
  if(vCalMonth < 0){ vCalMonth = 11; vCalYear--; }
  calendarValidationIds = [];
  renderValidations();
  loadValidationMonth();
}
function vCalNextMonth(){
  ensureValidationCalendarState();
  vCalMonth++;
  if(vCalMonth > 11){ vCalMonth = 0; vCalYear++; }
  calendarValidationIds = [];
  renderValidations();
  loadValidationMonth();
}
function vCalToday(){
  const d = new Date();
  vCalYear = d.getFullYear();
  vCalMonth = d.getMonth();
  calendarValidationIds = [];
  renderValidations();
  loadValidationMonth();
}

function renderValidationDayModal(dateStr){
  const ids = Object.keys(contacts).filter(id=>{
    const info = validationAnchorInfo(id);
    return info && info.date === dateStr;
  });
  document.getElementById('vDayModalTitle').textContent = formatDateWithWeekday(dateStr) + ' 유효 (2차 달성)';
  setListHtml(document.getElementById('vDayModalList'), ids.length
    ? ids.map((id,i)=>renderValidationCard(id,i)).join('')
    : `<div class="empty">이 날짜에 2차가 달성된 연결자가 없습니다.</div>`);
  document.getElementById('vDayModal').dataset.date = dateStr;
}
function openValidationDayModal(dateStr){ renderValidationDayModal(dateStr); openModal('vDayModal'); }
function closeValidationDayModal(){ closeModal('vDayModal'); }

function populateValidationContactSelect(selectedId, filterTerm=''){
  const sel = document.getElementById('vContactId');
  const term = filterTerm.trim().toLowerCase();
  const ids = Object.keys(contacts).filter(id =>
    (isMainGuide(contacts[id]) || isSubGuide(contacts[id]) || id === selectedId)
    && (!term || contactOptionLabel(contacts[id]).toLowerCase().includes(term) || id === selectedId)
  ).sort((a,b)=>contactOptionLabel(contacts[a]).localeCompare(contactOptionLabel(contacts[b]),'ko'));
  const placeholder = `<option value="" ${selectedId?'':'selected'}>연결자를 선택해주세요</option>`;
  sel.innerHTML = placeholder + ids.map(id=>`<option value="${escapeHtml(id)}" ${id===selectedId?'selected':''}>${escapeHtml(contactOptionLabel(contacts[id]))}</option>`).join('');
}

function addValidationRoundRow(date, topic, id){
  const list = document.getElementById('vRoundList');
  const row = document.createElement('div');
  row.className = 'vround-row';
  row.dataset.vid = id || '';
  row.innerHTML = `<span class="vround-num"></span><input type="date" class="vround-date" value="${escapeHtml(date||'')}"><input type="text" class="vround-topic" placeholder="진행한 공부주제" value="${escapeHtml(topic||'')}"><button type="button" class="icon-btn delete" data-action="remove-round" aria-label="회차 삭제">✕</button>`;
  list.appendChild(row);
  renumberValidationRounds();
}
function renumberValidationRounds(){
  document.querySelectorAll('#vRoundList .vround-row').forEach((row, idx)=>{
    const color = ROUND_COLORS[Math.min(idx + 1, ROUND_COLORS.length - 1)];
    const numEl = row.querySelector('.vround-num');
    numEl.textContent = `${idx+2}차`;
    numEl.style.color = color;
    row.querySelector('.vround-date').setAttribute('aria-label',`${idx+2}차 미팅 날짜`);
    row.querySelector('.vround-topic').setAttribute('aria-label',`${idx+2}차 공부주제`);
    row.querySelector('button').setAttribute('aria-label',`${idx+2}차 삭제`);
  });
}
function renderValidationRoundRows(rows){
  const list = document.getElementById('vRoundList');
  list.innerHTML = '';
  (rows.length ? rows : [{date: todayDateValue(), topic:'', id:''}]).forEach(r => addValidationRoundRow(r.date, r.topic, r.id));
}
function getValidationRoundValues(){
  const rows = [];
  document.querySelectorAll('#vRoundList .vround-row').forEach(rowEl=>{
    const date = rowEl.querySelector('.vround-date').value;
    const topic = rowEl.querySelector('.vround-topic').value.trim();
    if(date || topic) rows.push({ id: rowEl.dataset.vid || '', date, topic });
  });
  return rows;
}

function updateValidationRoundHint(){
  const contactId = document.getElementById('vContactId').value;
  const hintEl = document.getElementById('validationRoundHint');
  if(!contactId){ hintEl.textContent = ''; return; }
  const rowCount = document.querySelectorAll('#vRoundList .vround-row').length;
  hintEl.textContent = rowCount ? `2차부터 ${rowCount+1}차까지 기록합니다. 첫 만남은 연결 날짜와 공부주제를 사용합니다.` : '모든 회차를 삭제하려면 카드의 삭제 버튼을 사용하세요.';
}

let activeValidationContactId = '';
let validationRowsBaseline = '';
let validationRoundsRequest = 0;
let validationRoundsLoadFailed = false;

function validationRowsSnapshot(){
  return JSON.stringify(Array.from(document.querySelectorAll('#vRoundList .vround-row')).map(row=>[
    row.dataset.vid, row.querySelector('.vround-date').value, row.querySelector('.vround-topic').value,
  ]));
}

async function loadValidationRoundsForContact(force=false){
  const contactId = document.getElementById('vContactId').value;
  if(!force && contactId!==activeValidationContactId && validationRowsSnapshot()!==validationRowsBaseline){
    if(!confirm('작성 중인 회차 변경사항을 버리고 다른 연결자를 선택할까요?')){
      document.getElementById('vContactId').value = activeValidationContactId;
      return;
    }
  }
  const request = ++validationRoundsRequest;
  activeValidationContactId = contactId;
  validationRoundsLoading = false;
  validationRoundsLoadFailed = false;
  document.querySelector('[data-action="save-validation"]').disabled = false;
  if(pagedMode && contactId){
    validationRoundsLoading = true;
    document.getElementById('vRoundList').innerHTML = '';
    document.getElementById('validationRoundHint').textContent = '회차를 불러오는 중입니다.';
    document.querySelector('[data-action="save-validation"]').disabled = true;
    try {
      const snapshot = await db.ref('validations').orderByChild('contactId').equalTo(contactId).once('value');
      if(request !== validationRoundsRequest || contactId !== activeValidationContactId) return;
      Object.keys(validations).forEach(id=>{ if(validations[id].contactId===contactId) delete validations[id]; });
      Object.assign(validations, snapshot.val() || {});
    } catch(error){
      if(request !== validationRoundsRequest) return;
      console.error('Validation rounds failed:', error);
      validationRoundsLoadFailed = true;
      setModalError('validationModal','회차를 불러오지 못했습니다. 다시 열어주세요.');
      return;
    } finally {
      if(request === validationRoundsRequest){
        validationRoundsLoading = false;
        document.querySelector('[data-action="save-validation"]').disabled = validationRoundsLoadFailed;
      }
    }
  }
  if(request !== validationRoundsRequest) return;
  if(!contactId){
    document.getElementById('vRoundList').innerHTML = '';
    updateValidationRoundHint();
  } else {
    const roundIds = sortedValidationRounds(contactId);
    renderValidationRoundRows(roundIds.map(rid=>({ id: rid, date: validations[rid].date||'', topic: validations[rid].topic||'' })));
    updateValidationRoundHint();
  }
  validationRowsBaseline = validationRowsSnapshot();
  if(document.getElementById('validationModal').classList.contains('show')) formBaselines.set('validationModal',modalSnapshot('validationModal'));
}

function openValidationModal(presetContactId){
  document.getElementById('validationModalTitle').textContent = '유효 등록/수정';
  document.getElementById('vContactFilter').value = '';
  populateValidationContactSelect(presetContactId);
  loadValidationRoundsForContact(true);
  openModal('validationModal');
}
function closeValidationModal(){ closeModal('validationModal'); }

async function saveValidation(){
  if(validationRoundsLoading){ setModalError('validationModal','회차를 불러오는 중입니다. 잠시 후 다시 시도해주세요.'); return; }
  if(validationRoundsLoadFailed){ setModalError('validationModal','회차를 불러오지 못했습니다. 창을 다시 열어주세요.'); return; }
  const contactId = document.getElementById('vContactId').value;
  if(!contactId || !contacts[contactId]){ showFieldError('validationModal',document.getElementById('vContactId'),'연결자를 선택해주세요.'); return; }
  for(const row of document.querySelectorAll('#vRoundList .vround-row')){
    if(row.querySelector('.vround-topic').value.trim() && !row.querySelector('.vround-date').value){
      showFieldError('validationModal',row.querySelector('.vround-date'),'회차 날짜를 선택해주세요.');
      return;
    }
  }
  const rows = getValidationRoundValues();
  const existingIds = sortedValidationRounds(contactId);
  if(!rows.length){
    setModalError('validationModal', existingIds.length
      ? '전체 삭제는 카드의 삭제 버튼을 사용해주세요.'
      : '최소 한 회차의 날짜를 입력해주세요.');
    return;
  }
  if(rows.some(r=>r.id && !existingIds.includes(r.id))){
    setModalError('validationModal','유효 기록이 변경되었습니다. 창을 다시 열어 확인해주세요.');
    return;
  }
  const keptIds = new Set(rows.map(r=>r.id).filter(Boolean));
  const removedIds = existingIds.filter(id=>!keptIds.has(id));
  if(removedIds.length && !confirm(`${contacts[contactId].name}의 회차 ${removedIds.length}건을 삭제하고 저장할까요?`)) return;
  const updates = {};
  removedIds.forEach(id=>{ updates['validations/'+id] = null; });
  const now = Date.now();
  rows.forEach(r=>{
    const id = r.id || db.ref('validations').push().key;
    updates['validations/'+id] = {
      ...(r.id ? validations[id] : {createdBy:currentUser}),
      contactId, date:r.date, topic:r.topic, updatedBy:currentUser, updatedAt:now,
    };
  });
  const dates = rows.map(row=>row.date).filter(Boolean).sort();
  updates['validationSummaries/'+contactId] = {firstDate:dates[0], latestDate:dates.at(-1), count:rows.length};
  await writeData(()=>db.ref().update(updates), ()=>{
    closeModal('validationModal', true);
    if(pagedMode) refreshAfterMutation('validations','contacts');
  });
}

async function deleteAllValidations(contactId){
  if(pagedMode){
    const snapshot = await db.ref('validations').orderByChild('contactId').equalTo(contactId).once('value');
    Object.keys(validations).forEach(id=>{ if(validations[id].contactId===contactId) delete validations[id]; });
    Object.assign(validations, snapshot.val() || {});
  }
  const count = sortedValidationRounds(contactId).length;
  if(!count || !confirm(`${contacts[contactId]?.name || '이 연결자'}의 유효 기록 ${count}건을 모두 삭제할까요?`)) return;
  const updates = {['validationSummaries/'+contactId]:null};
  sortedValidationRounds(contactId).forEach(id=>{ updates['validations/'+id] = null; });
  await writeData(()=>db.ref().update(updates), ()=>{
    sortedValidationRounds(contactId).forEach(id=>{ delete validations[id]; });
    if(pagedMode) refreshAfterMutation('validations','contacts');
  }, '삭제');
}

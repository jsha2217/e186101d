const CORRECT_HASH = "03b0bd366e8184f8d871c3a7c7cc26c73c25b54ff54c64b28b10b898242cdc8a";
async function sha256(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

let currentUser = null;
const AUTH_STORAGE_KEY = 'connectorAuthUser';

async function login(){
  const name = document.getElementById('nameInput').value.trim();
  const pw = document.getElementById('pwInput').value;
  const hash = pw ? await sha256(pw) : '';
  if(!name || hash !== CORRECT_HASH){
    document.getElementById('pwError').style.display = 'block';
    return;
  }
  localStorage.setItem(AUTH_STORAGE_KEY, name);
  enterApp(name);
}

function enterApp(name){
  currentUser = name;
  document.getElementById('pwError').style.display = 'none';
  document.getElementById('lockScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('greeting').textContent = `복 많이 받으세요, ${currentUser}님`;
  initApp();
  renderAll();
}

function logout(){
  closeAllModals();
  stopApp();
  currentUser = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  document.getElementById('app').style.display = 'none';
  document.getElementById('lockScreen').style.display = 'flex';
  document.getElementById('nameInput').value = '';
  document.getElementById('pwInput').value = '';
}

document.getElementById('pwInput').addEventListener('keydown', e=>{ if(e.key==='Enter') login(); });

function autosize(el){
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
document.querySelectorAll('textarea.autosize').forEach(el=>{
  el.addEventListener('input', ()=>autosize(el));
});

const firebaseConfig = {
  apiKey: "AIzaSyAORfe5ZENEL-zjX7ZHtFofYapAQZjKydw",
  authDomain: "paw-hello-sy.firebaseapp.com",
  databaseURL: "https://paw-hello-sy-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "paw-hello-sy",
};

let db, contacts = {}, appointments = {}, validations = {};
let appInitialized = false;
let calYear, calMonth;
let appointmentTimer = null;
const subscriptions = [];
const loadState = {contacts:false, appointments:false, validations:false};
let writePending = false;
let statusTimeout = null;

function renderAll(){
  renderContacts();
  renderAllContacts();
  renderAppointments();
  renderValidations();
  refreshOpenDayModals();
}

function initApp(){
  if(appInitialized) return;
  if(!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  appInitialized = true;
  Object.keys(loadState).forEach(key=>{ loadState[key] = false; });
  setAppStatus('데이터를 불러오는 중입니다.');

  initializePagedData();

  appointmentTimer = setInterval(()=>{
    renderAppointments();
    if(pagedMode && pageState.upcoming.ready && pageState.upcoming.ids.some(id=>appointments[id]?.apptAt < todayDateValue()+'T'+nowTimeValue())) refreshPagedData('appointments');
  }, 30000);
}

function updateLoadingStatus(){
  if(loadState.contacts && document.getElementById('appStatus').textContent==='데이터를 불러오는 중입니다.') setAppStatus('');
}

function subscribeLegacyData(){
  subscribe('contacts', value=>{ contacts = value; loadState.contacts = true; renderAll(); updateLoadingStatus(); });
  subscribe('appointments', value=>{ appointments = value; loadState.appointments = true; renderContacts(); renderAllContacts(); renderAppointments(); refreshOpenDayModals(); updateLoadingStatus(); });
  subscribe('validations', value=>{ validations = value; loadState.validations = true; renderContacts(); renderAllContacts(); renderValidations(); refreshOpenDayModals(); updateLoadingStatus(); });
}

function setAppStatus(message, type='info'){
  if(statusTimeout) clearTimeout(statusTimeout);
  statusTimeout = null;
  const el = document.getElementById('appStatus');
  el.textContent = message;
  el.classList.toggle('error', type === 'error');
  el.classList.toggle('success', type === 'success');
  el.classList.toggle('progress', type === 'progress');
  if(type==='success') statusTimeout = setTimeout(()=>{ el.textContent = ''; statusTimeout = null; },4000);
}

function subscribe(path, onValue){
  const ref = db.ref(path);
  const callback = snap=>{ if(currentUser) onValue(snap.val() || {}); };
  const onError = error=>{ console.error(`Firebase ${path}:`, error); setAppStatus('데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.', 'error'); };
  ref.on('value', callback, onError);
  subscriptions.push({ref, callback});
}

function stopApp(){
  subscriptions.forEach(({ref, callback})=>ref.off('value', callback));
  subscriptions.length = 0;
  if(appointmentTimer) clearInterval(appointmentTimer);
  appointmentTimer = null;
  appInitialized = false;
  contacts = {};
  appointments = {};
  validations = {};
  resetPagedData();
  setAppStatus('');
}

async function writeData(operation, onSuccess, label='저장'){
  if(writePending) return false;
  writePending = true;
  document.querySelectorAll('[data-action^="save-"]').forEach(button=>{ button.disabled = true; });
  setAppStatus(`${label} 중입니다.`, 'progress');
  try {
    await operation();
    if(onSuccess) onSuccess();
    setAppStatus(`${label}했습니다.`, 'success');
    return true;
  } catch(error) {
    console.error('Firebase write failed:', error);
    const message = '요청을 완료하지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.';
    setAppStatus(message, 'error');
    const top = modalStack.at(-1);
    if(top) setModalError(top.id, message);
    return false;
  } finally {
    writePending = false;
    document.querySelectorAll('[data-action^="save-"]').forEach(button=>{ button.disabled = false; });
  }
}

const modalStack = [];
const formBaselines = new Map();
const formModalIds = new Set(['contactModal','apptModal','validationModal']);
let fieldErrorCounter = 0;

function modalSnapshot(id){
  const modal = document.getElementById(id);
  return JSON.stringify(Array.from(modal.querySelectorAll('input, select, textarea'))
    .filter(el=>!el.dataset.contactFilter).map(el=>[el.value, el.dataset.vid || '']));
}

function setModalError(id, message){
  const el = document.getElementById(id+'Error');
  if(!el) return;
  el.textContent = message;
  el.hidden = !message;
}

function showFieldError(modalId, field, message){
  clearFieldError(field);
  const error = document.createElement('span');
  error.id = `fieldError${++fieldErrorCounter}`;
  error.className = 'field-error';
  error.textContent = message;
  field.after(error);
  field.setAttribute('aria-invalid','true');
  field.setAttribute('aria-describedby',error.id);
  setModalError(modalId, '입력 내용을 확인해주세요.');
  field.focus();
}

function clearFieldError(field){
  if(!field || !field.getAttribute) return;
  const errorId = field.getAttribute('aria-describedby');
  if(errorId && errorId.startsWith('fieldError')) document.getElementById(errorId)?.remove();
  field.removeAttribute('aria-invalid');
  field.removeAttribute('aria-describedby');
}

function clearModalErrors(id){
  const modal = document.getElementById(id);
  modal.querySelectorAll('[aria-invalid="true"]').forEach(clearFieldError);
  setModalError(id, '');
}

function openModal(id){
  const modal = document.getElementById(id);
  if(modalStack.some(entry=>entry.id===id)) return;
  if(modalStack.length) document.getElementById(modalStack.at(-1).id).inert = true;
  modalStack.push({id, previousFocus:document.activeElement});
  modal.style.zIndex = String(60 + modalStack.length*10);
  modal.classList.add('show');
  document.body.classList.add('modal-open');
  document.getElementById('app').inert = true;
  clearModalErrors(id);
  if(formModalIds.has(id)) formBaselines.set(id, modalSnapshot(id));
  modal.querySelector('h3')?.focus();
}

function closeModal(id, force=false){
  const index = modalStack.findIndex(entry=>entry.id===id);
  if(index < 0){ document.getElementById(id).classList.remove('show'); return true; }
  if(!force && formModalIds.has(id) && modalSnapshot(id)!==formBaselines.get(id)){
    if(!confirm('작성 중인 변경사항을 버릴까요?')) return false;
  }
  const [entry] = modalStack.splice(index,1);
  const modal = document.getElementById(id);
  modal.classList.remove('show');
  modal.style.zIndex = '';
  modal.inert = false;
  formBaselines.delete(id);
  if(modalStack.length){
    const top = document.getElementById(modalStack.at(-1).id);
    top.inert = false;
    if(entry.previousFocus?.isConnected) entry.previousFocus.focus();
    else top.querySelector('h3')?.focus();
  } else {
    document.body.classList.remove('modal-open');
    document.getElementById('app').inert = false;
    if(entry.previousFocus?.isConnected) entry.previousFocus.focus();
  }
  return true;
}

function closeAllModals(){
  while(modalStack.length) closeModal(modalStack.at(-1).id, true);
}

document.addEventListener('keydown', event=>{
  if(!modalStack.length) return;
  const top = document.getElementById(modalStack.at(-1).id);
  if(event.key==='Escape'){
    event.preventDefault();
    closeModal(top.id);
    return;
  }
  if(event.key!=='Tab') return;
  const focusable = Array.from(top.querySelectorAll('button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary'));
  if(!focusable.length) return;
  const first = focusable[0], last = focusable.at(-1);
  if(event.shiftKey && (document.activeElement===first || document.activeElement===top.querySelector('h3'))){ event.preventDefault(); last.focus(); }
  else if(!event.shiftKey && document.activeElement===last){ event.preventDefault(); first.focus(); }
});

document.addEventListener('click', event=>{
  if(event.target.classList?.contains('modal-backdrop')) closeModal(event.target.id);
});
document.addEventListener('input', event=>clearFieldError(event.target));
document.addEventListener('change', event=>clearFieldError(event.target));

function refreshOpenDayModals(){
  const day = document.getElementById('dayModal');
  const validationDay = document.getElementById('vDayModal');
  if(day.classList.contains('show') && day.dataset.date) renderDayModal(day.dataset.date);
  if(validationDay.classList.contains('show') && validationDay.dataset.date) renderValidationDayModal(validationDay.dataset.date);
}

function switchView(v){
  document.getElementById('contactsView').classList.toggle('active', v==='contacts');
  document.getElementById('appointmentsView').classList.toggle('active', v==='appointments');
  document.getElementById('validationsView').classList.toggle('active', v==='validations');
  document.getElementById('tabContacts').classList.toggle('active', v==='contacts');
  document.getElementById('tabAppt').classList.toggle('active', v==='appointments');
  document.getElementById('tabValidations').classList.toggle('active', v==='validations');
  [['contacts','tabContacts'],['appointments','tabAppt'],['validations','tabValidations']].forEach(([name,id])=>{
    const tab = document.getElementById(id);
    if(v === name) tab.setAttribute('aria-current','page');
    else tab.removeAttribute('aria-current');
  });
  if(typeof window !== 'undefined') window.scrollTo(0,0);
  if(pagedMode && v==='appointments') ensureAppointmentData();
  if(pagedMode && v==='validations') ensureValidationData();
}

function switchContactSubView(v){
  document.getElementById('myContactsBlock').classList.toggle('active', v==='mine');
  document.getElementById('allContactsBlock').classList.toggle('active', v==='all');
  document.getElementById('subTabMine').classList.toggle('active', v==='mine');
  document.getElementById('subTabAll').classList.toggle('active', v==='all');
  document.getElementById('subTabMine').setAttribute('aria-pressed', String(v==='mine'));
  document.getElementById('subTabAll').setAttribute('aria-pressed', String(v==='all'));
  if(typeof window !== 'undefined') window.scrollTo(0,0);
  if(pagedMode && v==='all' && !pageState.all.ready) loadContactPage('all');
}

function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

function todayDateValue(){
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
}
function nowTimeValue(){
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(11,16);
}

const WEEKDAYS_KO = ['일','월','화','수','목','금','토'];
function formatDateWithWeekday(value){
  if(!value) return '';
  const [datePart, timePart] = value.split('T');
  if(!datePart) return '';
  const d = new Date(datePart + 'T00:00:00');
  if(isNaN(d.getTime())) return timePart ? `${datePart} ${timePart}` : datePart;
  const weekday = WEEKDAYS_KO[d.getDay()];
  return timePart ? `${datePart}(${weekday}) ${timePart}` : `${datePart}(${weekday})`;
}

const tabColors = ['var(--tab)','var(--tab-2)','var(--tab-3)','var(--tab-4)'];
const ROUND_COLORS = ['#e74c3c','#f1c40f','#2ecc71'];

function matchesSearch(fields, term){
  if(!term) return true;
  return fields.filter(Boolean).join(' ').toLowerCase().includes(term.toLowerCase());
}

function isMainGuide(c){ return !!currentUser && (c.mainGuide||'').trim().toLowerCase() === currentUser.trim().toLowerCase(); }
function subGuideArray(c){
  if(Array.isArray(c.subGuide)) return c.subGuide.filter(Boolean);
  if(c.subGuide) return c.subGuide.split(',').map(s=>s.trim()).filter(Boolean);
  return [];
}
function subGuideDisplay(c){ return subGuideArray(c).join(', '); }
function isSubGuide(c){
  if(!currentUser) return false;
  const me = (currentUser||'').trim().toLowerCase();
  return subGuideArray(c).some(s => s.trim().toLowerCase() === me);
}

function sortByConnectAt(ids){
  return ids.slice().sort((a,b)=> (contacts[b].connectAt||'').localeCompare(contacts[a].connectAt||''));
}

function baptizedClass(c){ return c && c.baptism === 1 ? ' baptized' : ''; }
function baptizedDelayStyle(c, i){ return c && c.baptism === 1 ? ` style="animation-delay:${(i%5)*0.35}s"` : ''; }
function baptizedBadge(c){
  if(!c || c.baptism !== 1) return '';
  return `<div class="baptized-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.8 7.6c-.2-1.3-1.2-2.4-2.5-2.6.1 1.4 1.1 2.5 2.4 2.7.03-.03.07-.07.1-.1Z"/><path d="M17.8 12.4c0-2.4-1.9-3.9-3.8-3.9-1 0-1.6.4-2 .4s-1-.4-2-.4c-1.9 0-3.9 1.5-3.9 4 0 3 2.1 7.3 4.4 7.3.7 0 1-.3 1.5-.3s.8.3 1.5.3c2.2 0 4.3-4 4.3-7.4Z"/></svg>침례</div>`;
}

function fieldRow(label, value, mono=false){
  return value ? `<div class="field-row"><div class="field-label">${label}</div><div class="field-val ${mono?'mono':''}">${escapeHtml(value)}</div></div>` : '';
}

function guideClass(c){
  return isMainGuide(c) ? ' guide-main' : (isSubGuide(c) ? ' guide-sub' : '');
}

function cardOpen(c, index, extraClass=''){
  return `<div class="card${guideClass(c)}${baptizedClass(c)}${extraClass}"${baptizedDelayStyle(c,index)}>
    <div class="tab" style="background:${tabColors[index%tabColors.length]}"></div>
    ${baptizedBadge(c)} `;
}

function setListHtml(list, html){
  const openIds = new Set(Array.from(list.querySelectorAll('details[data-record-id][open]')).map(el=>el.dataset.recordId));
  list.innerHTML = html;
  list.querySelectorAll('details[data-record-id]').forEach(el=>{ if(openIds.has(el.dataset.recordId)) el.open = true; });
}

function contactFields(c, includeName=true){
  return (includeName ? fieldRow('이름', c.name) : '') + fieldRow('전화번호', c.phone, true)
    + fieldRow('소속', c.org) + fieldRow('공부주제', c.topic)
    + fieldRow('메인 인도자', c.mainGuide) + fieldRow('서브 인도자', subGuideDisplay(c))
    + fieldRow('연결 날짜', formatDateWithWeekday(c.connectAt), true) + fieldRow('특징', c.trait);
}

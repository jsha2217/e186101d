const clickActions = {
  login, logout,
  'new-contact': ()=>openContactModal(),
  'mine-contacts': ()=>switchContactSubView('mine'),
  'all-contacts': ()=>switchContactSubView('all'),
  'new-appt': ()=>openApptModal(),
  'appt-prev': calPrevMonth,
  'appt-next': calNextMonth,
  'appt-today': calToday,
  'toggle-archive': toggleArchive,
  'more-contacts': ()=>moreContacts(true),
  'more-all-contacts': ()=>moreContacts(false),
  'more-appts': moreAppts,
  'more-archive': moreArchive,
  'more-validations': moreValidations,
  'new-validation': ()=>openValidationModal(null),
  'validation-prev': vCalPrevMonth,
  'validation-next': vCalNextMonth,
  'validation-today': vCalToday,
  'view-contacts': ()=>switchView('contacts'),
  'view-appointments': ()=>switchView('appointments'),
  'view-validations': ()=>switchView('validations'),
  'add-sub-guide': ()=>addSubGuideRow(''),
  'close-contact': closeContactModal,
  'save-contact': saveContact,
  'close-appt': closeApptModal,
  'save-appt': saveAppt,
  'add-round': ()=>{ addValidationRoundRow(todayDateValue(),''); updateValidationRoundHint(); },
  'close-validation': closeValidationModal,
  'save-validation': saveValidation,
  'close-day': closeDayModal,
  'close-validation-day': closeValidationDayModal,
  'edit-contact': el=>openContactModal(el.dataset.id),
  'delete-contact': el=>deleteContact(el.dataset.id),
  'edit-appt': el=>openApptModal(el.dataset.id),
  'delete-appt': el=>deleteAppt(el.dataset.id),
  'edit-validation': el=>openValidationModal(el.dataset.id),
  'delete-validation': el=>deleteAllValidations(el.dataset.id),
  'appt-day': el=>openDayModal(el.dataset.date),
  'validation-day': el=>openValidationDayModal(el.dataset.date),
  'remove-sub-guide': el=>el.parentElement.remove(),
  'remove-round': el=>{ el.parentElement.remove(); renumberValidationRounds(); updateValidationRoundHint(); },
};

document.addEventListener('click', event=>{
  const el = event.target.closest('[data-action]');
  if(el && clickActions[el.dataset.action]) clickActions[el.dataset.action](el);
});

const renderActions = {
  contacts: ()=>resetContactPage(true),
  'all-contacts': ()=>resetContactPage(false),
  appointments: resetApptPage,
  validations: resetValidationPage,
};
document.addEventListener('input', event=>{
  const action = event.target.dataset.render;
  if(action && renderActions[action]) renderActions[action]();
  if(action) maybeLoadFullData();
  const filter = event.target.dataset.contactFilter;
  if(filter==='appt'){
    populateContactSelect(document.getElementById('aContactId').value, event.target.value);
    if(pagedMode && !fullDataLoaded && event.target.value.trim()) ensureFullData().then(()=>populateContactSelect(document.getElementById('aContactId').value, event.target.value));
  }
  if(filter==='validation'){
    populateValidationContactSelect(document.getElementById('vContactId').value, event.target.value);
    if(pagedMode && !fullDataLoaded && event.target.value.trim()) ensureFullData().then(()=>populateValidationContactSelect(document.getElementById('vContactId').value, event.target.value));
  }
});
document.addEventListener('change', event=>{
  if(event.target.dataset.change === 'validation-contact') loadValidationRoundsForContact();
  const filter = event.target.dataset.filter;
  if(filter && renderActions[filter]){ renderActions[filter](); maybeLoadFullData(); }
});
document.getElementById('apptCalendarPanel').addEventListener('toggle', event=>{ if(event.target.open) loadAppointmentMonth(); });
document.getElementById('validationCalendarPanel').addEventListener('toggle', event=>{ if(event.target.open) loadValidationMonth(); });

if(typeof history !== 'undefined' && 'scrollRestoration' in history) history.scrollRestoration = 'manual';
if(typeof window !== 'undefined') window.addEventListener('load',()=>window.scrollTo(0,0),{once:true});
const savedUser = localStorage.getItem(AUTH_STORAGE_KEY);
if(savedUser) enterApp(savedUser);

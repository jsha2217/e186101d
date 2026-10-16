// The shared password is verified by Firebase Authentication, never by browser code.
// Names remain freely chosen display/filter values; the team's database identity is shared.
const TEAM_AUTH_EMAIL = 'connector-team@paw-hello-sy.invalid';
const TEAM_AUTH_UID = 'connector-team';
let teamSessionReady = false;
let loginPending = false;
let authGeneration = 0;

function initializeFirebase(){
  if(!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  return firebase.auth();
}

function showLoginError(message){
  const error = document.getElementById('pwError');
  error.textContent = message;
  error.style.display = 'block';
}

function lockApp(){
  teamSessionReady = false;
  closeAllModals();
  stopApp();
  currentUser = null;
  // Remove previously viewed records and form values from the hidden DOM as well.
  for(const id of ['contactList','allContactList','apptList','archiveList','validationList',
    'dayModalList','vDayModalList','calGrid','vCalGrid','cSubGuideList','vRoundList','aContactId','vContactId']){
    document.getElementById(id).innerHTML = '';
  }
  document.querySelectorAll('.modal input, .modal textarea').forEach(field=>{ field.value = ''; });
  formBaselines.clear();
  document.getElementById('app').style.display = 'none';
  document.getElementById('lockScreen').style.display = 'flex';
}

async function acceptTeamSession(user, name, generation){
  const {claims} = await user.getIdTokenResult();
  if(generation !== authGeneration) return false;
  if(user.uid !== TEAM_AUTH_UID || claims.firebase?.sign_in_provider !== 'password'){
    throw new Error('invalid-team-session');
  }
  if(!name) return false;
  teamSessionReady = true;
  localStorage.setItem(AUTH_STORAGE_KEY, name);
  document.getElementById('pwInput').value = '';
  if(currentUser !== name){
    if(currentUser) stopApp();
    enterApp(name);
  }
  return true;
}

async function login(){
  if(loginPending) return;
  const name = document.getElementById('nameInput').value.trim();
  const password = document.getElementById('pwInput').value;
  if(!name || !password){ showLoginError('이름과 비밀번호를 확인해주세요'); return; }
  loginPending = true;
  const generation = ++authGeneration;
  const buttons = document.querySelectorAll('[data-action="login"]');
  buttons.forEach(button=>{ button.disabled = true; button.textContent = '확인 중…'; });
  document.getElementById('pwError').style.display = 'none';
  try {
    const auth = initializeFirebase();
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    if(generation !== authGeneration) return;
    const {user} = await auth.signInWithEmailAndPassword(TEAM_AUTH_EMAIL, password);
    if(generation !== authGeneration){ await auth.signOut(); return; }
    await acceptTeamSession(user, name, generation);
  } catch(error){
    if(generation !== authGeneration) return;
    lockApp();
    const credentialsErrors = new Set(['auth/wrong-password', 'auth/invalid-credential',
      'auth/invalid-login-credentials', 'auth/user-not-found', 'auth/invalid-email']);
    showLoginError(credentialsErrors.has(error.code) ? '이름과 비밀번호를 확인해주세요'
      : error.code === 'auth/too-many-requests' ? '로그인 시도가 많습니다. 잠시 후 다시 시도해주세요.'
      : '로그인에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.');
  } finally {
    loginPending = false;
    buttons.forEach(button=>{ button.disabled = false; button.textContent = '입장'; });
  }
}

async function logout(){
  ++authGeneration;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  lockApp();
  document.getElementById('nameInput').value = '';
  document.getElementById('pwInput').value = '';
  try { await initializeFirebase().signOut(); }
  catch { showLoginError('로그아웃 연결을 완료하지 못했습니다. 다시 시도해주세요.'); }
}

function handleDatabaseError(error, message){
  if(String(error.code || '').toLowerCase().replaceAll('_','-') === 'permission-denied'){
    ++authGeneration;
    const name = currentUser || localStorage.getItem(AUTH_STORAGE_KEY) || '';
    lockApp();
    document.getElementById('nameInput').value = name;
    initializeFirebase().signOut().catch(()=>{});
    showLoginError('로그인이 만료되었습니다. 비밀번호를 다시 입력해주세요.');
    return;
  }
  setAppStatus(message, 'error');
}

function startAuthentication(){
  document.getElementById('nameInput').value = localStorage.getItem(AUTH_STORAGE_KEY) || '';
  try {
    const auth = initializeFirebase();
    auth.onAuthStateChanged(async user=>{
      // A manual login verifies its own result, including logouts that interrupt it.
      if(loginPending) return;
      const generation = ++authGeneration;
      if(!user){ lockApp(); return; }
      try { await acceptTeamSession(user, localStorage.getItem(AUTH_STORAGE_KEY), generation); }
      catch {
        if(generation !== authGeneration) return;
        lockApp();
        showLoginError('로그인이 만료되었습니다. 비밀번호를 다시 입력해주세요.');
      }
    }, ()=>{ lockApp(); showLoginError('로그인에 연결하지 못했습니다. 새로고침 후 다시 시도해주세요.'); });
  } catch {
    lockApp();
    showLoginError('로그인 기능을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.');
  }
}

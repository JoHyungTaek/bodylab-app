import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

/* ---------- Supabase & Auth ---------- */
const sb = window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);

let currentUser = null;
let accessToken = null;
let isSignupMode = false;

const authSection = document.getElementById('authSection');
const appRoot = document.getElementById('appRoot');
const userbar = document.getElementById('userbar');
const userNickname = document.getElementById('userNickname');
const logoutBtn = document.getElementById('logoutBtn');
const tabNav = document.getElementById('tabNav');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = {
  measure: document.getElementById('tab-measure'),
  journal: document.getElementById('tab-journal'),
  mypage: document.getElementById('tab-mypage'),
  library: document.getElementById('tab-library')
};
const mypageEmail = document.getElementById('mypageEmail');
const mypageNickname = document.getElementById('mypageNickname');
const mypageNicknameSave = document.getElementById('mypageNicknameSave');
const mypageProfileMsg = document.getElementById('mypageProfileMsg');
const statMeasureCount = document.getElementById('statMeasureCount');
const statStreak = document.getElementById('statStreak');
const statTotalDays = document.getElementById('statTotalDays');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');
const statCoachUsage = document.getElementById('statCoachUsage');
const COACH_DAILY_LIMIT = 20;

function switchTab(name){
  Object.entries(tabPanels).forEach(([key, el]) => el.classList.toggle('hidden', key !== name));
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'mypage') renderMyPageStats();
}
tabButtons.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

const authTitle = document.getElementById('authTitle');
const authSub = document.getElementById('authSub');
const nicknameField = document.getElementById('nicknameField');
const authNickname = document.getElementById('authNickname');
const termsField = document.getElementById('termsField');
const authTerms = document.getElementById('authTerms');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authError = document.getElementById('authError');
const authSwitchText = document.getElementById('authSwitchText');
const authSwitchLink = document.getElementById('authSwitchLink');

function setAuthMode(signup){
  isSignupMode = signup;
  authTitle.textContent = signup ? '회원가입' : '로그인';
  authSub.textContent = signup ? '이메일과 비밀번호로 새 계정을 만들어요.' : '계정으로 로그인하면 측정 기록과 운동 기록장이 저장돼요.';
  nicknameField.style.display = signup ? 'flex' : 'none';
  termsField.style.display = signup ? 'flex' : 'none';
  authTerms.checked = false;
  forgotPasswordRow.style.display = signup ? 'none' : 'block';
  authSubmitBtn.textContent = signup ? '회원가입' : '로그인';
  authSwitchText.textContent = signup ? '이미 계정이 있으신가요?' : '계정이 없으신가요?';
  authSwitchLink.textContent = signup ? '로그인' : '회원가입';
  authError.style.display = 'none';
}
authSwitchLink.addEventListener('click', () => setAuthMode(!isSignupMode));

const forgotPasswordRow = document.getElementById('forgotPasswordRow');
const forgotPasswordLink = document.getElementById('forgotPasswordLink');

forgotPasswordLink.addEventListener('click', async () => {
  const email = authEmail.value.trim() || window.prompt('가입하신 이메일을 입력해 주세요');
  if (!email) return;
  authError.style.display = 'none';
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password.html`
    });
    if (error) throw error;
    authError.style.color = 'var(--good)';
    authError.textContent = '비밀번호 재설정 메일을 보냈어요. 메일함(스팸함도)을 확인해 주세요.';
    authError.style.display = 'block';
  } catch (err) {
    authError.style.color = 'var(--signal)';
    authError.textContent = err.message || '메일 전송에 실패했어요.';
    authError.style.display = 'block';
  }
});

authSubmitBtn.addEventListener('click', async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value;
  authError.style.display = 'none';
  if (!email || !password){
    authError.textContent = '이메일과 비밀번호를 입력해 주세요.';
    authError.style.display = 'block';
    return;
  }
  if (isSignupMode && !authTerms.checked){
    authError.textContent = '이용약관 및 개인정보처리방침에 동의해 주세요.';
    authError.style.display = 'block';
    return;
  }
  authSubmitBtn.disabled = true;
  try{
    if (isSignupMode){
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (data.user && authNickname.value.trim()){
        await sb.from('profiles').update({ nickname: authNickname.value.trim() }).eq('id', data.user.id);
      }
      if (!data.session){
        authError.textContent = '가입 확인 메일을 보냈어요. 메일함을 확인한 뒤 로그인해 주세요.';
        authError.style.color = 'var(--good)';
        authError.style.display = 'block';
        setAuthMode(false);
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch(err){
    authError.style.color = 'var(--signal)';
    authError.textContent = err.message || '오류가 발생했어요.';
    authError.style.display = 'block';
  } finally {
    authSubmitBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => { await sb.auth.signOut(); });

sb.auth.onAuthStateChange(async (event, session) => {
  currentUser = session?.user || null;
  accessToken = session?.access_token || null;

  if (currentUser){
    authSection.classList.add('hidden');
    appRoot.classList.remove('hidden');
    userbar.classList.remove('hidden');
    tabNav.classList.remove('hidden');
    const { data: profile } = await sb.from('profiles').select('nickname').eq('id', currentUser.id).single();
    userNickname.textContent = profile?.nickname || currentUser.email.split('@')[0];
    journalDate.value = todayStr();
    renderJournalQuick();
    renderJournal();
    loadGoal();
    renderLibrary('');
    switchTab('measure');
  } else {
    authSection.classList.remove('hidden');
    appRoot.classList.add('hidden');
    userbar.classList.add('hidden');
    tabNav.classList.add('hidden');
  }
});

/* ---------- DOM refs (measurement flow) ---------- */
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const uploadSection = document.getElementById('uploadSection');
const stageSection = document.getElementById('stageSection');
const stage = document.getElementById('stage');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const stageHint = document.getElementById('stageHint');
const statusLine = document.getElementById('statusLine');
const confirmBtn = document.getElementById('confirmBtn');
const manualBtn = document.getElementById('manualBtn');
const resetBtn = document.getElementById('resetBtn');
const stepsDots = document.getElementById('stepsDots');
const fallbackNotice = document.getElementById('fallbackNotice');
const resultSection = document.getElementById('resultSection');
const readoutGrid = document.getElementById('readoutGrid');
const typeTicket = document.getElementById('typeTicket');
const flagsRow = document.getElementById('flagsRow');
const recList = document.getElementById('recList');
const waistInput = document.getElementById('waistInput');
const waistApply = document.getElementById('waistApply');
const toggleHistoryBtn = document.getElementById('toggleHistoryBtn');
const historyBox = document.getElementById('historyBox');
const coachMessages = document.getElementById('coachMessages');
const coachChips = document.getElementById('coachChips');
const coachInput = document.getElementById('coachInput');
const coachSendBtn = document.getElementById('coachSendBtn');
const coachError = document.getElementById('coachError');
const journalDate = document.getElementById('journalDate');
const journalNote = document.getElementById('journalNote');
const journalQuick = document.getElementById('journalQuick');
const journalSaveBtn = document.getElementById('journalSaveBtn');
const journalStats = document.getElementById('journalStats');
const journalList = document.getElementById('journalList');

let img = null;
let poseLandmarker = null;
let mode = null;
let autoPoints = null;
let manualPoints = [];
let currentSummary = null;
let chatMessages = [];

const MANUAL_STEPS_FULL = [
  { label:'어깨 지점 ①을 탭하세요' }, { label:'어깨 지점 ②를 탭하세요' },
  { label:'골반 지점 ①을 탭하세요' }, { label:'골반 지점 ②를 탭하세요' },
  { label:'발목 지점 ①을 탭하세요' }, { label:'발목 지점 ②를 탭하세요' },
];
const MANUAL_STEPS_UPPER = [
  { label:'어깨 지점 ①을 탭하세요' }, { label:'어깨 지점 ②를 탭하세요' },
  { label:'골반 지점 ①을 탭하세요' }, { label:'골반 지점 ②를 탭하세요' },
];
let bodyMode = 'full'; // 'full' | 'upper' — 발목이 사진에 없으면 'upper'
function currentManualSteps(){ return bodyMode === 'upper' ? MANUAL_STEPS_UPPER : MANUAL_STEPS_FULL; }

const bodyModeSelect = document.getElementById('bodyModeSelect');
const fullModeBtn = document.getElementById('fullModeBtn');
const upperModeBtn = document.getElementById('upperModeBtn');

/* ---------- Upload ---------- */
dropzone.addEventListener('click', () => fileInput.click());
['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
fileInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f); });

function handleFile(file){
  if (!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => { img = new Image(); img.onload = startStage; img.src = e.target.result; };
  reader.readAsDataURL(file);
}

function startStage(){
  uploadSection.classList.add('hidden');
  stageSection.classList.remove('hidden');
  resultSection.classList.add('hidden');
  fallbackNotice.classList.add('hidden');
  confirmBtn.classList.add('hidden');
  manualBtn.classList.add('hidden');
  stepsDots.classList.add('hidden');
  bodyModeSelect.classList.add('hidden');
  manualPoints = []; autoPoints = null; bodyMode = 'full';

  const maxW = 700;
  const scale = Math.min(1, maxW / img.naturalWidth);
  canvas.width = img.naturalWidth * scale;
  canvas.height = img.naturalHeight * scale;
  drawBase();
  runAutoDetect();
}
function drawBase(){ ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height); }

resetBtn.addEventListener('click', () => {
  img = null; fileInput.value = '';
  stageSection.classList.add('hidden');
  resultSection.classList.add('hidden');
  uploadSection.classList.remove('hidden');
});

/* ---------- Auto detection (works fine here — no CSP restriction like Claude.ai preview) ---------- */
async function initLandmarker(){
  const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  try{
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task", delegate: "GPU" },
      runningMode: "IMAGE", numPoses: 1
    });
  } catch(e){
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task", delegate: "CPU" },
      runningMode: "IMAGE", numPoses: 1
    });
  }
}

async function runAutoDetect(){
  stageHint.textContent = '자동 인식 준비 중…';
  try{
    if (!poseLandmarker){
      await Promise.race([initLandmarker(), new Promise((_,rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
    }
    stageHint.textContent = '분석 중…';
    const result = poseLandmarker.detect(img);
    const lm = result.landmarks && result.landmarks[0];
    if (!lm) throw new Error('no-pose');

    const P = i => ({ x: lm[i].x * canvas.width, y: lm[i].y * canvas.height, v: lm[i].visibility ?? 1 });
    const shoulderL = P(11), shoulderR = P(12), hipL = P(23), hipR = P(24), ankleL = P(27), ankleR = P(28);

    // 어깨·골반은 필수. 발목은 상반신 사진이면 안 보일 수 있어서 별도로 판단.
    const upperVis = Math.min(shoulderL.v, shoulderR.v, hipL.v, hipR.v);
    if (upperVis < 0.35) throw new Error('low-confidence');

    const legVis = Math.min(ankleL.v, ankleR.v);
    const hasLegs = legVis >= 0.35;

    autoPoints = { shoulderL, shoulderR, hipL, hipR, ankleL: hasLegs ? ankleL : null, ankleR: hasLegs ? ankleR : null };
    bodyMode = hasLegs ? 'full' : 'upper';
    mode = 'auto';
    drawAutoOverlay(lm);
    if (hasLegs){
      stageHint.textContent = '자동 인식 완료 — 아래 지점으로 측정할게요';
      statusLine.textContent = '어깨·골반·발목이 잘 잡혔는지 확인해 주세요.';
    } else {
      stageHint.textContent = '자동 인식 완료 (상반신만 인식됨)';
      statusLine.textContent = '발목이 사진에 안 보여서, 다리 관련 지표는 빼고 상체 기준으로만 측정할게요.';
    }
    confirmBtn.classList.remove('hidden');
    manualBtn.classList.remove('hidden');
  } catch(err){
    console.warn('auto detect failed, falling back to manual', err);
    fallbackNotice.classList.remove('hidden');
    startManualMode();
  }
}

function drawAutoOverlay(lm){
  drawBase();
  const edges = [[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]];
  ctx.strokeStyle = 'rgba(255,107,53,0.55)'; ctx.lineWidth = 2;
  edges.forEach(([a,b]) => { ctx.beginPath(); ctx.moveTo(lm[a].x*canvas.width, lm[a].y*canvas.height); ctx.lineTo(lm[b].x*canvas.width, lm[b].y*canvas.height); ctx.stroke(); });
  const highlight = [11,12,23,24,27,28];
  lm.forEach((p,i) => {
    ctx.beginPath();
    ctx.arc(p.x*canvas.width, p.y*canvas.height, highlight.includes(i)?5:2.5, 0, Math.PI*2);
    ctx.fillStyle = highlight.includes(i) ? '#FF6B35' : 'rgba(245,243,238,0.5)';
    ctx.fill();
  });
}

/* ---------- Manual fallback ---------- */
function startManualMode(){
  mode = 'manual'; manualPoints = [];
  drawBase();
  confirmBtn.classList.add('hidden'); manualBtn.classList.add('hidden');
  stepsDots.classList.add('hidden');
  statusLine.textContent = '';
  stageHint.textContent = '사진에 발목까지 나와있나요?';
  bodyModeSelect.classList.remove('hidden');
  canvas.onclick = null;
}
manualBtn.addEventListener('click', () => { fallbackNotice.classList.add('hidden'); startManualMode(); });

fullModeBtn.addEventListener('click', () => { bodyMode = 'full'; bodyModeSelect.classList.add('hidden'); beginManualTapping(); });
upperModeBtn.addEventListener('click', () => { bodyMode = 'upper'; bodyModeSelect.classList.add('hidden'); beginManualTapping(); });

function beginManualTapping(){
  manualPoints = [];
  const steps = currentManualSteps();
  stepsDots.classList.remove('hidden');
  stepsDots.innerHTML = steps.map(() => '<span></span>').join('');
  updateManualHint();
  canvas.onclick = onManualClick;
}

function updateManualHint(){
  const steps = currentManualSteps();
  const i = manualPoints.length;
  if (i >= steps.length){
    stageHint.textContent = `지점 ${steps.length}개를 모두 찍었어요`; statusLine.textContent = '';
    canvas.onclick = null; confirmBtn.classList.remove('hidden');
    return;
  }
  stageHint.textContent = steps[i].label;
  statusLine.textContent = `${i+1} / ${steps.length}`;
  [...stepsDots.children].forEach((d, idx) => { d.className = idx < i ? 'done' : (idx === i ? 'active' : ''); });
}

function onManualClick(e){
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  manualPoints.push({x,y});
  ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.fillStyle = '#FF6B35'; ctx.fill();
  ctx.strokeStyle = '#12151A'; ctx.lineWidth = 1.5; ctx.stroke();
  updateManualHint();
}

/* ---------- Confirm & compute ---------- */
confirmBtn.addEventListener('click', () => {
  let pts;
  if (mode === 'auto'){
    pts = autoPoints;
  } else if (bodyMode === 'upper'){
    const [shoulderA, shoulderB, hipA, hipB] = manualPoints;
    pts = { shoulderL:shoulderA, shoulderR:shoulderB, hipL:hipA, hipR:hipB, ankleL:null, ankleR:null };
  } else {
    const [shoulderA, shoulderB, hipA, hipB, ankleA, ankleB] = manualPoints;
    pts = { shoulderL:shoulderA, shoulderR:shoulderB, hipL:hipA, hipR:hipB, ankleL:ankleA, ankleR:ankleB };
  }
  computeAndRender(pts);
});

function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
function mid(a,b){ return { x:(a.x+b.x)/2, y:(a.y+b.y)/2 }; }

async function computeAndRender(pts){
  const shoulderWidth = dist(pts.shoulderL, pts.shoulderR);
  const hipWidth = dist(pts.hipL, pts.hipR);
  const shoulderHipRatio = shoulderWidth / hipWidth;
  const shoulderTilt = Math.abs(pts.shoulderL.y - pts.shoulderR.y) / shoulderWidth;
  const hipTilt = Math.abs(pts.hipL.y - pts.hipR.y) / hipWidth;

  let legTorsoRatio = null;
  let legAsymmetry = null;
  if (pts.ankleL && pts.ankleR){
    const shoulderMid = mid(pts.shoulderL, pts.shoulderR);
    const hipMid = mid(pts.hipL, pts.hipR);
    const ankleMid = mid(pts.ankleL, pts.ankleR);
    const torsoLength = dist(shoulderMid, hipMid);
    const legLength = dist(hipMid, ankleMid);
    legTorsoRatio = legLength / torsoLength;
    const legL = dist(pts.hipL, pts.ankleL), legR = dist(pts.hipR, pts.ankleR);
    legAsymmetry = Math.abs(legL-legR) / ((legL+legR)/2);
  }

  const m = { shoulderHipRatio, legTorsoRatio, shoulderTilt, hipTilt, legAsymmetry };
  await render(m);

  stageSection.classList.add('hidden');
  resultSection.classList.remove('hidden');
  window.scrollTo({ top: resultSection.offsetTop - 20, behavior:'smooth' });
}

waistApply.addEventListener('click', () => { if (lastMetrics) render(lastMetrics, { save:false }); });
let lastMetrics = null;

/* ---------- Classification & recommendations ---------- */
function classifyType(ratio, waist){
  if (ratio >= 1.08) return { type:'역삼각형 경향', desc:'어깨 폭이 골반보다 넓게 측정됐어요. 하체 볼륨을 키우면 전신 라인의 균형이 좋아져요.' };
  if (ratio <= 0.92) return { type:'하체 우세 경향', desc:'골반 폭이 어깨보다 넓게 측정됐어요. 등과 어깨 폭을 넓히는 운동을 더하면 상하체 비율이 균형을 이뤄요.' };
  if (!isNaN(waist) && waist > 0) return { type:'균형 체형 (모래시계 경향)', desc:'어깨와 골반 폭이 비슷하고, 허리둘레 정보까지 더하면 잘록한 허리 라인을 살리는 코어 운동이 도움이 돼요.' };
  return { type:'균형 체형', desc:'어깨와 골반 폭이 비슷한 균형형이에요. 전신 밸런스와 코어를 유지하는 방향이 잘 맞아요.' };
}

function buildRecommendations(ratio, waist, flags){
  const recs = [];
  if (ratio >= 1.08){
    recs.push({ area:'하체 (허벅지·둔근)', reason:'상체 대비 하체 볼륨을 키우면 비율이 시각적으로 안정돼요.', machines:['레그프레스','스미스머신 스쿼트','레그컬 머신','레그익스텐션','힙쓰러스트 머신'] });
    recs.push({ area:'상체 유지', reason:'상체는 이미 발달한 편이라 가벼운 중량으로 유지하는 정도가 균형에 유리해요.', machines:['체스트프레스 (저중량)','랫풀다운 (저중량)'] });
  } else if (ratio <= 0.92){
    recs.push({ area:'등 · 어깨', reason:'어깨 폭을 넓혀주는 운동 위주로 상체 볼륨을 키우면 비율이 균형을 이뤄요.', machines:['랫풀다운','사이드 레터럴레이즈 머신','숄더프레스 머신','시티드 로우 머신','케이블 크로스오버'] });
  } else {
    recs.push({ area:'전신 밸런스 + 코어', reason:'상하체 비율이 균형적이라 코어와 전신 밸런스를 유지하는 루틴이 잘 맞아요.', machines:['케이블 우드촙','플랭크','스미스머신 스쿼트','랫풀다운'] });
  }
  if (flags.some(f => f.includes('어깨'))) recs.push({ area:'어깨 좌우 밸런스', reason:'좌우 어깨 높이 차이가 감지됐어요. 편측 운동으로 약한 쪽을 보완해 보세요.', machines:['원암 덤벨로우','밴드 풀어파트','폼롤러 흉추 스트레칭'] });
  if (flags.some(f => f.includes('골반'))) recs.push({ area:'골반 좌우 밸런스', reason:'좌우 골반 높이 차이가 감지됐어요. 코어와 둔근을 좌우 동일하게 강화해 보세요.', machines:['힙 어브덕션 머신','힙 어덕션 머신','한 발 브릿지','코어 플랭크'] });
  return recs;
}

/* ---------- Render + save to Supabase ---------- */
async function render(m, opts = {}){
  lastMetrics = m;
  readoutGrid.innerHTML = `
    <div class="readout-cell"><div class="rl">어깨 : 골반 비율</div><div class="rv">${m.shoulderHipRatio.toFixed(2)}</div></div>
    <div class="readout-cell"><div class="rl">다리 : 상체 비율</div><div class="rv">${m.legTorsoRatio !== null ? m.legTorsoRatio.toFixed(2) : '측정 안 함'}</div></div>
    <div class="readout-cell"><div class="rl">어깨 좌우 기울기</div><div class="rv">${(m.shoulderTilt*100).toFixed(1)}%</div></div>
    <div class="readout-cell"><div class="rl">골반 좌우 기울기</div><div class="rv">${(m.hipTilt*100).toFixed(1)}%</div></div>
  `;
  const waist = parseFloat(waistInput.value);
  const { type, desc } = classifyType(m.shoulderHipRatio, waist);
  typeTicket.innerHTML = `<div class="ticket-type">${type}</div><div class="ticket-desc">${desc}</div>`;

  const flags = [];
  if (m.shoulderTilt > 0.035) flags.push('어깨 좌우 비대칭 의심');
  if (m.hipTilt > 0.035) flags.push('골반 좌우 비대칭 의심');
  if (m.legAsymmetry !== null && m.legAsymmetry > 0.05) flags.push('다리 길이 좌우 차이 의심');
  flagsRow.innerHTML = flags.map(f => `<span class="chip" style="color:var(--signal);border-color:var(--signal);">⚑ ${f}</span>`).join('');

  const recs = buildRecommendations(m.shoulderHipRatio, waist, flags);
  recList.innerHTML = recs.map(r => `
    <div class="rec-card">
      <div class="rec-area">${r.area}</div>
      <div class="rec-reason">${r.reason}</div>
      <div class="machine-list">${r.machines.map(mm => `<span class="machine-chip">${mm}</span>`).join('')}</div>
    </div>
  `).join('');

  currentSummary = { type, desc, flags, recs, ...m, waist: isNaN(waist) ? null : waist };
  renderJournalQuick();
  resetCoachChat();

  if (currentUser && opts.save !== false){
    try{
      await sb.from('measurements').insert({
        user_id: currentUser.id, body_type: type,
        shoulder_hip_ratio: m.shoulderHipRatio, leg_torso_ratio: m.legTorsoRatio,
        shoulder_tilt: m.shoulderTilt, hip_tilt: m.hipTilt,
        waist_cm: isNaN(waist) ? null : waist
      });
    } catch(e){ console.warn('measurement save failed', e); }
  }
}

/* ---------- History (Supabase) ---------- */
toggleHistoryBtn.addEventListener('click', async () => {
  const showing = !historyBox.classList.contains('hidden');
  if (showing){ historyBox.classList.add('hidden'); toggleHistoryBtn.textContent = '측정 기록 전체 보기'; return; }
  toggleHistoryBtn.textContent = '측정 기록 닫기';
  historyBox.classList.remove('hidden');
  const { data, error } = await sb.from('measurements').select('*').order('measured_at', { ascending:false }).limit(20);
  if (error || !data?.length){ historyBox.innerHTML = '<div class="history-empty">아직 저장된 측정 기록이 없어요.</div>'; return; }
  historyBox.innerHTML = data.map(r => `
    <div class="history-row">
      <div><strong>${r.body_type}</strong><div class="hdate">${new Date(r.measured_at).toLocaleString('ko-KR')}</div></div>
      <div class="hratio">어깨:골반 ${Number(r.shoulder_hip_ratio).toFixed(2)}</div>
    </div>
  `).join('');
});

/* ---------- Daily journal (Supabase) ---------- */
function todayStr(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function renderJournalQuick(){
  const machines = currentSummary ? [...new Set(currentSummary.recs.flatMap(r => r.machines))].slice(0,6)
    : ['스쿼트','레그프레스','랫풀다운','숄더프레스','플랭크','런지'];
  journalQuick.innerHTML = machines.map(m => `<span class="chip" data-add="${m}">+ ${m}</span>`).join('');
}
journalQuick.addEventListener('click', e => {
  const chip = e.target.closest('[data-add]'); if (!chip) return;
  journalNote.value = journalNote.value.trim() ? `${journalNote.value.trim()}, ${chip.dataset.add}` : chip.dataset.add;
});

async function renderJournal(){
  if (!currentUser) return;
  const { data, error } = await sb.from('journal_entries').select('*').eq('user_id', currentUser.id).order('entry_date', { ascending:false }).limit(30);
  if (error || !data){ journalList.innerHTML = ''; return; }
  const dateSet = new Set(data.map(r => r.entry_date));
  let streak = 0; const cursor = new Date();
  for(;;){
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;
    if (dateSet.has(key)){ streak++; cursor.setDate(cursor.getDate()-1); } else break;
  }
  journalStats.innerHTML = `<span class="streak-badge">🔥 연속 ${streak}일</span><span class="streak-badge">총 ${data.length}일 기록</span>`;
  if (!data.length){ journalList.innerHTML = '<div class="journal-empty">아직 기록이 없어요.</div>'; return; }
  journalList.innerHTML = data.map(r => `
    <div class="journal-row">
      <div class="jdate">${r.entry_date}</div>
      <div class="jnote" data-edit="${r.entry_date}">${escapeHtml(r.note)}</div>
      <button class="jdel" data-del="${r.entry_date}">✕</button>
    </div>
  `).join('');
}

journalList.addEventListener('click', async e => {
  const del = e.target.closest('[data-del]');
  if (del){ await sb.from('journal_entries').delete().eq('user_id', currentUser.id).eq('entry_date', del.dataset.del); renderJournal(); return; }
  const edit = e.target.closest('[data-edit]');
  if (edit){
    const { data } = await sb.from('journal_entries').select('note').eq('user_id', currentUser.id).eq('entry_date', edit.dataset.edit).single();
    journalDate.value = edit.dataset.edit; journalNote.value = data?.note || ''; journalNote.focus();
  }
});

journalSaveBtn.addEventListener('click', async () => {
  if (!currentUser) return;
  const date = journalDate.value || todayStr();
  const note = journalNote.value.trim();
  if (!note) return;
  await sb.from('journal_entries').upsert({ user_id: currentUser.id, entry_date: date, note }, { onConflict: 'user_id,entry_date' });
  journalNote.value = '';
  renderJournal();
});

/* ---------- AI coach (via backend proxy) ---------- */
function escapeHtml(str){ const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

function resetCoachChat(){
  chatMessages = [];
  const topArea = currentSummary?.recs?.[0]?.area || '전신 밸런스';
  chatMessages.push({ role:'assistant', content:`측정 결과를 확인했어요. "${currentSummary.type}"으로 보이고, 지금은 ${topArea} 위주로 추천드렸어요. 궁금한 점을 물어보세요.` });
  renderChatMessages();
}
function renderChatMessages(){
  coachMessages.innerHTML = chatMessages.map(m => `<div class="msg ${m.role}${m.pending?' pending':''}">${escapeHtml(m.content)}</div>`).join('');
  coachMessages.scrollTop = coachMessages.scrollHeight;
}
function buildCoachSystemPrompt(){
  const s = currentSummary;
  const goalLine = currentGoal?.goal_text
    ? `사용자의 목표: ${currentGoal.goal_text}${currentGoal.target_date ? ` (목표일: ${currentGoal.target_date})` : ''}`
    : '설정된 목표 없음';
  return [
    '너는 친근한 한국어 헬스 코치야. 사용자는 방금 사진 기반 체형 측정을 마쳤어.',
    goalLine,
    `체형 분류: ${s.type} — ${s.desc}`,
    `측정값: 어깨:골반 비율 ${s.shoulderHipRatio.toFixed(2)}, 어깨 기울기 ${(s.shoulderTilt*100).toFixed(1)}%, 골반 기울기 ${(s.hipTilt*100).toFixed(1)}%`,
    s.flags.length ? `주의 신호: ${s.flags.join(', ')}` : '특별한 좌우 비대칭 신호는 없음',
    `현재 추천된 우선 부위와 머신: ${s.recs.map(r => `${r.area} (${r.machines.join(', ')})`).join(' | ')}`,
    '루틴을 요청하면 주차·세트·횟수를 구체적으로 짜주고, 이유를 물으면 쉽게 설명해줘. 체중감량/칼로리/식단 수치는 다루지 말고 운동·자세 중심으로만 답해. 통증/부상 언급 시 전문가 상담을 권해. 3~6문장으로 간결하게.'
  ].join('\n');
}

async function sendCoachMessage(text){
  if (!currentSummary || !text.trim() || !accessToken) return;
  coachError.style.display = 'none';
  chatMessages.push({ role:'user', content:text });
  chatMessages.push({ role:'assistant', content:'생각하는 중…', pending:true });
  renderChatMessages();

  const apiMessages = chatMessages.filter(m => !m.pending).map(m => ({ role:m.role, content:m.content }));
  try{
    const res = await fetch('/api/coach', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ system: buildCoachSystemPrompt(), messages: apiMessages })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'request failed');
    const textOut = (data.content || []).map(b => b.type === 'text' ? b.text : '').join('\n').trim() || '죄송해요, 답변을 만들지 못했어요.';
    chatMessages = chatMessages.filter(m => !m.pending);
    chatMessages.push({ role:'assistant', content:textOut });
    renderChatMessages();
  } catch(err){
    console.warn('coach chat failed', err);
    chatMessages = chatMessages.filter(m => !m.pending);
    renderChatMessages();
    coachError.textContent = (err.message && err.message !== 'request failed')
      ? err.message
      : '코치 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.';
    coachError.style.display = 'block';
  }
}
coachChips.addEventListener('click', e => { const chip = e.target.closest('.chip'); if (chip) sendCoachMessage(chip.dataset.q); });
coachSendBtn.addEventListener('click', () => { const t = coachInput.value.trim(); if (!t) return; coachInput.value=''; sendCoachMessage(t); });
coachInput.addEventListener('keydown', e => { if (e.key === 'Enter') coachSendBtn.click(); });

setAuthMode(false);

/* ---------- 측정 추이 그래프 ---------- */
let trendChartInstance = null;

function destroyTrendChart(){
  if (trendChartInstance){ trendChartInstance.destroy(); trendChartInstance = null; }
}

async function refreshTrend(){
  if (!currentUser) return;
  const { data, error } = await sb.from('measurements')
    .select('measured_at, shoulder_hip_ratio')
    .eq('user_id', currentUser.id)
    .order('measured_at', { ascending: true })
    .limit(20);

  const canvas = document.getElementById('trendChart');
  const emptyMsg = document.getElementById('trendEmpty');
  if (!canvas) return;

  if (error || !data || data.length < 2){
    canvas.style.display = 'none';
    if (emptyMsg) emptyMsg.style.display = 'block';
    return;
  }
  canvas.style.display = 'block';
  if (emptyMsg) emptyMsg.style.display = 'none';

  const labels = data.map(r => new Date(r.measured_at).toLocaleDateString('ko-KR', { month:'numeric', day:'numeric' }));
  const values = data.map(r => Number(r.shoulder_hip_ratio));

  destroyTrendChart();
  trendChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '어깨:골반 비율',
        data: values,
        borderColor: '#FF6B35',
        backgroundColor: 'rgba(255,107,53,0.15)',
        borderWidth: 2,
        pointBackgroundColor: '#FF6B35',
        pointRadius: 4,
        tension: 0.25,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `비율 ${c.parsed.y.toFixed(2)}` } }
      },
      scales: {
        x: { ticks: { color: '#9AA1AC' }, grid: { color: '#2E343E' } },
        y: { ticks: { color: '#9AA1AC' }, grid: { color: '#2E343E' } }
      }
    }
  });
}

/* ---------- 마이페이지: 프로필 + 요약 통계 + 계정 관리 ---------- */
async function renderMyPageStats(){
  if (!currentUser) return;

  mypageEmail.value = currentUser.email;
  const { data: profile } = await sb.from('profiles').select('nickname').eq('id', currentUser.id).single();
  mypageNickname.value = profile?.nickname || '';

  const { count: measureCount } = await sb.from('measurements')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', currentUser.id);

  const { data: journalRows } = await sb.from('journal_entries')
    .select('entry_date')
    .eq('user_id', currentUser.id);

  const totalDays = journalRows ? journalRows.length : 0;
  let streak = 0;
  if (journalRows){
    const dateSet = new Set(journalRows.map(r => r.entry_date));
    const cursor = new Date();
    for (;;){
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;
      if (dateSet.has(key)){ streak++; cursor.setDate(cursor.getDate() - 1); } else break;
    }
  }

  statMeasureCount.textContent = measureCount ?? 0;
  statStreak.textContent = streak;
  statTotalDays.textContent = totalDays;

  const todayKey = todayStr();
  const { data: usageRow } = await sb.from('coach_usage')
    .select('count')
    .eq('user_id', currentUser.id)
    .eq('usage_date', todayKey)
    .maybeSingle();
  statCoachUsage.textContent = `${usageRow?.count || 0} / ${COACH_DAILY_LIMIT}`;

  refreshTrend();
  loadGoal();
}

mypageNicknameSave.addEventListener('click', async () => {
  if (!currentUser) return;
  const val = mypageNickname.value.trim();
  if (!val) return;
  await sb.from('profiles').update({ nickname: val }).eq('id', currentUser.id);
  userNickname.textContent = val;
  mypageProfileMsg.style.display = 'block';
  setTimeout(() => { mypageProfileMsg.style.display = 'none'; }, 2000);
});

deleteAccountBtn.addEventListener('click', async () => {
  const sure = confirm('정말 계정을 삭제하시겠어요?\n측정 기록과 운동 기록이 전부 영구히 삭제되고 되돌릴 수 없어요.');
  if (!sure) return;
  deleteAccountBtn.disabled = true;
  try{
    const res = await fetch('/api/account', {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error('delete failed');
    await sb.auth.signOut();
    location.reload();
  } catch(err){
    console.warn('account delete failed', err);
    alert('계정 삭제에 실패했어요. 잠시 후 다시 시도해 주세요.');
    deleteAccountBtn.disabled = false;
  }
});

/* ---------- 목표 설정 ---------- */
const goalText = document.getElementById('goalText');
const goalDate = document.getElementById('goalDate');
const goalSaveBtn = document.getElementById('goalSaveBtn');
const goalMsg = document.getElementById('goalMsg');
const goalStatus = document.getElementById('goalStatus');

let currentGoal = null;

async function loadGoal(){
  if (!currentUser) return;
  const { data } = await sb.from('goals')
    .select('goal_text, target_date')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  currentGoal = data || null;
  goalText.value = data?.goal_text || '';
  goalDate.value = data?.target_date || '';

  if (data?.target_date){
    const days = Math.ceil((new Date(data.target_date) - new Date()) / (1000 * 60 * 60 * 24));
    goalStatus.textContent = days >= 0 ? `목표일까지 ${days}일 남았어요.` : `목표일이 ${Math.abs(days)}일 지났어요.`;
  } else if (data?.goal_text){
    goalStatus.textContent = '목표일은 설정하지 않았어요.';
  } else {
    goalStatus.textContent = '아직 목표가 없어요. 목표를 적어두면 AI 코치가 기억하고 대화에 반영해요.';
  }
}

goalSaveBtn.addEventListener('click', async () => {
  if (!currentUser) return;
  const text = goalText.value.trim();
  if (!text) return;
  await sb.from('goals').upsert(
    { user_id: currentUser.id, goal_text: text, target_date: goalDate.value || null },
    { onConflict: 'user_id' }
  );
  goalMsg.style.display = 'block';
  setTimeout(() => { goalMsg.style.display = 'none'; }, 2000);
  loadGoal();
});

/* ---------- 운동사전 ---------- */
const EXERCISE_LIBRARY = [
  { name:'레그프레스', area:'하체', howTo:'등받이에 등을 붙이고 발판을 어깨너비로 밟은 뒤, 무릎이 발끝 방향과 일치하도록 밀어냅니다. 무릎을 완전히 펴지 말고 살짝 굽힌 상태에서 멈추세요.' },
  { name:'스미스머신 스쿼트', area:'하체', howTo:'바를 어깨 위(승모근)에 걸치고 발을 어깨너비로 벌린 뒤, 무릎과 엉덩이를 동시에 굽혀 앉았다 일어납니다. 무릎이 발끝보다 안쪽으로 모이지 않게 주의하세요.' },
  { name:'레그컬 머신', area:'하체', howTo:'엎드리거나 앉아서 패드를 발목 뒤쪽에 걸고 무릎을 굽혀 당깁니다. 반동 없이 천천히 당기고 천천히 풀어주세요.' },
  { name:'레그익스텐션', area:'하체', howTo:'앉아서 패드를 발목 앞쪽에 걸고 무릎을 펴서 다리를 들어올립니다. 무릎 관절에 무리가 가지 않도록 중량을 과하게 두지 마세요.' },
  { name:'힙쓰러스트 머신', area:'하체', howTo:'어깨를 벤치에 기대고 골반을 위로 밀어올려 엉덩이를 조입니다. 정점에서 1~2초 버티면 둔근 자극이 커져요.' },
  { name:'런지', area:'하체', howTo:'한 발을 앞으로 크게 내딛고 양 무릎을 90도로 굽혔다가 원위치합니다. 앞 무릎이 발끝을 넘지 않게 주의하세요.' },
  { name:'랫풀다운', area:'등·어깨', howTo:'바를 어깨너비보다 약간 넓게 잡고, 가슴 쪽으로 당깁니다. 어깨를 으쓱하지 말고 등 근육으로 당기는 느낌을 유지하세요.' },
  { name:'사이드 레터럴레이즈 머신', area:'등·어깨', howTo:'팔꿈치를 살짝 굽힌 채 옆으로 들어올려 어깨 옆쪽(측면 삼각근)을 자극합니다. 반동을 쓰지 않는 게 중요해요.' },
  { name:'숄더프레스 머신', area:'등·어깨', howTo:'손잡이를 어깨 높이에서 잡고 머리 위로 밀어올립니다. 허리가 과하게 젖혀지지 않도록 코어에 힘을 주세요.' },
  { name:'시티드 로우 머신', area:'등·어깨', howTo:'손잡이를 잡고 팔꿈치를 몸 뒤로 당기며 견갑골을 모아줍니다. 상체를 앞뒤로 흔들지 말고 고정하세요.' },
  { name:'케이블 크로스오버', area:'등·어깨', howTo:'양쪽 케이블을 잡고 팔을 앞으로 모아 가슴을 조입니다. 팔꿈치를 살짝 굽힌 채로 진행하세요.' },
  { name:'체스트프레스 (저중량)', area:'상체 유지', howTo:'손잡이를 가슴 높이에서 잡고 앞으로 밀어냅니다. 어깨가 말리지 않게 가슴을 편 상태를 유지하세요.' },
  { name:'케이블 우드촙', area:'코어', howTo:'케이블을 한쪽 위(또는 아래)에서 잡고 대각선으로 몸통을 회전하며 당깁니다. 허리가 아닌 코어 회전으로 움직이세요.' },
  { name:'플랭크', area:'코어', howTo:'팔꿈치와 발끝으로 몸을 지탱하고, 엉덩이가 처지거나 너무 올라가지 않게 일직선을 유지합니다.' },
  { name:'원암 덤벨로우', area:'자세 교정', howTo:'한 손과 무릎을 벤치에 대고, 반대손으로 덤벨을 골반 옆으로 당깁니다. 좌우를 번갈아 동일한 횟수로 진행하세요.' },
  { name:'밴드 풀어파트', area:'자세 교정', howTo:'밴드를 어깨너비로 잡고 팔을 양옆으로 벌려 등 견갑골을 모읍니다. 라운드 숄더(굽은 어깨) 교정에 좋아요.' },
  { name:'폼롤러 흉추 스트레칭', area:'자세 교정', howTo:'폼롤러를 등 중간(흉추)에 대고 누운 뒤, 팔을 머리 위로 뻗으며 상체를 살짝 젖혀 늘려줍니다.' },
  { name:'힙 어브덕션 머신', area:'골반 밸런스', howTo:'앉아서 패드를 무릎 바깥쪽에 대고 다리를 벌립니다. 엉덩이 옆쪽(중둔근) 자극에 집중하세요.' },
  { name:'힙 어덕션 머신', area:'골반 밸런스', howTo:'앉아서 패드를 무릎 안쪽에 대고 다리를 모읍니다. 허벅지 안쪽 근육을 쓰는 느낌으로 진행하세요.' },
  { name:'한 발 브릿지', area:'골반 밸런스', howTo:'누운 상태에서 한쪽 다리를 들고, 반대쪽 다리로만 골반을 들어올립니다. 좌우 번갈아 동일 횟수로 하세요.' },
];

const libSearch = document.getElementById('libSearch');
const libraryList = document.getElementById('libraryList');

function renderLibrary(filter){
  const q = (filter || '').trim().toLowerCase();
  const items = EXERCISE_LIBRARY.filter(e =>
    !q || e.name.toLowerCase().includes(q) || e.area.toLowerCase().includes(q)
  );
  if (!items.length){
    libraryList.innerHTML = '<div class="history-empty">검색 결과가 없어요.</div>';
    return;
  }
  libraryList.innerHTML = items.map(e => `
    <div class="rec-card">
      <div class="rec-area">${escapeHtml(e.name)} <span class="chip" style="margin-left:8px;">${escapeHtml(e.area)}</span></div>
      <div class="rec-reason">${escapeHtml(e.howTo)}</div>
    </div>
  `).join('');
}
libSearch.addEventListener('input', () => renderLibrary(libSearch.value));

/* ---------- AI 리포트 ---------- */
const generateReportBtn = document.getElementById('generateReportBtn');
const reportError = document.getElementById('reportError');
const reportOutput = document.getElementById('reportOutput');

generateReportBtn.addEventListener('click', async () => {
  if (!accessToken) return;
  reportError.style.display = 'none';
  reportOutput.style.display = 'none';
  generateReportBtn.disabled = true;
  generateReportBtn.textContent = '리포트 생성 중…';

  try{
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'request failed');
    const textOut = (data.content || []).map(b => b.type === 'text' ? b.text : '').join('\n').trim()
      || '리포트를 만들지 못했어요.';
    reportOutput.textContent = textOut;
    reportOutput.style.display = 'block';
  } catch(err){
    console.warn('report generation failed', err);
    reportError.textContent = (err.message && err.message !== 'request failed')
      ? err.message
      : '리포트를 만들지 못했어요. 잠시 후 다시 시도해 주세요.';
    reportError.style.display = 'block';
  } finally {
    generateReportBtn.disabled = false;
    generateReportBtn.textContent = '이번 달 리포트 생성';
  }
});

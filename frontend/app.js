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
  authSubmitBtn.textContent = signup ? '회원가입' : '로그인';
  authSwitchText.textContent = signup ? '이미 계정이 있으신가요?' : '계정이 없으신가요?';
  authSwitchLink.textContent = signup ? '로그인' : '회원가입';
  authError.style.display = 'none';
}
authSwitchLink.addEventListener('click', () => setAuthMode(!isSignupMode));

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
    const { data: profile } = await sb.from('profiles').select('nickname').eq('id', currentUser.id).single();
    userNickname.textContent = profile?.nickname || currentUser.email.split('@')[0];
    journalDate.value = todayStr();
    renderJournalQuick();
    renderJournal();
    refreshTrend();
  } else {
    authSection.classList.remove('hidden');
    appRoot.classList.add('hidden');
    userbar.classList.add('hidden');
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

const MANUAL_STEPS = [
  { label:'어깨 지점 ①을 탭하세요' }, { label:'어깨 지점 ②를 탭하세요' },
  { label:'골반 지점 ①을 탭하세요' }, { label:'골반 지점 ②를 탭하세요' },
  { label:'발목 지점 ①을 탭하세요' }, { label:'발목 지점 ②를 탭하세요' },
];

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
  manualPoints = []; autoPoints = null;

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
    const pts = { shoulderL:P(11), shoulderR:P(12), hipL:P(23), hipR:P(24), ankleL:P(27), ankleR:P(28) };
    const minVis = Math.min(pts.shoulderL.v, pts.shoulderR.v, pts.hipL.v, pts.hipR.v, pts.ankleL.v, pts.ankleR.v);
    if (minVis < 0.35) throw new Error('low-confidence');

    autoPoints = pts; mode = 'auto';
    drawAutoOverlay(lm);
    stageHint.textContent = '자동 인식 완료 — 아래 지점으로 측정할게요';
    statusLine.textContent = '어깨·골반·발목이 잘 잡혔는지 확인해 주세요.';
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
  ctx.strokeStyle = 'rgba(232,185,35,0.55)'; ctx.lineWidth = 2;
  edges.forEach(([a,b]) => { ctx.beginPath(); ctx.moveTo(lm[a].x*canvas.width, lm[a].y*canvas.height); ctx.lineTo(lm[b].x*canvas.width, lm[b].y*canvas.height); ctx.stroke(); });
  const highlight = [11,12,23,24,27,28];
  lm.forEach((p,i) => {
    ctx.beginPath();
    ctx.arc(p.x*canvas.width, p.y*canvas.height, highlight.includes(i)?5:2.5, 0, Math.PI*2);
    ctx.fillStyle = highlight.includes(i) ? '#E8B923' : 'rgba(240,237,230,0.5)';
    ctx.fill();
  });
}

/* ---------- Manual fallback ---------- */
function startManualMode(){
  mode = 'manual'; manualPoints = [];
  drawBase();
  confirmBtn.classList.add('hidden'); manualBtn.classList.add('hidden');
  stepsDots.classList.remove('hidden');
  stepsDots.innerHTML = MANUAL_STEPS.map(() => '<span></span>').join('');
  updateManualHint();
  canvas.onclick = onManualClick;
}
manualBtn.addEventListener('click', () => { fallbackNotice.classList.add('hidden'); startManualMode(); });

function updateManualHint(){
  const i = manualPoints.length;
  if (i >= MANUAL_STEPS.length){
    stageHint.textContent = '지점 6개를 모두 찍었어요'; statusLine.textContent = '';
    canvas.onclick = null; confirmBtn.classList.remove('hidden');
    return;
  }
  stageHint.textContent = MANUAL_STEPS[i].label;
  statusLine.textContent = `${i+1} / ${MANUAL_STEPS.length}`;
  [...stepsDots.children].forEach((d, idx) => { d.className = idx < i ? 'done' : (idx === i ? 'active' : ''); });
}

function onManualClick(e){
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  manualPoints.push({x,y});
  ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.fillStyle = '#E8B923'; ctx.fill();
  ctx.strokeStyle = '#14171A'; ctx.lineWidth = 1.5; ctx.stroke();
  updateManualHint();
}

/* ---------- Confirm & compute ---------- */
confirmBtn.addEventListener('click', () => {
  let pts;
  if (mode === 'auto'){ pts = autoPoints; }
  else {
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
  const shoulderMid = mid(pts.shoulderL, pts.shoulderR);
  const hipMid = mid(pts.hipL, pts.hipR);
  const ankleMid = mid(pts.ankleL, pts.ankleR);
  const torsoLength = dist(shoulderMid, hipMid);
  const legLength = dist(hipMid, ankleMid);

  const shoulderHipRatio = shoulderWidth / hipWidth;
  const legTorsoRatio = legLength / torsoLength;
  const shoulderTilt = Math.abs(pts.shoulderL.y - pts.shoulderR.y) / shoulderWidth;
  const hipTilt = Math.abs(pts.hipL.y - pts.hipR.y) / hipWidth;
  const legL = dist(pts.hipL, pts.ankleL), legR = dist(pts.hipR, pts.ankleR);
  const legAsymmetry = Math.abs(legL-legR) / ((legL+legR)/2);

  const m = { shoulderHipRatio, legTorsoRatio, shoulderTilt, hipTilt, legAsymmetry };
  await render(m);

  stageSection.classList.add('hidden');
  resultSection.classList.remove('hidden');
  window.scrollTo({ top: resultSection.offsetTop - 20, behavior:'smooth' });
}

waistApply.addEventListener('click', () => { if (lastMetrics) render(lastMetrics); });
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
async function render(m){
  lastMetrics = m;
  readoutGrid.innerHTML = `
    <div class="readout-cell"><div class="rl">어깨 : 골반 비율</div><div class="rv">${m.shoulderHipRatio.toFixed(2)}</div></div>
    <div class="readout-cell"><div class="rl">다리 : 상체 비율</div><div class="rv">${m.legTorsoRatio.toFixed(2)}</div></div>
    <div class="readout-cell"><div class="rl">어깨 좌우 기울기</div><div class="rv">${(m.shoulderTilt*100).toFixed(1)}%</div></div>
    <div class="readout-cell"><div class="rl">골반 좌우 기울기</div><div class="rv">${(m.hipTilt*100).toFixed(1)}%</div></div>
  `;
  const waist = parseFloat(waistInput.value);
  const { type, desc } = classifyType(m.shoulderHipRatio, waist);
  typeTicket.innerHTML = `<div class="ticket-type">${type}</div><div class="ticket-desc">${desc}</div>`;

  const flags = [];
  if (m.shoulderTilt > 0.035) flags.push('어깨 좌우 비대칭 의심');
  if (m.hipTilt > 0.035) flags.push('골반 좌우 비대칭 의심');
  if (m.legAsymmetry > 0.05) flags.push('다리 길이 좌우 차이 의심');
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

  if (currentUser){
    try{
      await sb.from('measurements').insert({
        user_id: currentUser.id, body_type: type,
        shoulder_hip_ratio: m.shoulderHipRatio, leg_torso_ratio: m.legTorsoRatio,
        shoulder_tilt: m.shoulderTilt, hip_tilt: m.hipTilt,
        waist_cm: isNaN(waist) ? null : waist
      });
      refreshTrend();
    } catch(e){ console.warn('measurement save failed', e); }
  }
}

/* ---------- History (Supabase) ---------- */
toggleHistoryBtn.addEventListener('click', async () => {
  const showing = !historyBox.classList.contains('hidden');
  if (showing){ historyBox.classList.add('hidden'); toggleHistoryBtn.textContent = '측정 기록 보기'; return; }
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
  return [
    '너는 친근한 한국어 헬스 코치야. 사용자는 방금 사진 기반 체형 측정을 마쳤어.',
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
        borderColor: '#E8B923',
        backgroundColor: 'rgba(232,185,35,0.15)',
        borderWidth: 2,
        pointBackgroundColor: '#E8B923',
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
        x: { ticks: { color: '#9CA3A8' }, grid: { color: '#343B41' } },
        y: { ticks: { color: '#9CA3A8' }, grid: { color: '#343B41' } }
      }
    }
  });
}

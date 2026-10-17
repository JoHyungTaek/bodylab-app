import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { rerankCandidates } from './rerank.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8787;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;

if (!ANTHROPIC_API_KEY) console.warn('⚠️  ANTHROPIC_API_KEY가 .env에 없어요 — AI 코치가 동작하지 않아요.');
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) console.warn('⚠️  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 .env에 없어요 — 로그인 검증이 동작하지 않아요.');
if (!YOUTUBE_API_KEY) console.warn('⚠️  YOUTUBE_API_KEY가 .env에 없어요 — 운동사전 영상 연동이 동작하지 않아요.');
if (!VOYAGE_API_KEY) console.warn('⚠️  VOYAGE_API_KEY가 .env에 없어요 — 운동사전 AI 검색(RAG)이 동작하지 않아요.');

const supabaseAdmin = createClient(SUPABASE_URL || '', SUPABASE_SERVICE_ROLE_KEY || '');

const DAILY_COACH_LIMIT = 20;
const YOUTUBE_CACHE_DAYS = 30;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 프론트엔드 정적 파일 서빙 (같은 오리진이라 CORS 걱정이 없어요)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// 요청 헤더의 Supabase 액세스 토큰을 검증해서 로그인한 사용자만 코치를 쓸 수 있게 함
async function requireUser(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: '로그인이 필요해요.' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: '로그인 세션이 만료됐어요. 다시 로그인해 주세요.' });

  req.user = data.user;
  next();
}

// 하루 코치 사용량 확인 (코치 대화 + AI 리포트 생성 공통으로 사용)
async function getUsageToday(userId) {
  const today = new Date().toISOString().slice(0, 10);
  let currentCount = 0;
  try {
    const { data: usageRow } = await supabaseAdmin
      .from('coach_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('usage_date', today)
      .maybeSingle();
    currentCount = usageRow?.count || 0;
  } catch (e) {
    console.warn('usage check failed:', e);
  }
  return { today, currentCount };
}

async function incrementUsage(userId, today, currentCount) {
  try {
    await supabaseAdmin.from('coach_usage').upsert(
      { user_id: userId, usage_date: today, count: currentCount + 1 },
      { onConflict: 'user_id,usage_date' }
    );
  } catch (e) {
    console.warn('usage increment failed:', e);
  }
}

async function callAnthropic(system, messages) {
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system,
      messages
    })
  });
  const data = await anthropicRes.json();
  return { ok: anthropicRes.ok, status: anthropicRes.status, data };
}

// Voyage AI 임베딩 생성 (RAG 검색용)
async function embedText(text, inputType) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VOYAGE_API_KEY}` },
    body: JSON.stringify({ input: [text], model: 'voyage-3-lite', input_type: inputType })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'embedding failed');
  return data.data[0].embedding;
}

// 운동사전 20개 항목 (프론트엔드 EXERCISE_LIBRARY와 이름은 동일, 검색 품질 개선을 위해 메타데이터 보강)
const EXERCISE_LIBRARY_SEED = [
  { name:'레그프레스', muscle_groups:['하체','허벅지 앞쪽','둔근'], goals:['허벅지 볼륨 키우기','둔근 강화','하체 전반 강화'], equipment:'머신', difficulty:'초급', keywords:['허벅지','엉덩이','하체','볼륨'], aliases:['레그 프레스'], precautions:'무릎을 완전히 펴지 말고 살짝 굽힌 상태에서 멈추세요.', description:'등받이에 등을 붙이고 발판을 어깨너비로 밟은 뒤 무릎이 발끝 방향과 일치하도록 밀어냅니다.' },
  { name:'스미스머신 스쿼트', muscle_groups:['하체','허벅지','둔근'], goals:['하체 전반 강화','허벅지 볼륨 키우기'], equipment:'머신', difficulty:'중급', keywords:['허벅지','하체','볼륨','스쿼트'], aliases:['스미스 스쿼트'], precautions:'무릎이 발끝보다 안쪽으로 모이지 않게 주의하세요.', description:'바를 어깨 위(승모근)에 걸치고 발을 어깨너비로 벌린 뒤, 무릎과 엉덩이를 동시에 굽혀 앉았다 일어납니다.' },
  { name:'레그컬 머신', muscle_groups:['하체','허벅지 뒤쪽','햄스트링'], goals:['허벅지 뒤쪽 키우기','햄스트링 강화'], equipment:'머신', difficulty:'초급', keywords:['허벅지 뒤쪽','햄스트링','하체'], aliases:['레그 컬'], precautions:'반동 없이 천천히 당기고 천천히 풀어주세요.', description:'엎드리거나 앉아서 패드를 발목 뒤쪽에 걸고 무릎을 굽혀 당깁니다.' },
  { name:'레그익스텐션', muscle_groups:['하체','허벅지 앞쪽','대퇴사두근'], goals:['허벅지 앞쪽 키우기','무릎 부담 적은 하체 운동'], equipment:'머신', difficulty:'초급', keywords:['허벅지 앞쪽','무릎','하체'], aliases:['레그 익스텐션'], precautions:'무릎 관절에 무리가 가지 않도록 중량을 과하게 두지 마세요.', description:'앉아서 패드를 발목 앞쪽에 걸고 무릎을 펴서 다리를 들어올립니다. 다른 하체 운동보다 무릎 관절 부담이 상대적으로 적은 편입니다.' },
  { name:'힙쓰러스트 머신', muscle_groups:['하체','엉덩이','둔근'], goals:['엉덩이 키우기','힙업'], equipment:'머신', difficulty:'초급', keywords:['엉덩이','둔근','힙업'], aliases:['힙 쓰러스트'], precautions:'정점에서 1~2초 버티면 둔근 자극이 커져요.', description:'어깨를 벤치에 기대고 골반을 위로 밀어올려 엉덩이를 조입니다.' },
  { name:'런지', muscle_groups:['하체','허벅지','둔근'], goals:['허벅지 볼륨 키우기','균형 감각 기르기'], equipment:'맨몸/덤벨', difficulty:'초급', keywords:['허벅지','엉덩이','밸런스','균형'], aliases:[], precautions:'앞 무릎이 발끝을 넘지 않게 주의하세요.', description:'한 발을 앞으로 크게 내딛고 양 무릎을 90도로 굽혔다가 원위치합니다.' },
  { name:'랫풀다운', muscle_groups:['등','어깨'], goals:['등 넓히기','어깨 넓어 보이게 하기'], equipment:'머신', difficulty:'초급', keywords:['등','어깨','넓어지고 싶은','넓히기'], aliases:['랫 풀다운'], precautions:'어깨를 으쓱하지 말고 등 근육으로 당기는 느낌을 유지하세요.', description:'바를 어깨너비보다 약간 넓게 잡고, 가슴 쪽으로 당깁니다.' },
  { name:'사이드 레터럴레이즈 머신', muscle_groups:['등','어깨','측면 삼각근'], goals:['어깨 넓어 보이게 하기','어깨 옆쪽 강화'], equipment:'머신', difficulty:'초급', keywords:['어깨','넓어지고 싶은','옆쪽'], aliases:['사이드 레터럴'], precautions:'반동을 쓰지 않는 게 중요해요.', description:'팔꿈치를 살짝 굽힌 채 옆으로 들어올려 어깨 옆쪽(측면 삼각근)을 자극합니다.' },
  { name:'숄더프레스 머신', muscle_groups:['등','어깨'], goals:['어깨 전체적으로 강화하기'], equipment:'머신', difficulty:'초급', keywords:['어깨','강화'], aliases:['숄더 프레스'], precautions:'허리가 과하게 젖혀지지 않도록 코어에 힘을 주세요.', description:'손잡이를 어깨 높이에서 잡고 머리 위로 밀어올립니다.' },
  { name:'시티드 로우 머신', muscle_groups:['등'], goals:['등 두께 키우기','자세 교정'], equipment:'머신', difficulty:'초급', keywords:['등','두께','자세'], aliases:['시티드 로우'], precautions:'', description:'손잡이를 몸 쪽으로 당겨 견갑골을 모읍니다. 등 두께를 키우고 자세 교정에도 도움이 됩니다.' },
  { name:'케이블 크로스오버', muscle_groups:['가슴'], goals:['가슴 안쪽 선 만들기'], equipment:'케이블 머신', difficulty:'중급', keywords:['가슴','안쪽','라인'], aliases:['케이블 크로스'], precautions:'팔꿈치를 살짝 굽힌 채로 진행하세요.', description:'양쪽 케이블을 잡고 팔을 앞으로 모아 가슴을 조입니다.' },
  { name:'체스트프레스', muscle_groups:['가슴'], goals:['가슴 전반 강화'], equipment:'머신', difficulty:'초급', keywords:['가슴','저중량','초보'], aliases:['체스트 프레스'], precautions:'', description:'손잡이를 앞으로 밀어냅니다. 저중량으로도 가능해 운동을 처음 시작하는 분에게도 적합합니다.' },
  { name:'케이블 우드촙', muscle_groups:['코어'], goals:['코어 강화','허리 라인 만들기'], equipment:'케이블 머신', difficulty:'중급', keywords:['코어','허리','라인'], aliases:['우드촙'], precautions:'허리가 아닌 코어 회전으로 움직이세요.', description:'케이블을 한쪽 위(또는 아래)에서 잡고 대각선으로 몸통을 회전하며 당깁니다.' },
  { name:'플랭크', muscle_groups:['코어','복부'], goals:['복부 코어 강화'], equipment:'맨몸', difficulty:'초급', keywords:['코어','복부','기구 없이','맨몸','허리 통증'], aliases:[], precautions:'엉덩이가 처지거나 너무 올라가지 않게 일직선을 유지합니다.', description:'팔꿈치와 발끝으로 몸을 지탱합니다. 기구 없이 맨몸으로 가능하고, 허리 통증이 있을 때도 비교적 안전한 코어 운동입니다.' },
  { name:'원암 덤벨로우', muscle_groups:['등'], goals:['좌우 비대칭 교정','어깨 비대칭 교정'], equipment:'덤벨', difficulty:'초급', keywords:['좌우','비대칭','어깨','덤벨'], aliases:['원암 로우'], precautions:'좌우를 번갈아 동일한 횟수로 진행하세요.', description:'한 손과 무릎을 벤치에 대고, 반대손으로 덤벨을 골반 옆으로 당깁니다. 좌우 비대칭이 있을 때 도움이 됩니다.' },
  { name:'밴드 풀어파트', muscle_groups:['등','어깨','자세 교정'], goals:['굽은 어깨 펴기','라운드숄더 교정'], equipment:'밴드', difficulty:'초급', keywords:['굽은 어깨','라운드숄더','자세','기구 없이','밴드'], aliases:['밴드 풀 어파트'], precautions:'', description:'밴드를 어깨너비로 잡고 팔을 양옆으로 벌려 등 견갑골을 모읍니다. 라운드숄더(굽은 어깨) 교정에 좋습니다.' },
  { name:'폼롤러 흉추 스트레칭', muscle_groups:['등','자세 교정'], goals:['거북목 교정','굽은 등 교정'], equipment:'폼롤러', difficulty:'초급', keywords:['거북목','굽은 등','자세','스트레칭','기구 없이'], aliases:['흉추 스트레칭'], precautions:'', description:'폼롤러를 등 중간(흉추)에 대고 누운 뒤, 팔을 머리 위로 뻗으며 상체를 살짝 젖혀 늘려줍니다.' },
  { name:'힙 어브덕션 머신', muscle_groups:['골반','엉덩이 옆쪽','중둔근'], goals:['골반 안정성','엉덩이 옆쪽 강화'], equipment:'머신', difficulty:'초급', keywords:['골반','밸런스','엉덩이 옆쪽','중둔근'], aliases:['힙 어브덕션'], precautions:'엉덩이 옆쪽(중둔근) 자극에 집중하세요.', description:'앉아서 패드를 무릎 바깥쪽에 대고 다리를 벌립니다.' },
  { name:'힙 어덕션 머신', muscle_groups:['골반','허벅지 안쪽'], goals:['허벅지 안쪽 근육 강화'], equipment:'머신', difficulty:'초급', keywords:['골반','밸런스','허벅지 안쪽'], aliases:['힙 어덕션'], precautions:'허벅지 안쪽 근육을 쓰는 느낌으로 진행하세요.', description:'앉아서 패드를 무릎 안쪽에 대고 다리를 모읍니다.' },
  { name:'한 발 브릿지', muscle_groups:['골반','코어','둔근'], goals:['좌우 비대칭 교정','골반 밸런스'], equipment:'맨몸', difficulty:'초급', keywords:['좌우','비대칭','골반','다리 길이','기구 없이'], aliases:['원레그 브릿지'], precautions:'좌우 번갈아 동일 횟수로 하세요.', description:'누운 상태에서 한쪽 다리를 들고, 반대쪽 다리로만 골반을 들어올립니다. 좌우 비대칭이 있을 때 도움이 됩니다.' }
];

function buildDocumentText(item){
  const parts = [
    `${item.name}${item.aliases.length ? ` (${item.aliases.join(', ')})` : ''}`,
    `부위: ${item.muscle_groups.join(', ')}`,
    `목적: ${item.goals.join(', ')}`,
    `기구: ${item.equipment}`,
    `난이도: ${item.difficulty}`,
    item.keywords.length ? `키워드: ${item.keywords.join(', ')}` : '',
    item.description,
    item.precautions ? `주의사항: ${item.precautions}` : ''
  ];
  return parts.filter(Boolean).join('. ');
}

function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

// 서버 시작 시 한 번만 임베딩 생성 (이미 있으면 건너뜀)
// 결제 수단 미등록 Voyage 계정은 분당 3회로 제한되므로, 요청 사이에 대기 시간을 둠 (VOYAGE_REQUEST_DELAY_MS로 조절 가능)
async function ensureLibraryEmbeddings(){
  if (!VOYAGE_API_KEY) return;
  try {
    const { count } = await supabaseAdmin.from('exercise_embeddings').select('*', { count: 'exact', head: true });
    if (count && count > 0) return;
    const delayMs = Number(process.env.VOYAGE_REQUEST_DELAY_MS || 21000);
    console.log(`운동사전 임베딩 생성 중... (최초 1회, 약 ${Math.ceil(EXERCISE_LIBRARY_SEED.length * delayMs / 1000 / 60)}분 소요 예상)`);
    let failCount = 0;
    for (let i = 0; i < EXERCISE_LIBRARY_SEED.length; i++) {
      const item = EXERCISE_LIBRARY_SEED[i];
      const documentText = buildDocumentText(item);
      try {
        const embedding = await embedText(documentText, 'document');
        const { error } = await supabaseAdmin.from('exercise_embeddings').upsert({ name: item.name, content: documentText, embedding });
        if (error) throw error;
        console.log(`  (${i + 1}/${EXERCISE_LIBRARY_SEED.length}) ${item.name} 완료`);
      } catch (itemErr) {
        failCount++;
        console.error(`  (${i + 1}/${EXERCISE_LIBRARY_SEED.length}) ${item.name} 저장 실패:`, itemErr.message || itemErr);
      }
      if (i < EXERCISE_LIBRARY_SEED.length - 1) await sleep(delayMs);
    }
    if (failCount > 0) {
      console.warn(`⚠️  운동사전 임베딩 ${failCount}개 저장 실패 — 위 로그를 확인하세요. (전체 성공이 아니면 검색 결과가 불완전할 수 있어요)`);
    } else {
      console.log('운동사전 임베딩 생성 완료 (전체 성공)');
    }
  } catch (e) {
    console.warn('임베딩 생성 실패:', e.message || e);
  }
}

app.get('/api/library-search', requireUser, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const mode = (req.query.mode || 'vector').toString(); // 'vector'(기존) | 'hybrid'(개선판) | 'rerank'(하이브리드 + LLM 재정렬)
  if (!q) return res.status(400).json({ error: '검색어가 필요해요.' });
  if (!VOYAGE_API_KEY) return res.status(500).json({ error: '서버에 VOYAGE_API_KEY가 설정되지 않았어요.' });

  try {
    const queryEmbedding = await embedText(q, 'query');
    if (mode === 'rerank') {
      const { data, error } = await supabaseAdmin.rpc('match_exercises_hybrid', {
        query_embedding: queryEmbedding,
        query_text: q,
        match_count: Number(process.env.RERANK_CANDIDATES || 10),
        vector_weight: Number(process.env.VECTOR_WEIGHT || 0.7),
        keyword_weight: Number(process.env.KEYWORD_WEIGHT || 0.3)
      });
      if (error) throw error;
      const { names, usedFallback } = await rerankCandidates(ANTHROPIC_API_KEY, q, data, 5);
      const byName = Object.fromEntries(data.map(r => [r.name, r]));
      return res.json({ results: names.map(n => byName[n]), mode: 'rerank', usedFallback });
    }
    if (mode === 'hybrid') {
      const { data, error } = await supabaseAdmin.rpc('match_exercises_hybrid', {
        query_embedding: queryEmbedding,
        query_text: q,
        match_count: 5,
        vector_weight: Number(process.env.VECTOR_WEIGHT || 0.7),
        keyword_weight: Number(process.env.KEYWORD_WEIGHT || 0.3)
      });
      if (error) throw error;
      return res.json({ results: data, mode: 'hybrid' });
    }
    const { data, error } = await supabaseAdmin.rpc('match_exercises', { query_embedding: queryEmbedding, match_count: 5 });
    if (error) throw error;
    res.json({ results: data, mode: 'vector' });
  } catch (err) {
    console.error('library search failed:', err);
    res.status(500).json({ error: '검색에 실패했어요.' });
  }
});

app.post('/api/journal-extract', requireUser, async (req, res) => {
  const { note } = req.body || {};
  if (!note || !note.trim()) return res.status(400).json({ error: '내용이 필요해요.' });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았어요.' });

  const { today, currentCount } = await getUsageToday(req.user.id);
  if (currentCount >= DAILY_COACH_LIMIT) {
    return res.status(429).json({ error: `오늘 AI 기능 사용 횟수(${DAILY_COACH_LIMIT}회)를 다 쓰셨어요.` });
  }

  const system = [
    '너는 운동 기록 텍스트에서 정보를 추출하는 도구야. 반드시 아래 JSON 형식으로만 답해. 다른 말은 절대 하지 마.',
    '{"muscle_groups": ["하체" 등 목록], "exercises": ["운동 이름" 등 목록]}',
    'muscle_groups 후보: 하체, 등·어깨, 가슴, 코어, 팔, 유산소, 기타',
    '언급된 내용이 없으면 빈 배열로 답해.'
  ].join(' ');

  try {
    const { ok, status, data } = await callAnthropic(system, [{ role: 'user', content: note }]);
    if (!ok) return res.status(status).json({ error: '분석에 실패했어요.' });
    const textOut = (data.content || []).map(b => b.type === 'text' ? b.text : '').join('').trim();
    let parsed;
    try { parsed = JSON.parse(textOut); } catch (e) { parsed = { muscle_groups: [], exercises: [] }; }
    await incrementUsage(req.user.id, today, currentCount);
    res.json(parsed);
  } catch (err) {
    console.error('journal extract failed:', err);
    res.status(500).json({ error: '분석 중 오류가 발생했어요.' });
  }
});

app.post('/api/photo-feedback', requireUser, async (req, res) => {
  const { imageBase64, mediaType } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: '이미지가 필요해요.' });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았어요.' });

  const { today, currentCount } = await getUsageToday(req.user.id);
  if (currentCount >= DAILY_COACH_LIMIT) {
    return res.status(429).json({ error: `오늘 AI 기능 사용 횟수(${DAILY_COACH_LIMIT}회)를 다 쓰셨어요.` });
  }

  const system = '너는 체형 측정용 사진의 "촬영 품질"만 짧게 평가하는 도우미야. 밝기, 전신이 잘 나왔는지, 정면 여부만 2~3문장으로 짧게 한국어로 평가해줘. 체형이나 몸매, 외모에 대한 평가는 절대 하지 말고 오직 촬영 품질(밝기/구도/각도)만 평가해.';

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: '이 사진의 촬영 품질을 평가해줘.' }
          ]
        }]
      })
    });
    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      console.error('photo feedback API error:', data);
      return res.status(anthropicRes.status).json({ error: '평가에 실패했어요.' });
    }
    await incrementUsage(req.user.id, today, currentCount);
    res.json(data);
  } catch (err) {
    console.error('photo feedback failed:', err);
    res.status(500).json({ error: '평가 중 오류가 발생했어요.' });
  }
});

app.post('/api/coach-stream', requireUser, async (req, res) => {
  const { system, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).end();
  if (!ANTHROPIC_API_KEY) return res.status(500).end();

  const { today, currentCount } = await getUsageToday(req.user.id);
  if (currentCount >= DAILY_COACH_LIMIT) {
    res.status(429).json({ error: `오늘 AI 코치 사용 횟수(${DAILY_COACH_LIMIT}회)를 다 쓰셨어요. 내일 다시 이용해 주세요.` });
    return;
  }

  let journalNote = '';
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: entries } = await supabaseAdmin
      .from('journal_entries')
      .select('entry_date, note')
      .eq('user_id', req.user.id)
      .gte('entry_date', sevenDaysAgo)
      .order('entry_date', { ascending: true });
    journalNote = entries && entries.length
      ? ' 최근 7일 실제 운동 기록: ' + entries.map(e => `${e.entry_date}: ${e.note}`).join(' / ')
      : ' 최근 7일간 운동 기록장에 기록된 내용이 없음.';
  } catch (e) {
    console.warn('journal fetch for coach-stream failed:', e);
  }

  const fullSystem = (system || '') + journalNote;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, system: fullSystem, messages, stream: true })
    });

    if (!anthropicRes.ok || !anthropicRes.body) {
      res.write(`data: ${JSON.stringify({ error: '코치 응답을 받아오지 못했어요.' })}

`);
      res.end();
      return;
    }

    const reader = anthropicRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(String.fromCharCode(10));
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === 'content_block_delta' && evt.delta && evt.delta.text) {
            res.write(`data: ${JSON.stringify({ text: evt.delta.text })}

`);
          }
        } catch (e) { /* ignore malformed SSE line */ }
      }
    }
    await incrementUsage(req.user.id, today, currentCount);
    res.write(`data: ${JSON.stringify({ done: true })}

`);
    res.end();
  } catch (err) {
    console.error('coach stream failed:', err);
    res.write(`data: ${JSON.stringify({ error: '코치 요청 중 오류가 발생했어요.' })}

`);
    res.end();
  }
});

app.post('/api/coach', requireUser, async (req, res) => {
  const { system, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages가 필요해요.' });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았어요.' });
  }

  const { today, currentCount } = await getUsageToday(req.user.id);
  if (currentCount >= DAILY_COACH_LIMIT) {
    return res.status(429).json({ error: `오늘 AI 코치에게 물어볼 수 있는 횟수(${DAILY_COACH_LIMIT}회)를 다 쓰셨어요. 내일 다시 이용해 주세요.` });
  }

  let journalNote = '';
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: entries } = await supabaseAdmin
      .from('journal_entries')
      .select('entry_date, note')
      .eq('user_id', req.user.id)
      .gte('entry_date', sevenDaysAgo)
      .order('entry_date', { ascending: true });

    journalNote = entries && entries.length
      ? '\n\n최근 7일 실제 운동 기록:\n' + entries.map(e => `- ${e.entry_date}: ${e.note}`).join('\n')
      : '\n\n최근 7일간 운동 기록장에 기록된 내용이 없음 (아직 안 썼거나 쉬는 중).';
  } catch (e) {
    console.warn('journal fetch for coach failed:', e);
  }

  const fullSystem = (system || '') + journalNote;

  try {
    const { ok, status, data } = await callAnthropic(fullSystem, messages);
    if (!ok) {
      console.error('Anthropic API error:', data);
      return res.status(status).json({ error: '코치 응답을 받아오지 못했어요.', detail: data });
    }
    await incrementUsage(req.user.id, today, currentCount);
    res.json(data);
  } catch (err) {
    console.error('coach proxy failed:', err);
    res.status(500).json({ error: '코치 요청 중 오류가 발생했어요.' });
  }
});

app.post('/api/report', requireUser, async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았어요.' });
  }

  const { today, currentCount } = await getUsageToday(req.user.id);
  if (currentCount >= DAILY_COACH_LIMIT) {
    return res.status(429).json({ error: `오늘 AI 기능 사용 횟수(${DAILY_COACH_LIMIT}회)를 다 쓰셨어요. 내일 다시 이용해 주세요.` });
  }

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgoDate = thirtyDaysAgo.slice(0, 10);

    const { data: measurements } = await supabaseAdmin
      .from('measurements')
      .select('measured_at, body_type, shoulder_hip_ratio, shoulder_tilt, hip_tilt')
      .eq('user_id', req.user.id)
      .gte('measured_at', thirtyDaysAgo)
      .order('measured_at', { ascending: true });

    const { data: journal } = await supabaseAdmin
      .from('journal_entries')
      .select('entry_date, note')
      .eq('user_id', req.user.id)
      .gte('entry_date', thirtyDaysAgoDate)
      .order('entry_date', { ascending: true });

    const { data: goal } = await supabaseAdmin
      .from('goals')
      .select('goal_text, target_date')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if ((!measurements || !measurements.length) && (!journal || !journal.length)) {
      return res.status(400).json({ error: '최근 30일간 측정이나 운동 기록이 없어서 리포트를 만들 수 없어요.' });
    }

    const measurementSummary = measurements && measurements.length
      ? measurements.map(m => `- ${m.measured_at.slice(0,10)}: ${m.body_type}, 어깨:골반 ${Number(m.shoulder_hip_ratio).toFixed(2)}`).join('\n')
      : '측정 기록 없음';
    const journalSummary = journal && journal.length
      ? journal.map(j => `- ${j.entry_date}: ${j.note}`).join('\n')
      : '운동 기록 없음';
    const goalLine = goal?.goal_text ? `목표: ${goal.goal_text}${goal.target_date ? ` (목표일: ${goal.target_date})` : ''}` : '설정된 목표 없음';

    const system = [
      '너는 친근한 한국어 헬스 코치야. 사용자의 최근 30일 데이터를 보고 짧은 리포트를 써줘.',
      goalLine,
      `최근 30일 측정 기록:
${measurementSummary}`,
      `최근 30일 운동 기록:
${journalSummary}`,
      '리포트는 다음 순서로 써줘: 1) 이번 기간 요약(2~3문장) 2) 잘한 점 3) 아쉬운 점 또는 놓친 부분 4) 다음 달 제안 1~2가지.',
      '체중감량/칼로리/식단 수치는 다루지 말고 운동·자세·꾸준함 중심으로만 써줘. 너무 길지 않게, 300자 내외로 요약해줘.'
    ].join('\n\n');

    const { ok, status, data } = await callAnthropic(system, [{ role: 'user', content: '리포트를 만들어줘.' }]);
    if (!ok) {
      console.error('Anthropic report error:', data);
      return res.status(status).json({ error: '리포트를 만들지 못했어요.', detail: data });
    }
    await incrementUsage(req.user.id, today, currentCount);
    res.json(data);
  } catch (err) {
    console.error('report generation failed:', err);
    res.status(500).json({ error: '리포트 생성 중 오류가 발생했어요.' });
  }
});

app.get('/api/youtube-search', requireUser, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: '검색어가 필요해요.' });
  if (!YOUTUBE_API_KEY) return res.status(500).json({ error: '서버에 YOUTUBE_API_KEY가 설정되지 않았어요.' });

  try {
    const { data: cached } = await supabaseAdmin
      .from('youtube_cache')
      .select('results, cached_at')
      .eq('query', q)
      .maybeSingle();

    const cacheAgeDays = cached ? (Date.now() - new Date(cached.cached_at).getTime()) / (1000 * 60 * 60 * 24) : Infinity;
    if (cached && cacheAgeDays < YOUTUBE_CACHE_DAYS) {
      return res.json({ results: cached.results, cached: true });
    }

    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('key', YOUTUBE_API_KEY);
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', `${q} 사용법`);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', '3');
    searchUrl.searchParams.set('relevanceLanguage', 'ko');
    searchUrl.searchParams.set('safeSearch', 'strict');

    const ytRes = await fetch(searchUrl.toString());
    const ytData = await ytRes.json();
    if (!ytRes.ok) {
      console.error('YouTube API error:', ytData);
      return res.status(ytRes.status).json({ error: '영상을 불러오지 못했어요.' });
    }

    const results = (ytData.items || []).map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || ''
    }));

    await supabaseAdmin.from('youtube_cache').upsert(
      { query: q, results, cached_at: new Date().toISOString() },
      { onConflict: 'query' }
    );

    res.json({ results, cached: false });
  } catch (err) {
    console.error('youtube search failed:', err);
    res.status(500).json({ error: '영상 검색 중 오류가 발생했어요.' });
  }
});

app.delete('/api/account', requireUser, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('account delete failed:', err);
    res.status(500).json({ error: '계정 삭제에 실패했어요.' });
  }
});

// SPA 폴백: /api 이외의 경로는 index.html로
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
  ensureLibraryEmbeddings();
});

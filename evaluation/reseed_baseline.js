// 정식 baseline 측정용 — 원래(개선 전) 운동 설명으로 임베딩을 임시로 되돌려서 저장하는 스크립트.
// 백엔드 서버를 안 건드리고 Supabase/Voyage에 직접 연결해서 exercise_embeddings 테이블만 덮어씀.
//
// 실행: node reseed_baseline.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', 'backend', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const DELAY_MS = Number(process.env.VOYAGE_REQUEST_DELAY_MS || 21000);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !VOYAGE_API_KEY) {
  console.error('backend/.env 의 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VOYAGE_API_KEY가 필요해요.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// 개선 전(baseline) 원본 운동 설명 — 데이터 보강 이전 버전 그대로
const ORIGINAL_LIBRARY = [
  { name:'레그프레스', content:'하체 운동. 등받이에 등을 붙이고 발판을 어깨너비로 밟은 뒤 무릎을 밀어냅니다. 허벅지와 둔근을 키우고 싶을 때.' },
  { name:'스미스머신 스쿼트', content:'하체 운동. 바를 어깨에 걸치고 무릎과 엉덩이를 굽혀 앉았다 일어납니다. 하체 전반, 허벅지 볼륨.' },
  { name:'레그컬 머신', content:'하체 운동. 패드를 발목 뒤에 걸고 무릎을 굽혀 당깁니다. 허벅지 뒤쪽 햄스트링 강화.' },
  { name:'레그익스텐션', content:'하체 운동. 패드를 발목 앞에 걸고 무릎을 펴서 다리를 듭니다. 허벅지 앞쪽 대퇴사두근 강화. 무릎이 약할 때는 중량을 낮게.' },
  { name:'힙쓰러스트 머신', content:'하체 운동. 골반을 위로 밀어올려 엉덩이를 조입니다. 둔근(엉덩이) 강화, 힙업.' },
  { name:'런지', content:'하체 운동. 한 발을 앞으로 내딛고 무릎을 굽혔다 원위치. 허벅지, 둔근, 균형 감각.' },
  { name:'랫풀다운', content:'등·어깨 운동. 바를 가슴 쪽으로 당깁니다. 등 넓히기, 어깨 넓어 보이게.' },
  { name:'사이드 레터럴레이즈 머신', content:'어깨 운동. 팔을 옆으로 들어올립니다. 어깨 측면 삼각근, 어깨 넓어 보이게.' },
  { name:'숄더프레스 머신', content:'어깨 운동. 손잡이를 머리 위로 밀어올립니다. 어깨 전반 강화.' },
  { name:'시티드 로우 머신', content:'등 운동. 손잡이를 몸 쪽으로 당겨 견갑골을 모읍니다. 등 두께, 자세 교정.' },
  { name:'케이블 크로스오버', content:'가슴 운동. 케이블을 앞으로 모아 당깁니다. 가슴 안쪽 라인.' },
  { name:'체스트프레스', content:'가슴 운동. 손잡이를 앞으로 밀어냅니다. 가슴 전반 강화, 저중량으로도 가능.' },
  { name:'케이블 우드촙', content:'코어 운동. 대각선으로 몸통을 회전하며 당깁니다. 코어, 허리 라인.' },
  { name:'플랭크', content:'코어 운동. 팔꿈치와 발끝으로 버팁니다. 복부 코어, 기구 없이 맨몸으로 가능. 허리 통증 있을 때도 비교적 안전.' },
  { name:'원암 덤벨로우', content:'등 운동, 자세 교정. 한 손으로 덤벨을 당깁니다. 좌우 비대칭 교정, 어깨 비대칭.' },
  { name:'밴드 풀어파트', content:'자세 교정 운동. 밴드를 양옆으로 벌립니다. 굽은 어깨(라운드 숄더) 교정, 기구 없이 가능.' },
  { name:'폼롤러 흉추 스트레칭', content:'자세 교정 스트레칭. 등 중간을 늘려줍니다. 거북목, 굽은 등 교정, 통증 완화.' },
  { name:'힙 어브덕션 머신', content:'골반 밸런스 운동. 다리를 옆으로 벌립니다. 엉덩이 옆쪽 중둔근, 골반 안정성.' },
  { name:'힙 어덕션 머신', content:'골반 밸런스 운동. 다리를 모읍니다. 허벅지 안쪽 근육.' },
  { name:'한 발 브릿지', content:'골반 밸런스, 코어 운동. 한 다리로 골반을 들어올립니다. 좌우 비대칭 교정, 기구 없이 가능.' }
];

async function embedText(text) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VOYAGE_API_KEY}` },
    body: JSON.stringify({ input: [text], model: 'voyage-3-lite', input_type: 'document' })
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || data.detail || JSON.stringify(data));
  return data.data[0].embedding;
}

async function main() {
  console.log(`\n원본(개선 전) 운동 설명으로 임베딩 되돌리는 중... (${ORIGINAL_LIBRARY.length}개, 약 ${Math.ceil(ORIGINAL_LIBRARY.length * DELAY_MS / 1000 / 60)}분 소요)\n`);
  let failCount = 0;
  for (let i = 0; i < ORIGINAL_LIBRARY.length; i++) {
    const item = ORIGINAL_LIBRARY[i];
    try {
      const embedding = await embedText(`${item.name}: ${item.content}`);
      const { error } = await supabase.from('exercise_embeddings').upsert({ name: item.name, content: item.content, embedding });
      if (error) throw error;
      console.log(`  (${i + 1}/${ORIGINAL_LIBRARY.length}) ${item.name} 완료`);
    } catch (err) {
      failCount++;
      console.error(`  (${i + 1}/${ORIGINAL_LIBRARY.length}) ${item.name} 실패:`, err.message);
    }
    if (i < ORIGINAL_LIBRARY.length - 1) await sleep(DELAY_MS);
  }
  if (failCount > 0) {
    console.warn(`\n⚠️  ${failCount}개 실패했어요. 위 로그를 확인하고 필요하면 다시 실행하세요 (upsert라서 다시 돌려도 안전해요).`);
  } else {
    console.log('\n✅ 원본(baseline) 임베딩으로 되돌리기 완료. 이제 node evaluate_search.js baseline 을 실행하세요.\n');
  }
}

main().catch(err => { console.error(err); process.exit(1); });

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(__dirname, 'results');

function load(name) {
  const p = path.join(resultsDir, `${name}.json`);
  if (!fs.existsSync(p)) {
    console.error(`evaluation/results/${name}.json 이 없어요. 먼저 다음을 실행하세요: node evaluate_search.js ${name}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

const baseline = load('baseline');
const improved = load('improved');

function fmtPct(v) { return `${v.toFixed(1)}%`; }
function fmtMs(v) { return `${v.toFixed(0)}ms`; }
function diffPctP(a, b) { const d = b - a; return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%p`; }
function diffMs(a, b) { const d = b - a; return `${d >= 0 ? '+' : ''}${d.toFixed(0)}ms`; }
function diffNum(a, b) { const d = b - a; return `${d >= 0 ? '+' : ''}${d.toFixed(3)}`; }

const b = baseline.metrics, i = improved.metrics;

const table = [
  '========== BodyLab Search Evaluation ==========',
  '',
  `평가 질의 수: ${b.n}개`,
  '',
  'Metric        Baseline    Improved    Change',
  `Hit@1         ${fmtPct(b.hit1Pct).padEnd(12)}${fmtPct(i.hit1Pct).padEnd(12)}${diffPctP(b.hit1Pct, i.hit1Pct)}`,
  `Recall@3      ${fmtPct(b.recall3Pct).padEnd(12)}${fmtPct(i.recall3Pct).padEnd(12)}${diffPctP(b.recall3Pct, i.recall3Pct)}`,
  `Recall@5      ${fmtPct(b.recall5Pct).padEnd(12)}${fmtPct(i.recall5Pct).padEnd(12)}${diffPctP(b.recall5Pct, i.recall5Pct)}`,
  `MRR@5         ${b.mrr5.toFixed(3).padEnd(12)}${i.mrr5.toFixed(3).padEnd(12)}${diffNum(b.mrr5, i.mrr5)}`,
  `Avg Latency   ${fmtMs(b.avgLatencyMs).padEnd(12)}${fmtMs(i.avgLatencyMs).padEnd(12)}${diffMs(b.avgLatencyMs, i.avgLatencyMs)}`,
  `P95 Latency   ${fmtMs(b.p95LatencyMs).padEnd(12)}${fmtMs(i.p95LatencyMs)}`,
  '',
  '===============================================',
  ''
].join('\n');

console.log('\n' + table);
fs.writeFileSync(path.join(resultsDir, 'comparison.txt'), table);

/* ---------- 오류 분석 ---------- */
function isHit(item) {
  const gold = new Set(item.gold);
  return item.results.slice(0, 5).some(r => gold.has(r.name));
}

const baseByQuery = Object.fromEntries(baseline.perQuery.map(q => [q.query, q]));

const nowHit = [];
const stillFailing = [];

for (const q of improved.perQuery) {
  const baseQ = baseByQuery[q.query];
  const wasHitBefore = baseQ ? isHit(baseQ) : false;
  const isHitNow = isHit(q);
  if (!wasHitBefore && isHitNow) nowHit.push({ q, baseQ });
  if (!isHitNow) stillFailing.push(q);
}

let md = '# 검색 개선 오류 분석\n\n';
md += `Baseline 평가 질의 수: ${baseline.metrics.n}개, Improved 평가 질의 수: ${improved.metrics.n}개\n\n`;

md += `## Baseline에서는 실패했지만 Improved에서는 성공한 질의 (${nowHit.length}개)\n\n`;
md += '| 유형 | 질의 | 정답 | Baseline Top5 | Improved Top5 |\n|---|---|---|---|---|\n';
for (const { q, baseQ } of nowHit) {
  const baseTop5 = (baseQ?.results || []).map(r => r.name).join(', ');
  const impTop5 = q.results.map(r => r.name).join(', ');
  md += `| ${q.type} | ${q.query} | ${q.gold.join(', ')} | ${baseTop5} | ${impTop5} |\n`;
}

md += `\n## Improved에서도 계속 실패하는 질의 (${stillFailing.length}개)\n\n`;
md += '| 유형 | 질의 | 정답 | Improved Top5 |\n|---|---|---|---|\n';
for (const q of stillFailing) {
  md += `| ${q.type} | ${q.query} | ${q.gold.join(', ')} | ${q.results.map(r => r.name).join(', ')} |\n`;
}

fs.writeFileSync(path.join(resultsDir, 'error_analysis.md'), md);
console.log(`저장됨: evaluation/results/error_analysis.md`);
console.log(`저장됨: evaluation/results/comparison.txt`);

/* ---------- README에 바로 붙여넣을 수 있는 표 생성 ---------- */
const readmeSnippet = `## Search Performance Evaluation

운동사전 AI 검색(RAG)의 품질을 자체 제작한 벤치마크로 정량 측정했습니다.

- **평가 데이터**: 자연어 질의 ${b.n}개 (정확한 운동명 / 부위 기반 / 목적 기반 / 자연어 표현 / 동의어·우회 표현 / 기구 유무 조건 / 자세교정 목적 / 복합 조건 8개 유형)
- **평가 방법**: 각 질의에 대해 상위 5개 검색 결과와 정답(gold label) 비교, Hit@1 / Recall@3 / Recall@5 / MRR@5 / 응답 지연시간 측정
- **Baseline**: Voyage AI 임베딩(512차원) 기반 벡터 유사도 검색 (기존 운영 방식)
- **개선 방법**: 벡터 유사도 + PostgreSQL trigram 기반 키워드 유사도를 가중합(Hybrid Search)한 방식으로 재순위화, 운동 메타데이터(부위/목적/기구/동의어 등) 보강 후 재임베딩

| Metric | Baseline | Improved | Change |
|---|---|---|---|
| Hit@1 | ${fmtPct(b.hit1Pct)} | ${fmtPct(i.hit1Pct)} | ${diffPctP(b.hit1Pct, i.hit1Pct)} |
| Recall@3 | ${fmtPct(b.recall3Pct)} | ${fmtPct(i.recall3Pct)} | ${diffPctP(b.recall3Pct, i.recall3Pct)} |
| Recall@5 | ${fmtPct(b.recall5Pct)} | ${fmtPct(i.recall5Pct)} | ${diffPctP(b.recall5Pct, i.recall5Pct)} |
| MRR@5 | ${b.mrr5.toFixed(3)} | ${i.mrr5.toFixed(3)} | ${diffNum(b.mrr5, i.mrr5)} |
| Avg Latency | ${fmtMs(b.avgLatencyMs)} | ${fmtMs(i.avgLatencyMs)} | ${diffMs(b.avgLatencyMs, i.avgLatencyMs)} |
| P95 Latency | ${fmtMs(b.p95LatencyMs)} | ${fmtMs(i.p95LatencyMs)} | - |

실행 방법: [evaluation/README.md](./evaluation/README.md) 참고
`;

fs.writeFileSync(path.join(resultsDir, 'README_snippet.md'), readmeSnippet);
console.log(`저장됨: evaluation/results/README_snippet.md (이 내용을 README.md에 그대로 붙여넣으면 돼요)\n`);

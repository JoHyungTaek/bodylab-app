import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const load = n => {
  const p = path.join(dir, `${n}.json`);
  if (!fs.existsSync(p)) { console.error(`results/${n}.json 이 없어요.`); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
};
const [b, i, r] = ['baseline', 'improved', 'rerank'].map(load);
const f = v => `${v.toFixed(1)}%`.padEnd(11);
const row = (name, k) => `${name.padEnd(13)}${f(b.metrics[k])}${f(i.metrics[k])}${f(r.metrics[k])}`;
const lines = [
  `평가 질의 수: ${r.metrics.n}`, '',
  'Metric       Baseline   Hybrid     Hybrid+Rerank',
  row('Hit@1', 'hit1Pct'), row('Recall@3', 'recall3Pct'), row('Recall@5', 'recall5Pct'),
  `${'MRR@5'.padEnd(13)}${b.metrics.mrr5.toFixed(3).padEnd(11)}${i.metrics.mrr5.toFixed(3).padEnd(11)}${r.metrics.mrr5.toFixed(3)}`,
  `${'Avg latency'.padEnd(13)}${(b.metrics.avgLatencyMs.toFixed(0) + 'ms').padEnd(11)}${(i.metrics.avgLatencyMs.toFixed(0) + 'ms').padEnd(11)}${r.metrics.avgLatencyMs.toFixed(0)}ms`,
  `${'P95 latency'.padEnd(13)}${(b.metrics.p95LatencyMs.toFixed(0) + 'ms').padEnd(11)}${(i.metrics.p95LatencyMs.toFixed(0) + 'ms').padEnd(11)}${r.metrics.p95LatencyMs.toFixed(0)}ms`,
  '', '※ rerank 지연에는 임베딩 캐시 적중분(Voyage 호출 생략)이 섞여 있을 수 있음 → 지연 비교는 참고용.'
];

// 질의별 변화: 하이브리드 대비 rerank가 top1을 고친/망친 경우
const goldHit1 = q => q.results[0] && new Set(q.gold).has(q.results[0].name);
const iMap = Object.fromEntries(i.perQuery.map(q => [q.query, q]));
const fixed = [], broken = [];
for (const q of r.perQuery) {
  const h = iMap[q.query]; if (!h) continue;
  if (!goldHit1(h) && goldHit1(q)) fixed.push(q.query);
  if (goldHit1(h) && !goldHit1(q)) broken.push(q.query);
}
lines.push('', `Hit@1 개선(hybrid 오답→rerank 정답): ${fixed.length}개`, ...fixed.map(x => `  + ${x}`),
  `Hit@1 악화(hybrid 정답→rerank 오답): ${broken.length}개`, ...broken.map(x => `  - ${x}`));
const out = lines.join('\n');
console.log('\n' + out + '\n');
fs.writeFileSync(path.join(dir, 'comparison_rerank.txt'), out);

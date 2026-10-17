import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { rerankCandidates } from '../backend/rerank.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// backend/.env 를 그대로 읽어서 씀 (API 키를 이 코드나 별도 .env에 새로 넣지 않아도 됨)
dotenv.config({ path: path.join(__dirname, '..', 'backend', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RERANK_CANDIDATES = Number(process.env.RERANK_CANDIDATES || 10);
const VECTOR_WEIGHT = Number(process.env.VECTOR_WEIGHT || 0.7);
const KEYWORD_WEIGHT = Number(process.env.KEYWORD_WEIGHT || 0.3);
// 결제수단 미등록 Voyage 계정(분당 3회 제한)일 때 429를 피하려면 21000(21초) 정도로 설정
const VOYAGE_REQUEST_DELAY_MS = Number(process.env.VOYAGE_REQUEST_DELAY_MS || 0);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('backend/.env 의 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요해요.');
  process.exit(1);
}
if (process.argv[2] === 'rerank' && !ANTHROPIC_API_KEY) {
  console.error('backend/.env 의 ANTHROPIC_API_KEY가 필요해요.');
  process.exit(1);
}
if (!VOYAGE_API_KEY) {
  console.error('backend/.env 의 VOYAGE_API_KEY가 필요해요.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// 질의 임베딩 캐시: 같은 질의를 다시 임베딩하지 않아 Voyage 호출/대기시간을 아낀다(결과에는 영향 없음).
const CACHE_PATH = path.join(__dirname, 'results', 'query_embeddings_cache.json');
let embCache = {};
try { embCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')); } catch (e) { embCache = {}; }
let lastEmbedWasCached = false;

async function embedQuery(text) {
  if (embCache[text]) { lastEmbedWasCached = true; return embCache[text]; }
  lastEmbedWasCached = false;
  const emb = await embedQueryRemote(text);
  embCache[text] = emb;
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(embCache));
  return emb;
}

async function embedQueryRemote(text) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VOYAGE_API_KEY}` },
    body: JSON.stringify({ input: [text], model: 'voyage-3-lite', input_type: 'query' })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data.error && data.error.message) || data.detail || JSON.stringify(data));
  }
  return data.data[0].embedding;
}

async function searchBaseline(query) {
  const embedding = await embedQuery(query);
  const { data, error } = await supabase.rpc('match_exercises', { query_embedding: embedding, match_count: 5 });
  if (error) throw error;
  return data.map(r => ({ name: r.name, score: r.similarity }));
}

async function searchRerank(query) {
  const embedding = await embedQuery(query);
  const { data, error } = await supabase.rpc('match_exercises_hybrid', {
    query_embedding: embedding,
    query_text: query,
    match_count: RERANK_CANDIDATES,
    vector_weight: VECTOR_WEIGHT,
    keyword_weight: KEYWORD_WEIGHT
  });
  if (error) throw error;
  const { names, usedFallback } = await rerankCandidates(ANTHROPIC_API_KEY, query, data, 5);
  if (usedFallback) console.warn('  ⚠ rerank 실패 → 하이브리드 순서로 대체됨');
  return names.map(n => ({ name: n, score: null }));
}

async function searchHybrid(query) {
  const embedding = await embedQuery(query);
  const { data, error } = await supabase.rpc('match_exercises_hybrid', {
    query_embedding: embedding,
    query_text: query,
    match_count: 5,
    vector_weight: VECTOR_WEIGHT,
    keyword_weight: KEYWORD_WEIGHT
  });
  if (error) throw error;
  return data.map(r => ({ name: r.name, score: r.hybrid_score }));
}

function computeMetrics(perQuery) {
  const n = perQuery.length;
  let hit1 = 0, recall3 = 0, recall5 = 0, rrSum = 0;
  const latencies = [];

  for (const r of perQuery) {
    const gold = new Set(r.gold);
    const names = r.results.map(x => x.name);
    if (names[0] && gold.has(names[0])) hit1++;
    if (names.slice(0, 3).some(nm => gold.has(nm))) recall3++;
    if (names.slice(0, 5).some(nm => gold.has(nm))) recall5++;
    const rank = names.slice(0, 5).findIndex(nm => gold.has(nm));
    rrSum += rank === -1 ? 0 : 1 / (rank + 1);
    latencies.push(r.latencyMs);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(n * 0.5)] ?? sorted[sorted.length - 1];
  const p95 = sorted[Math.floor(n * 0.95)] ?? sorted[sorted.length - 1];
  const avg = latencies.reduce((a, b) => a + b, 0) / n;

  return {
    n,
    hit1Pct: (hit1 / n) * 100,
    recall3Pct: (recall3 / n) * 100,
    recall5Pct: (recall5 / n) * 100,
    mrr5: rrSum / n,
    avgLatencyMs: avg,
    p50LatencyMs: p50,
    p95LatencyMs: p95
  };
}

function toCSV(perQuery) {
  const header = 'query,type,gold_labels,top1,hit1,recall3,reciprocal_rank,latency_ms,top5_results\n';
  const rows = perQuery.map(r => {
    const gold = new Set(r.gold);
    const names = r.results.map(x => x.name);
    const top1 = names[0] || '';
    const hit1 = top1 && gold.has(top1) ? 1 : 0;
    const recall3 = names.slice(0, 3).some(nm => gold.has(nm)) ? 1 : 0;
    const rank = names.slice(0, 5).findIndex(nm => gold.has(nm));
    const rr = rank === -1 ? 0 : 1 / (rank + 1);
    const esc = s => `"${String(s).replace(/"/g, '""')}"`;
    return [
      esc(r.query), esc(r.type), esc(r.gold.join('|')), esc(top1),
      hit1, recall3, rr.toFixed(4), r.latencyMs, esc(names.join('|'))
    ].join(',');
  });
  return header + rows.join('\n') + '\n';
}

async function runEvaluation(searchFn, label, benchmark) {
  const perQuery = [];
  for (let i = 0; i < benchmark.length; i++) {
    const item = benchmark[i];
    const start = Date.now();
    let results = [];
    try {
      results = await searchFn(item.query);
    } catch (err) {
      console.error(`  [${i + 1}/${benchmark.length}] "${item.query}" 검색 실패: ${err.message}`);
    }
    const latencyMs = Date.now() - start;
    perQuery.push({
      query: item.query,
      type: item.type,
      gold: item.relevant_exercises,
      results,
      latencyMs
    });
    console.log(`  [${i + 1}/${benchmark.length}] "${item.query}" (${latencyMs}ms) → ${results.map(r => r.name).join(', ') || '(결과 없음)'}`);
    if (VOYAGE_REQUEST_DELAY_MS > 0 && !lastEmbedWasCached && i < benchmark.length - 1) await sleep(VOYAGE_REQUEST_DELAY_MS);
  }
  return { metrics: computeMetrics(perQuery), perQuery };
}

async function main() {
  const mode = process.argv[2];
  if (!mode || !['baseline', 'improved', 'rerank'].includes(mode)) {
    console.error('사용법: node evaluate_search.js baseline | improved | rerank');
    process.exit(1);
  }

  const benchmarkPath = path.join(__dirname, 'search_benchmark.json');
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf-8'));

  console.log(`\n=== ${mode} 평가 시작 (질의 ${benchmark.length}개) ===\n`);
  const searchFn = mode === 'baseline' ? searchBaseline : mode === 'rerank' ? searchRerank : searchHybrid;
  const { metrics, perQuery } = await runEvaluation(searchFn, mode, benchmark);

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${mode}.json`), JSON.stringify({ mode, metrics, perQuery }, null, 2));
  fs.writeFileSync(path.join(outDir, `${mode}.csv`), toCSV(perQuery));

  console.log(`\n=== ${mode} 결과 ===`);
  console.log(`Hit@1: ${metrics.hit1Pct.toFixed(1)}%`);
  console.log(`Recall@3: ${metrics.recall3Pct.toFixed(1)}%`);
  console.log(`Recall@5: ${metrics.recall5Pct.toFixed(1)}%`);
  console.log(`MRR@5: ${metrics.mrr5.toFixed(3)}`);
  console.log(`평균 latency: ${metrics.avgLatencyMs.toFixed(0)}ms`);
  console.log(`p50 latency: ${metrics.p50LatencyMs.toFixed(0)}ms`);
  console.log(`p95 latency: ${metrics.p95LatencyMs.toFixed(0)}ms`);
  console.log(`\n저장됨: evaluation/results/${mode}.json, evaluation/results/${mode}.csv\n`);
}

main().catch(err => {
  console.error('평가 실행 중 오류:', err);
  process.exit(1);
});

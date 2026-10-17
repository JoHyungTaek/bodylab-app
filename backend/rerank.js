// LLM 재정렬(rerank): 하이브리드 검색이 가져온 후보를 Claude가 질의 의도에 맞게 다시 정렬한다.
// 서버(server.js)와 평가 스크립트(evaluation/evaluate_search.js)가 같은 코드를 쓰도록 분리했다.
// 주의: 프롬프트에는 평가 정답(gold) 라벨이나 벤치마크 질의를 절대 넣지 않는다.

const RERANK_MODEL = process.env.ANTHROPIC_RERANK_MODEL || 'claude-sonnet-4-6';

const RERANK_SYSTEM = [
  '너는 운동 라이브러리 검색 결과를 재정렬하는 도구야.',
  '사용자 질의와 후보 운동 목록(번호, 이름, 설명)이 주어진다.',
  '질의의 의도(운동 부위, 목적, 장비, 난이도, 자세 교정/부상 주의 등 모든 조건)에 가장 잘 맞는 후보부터 순서대로 골라.',
  '질의와 명백히 무관한 후보는 포함하지 마. 최대 5개까지만 고른다.',
  '반드시 JSON으로만 답해. 다른 말은 절대 하지 마. 형식: {"ranking":[후보번호, 후보번호, ...]}'
].join(' ');

function buildUserPrompt(query, candidates) {
  const lines = candidates.map((c, i) => `[${i + 1}] ${c.name}\n${String(c.content || '').slice(0, 600)}`);
  return `질의: ${query}\n\n후보:\n${lines.join('\n\n')}`;
}

function parseRanking(text, candidateCount) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]).ranking;
    if (!Array.isArray(arr)) return null;
    const seen = new Set();
    const out = [];
    for (const v of arr) {
      const idx = Number(v) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < candidateCount && !seen.has(idx)) {
        seen.add(idx);
        out.push(idx);
      }
    }
    return out.length ? out : null;
  } catch (e) {
    return null;
  }
}

/**
 * @param {string} apiKey  Anthropic API 키 (호출하는 쪽의 환경변수에서 전달)
 * @param {string} query
 * @param {{name:string, content:string}[]} candidates  하이브리드 검색 상위 N개(순서 유지)
 * @param {number} topK
 * @returns {Promise<{names:string[], usedFallback:boolean}>}
 */
export async function rerankCandidates(apiKey, query, candidates, topK = 5) {
  const fallback = () => ({ names: candidates.slice(0, topK).map(c => c.name), usedFallback: true });
  if (!apiKey || candidates.length === 0) return fallback();

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: RERANK_MODEL,
        max_tokens: 100,
        temperature: 0,
        system: RERANK_SYSTEM,
        messages: [{ role: 'user', content: buildUserPrompt(query, candidates) }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data.error || data));
    const text = (data.content || []).map(b => (b.type === 'text' ? b.text : '')).join('');
    const order = parseRanking(text, candidates.length);
    if (!order) return fallback();

    // LLM이 고른 순서 뒤에, 안 고른 후보를 기존 하이브리드 순서대로 채워 topK를 맞춘다.
    const picked = order.slice(0, topK);
    for (let i = 0; i < candidates.length && picked.length < topK; i++) {
      if (!picked.includes(i)) picked.push(i);
    }
    return { names: picked.map(i => candidates[i].name), usedFallback: false };
  } catch (err) {
    console.error('rerank failed, falling back to hybrid order:', err.message);
    return fallback();
  }
}

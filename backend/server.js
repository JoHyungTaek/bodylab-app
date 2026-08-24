import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8787;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

if (!ANTHROPIC_API_KEY) console.warn('⚠️  ANTHROPIC_API_KEY가 .env에 없어요 — AI 코치가 동작하지 않아요.');
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) console.warn('⚠️  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 .env에 없어요 — 로그인 검증이 동작하지 않아요.');
if (!YOUTUBE_API_KEY) console.warn('⚠️  YOUTUBE_API_KEY가 .env에 없어요 — 운동사전 영상 연동이 동작하지 않아요.');

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
});

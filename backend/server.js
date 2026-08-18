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

if (!ANTHROPIC_API_KEY) console.warn('⚠️  ANTHROPIC_API_KEY가 .env에 없어요 — AI 코치가 동작하지 않아요.');
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) console.warn('⚠️  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 .env에 없어요 — 로그인 검증이 동작하지 않아요.');

const supabaseAdmin = createClient(SUPABASE_URL || '', SUPABASE_SERVICE_ROLE_KEY || '');

const DAILY_COACH_LIMIT = 20;

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

app.post('/api/coach', requireUser, async (req, res) => {
  const { system, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages가 필요해요.' });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았어요.' });
  }

  // 하루 사용량 제한 확인
  const today = new Date().toISOString().slice(0, 10);
  let currentCount = 0;
  try {
    const { data: usageRow } = await supabaseAdmin
      .from('coach_usage')
      .select('count')
      .eq('user_id', req.user.id)
      .eq('usage_date', today)
      .maybeSingle();
    currentCount = usageRow?.count || 0;
  } catch (e) {
    console.warn('usage check failed:', e);
  }
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
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: fullSystem,
        messages
      })
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      console.error('Anthropic API error:', data);
      return res.status(anthropicRes.status).json({ error: '코치 응답을 받아오지 못했어요.', detail: data });
    }

    // 성공한 요청만 사용량에 카운트
    try {
      await supabaseAdmin.from('coach_usage').upsert(
        { user_id: req.user.id, usage_date: today, count: currentCount + 1 },
        { onConflict: 'user_id,usage_date' }
      );
    } catch (e) {
      console.warn('usage increment failed:', e);
    }

    res.json(data);
  } catch (err) {
    console.error('coach proxy failed:', err);
    res.status(500).json({ error: '코치 요청 중 오류가 발생했어요.' });
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

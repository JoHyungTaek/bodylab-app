# 재다(가칭) — 체형 측정 + AI 코치 + 운동 기록장

로컬 개발용 풀스택 스타터입니다.

```
bodylab-app/
├─ backend/     Node.js + Express — AI 코치 프록시(Anthropic API 키를 서버에만 보관) + 정적 파일 서빙
├─ frontend/    순수 HTML/JS — Supabase로 회원가입/로그인/DB 저장
└─ supabase/    schema.sql — Supabase 프로젝트에 실행할 테이블 정의
```

프론트엔드와 백엔드가 같은 서버(`http://localhost:8787`)에서 함께 뜨기 때문에
CORS 걱정 없이 `npm run dev` 한 줄로 전체가 돌아갑니다.

---

## 0. 사전 준비물

1. **Node.js 18 이상** ([nodejs.org](https://nodejs.org)에서 LTS 버전 설치)
2. **Supabase 계정** (무료) — https://supabase.com 에서 새 프로젝트 생성
3. **Anthropic API 키** — https://console.anthropic.com 에서 발급 (AI 코치용, 사용한 만큼만 과금)

## 1. Supabase 프로젝트 설정

1. https://supabase.com → New Project 생성
2. 왼쪽 메뉴 **SQL Editor** → `supabase/schema.sql` 내용을 붙여넣고 실행
   (회원별로 데이터가 자동 분리되는 RLS 정책까지 이 파일에 다 들어있어요)
3. 왼쪽 메뉴 **Project Settings → API** 에서 아래 3개를 복사해두세요
   - `Project URL`
   - `anon public` 키
   - `service_role` 키 (⚠️ 이건 절대 프론트엔드/깃허브에 노출하면 안 돼요 — 백엔드 `.env`에만 넣습니다)

## 2. 백엔드 설정 (IntelliJ에서)

1. IntelliJ에서 `bodylab-app` 폴더를 **Open**
2. 터미널(Alt+F12)에서:
   ```bash
   cd backend
   npm install
   cp .env.example .env
   ```
3. `.env` 파일을 열어 값 채우기:
   ```
   PORT=8787
   ANTHROPIC_API_KEY=sk-ant-여기에-발급받은키
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=여기에-service_role-키
   ```
4. `frontend/config.js`를 열어 Supabase 값 채우기 (이건 공개돼도 안전한 anon 키라 프론트엔드에 그대로 둡니다):
   ```js
   const SUPABASE_URL = 'https://xxxxx.supabase.co';
   const SUPABASE_ANON_KEY = '여기에-anon-public-키';
   ```

## 3. 실행

```bash
cd backend
npm run dev
```

브라우저에서 **http://localhost:8787** 접속하면 끝. 회원가입 → 로그인 → 사진 측정 → AI 코치까지 전부 실제로 동작합니다.

IntelliJ에서 바로 실행하려면: `backend/server.js`를 열고 좌측 초록색 ▶ 버튼(또는 Node.js Run Configuration 생성 후 Run)을 누르면 됩니다.

## 4. 다음 단계 (실제 배포)

로컬에서 잘 되면:
- 백엔드는 Render.com / Railway.app 같은 곳에 배포 (환경변수는 그대로 옮기면 됨)
- 프론트엔드는 백엔드가 정적 파일을 같이 서빙하므로 별도 배포 불필요
- 도메인 연결 후 사용

## 참고

- 사진 자동 관절 인식(MediaPipe)은 여기선 브라우저에서 바로 뜹니다 (Claude.ai 미리보기와 달리 네트워크 제약이 없어요).
- 측정값·운동 기록은 Supabase DB에 저장되고, RLS 정책 덕분에 본인 계정으로만 조회/수정됩니다.
- AI 코치 메시지는 백엔드를 거쳐 Anthropic API로 전달되며, API 키는 서버에만 있고 브라우저에는 절대 노출되지 않습니다.

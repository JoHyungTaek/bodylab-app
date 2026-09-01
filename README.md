# 바디랩 (BodyLab)

사진 한 장으로 체형을 측정하고, AI 코치와 함께 운동을 기록·관리하는 풀스택 웹 애플리케이션입니다.
컴퓨터 비전(포즈 추정)과 LLM(대화형 코칭, RAG 검색, 멀티모달 분석, 구조화 추출)을 실제 제품 기능으로 결합했습니다.

```
bodylab-app/
├─ backend/     Node.js + Express — AI API 프록시, 인증 검증, RAG 검색, 스트리밍
├─ frontend/    Vanilla HTML/JS — Supabase 인증·DB, MediaPipe 포즈 추정, 실시간 카메라 분석
└─ supabase/    PostgreSQL 스키마 + pgvector + Row Level Security 정책
```

---

## 핵심 기능

### 1. 체형 측정
- **AI 자동 관절 인식**: MediaPipe Pose Landmarker(정지 이미지 모드)로 어깨·골반·발목 좌표를 자동 추출
- **수동 보정 모드**: 자동 인식 실패 시(조명, 각도, 상반신 사진 등) 6개(또는 4개) 지점을 직접 탭해서 측정
- **전신/상반신 분기 처리**: 발목이 안 보이는 상반신 사진도 어깨·골반 비율만으로 부분 측정 지원 (자동 인식도 신뢰도 기반 부분 성공 판정)
- **체형 분류 + 좌우 비대칭 감지**: 어깨:골반 비율 기반 체형 유형 분류, 어깨/골반 좌우 기울기·다리 길이 비대칭 자동 감지
- **부위별 머신·운동 추천**: 체형 분류 결과에 따른 규칙 기반 우선순위 추천
- **AI 사진 품질 체크 (멀티모달)**: Claude의 이미지 인식으로 촬영 밝기·구도·정면 여부를 업로드 즉시 평가 (체형·외모 평가는 제외하도록 프롬프트 제약)

### 2. AI 코치
- **컨텍스트 인지형 대화**: 측정 결과, 목표, 최근 7일 운동 기록을 시스템 프롬프트에 구조화하여 주입
- **스트리밍 응답**: Anthropic SSE 스트림을 Express에서 그대로 중계, 프론트엔드에서 토큰 단위로 실시간 렌더링
- **AI 월간 리포트**: 최근 30일 측정·운동 데이터를 읽어 요약 리포트 자동 생성
- **하루 사용량 제한**: 사용자별 일일 호출 횟수 제한으로 비용 통제

### 3. 운동 기록장
- **자유 텍스트 기록 + 스트릭 추적**: 연속 기록일, 총 기록일 자동 계산
- **AI 구조화 추출 (Structured Output)**: 자유 텍스트 메모에서 Claude가 JSON 형식으로 운동 부위·종목을 자동 태깅

### 4. 운동사전 (RAG 검색)
- **의미 기반 자연어 검색**: Voyage AI 임베딩(voyage-3-lite, 512차원) + Supabase pgvector 코사인 유사도 검색으로 "어깨 아픈데 할 수 있는 운동" 같은 자연어 질의 지원
- **키워드 검색**: 머신명/부위 기반 필터링
- **YouTube 연동**: YouTube Data API v3로 관련 영상 검색, 30일 캐싱으로 API 할당량 절약

### 5. 라이브 트레이너 (베타)
- **실시간 포즈 추적**: MediaPipe Pose Landmarker(비디오 스트림 모드)로 웹캠 영상에서 관절 좌표를 프레임 단위로 추적
- **자동 반복 횟수 카운팅**: 무릎 관절 각도 기반 상태 머신(내려감/올라옴)으로 스쿼트 반복 자동 카운팅
- **실시간 음성 코칭**: Web Speech API로 반복 횟수 안내, 무릎 정렬(valgus) 이상 감지 시 음성 경고
- **기록장 자동 연동**: 세트 완료 시 원터치로 운동 기록장에 저장

### 6. 마이페이지
- **요약 통계**: 총 측정 횟수, 연속 기록일, 총 기록일, 일일 AI 사용량
- **측정 추이 그래프**: Chart.js 기반 시계열 시각화
- **비포/애프터 비교**: 두 측정 시점의 정규화된 관절 좌표(골반 중심 원점, 몸통 길이 단위 정규화)를 겹쳐 그려 체형 변화 시각 비교
- **변화 슬라이드쇼**: 사진 저장에 동의한 측정 기록들을 시간순 자동 재생
- **목표 설정**: 목표·목표일을 설정하면 AI 코치 대화에 자동 반영
- **프로필/계정 관리**: 닉네임 수정, 로그아웃, 계정 삭제(연쇄 삭제)

### 7. 인증 및 계정
- **이메일/비밀번호 인증** + 비밀번호 재설정 (이메일 링크)
- **소셜 로그인**: Google, Kakao OAuth (Supabase Auth)
- **이용약관·개인정보처리방침 동의** 플로우

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Vanilla JavaScript (ES Modules), Chart.js, MediaPipe Tasks Vision |
| 백엔드 | Node.js, Express |
| 데이터베이스 | PostgreSQL (Supabase), pgvector |
| 인증 | Supabase Auth (이메일/비밀번호 + OAuth) |
| 저장소 | Supabase Storage (비공개 버킷, RLS) |
| AI / LLM | Anthropic Claude API (대화, 스트리밍, 멀티모달, 구조화 출력), Voyage AI (임베딩) |
| 컴퓨터 비전 | MediaPipe Pose Landmarker (이미지 모드 + 비디오 스트림 모드) |
| 음성 | Web Speech API (SpeechSynthesis) |
| 외부 API | YouTube Data API v3 |

## AI/ML 구현 하이라이트

- **RAG 파이프라인**: 문서 임베딩 생성 → pgvector 저장 → 쿼리 임베딩 → 코사인 유사도 검색 (`match_exercises` SQL 함수)
- **프롬프트 엔지니어링**: 역할·컨텍스트·출력 형식을 구조화한 시스템 프롬프트 설계, 목적별 프롬프트 분리(대화형 vs. 구조화 출력 vs. 리포트 생성)
- **LLM 스트리밍**: SSE 기반 실시간 토큰 스트리밍 프록시 구현
- **멀티모달 입력 처리**: 이미지+텍스트 결합 요청, 출력 범위를 프롬프트 레벨에서 제한
- **Structured Output**: 자유 텍스트 → 고정 스키마 JSON 추출, 파싱 실패 시 폴백 처리
- **실시간 컴퓨터 비전**: 비디오 스트림 프레임별 관절 각도 계산(벡터 내적 기반), 상태 머신으로 반복 동작 카운팅

---

## 프로젝트 구조 상세

```
backend/
  server.js           Express 서버, 인증 미들웨어, AI API 프록시, RAG/YouTube/사용량 로직
  .env.example         필요한 환경변수 목록

frontend/
  index.html            메인 앱 (탭: 측정/기록장/마이페이지/운동사전/라이브 트레이너)
  app.js                전체 클라이언트 로직
  style.css             디자인 시스템 (CSS 변수 기반)
  config.js             Supabase 공개 설정 (URL, anon key)
  reset-password.html   비밀번호 재설정 페이지
  terms.html / privacy.html   약관 · 개인정보처리방침

supabase/
  schema.sql                 초기 스키마 (profiles, measurements, journal_entries + RLS)
  migration_day4.sql         coach_usage 테이블 (AI 사용량 제한)
  migration_day5.sql         상반신 모드 지원, goals 테이블
  migration_day6.sql         youtube_cache 테이블
  migration_day9.sql         landmarks 컬럼 (비포/애프터 비교용)
  migration_day10.sql        photo_path 컬럼, Storage 정책
  migration_ai_features.sql  pgvector, exercise_embeddings, 구조화 태그, 소셜 로그인 트리거 보강
```

---

## 시작하기

### 0. 사전 준비물

| 서비스 | 용도 | 필수 여부 |
|---|---|---|
| [Node.js 18+](https://nodejs.org) | 런타임 | 필수 |
| [Supabase](https://supabase.com) | DB, 인증, 저장소 | 필수 |
| [Anthropic Console](https://console.anthropic.com) | AI 코치, 리포트, 사진 품질 체크, 구조화 추출 | 필수 |
| [Google Cloud Console](https://console.cloud.google.com) | YouTube 검색 API, Google 로그인 | 선택 |
| [Voyage AI](https://dashboard.voyageai.com) | 운동사전 RAG 검색 | 선택 |
| [Kakao Developers](https://developers.kakao.com) | 카카오 로그인 | 선택 |

### 1. Supabase 설정

1. 새 프로젝트 생성
2. **SQL Editor**에서 아래 파일들을 **순서대로** 실행:
   `schema.sql` → `migration_day4.sql` → `migration_day5.sql` → `migration_day6.sql` → `migration_day9.sql` → `migration_day10.sql` → `migration_ai_features.sql`
3. **Storage** → New bucket → 이름 `progress-photos`, Public 체크 해제(비공개 유지)
4. (선택) **Authentication → Providers**에서 Google / Kakao 활성화 (Client ID/Secret은 각 서비스 콘솔에서 발급)
5. **Project Settings → API**에서 Project URL, anon(publishable) key, service_role(secret) key 확인

### 2. 백엔드 설정

```bash
cd backend
npm install
cp .env.example .env
```

`.env` 채우기:
```
PORT=8787
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
YOUTUBE_API_KEY=...          # 선택
VOYAGE_API_KEY=...           # 선택 (RAG 검색용)
```

### 3. 프론트엔드 설정

`frontend/config.js`:
```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: '...'
};
```

### 4. 실행

```bash
cd backend
npm run dev
```

`http://localhost:8787` 접속. 프론트엔드와 백엔드가 같은 서버에서 서빙되어 별도 CORS 설정이 필요 없습니다.

> **참고 — Voyage AI 사용 시**: 결제 수단을 등록하지 않은 계정은 분당 3회로 요청이 제한됩니다. 서버가 처음 켜질 때 운동사전 20개 항목의 임베딩을 생성하는데, 이 제한 때문에 요청 사이에 자동으로 대기 시간(약 21초)을 두도록 구현되어 있어 **최초 1회 실행 시 약 7분 정도 소요**될 수 있습니다 (이후 재시작부터는 즉시 완료). 더 빠르게 하고 싶다면 Voyage AI 대시보드에서 결제 수단을 등록하면 되며, 이 규모의 사용량에서는 무료 토큰(200M) 한도 내에서 계속 무료입니다.

---

## 보안 설계

- Anthropic/YouTube/Voyage API 키는 전부 백엔드에만 보관, 프론트엔드에는 절대 노출되지 않음
- Supabase `service_role` 키는 백엔드에서만 사용, 모든 사용자 요청은 JWT 검증 후 처리
- 모든 테이블에 Row Level Security 적용 — 사용자는 본인 데이터만 조회/수정 가능
- Storage 버킷은 비공개 + 사용자별 폴더 격리 정책
- AI 기능 일일 사용량 제한으로 비용 남용 방지
- 계정 삭제 시 연관 데이터 연쇄 삭제(cascade)

## 참고 사항

- 이 프로토타입은 참고용이며 의료적 진단을 대체하지 않습니다.
- 사진은 사용자가 명시적으로 동의한 경우에만 저장되며, 기본값은 브라우저 내 처리 후 미저장입니다.

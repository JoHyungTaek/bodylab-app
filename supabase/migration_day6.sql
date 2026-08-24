-- 6일차 추가분: 유튜브 검색 결과 캐시 테이블
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.youtube_cache (
  query text primary key,
  results jsonb not null,
  cached_at timestamptz default now()
);

-- 이 테이블은 백엔드(서버)만 읽고 쓰도록 함 (RLS 활성화 후 정책을 하나도 안 만들면
-- 일반 로그인 사용자는 직접 접근 못 하고, service_role을 쓰는 백엔드만 접근 가능해짐)
alter table public.youtube_cache enable row level security;

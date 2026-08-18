-- 4일차 추가분: AI 코치 하루 사용량 제한용 테이블
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- (기존 테이블은 안 건드리고 새 테이블만 추가하는 스크립트예요.)

create table if not exists public.coach_usage (
  user_id uuid references auth.users(id) on delete cascade not null,
  usage_date date not null default current_date,
  count int not null default 0,
  primary key (user_id, usage_date)
);

alter table public.coach_usage enable row level security;

create policy "coach_usage_all_own" on public.coach_usage
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

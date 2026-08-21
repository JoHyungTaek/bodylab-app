-- 5일차 추가분
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- 1) 상반신 사진 모드에서는 다리 비율을 측정하지 않으므로 null 허용
alter table public.measurements alter column leg_torso_ratio drop not null;

-- 2) 목표 설정 테이블 (사용자당 목표 1개)
create table if not exists public.goals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  goal_text text not null,
  target_date date,
  created_at timestamptz default now()
);

alter table public.goals enable row level security;

create policy "goals_all_own" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

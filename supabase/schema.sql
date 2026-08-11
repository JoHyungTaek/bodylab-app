-- 재다(가칭) DB 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- ── 프로필 (닉네임) ─────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_upsert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- 회원가입 시 프로필 행을 자동 생성
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── 측정 기록 ─────────────────────────────
create table if not exists public.measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  measured_at timestamptz default now(),
  body_type text not null,
  shoulder_hip_ratio numeric not null,
  leg_torso_ratio numeric not null,
  shoulder_tilt numeric not null,
  hip_tilt numeric not null,
  waist_cm numeric
);

alter table public.measurements enable row level security;

create policy "measurements_all_own" on public.measurements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 매일 운동 기록장 ─────────────────────────────
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  entry_date date not null,
  note text not null,
  created_at timestamptz default now(),
  unique (user_id, entry_date)
);

alter table public.journal_entries enable row level security;

create policy "journal_all_own" on public.journal_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

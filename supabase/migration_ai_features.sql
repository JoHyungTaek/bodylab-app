-- AI/소셜 기능 추가분
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- 1) RAG 검색용: pgvector 확장 활성화
create extension if not exists vector;

-- 2) 운동사전 임베딩 저장 테이블 (서버만 접근, RLS로 잠가둠)
create table if not exists public.exercise_embeddings (
  name text primary key,
  content text not null,
  embedding vector(512)
);
alter table public.exercise_embeddings enable row level security;

-- 3) 벡터 유사도 검색 함수 (코사인 거리 기준 상위 N개)
create or replace function match_exercises(query_embedding vector(512), match_count int default 5)
returns table(name text, content text, similarity float)
language sql stable
as $$
  select name, content, 1 - (embedding <=> query_embedding) as similarity
  from public.exercise_embeddings
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- 4) 운동 기록장: AI가 자동 추출한 구조화 태그 저장용 컬럼
alter table public.journal_entries add column if not exists tags jsonb;

-- 5) 소셜 로그인(카카오 등) 시 이메일이 없을 수도 있어서, 닉네임 자동 생성 로직 보강
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, coalesce(split_part(new.email, '@', 1), '회원' || substr(new.id::text, 1, 6)));
  return new;
end;
$$ language plpgsql security definer;

-- 검색 품질 개선: 하이브리드 검색(벡터 + 키워드) 함수 추가
-- 기존 match_exercises(벡터 검색만)는 절대 건드리지 않음 — baseline 비교를 위해 그대로 유지
--
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- 1) 한글 부분 문자열 유사도 계산용 확장 (Postgres 기본 full-text search는 한글 형태소 분석을 지원하지 않아서,
--    조사가 붙은 한글 표현에도 안정적으로 동작하는 trigram 유사도를 키워드 점수로 사용함)
create extension if not exists pg_trgm;

-- 2) 하이브리드 검색 함수: 벡터 유사도 + 키워드(trigram) 유사도를 가중합
--    가중치는 하드코딩하지 않고 호출 시 파라미터로 전달 (기본값 0.7 / 0.3)
--    set search_path 로 vector/pg_trgm이 어느 스키마에 설치됐든 안전하게 동작하도록 함
create or replace function match_exercises_hybrid(
  query_embedding vector(512),
  query_text text,
  match_count int default 5,
  vector_weight float default 0.7,
  keyword_weight float default 0.3
)
returns table(
  name text,
  content text,
  vector_similarity float,
  keyword_score float,
  hybrid_score float
)
language sql stable
set search_path = public, extensions
as $$
  select
    name,
    content,
    1 - (embedding <=> query_embedding) as vector_similarity,
    similarity(content, query_text) as keyword_score,
    (vector_weight * (1 - (embedding <=> query_embedding)))
      + (keyword_weight * similarity(content, query_text)) as hybrid_score
  from public.exercise_embeddings
  order by hybrid_score desc
  limit match_count;
$$;

NOTIFY pgrst, 'reload schema';

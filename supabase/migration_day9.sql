-- 9일차 추가분: 비포/애프터 스켈레톤 비교용 좌표 저장
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

alter table public.measurements add column if not exists landmarks jsonb;

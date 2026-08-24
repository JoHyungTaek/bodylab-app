-- 10일차 추가분: 사진 저장(선택 동의) + 변화 슬라이드쇼
--
-- ⚠️ 이 파일 실행 전에, Supabase 대시보드에서 먼저 Storage 버킷을 하나 만들어야 해요:
--   1. 왼쪽 메뉴 Storage 클릭 → New bucket
--   2. 이름: progress-photos
--   3. Public bucket 체크 안 함 (비공개로 유지 — 몸 사진이라 민감해요)
--   4. Create bucket
--
-- 버킷을 만든 다음, 이 SQL을 SQL Editor에서 실행하세요.

-- measurements 테이블에 사진 경로 컬럼 추가 (선택 동의 시에만 값이 들어감)
alter table public.measurements add column if not exists photo_path text;

-- Storage 버킷 접근 정책: 본인 폴더(자기 user_id로 시작하는 경로)만 읽고 쓸 수 있게 제한
create policy "progress_photos_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "progress_photos_select_own"
  on storage.objects for select
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "progress_photos_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

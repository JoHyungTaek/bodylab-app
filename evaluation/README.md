# 운동사전 검색 품질 평가 (Baseline vs Hybrid)

기존 벡터 검색(Baseline)과 개선된 하이브리드 검색(Improved)의 품질을 자체 제작한 61개 질의 벤치마크로 정량 비교합니다.

## 준비

1. `supabase/migration_hybrid_search.sql` 을 Supabase SQL Editor에서 실행 (pg_trgm 확장 + `match_exercises_hybrid` 함수 생성)
2. `backend/.env` 에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VOYAGE_API_KEY` 가 이미 설정되어 있어야 함 (기존 백엔드와 동일한 값 사용)
3. 이 폴더에서 의존성 설치 (최초 1회만):
   ```bash
   cd evaluation
   npm install
   ```

## ⚠️ 실행 순서가 중요해요

**반드시 이 순서대로 진행하세요.** 순서가 바뀌면 baseline이 improved 데이터를 반영한 상태로 측정돼서 비교가 무의미해져요.

### 1단계 — Baseline 측정 (개선 전, 기존 코드 그대로)

`backend/server.js`, DB 데이터를 아직 아무것도 바꾸지 않은 상태에서:

```bash
node evaluate_search.js baseline
```

결과: `results/baseline.json`, `results/baseline.csv`

### 2단계 — 개선 사항 적용

1. `backend/server.js` 를 새 버전으로 덮어쓰기 (하이브리드 검색용 `/api/library-search?mode=hybrid` 추가, 운동 메타데이터 보강)
2. Supabase SQL Editor에서 기존 임베딩 삭제 후 재생성 트리거:
   ```sql
   delete from public.exercise_embeddings;
   ```
3. 백엔드 서버 재시작 (`Ctrl+C` → `npm run dev`) — 콘솔에 "운동사전 임베딩 생성 중..." 뜨면서 보강된 메타데이터로 다시 임베딩을 만들어요. **결제 수단 미등록 Voyage 계정은 20개 항목에 약 7분 정도 걸려요.**

### 2단계 — Improved 측정

```bash
node evaluate_search.js improved
```

결과: `results/improved.json`, `results/improved.csv`

(결제 수단 미등록으로 Voyage API 분당 3회 제한에 걸리면, `VOYAGE_REQUEST_DELAY_MS=21000` 환경변수를 앞에 붙여서 실행하세요: `VOYAGE_REQUEST_DELAY_MS=21000 node evaluate_search.js improved`)

### 3단계 — 비교 결과 출력

```bash
node compare_results.js
```

콘솔에 Baseline vs Improved 비교표가 출력되고, 아래 파일들이 자동 생성돼요:
- `results/comparison.txt` — 비교표
- `results/error_analysis.md` — Baseline 실패 → Improved 성공 사례, Improved에서도 실패하는 사례 정리
- `results/README_snippet.md` — 프로젝트 루트 `README.md`에 그대로 붙여넣을 수 있는 "Search Performance Evaluation" 섹션 (실제 측정값만 들어감, 임의 수치 없음)

## 지표 설명

- **Hit@1**: 1위 결과가 정답인 비율
- **Recall@3 / @5**: 상위 3개/5개 안에 정답이 하나라도 포함된 비율
- **MRR@5**: 상위 5개 안에서 정답이 나온 순위의 역수 평균 (1위=1.0, 2위=0.5, 3위=0.33 ...)
- **Latency**: 임베딩 생성 + DB 검색을 포함한 전체 응답 시간

## 가중치 조정

하이브리드 점수는 `벡터 유사도 × VECTOR_WEIGHT + 키워드 유사도 × KEYWORD_WEIGHT` 로 계산돼요. 기본값은 0.7 / 0.3이고, 환경변수로 바꿀 수 있어요:

```bash
VECTOR_WEIGHT=0.5 KEYWORD_WEIGHT=0.5 node evaluate_search.js improved
```

여러 조합을 테스트하고 싶으면, `improved.json`을 `improved_0.5.json` 처럼 다른 이름으로 백업해두고 비교하면 돼요.

## LLM 재정렬(rerank) 평가

```powershell
cd evaluation
node evaluate_search.js rerank      # hybrid 상위 10개 → Claude 재정렬 (ANTHROPIC_API_KEY 필요, 질의당 Claude 1회 호출)
node compare_rerank.js              # baseline / hybrid / rerank 3자 비교 + 질의별 개선·악화 목록
```
- 프롬프트(`backend/rerank.js`)에는 정답 라벨/벤치마크 질의를 넣지 않았음. 결과를 본 뒤 프롬프트를 고치면 그 질의 세트는 더 이상 공정한 평가가 아님.
- 질의 임베딩은 `results/query_embeddings_cache.json`에 캐시되어 재실행 시 Voyage 대기(21초)가 생략됨.
- 서버 API: `/api/library-search?mode=rerank`

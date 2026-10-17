## Search Performance Evaluation

운동사전 AI 검색(RAG)의 품질을 자체 제작한 벤치마크로 정량 측정했습니다.

- **평가 데이터**: 자연어 질의 61개 (정확한 운동명 / 부위 기반 / 목적 기반 / 자연어 표현 / 동의어·우회 표현 / 기구 유무 조건 / 자세교정 목적 / 복합 조건 8개 유형)
- **평가 방법**: 각 질의에 대해 상위 5개 검색 결과와 정답(gold label) 비교, Hit@1 / Recall@3 / Recall@5 / MRR@5 / 응답 지연시간 측정
- **Baseline**: Voyage AI 임베딩(512차원) 기반 벡터 유사도 검색 (기존 운영 방식)
- **개선 방법**: 벡터 유사도 + PostgreSQL trigram 기반 키워드 유사도를 가중합(Hybrid Search)한 방식으로 재순위화, 운동 메타데이터(부위/목적/기구/동의어 등) 보강 후 재임베딩

| Metric | Baseline | Improved | Change |
|---|---|---|---|
| Hit@1 | 67.2% | 77.0% | +9.8%p |
| Recall@3 | 82.0% | 91.8% | +9.8%p |
| Recall@5 | 90.2% | 93.4% | +3.3%p |
| MRR@5 | 0.750 | 0.843 | +0.093 |
| Avg Latency | 302ms | 309ms | +7ms |
| P95 Latency | 464ms | 519ms | - |

실행 방법: [evaluation/README.md](./evaluation/README.md) 참고

# 로그 어시스턴트 — Tasks

- 권위: [spec.md](./spec.md)/[plan.md](./plan.md). `[x]`=완료. `[server]`=사람 적용(§11).

## Phase 1 — 스펙 ✅
- [x] T010 spec.md (WHAT·왜, MVP)

## Phase 2 — 설계 ✅
- [x] T020 plan.md (BFF·RAG·인용서버검증·안전)
- [x] T021 ADR-0014 (로컬vLLM·읽기전용·no-vector·no-fix·no-autoapply·/incidents·GPU on-demand)

## Phase 3 — 라이브러리 (순수·테스트)
- [ ] T030 `config/env.ts` — getOpenSearchUrl·getVllmUrl·getVllmModel(zod, server-only) + `.env.example`
- [ ] T031 `lib/opensearch.ts` — searchLogs(BM25+필터, 읽기전용, 실패 throw)
- [ ] T032 `lib/vllm.ts` — chat(/v1/chat/completions, stream 옵션)
- [ ] T033 `lib/assistant.ts` — scrubSecrets·buildPrompt(격리·번호근거)·runbookMatch(순수) + answerError(오케스트레이터)
- [ ] T034 `lib/assistant.test.ts` — 스크럽·격리·근거번호·런북매칭 경계

## Phase 4 — BFF
- [ ] T040 `app/api/assistant/route.ts` — POST(force-dynamic) SSE 스트림(fleet/status 패턴)

## Phase 5 — UI (Overview/Incidents 통합)
- [ ] T050 `components/signals/current-signals.tsx`(server) — 최근 error+warn top-N(OpenSearch) + 행별 "분석"
- [ ] T051 `components/assistant/*`(client) — 질의·스트림응답·근거패널·런북/Grafana 딥링크
- [ ] T052 `/incidents` 라우트를 어시스턴트 탭으로 전용(`nav-items.ts` 라벨)
- [ ] T053 진입점 — 현재신호 "분석" → 어시스턴트 prefill, KRDS·접근성(aria-live·키보드·다크)

## Phase 6 — KB
- [ ] T060 런북 frontmatter 표준(id·service·category·signature·detection_query·fix_kind·status·occurrences) — rsyslog 첫 엔트리
- [ ] T061 runbookMatch 연결(keyword 우선, 벡터 없음)

## Phase 7 — 검증·문서
- [ ] T070 verify(타입·린트·테스트·secrets·no-raw-hex) — 빌드는 사람(라이브 .next)
- [ ] T071 [server] 라이브 스모크 — vLLM /v1/chat 200 + OpenSearch _search 200(내부 egress 0)
- [ ] T072 가치 베이스라인 — 시드 에러로 어시스턴트 vs /logs 직접 도달시간·정확도
- [ ] T073 [server] Playwright 스크린샷(라이트·다크) 공유 — [[visual-qa-at-task-end]]
- [ ] T074 README/AGENTS 갱신(어시스턴트 운영·GPU 경합 주의·KB 절차)

## 백로그 (가치 입증 후 — measure-first)
- [ ] B01 KB 축적 루프(LLM draft→PR→머지→HEAD에서만 인덱스 재빌드) + 재발지표 3종
- [ ] B02 임베딩/kNN(키워드 부족 입증 후, 로컬, ADR)
- [ ] B03 능동 통보(M5 경량) — 에러 감지→1차 RAG 진단 첨부
- [ ] B04 모델-인지 결합(B) — gpu-model-exporter data04 배포 후

# 로그 어시스턴트 — Tasks

- 권위: [spec.md](./spec.md)/[plan.md](./plan.md). `[x]`=완료. `[server]`=사람 적용(§11).

## Phase 1 — 스펙 ✅
- [x] T010 spec.md (WHAT·왜, MVP)

## Phase 2 — 설계 ✅
- [x] T020 plan.md (BFF·RAG·인용서버검증·안전)
- [x] T021 ADR-0014 (로컬vLLM·읽기전용·no-vector·no-fix·no-autoapply·/incidents·GPU on-demand)

## Phase 3 — 라이브러리 (순수·테스트) ✅
- [x] T030 `config/env.ts` — getOpenSearchUrl·getVllmUrl·getVllmModel(zod, server-only) + `.env.example`
- [x] T031 `lib/opensearch.ts` — searchLogs(BM25+필터, 읽기전용, 실패 throw)
- [x] T032 `lib/vllm.ts` — chat(/v1/chat/completions, 비스트리밍 MVP)
- [x] T033 `lib/assistant.ts` — scrubSecrets·buildPrompt(격리·번호근거)·runbookMatch(순수) + answerError(오케스트레이터)
- [x] T034 `lib/assistant.test.ts` — 14 케이스(스크럽·격리·근거번호·런북매칭). 전체 34/34 통과
- [x] T035 라이브 스모크(개념증명) — 실제 containerd/docker CNI 에러 → 로컬 vLLM 정확 진단, egress 0. ([P1] 인용 구체번호 프롬프트 튜닝)

## Phase 4 — BFF ✅
- [x] T040 `app/api/assistant/route.ts` — POST(force-dynamic), answerError. GPU 경합 방지(동시1요청, 429). MVP 비스트리밍

## Phase 5 — UI (Incidents 전용) ✅
- [x] T050 `components/signals/current-signals.tsx`(server) — 최근 error+warn top-N(rsyslog/UFW 제외) + 행별 "분석"
- [x] T051 `components/assistant/assistant-panel.tsx`(client) — 질의·응답·근거 details·런북 표시·aria-live
- [x] T052 `/incidents` → 어시스턴트 전용(`nav-items.ts` 라벨 "어시스턴트", Logs M2 배지 제거)
- [x] T053 진입점 — 현재신호 "분석" → `?service&node&q` prefill → 마운트 자동분석

## Phase 6 — KB ✅
- [x] T060 런북 frontmatter 표준(id·service·category·signature·detection_query·fix_kind·status) — rsyslog 첫 엔트리
- [x] T061 `lib/runbooks.ts` 로더 + runbookMatch 연결(keyword 우선, 벡터 없음)

## Phase 7 — 탐색형 확장 ✅ (ADR-0015 — 라이브 실측 후 피벗)
- [x] T075 신호 패널 버그 — 노이즈 제외를 쿼리단으로(`searchLogs.excludeNoise`), `CurrentSignals` 24h·size12. "신호 없음"→실제 8건
- [x] T076 `searchLogs` 레벨 잠금 해제(미지정=전체) + `excludeNoise` 옵션
- [x] T077 `lib/facets.ts` — terms agg로 노드/서비스/카테고리 어휘(60s 캐시, 환각 차단용 그라운딩)
- [x] T078 `lib/assistant.ts` — `buildPlanPrompt`·`parsePlan`(패싯검증·배열quirk·폴백)·`summarizePlan`·`buildExplorePrompt`·`explore` 오케스트레이터
- [x] T079 `route.ts` 모드 분기(service/node 부재=탐색형) + `assistant-panel` 계획표시·예시칩·placeholder
- [x] T07A 테스트 +12(parsePlan·pickFacet·plan/explore 프롬프트). 전체 46/46
- [x] T07B 라이브 end-to-end 증명 — "docker 경고 왜?" → 계획→근거33→인용답변, egress 0

## Phase 8 — 검증·문서
- [x] T070 verify(타입·린트·테스트·secrets·no-raw-hex) — 빌드는 사람(라이브 .next)
- [ ] T071 [server] 배포 후 라이브 스모크 — 어시스턴트 탭에서 자유질의·신호분석 동작
- [ ] T072 가치 베이스라인 — 탐색형이 /logs 직접 검색보다 빠르고 정확한지(measure-first)
- [ ] T073 [server] Playwright 스크린샷(라이트·다크) 공유 — [[visual-qa-at-task-end]]
- [ ] T074 README/AGENTS 갱신(어시스턴트 운영·탐색형 질의계획·GPU 경합·KB 절차)

## 백로그 (가치 입증 후 — measure-first)
- [ ] B01 KB 축적 루프(LLM draft→PR→머지→HEAD에서만 인덱스 재빌드) + 재발지표 3종
- [ ] B02 임베딩/kNN(키워드 부족 입증 후, 로컬, ADR)
- [ ] B03 능동 통보(M5 경량) — 에러 감지→1차 RAG 진단 첨부
- [ ] B04 모델-인지 결합(B) — gpu-model-exporter data04 배포 후

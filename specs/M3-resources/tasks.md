# M3 여유 리소스 — Tasks

- 권위: [spec.md](./spec.md)/[plan.md](./plan.md). `[x]`=완료, `[ ]`=잔여.

## Phase 1 — 스펙 ✅
- [x] T010 spec.md (WHAT·왜)

## Phase 2 — 설계 ✅
- [x] T020 plan.md (메트릭·판정식·타입·통합·검증)
- [x] T021 ADR-0013 (여유 판정 정책 — 메트릭·임계·이산등급·VRAM binding)

## Phase 3 — 데이터 레이어 (순수·테스트)
- [ ] T030 types: `NodeCapacity`·`GpuCapacity`·`Verdict`(types/capacity.ts 또는 fleet.ts)
- [ ] T031 `config/capacity-policy.ts` — 임계 8개 상수(ADR-0013), 선택적 env override
- [ ] T032 `lib/prometheus.ts` `queryCapacity()` — CPU busy·mem avail·DCGM util·FB free/used 질의(서버 전용, 실패 throw)
- [ ] T033 `lib/capacity.ts` `resolveFleetCapacity(nodes, raw)`(순수) + `getFleetCapacity()`(오케스트레이터, 실패→unknown)
- [ ] T034 `lib/capacity.test.ts` — 경계값(free/busy/full), GPU없음→null, no-data→unknown, VRAM가득+util0→full

## Phase 4 — UI (Overview 통합) ✅
- [x] T040 여유 배지 `components/ui/capacity-badge.tsx`(GPU·일반, 색+텍스트, System 색 토큰)
- [x] T041 배치 추천 배너 `components/fleet/placement-hint.tsx`("dataX 추천 (VRAM N%)" / "여유 GPU 없음")
- [x] T042 임계 노출(UR4) — 배지 title 툴팁 + 추천 옆 "기준: VRAM≥50%·util≤30%"
- [x] T043 `node-card`·`fleet-strip`·`overview/page.tsx` — `getFleetCapacity()` 병렬 fetch → 전달. 드릴다운 기존 재사용
- [x] T044 정직성 — `unknown`=중립색·"판정불가", GPU없음=배지없음(거짓 여유 금지)

## Phase 5 — 검증·문서
- [x] T050a 안전 검증 — typecheck·lint·test(20/20)·check:secrets·check:no-raw-hex 통과
- [ ] T050b [server] 빌드+배포 — `npm run build && sudo systemctl restart keiwi-console`(라이브 .next 충돌로 사람이, §11)
- [x] T051 실데이터 — data04=GPU free(VRAM 78%·util 0%), data05=GPU busy(best 32%) 판정 확인
- [ ] T052 [server] Playwright/스크린샷(라이트·다크) 공유 — [[visual-qa-at-task-end]] (배포 후)
- [ ] T053 README/AGENTS 갱신(여유 리소스 뷰 운영·임계 조정)

## 백로그
- [ ] B01 임계 env override 노출(.env.example)
- [ ] B02 메트릭↔로그 드릴다운(후보 B)과 연계 — 여유카드→그 노드 로그
- [ ] B03 시계열 여유 추이(최근 1h 여유도) — 지금은 순간값

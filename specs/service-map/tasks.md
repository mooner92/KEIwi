# 서비스 맵 — Tasks

- 권위: [spec.md](./spec.md)/[plan.md](./plan.md). `[x]`=완료 · `[ ]`=잔여 · `[server]`=사람 적용(§11).
- 상태: 설계 완료(spec/plan), 구현 대기(사용자 IA 합의 후 착수).

## Phase 0 — 설계 ✅
- [x] T000 spec.md (WHAT·WHY·수용기준·범위 v1/v2)
- [x] T001 plan.md (데이터소스 매핑·IA·Phase)
- [x] T002 IA 확정 — **Overview 노드 드릴다운에 "서비스" 네이티브 탭**(유기적, 노드 맥락 통합). 독립 `/service-map` 기각. (2026-06-30 사용자 합의)

## Phase 1 — 라이브러리 (순수·테스트) ✅
- [x] T010 `lib/service-catalog.ts` — getNodeServices(node): OpenSearch terms(service) + category + error/warn(노이즈 제외, 24h). 빌더·파서 분리(순수)
- [x] T011 `lib/prometheus.ts` +`queryGpuModels(node)` — gpu_model_vram_bytes → {node,model,gpu,port,framework,vramBytes}[] (PromQL 주입 가드)
- [x] T012 `config/known-endpoints.ts` — 정적 알려진 포트 + endpointLabel()
- [x] T013 테스트 — buildServiceAggBody·parseServiceBuckets·endpointLabel (57/57)

## Phase 2 — UI ✅
- [x] T020 `components/service-map/service-table.tsx`(server) — 서비스 행(서비스·카테고리·포트·error/warn) + GPU 모델 섹션
- [x] T021 행 액션 — `/incidents?service&node` 어시스턴트(로그·진단) 딥링크
- [x] T022 GPU 노드 모델 섹션(queryGpuModels) — model·gpu·port·VRAM

## Phase 3 — IA 통합 ✅
- [x] T030 Overview 드릴다운에 **네이티브 "서비스" 탭** — `grafana-tabs.tsx` 통합 탭 모델(서비스+Grafana), 서버 ServiceTable을 `servicePanel` prop으로 주입. 노드 선택 시 기본 활성
- [x] T031 nav/breadcrumb — 변경 불필요(Overview 탭 내부)

## Phase 4 — 검증·문서
- [x] T040 verify(typecheck·lint·test 57·no-raw-hex) — 빌드는 사람(§12)
- [ ] T041 [server] Playwright — 노드 선택→서비스 탭 렌더·모델·행 링크 (격리 프로덕션 빌드 검증)
- [ ] T042 README/AGENTS 갱신(서비스 맵 진입점·데이터소스)

## 백로그 (v2 — 별도 ADR)
- [ ] B01 포트→프로그램 전수 수집기(경량 `ss -tlnp` exporter, 노드별 Ansible role) → 임의 리스닝 포트/프로세스 표기
- [ ] B02 data02(Windows) 서비스 카탈로그(winlogbeat/windows_exporter 연계)
- [ ] B03 서비스 up/down 상태(systemd collector) 행 표기

# 서비스 맵 — Tasks

- 권위: [spec.md](./spec.md)/[plan.md](./plan.md). `[x]`=완료 · `[ ]`=잔여 · `[server]`=사람 적용(§11).
- 상태: 설계 완료(spec/plan), 구현 대기(사용자 IA 합의 후 착수).

## Phase 0 — 설계 ✅
- [x] T000 spec.md (WHAT·WHY·수용기준·범위 v1/v2)
- [x] T001 plan.md (데이터소스 매핑·IA·Phase)
- [ ] T002 IA 확정 — Overview "서비스" 탭 vs 독립 `/service-map` (사용자 합의 — spec openQuestion)

## Phase 1 — 라이브러리 (순수·테스트)
- [ ] T010 `lib/service-catalog.ts` — getNodeServices(node): OpenSearch terms(service) + error/warn 수(노이즈 제외, 24h)
- [ ] T011 `lib/prometheus.ts` +`queryGpuModels()` — gpu_model_* → {node,model,gpu,port,framework,vramBytes}[]
- [ ] T012 `config/known-endpoints.ts` — 정적 알려진 포트(ssh:764·grafana:3000·vllm:8003/8010·ollama:11434) + inventory exporters 병합
- [ ] T013 테스트 — 패싯 파싱·딥링크(/logs, /incidents) 생성·known-endpoint 병합

## Phase 2 — UI
- [ ] T020 `components/service-map/service-table.tsx`(server) — 행: 서비스·카테고리·포트·모델·error/warn 수
- [ ] T021 행 액션 — /logs Grafana 딥링크(fleet_node+service var) + /incidents?service=&node= 어시스턴트
- [ ] T022 GPU 노드 모델 섹션(queryGpuModels) 표시

## Phase 3 — IA 통합
- [ ] T030 T002 결정대로 진입점 배선(노드 선택 ?node= 재사용)
- [ ] T031 nav/breadcrumb 갱신(필요 시)

## Phase 4 — 검증·문서
- [ ] T040 verify(typecheck·lint·test·no-raw-hex) — 빌드는 사람(§12)
- [ ] T041 [server] Playwright — 노드 선택→표 렌더·행 링크·패싯 일치 ([[visual-qa-at-task-end]])
- [ ] T042 README/AGENTS 갱신(서비스 맵 진입점·데이터소스)

## 백로그 (v2 — 별도 ADR)
- [ ] B01 포트→프로그램 전수 수집기(경량 `ss -tlnp` exporter, 노드별 Ansible role) → 임의 리스닝 포트/프로세스 표기
- [ ] B02 data02(Windows) 서비스 카탈로그(winlogbeat/windows_exporter 연계)
- [ ] B03 서비스 up/down 상태(systemd collector) 행 표기

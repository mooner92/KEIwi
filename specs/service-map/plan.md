# 서비스 맵 — Plan (HOW)

- 상태: 초안(2026-06-30) · 권위: [spec.md](./spec.md) 종속
- 관련: [ADR-0017](../../docs/decisions/0017-node-onboarding-standard.md)·[ADR-0016](../../docs/decisions/0016-gpu-drilldown-dcgm.md)

## 기술 컨텍스트
Next 16 App Router · 서버 전용 BFF(`'use client'` 금지 lib) · force-dynamic · zod env. 기존 lib 재사용: `lib/opensearch.ts`(searchLogs/패싯)·`lib/prometheus.ts`(promQuery)·`lib/inventory.ts`(SoT).

## 헌장 체크
| 조항 | 준수 |
|---|---|
| §0 inventory SoT | 노드 목록·exporters를 inventory에서 |
| §I-2 단일콘솔=Grafana | 카탈로그는 콘솔 네이티브(가벼운 표), 로그 탐색은 /logs Grafana로 딥링크(재구현 안 함) |
| §11 사람적용 | 코드 생성만, 빌드/배포는 사람 |
| §12 라이브 .next | dev/검증은 격리, 라이브 빌드 안 함 |
| 새 수집 0 | OpenSearch·Prometheus·inventory만 — 신규 exporter 없음(v1) |

## 데이터 소스 → 매핑
1. **서비스/노드** — OpenSearch `_search size:0` terms agg `service`(filter `fleet_node=N`, 최근 24h, 노이즈 제외). 행별 레벨 요약(error/warn 수)도 같은 쿼리로. → `lib/service-catalog.ts`(신규 순수 lib, opensearch 재사용).
2. **GPU 모델** — Prometheus `gpu_model_info`/`gpu_model_vram_bytes`(라벨 model·gpu·port·framework·**node**). node 라벨은 ADR-0017 §3 배포 후 노드별; 그 전엔 data05만. → `lib/prometheus.ts`에 `queryGpuModels()` 추가.
3. **알려진 엔드포인트 포트** — `inventory.exporters`(node:9100/dcgm:9400) + gpu_model port 라벨 + 정적 known-endpoints(ssh:<SSH_PORT>, grafana:3000, vllm:8003/8010, ollama:11434 — [[keiwi-cloudflare-endpoints]] 근거, `config/known-endpoints.ts`). v1은 "알려진 것만" 명시.

## 컴포넌트 / IA
- **IA 결정(권장)**: 별도 라우트 대신 **Overview 노드 드릴다운에 "서비스" 탭 추가** — 유기적 리팩토링(노드 클릭 → 시스템/GPU/모델/**서비스**). 단, Grafana 탭들과 달리 "서비스"는 콘솔 네이티브 표. (대안: 독립 `/service-map`. spec openQuestion — 사용자 합의 후 확정.)
- **ServiceTable**(server 컴포넌트): 행 = {서비스, 카테고리(ADR-0010), 포트(알려진 경우), GPU 모델(해당 시), 최근 error/warn 수}. 행 우측: **로그**(`/logs` Grafana 딥링크, fleet_node+service var) · **진단**(`/incidents?service=&node=` 어시스턴트 프리필).
- 노드 선택은 기존 `fleet-strip`/`?node=` 재사용.

## 배포 순서 (사람, §11)
v1은 콘솔 코드뿐 → `npm run build && sudo systemctl restart keiwi-console`(사람). data04 모델이 표에 뜨려면 ADR-0017 §3(gpu-model-exporter 배포 + node 라벨) 선행.

## Phase
| Phase | 내용 |
|---|---|
| 1 | lib: service-catalog(OpenSearch 패싯)·queryGpuModels(Prometheus)·known-endpoints — 순수+테스트 |
| 2 | ServiceTable 컴포넌트 + 로그/진단 딥링크 |
| 3 | IA 통합(Overview "서비스" 탭 or /service-map) + 노드 선택 연결 |
| 4 | 검증(typecheck/lint/test/no-raw-hex) + 시각 QA(Playwright) |

## v2.1 재설계 (HOW)

- **탭 상시화**: `overview/page`가 `servicePanel`을 **항상** 전달(노드 선택 무관, `<ServiceTable node={selectedNode?.id} />`). `grafana-tabs`는 servicePanel 있으면 "서비스" 탭 index 0 기본 활성(이미). → 진입 시 서비스가 먼저.
- **lib 집계(모델 중복 제거)**: `lib/prometheus.ts`에 `aggregateGpuModels(rows)` 순수 함수 — `model+framework` 키로 묶어 `{model, framework, gpus:[...], ports:[...], vramBytes:합계}`. (gpu,pid) 시리즈 → 모델 1행. **테스트 대상**.
- **queries 노드 옵션**: `queryGpuModels(node?)`·`queryListeningPorts(node?)`는 이미 node 옵션(미지정=전체). 플릿 뷰는 node 미전달 → 모든 노드(행에 node 뱃지).
- **ServiceTable 2컬럼**: `grid grid-cols-2 gap-3`(모바일 1컬럼) — 좌=**GPU 프로세스**(집계), 우=**리스닝 포트**(주 패널, 각 행 `/incidents?node&q=<process>` 링크로 상태/로그). 로그기반 서비스 섹션 **삭제**(getNodeServices·service-catalog 사용 중단, lib은 유지). 내부 스크롤은 컬럼별(min-h-0 overflow-auto)로 한 화면 유지.
- **known-endpoints**: 포트 라벨 계속 사용.

## 검증 전략
순수 lib 단위테스트(집계 `aggregateGpuModels`·딥링크). **Playwright(격리 프로덕션 빌드, §12)로 화면 보며 검증**: 진입 시 서비스 탭 기본, 2컬럼 렌더, 세로 스크롤 없음(desktop), 모델 중복 없음, 포트 행 링크. 라이트/다크.

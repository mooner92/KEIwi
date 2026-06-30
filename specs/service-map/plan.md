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
3. **알려진 엔드포인트 포트** — `inventory.exporters`(node:9100/dcgm:9400) + gpu_model port 라벨 + 정적 known-endpoints(ssh:764, grafana:3000, vllm:8003/8010, ollama:11434 — [[keiwi-cloudflare-endpoints]] 근거, `config/known-endpoints.ts`). v1은 "알려진 것만" 명시.

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

## 검증 전략
순수 lib 단위테스트(패싯 파싱·딥링크 생성). Playwright: 노드 선택 → 표 렌더 + 행 링크 존재 + OpenSearch 패싯과 일치. (격리 프로덕션 빌드, §12.)

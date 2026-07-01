# 서비스 맵 — Spec (WHAT · WHY)

- 상태: 초안(2026-06-30)
- 권위: 헌장(Constitution.md) 종속 — 충돌 시 헌장 승. [docs/inventory.yaml](../../docs/inventory.yaml) SoT(§0).
- 원칙: Spec이 진실 원천(§7). 행동 변경은 코드보다 이 문서 먼저.
- 관련: HOW=[plan.md](./plan.md) · 작업=[tasks.md](./tasks.md) · 근거=[ADR-0017](../../docs/decisions/0017-node-onboarding-standard.md)·[ADR-0016](../../docs/decisions/0016-gpu-drilldown-dcgm.md)·[ADR-0010](../../docs/decisions/0010-log-taxonomy.md)

## 목적 (WHY)

운영자가 **"어느 노드에서 무슨 서비스/모델이 어느 포트로 도는가"** 를 한 화면에서 보고, 이상한 행을 눌러 **그 서비스의 로그·진단으로 즉시** 이동하도록 한다. 지금은 이 정보가 흩어져 있다 — 서비스는 로그(OpenSearch), GPU 모델은 gpu-model-exporter, 포트는 인벤토리/엔드포인트. 노드별로 통합해 "유기적 실사용"을 만든다.

## 범위

### In (v1 — 신규 수집 0)
- **노드별 카탈로그**: 노드를 고르면 그 노드의 ①서비스 목록(systemd 유닛, 최근 로그 기준) ②GPU 모델(어느 GPU/포트) ③알려진 엔드포인트 포트.
- **행 → 액션**: 각 서비스 행에서 **/logs(Grafana, fleet_node+service 필터) 딥링크** + **어시스턴트(/incidents?service=&node=) 진단** 진입.
- **데이터는 전부 기존 소스**: OpenSearch `service` 패싯(노드별), Prometheus `gpu_model_*`(모델↔GPU↔포트, node 라벨), `docs/inventory.yaml` exporters + 알려진 엔드포인트.

### Out (v2 이후)
- **임의 포트→프로그램 전수 매핑**(현재 데이터로 불가 — 신규 경량 exporter `ss -tlnp` 필요. v2, ADR 별도).
- 토폴로지 그래프/실시간 프로세스 트리/포트 스캔.
- 비-리눅스(data02 Windows) 서비스 카탈로그.

## 사용자 스토리
- **UL1** 운영자로서, 노드를 고르면 그 노드에서 도는 서비스·모델·포트를 한 표로 본다.
- **UL2** 서비스가 이상하면 그 행에서 한 번 클릭으로 로그(/logs 필터) 또는 어시스턴트 진단으로 간다.
- **UL3** GPU 노드는 어떤 모델이 어느 GPU·포트에 떠 있는지(VRAM 포함) 본다 — data04 모델도(에이전트 배포 후).

## 수용 기준 (기계 검증 가능 — §9)

### v1·v2 (달성)
- [x] Overview 노드 드릴다운에 "서비스" 네이티브 탭. GPU 노드는 `gpu_model_*{node=N}` 표시.
- [x] v2: `keiwi_listening_port_info{node=N}`(port·proto·process) 표시(port-exporter).
- [x] 신규 콘솔 수집 0(기존 Prometheus/OpenSearch 재사용). typecheck/lint/test/no-raw-hex.

### v2.1 UI 재설계 (아래 §"v2.1 재설계")
- [ ] "서비스" 탭이 **노드 미선택 시에도 존재·기본 활성**(진입 시 시스템 아닌 서비스가 먼저).
- [ ] 모델 섹션 **중복 제거** — `model+framework` 집계 1행(사용 GPU 목록 + 합계 VRAM).
- [ ] **2컬럼 레이아웃**(좌 GPU 프로세스 / 우 리스닝 포트) — 데스크톱에서 **세로 스크롤 없이** 표시(Playwright 검증).
- [ ] 리스닝 포트 **주 패널(크게)** + 행 클릭 → `/incidents?node&q=<process>`(상태/로그).
- [ ] 로그기반 **서비스 목록 제거**(diff — 불명확·어시스턴트와 중복).
- [ ] typecheck·lint·test·no-raw-hex 통과.

## v2.1 재설계 (2026-07-01 — 라이브 피드백)

라이브 사용 결과 5개 문제 → 결정:

| # | 문제(피드백) | 결정 |
|---|---|---|
| 1 | 진입 시 서비스 탭이 안 보이고 시스템이 나옴 | "서비스" 탭을 **항상 존재·기본 활성**. 노드 미선택=플릿 전체(모든 노드, node 라벨), 노드 선택=해당 노드. |
| 2 | "적재 모델"이 중복·불명확 | `gpu_model_*`는 (gpu,pid)별 시리즈 → **model+framework로 집계**: 1행 = 사용 GPU 목록 + 합계 VRAM. 라벨 "GPU 프로세스" 명확화. |
| 3 | 리스닝 포트가 핵심인데 작음 | 리스닝 포트를 **주 패널(우측, 크게)**. 행 클릭 → `/incidents?node&q=<process>`(상태/로그 진단). |
| 4 | 하단 서비스(로그) 목록 불명확·불필요 | **제거.** 신호/진단은 어시스턴트 탭(현재 신호)이 담당(중복 제거). |
| 5 | 세로 나열 말고 Grafana처럼 조밀하게 | **2컬럼(Notion형)**: 좌=GPU 프로세스 / 우=리스닝 포트. 스크롤 없이 한 화면. |

> 해소된 openQuestion: IA=**Overview 서비스 탭**(확정) · 포트=**v2 전수 수집(port-exporter)** · 서비스 상태=**포트 클릭→어시스턴트 진단**.

## 비범위
- 새 메트릭/로그 수집기 도입(=v2 포트 exporter, 별도 ADR). 콘솔에서 Grafana 대시보드 재구현(§I-2 — 탐색은 /logs Grafana로 위임).

## 의존 결정
| 결정 | ADR |
|---|---|
| 노드 온보딩/에이전트 표준(데이터 출처 신뢰) | ADR-0017 |
| GPU 모델 메트릭 노드 범위(node 라벨 필요) | ADR-0016 |
| 서비스→카테고리 분류축 | ADR-0010 |
| 메트릭 재사용·새 수집 0 패턴 | M3-resources |

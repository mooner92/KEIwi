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
- [ ] `/service-map`(또는 합의된 진입점) 라우트가 200을 반환(force-dynamic).
- [ ] 노드 N을 선택하면 표에 표시되는 서비스 집합이 OpenSearch `terms(service) where fleet_node=N`(최근 24h)와 일치.
- [ ] GPU 노드는 `gpu_model_*{node=N}` 행(모델·GPU·포트·VRAM)이 표시. (data05 즉시, data04는 에이전트 배포 후.)
- [ ] 각 서비스 행에 `/logs?...`(fleet_node+service) 링크와 `/incidents?service=&node=` 링크가 존재.
- [ ] 신규 수집 컴포넌트 0(기존 OpenSearch/Prometheus/inventory만 사용) — diff에 새 exporter/스크레이프 없음.
- [ ] `npm run typecheck && lint && test && check:no-raw-hex` 통과. (빌드는 사람, 라이브 .next §12.)

## 미해결 질문 (openQuestions)
- IA: 새 nav 항목 `/service-map`인가, 아니면 **Overview 노드 드릴다운에 "서비스" 탭** 추가인가(유기적 리팩토링과 연계). → plan에서 1안 확정, 사용자 합의.
- 포트 표기: 알려진 엔드포인트만 보일지(인벤토리+gpu_model port+정적 표) vs v2 전수 수집까지 기다릴지. v1=알려진 것만.
- 서비스 "상태"(up/down)를 행에 넣을지 — node-exporter엔 임의 서비스 상태가 없음(systemd collector 필요). v1=최근 로그 유무/레벨 요약만.

## 비범위
- 새 메트릭/로그 수집기 도입(=v2 포트 exporter, 별도 ADR). 콘솔에서 Grafana 대시보드 재구현(§I-2 — 탐색은 /logs Grafana로 위임).

## 의존 결정
| 결정 | ADR |
|---|---|
| 노드 온보딩/에이전트 표준(데이터 출처 신뢰) | ADR-0017 |
| GPU 모델 메트릭 노드 범위(node 라벨 필요) | ADR-0016 |
| 서비스→카테고리 분류축 | ADR-0010 |
| 메트릭 재사용·새 수집 0 패턴 | M3-resources |

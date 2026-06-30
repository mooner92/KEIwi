# KEIwi · 문서 지도 (docs/)

> KEIwi 프로젝트의 모든 설계·운영 문서 허브. 이 파일은 **지도**입니다(§10 progressive disclosure) — 상세는 각 문서에. 프로젝트 개요·아키텍처는 [`../README.md`](../README.md).

> [!IMPORTANT] 읽는 순서 (권위 순, 헌장 §VI)
> 1. [`../Constitution.md`](../Constitution.md) — 헌장(최우선 권위) → 2. [`inventory.yaml`](./inventory.yaml) — 플릿 단일 기준(§0) → 3. 작업 중인 `../specs/<name>/spec.md`. 에이전트 진입 목차는 [`../AGENTS.md`](../AGENTS.md).

## 🧭 시작 / 권위

| 문서 | 무엇 |
| --- | --- |
| [Constitution.md](../Constitution.md) | 헌장 — 불변 규칙·SDD·안전(§11/§12/§13) |
| [AGENTS.md](../AGENTS.md) | 에이전트 목차·디렉터리 지도 |
| [README.md](../README.md) | 프로젝트 개요·아키텍처·상태 |
| [inventory.yaml](./inventory.yaml) | 플릿 단일 기준(노드·exporters) |

## 📋 스펙 (SDD — `../specs/`)

각 디렉터리는 `spec`(WHAT/WHY) · `plan`(HOW) · `tasks`(체크) 삼분.

| 스펙 | 내용 | 상태 |
| --- | --- | --- |
| [M1-console](../specs/M1-console/spec.md) | 통합 메트릭 콘솔 | ✅ 라이브 |
| [M2-logs](../specs/M2-logs/spec.md) | 통합 로그(OpenSearch·신호 우선) | ✅ 라이브 |
| [M3-resources](../specs/M3-resources/spec.md) | 여유 리소스 → Overview 흡수 | 재배치 |
| [assistant](../specs/assistant/spec.md) | 로그 어시스턴트(로컬 vLLM RAG) | ✅ 라이브 |
| [service-map](../specs/service-map/spec.md) | 노드별 서비스/모델/포트 맵 | 🔄 구현 |
| [krds-redesign](../specs/krds-redesign/spec.md) | KRDS 리스킨·디자인 시스템 | 🔄 |

## 📑 결정 기록 (ADR — `./decisions/`)

| # | 결정 | # | 결정 |
| --- | --- | --- | --- |
| [0001](./decisions/0001-framework-and-styling.md) | 프레임워크·스타일링 | [0010](./decisions/0010-log-taxonomy.md) | 로그 분류(category) |
| [0002](./decisions/0002-grafana-embed.md) | Grafana 임베드 | [0011](./decisions/0011-signal-first-log-ux.md) | 신호 우선 로그 UX |
| [0003](./decisions/0003-inventory-yaml-parser.md) | inventory 파서 | [0012](./decisions/0012-roadmap-m3-m4-pivot.md) | 로드맵 피벗 |
| [0004](./decisions/0004-config-validation-zod.md) | env 검증(zod) | [0013](./decisions/0013-capacity-judgment-policy.md) | 용량 판정 정책 |
| [0005](./decisions/0005-unit-test-runner.md) | 테스트 러너 | [0014](./decisions/0014-log-assistant.md) | 로그 어시스턴트 |
| [0006](./decisions/0006-krds-adoption.md) | KRDS 채택 | [0015](./decisions/0015-assistant-exploratory-query.md) | 어시스턴트 탐색형 질의 |
| [0007](./decisions/0007-brand-color-strategy.md) | 브랜드 컬러 | [0016](./decisions/0016-gpu-drilldown-dcgm.md) | GPU 드릴다운 DCGM |
| [0008](./decisions/0008-log-pipeline.md) | 로그 파이프라인 | [0017](./decisions/0017-node-onboarding-standard.md) | 노드 온보딩 표준 |
| [0009](./decisions/0009-ansible-config-mgmt.md) | Ansible 설정관리 | | |

## 🛠️ 런북 (`./runbooks/`)

| 런북 | 언제 |
| --- | --- |
| [node-onboarding](./runbooks/node-onboarding.md) | 노드 추가/삭제/변경 표준 절차(메트릭·로그) |
| [rsyslog-omfile-flood](./runbooks/rsyslog-omfile-flood.md) | rsyslog 로그 폭주 대응 |

## 🏗️ 인프라 (`../infra/`)

| 영역 | 문서 |
| --- | --- |
| 메트릭(Prometheus·Grafana) | [infra/monitoring](../infra/monitoring/README.md) |
| 로그(OpenSearch·Logstash) | [infra/logging](../infra/logging/README.md) |
| 에이전트 배포(Ansible) | [infra/ansible](../infra/ansible/README.md) |

## 🎨 디자인 / ✅ 테스트 / ✍️ 기타

| 문서 | 무엇 |
| --- | --- |
| [design-system/spec/](../design-system/spec/principles.md) | KRDS 토큰·색·shape·타이포 규약(ADR 0006/0007) |
| [testing.md](./testing.md) | 단위·시각 QA·기능 테스트·격리 빌드 절차 |
| [prompts/M1-console.md](./prompts/M1-console.md) | 마일스톤 빌드 프롬프트 |

---

> [!TIP] 독자별 추천 경로
> - **운영자:** [README](../README.md) → [runbooks/node-onboarding](./runbooks/node-onboarding.md) → Grafana 콘솔
> - **개발자/에이전트:** [AGENTS](../AGENTS.md) → 해당 `specs/<name>/` → [decisions](./decisions)
> - **디자인:** [design-system/spec/principles](../design-system/spec/principles.md) → [ADR-0006](./decisions/0006-krds-adoption.md)·[0007](./decisions/0007-brand-color-strategy.md)

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
| [LICENSE](../LICENSE) | Proprietary · All rights reserved (KEI 내부 전용) |

## 📋 스펙 (SDD — `../specs/`)

각 디렉터리는 `spec`(WHAT/WHY) · `plan`(HOW) · `tasks`(체크) 삼분.

| 스펙 | 내용 | 상태 |
| --- | --- | --- |
| [M1-console](../specs/M1-console/spec.md) | 통합 메트릭 콘솔 | ✅ 라이브 |
| [M2-logs](../specs/M2-logs/spec.md) | 통합 로그(OpenSearch·신호 우선) | ✅ 라이브 |
| [M3-resources](../specs/M3-resources/spec.md) | 여유 리소스 → Overview 흡수 | 재배치 |
| [assistant](../specs/assistant/spec.md) | 로그 어시스턴트(로컬 vLLM RAG) | ✅ 라이브 |
| [logs-assistant](../specs/logs-assistant/spec.md) | 로그 워크벤치(/logs 임베드+어시스턴트 드로어) | ✅ 라이브 |
| [service-map](../specs/service-map/spec.md) | 노드별 서비스/모델/포트 맵 | 🔄 구현 |
| [ownership-attribution](../specs/ownership-attribution/spec.md) | 소유 계정 귀속(사용자/프로세스별 GPU) | ✅ v1 |
| [alerting](../specs/alerting/spec.md) | 알림 정책(임계 3분류·라이브 9건→Slack) | ✅ 9건 라이브 |
| [error-tracking](../specs/error-tracking/README.md) | 앱 런타임 에러 트래킹(GlitchTip) | ✅ 라이브 |
| [hardware-ops](../specs/hardware-ops/README.md) | 하드웨어 운영 확장(BMC·SEL·섀시 전력) | 🔄 착수 전(게이트) |
| [observability-alerting](../specs/observability-alerting/sentry.md) | 앱 에러·하트비트 조사 정본(3안 비교) | 📎 조사 |
| [krds-redesign](../specs/krds-redesign/spec.md) | KRDS 리스킨·디자인 시스템 | 🔄 |
| [sre-addons](../specs/sre-addons/backlog.md) | SRE 추가 기능 백로그(리서치 — 착수는 선택 후) | 후보 |
| [fleet-hardening](../specs/fleet-hardening/README.md) | 운영 부채 5축 교정(정합성·SMART·런북·전력·CI) | 🔄 58/83 |
| [alert-enrichment](../specs/alert-enrichment/README.md) | 알림 보강(현재값·딥링크·LLM 분석·귀속) | ✅ E1·E2 라이브 |
| [auto-remediation](../specs/auto-remediation/README.md) | 자율 사다리 L0~L4 · 조치 제안 | ✅ L1 · L2~ 게이트 |
| [external-watchdog](../specs/external-watchdog/README.md) | 사이트 전체 침묵 감시(L4 외부) | 📎 제안(ADR 대기) |
| [model-ops](../specs/model-ops/spec.md) | 모델 서빙 가시화 · VRAM 사전판정 · 기동/정지 | 📎 초안(Q1~Q4 대기) |
| [fleet-wiki](../specs/fleet-wiki/spec.md) | 서버·계정·프로젝트 문서 그래프(포트 역추적) · 서비스 탭 고도화 | 📎 초안(Q1~Q5 대기) |

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
| [0009](./decisions/0009-ansible-config-mgmt.md) | Ansible 설정관리 | [0022](./decisions/0022-error-tracking-glitchtip.md) | 에러 트래킹(GlitchTip) |
| [0023](./decisions/0023-ci-pipeline.md) | CI 파이프라인 | [0024](./decisions/0024-physical-disk-smart-collection.md) | 물리 디스크 SMART 수집(textfile) |
| [0025](./decisions/0025-alert-relay-webhook.md) | 웹훅 중계(alert-relay) | [0026](./decisions/0026-auto-remediation-ladder.md) | 자동 조치 사다리(L1 제안·L2 승인실행·L4 미채택) |

## 🛠️ 런북 (`./runbooks/`)

> 형식 계약: 모든 런북은 frontmatter(`id`=파일 stem · `kind` · `category`, `kind: alert`는 `alerts`·`severity` 추가)를 갖고
> **이 표에 한 줄로 링크된다.** 둘 다 `scripts/gates/check-runbooks.sh`가 기계 검증한다(R6·R9).
> 골격은 [`runbook-template.md`](./runbook-template.md).
>
> **조치 계약(`tier`·`actions`)**: 모든 런북은 도달 가능 최대 자율 레벨 `tier`(0~3)와 이름 붙은
> 조치 화이트리스트 `actions`를 함께 선언한다 — L1 어시스턴트가 **고를 수 있는 것의 전부**가
> 그 목록이다(자유형 명령 생성 없음, [specs/auto-remediation](../specs/auto-remediation/spec.md) §2.3).
> `risk: high`·`reversible: false`인 조치가 하나라도 있으면 그 런북의 tier는 1 이하로 **강제**된다
> — `scripts/gates/check-runbook-actions.sh`(A5)가 판정한다.
> 아래 tier 열은 **후보 상한**이지 현재 자동화 상태가 아니다 — L2는 [ADR-0026](./decisions/0026-auto-remediation-ladder.md)
> (채택 · `infra/alert-relay/remediation_l2.py`), L3는 **ADR-0027(신설 예정)** 게이트 뒤다.
> 즉 tier 2·3 런북만이 L2 승인 실행의 대상이고, 나머지는 제안까지다.

| 런북 | 언제 | 담당 알림 | tier |
| --- | --- | --- | --- |
| [gpu-xid](./runbooks/gpu-xid.md) | GPU XID 에러 — latched 게이지 판별·코드 분기(앱 vs HW) | `GpuXidErrorNew` · `GpuXidCritical`(미배포) | 1 |
| [gpu-thermal](./runbooks/gpu-thermal.md) | GPU 과열(92°C) — 스로틀 대체 판별, 현재 여유 2°C | `GpuTempHigh` | 0 |
| [node-down](./runbooks/node-down.md) | 노드 무응답 — exporter down vs 노드 down 분기(data04 터널 오판) | `NodeDown` | 0 |
| [disk-pressure](./runbooks/disk-pressure.md) | 디스크 사용률·소진 예측 — **진단·분기** | `DiskUsageHigh` · `DiskFillPredicted` | 1 |
| [disk-usage-high](./runbooks/disk-usage-high.md) | 위 알림의 **화이트리스트 회수 절차**(journal·apt·dangling 이미지만) | ↑ 와 동일(조치 절차서) | **3** |
| [home-migration-to-data](./runbooks/home-migration-to-data.md) | `/home`을 RAID6 배열(`/data`)로 이전 — 근본 원인 제거(사용자별 bind mount) | ↑ 의 근본 원인 | 0 |
| [memory-pressure](./runbooks/memory-pressure.md) | 메모리 고갈·OOM kill (⚠️ data01은 `oom_kill` 미수집) | `MemoryLow` · `OomKillOccurred` | 1 |
| [smart-health-failed](./runbooks/smart-health-failed.md) | SMART 헬스 실패 — 논리 볼륨 수준 판정(물리 디스크는 아래 런북) | `SmartHealthFailed` | 1 |
| [disk-grown-defects](./runbooks/disk-grown-defects.md) | RAID 뒤 **물리 디스크** 열화 — 시리얼로 특정(인덱스는 베이가 아니다) | `DiskGrownDefectsGrowing` · `DiskUncorrectedErrorsGrowing` · `PhysicalDiskDisappeared` | 1 |
| [node-hygiene-coverage-gap](./runbooks/node-hygiene-coverage-gap.md) | 위생 수집기가 없는 노드 존재 = 탐지 사각지대 | `NodeHygieneCoverageGap` | 1 |
| [node-hygiene-stale](./runbooks/node-hygiene-stale.md) | 위생 수집기가 낡은 `.prom`을 계속 서빙 | `NodeHygieneStale` | **2** |
| [reboot-required-stale](./runbooks/reboot-required-stale.md) | 재부팅 부채 청산 절차(알림은 T1-14에서 승격 — 현재 미배포) | `RebootRequiredStale`(미배포) | 0 |
| [log-ingestion-stopped](./runbooks/log-ingestion-stopped.md) | 로그 인입 중단(무성 실패) 대응 — 하트비트 | `LogIngestStalled` | **3** |
| [orphan-port-holder](./runbooks/orphan-port-holder.md) | 고아 프로세스의 포트 점유 — `up=1`이 거짓 초록이 된다(재시작 431,899회) | — (탐지 미배포) | 1 |
| [node-onboarding](./runbooks/node-onboarding.md) | 노드 추가/삭제/변경 표준 절차(메트릭·로그) | — (절차서) | 0 |
| [alert-relay-rollback](./runbooks/alert-relay-rollback.md) | alert-relay 장애 시 알림 경로 복구 — 직송 복귀(파일 1개, <5분) | — (절차서) | 1 |
| [rsyslog-omfile-flood](./runbooks/rsyslog-omfile-flood.md) | rsyslog 로그 폭주 대응 | — (종결 인시던트) | 1 |
| [nvidia-driver-mismatch](./runbooks/nvidia-driver-mismatch.md) | NVIDIA 커널↔유저스페이스 불일치(`nvidia-smi` exit 18 → 재부팅) | — (절차서, 탐지는 `node_nvidia_version_mismatch`) | 0 |

## 🏗️ 인프라 (`../infra/`)

| 영역 | 문서 |
| --- | --- |
| 메트릭(Prometheus·Grafana) | [infra/monitoring](../infra/monitoring/README.md) |
| 로그(OpenSearch·Logstash) | [infra/logging](../infra/logging/README.md) |
| 에이전트 배포(Ansible) | [infra/ansible](../infra/ansible/README.md) |
| 에러 트래킹(GlitchTip·하트비트) | [infra/error-tracking](../infra/error-tracking/README.md) |
| 알림 중계(webhook→Slack 스레드·L1 제안) | [infra/alert-relay](../infra/alert-relay/README.md) |
| 지식그래프 RAG(LightRAG·완전 로컬) | [infra/rag](../infra/rag/README.md) |
| BMC·SEL(하드웨어 이벤트) | [infra/monitoring/bmc](../infra/monitoring/bmc/README.md) |

## 🎨 디자인 / ✅ 테스트 / ✍️ 기타

| 문서 | 무엇 |
| --- | --- |
| [design-system/spec/](../design-system/spec/principles.md) | KRDS 토큰·색·shape·타이포 규약(ADR 0006/0007) |
| [specs/design/](../specs/design/README.md) | KRDS 기반 **이식형 디자인 스펙**(디자인 SoT — 타 프로젝트 복사용) |
| [testing.md](./testing.md) | 단위·시각 QA·기능 테스트(`logs-workbench-test.mjs`·`embed-host-test.mjs`)·격리 빌드 절차 |
| [branching.md](./branching.md) | 브랜치 전략·기여 흐름(main/dev + dev 파생 작업 브랜치, 2026-07-24 도입) |
| [graphify.md](./graphify.md) | 코드·문서 지식 그래프(graphify) 도입 기록 |
| [prompts/M1-console.md](./prompts/M1-console.md) | 마일스톤 빌드 프롬프트 |

---

> [!TIP] 독자별 추천 경로
> - **운영자:** [README](../README.md) → [runbooks/node-onboarding](./runbooks/node-onboarding.md) → Grafana 콘솔
> - **개발자/에이전트:** [AGENTS](../AGENTS.md) → 해당 `specs/<name>/` → [decisions](./decisions)
> - **디자인:** [design-system/spec/principles](../design-system/spec/principles.md) → [ADR-0006](./decisions/0006-krds-adoption.md)·[0007](./decisions/0007-brand-color-strategy.md)

# KEIwi — 에이전트 가이드 (목차 · 지도)

> 이 파일은 **백과사전이 아니라 지도**입니다(헌장 §10). 상세를 인라인하지 않고 권위 있는 소스를 가리킵니다. 개요·다이어그램은 [`README.md`](./README.md)에 있습니다.

> [!IMPORTANT] 모든 작업 세션은 이 순서로 컨텍스트를 읽고 시작합니다 (헌장 §VI)
> 1. **[`Constitution.md`](./Constitution.md)** — 프로젝트 헌장. **불변 규칙이며 모든 문서·코드에 우선**(충돌 시 헌장 승).
> 2. **[`docs/inventory.yaml`](./docs/inventory.yaml)** — 플릿 단일 기준(SoT, §0). 노드 추가·변경은 이 파일에서 시작 → 절차는 [`docs/runbooks/node-onboarding.md`](./docs/runbooks/node-onboarding.md).
> 3. 작업 중인 **spec** — `specs/<name>/spec.md`.

## 🗺️ 디렉터리 지도

| 경로 | 내용 |
| --- | --- |
| ⚖️ `Constitution.md` | 헌장 (최우선 권위) |
| 🗺️ `AGENTS.md` | 이 목차 |
| 📖 `README.md` | 레포 개요·아키텍처·상태 |
| 📄 `LICENSE` | Proprietary · All rights reserved (KEI 내부 전용 §I-1) |
| 📍 `docs/inventory.yaml` | 플릿 단일 기준(SoT) — 노드·exporters |
| 📑 `docs/decisions/` | ADR `NNNN-*.md` — 모든 의존성·기술 선택 근거(§8) |
| 🛠️ `docs/runbooks/` | 운영 런북 — `node-onboarding` · `rsyslog-omfile-flood` · `log-ingestion-stopped` |
| ✍️ `docs/prompts/` | 마일스톤별 빌드 프롬프트 |
| ✅ `docs/testing.md` | 시각 QA(Playwright) 절차 |
| 🌿 `docs/branching.md` | 브랜치 전략·기여 흐름(main/dev + dev 파생 작업 브랜치) |
| 🕸️ `docs/graphify.md` | 코드·문서 지식 그래프 도입 기록(graphify) |
| 📋 `specs/<name>/` | SDD 삼분(`spec`·`plan`·`tasks`[·`research`]) — M1-console·M2-logs·M3-resources·assistant·logs-assistant(로그 워크벤치)·service-map·ownership-attribution·alerting(라이브 9건)·error-tracking(GlitchTip)·hardware-ops·observability-alerting(조사)·krds-redesign·sre-addons(백로그) |
| 🎨 `specs/design/` | **이식형 디자인 시스템 스펙**(KRDS 기반, 디자인 SoT — 다른 프로젝트 복사 가능) |
| 🎨 `design-system/spec/` | KRDS 토큰·색·shape·타이포 규약(ADR 0006/0007) |
| 🤖 `infra/` | 관제 스택 — 레포는 **권장본 생성만**, 라이브 적용은 사람(§11·§12). `monitoring/`(prometheus·grafana 프로비저닝=바인드 마운트·`docker-compose.yml` 권장본·gpu-model/port-exporter·터널)·`logging/`·`ansible/` |
| 🧠 `infra/rag/` | LightRAG 지식그래프(vLLM+bge-m3, egress 0) — 진단·검색 계층 |
| 📮 `infra/alert-relay/` | 알림 중계 + L1 조치 제안(실행 기능 0) |
| 🔩 `infra/monitoring/bmc/` | BMC·SEL 백필 — 관측 스택 사각지대 |
| 🖥️ `apps/console/` | KEIwi 콘솔 (Next.js 16 · KRDS) — 검증 스크립트는 `scripts/`(screenshot·logs-workbench-test·embed-host-test·assistant-func-test) |

## 🔄 워크플로 (SDD)

```
헌장 → /specify (WHAT+WHY) → /plan (HOW + ADR) → /tasks → /verify
```

- **Spec이 진실의 원천** — 행동 변경은 코드가 아니라 spec을 먼저 고친다(§7).
- 모든 의존성·기술 선택은 **ADR**로 근거를 남긴다(§8).
- 수용 기준은 **기계 검증 가능**해야 한다(§9).

## 🖥️ 콘솔 실행법 (`apps/console`)

> [!NOTE]
> 콘솔 명령은 `apps/console`에서 실행합니다. dev 포트는 **3105**(라이브 스택과 분리). 콘솔은 라이브로 `.next`를 서빙하므로 **`npm run build`·재시작은 사람이**(§11·§12) — 에이전트 검증은 build 제외로 돌리고, 풀 빌드/기능 검증은 **격리 빌드**(git worktree + 포트 `:3199`, [docs/testing.md](./docs/testing.md))로 합니다.

```bash
cd apps/console
npm install
cp .env.example .env.local   # 값은 직접 채움 (커밋 금지 §13)
npm run dev                  # http://localhost:3105

# 에이전트 검증(build 제외 — 라이브 .next 보호):
npm run typecheck && npm run lint && npm run test && npm run check:no-raw-hex && npm run check:secrets
npm run screenshot           # Playwright 시각 QA (UI 변경 시 — docs/testing.md)

# PR 전 표준 — 레포 전역 게이트 전수(기본 build 제외, §12). CI가 도는 것과 같은 게이트다.
#   rc=0 통과 / 1 위반 / 2 SKIP(도구 부재 — "안 돌았는데 초록"을 만들지 않는다)
cd "$(git rev-parse --show-toplevel)" && bash scripts/verify-all.sh
#   rc=2면 도구가 없는 것: bash scripts/gates/install-gate-tools.sh (사용자 레벨 설치)

# 격리 빌드(:3199) 위 기능 테스트 (절차·전제는 docs/testing.md):
BASE=http://127.0.0.1:3199 node scripts/logs-workbench-test.mjs   # /logs 워크벤치 AC1~AC5
BASE=http://127.0.0.1:3199 node scripts/embed-host-test.mjs       # 임베드 host 분기(로그인 루프 회귀 가드)
```

- 환경변수는 `src/config/env.ts`에서 zod로 한 곳에서만 검증해 읽는다.
- `.env.local`·시크릿은 **절대 커밋하지 않는다**(§13).

## 📌 마일스톤

> 로드맵 조정([ADR-0012](./docs/decisions/0012-roadmap-m3-m4-pivot.md)): M3→Overview 흡수 · M4 보류 · 다음=M1/M2 고도화. 상태표 상세는 [README](./README.md#상태--다음).

- **M1** 통합 메트릭 콘솔 — ✅ 라이브
- **M2** 통합 로그(OpenSearch·신호우선) — ✅ 라이브
- **M3** 여유 리소스 → Overview 흡수 · **M4** 장애추적 보류
- **M5** 크리티컬 에러 알림 — ✅ 1차 라이브(2026-07-31): Grafana 규칙 9건→Slack `#keiwi-infra` · 하트비트 dead man's switch([specs/alerting](./specs/alerting/spec.md) v2)
- **M6** 에러 트래킹(앱 런타임) — ✅ 라이브: GlitchTip 자체호스팅([ADR-0022](./docs/decisions/0022-error-tracking-glitchtip.md), [specs/error-tracking](./specs/error-tracking/README.md))→`#keiwi-web`
- 고도화 완료: 로그 워크벤치(`/logs` 어시스턴트 통합, [specs/logs-assistant](./specs/logs-assistant/spec.md)) · 노드 온보딩 표준(data03 실증, 2026-07-03) · 서비스 맵 v2.1 · 소유 계정 귀속 v1([specs/ownership-attribution](./specs/ownership-attribution/spec.md)) · 디자인 v2([specs/design](./specs/design/README.md))
- 다음: 하드웨어 운영 확장 게이트([specs/hardware-ops](./specs/hardware-ops/README.md)) · 디자인 v3([specs/krds-redesign](./specs/krds-redesign/spec.md)) · SRE 추가 기능 백로그([specs/sre-addons](./specs/sre-addons/backlog.md))

## 📑 ADR 색인 ([`docs/decisions/`](./docs/decisions))

| # | 결정 | # | 결정 |
| --- | --- | --- | --- |
| [0001](./docs/decisions/0001-framework-and-styling.md) | Next.js 16 + Tailwind v4(`@theme`) | [0010](./docs/decisions/0010-log-taxonomy.md) | 로그 분류(category) |
| [0002](./docs/decisions/0002-grafana-embed.md) | Grafana iframe 임베드(단일 콘솔) | [0011](./docs/decisions/0011-signal-first-log-ux.md) | 신호 우선 로그 UX |
| [0003](./docs/decisions/0003-inventory-yaml-parser.md) | inventory 파서(`yaml`) | [0012](./docs/decisions/0012-roadmap-m3-m4-pivot.md) | 로드맵 M3→Overview·M4 보류 |
| [0004](./docs/decisions/0004-config-validation-zod.md) | env 검증(`zod` fail-fast) | [0013](./docs/decisions/0013-capacity-judgment-policy.md) | 용량(여유) 판정 정책 |
| [0005](./docs/decisions/0005-unit-test-runner.md) | 테스트 러너(`vitest`) | [0014](./docs/decisions/0014-log-assistant.md) | 로그 어시스턴트(로컬 vLLM RAG) |
| [0006](./docs/decisions/0006-krds-adoption.md) | KRDS 채택(tokens-only) | [0015](./docs/decisions/0015-assistant-exploratory-query.md) | 어시스턴트 탐색형 질의 |
| [0007](./docs/decisions/0007-brand-color-strategy.md) | 브랜드↔KRDS 색 전략 | [0016](./docs/decisions/0016-gpu-drilldown-dcgm.md) | GPU 드릴다운 DCGM 분리 |
| [0008](./docs/decisions/0008-log-pipeline.md) | 로그 파이프라인 | [0017](./docs/decisions/0017-node-onboarding-standard.md) | **노드 온보딩 표준** |
| [0009](./docs/decisions/0009-ansible-config-mgmt.md) | Ansible 설정관리 | [0022](./docs/decisions/0022-error-tracking-glitchtip.md) | 에러 트래킹(GlitchTip 자체호스팅) |

## ⛔ 안전 규칙 (요약 — 상세는 헌장)

- **단일 콘솔 = Grafana** — 재구현 금지. 임베드 대시보드는 UI 수제 아닌 **레포 프로비저닝**(§I-2, ADR-0016).
- **에이전트 생성 · 사람 적용** — 프로덕션 배포·SSH 설치는 사람(§11).
- **개발 격리** — 라이브 `.105` 스택 방해 금지(§12).
- **시크릿 레포 밖**(§13).

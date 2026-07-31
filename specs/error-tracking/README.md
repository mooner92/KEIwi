# 에러 트래킹 (Error Tracking) — GlitchTip 자체호스팅

> **한 문장: 콘솔이 500을 뱉어도 우리 관측 스택에는 아무 기록이 남지 않는다.**
>
> 메트릭은 Prometheus가, 로그는 OpenSearch가, 인프라 알림은 Grafana가 본다(전부 라이브).
> **앱 런타임 예외를 보는 계층만 0건이다.** 이 스펙 묶음이 그 하나를 채운다.

- 작성 2026-07-30. 상태: **배치 결정 확정([ADR-0022](../../docs/decisions/0022-error-tracking-glitchtip.md)) → [spec §0 검증 게이트](./spec.md#0-착수-전-검증-게이트--실측으로만-통과한다) 통과 후 착수.**
- 권위: [헌장](../../Constitution.md)(§I-1 온프렘 only · §I-2 단일 콘솔=Grafana · §8 의존성=ADR · §9 기계 검증 · §11 생성/적용 분리 · §13 시크릿 레포 밖 · §15 노이즈 최소화) + [ADR-0014](../../docs/decisions/0014-log-assistant.md)(어시스턴트 egress 0).
- **조사 정본은 [`specs/observability-alerting/sentry.md`](../observability-alerting/sentry.md)(49 KB)다.** 3안 비교(SaaS / self-hosted Sentry / GlitchTip)·Sentry Logs 기각 수치·반출 필드 전량 표가 거기 있다. **이 폴더는 그것을 반복하지 않고 참조한다.** 여기 있는 것은 "GlitchTip으로 간다"가 확정된 뒤의 **실행 스펙**이다.
- 표기: **[실측]** = 2026-07-30 라이브/소스 확인값 · **[조사]** = 업스트림 소스·문서에서 확인 · **[미확인]** = 게이트로 남김 · `[server]` = 사람이 적용(§11).

---

## 1. 경계 — 무엇을 여기서 다루고 무엇을 다루지 않는가

관측 평면이 4개다. **이 스펙은 그중 하나만 담당한다.**

| 평면 | 담당 시스템 | 상태 | 이 스펙과의 관계 |
|---|---|---|---|
| **앱 런타임 에러** (Next.js 콘솔 예외·API route 실패) | **GlitchTip** (신규) | **0건 — 공백** | **이 스펙** |
| 인프라 지표 임계 (노드·디스크·GPU온도·메모리) | Grafana 통합 알림 | **라이브** — 규칙 5건(NodeDown·LogIngestStalled·DiskUsageHigh·GpuTempHigh·MemoryLow), contact point 2건 | **손대지 않는다.** GlitchTip에 지표 임계 규칙을 단 1건도 만들지 않는다(§I-2) |
| 로그 (journald 5노드) | Filebeat→Logstash→OpenSearch 365일 → Grafana | 라이브 | **손대지 않는다.** GlitchTip `enableLogs`는 `false`(sentry.md §4가 수치로 기각) |
| **무성 실패**(아무 신호도 안 오는 것) | GlitchTip **Heartbeat** + data03 교차 관찰자 | 0건 — 공백 | **이 스펙** (§6) |

### 1.1 인접 스펙과의 역할 분담

| 문서 | 담당 | 겹치지 않게 하는 규칙 |
|---|---|---|
| [`specs/alerting/spec.md`](../alerting/spec.md) v1.1 | **정책** — 5원칙 · SEV 3단 · 신규 알림 4문 게이트 · 노이즈 5중 방어 | 이 스펙은 정책을 **바꾸지 않고 따른다.** 앱 에러 = **SEV2**(야간 폰 안 울림, 아침 큐) → `#keiwi-web`. GlitchTip은 SEV 라벨 체계를 재발명하지 않는다 |
| [`specs/hardware-ops/`](../hardware-ops/README.md) 축2 | **인프라 알림 구현** — Grafana 엔진·PromQL 규칙·Slack 채널·섀도 모드·`roles/watchdog`(T4-12) | 이 스펙은 축2가 **원리적으로 못 덮는 것만** 담당한다: (a) 콘솔 프로세스 안에서 던져진 예외 (b) 발화 주체(Grafana)가 죽었을 때의 백스톱. **`roles/watchdog`을 새로 만들지 않고 축2 T4-12의 role에 항목을 추가한다** |
| [`specs/observability-alerting/sentry.md`](../observability-alerting/sentry.md) | **조사 정본** — 3안 비교·필드 반출 표·기각 근거 | 중복 서술 금지. 이 스펙은 §를 인용한다. sentry.md의 **정정 필요 4곳은 §4**에 적었다 |

> [!IMPORTANT]
> **중복 금지 규칙 2건.**
> ① **메트릭 임계 알림을 GlitchTip으로 만들지 않는다.** Grafana 규칙 5건이 이미 라이브다. 알림 UI가 두 개가 되는 순간 이 스펙이 스스로 §I-2를 깬다.
> ② **로그를 GlitchTip에 넣지 않는다.** GlitchTip은 `log`·`otel_log` 아이템을 **실제로 지원**하므로(sentry.md §4의 Sentry Logs 기각과 달리 "무시되지 않는다") 켜면 정말 저장된다. 그래서 위험이 더 크다 — `enableLogs: false` 고정.

---

## 2. 왜 GlitchTip인가 — 재논의 금지, 근거만

상세 3안 비교는 [sentry.md §5](../observability-alerting/sentry.md). 여기는 **결정을 지탱하는 4개 사실**만 남긴다.

| 축 | Sentry Free (Developer) | Sentry Team | **GlitchTip self-host** |
|---|---|---|---|
| **Slack 알림** | **불가 — 이메일만** | 가능 | **가능** — `GENERAL_WEBHOOK` = "General **Slack-compatible** webhook"이 소스에 명시[조사] |
| 비용 | 0 | **$26/월** | 0 (MIT) |
| seat | **1명** | 팀 | 무제한 |
| 보존 | 30일 | 90일 | env로 우리가 정한다(§spec 2.5) |
| **스택트레이스·파일경로 반출** | 외부 SaaS로 나간다 | 동일 | **egress 0** — data05 안에 머문다 |
| 컨테이너 수 | 0 | 0 | **3개**(web·postgres·valkey). self-hosted Sentry는 **65개**(sentry.md §5.2에서 기각) |
| dead man's switch | Crons(무료 monitor **1개**) | $0.78/monitor | **내장 Heartbeat, 개수 제한 없음** |
| 벤더 잠금 | — | — | **없음** — `@sentry/nextjs` 그대로 쓰고 DSN만 교체[조사] |

**결정 근거 요약**
1. **Sentry Free는 Slack에 못 보낸다.** 1인 운영이 이메일을 실시간으로 안 본다는 판정은 [alerting spec §5](../alerting/spec.md)가 이미 내렸다 → 무료 플랜은 요구를 충족하지 못한다. 유료는 $26/월.
2. **egress 0이 이 상황에서 가장 큰 이점이다.** 개인 Slack 워크스페이스를 쓰는 상태에서, KEI 내부 파일경로·스택트레이스·내부 IP가 외부 SaaS에 **되돌릴 수 없이** 적재되는 것을 피한다(sentry.md §1.2 — "개별 이벤트 삭제 불가, 프로젝트 삭제·재생성이 공식 안내").
3. **Sentry SDK 호환이라 되돌리기가 싸다.** DSN 한 줄 교체면 SaaS로 갈 수 있다(§ADR-0022 "되돌리기 비용").
4. **규모가 맞다.** 512 MB 권장 · 3 컨테이너 vs data05 RAM 256 GB · `/data` 3.5 TB 중 11% 사용[실측]. 관측 도구가 관측 대상보다 커지지 않는다(§6 지루한 기술).

> [!NOTE]
> **GlitchTip이 해결하지 못하는 것 하나를 처음부터 적어둔다.** 관찰자가 피관찰자와 **같은 호스트**(data05)에 산다. data05가 통째로 죽으면 Logstash·Prometheus·Grafana·GlitchTip이 함께 죽고 아무 알림도 안 뜬다. 단 **실제 5.7일 사고는 data05가 살아 있는 상태에서 인입만 멈춘 것**이라 heartbeat가 100% 잡는다. 남는 구멍("호스트 전체 사망")은 **data03 교차 관찰자**로 메운다 — [spec §6.4](./spec.md#64-정직해야-하는-부분--관찰자가-피관찰자와-같은-호스트다).

---

## 3. 현재 공백 — 콘솔 에러 관측이 0이다

`apps/console` 실측[2026-07-30]:

| 확인 | 결과 | 의미 |
|---|---|---|
| `instrumentation.ts` | **없음** | 서버 런타임 예외 훅이 없다 |
| `instrumentation-client.ts` | **없음** | 브라우저 예외가 아무 데도 안 남는다 |
| `src/app/global-error.tsx` | **없음** | React 렌더 에러가 조용히 흰 화면이 된다 |
| `src/app/error.tsx` | **없음** | 라우트 단위 에러 바운더리도 없다 |
| 런타임 의존성 | **5개**(next·react·react-dom·yaml·zod + krds-uiux) | 에러 트래커 관련 0 |
| 예외의 현재 종착지 | 콘솔 프로세스 **stdout → journald** | 검색은 되지만 **집계·중복묶기·알림이 0**. "며칠 전 그 500이 몇 번 났나"에 답할 수 없다 |

구체적으로 잃고 있는 것:

- `src/app/api/assistant/route.ts`가 `502 어시스턴트 처리 실패: ${e.message}`를 반환한다 → 연구원은 실패를 보지만 **SRE는 모른다.**
- `lib/prometheus.ts`·`lib/opensearch.ts`·`lib/vllm.ts`가 던지는 에러(`[prometheus] HTTP 500` 등)가 어디에도 집계되지 않는다.
- `lib/inventory.ts:16`은 **경로 + zod 메시지**를 실어 던진다(인벤토리 호스트명·IP 포함 가능) — 지금은 아무도 안 보지만, 트래커를 붙이는 순간 **반출 경계 문제로 바뀐다**([spec §5](./spec.md#5-콘솔-sdk-설정과-반출-경계)).

> [!WARNING]
> **Grafana iframe 노이즈는 이 공백의 일부가 아니다.** 콘솔은 Grafana를 **다른 오리진**으로 임베드한다(`lib/grafana-host.ts`) → 크로스 오리진 iframe 안의 JS 에러는 **우리 SDK에 도달하지 않는다.** sentry.md §6.2가 `denyUrls`에 Grafana 패턴을 넣은 근거는 **틀렸다**(§4). 없는 위험을 방어하는 코드를 남기면 다음 사람이 또 방어한다.

---

## 4. sentry.md에 되돌려 반영할 정정 4건 (§7 드리프트=버그)

이 스펙을 쓰는 과정에서 **소스 확인으로 뒤집힌** 것들이다. 정정하지 않으면 다음 세션이 틀린 전제로 짠다.

| 대상 | 기존 서술 | 정정 | 근거 |
|---|---|---|---|
| sentry.md **§3.3** | 하트비트에 "`status=error`도 보낸다" | GlitchTip heartbeat API에 **`status` 파라미터가 없다.** 판정이 뒤집힌다 → **"정상일 때만 보낸다. 비정상은 부재로 표현한다."** | `apps/uptime/api.py` heartbeat_check 시그니처[조사] |
| sentry.md **§5.3** | "GlitchTip이 Sentry Crons 체크인 API를 구현하는지 **미확인**" | **구현하지 않는다.** `check_in`은 `IgnoredItemType` → 보내면 **200 받고 조용히 폐기.** `captureCheckIn()` 전면 금지 | `apps/event_ingest/schema.py`[조사] |
| sentry.md **§6.1** | SaaS 전제 필드표("외부 SaaS로 나가는가") | 기준선이 바뀐다. 자체호스팅은 망 밖이 닫히지만 **Slack에는 나간다** → 판정 기준은 **"Slack에 실려도 되는가"**([spec §5.2](./spec.md#52-slack-반출-경계--실제로-망-밖으로-나가는-필드)) | `apps/alerts/webhooks.py`[조사] |
| sentry.md **§6.2** | `denyUrls`에 `/\/grafana\//` — "Grafana iframe 노이즈가 쿼터를 태운다" | **틀렸다.** 크로스 오리진이라 우리 SDK에 도달하지 않는다. 그리고 자체호스팅엔 쿼터가 없다 | `lib/grafana-host.ts`(오리진 분리)[실측] |

추가로 **[`docs/runbooks/log-ingestion-stopped.md`](../../docs/runbooks/log-ingestion-stopped.md)** §"dead man's switch"에 구현체(`keiwi-log-ingest` heartbeat)를 명시한다 — tasks E5-2.

---

## 5. 파일 지도

| 파일 | 내용 |
|---|---|
| **README.md**(이 문서) | 경계 · GlitchTip 채택 근거 · 현재 공백 · sentry.md 정정 |
| [spec.md](./spec.md) | **검증 게이트(§0)** · 사용자 스토리 · 배치 설계 · 시크릿 · Slack 연동 · SDK 반출 경계 · dead man's switch · **실패 모드** · 수용 기준 `AC-E-*` |
| [tasks.md](./tasks.md) | 실행 순서(크기 · 선행조건 · `[server]`) — **가장 작은 검증부터 하나씩** |
| [ADR-0022](../../docs/decisions/0022-error-tracking-glitchtip.md) | 결정 기록 — 맥락 · 대안(Sentry Free/Team) · 근거 · 결과 · 되돌리기 비용 |

산출 예정 아티팩트(**전부 레포에 생성만**, 적용은 사람 §11):

| 경로 | 내용 |
|---|---|
| `infra/error-tracking/docker-compose.yml` | GlitchTip 3서비스 권장본. 라이브는 `/data/glitchtip/`([spec §2.1](./spec.md#21-왜-datamonitoring에-합치지-않는가--분리-결정)) |
| `infra/error-tracking/.env.example` | 키 목록만. **값은 절대 없다**(§13) |
| `infra/error-tracking/scripts/check-env.sh` | 배포 **전** env 키 존재·길이 검증(빈 시크릿이 기동을 막는 사고 재발 방지) |
| `infra/ansible/roles/watchdog/templates/keiwi-heartbeat-*.sh.j2` | heartbeat 송신 스크립트 + systemd timer. **축2 T4-12의 role에 얹는다** |
| `apps/console/instrumentation.ts` · `instrumentation-client.ts` · `sentry.server.config.ts` · `sentry.edge.config.ts` · `src/app/global-error.tsx` | SDK 배선 |
| `apps/console/scripts/check-error-tracking.sh` | 정적 금지 규칙 CI(`npm run verify` 편입) |
| `docs/runbooks/glitchtip-heartbeat-missed.md` · `docs/runbooks/glitchtip-down.md` | 런북 2종 |

---

## 6. 이 스펙이 하지 않는 것 (스코프 아웃 — 암묵 누락 금지)

- **Sentry SaaS 도입** — ADR-0022에서 기각. sentry.md §5.1의 무료 플랜 제약(Slack 불가·seat 1·보존 30일)과 Team $26/월이 근거.
- **self-hosted Sentry** — sentry.md §5.2에서 기각(65 컨테이너·16 GB RAM). 재검토 조건은 "5노드 → 50노드 + 전용 관제 호스트".
- **Sentry Crons 문법의 cron 모니터링** — `check_in`이 폐기된다(§4). heartbeat만.
- **Tracing / Performance** — `tracesSampleRate: 0`. 성능은 Prometheus(§I-3). GlitchTip은 `transaction`을 지원하지만 span에 내부 URL·PromQL이 실려 **반출면만 넓힌다**.
- **Session Replay · Profiling · Release health · trace metrics** — GlitchTip이 `IgnoredItemType`으로 **폐기한다**[조사]. 켜면 200 받고 아무 일이 안 일어난다.
- **소스맵 업로드** — v1 OFF(`sourcemaps.disable: true`). 열람자가 Cloudflare Access 통과자 전원이므로 "사내니까 괜찮다"가 성립하지 않는다.
- **GlitchTip 로그 인입(`GLITCHTIP_ENABLE_LOGS`) 활용** — 기본 True로 두되 **SDK에서 보내지 않는다**. 로그 정본은 OpenSearch 365일.
- **DuckDB cold storage · MCP 서버** — `GLITCHTIP_ENABLE_DUCKDB`·`GLITCHTIP_ENABLE_MCP` 둘 다 `"False"`. 신규 표면을 늘리지 않는다.
- **사외 1비트 외부 관찰자** — "GlitchTip을 골랐으니 필요 없다"는 **사실이 아니다.** 서로 다른 실패를 덮는 서로 다른 장치이므로 **별건으로 남긴다**([spec §10 Q3](./spec.md#10-결정-대기)).
- **자동 조치** — GlitchTip 이슈를 근거로 서비스를 자동 재기동하지 않는다(§11).
- **사용자 귀속 알림** — v1은 SRE-facing만(alerting spec §8 유지).

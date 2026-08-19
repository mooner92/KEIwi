# Sentry 도입 설계 — 앱 에러 계층과 무성 실패 하트비트

> **한 문장: Sentry는 우리가 원하는 세 가지 중 하나에만 맞는다.**
> 앱 에러 트래킹(맞음) · 무성 실패 하트비트(**정확히 맞음, 이게 5.7일 장애의 해답이다**) · 로그 수집(맞지 않음 — 수치로 기각).
>
> 그리고 이 도입의 동기가 "보안 때문에 Slack이 안 된다"라면, **전제가 두 번 틀렸다.**
> ① Slack은 이 환경에서 네트워크로 막혀 있지 않다(실측). ② 보안이 이유라면 Sentry.io는 Slack보다 **노출면이 크다**.

- 작성 2026-07-30. 상태: **설계안 — §10 결정 대기 5건 답변 후 착수 판정.**
- 권위: 헌장(§I-1 온프레미스 only · §I-2 단일 콘솔=Grafana · §8 의존성=ADR · §9 기계 검증 · §11 생성/적용 분리 · §13 시크릿 레포 밖 · §15 알림 노이즈 최소화) + ADR-0014(어시스턴트 egress 0).
- 이 문서의 모든 수치는 **2026-07-30 data05 라이브 실측**이다. 추정은 "가설"로 표기했다.

## 0. 이 문서의 자리 — 기존 스펙과 무엇이 다른가

| 문서 | 담당 | 이 문서와의 관계 |
|---|---|---|
| [`specs/alerting/spec.md`](../alerting/spec.md) v1.1 | **정책** — 무엇을·언제·어디로 알릴지(5원칙·SEV 3단·4문 게이트·inhibition·W1) | 이 문서는 정책을 **바꾸지 않는다.** §3의 Sentry Crons는 **§3.0 W1 관찰자의 3번째 선택지**이고, §7의 라우팅은 §5 채널표를 따른다 |
| [`specs/hardware-ops/`](../hardware-ops/README.md) 축2 | **인프라 알림 구현** — Grafana 통합 알림 엔진·PromQL 규칙 v1·Slack egress 예외 1건·섀도 모드 | 이 문서는 축2가 **원리적으로 못 덮는 두 영역**만 담당한다: (a) Next.js 콘솔 런타임 예외 (b) data05가 통째로 죽었을 때의 외부 관찰자 |
| **이 문서** | **앱 에러 계층 + 외부 하트비트** | 축2가 SEV1을 발화시켜도 **발화 주체가 죽으면 소용없다**(§2.9의 SPOF). Sentry Crons는 그 구멍을 메운다 |

> [!IMPORTANT]
> **중복 금지 규칙.** 메트릭 임계 알림(GPU 온도·디스크·로그 신선도)을 Sentry로 구현하는 것은 이 문서가 **명시적으로 금지**한다(§2.2). 축2의 Grafana 규칙과 두 개의 알림 시스템이 생기면 헌장 §I-2(단일 콘솔)를 이 문서가 스스로 깬다.

---

## 1. 사용자 전제 검증 [실측] — 두 개가 틀렸다

### 1.1 Slack은 막혀 있지 않다

2026-07-30, data05에서 직접 측정. `curl -o /dev/null -w '%{http_code}'`, 타임아웃 12s.

| 대상 | TCP:443 | HTTPS 응답 | 판정 |
|---|---|---|---|
| `sentry.io/api/0/` | OPEN | **200** | 애플리케이션 레벨 도달 |
| `o0.ingest.sentry.io/api/0/envelope/` | OPEN | **404** | 도달(경로만 무효) — **이벤트 전송 경로 열림** |
| `de.sentry.io/api/0/` (EU 리전) | OPEN | **404** | 도달 — EU 리전도 선택 가능 |
| **`hooks.slack.com`** | **OPEN** | (hardware-ops §2.5 실측: **404 + body `no_team`**) | **애플리케이션 레벨까지 도달 확정** |
| `ntfy.sh/v1/health` | OPEN | **200** | 공개 ntfy 도달 |
| `api.pushover.net/1/messages.json` | OPEN | **400** | 도달(파라미터 없음) — 모바일 푸시 경로 존재 |
| `hc-ping.com` (healthchecks.io) | OPEN | **400** | 도달 — 외부 하트비트 대안 존재 |
| `api.github.com` | OPEN | (200, hardware-ops 실측) | 도달 |
| `api.telegram.org` | OPEN | **000** | **TCP는 붙지만 TLS/HTTP에서 차단** |
| `discord.com/api/v10/gateway` | OPEN | **000** | **동일 — Discord 불가** |

> [!WARNING]
> **TCP 도달성 ≠ 사용 가능.** Telegram·Discord는 `/dev/tcp` 연결은 성공하고 HTTPS에서 000으로 죽는다. 반대로 Slack·Sentry·Pushover는 애플리케이션 레벨 응답까지 온다. **"포트가 열렸다"로 판정하면 두 번 틀린다** — 판정은 반드시 HTTP 상태코드로 한다.

**결론: "Slack이 보안 때문에 안 된다"는 data05 네트워크 차원에서 성립하지 않는다.** 다만 이것이 *조직 정책상 안 된다*는 주장을 반박하지는 않는다 — 사내 SaaS 사용 규정, KEI Slack 워크스페이스 부재, 계정 발급 불가 같은 **네트워크 밖 사유**는 여전히 가능하다. → §10 Q2에서 확인한다. 단정하지 않는다.

### 1.2 보안이 이유라면 Sentry.io는 Slack보다 노출이 크다 — 역설을 정면으로 다룬다

| | Slack webhook | Sentry.io (에러) | Sentry.io (Crons 체크인) |
|---|---|---|---|
| 외부로 나가는 것 | **우리가 고른 텍스트 몇 줄** (hardware-ops §2.5에서 이미 라벨 화이트리스트로 고정: alertname/severity/node/gpu/job) | **에러 이벤트 전체** — 스택트레이스·소스 스니펫·요청 URL·헤더·breadcrumbs·모듈 목록·hostname·OS/커널 | **"살아있다" 1비트** + org/project id + 소스 IP |
| 우리가 통제하는가 | **완전히** (템플릿이 화이트리스트) | **부분적** — 기본값이 "많이 보낸다" 쪽이고 우리가 깎아내야 한다 | **완전히** (URL 하나) |
| 소스코드가 나가는가 | 아니오 | **예** (스택 프레임의 `context_line`, 소스맵 업로드 시 소스 전체) | 아니오 |
| 보존 | Slack 정책 | 30일(무료)/90일(Team) | 30일 |
| 되돌릴 수 있는가 | 채널 삭제 | **아니오** — 개별 이벤트 삭제 불가, "많은 이벤트에 민감정보가 들어갔으면 프로젝트를 삭제·재생성하라"가 공식 안내 | 사실상 무해 |

> [!CAUTION]
> **가장 정직한 문장.** 노출을 줄이려고 Slack을 피해 Sentry로 가는 것은 **노출을 늘리는 방향이다.** 다만 이것이 "Sentry를 쓰지 말라"는 결론은 아니다 — **어느 기능을 쓰는가에 따라 노출이 100배 차이 난다.** Crons(§3)는 Slack보다 노출이 **작고**, Logs(§4)는 Slack보다 노출이 **수만 배 크다.** 그래서 이 문서는 Sentry를 기능 단위로 쪼개서 판정한다.

---

## 2. Sentry가 잘 맞는 것 / 안 맞는 것

Sentry의 본질은 **애플리케이션 에러 트래커**다. 인프라 메트릭 알림 도구가 아니다.

| 요구 | Sentry 적합 | 근거 | 우리 처분 |
|---|---|---|---|
| Next.js 콘솔 런타임 예외(`apps/console`) | **✅ 잘 맞음** | 현재 우리 관측 스택에 **앱 예외 계층이 0**이다. 콘솔이 500을 뱉어도 Prometheus·OpenSearch 어디에도 안 남는다(journald의 컨테이너 stdout 뿐) | **채택**(§6 방어 조건부) |
| `/api/assistant`·`/api/fleet/status` 실패 원인 추적 | ✅ 잘 맞음 — 단 **본문 유출 위험 최고** | `route.ts`가 `502 어시스턴트 처리 실패: ${e.message}`를 반환. `lib/opensearch.ts:89`·`lib/vllm.ts:34`·`lib/prometheus.ts:13`이 던지는 에러가 그 message다 | **채택 + `request.data` 전면 차단**(§6) |
| 소스맵 기반 스택트레이스 | ⚠️ 기능은 맞지만 **소스코드가 나간다** | `next build` 시 자동 업로드. `sourcemaps.deleteSourcemapsAfterUpload` 기본 `true`(클라이언트만 로컬 삭제 — **업로드는 이미 됨**), 서버 소스맵은 유지 | **v1 OFF**(§6.4) |
| "지표가 튀면 알림"(GPU 온도·디스크·메모리) | **❌ 안 맞음** | Sentry에 Prometheus 데이터소스 개념이 없다. PromQL·recording rule·`for` 지속조건·inhibition 전부 없음 | **금지 — Grafana Alerting**(hardware-ops 축2) |
| **로그 인입 신선도**(S1 `LogIngestStalled`) | ❌ 안 맞음(직접) / ✅ 맞음(간접) | OpenSearch 최신 `@timestamp` 정체는 Sentry가 볼 수 없다. **그러나** "Logstash가 살아있으면 체크인"으로 뒤집으면 Crons가 정확히 잡는다 | **§3에서 Crons로 뒤집는다** |
| 하드웨어 신호(PSU·SEL·인렛온도) | ❌ 안 맞음 | BMC 지표는 Prometheus 경로 | 금지 |
| **무성 실패 = 아무 신호도 안 오는 것** | **✅✅ 정확히 맞음** | Sentry Crons = 부재(absence) 탐지. 우리 5.7일 장애의 정의 그 자체 | **최우선 채택**(§3) |
| 통합 로그 수집(journald 5노드) | **❌ 수치로 기각** | §4 — 71.5 GB/월, 보존 30일(현재 365일), 그리고 실측 PII | **기각** |
| 외부 uptime 체크(콘솔·Grafana 살아있나) | ⚠️ 원리적 제약 | Sentry Uptime은 Sentry 인프라가 **공개 URL**을 찌른다. 우리 엔드포인트는 전부 Cloudflare Access 뒤(헌장 §14) → 인증 페이지를 받는다. 통과시키려면 Access 우회 경로를 만들어야 한다 = 헌장 §14를 깎는 일 | **v1 스코프 아웃**(§11) |

### 2.1 Sentry Logs — "로그를 모아본다"의 실제 답인가

기능은 **실재한다.** 2025-09-03 GA. 두 경로가 있다:
- SDK `logger` API: `enableLogs: true`(기본 `false`) + `Sentry.logger.info/warn/error()`, `Sentry.consoleLoggingIntegration()`, `beforeSendLog` 훅.
- **OTLP 직수신**: `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://o<orgId>.ingest.sentry.io/api/<projectId>/integration/otlp/v1/logs`, 헤더 `x-sentry-auth: sentry sentry_key=<public-key>`. Fluent Bit·OTel Collector 포워딩 파이프라인 문서도 있다.

즉 **기술적으로는 journald를 Sentry에 넣을 수 있다.** 그래서 §4에서 수치로 판정한다.

### 2.2 Sentry로 메트릭 알림을 억지로 구현하지 않는다 — 명시적 금지

가능해 보이는 우회(예: 콘솔에 cron을 두고 임계 초과 시 `Sentry.captureMessage()`)를 **채택하지 않는다.**
1. 헌장 §I-2 위반 — 알림 UI가 Grafana 밖에 하나 더 생긴다(hardware-ops C2가 OpenSearch Alerting을 기각한 것과 동일한 논리).
2. `for` 지속조건·inhibition·silence가 없다 → alerting spec §4의 5중 노이즈 방어가 전부 무력화된다.
3. 임계 로직이 레포 두 곳(PromQL / TypeScript)에 갈라진다 → 헌장 §7 spec↔코드 드리프트.

---

## 3. Sentry Crons — 5.7일 무성 장애의 정확한 해답

### 3.1 왜 이것이 다른 어떤 장치보다 우리 문제에 맞는가

2026-07-24~30 사고의 구조: **filebeat `active`, Logstash `:5044` LISTEN, 대시보드 "에러 0건" 초록.** 모든 존재 검증이 통과했다. 런북의 교훈 3번이 정확하다 — *"조용한 실패는 부재를 검증해야 잡힌다. 존재를 검증하면 통과한다."*

Crons는 **부재만** 검증한다. 스케줄을 등록하고, 정해진 시각(+`checkin_margin`)까지 체크인이 안 오면 이슈를 만든다.

**체크인 API [실측 문서]**
```
POST/GET https://o<orgId>.ingest.sentry.io/api/<projectId>/cron/<monitor_slug>/<public-key>/?status=ok
  status      ∈ in_progress | ok | error
  environment (기본 production)
  check_in_id UUID (겹치는 실행 추적)
레이트리밋: monitor environment 당 분당 6회
```
`monitor_config` 업서트(POST JSON): `schedule{type: crontab|interval, value}` · `checkin_margin`(분) · `max_runtime`(분) · `timezone`(IANA) · `failure_issue_threshold` · `recovery_threshold`.

### 3.2 hardware-ops §2.9의 SPOF 설계보다 강한 이유

| | §2.9안 (data03 cron → Slack) | **Sentry Crons** |
|---|---|---|
| data05만 죽음 | 탐지 ✅ | 탐지 ✅ |
| data03도 함께 죽음(랙 전원·스위치·정전) | **탐지 실패 — 관찰자도 죽는다** | **탐지 ✅** (외부가 체크인 부재를 본다) |
| 기관 네트워크 단절 | 탐지 실패 | **탐지 ✅** |
| 미검증 전제 | data03/04에서 `hooks.slack.com` 도달 여부 **미확인**(§2.9 WARNING, tasks T2-11) | data05 도달 실측 완료(§1.1) |
| 유출면 | 알림 텍스트 | **"살아있다" 1비트** |
| 비용 | 0 | 무료 플랜 **1개** 포함, 추가 $0.78/monitor |

> [!IMPORTANT]
> **핵심 논리.** 무성 실패 탐지는 **알림 스택 밖**에 관찰자를 두어야 성립한다(alerting spec §3.0이 이미 그렇게 썼다). 사내에 2차 노드를 두는 안은 "관찰자가 피관찰자와 같은 랙·같은 전원·같은 스위치"라는 상관 장애를 남긴다. **egress 1비트로 그 상관을 끊는 것이 Sentry Crons의 값**이고, 이것이 이 문서 전체에서 **유출 대비 효용이 가장 높은 항목**이다.

### 3.3 하트비트 카탈로그 v1 — 3개만 (무료 1개 제약 하 우선순위)

| 우선 | monitor_slug | 무엇이 체크인하나 | schedule | checkin_margin | 잡히는 실패 | 무료 1개일 때 |
|---|---|---|---|---|---|---|
| **1** | `keiwi-log-ingest` | data05 cron: OpenSearch `keiwi-logs-*` 최신 `@timestamp`가 10분 이내이면 `?status=ok`, 아니면 `?status=error` | `interval 5m` | 5m | **5.7일 사고 그 자체.** 인입 정체 + data05 사망 + 네트워크 단절을 한 monitor로 | **이것을 쓴다** |
| 2 | `keiwi-stack-alive` | data05 cron: Prometheus `/-/healthy` + Grafana `/api/health` 200이면 ok | `interval 5m` | 5m | Watchdog(W1) 부재 = 알림 스택 사망 | 유료 시 |
| 3 | `keiwi-fleet-scrape` | data05 cron: `count(up==1) >= N` 이면 ok | `interval 15m` | 10m | 전 노드 스크랩 소실 | 유료 시 |

**설계 규칙**
- 체크인 스크립트는 **판정을 로컬에서 하고 결과만 보낸다.** 실패 사유·수치·호스트명을 URL이나 body에 넣지 않는다(§6.1 화이트리스트와 동일 원칙).
- `status=error`도 보낸다 — "체크인은 왔지만 내부 판정 실패"와 "체크인 자체가 없음"은 다른 사건이고, 둘 다 이슈가 된다.
- 배치는 `roles/watchdog`(hardware-ops tasks에 이미 예정된 role)에 **Slack 관찰자와 나란히** 넣는다. 둘은 대체가 아니라 **직교**한다(Slack=사내 관찰자, Crons=외부 관찰자).
- Crons 보존 30일. 장기 이력이 필요하면 우리 쪽 recording rule로 남긴다.

> [!NOTE]
> `keiwi-log-ingest` 하나가 alerting spec **S1 `LogIngestStalled`**(SEV2)와 **W1 `Watchdog`**(SEV1)의 외부 안전망을 동시에 덮는다. S1을 대체하지는 않는다 — S1은 Grafana에서 10분 내 정밀 탐지, Crons는 "Grafana째로 죽었을 때"의 백스톱이다. **2단 방어이며 중복이 아니다.**

---

## 4. Sentry Logs를 기각한다 — 실측 3개로

우리 파이프라인 실측(2026-07-30, `_cat/indices` + `_search` 200건 샘플):

| 항목 | 실측 |
|---|---|
| 일 문서 수 | **928,389**/일 (2026-07-11~23 13일 평균) |
| `_source` 평균 크기 | **2,567.8 bytes** (200건 샘플, min 1,410 / max 2,792) |
| 원본 JSON 인입량 | **2.38 GB/일 → 71.5 GB/30일** |
| OpenSearch 저장량 | 667.8 MB/일 (압축비 **3.57×**) |
| 누적 | 30,013,695 docs / **21.22 GB** |
| category 분포(최근 10일) | unknown 5,508,824 · gpu 2,146,587 · system 995,197 · **user-session 34,156** · web 3,643 · infra 2,105 |

### 4.1 기각 사유 3개

**(1) 비용·용량.** 무료 5 GB/월 → **월 14배 초과.** 초과분 $0.50/GB → **(71.5−5)×0.5 = 약 $33/월**. 이 돈으로 얻는 건 우리가 이미 가진 것의 열화판이다.

**(2) 보존 역행.** Sentry Logs 보존은 **전 플랜 30일 고정**(Developer/Team/Business 동일). 우리 OpenSearch ISM은 **365일**(M2 결정). **12배 후퇴.** 하드웨어 사고 추적(SEL 이력은 2025-05까지 거슬러야 한다)에 30일은 쓸 수 없다.

**(3) PII — 가설이 아니라 실데이터다.** `keiwi-logs-2026.07.29`에서 그대로 뽑은 문서:

```
message: "Accepted password for user5 from 192.0.2.108 port 6425 ssh2"
process.command_line: "\"sshd: user5 [priv]\""
process.pid: 2475390
process.thread.capabilities.effective: [CAP_CHOWN, CAP_DAC_OVERRIDE, ... 41개]
service: "ssh.service"   host_name: "data05lx"   category: "system"
```

> [!CAUTION]
> hardware-ops §2.5는 Slack에 `user`·`pid`·`cmdline`을 보내는 것을 **"금지"**로 못박았다(연구원 계정명이 외부 SaaS에 영구 적재). 그런데 **journald 원본에는 그것들이 이미 다 들어 있다.** 로그를 Sentry로 보내는 것은 §2.5의 금지 항목을 **하루 92만 건씩 자발적으로 위반**하는 일이다. `user-session` category 34,156건은 그 자체가 연구원 로그인 기록이다. 게다가 §1.2 표대로 **되돌릴 수 없다.**

**결론: Sentry Logs 기각.** "로그를 모아본다"는 요구는 **이미 충족돼 있다** — OpenSearch 365일 + Grafana 단일 콘솔 + `/logs` 워크벤치 + RAG 어시스턴트. Sentry가 추가로 줄 수 있는 것은 "trace-connected logs"(앱 트레이스와 로그 연결)뿐이고, 그건 **콘솔 앱 자체의 로그**에 한정할 때만 의미가 있다(§8 S3에서 재검토).

---

## 5. 배치 3안 비교

### 5.1 (a) Sentry.io SaaS

| | |
|---|---|
| 설치 | **0** |
| 도달성 | ✅ 실측(§1.1). US(`o0.ingest.sentry.io`) / EU(`de.sentry.io`) 둘 다 도달 |
| 무료 플랜(Developer) | errors **5,000/월** · logs 5 GB · spans 5M · replays 50 · **cron monitor 1** · uptime monitor 1 · **seat 1명** · 보존 **30일** |
| Team | $26/월 · errors 50,000 · 보존 **90일** · 추가 cron $0.78/monitor · uptime $1.00/monitor · logs $0.50/GB |
| EU 리전 | `de.sentry.io`, **org 생성 시 1회 선택, 되돌릴 수 없음**(사후 마이그레이션 경로 없음). 무료 플랜도 가능, 가격 동일 |
| 헌장 정합 | **§I-1 정면 충돌**(외부 SaaS). §13은 DSN·auth token을 `.env`로 처리하면 충족 |
| 5노드 규모 적합 | seat 1명 = 1인 SRE와 정확히 맞는다. 5,000 errors/월도 콘솔 트래픽(사용자 1~2명)엔 충분 |
| 치명적 제약 | **cron monitor 1개** → §3.3의 3개 중 하나만. 그리고 **초과분은 조용히 드롭**(무료 플랜은 과금 없이 폐기) — 관측 도구가 조용히 실패하는 구조를 또 만든다 |

### 5.2 (b) self-hosted Sentry — 실측 수치로 기각

`getsentry/self-hosted` master `docker-compose.yml`을 내려받아 직접 세었다(37,317 bytes):

| 항목 | 수치 |
|---|---|
| **서비스(컨테이너) 수** | **65개** |
| 구성 | postgres 14.23 · pgbouncer · redis 6.2.20 · memcached · **kafka 7.6.6** · **clickhouse 25.3.6.10034** · seaweedfs · nginx · relay · taskbroker/taskscheduler/taskworker · symbolicator · vroom · uptime-checker · **snuba 컨슈머 31개** · sentry web/consumer/forwarder 다수 |
| 최소 요구 | **4 CPU 코어 · 16 GB RAM + 16 GB swap**(32 GB 권장) · 20 GB 디스크 |
| 전제 | Docker ≥ 19.03.6, **Docker Compose 2.32.2** |
| 설치 방법 | 릴리스 clone → `./install.sh` (공식이 이 경로만 지원) |
| 라이선스 | **FSL-1.1-Apache-2.0** — 내부 사용 자유, 경쟁 SaaS 판매 금지, 릴리스 2년 후 Apache 2.0 자동 전환. **KEI 내부 전용 사용은 허용 범위 안** |
| 공식 경고 | 규모가 커지면 "your local install's maintenance becomes a burden instead of a joy" |

> [!CAUTION]
> **왜 기각인가 — 우리 스택과 나란히 놓고 보면 명백하다.**
> 현재 관제 스택 전체(Prometheus·Grafana·OpenSearch·Logstash·exporter 4종·vLLM)가 data05 한 대에 있고, 앱 예외를 담기 위해 **컨테이너 65개 + Kafka + ClickHouse**를 추가한다는 것은 **관측 대상보다 관측 도구가 커지는 것**이다. 헌장 §6(지루한 기술 선호)·§12(라이브 격리)와 정면 충돌하고, §0의 SPOF를 **증폭**한다. 그리고 이 65개 컨테이너 자체가 새로운 무성 실패 표면이다 — 우리는 방금 그 종류의 사고로 5.7일을 잃었다.
> 추가로 data05는 **A40 ×2 연구 GPU 노드**다. 16 GB RAM + Kafka·ClickHouse의 상시 부하를 연구 워크로드와 경합시키는 것은 ADR-0014(어시스턴트 GPU 자기경합 방지)가 세운 원칙과 어긋난다.

### 5.3 (c) GlitchTip — 경량 Sentry 호환 대안

| 항목 | 실측/문서 |
|---|---|
| 컨테이너 | **3~5개** (postgres 14+, valkey/redis 7+(옵션), web, worker, migrate) |
| 최소 RAM | **256 MB**(권장 512 MB) — self-hosted Sentry의 **1/64** |
| 디스크 | ~30 GB / 100만 events/월 |
| 이미지 | `glitchtip/glitchtip:6.2.2`, **247.6 MB**, 2026-07-17 갱신(활발) |
| 라이선스 | **MIT** |
| Sentry SDK 호환 | DSN만 바꿔 동일 SDK 사용. 에러·성능·업타임·OTLP 로그 수신 |
| **하트비트** | 자체 지원 — Uptime Monitoring의 **Heartbeat** 타입("awaits requests from your site... if it doesn't receive the request, the site will be marked as Down") |
| 알림 | **문서상 이메일만 명시.** webhook/Slack 지원 여부는 문서에서 확인 안 됨 → §10 Q5 |
| 미확인 | **Sentry Crons 체크인 API(`/api/<project>/cron/<slug>/<key>/`) 구현 여부 문서에 없음.** 자체 Heartbeat URL 형식도 "생성 후 화면에 표시"라고만 되어 있어 스펙 미공개 |

> [!IMPORTANT]
> **GlitchTip은 "온프렘 앱 에러 트래킹"에는 최적이지만, 이 문서의 최대 가치인 §3(외부 관찰자)을 원리적으로 대체하지 못한다.** data05에 GlitchTip을 올리면 관찰자가 다시 피관찰자와 같은 호스트가 된다 — §3.2 표의 두 번째 줄(data03도 함께 죽음)에서 실패한다. **GlitchTip의 자리는 (a)의 에러 트래킹 대체이고, Crons의 대체는 아니다.**

### 5.4 (d) 하이브리드 — Relay를 온프렘 스크러빙 게이트로

Sentry Relay는 "standalone service that acts as a middle layer between your application and sentry.io"이며, **"scrub PII in a central place prior to sending it to Sentry"**가 명시된 용도다.

| 모드 | 동작 | Sentry 인증 | 우리 판정 |
|---|---|---|---|
| **managed**(기본) | Sentry에서 프로젝트 설정을 받아와 **PII 스크러빙을 온프렘에서 수행**한 뒤 전송 | 필요 | 검토 가치 — 스크러빙 위치가 "우리 쪽"으로 옮겨진다 |
| proxy | 최소 처리로 전부 포워드(프로젝트 설정 미수신) | 불필요 | **무의미** — 스크러빙 안 하면 도입 이유가 없다 |
| static | **Relay 25.9.0에서 deprecated** | — | 사용 금지 |

> [!NOTE]
> Relay는 **v2 이후 옵션**으로 남긴다. v1에서 필요한 스크러빙은 SDK `beforeSend`(§6)로 전부 가능하고, 컨테이너 1개를 추가하는 값이 아직 증명되지 않았다. **Relay가 필요해지는 조건**은 명확하다 — 콘솔 외에 다른 앱(예: 향후 Python 배치)이 Sentry를 쓰기 시작해서 `beforeSend`가 여러 코드베이스에 복제될 때. 그 시점에 중앙 게이트가 값을 갖는다.

### 5.5 배치 결정

| 목적 | 채택 | 배치 |
|---|---|---|
| **무성 실패 외부 관찰자** | **Sentry.io SaaS Crons** | 명시적 egress 예외 (§6.5) |
| 콘솔 앱 예외 트래킹 | **1차: Sentry.io SaaS**(무료, 방어 §6 전제) / **대안: GlitchTip 온프렘**(§10 Q1이 "SaaS 반출 불가"면 이쪽) | — |
| 로그 수집 | **현행 유지**(OpenSearch 365일) | 변경 없음 |
| 인프라 메트릭 알림 | **Grafana 통합 알림** | hardware-ops 축2 |
| self-hosted Sentry | **기각**(§5.2) | — |

---

## 6. SaaS를 택할 경우 필수 방어

### 6.1 필드 단위 — 무엇이 나가고 무엇이 안 나가는가

Next.js/Node SDK가 에러 이벤트 1건에 담는 것을 필드 단위로 판정한다. **"허용"은 기본값 유지, "차단"은 코드로 제거를 강제한다.**

| 필드 | SDK 기본 | 내용 (KEIwi 구체 예) | 위험 | **v1 처분** |
|---|---|---|---|---|
| `event_id`·`timestamp`·`level`·`platform` | 전송 | 메타 | 낮음 | 허용 |
| `environment`·`release` | 전송 | `production` / git sha | 낮음 | 허용 |
| `exception.values[].type` | 전송 | `Error` | 낮음 | 허용 |
| `exception.values[].value` | 전송 | `[opensearch] HTTP 404` (`lib/opensearch.ts:89`) | 중 | **길이 제한**(`maxValueLength`) + 패턴 검사 |
| `stacktrace.frames[].filename`/`abs_path` | 전송 | `/KEIwi/apps/console/src/lib/assistant.ts` | 중 — 서버 디렉터리 구조 | **경로 상대화**(`beforeSend`) |
| `stacktrace.frames[].context_line`·`pre_context`·`post_context` | 전송 | **우리 소스코드 스니펫** | **높음** — "KEI 내부 전용 저장소" 위반 | **제거** |
| `stacktrace.frames[].vars` | `includeLocalVariables` 기본 **`false`** | 지역 변수값(어시스턴트 질문·로그 본문·토큰) | **최상** | **명시적 `false` 유지 + CI 검사** |
| `request.url`·`query_string` | 전송 | `/logs?host=data04&q=<연구원 검색어>` | 중~높음 | **query_string 제거** |
| `request.headers` | `dataCollection.httpHeaders` 기본 `true` | **`Cookie: CF_Authorization=<Cloudflare Access JWT>`** | **최상 — 인증 토큰** | **전면 제거** |
| `request.cookies` | `dataCollection.cookies` 기본 `true` | 동일 | **최상** | **전면 제거** |
| `request.data`(body) | `dataCollection.httpBodies` | **`/api/assistant` POST body = 연구원 질문 + 로그 컨텍스트** | **최상 — ADR-0014 egress 0 정면 위반** | **전면 제거** |
| `user.*` | `dataCollection.userInfo` 기본 `true` | 우리는 `Sentry.setUser()`를 호출하지 않으므로 v1은 비어 있음 | 높음(장래) | **`setUser` 호출 금지 + CI 검사** |
| `user.ip_address` | `sendDefaultPii` 기본 `false` → 미수집 | — | — | 기본 유지. **단 전송 자체로 기관 공개 IP는 Sentry에 남는다(불가피)** |
| `server_name` | Node SDK가 `os.hostname()` | **`data05lx`** | 중 | **고정 별칭으로 덮어쓴다**(`keiwi-console`) |
| `contexts.os`·`runtime`·`device` | 전송 | 커널 `6.8.0-117`·Node 버전·CPU·메모리 | 중 — 정찰 정보 | **os·device 제거**, runtime만 허용 |
| `modules` | Node SDK가 전송 | 설치된 npm 패키지 전체 + 버전 | 중 — 취약 버전 노출 | **제거** |
| **`breadcrumbs`** | 전송(http/fetch 자동) | **`http://192.0.2.15:9090/api/v1/query?query=up{job="dcgm-exporter"}`**, OpenSearch 질의 URL, vLLM 엔드포인트 | **높음** — 내부 IP·PromQL·질의 전부 | **http breadcrumb 비활성 또는 URL 마스킹** |
| `tags`·`extra` | 우리가 넣은 것만 | — | — | 화이트리스트만 |
| `sdk` | 전송 | SDK 이름·버전 | 낮음 | 허용 |
| **소스맵 / 소스 파일** | `next build` 시 **자동 업로드** | 원본 소스 | **최상** | **v1 업로드 OFF**(§6.4) |
| logs(`enableLogs`) | 기본 **`false`** | — | — | **`false` 유지**(§4) |
| metrics(`enableMetrics`) | 기본 **`true`** | 앱 메트릭 | 중 | **`false`** — 메트릭은 Prometheus다(헌장 §I-3) |
| traces(`tracesSampleRate`) | 미설정 시 off | span·DB 질의 | 중 | **v1 `0`** |

> [!NOTE]
> **"SDK 기본" 열은 문서 기준이며 실측이 아니다.** SDK 10.57.0부터 `sendDefaultPii`(기본 `false`, v11에서 제거 예정)가 `dataCollection.{userInfo,cookies,httpHeaders,httpBodies,urlQueryParams,stackFrameVariables}`(각 기본 `true`)로 분화됐는데, **`sendDefaultPii: false`가 이 하위 항목들을 실제로 게이팅하는지 문서만으로는 단정할 수 없다.** 그래서 이 표는 "확정된 사실"이 아니라 **AC-S-1(페이로드 실측)로 검증할 가설**이다. 실측 후 이 표를 갱신하는 것이 T-S2a의 산출물이다. — 위 표의 처분은 전부 **문서 기본값에 의존하지 않고 `beforeSend`에서 직접 삭제**하도록 짜여 있으므로, 게이팅 여부와 무관하게 안전 측으로 동작한다.

> [!WARNING]
> **`breadcrumbs`가 실질적으로 가장 위험하다.** 우리 코드는 매 요청마다 `lib/prometheus.ts`·`lib/opensearch.ts`·`lib/vllm.ts`로 내부 HTTP를 부른다. Node SDK의 http instrumentation은 그 URL을 breadcrumb으로 자동 수집한다 → **에러 1건에 내부 IP·포트·PromQL·OpenSearch 질의가 묶여 나간다.** `beforeSend`에서 예외 필드만 화이트리스트하는 방식으로 짜지 않으면 반드시 샌다.

### 6.2 화이트리스트 방식 `beforeSend` — 블랙리스트로 짜지 않는다

hardware-ops §2.5가 Slack 템플릿을 화이트리스트로 못박은 것과 **동일한 이유**: 새 필드가 생겨도 자동으로 새지 않는다.

```ts
// apps/console/sentry.server.config.ts (설계안 — 실제 적용은 사람이 §11)
import * as Sentry from "@sentry/nextjs";

const ALLOW_TAGS = new Set(["route", "runtime"]);            // 우리가 명시적으로 넣는 것만

Sentry.init({
  dsn: process.env.SENTRY_DSN,          // 하드코딩 금지 — check:secrets 규칙1이 잡는다
  environment: process.env.SENTRY_ENV ?? "production",
  serverName: "keiwi-console",          // os.hostname()("data05lx") 덮어쓰기
  sendDefaultPii: false,
  includeLocalVariables: false,
  enableLogs: false,                    // §4 기각
  enableMetrics: false,                 // 헌장 §I-3 — 메트릭은 Prometheus
  tracesSampleRate: 0,                  // v1
  sampleRate: 1.0,                      // 에러 자체는 희소하므로 전량. 폭주 시 §6.3
  maxValueLength: 500,
  ignoreErrors: [/^\[vllm\] HTTP 5\d\d$/],   // 어시스턴트 502는 Grafana에서 이미 본다

  beforeSend(event) {
    // 1) 요청 컨텍스트 — 경로만 남기고 전부 버린다
    if (event.request) {
      const path = (event.request.url ?? "").split("?")[0];
      event.request = { url: path, method: event.request.method };  // headers/cookies/data/query_string 소멸
    }
    // 2) 프레임 — 소스 스니펫·변수 제거, 경로 상대화
    for (const ex of event.exception?.values ?? []) {
      for (const f of ex.stacktrace?.frames ?? []) {
        delete f.pre_context; delete f.context_line; delete f.post_context; delete f.vars;
        f.filename = f.filename?.replace(/^.*\/apps\/console\//, "apps/console/");
        delete f.abs_path;
      }
    }
    // 3) 자동 수집 컨텍스트 — 정찰 정보·패키지 목록 제거
    delete event.modules;
    if (event.contexts) { delete event.contexts.os; delete event.contexts.device; }
    delete event.user;
    // 4) breadcrumbs — 내부 IP·질의가 실려 있다. 종류만 남긴다.
    event.breadcrumbs = (event.breadcrumbs ?? [])
      .filter((b) => b.category !== "http" && b.category !== "fetch")
      .map((b) => ({ ...b, data: undefined }));
    // 5) 태그 화이트리스트
    if (event.tags) {
      event.tags = Object.fromEntries(Object.entries(event.tags).filter(([k]) => ALLOW_TAGS.has(k)));
    }
    return event;
  },
});
```

클라이언트 측(`instrumentation-client.ts`)은 추가로 `denyUrls`로 **우리 코드가 아닌 스크립트**의 에러를 버린다 — Grafana iframe·브라우저 확장이 만드는 노이즈가 5,000 errors/월 무료 쿼터를 태우는 것을 막는다.

```ts
denyUrls: [/\/grafana\//, /extensions\//, /^chrome(-extension)?:\/\//, /^moz-extension:\/\//],
```

### 6.3 샘플링·쿼터 방어

| 축 | v1 설정 | 근거 |
|---|---|---|
| `sampleRate` | `1.0` | 콘솔 사용자 1~2명. 에러는 희소하고, 놓치면 도입 의미가 없다 |
| `tracesSampleRate` | `0` | 성능 추적은 우리 목적이 아니다. span 5M 쿼터도 소모 |
| 쿼터 폭주 방어 | `ignoreErrors` + `denyUrls` + Sentry 프로젝트 측 **Inbound Filter**·**Rate Limit(key별 초당/분당 상한)** | 무료 플랜은 초과분을 **조용히 드롭**한다 → 관측 도구가 조용히 실패하는 구조를 만들지 않으려면 폭주 자체를 앞단에서 막아야 한다 |
| 보존 | Developer **30일** / Team 90일. Crons 30일 | 장기 이력은 우리 쪽(OpenSearch 365일)이 정본 |

### 6.4 소스맵 — v1은 업로드하지 않는다

`next build`가 소스맵을 생성해 **Sentry로 업로드**하고, `SENTRY_AUTH_TOKEN`이 필요하다. `sourcemaps.deleteSourcemapsAfterUpload` 기본 `true`는 **업로드 후 로컬에서 지우는 것**이지 업로드를 막는 옵션이 아니다.

> [!CAUTION]
> 소스맵 업로드 = **"KEI 내부 전용 저장소 — 외부 공개·배포 금지"를 자동화한 파이프라인으로 위반하는 것.** 스택트레이스 가독성은 minified 프레임 + `filename:line`으로도 대부분 확보된다(§6.2가 남기는 정보). v1은 업로드 OFF, 필요하면 **§10 Q3(소스코드 반출 승인) 답변 후** 재검토.

### 6.5 헌장과의 관계 — 숨기지 않고 여기서 정리한다

| # | 충돌 | 조항 | 처리 |
|---|---|---|---|
| **S1** | Sentry.io = 외부 SaaS | §I-1 온프레미스 only | **egress 예외 2건**으로 ADR-0022에 명시 승인: **(E1) Crons 체크인**(1비트) · **(E2) 콘솔 에러 이벤트**(§6.1 필드표 강제). hardware-ops의 Slack 예외(ADR-0018)와 **합산 3건**이며, 이 숫자를 늘리지 않는다 |
| **S2** | `/api/assistant`의 `request.data`가 나가면 **어시스턴트 egress 0이 깨진다** | ADR-0014 | **`beforeSend`가 `request`를 경로만 남기고 재구성.** 추가로 `/api/assistant`는 **에러 이벤트 자체를 보내지 않는 옵션**을 검토(§10 Q4). 이 라우트만 `ignoreErrors`로 배제하면 egress 0을 문자 그대로 지킬 수 있다 |
| **S3** | DSN·`SENTRY_AUTH_TOKEN`이 레포에 들어갈 위험 | §13 | `.env`만. **기존 `check:secrets` 규칙1**(하드코딩 외부 URL 금지, `process.env` 경유만 허용)이 DSN 하드코딩을 이미 잡는다 → 신규 검사 1줄만 추가(§9 AC-S-6) |
| **S4** | 알림 UI가 Grafana 밖에 하나 더 생긴다 | §I-2 | **부분 수용.** Sentry는 **앱 에러 전용**이며 인프라 알림 규칙을 단 1건도 갖지 않는다(§2.2). Grafana 라우팅 트리는 단일 유지. 대신 콘솔 `/about` 또는 인시던트 보드에 Sentry 이슈 링크를 노출해 진입점을 하나로 만든다 |
| **S5** | 신규 의존성 `@sentry/nextjs` | §8 ADR 필수 | ADR-0022. 규모: **10.69.0, 직접 의존성 14개**(`@opentelemetry/api`·`rollup`·`@sentry/webpack-plugin`·`@sentry/node`·`@sentry/react` 등), unpacked 1.92 MB. 현재 콘솔 런타임 의존성은 **6개** → 배 이상 증가 |
| **S6** | Next.js 16 + Turbopack 호환 | §6 지루한 기술 | peerDeps `next: ^16.0.0-0` **충족**(우리 16.2.9). **그러나 실사고 보고 존재**: getsentry/sentry-javascript **#19367** — Next 16.1.6 + SDK 10.38.0에서 Turbopack이 `@opentelemetry/api`를 청크 2곳에 중복 번들 → `.with()` 상호 재귀 → **`RangeError: Maximum call stack size exceeded` 서버 크래시.** 우리 `next.config.ts`는 `turbopack.root`를 쓰는 Turbopack 경로다 → **§9 AC-S-7(dev+build 무크래시)이 게이트** |

---

## 7. 최종 역할 분담 — 3경로, 겹치지 않게

```
[앱 에러]        Next.js 콘솔 예외 ──@sentry/nextjs(beforeSend 화이트리스트)──▶ Sentry.io
                                                                              └─ 채널: Sentry 이메일(SEV2급) + (Slack 승인 시) Slack

[인프라 메트릭]  Prometheus ──PromQL 규칙(infra/monitoring/alerts/*.yml)──▶ Grafana 통합 알림
                                                                              ├─ SEV1: Slack + (2단계) self-host ntfy → 폰
                                                                              ├─ SEV2: 콘솔 인박스 / Slack
                                                                              └─ SEV3: 다이제스트
                                                                              (inhibition 4건 · silence · for-duration)

[무성 실패]      data05 cron ──1비트 체크인──▶ Sentry Crons ──미체크인 감지──▶ 이슈 → 이메일/Slack
                 data03 cron ──curl 헬스체크──▶ (실패 시) Slack       ← hardware-ops §2.9, 사내 관찰자
                 Grafana Watchdog(vector(1)) ← 위 둘이 감시하는 대상
```

| 경로 | 담당 | 알림 채널 | 야간 폰 |
|---|---|---|---|
| 앱 에러 | Sentry.io | Sentry 이메일 → (승인 시)Slack | **울리지 않음**(SEV2급) |
| 인프라 메트릭 | Grafana Alerting | severity 라벨 라우팅(alerting spec §5) | SEV1만 |
| 무성 실패(외부) | Sentry Crons | Sentry 이슈 알림 | **§7.1 문제** |
| 무성 실패(사내) | data03 cron | Slack 직접 POST | Slack 모바일 |

### 7.1 정직해야 할 지점 — Sentry는 폰을 울리지 못한다

사용자 기대("알림도 여기서 받을 수 있을 것 같고")의 현실:
- Sentry 알림 채널: **이메일 · Slack · Discord · MS Teams · webhook · PagerDuty · Opsgenie · Jira**.
- **공식 Sentry 모바일 앱은 확인되지 않았다.** 폰 푸시는 서드파티 on-call 도구(PagerDuty/Opsgenie/Zenduty) 경유가 전제다.
- 우리 환경 실측: **Discord ❌(000)** · Telegram ❌(000) · **Slack ✅** · **ntfy.sh ✅(200)** · **Pushover ✅(400=도달)**.
- alerting spec §5는 **"이메일은 1인 SRE가 실시간으로 안 보므로 SEV1에 부적합"**으로 이미 판정했다.

> [!IMPORTANT]
> **결론: Sentry를 도입해도 "Slack 없이 야간 SEV1 폰 알림"은 해결되지 않는다.** Sentry는 최종 도달 채널이 아니라 **탐지·집계 계층**이다. 폰 도달은 별개 결정이며 선택지는 3개다:
> 1. **Slack** — 오늘 동작(실측). Sentry 알림도 Slack으로 보낼 수 있어 채널이 하나로 합쳐진다.
> 2. **self-host ntfy** — hardware-ops §2.5의 2단계 계획. egress 0. iOS 제약이 미해결(alerting spec §9).
> 3. **Pushover** — 도달 실측(400). 페이로드가 우리가 고른 텍스트뿐이라 **Slack보다 유출면이 작고**, iOS/Android 공식 앱이 있다. 단 신규 외부 SaaS 1건 추가 = egress 예외 4건째. **검토 대상으로만 기록**하고 이 문서에서 채택하지 않는다.
> Sentry → webhook → (Cloudflare 터널 뒤 콘솔 엔드포인트) → ntfy 경로는 **인바운드 노출**이 필요하고 Cloudflare Access를 우회해야 한다 → 헌장 §14 위반. **기각.**

### 7.2 이 문서가 기존 스펙에 되돌려 반영할 것 (§7 드리프트=버그)

| 대상 | 반영 내용 |
|---|---|
| `specs/alerting/spec.md` §3.0 | W1 관찰자 선택지를 **3개**로 확장: (권장)2차 노드 · 외부 heartbeat 예외 · **Sentry Crons(신규, 유출 1비트)**. §9 미해결질문의 "W1 관찰자 어느 쪽" 답변 후보에 Crons 추가 |
| `specs/alerting/spec.md` §5 | 채널표에 실측 반영: **Telegram·Discord는 이 환경에서 애플리케이션 레벨 차단(000)** — "egress 0 위반이라 예외만"이 아니라 **애초에 불가**. Pushover·ntfy.sh 도달 실측 추가 |
| `specs/hardware-ops/spec.md` §2.9 | 미검증 전제(data03/04 Slack 도달)가 **여전히 유효**하되, 그 검증에 실패해도 Crons가 외부 관찰자를 제공함을 명시 |
| `docs/runbooks/log-ingestion-stopped.md` §5 | "최소 두 개가 필요하다"(신선도 + dead man's switch)에서 dead man's switch의 구현으로 `keiwi-log-ingest` monitor 명시 |
| 신규 ADR | **ADR-0022** — Sentry 도입 범위(Crons + 콘솔 에러만) · Logs·self-hosted 기각 근거 · egress 예외 2건(E1/E2) · 소스맵 업로드 금지 |

---

## 8. 단계 설계 — 유출 대비 효용 순서로

**축 순서가 아니라 "유출이 작고 효용이 큰 것부터"다.** hardware-ops의 "설치 0인 것부터"와 같은 원칙.

| 단계 | 내용 | egress | 크기 | 왜 이 순서 |
|---|---|---|---|---|
| **S0** | §10 결정 대기 5건 답변 + ADR-0022 초안 | 0 | S | 승인 없이 SaaS에 데이터를 보내면 되돌릴 수 없다(§1.2) |
| **S1** | **Crons `keiwi-log-ingest` 1개**. `roles/watchdog`에 체크인 스크립트 + Sentry org(EU 리전 판단 §10 Q3) | **1비트** | S | 무료 1개로 5.7일 사고를 10분 탐지로 바꾼다. **유출 대비 효용 최대** |
| **S2** | 콘솔 SDK 도입 — **DSN을 로컬 싱크로 향한 상태로** 페이로드 실측(§9 AC-S-1) → `beforeSend` 확정 → 그 다음에야 실제 DSN | 0 → 통제된 이벤트 | M | **무엇이 나가는지 눈으로 본 뒤에** 외부로 보낸다. "부재를 검증한다"의 적용 |
| **S3** | 운영 2주 관찰: 이벤트 종류·쿼터 소모·오탐. 그 뒤 Crons 2·3 추가 여부 / Team 승격 여부 판단 | 동일 | S | hardware-ops §2.8 섀도 모드와 같은 게이트 |
| **S4**(조건부) | §10 Q1이 "SaaS 반출 불가"면 **GlitchTip 온프렘으로 S2를 대체**. 단 S1은 유지(외부 관찰자는 온프렘으로 대체 불가, §5.3) | S1만 | M | 정책이 막아도 §3의 값은 지킨다 |

> [!NOTE]
> **S1과 S2는 독립이다.** S1만 하고 멈춰도 이 문서의 주된 값(5.7일 → 10분)은 확보된다. S2가 정책·검증에서 막혀도 S1은 살아남게 설계했다.

---

## 9. 수용 기준 (기계 검증)

| # | 검증 | 명령 / 기대 |
|---|---|---|
| **AC-S-1** | **페이로드 실측 게이트** — 실제 DSN 전에 로컬 싱크로 envelope을 받아 필드를 눈으로 확인 | `python3 -m http.server` 계열 싱크를 `SENTRY_DSN=http://k@127.0.0.1:9999/1`로 지정 → 의도적 500 유발 → 덤프한 JSON에 `request.headers`·`request.data`·`context_line`·`modules`·`vars`·`server_name != "keiwi-console"`가 **한 건도 없어야 함**. 있으면 exit 1 |
| **AC-S-2** | `beforeSend` 필수 삭제 목록 존재 | `for f in pre_context context_line post_context vars modules; do grep -q "delete .*$f" apps/console/sentry.server.config.ts \|\| exit 1; done` |
| **AC-S-3** | PII 옵션이 안전 기본값 | `grep -qE 'sendDefaultPii:\s*false' … && grep -qE 'includeLocalVariables:\s*false' … && grep -qE 'enableLogs:\s*false' … && grep -qE 'enableMetrics:\s*false' …` |
| **AC-S-4** | **Sentry Logs 미사용**(§4 기각의 코드 강제) | `! grep -rqE 'Sentry\.logger\|consoleLoggingIntegration\|enableLogs:\s*true' apps/console/src apps/console/*.ts` |
| **AC-S-5** | `setUser` 호출 금지(연구원 계정명 유출 방지) | `! grep -rq 'Sentry.setUser' apps/console/src` |
| **AC-S-6** | **DSN·토큰 미커밋** | `npm run check:secrets` 통과(규칙1이 하드코딩 URL을 잡는다) + `! grep -rqE 'sentry_key=\|@o[0-9]+\.ingest\.sentry\.io\|sntrys_' .` (레포 전체) |
| **AC-S-7** | **Turbopack 호환**(#19367 회귀 방지) | `npm run build` 성공 + `next dev` 30초 구동 후 `/overview` 200 + 로그에 `Maximum call stack size exceeded` 부재 |
| **AC-S-8** | 소스맵 미업로드 | `! grep -rq 'SENTRY_AUTH_TOKEN' apps/console/next.config.ts` **및** `next build` 출력에 `Uploading sourcemaps` 부재 |
| **AC-S-9** | 기존 검증 무회귀 | `npm run verify`(lint·typecheck·test·build·check:secrets·check:no-raw-hex) 통과 |
| **AC-S-10** | **Crons 하트비트 실동작** | 체크인 스크립트를 5분 주기로 돌린 뒤 Sentry monitor 상태가 `ok`. 이어서 **스크립트를 일부러 멈추고 `checkin_margin`+1분 대기 → 이슈 생성 + 알림 수신 확인**(수동, 절차를 런북에 기록) |
| **AC-S-11** | **Crons 페이로드 최소성** | 체크인 스크립트에 호스트명·수치·사유가 없다: `! grep -qE 'hostname\|@timestamp\|\$\(.*\)' roles/watchdog/templates/sentry-checkin.sh.j2` 의 URL 조립부 (판정은 로컬, 전송은 status만) |
| **AC-S-12** | **egress 예외 건수 상한** | ADR-0018(Slack) + ADR-0022(E1·E2) = **3건**. `grep -c 'egress 예외' docs/decisions/*.md` 로 센 수가 3 초과면 리뷰 실패 |
| **AC-S-13** | 런북 존재 | `docs/runbooks/sentry-cron-missed.md` 존재(hardware-ops AC-2-6의 런북 왕복 규약 재사용 — 게이트는 fleet-hardening T3-5로 **이관**돼 `scripts/gates/check-runbooks.sh`로 구현됐다) |

---

## 10. 결정 대기 항목 — 사용자·조직이 답해야 한다

| # | 질문 | 왜 이것이 게이트인가 | 답에 따른 분기 |
|---|---|---|---|
| **Q1** | **사내 정책상 앱 에러 데이터의 SaaS 반출이 승인 가능한가?** (KEI 정보보안 규정·개인정보 위탁 여부) | §1.2대로 되돌릴 수 없다. 승인 없이 시작하면 사후 수습이 "프로젝트 삭제·재생성"뿐 | 가능 → S2(Sentry.io) / 불가 → **S4(GlitchTip 온프렘)**, S1은 유지 |
| **Q2** | **Slack이 "안 된다"고 판단한 실제 근거는 무엇인가?** 네트워크는 열려 있다(§1.1) — 워크스페이스 부재? 계정 발급 불가? 사내 메신저 규정? | 이 답이 §7.1의 폰 채널 결정 전체를 좌우한다. 그리고 hardware-ops ADR-0018(Slack egress 예외 1건)의 전제가 유효한지 판정 | 네트워크가 아닌 사유 → ntfy 자체호스트(또는 Pushover) 우선순위 상승 / 오해였다면 → Slack 유지가 최단 경로 |
| **Q3** | **리전을 US(`o0.ingest.sentry.io`)로 할 것인가 EU(`de.sentry.io`)로 할 것인가?** | **org 생성 시 1회 선택, 되돌릴 수 없다.** 사후 마이그레이션 경로 없음. 무료 플랜도 EU 가능, 가격 동일 | 국내 규정이 EU 적정성 결정을 선호하면 EU. **모르면 EU가 안전한 기본값** |
| **Q4** | `/api/assistant` 예외를 **Sentry로 보낼 것인가, 완전히 배제할 것인가?** | ADR-0014 "어시스턴트 egress 0"을 문자 그대로 지키려면 배제가 맞다. 그러나 어시스턴트가 우리 앱에서 가장 깨지기 쉬운 부분이다 | 배제 → `ignoreErrors`에 라우트 추가, 진단은 journald로 / 포함 → §6.2 `beforeSend`만으로 충분한지 AC-S-1로 실증 |
| **Q5** | (Q1이 "불가"인 경우만) **GlitchTip이 Sentry Crons 체크인 API를 구현하는가? 알림이 이메일 외에 나가는가?** | 문서에 없다(§5.3). 구현하지 않으면 GlitchTip은 에러 트래킹 전용이고 하트비트는 자체 Heartbeat URL 형식을 따라야 한다 | 사람이 인스턴스 1회 기동 후 `POST /api/1/cron/test/key/` 응답으로 확인 |

**추가로 사용자에게 확인할 사실 1건(alerting spec §9에서 이월):** SRE **폰 OS**(iOS/Android). §7.1의 ntfy 자체호스트 실현 가능성이 여기에 걸려 있다.

---

## 11. 스코프 아웃 (명시적 — 암묵 누락 금지)

- **Sentry Logs로 journald 수집** — §4에서 수치로 기각. OTLP 포워딩 파이프라인도 포함해 전면 제외.
- **self-hosted Sentry** — §5.2에서 기각(65컨테이너·16GB RAM). 재검토 조건은 "관측 대상이 5노드에서 50노드로 늘고 전용 관제 호스트가 생길 때"로 못박는다.
- **Sentry Uptime monitors** — 우리 엔드포인트는 Cloudflare Access 뒤(헌장 §14). 통과시키려면 인증 우회 경로를 만들어야 한다. **blackbox_exporter가 사내에서 같은 일을 더 잘한다**(alerting spec T02b).
- **Sentry Performance/Tracing·Session Replay·Profiling** — `tracesSampleRate: 0`. Replay는 화면 녹화 = 연구원 화면 유출. 전면 제외.
- **Sentry Relay** — §5.4에서 v2 이후로 유예. 필요 조건을 명시했다.
- **Sentry로 메트릭·하드웨어 알림** — §2.2에서 명시적 금지.
- **Sentry webhook 인바운드 수신** — §7.1에서 헌장 §14 위반으로 기각.
- **Pushover 채택** — 도달성만 기록. 채널 결정은 alerting spec §5의 개정 사항이며 이 문서가 결정하지 않는다.
- **자동 조치** — Sentry 이슈를 근거로 서비스를 자동 재기동하지 않는다(헌장 §11).

---

## Tasks

- [ ] **T-S0** §10 Q1~Q5 답변 확보 → **ADR-0022 작성**(범위·egress 예외 E1/E2·기각 근거·소스맵 금지). *선행: 없음. 사람.*
- [ ] **T-S1a** Sentry org 생성(리전 = Q3 답) + 프로젝트 1개 + `keiwi-log-ingest` monitor 등록(`interval 5m`, `checkin_margin 5m`, `failure_issue_threshold 1`). *사람(§11).*
- [ ] **T-S1b** `infra/ansible/roles/watchdog/templates/sentry-checkin.sh.j2` 생성 — OpenSearch 최신 `@timestamp` 판정을 **로컬에서** 하고 `?status=ok|error`만 전송. systemd timer 5m. DSN 공개키는 `.env`. *에이전트 생성.*
- [ ] **T-S1c** [server] 사람 적용 + **AC-S-10 실검증**(스크립트 중지 → 이슈·알림 도달) + `docs/runbooks/sentry-cron-missed.md` 작성. *사람.*
- [ ] **T-S2a** **로컬 싱크로 페이로드 실측**(AC-S-1) — 실제 DSN 없이 envelope 덤프 → 필드 목록을 §6.1 표와 대조해 표를 갱신. *에이전트.*
- [ ] **T-S2b** `sentry.server.config.ts` / `instrumentation-client.ts` / `sentry.edge.config.ts` 작성(§6.2) + `check:secrets`에 Sentry DSN 패턴 1줄 추가(AC-S-6). *에이전트.*
- [ ] **T-S2c** **AC-S-7 Turbopack 회귀 검증**(#19367) — `next dev`·`next build` 무크래시. 실패 시 SDK 버전 하향 또는 도입 보류. *에이전트.*
- [ ] **T-S2d** AC-S-2~S-9 CI 게이트 스크립트 `scripts/check-sentry-egress.sh` **[미구현 — 파일 없음]** + 배선. 경로 정본은 `scripts/gates/check-sentry-egress.sh`이고(fleet-hardening §0.2) 거기 떨어뜨리면 `scripts/verify-all.sh`가 자동 편입한다. *에이전트.*
- [ ] **T-S3** 2주 관찰 → 쿼터 소모·이벤트 종류 집계 → Crons 2·3 추가 / Team 승격 판단. *사람.*
- [ ] **T-S4** §7.2의 기존 문서 반영 4건(alerting spec §3.0·§5, hardware-ops §2.9, log-ingestion 런북 §5). *에이전트.*

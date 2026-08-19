# 0022. 에러 트래킹: GlitchTip 자체호스팅 채택

- 상태: 채택 (2026-07-30)
- 관련: [specs/error-tracking/](../../specs/error-tracking/README.md)(실행 스펙) · [specs/observability-alerting/sentry.md](../../specs/observability-alerting/sentry.md)(조사 정본, 3안 비교) · [specs/alerting/spec.md](../../specs/alerting/spec.md)(알림 정책) · [ADR-0014](./0014-log-assistant.md)(어시스턴트 egress 0) · 헌장 §I-1·§I-2·§8·§13·§15
- 번호: sentry.md §7.2가 **이 결정을 위해 0022를 예약**했고, 0018~0021은 [hardware-ops README §5](../../specs/hardware-ops/README.md)가 예약했다(0018 알림엔진 · 0019 BMC · 0020 드라이버표준 · 0021 증설트리거). 예약표를 깨지 않기 위해 0022를 쓴다.

## 맥락

관측 스택에 **앱 런타임 예외 계층이 없다.** 메트릭(Prometheus)·로그(OpenSearch 365일)·인프라 알림(Grafana 통합 알림, 규칙 5건 라이브)은 전부 동작하는데, Next.js 콘솔이 500을 뱉으면 남는 것은 컨테이너 stdout → journald뿐이다. 집계·중복묶기·알림이 0이라 **"며칠 전 그 500이 몇 번 났나"에 답할 수 없다.**

실측 근거(`apps/console`, 2026-07-30): `instrumentation.ts`·`instrumentation-client.ts`·`src/app/global-error.tsx`·`src/app/error.tsx` **전부 없음.** 런타임 의존성 5개 중 에러 트래킹 관련 0.

동시에 **더 큰 공백**이 하나 있다. 2026-07-24~30 로그 인입이 **5.7일간 멈췄고 아무도 몰랐다.** filebeat는 `active`, Logstash는 `:5044` LISTEN, 대시보드는 "에러 0건" 초록이었다 — **모든 존재(presence) 검증이 통과했다.** 조용한 실패는 **부재(absence)를 검증해야** 잡힌다. Grafana에 `LogIngestStalled` 규칙을 넣어 10분 탐지를 확보했지만, 그 규칙은 **Grafana가 살아 있을 때만** 발화한다. 관측 스택 전체가 data05 한 대에 있으므로 발화 주체가 죽는 경우가 남는다.

담당 분리는 이미 정해져 있다: **인프라 지표 = Grafana / 앱 런타임 에러 = 에러 트래커.** 이 ADR은 후자의 도구와 배치를 정한다.

## 결정

**앱 런타임 에러 트래킹과 dead man's switch를 `GlitchTip`(MIT) 자체호스팅으로 구현한다.**

1. **배치**: data05, compose **서비스 3개**(`glitchtip/glitchtip:6` all_in_one · `postgres:18` · `valkey/valkey:9`). 라이브 경로 `/data/glitchtip/`, 레포 원본 `infra/error-tracking/`.
2. **라이브 관제 스택(`/data/monitoring`)과 compose 파일·프로젝트·`.env`를 분리한다.** 합치지 않는 이유는 폭발 반경이다 — GlitchTip 쪽 오타 하나가 `up -d`를 막으면 Prometheus·Grafana까지 못 뜨고, compose **1.29**는 env 변경 시 `ContainerConfig` KeyError 때문에 `docker rm -f` 후 재생성이 필요하다(라이브 Grafana를 `rm -f`할 위험). 헌장 §12의 문자 그대로의 적용.
3. **SDK는 `@sentry/nextjs`를 그대로 쓰고 DSN만 GlitchTip으로 향한다.** Sentry SDK 호환이므로 벤더 잠금이 없다.
4. **반출 최소화가 설정이 아니라 계약이다**: `beforeSend`를 **화이트리스트 재구성**으로 짜고(삭제 나열 금지), `serverName: "keiwi-console"`(기본은 `os.hostname()` = `data05lx`), `sourcemaps.disable: true`, `telemetry: false`, `tracesSampleRate: 0`, `enableLogs: false`. GlitchTip 서버측 PII 스크러버(기본 OFF)도 함께 켠다 — 2단 방어.
5. **dead man's switch는 GlitchTip Heartbeat로 구현한다.** Sentry Crons 문법(`captureCheckIn`)은 **쓰지 않는다** — `check_in`이 `IgnoredItemType`이라 **200을 받고 조용히 폐기된다.** heartbeat에 `status` 파라미터가 없으므로 **"정상일 때만 보내고, 비정상은 부재로 표현한다."**
6. **GlitchTip에 지표 임계 알림을 단 1건도 만들지 않는다.** 알림 UI가 Grafana 밖에 하나 더 생기면 §I-2를 스스로 깬다.
7. **DSN 미설정·빈값·깨진값이 콘솔 기동을 막아서는 안 된다.** `getGlitchTipDsn(): string | undefined` — throw 금지.
8. **배포 전 env 키 존재·길이 검증을 게이트로 둔다**(`scripts/check-env.sh`, `up -d` 전 exit 1).

## 고려한 대안

### (a) Sentry Free (Developer) — 기각

| 제약 | 값 | 왜 기각인가 |
|---|---|---|
| **Slack 연동** | **불가 — 이메일만** | [alerting spec §5](../../specs/alerting/spec.md)가 "1인 SRE는 메일함을 실시간으로 안 본다 → SEV1에 부적합"으로 이미 판정했다. **알림 요구를 원리적으로 충족하지 못한다** |
| seat | 1명 | 우리와 맞지만 확장성 0 |
| 보존 | 30일 | 로그 365일 정책과 12배 후퇴 |
| cron monitor | **1개** | 하트비트 카탈로그 3개 중 하나만 |
| 쿼터 초과 | **조용히 드롭** | 관측 도구가 조용히 실패하는 구조를 또 만든다 — 우리는 방금 그 종류로 5.7일을 잃었다 |

### (b) Sentry Team — 기각

**$26/월**(errors 50,000 · 보존 90일 · cron 추가 $0.78/monitor · uptime $1.00/monitor). 기능은 충족하지만:
- 비용이 상시 발생한다. 5노드·1인 운영에 월 $26의 정당화가 어렵다.
- **비용을 지불해도 아래 (c)의 반출 문제는 그대로 남는다.** 돈이 해결하는 것은 기능이고, 우리가 걱정하는 것은 데이터 거버넌스다.

### (c) SaaS 공통의 반출 문제 — 이것이 결정의 중심

| | Sentry.io (Free/Team 공통) | **GlitchTip self-host** |
|---|---|---|
| 나가는 것 | 에러 이벤트 **전체** — 스택트레이스·소스 스니펫·`abs_path`·요청 URL·헤더·breadcrumbs·모듈 목록·hostname·OS/커널 | **아무것도** — data05 안에 머문다 |
| KEI 내부 파일경로 | 나간다(`/home/mooner92/keiwi-design/apps/console/src/lib/…`) | 안 나간다 |
| 내부 IP | breadcrumbs·cause 체인으로 나간다(`connect ECONNREFUSED 192.0.2.15:9090`) | 안 나간다 |
| 되돌릴 수 있는가 | **아니오** — 개별 이벤트 삭제 불가. "민감정보가 많이 들어갔으면 **프로젝트를 삭제·재생성하라**"가 공식 안내 | 해당 없음 |
| 헌장 §I-1(온프렘 only) | **정면 충돌** → egress 예외 승인이 필요 | **충족** |

**egress 0이 이 상황에서 가장 큰 이점이다.** 개인 Slack 워크스페이스를 쓰는 상태에서 KEI 내부 스택트레이스·파일경로가 외부 SaaS에 **되돌릴 수 없이** 적재되는 것을 피한다. 자체호스팅으로도 Slack에는 나가지만, 그 반출면은 **4개 필드**(`title`·`title_link`·`culprit`·tags)로 우리가 통제한다.

### (d) self-hosted Sentry — 기각

master `docker-compose.yml`을 직접 세었다: **서비스 65개**(Kafka · ClickHouse · snuba 컨슈머 31개 · symbolicator · relay 등), 최소 **4 CPU · 16 GB RAM + 16 GB swap**. 관측 대상(5노드)보다 관측 도구가 커진다. 그리고 **그 65개 컨테이너 자체가 새로운 무성 실패 표면**이다 — 우리는 방금 그 종류의 사고로 5.7일을 잃었다. data05가 **A40×2 연구 GPU 노드**라는 점에서 Kafka·ClickHouse 상시 부하를 연구 워크로드와 경합시키는 것은 ADR-0014의 원칙과도 어긋난다.

### (e) 아무것도 하지 않는다 — 기각

콘솔 에러 관측이 0으로 남고, dead man's switch가 Grafana 자기 자신에게만 의존한다. 5.7일 사고의 **정확한 재발 조건**을 그대로 남기는 선택이다.

## 근거 (실측·소스 확인)

| # | 사실 | 출처 |
|---|---|---|
| 1 | GlitchTip은 Slack에 **네이티브로** 보낸다 — `RecipientType.GENERAL_WEBHOOK`의 라벨이 소스에 **"General Slack-compatible webhook"**이고 페이로드가 Slack legacy attachments 형식(`{text, attachments:[{title,title_link,text,color,fields}]}`) 그대로다. **변환 중계기 0개** | `apps/alerts/constants.py`·`webhooks.py` |
| 2 | 이 망에서 `slack.com`은 **SNI 필터로 차단**(TCP는 열리고 TLS 리셋, 3/3 재현)이지만 **`hooks.slack.com`·`api.slack.com`은 정상** → GlitchTip이 쓰는 incoming webhook 경로가 열려 있다 | 2026-07-30 data05 실측 |
| 3 | 서비스 **3개**·RAM 권장 512 MB·최소 256 MB vs data05 RAM **256 GB**, `/data` 3.5 TB 중 **11%** 사용 | 실측 |
| 4 | `@sentry/nextjs` **10.69.0**의 peerDeps가 `next: ^16.0.0-0` → 우리 **16.2.9** 충족. DSN만 교체하면 동작 → **되돌리기가 싸다** | npm 실조회 + 공식 Next.js SDK 문서 |
| 5 | Heartbeat 타입이 내장이고 **개수 제한이 없다.** Sentry Free는 cron monitor 1개 | `apps/uptime/constants.py` |
| 6 | 유지보수가 활발하다 — 최신 `v6.2.2`(2026-07-17), 패치 월 1~3회, 마이너 2~4개월. 열린 이슈 92 / 닫힌 393 | GitLab API |
| 7 | 6.0에서 `/metrics` 경로가 고정 → **기존 Prometheus에 붙는다**(보너스) | 릴리스 노트 |
| 8 | 업그레이드는 `compose pull` + 재시작(마이그레이션 자동) | 설치 문서 |

**GlitchTip이 지원하지 않는 것도 근거의 일부다** — 우리가 쓸 계획이 없는 것들이다: Session Replay · Profiling · Release health/sessions(**명시적 거부**) · standalone span · trace metrics · **Sentry Crons(`check_in`)**. 반대로 Errors · Tracing · user feedback · structured logs는 지원한다. 즉 **우리가 쓰려는 기능은 전부 지원 범위 안이고, 지원되지 않는 기능은 전부 스코프 아웃 대상**이다.

## 결과

**얻는 것**
- 콘솔 예외가 **5분 안에 `#keiwi-web`에** 뜬다(SEV2 — 야간 폰 안 울림, alerting spec §1 준수).
- 로그 인입 중단이 **Grafana가 죽어 있어도** 탐지된다. 5.7일 → **30~40분**(≈205배). 1차 탐지는 여전히 Grafana `LogIngestStalled` 10분이고 heartbeat는 백스톱이다 — **2단 방어이며 중복이 아니다.**
- 외부 egress **증가 0**. Slack 반출은 이미 승인된 범위(ADR-0018) 안이고 필드가 4개로 한정된다.
- `up{job="glitchtip"}`이 Grafana에 들어온다.

**비용·부담**
- 컨테이너 3개 + `pg_dump` 백업 대상 1개 + 재기동할 스택 1개가 늘어난다.
- 신규 의존성 `@sentry/nextjs`(직접 의존성 14개, unpacked 1.92 MB) — 콘솔 런타임 의존성이 **5개 → 6개**, 전이 의존성은 배 이상.
- **Slack 크레덴셜이 2종이 된다** — Grafana는 bot token(`api.slack.com`), GlitchTip은 incoming webhook(`hooks.slack.com`). 하나를 회전시켜도 다른 하나는 안 고쳐진다.
- **GlitchTip 설정에 파일 프로비저닝이 없다** — 프로젝트·recipient·monitor가 DB에만 있다. "설정을 코드로"가 성립하지 않는 영역이므로 `pg_dump` + 런북의 UI 재구성 절차로 대체한다.

**정직하게 남는 한계 3개**
1. **관찰자가 피관찰자와 같은 호스트다.** data05가 통째로 죽으면 GlitchTip도 죽는다. 단 실제 5.7일 사고는 data05가 살아 있는 상태였으므로 heartbeat가 100% 잡는다. 남는 구멍은 **data03 교차 관찰자**로 메운다(권고안, egress 0). **기관 네트워크 단절은 어느 장치도 덮지 못한다** → 사외 1비트 관찰자는 별건 백로그(BE-01).
2. **워커 루프가 멈추면 down 판정이 일어나지 않는다** — 무성 실패 탐지기가 무성으로 실패할 수 있다. AC-E-11이 이 사실을 실증하고 런북에 기록한다.
3. **Turbopack + SDK 크래시 보고가 실재한다**(`sentry-javascript#19367`, Next 16.1.6 + SDK 10.38.0+, `closed/not_planned`). 게이트 AC-E-14로 판정하고, 실패하면 **10.8.0으로 핀**하고 그 사실을 이 ADR에 기록한다. **최신 버전을 추격하지 않는다.**

**되돌리기 비용 — 3단계로, 전부 싸다**

| 되돌림 | 방법 | 비용 | 잃는 것 |
|---|---|---|---|
| **알림만 끄기** | GlitchTip UI에서 `ProjectAlert` 비활성 | 1분 | Slack 알림. 이슈 수집은 계속 |
| **콘솔에서 떼기** | `.env.local`의 DSN 2줄 삭제 + 재기동 | 1분, **코드 변경 0** | 에러 수집. **콘솔은 정상 동작**(설계상 DSN 없이 기동, AC-E-3) |
| **완전 제거** | `docker-compose down -v` + `next.config.ts` 래핑 해제 + 파일 5개 삭제 + `npm uninstall` | 1시간 | 이슈 이력(정본은 아니다) |
| **SaaS로 이전** | DSN 문자열만 교체 | **수십 분** | 과거 이슈. `@sentry/nextjs`가 그대로라 코드 변경 0 |

가장 비싼 항목은 "완전 제거"의 1시간이고, 여기에 **되돌릴 수 없는 것이 하나도 없다.** SaaS 대안이 가진 "이벤트를 지울 수 없다 / 프로젝트를 삭제·재생성해야 한다"는 비대칭이 이 결정의 마지막 근거다.

## 개정 이력

- 2026-07-30 최초 채택. **`specs/error-tracking/tasks.md` E0(측정 전용 단계) 결과와 게이트 GV-1~GV-8 통과 여부를 E5-4에서 이 절에 기록한다** — 특히 ① compose 1.29의 YAML anchor 파싱 여부 ② `…ALLOW_PRIVATE_IPS` 정확한 키 이름 ③ 빈 `SECRET_KEY`의 실제 거동 ④ 확정된 SDK 버전 ⑤ 탐지 지연 실측치.

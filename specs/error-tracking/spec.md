# 에러 트래킹 — SPEC (GlitchTip 배치 · 콘솔 SDK · dead man's switch)

> 2026-07-30. 권위: [README](./README.md) · [헌장](../../Constitution.md) · [alerting/spec.md](../alerting/spec.md) v1.1(정책) · [ADR-0022](../../docs/decisions/0022-error-tracking-glitchtip.md).
> 조사 정본 = [`specs/observability-alerting/sentry.md`](../observability-alerting/sentry.md). **여기서 반복하지 않는다 — 인용한다.**
> 이 문서가 "무엇을 어디에 올리고 무엇을 반출하고 무엇에 알릴지"의 계약이다. 구현이 벗어나면 구현이 틀린 것(§7).
>
> 표기: **[실측]** · **[조사]**(업스트림 소스/문서) · **[미확인]**(게이트로 남김) · `[server]` = 사람이 적용(§11).
> 모든 수용 기준은 **명령과 기대 출력**으로 쓴다("잘 된다" 금지, §9).

---

## 0. 착수 전 검증 게이트 — 실측으로만 통과한다

> [!CAUTION]
> **이 스펙의 최상위 규칙 — 벤더 스키마에 있는지 확인되지 않은 키·옵션은 쓰지 않는다.**
> 근거는 가설이 아니라 이번 세션의 사고 5건이다:
> ① filebeat 7.17에 없는 `include_matches: not …`를 "방어적으로" 넣어 **6일간 수집 전멸**(ERROR 0줄, systemctl active)
> ② Grafana 프로비저닝에 없는 최상위 키(`inhibitionRules`·`muteTimings`)로 **Grafana 기동 불가**
> ③ TCP 도달성만 보고 "Slack 안 막혔다" 오판 — TLS까지 봐야 했다
> ④ `bucketAggs: []`로 OpenSearch 쿼리 실패 — 답이 우리 `infra/logging/README.md` §7에 **이미 있었다**
> ⑤ 빈 환경변수 하나(`SLACK_BOT_TOKEN`)가 **Grafana 전체를 내렸다**
> 공통 원인은 하나다: **확인할 수 있는 것을 확인하지 않고 진행.** 아래 게이트는 그 재발을 막는 장치다.

**허용되는 정본 3개뿐**: ⓐ `https://glitchtip.com/assets/compose.sample.yml`(설치 문서가 가리키는 compose 정본) · ⓑ `glitchtip/settings.py`의 `env(...)` 호출부 · ⓒ 설치 문서 Configuration 절. **이 셋 중 어디에도 없는 env 키는 compose에 쓰지 않는다.**

| # | 게이트 | 확인 명령 | 통과 기준 | 막는 실패 |
|---|---|---|---|---|
| **GV-1** | **compose 1.29가 YAML anchor + merge key를 파싱하는가** | `docker-compose -f infra/error-tracking/docker-compose.yml config >/dev/null; echo rc=$?` | `rc=0` 이고 `config` 출력에 `SECRET_KEY`가 **전개돼** 보인다 | 정본 샘플이 `x-environment: &default-environment` + `<<:`를 쓴다. data05는 **compose 1.29**[실측] → 파싱 실패면 anchor를 풀어 쓴 변형이 필요하다. **모르고 `up -d`하면 원인 불명 실패** |
| **GV-2** | **env 키 이름이 실재하는가** | `grep -nE 'GLITCHTIP_(EVENT\|LOG\|UPTIME\|RELEASE\|)_?RETENTION_DAYS\|ALLOW_PRIVATE_IPS\|ENABLE_USER_REGISTRATION\|PII_SCRUB' <settings.py>` | 우리가 쓸 **모든** 키가 1건 이상 매치 | 조사에서 **이름이 두 가지로 나타난 키가 있다**: `GLITCHTIP_ALLOW_PRIVATE_IPS`(alerts SSRF 가드) vs `GLITCHTIP_UPTIME_ALLOW_PRIVATE_IPS`(uptime 모니터). **둘 중 하나는 틀렸거나 둘 다 존재한다 — 추측으로 쓰면 게이트②의 재현** |
| **GV-3** | **heartbeat URL이 코드 도출값과 일치하는가** | monitor 생성 후 UI 표시 URL을 `diff <(echo "$UI_URL") <(echo "$CODE_URL")` | **문자 단위 일치.** 이어서 `curl -s -o /dev/null -w '%{http_code}' -X POST "$URL"` → **200** | 코드에서 도출한 경로(`/api/0/organizations/<slug>/heartbeat_check/<uuid>/`)는 **문서에 없다**[조사]. **GET 데코레이터가 없어 `curl` 기본(GET)은 실패한다** |
| **GV-4** | **Slack webhook이 GlitchTip에서 실제로 도착하는가** | GlitchTip UI에서 recipient 저장 → `send_test_notification` | **Slack `#keiwi-web`에 메시지 1건 눈으로 확인** | `hooks.slack.com`은 정상이고 `slack.com`은 SNI 차단[실측]. 그리고 `GLITCHTIP_ALLOW_PRIVATE_IPS` 기본 `False`라 **사설 IP로 해석되는 URL은 warning 로그만 남기고 조용히 차단**된다 |
| **GV-5** | **빈/누락 시크릿이 무엇을 깨는가** | `SECRET_KEY=` (빈 문자열)로 `docker-compose up -d` → `docker logs` | **거동을 기록한다**(기동 실패인지, 경고만인지). 이 결과가 `check-env.sh`의 강도를 정한다 | 게이트⑤. **GlitchTip이 Grafana와 같은지 다른지 지금은 모른다 — 알 수 있는 것을 모른 채 배포하지 않는다** |
| **GV-6** | **:8090이 비어 있는가 / cloudflared가 호스트인가 컨테이너인가** | `ss -ltnp \| grep -E ':(8090\|8091)\b'` · `docker ps --format '{{.Names}}' \| grep -i cloudflare` | 8090 **미점유**. cloudflared 런타임 판정 | :8080은 **이미 점유**[실측]. cloudflared가 컨테이너면 `127.0.0.1` 바인드만으로는 터널이 GlitchTip에 닿지 못한다(§2.3) |
| **GV-7** | **호스트 PG와 충돌하지 않는가** | `ss -ltnp \| grep :5432` | 호스트 PG 16.14가 `127.0.0.1:5432`에서 **라이브**[실측] → GlitchTip PG는 **컨테이너 내부 전용, 호스트 포트 미노출** | 라이브 DB를 건드리는 것은 §12 위반 |
| **GV-8** | **Sentry SDK가 Next 16 Turbopack에서 크래시하지 않는가** | `npm run build` + `npm run dev` 후 전 라우트 순회 | 로그에 `Maximum call stack size exceeded` **0건** | `getsentry/sentry-javascript#19367`(Next 16.1.6 + SDK 10.38.0+, `closed/not_planned`)[조사]. 실패 시 **10.8.0 핀**하고 ADR에 기록 — 최신 추격 금지 |

> [!TIP]
> **GV-1~GV-7은 `[server]` 사람 작업이고, 전부 읽기 또는 격리된 dev 프로젝트에서 한다.** 라이브 `/data/monitoring`을 건드리는 게이트는 하나도 없다.

---

## 1. 사용자 스토리

### US-1 — 콘솔이 에러를 던지면 5분 안에 `#keiwi-web`에 알림이 온다

> 연구원이 `/logs`에서 어시스턴트에 질문했는데 502가 떴다. 지금은 SRE가 **모른다**(§README 3).
> 도입 후: 예외가 GlitchTip 이슈가 되고, `ProjectAlert`가 Slack `#keiwi-web`에 1건을 보낸다. SRE는 링크를 눌러 스택트레이스를 본다. **내부 IP·쿠키·요청 본문은 Slack에도 GlitchTip에도 없다.**

- **5분의 근거**: `ProjectAlert.timespan_minutes`를 **5**로 잡는다(첫 이벤트로부터 5분 창). 즉시 발화가 아니라 5분 창인 이유는 alerting spec §0-4(순간이 아니라 지속) + 같은 배포에서 쏟아지는 동일 에러를 한 건으로 묶기 위함이다.
- **SEV**: **SEV2.** 야간에 폰을 울리지 않는다(alerting spec §1). 채널은 `#keiwi-web` — Grafana 라우팅의 `domain=app` 경로와 **같은 채널, 다른 발신자**다(§4.3).
- **경계**: "콘솔이 느리다"·"GPU가 뜨겁다"는 이 스토리가 아니다. Grafana다.

### US-2 — 로그 인입이 멈추면 Grafana가 죽어 있어도 알림이 온다

> 2026-07-24~30 사고의 구조: **filebeat `active` · Logstash `:5044` LISTEN · 대시보드 "에러 0건" 초록.** 모든 **존재** 검증이 통과했고 5.7일간 아무도 몰랐다. 발견 경로는 알림이 아니라 우연한 조회였다.
> 도입 후: data05 timer가 "OpenSearch 최신 `@timestamp`가 신선할 때만" GlitchTip heartbeat에 POST한다. **안 보내면 GlitchTip이 down으로 전이하고 Slack에 알린다.**

- **왜 Grafana의 `LogIngestStalled`(라이브)로 충분하지 않은가**: 그 규칙은 **Grafana가 살아 있을 때만** 발화한다. 실제 사고에서 죽은 것은 Logstash였지만, **같은 호스트의 Grafana가 죽는 경우 그 규칙은 자기 죽음을 알릴 수 없다.** heartbeat는 **부재**를 외부(=별도 프로세스·별도 DB)에서 본다.
- **2단 방어이며 중복이 아니다**: Grafana `LogIngestStalled` = 10분 정밀 탐지(1차) / heartbeat = 20~30분 백스톱(2차, §6.2에 수치 근거).
- **판정은 뒤집혀 있다**: GlitchTip heartbeat에 `status=error`가 **없다**[조사] → **"정상일 때만 보낸다."** 비정상은 **부재로 표현**한다.

### US-3 — 시크릿이 비어도, GlitchTip이 죽어도 콘솔은 계속 뜬다

> 이번 세션에 빈 `SLACK_BOT_TOKEN` 하나가 **Grafana 전체를 내렸다.** 같은 구조를 콘솔에 만들지 않는다.
> DSN이 미설정·빈 문자열·깨진 값이어도 콘솔은 정상 기동하고 에러 트래킹만 조용히 비활성된다(로그 1줄). GlitchTip 컨테이너가 정지해도 콘솔 응답 시간과 가용성에 영향이 없다.

- 구현 계약: `getGlitchTipDsn(): string | undefined` — **`throw`하지 않는다.** `src/config/env.ts`의 fail-fast 패턴을 **그대로 복사하지 않는다**(그 패턴은 필수 키용이다).
- 검증: AC-E-3(부팅 3회) · AC-E-4(GlitchTip 정지 중 콘솔 무영향).

---

## 2. 배치 설계

### 2.1 왜 `/data/monitoring`에 합치지 않는가 — 분리 결정

**결정: 라이브 경로 `/data/glitchtip/`(신설) · 레포 원본 `infra/error-tracking/` · compose 프로젝트명 `glitchtip`(별도).**

기존 관례는 "레포 `infra/<영역>/` → 라이브 `/data/monitoring/`, 사람이 정렬"이다. **디렉터리 관례는 유지하고(레포 `infra/<영역>/`), compose 파일과 프로젝트는 분리한다.** 근거:

| # | 근거 | 실측/사실 |
|---|---|---|
| 1 | **폭발 반경.** 한 compose 파일에 합치면 GlitchTip 쪽 오타 하나가 `up -d` 전체를 막아 **Prometheus·Grafana까지 못 뜬다** | 게이트⑤와 정확히 같은 구조(프로비저닝 실패가 기동을 막는다) |
| 2 | **compose 1.29 recreate 버그.** env 변경은 restart가 아니라 **재생성**이 필요하고, 1.29는 `ContainerConfig` KeyError가 나서 `docker rm -f` 후 `up -d`를 해야 한다 | [실측]. 합쳐 두면 GlitchTip env를 만질 때마다 **라이브 Grafana를 `rm -f`할 위험**에 노출된다 |
| 3 | **시크릿 격리(§13).** `/data/monitoring/.env`에는 이미 `GRAFANA_ADMIN_PASSWORD`·`SLACK_BOT_TOKEN`이 있다. GlitchTip은 `SECRET_KEY` + webhook URL이 필요하다 | 한 파일의 오타가 두 스택을 동시에 죽이지 않게 **`.env`를 분리**한다 |
| 4 | **버전 정책이 다르다.** GlitchTip은 `compose pull` + 재시작으로 마이그레이션이 자동 실행된다[조사] → 업그레이드 단위가 Prometheus/Grafana와 다르다 | 합치면 `pull`이 4개 이미지를 함께 당긴다 |
| 5 | **헌장 §12(개발 격리)의 문자 그대로의 적용** | "dev 인스턴스는 별도 compose 프로젝트명·포트·볼륨으로 분리" |

> [!WARNING]
> **분리의 비용도 적는다.** 스택이 2개가 되면 사람이 재기동할 곳이 2곳이 되고, 백업 대상도 2개가 된다(§2.6). 그 비용을 지불하는 이유는 위 표의 1·2번 — **라이브 관제 스택을 GlitchTip 사고에 묶지 않기 위해서**다.

> [!CAUTION]
> **compose 파일의 bind 경로가 git worktree를 가리키면 안 된다.** 라이브 Logstash가 `/KEIwi`를 바인드해 읽는 구조 때문에 `git checkout`이 **라이브 설정을 덮어써 5.7일 인입 중단**을 만들었다. GlitchTip은 bind를 아예 쓰지 않고(named volume만, §2.4) 설정은 전부 env로 넣는다. `infra/error-tracking/`는 **원본**이고 사람이 `/data/glitchtip/`에 **복사**한다(§11).

### 2.2 서비스 구성 — 정본 샘플에서 벗어나지 않는다

정본(`glitchtip.com/assets/compose.sample.yml`)은 **서비스 3개**다[조사]. 우리가 하는 변경은 **아래 표의 것뿐**이다.

| 서비스 | 이미지 | 정본과 다른 점 | 근거 |
|---|---|---|---|
| `web` | `glitchtip/glitchtip:6` (메이저 핀) | 포트 바인드를 `0.0.0.0:8000` → **호스트 IP 명시**(§2.3) / `SERVER_ROLE: all_in_one` 유지 | all_in_one이 web+worker 통합, 6에서 stable[조사]. **워커를 따로 띄우지 않는다**(서비스 수 최소) |
| `postgres` | `postgres:18` | `POSTGRES_HOST_AUTH_METHOD: trust` **제거 → 비밀번호 설정** / **호스트 포트 미노출** | 정본 주석이 "Consider removing this and setting a password"라고 스스로 권한다. 호스트 PG 16.14가 :5432 라이브[실측]이므로 노출 금지(GV-7) |
| `valkey` | `valkey/valkey:9` | 변경 없음 | RAM 256 GB라 끌 이유가 없다. `VALKEY_URL=""`(비활성)은 **쓰지 않는다** |

**추가하지 않는 것**: `depends_on`에 `condition: service_healthy`를 **넣지 않는다** — 정본에 없고, compose 1.29의 지원 범위가 [미확인]이다. 대신 첫 기동 마이그레이션 레이스는 **절차로** 흡수한다(tasks E1-3: `postgres` 먼저 → 헬스 확인 → `web`).

**메이저를 `6`으로 핀하는 이유**: 최신은 `v6.2.2`(2026-07-17)이고 패치가 월 1~3회 나온다[조사]. 패치는 자동으로 받고 **메이저는 사람이 올린다**(6.0의 breaking: 포트 8080→8000, Valkey 7+ 필수).

### 2.3 포트·네트워크

| 경로 | 주소 | 프로토콜 | 근거 |
|---|---|---|---|
| 콘솔(호스트 프로세스) → ingest | `127.0.0.1:8090` | **HTTP** | 망을 타지 않는다. **자체 서명 CA를 도입하지 않는다**(`transportOptions.caCerts` 불필요 — 관리 부담만 늘고 얻는 것이 없다) |
| Prometheus(컨테이너) → `/metrics` | `172.18.0.1:8090` | HTTP | 기존 관례와 동일 — vLLM `172.18.0.1:8003`·gpu-model `172.18.0.1:9836`[실측]. 6.0에서 `/metrics` 경로가 고정됐다[조사] |
| 브라우저 → 이벤트 전송 | **콘솔 자신의 오리진** `/monitoring` (tunnel route) | HTTPS(CF 엣지 종단) | §5.1 |
| 사람 → UI | `https://glitchtip.excusa.uk` + Cloudflare Access | HTTPS | 기존 `grafana.excusa.uk` 패턴(§14) |

**바인드 결정**: `web`의 ports를 **두 줄**로 쓴다 — `"127.0.0.1:8090:8000"` + `"172.18.0.1:8090:8000"`.
- `0.0.0.0` 바인드를 피하는 이유: LAN 전체에 로그인 화면을 노출할 이유가 없다.
- 두 줄이 필요한 이유: Prometheus는 컨테이너라 `127.0.0.1`에 닿지 못한다.
- **[미확인 → GV-6]** cloudflared가 컨테이너라면 `172.18.0.1` 쪽으로 향해야 한다. 판정 후 확정한다.

`GLITCHTIP_DOMAIN=https://glitchtip.excusa.uk` — 이 값이 **Slack 메시지의 링크를 만든다**(`issue.get_detail_url()`)[조사]. 잘못 넣으면 알림은 오는데 링크가 죽는다.
`ALLOWED_HOSTS`·`CSRF_TRUSTED_ORIGINS`는 **GV-2에서 키 존재를 확인한 뒤에만** 쓴다(기본 `["*"]` + 경고).

### 2.4 볼륨

정본을 따른다 — **named volume 2개**(`pg-data:/var/lib/postgresql`, `uploads:/code/uploads`).

> [!NOTE]
> `pg-data`의 컨테이너 경로가 `/var/lib/postgresql`이다(관례인 `/var/lib/postgresql/data`가 아니다). **정본이 그렇게 쓰므로 그대로 둔다.** 여기서 "더 맞는 경로"로 고치면 업그레이드 때 데이터가 안 보이는 사고가 난다.
> `/data` 하위 bind로 바꾸지 않는 이유: bind 경로를 손으로 만들면 소유자·권한 문제가 생기고, 백업은 §2.6의 `pg_dump` 경로로 해결되므로 bind의 이점이 없다.

### 2.5 리소스 상한 · 보존 · 용량

**리소스 상한**

| 항목 | 값 | 근거 |
|---|---|---|
| `web` `mem_limit` | **1g** | 권장 512 MB·최소 256 MB[조사]. 2배 여유. 상한을 두는 이유는 data05가 **A40×2 연구 GPU 노드**라 관측 도구가 연구 워크로드와 경합해선 안 되기 때문(ADR-0014 원칙) |
| `postgres` `mem_limit` | 512m | 이벤트 월 1,000건 규모 |
| `valkey` `mem_limit` | 256m | 큐·캐시 전용 |
| `cpus` | 미설정 | 이벤트가 희소해 CPU가 병목이 아니다. **상한을 안 두는 것도 결정이다** |

> [!WARNING]
> `mem_limit`/`cpus`가 **compose 1.29 + compose file v3.8 조합에서 무시될 수 있다**[미확인]. `docker inspect`로 실제 적용을 확인한다(AC-E-16). "설정했으니 됐다"로 넘기지 않는다 — 이것도 게이트②와 같은 부류다.

**보존 — 기본값을 그대로 받아들이지 않고 명시적으로 결정한다**

| 데이터 | env(GV-2로 이름 확인 후) | 결정 | 근거 |
|---|---|---|---|
| 에러 이벤트 | `GLITCHTIP_EVENT_RETENTION_DAYS` | **90(기본 유지)** | 장기 정본은 OpenSearch 365일이다. **보존 연장 = 열람 창 연장**이고 스택트레이스에는 파일경로가 들어 있다. 디스크가 싸다는 이유로 늘리지 않는다 |
| 업타임/하트비트 | `GLITCHTIP_UPTIME_RETENTION_DAYS` | **365** | 행이 작고 PII가 없다. "인입이 언제·몇 번 멈췄나"의 연간 기록이 이 스펙의 존재 이유와 직결 |
| 로그·트랜잭션 | `…_LOG_/…_TRANSACTION_…` | **손대지 않는다** | 둘 다 보내지 않으므로 값이 무의미하다. **쓰지 않는 키를 설정하지 않는다**(게이트②) |
| 마스터 | `GLITCHTIP_RETENTION_DAYS` | **설정하지 않는다** | 개별 키가 있으면 마스터와 우선순위가 불명확[미확인]. 개별 키만 쓴다 |

**용량 [가설 — 계산 근거 명시]**

| 항목 | 계산 | 결과 |
|---|---|---|
| 이벤트 | 문서 기준 **~30 GB / 100만 건**(≈30 KB/건, 풀 이벤트). §5의 스트립 후 **~3~5 KB/건**. 예상 월 1,000건 | **월 3~5 MB** |
| 하트비트 | 3 monitor × 120초 주기 = 2,160행/일 × 365일 | **연 100~200 MB** |
| 결론 | `/data` 3.5 TB 중 **11% 사용**[실측] | **디스크는 제약이 아니다. 제약은 열람 범위다** |

### 2.6 백업 대상

| 대상 | 방법 | 주기 | 잃으면 무엇을 잃는가 |
|---|---|---|---|
| **`postgres` 논리 백업** | `docker exec … pg_dump -Fc` → `/data/backup/glitchtip/` | 일 1회 | 이슈 이력 + **monitor의 `endpoint_id` UUID**(= heartbeat 시크릿) + 프로젝트 DSN. UUID를 잃으면 **모든 heartbeat 스크립트가 조용히 404를 받는다** |
| `/data/glitchtip/.env` | 별도 안전 위치에 0600 복사 | 변경 시 | `SECRET_KEY` 상실 = 세션·서명 무효 |
| `uploads` 볼륨 | v1 **백업 안 함** | — | 소스맵 업로드를 하지 않으므로 사실상 빈 볼륨 |
| GlitchTip 설정(프로젝트·alert recipient) | **DB 안에 있다** → 위 `pg_dump`에 포함 | — | ⚠️ Grafana처럼 파일 프로비저닝이 **없다.** 즉 "설정을 코드로"가 성립하지 않는 영역이다 → §7.5에 리스크로 명시 |

---

## 3. 시크릿 처리 (§13)

**원칙: 레포에는 키 이름만, 값은 3곳에만.**

| 시크릿 | 저장 위치 | 소유·권한 | 주입 경로 | 레포 방어 |
|---|---|---|---|---|
| `SECRET_KEY` | `/data/glitchtip/.env` | `root:root 0600` | compose `${SECRET_KEY}` | `.env.example`에 키 이름만. `check:secrets` 규칙2가 `.env` 추적을 차단 |
| `POSTGRES_PASSWORD` | 동일 | 동일 | compose | 동일 |
| **콘솔 서버 DSN** (`GLITCHTIP_DSN`) | `apps/console/.env.local` | 콘솔 실행 계정 0600 | `process.env` → `config/env.ts` optional 게터 | **AC-E-12**가 DSN 리터럴 커밋을 차단 |
| **heartbeat UUID** ×3 | `/etc/keiwi/heartbeat.env` (data05) | `root:root 0600` | systemd `EnvironmentFile=` | Ansible 템플릿은 **변수만** 참조. `roles/watchdog/defaults`에 값 금지 |
| **Slack incoming webhook URL** | **GlitchTip DB**(UI에서 입력) | — | — | 레포에 안 들어간다. ⚠️ 단 §2.6의 `pg_dump`에는 들어간다 → 백업 파일 권한 0600 |

> [!IMPORTANT]
> **heartbeat UUID는 인증 없는(`auth=None`) 엔드포인트의 유일한 시크릿이다**[조사]. URL을 아는 사람은 누구나 "살아 있다"를 위조할 수 있다 → **로그·커밋·Slack 메시지에 절대 싣지 않는다.** 스크립트는 URL을 `set -x` 없이 다루고, 실패 시 URL을 에코하지 않는다(AC-E-13).

> [!NOTE]
> **Slack 크레덴셜이 2종이 된다.** Grafana는 **bot token**(`api.slack.com/api/chat.postMessage`)을 쓴다 — 이 망에서 `slack.com`이 SNI 차단이라 `endpointUrl` 오버라이드가 필수였다[실측]. GlitchTip은 **incoming webhook URL**(`hooks.slack.com/services/...`)을 쓴다. 둘은 다른 시크릿이고 다른 호스트를 탄다. **하나를 회전시켜도 다른 하나는 안 고쳐진다** — 런북에 명시(tasks E5-1).

**배포 전 검증(게이트⑤ 재발 방지)**: `infra/error-tracking/scripts/check-env.sh`가 `up -d` **전에** 돌아 ① 필수 키 존재 ② `SECRET_KEY` 길이 ≥ 64자(`openssl rand -hex 32`) ③ 값에 개행·따옴표 없음 ④ `GLITCHTIP_DOMAIN`이 `https://`로 시작을 확인하고 하나라도 실패하면 **exit 1로 배포를 막는다**(AC-E-2).

---

## 4. Slack 연동 — 네이티브 지원이다(중계 불필요)

### 4.1 판정 근거

GlitchTip에 **Slack 전용 통합은 없다.** 대신 `RecipientType.GENERAL_WEBHOOK`의 라벨이 소스에 **"General Slack-compatible webhook"**이라고 적혀 있고, 페이로드가 애초에 Slack 형식이다[조사]:

```
{"text": "GlitchTip Alert", "attachments": [{title, title_link, text, color, fields[]}]}
```

= Slack **legacy secondary attachments** 형식 그대로. Slack Incoming Webhook은 지금도 이 형식을 받는다(legacy·deprecated이나 동작).

**판정: `hooks.slack.com/services/...` URL을 alert recipient에 그대로 붙이면 동작한다. 변환 중계기 0개.**
그리고 `hooks.slack.com`은 이 망에서 **정상**이다[실측 — TLS 레벨까지 확인].

> [!WARNING]
> **판정은 소스 독해다. 실물 도착은 GV-4로 확인한 뒤에만 "된다"고 말한다.** 이번 세션에 "TCP 열렸으니 된다"로 틀렸다. 게이트를 통과할 때까지 이 절의 상태는 **"소스상 호환 / 실물 미확인"**이다.

### 4.2 알려진 결함 2건 (기능 장애 아님 — 표시 품질)

| 결함 | 영향 | 처분 |
|---|---|---|
| attachment 필드명이 **`mrkdown_in`** (Slack 정본은 **`mrkdwn_in`** — `d`/`w` 순서)[조사] | Slack이 모르는 키라 무시 → attachment `text`의 마크다운이 렌더되지 않는다 | **수용.** 업스트림 이슈로 남기고 우리는 패치하지 않는다(포크 = 유지 부담) |
| 본문 `text`가 하드코딩 `"GlitchTip Alert"`(2건 이상이면 `" (N issues)"`) | **채널 목록·모바일 푸시에 이 문구만 보인다** — 무엇이 터졌는지 알 수 없다 | **수용 + 운영 보정.** 열린 업스트림 이슈(#429). 상세는 attachment `title`에 있으므로 **채널을 열면 보인다.** 야간 폰 채널이 아니므로(SEV2) 치명적이지 않다 |

### 4.3 채널·라우팅 — 기존 정책에 얹는다

| | Grafana(라이브) | **GlitchTip(신규)** |
|---|---|---|
| 채널 | `#keiwi-infra`(인프라) / `#keiwi-web`(`domain=app`) | **`#keiwi-web`** |
| 크레덴셜 | bot token + `endpointUrl=api.slack.com` | incoming webhook(`hooks.slack.com`) |
| 그룹핑 | `group_by: [alertname]`, `repeat_interval: 4h` | `timespan_minutes: 5` + `quantity` |
| 야간 | SEV2 → 아침 큐 | 동일(SEV2, 폰 안 울림) |

**같은 채널을 쓰는 이유**: 사람이 볼 곳을 늘리지 않는다. 발신자 이름(`KEIwi Alerts` vs GlitchTip)으로 구분되고, 검색·음소거·보존을 채널 단위로 함께 관리할 수 있다.

**alert 트리거 설정**: `ProjectAlert.timespan_minutes = 5`, `quantity = 1`, `uptime = True`(§6이 이 플래그에 걸려 있다). 수신자는 `recipient_type=webhook` 1건.

---

## 5. 콘솔 SDK 설정과 반출 경계

**전량 필드 표는 [sentry.md §6.1](../observability-alerting/sentry.md)에 있다. 반복하지 않는다.** 여기는 **자체호스팅으로 판정이 바뀐 것**과 **Slack 경계**만 적는다.

### 5.1 이중 DSN + 수동 tunnel — `tunnelRoute`는 쓸 수 없다

> [!CAUTION]
> **`tunnelRoute` 금지.** 소스 확인 결과, DSN 호스트가 `o<digits>.ingest.sentry.io` 패턴이 아니면 **tunnel이 적용되지 않는데**(`debug.warn`만) `next.config`에는 **`*.ingest.sentry.io`로 가는 rewrite가 심긴다**[조사]. 공식 문서도 "unavailable for self-hosted instances". 즉 **egress 0을 깨는 방향의 무효 설정**이다. `check-error-tracking.sh`가 grep으로 차단한다(AC-E-12).

대신 **수동 `tunnel` + 이중 DSN**을 쓴다.

| 런타임 | DSN | 경로 |
|---|---|---|
| **서버** | `GLITCHTIP_DSN` = **실제** `http://<key>@127.0.0.1:8090/<pid>` (서버 전용, 브라우저 비노출) | 루프백 직행 |
| **클라이언트** | `NEXT_PUBLIC_GLITCHTIP_DSN` = **더미** + `tunnel: "/monitoring"` | 같은 오리진 → route handler → 서버측 forward |

왜 이 구조인가:
1. **브라우저가 GlitchTip 호스트와 실제 키를 모른다.**
2. **같은 오리진이라 Cloudflare Access 302가 원리적으로 불가능하다.** GlitchTip을 CF 호스트명으로 노출해 브라우저가 직접 POST하게 하면, ingest 요청이 로그인으로 302되어 **이벤트가 조용히 사라진다** — 우리가 가장 싫어하는 실패 모드다.
3. route handler가 **서버측 2차 화이트리스트**를 걸 수 있다(`beforeSend`는 클라이언트라 우회 가능).
4. GlitchTip이 보는 IP가 **콘솔 서버 하나로 수렴**한다 → 연구원 개인 IP가 남지 않는다.

주의사항: middleware negative matcher로 `/monitoring` 제외 · 그 route 자신을 계측 제외(자기 루프) · body 상한 · **더미 DSN이 SDK 초기화를 통과하는지는 AC-E-7로 확인**.

### 5.2 Slack 반출 경계 — 실제로 망 밖으로 나가는 필드

자체호스팅으로 **망 밖은 닫혔지만 Slack에는 나간다.** 기준선이 "외부 SaaS에 남는가"에서 **"Slack에 실려도 되는가"**로 바뀐다. 실제로 나가는 것은 4개뿐이다[조사]:

| Slack 필드 | 값 | 처분 |
|---|---|---|
| `title` | `str(issue)` | 허용 |
| `title_link` | `GLITCHTIP_DOMAIN` 링크 | 허용 — Access 뒤라 외부인에게 무용 |
| `text` | **`issue.culprit`** | ⚠️ §5.3의 **경로 상대화가 여기 그대로 반영된다.** 실패하면 `/home/mooner92/…`가 Slack에 남는다 |
| `fields[]` | 프로젝트명 + **tags(`server_name` 명시 포함)** | ⚠️ **`serverName: "keiwi-console"` 필수.** 기본은 `os.hostname()` = **`data05lx`** → 별칭 강제는 선택이 아니라 **반출 경계 조건**이다. 프로젝트명에 IP·호스트명 금지 |

### 5.3 판정이 바뀐/새로 발견된 행 (sentry.md §6.1 델타)

| 필드 | sentry.md 판정 | **이 스펙의 판정** | 왜 |
|---|---|---|---|
| **`exception` cause 체인** | 언급 없음 | **IP 마스킹 필수** `/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g → <ip>` | `linkedErrorsIntegration`이 **기본 on**. undici `fetch failed`의 cause가 `connect ECONNREFUSED 192.168.1.105:9090`이다 → **우리가 가장 보고 싶은 에러가 곧 내부 IP 반출 경로다.** 자체호스팅도 Slack `culprit`으로 새어 완화되지 않는다 |
| `enableLogs` | `false`(Sentry Logs 기각이라 무의미) | **`false` — 더 위험해서 끈다** | GlitchTip은 `log`·`otel_log`를 **지원**한다 → 켜면 정말 저장된다 |
| `enableMetrics` | `false`(§I-3) | **`false` — 게다가 폐기된다** | `trace_metric` ∈ `IgnoredItemType` → 보내도 버려진다 |
| `sendClientReports` | 언급 없음 | **`false`** | `client_report` ∈ `IgnoredItemType` |
| 세션(`browserSessionIntegration`) | 언급 없음 | **integration 제거 + `autoSessionTracking: false`** | `session` ∈ `IgnoredItemType`, 업스트림이 **명시적으로 거부**("no plan to implement sessions"). 안 끄면 `Not Implemented` 응답이 로그에 쌓인다 |
| `denyUrls` | Grafana 패턴 포함 | **브라우저 확장 패턴만** — Grafana 제거 | 크로스 오리진이라 도달하지 않는다(§README 3). 그리고 자체호스팅엔 쿼터가 없다 |
| 소스맵 | "업로드 OFF" | **`sourcemaps: { disable: true }` + `telemetry: false` + `release: {create:false, finalize:false}`** | `deleteSourcemapsAfterUpload: true`는 **"업로드 후 로컬 삭제"**이지 업로드 차단이 아니다. `telemetry` 기본 `true`는 플러그인 오류·성능 데이터를 sentry.io로 보낸다 — `sentryUrl` 미설정 시 기본이 `https://sentry.io/`다. **egress 0을 기본값 추론에 맡기지 않는다** |
| `maxValueLength` | 500 | **500 — 단 AC-E-6에서 실측 확인** | 기본값이 문서에 명시돼 있지 않다[미확인] |
| `tracesSampleRate` | 0 | **0** | ①성능=Prometheus ②span에 내부 URL·질의 = 반출면 확대 ③GV-8의 크래시가 OTel 경로 버그다 — 끄면 노출면과 크래시 표면이 함께 줄어든다 |
| **OS 계정명** | "절대 금지" | **동일 + 구조적 근거** | `lib/prometheus.ts`의 `GpuModel.user`·`ListeningPort.user`가 **동료 실명**이다. `tags`·`extra` 화이트리스트가 유일한 방어 |

### 5.4 `beforeSend`는 화이트리스트 재구성으로 짠다

삭제 나열(`delete a; delete b; …`)로 짜지 않는다. SDK가 새 필드를 추가하면 **자동으로 샌다.**

- `event.request` → `{url: url.split("?")[0], method}`로 **재조립**(headers·cookies·data·query_string 소멸)
- `event.tags` → `Object.entries(...).filter(([k]) => ALLOW.has(k))` (`ALLOW = {route, runtime}`)
- `event.breadcrumbs` → `category: http|fetch` 필터 + `data: undefined`
- 프레임 → `pre_context`·`context_line`·`post_context`·`vars`·`abs_path` 삭제, `filename`은 `apps/console/` 이후로 상대화
- `event.contexts` → `runtime`만 남긴다(`os`·`device` 삭제 — 커널 `6.8.0-117`·RAM 256 GB는 정찰 정보)
- `event.modules`·`event.user` 삭제

### 5.5 GlitchTip 서버측 2차 방어 — 기본이 OFF다

`apps/event_ingest/pii_scrubber.py`의 `ScrubConfig.enabled` **기본 `False`**[조사].

- 활성화: `GLITCHTIP_PII_SCRUB_DEFAULT`에 `{"enabled":true,"scrub_emails":true,"sensitive_keys":["user","cmdline","pid","query","message"]}`
- 기본 denylist: `password/secret/auth/bearer/token/session/cookie/csrf` + whole-key `authorization/apikey/sessionid/setcookie/xforwardedfor/privatekey`
- 범위 `EVENT_SECTIONS`(request·extra·user·contexts·breadcrumbs·exception·threads·tags·logentry·message·csp·spans) 내부를 **완전 재귀** → breadcrumb `data`·frame `vars`까지 도달

**2단 방어를 둘 다 켠다**: `beforeSend`(클라이언트에서 우회 가능) + 서버 스크러버(`beforeSend`를 리팩터링하다 조용히 풀릴 때의 그물). `sensitive_keys`에 **`user`가 들어가는 것이 핵심** — OS 계정명 방어의 두 번째 겹이다. 키 이름은 **GV-2로 확인 후** 넣는다.

---

## 6. Dead man's switch — GlitchTip Heartbeat

### 6.1 Sentry Crons 문법은 작동하지 않는다 — 명시적 금지

| 금지 | 왜 |
|---|---|
| `Sentry.captureCheckIn()` / cron 래퍼 / `monitor_config` 업서트 | `check_in` ∈ `IgnoredItemType`[조사] → **200을 받고 조용히 폐기된다.** "200 받았으니 됐다"로 오판하기 쉬운 형태 — 이번 세션 실패 패턴③과 동형 |
| `?status=error` 상당의 실패 신호 | heartbeat API에 **status 파라미터가 없다.** 비정상은 **부재로만** 표현한다 |
| 사유·수치·호스트명을 URL·body에 담기 | **body는 읽히지도 않는다.** 판정은 로컬, 전송은 "보낼지 말지"뿐 |

### 6.2 형식과 타이밍 — 유예시간이 없다

```
POST {GLITCHTIP_DOMAIN}/api/0/organizations/<org-slug>/heartbeat_check/<endpoint_id-uuid>/
```
`auth=None`(UUID가 유일한 시크릿) · **POST 전용**(GET 데코레이터 없음) · 응답 `MonitorCheckSchema`[조사]. **문서에 없는 경로이므로 GV-3으로 UI 표시값과 문자 대조한다.**

판정 로직[조사]: `interval` 초 안에 체크인이 **1건이라도 있으면 up**. `dispatch_checks`가 1초마다 돌며 `(tick + id) % interval == 0`으로 monitor를 평가한다.
⇒ **`interval` 자체가 유일한 허용 오차다. 별도 grace period가 없다.**

| 파라미터 | 값 | 근거 |
|---|---|---|
| 송신 주기 | **120초** | `interval`의 **1/5**. 단발 실패(일시적 OpenSearch 타임아웃)로 창이 비지 않는다 |
| `interval` | **600초** | 아래 지연 계산 |
| `confirmation_threshold` | **2** | 연속 2회 실패 후 down 판정. 오발화 억제(기본 1) |
| `timeout`·`expected_status` | heartbeat엔 무의미 | 이 필드는 GET/POST monitor용 |

**탐지 지연 계산(수치로 말한다)**

| 구간 | 시간 |
|---|---|
| 신선도 판정 창(스크립트가 "10분 이내"를 보므로 최대 이만큼 늦게 멈춘다) | ~600 s |
| 첫 실패 평가 | +600 ~ 1,200 s |
| `confirmation_threshold: 2`의 두 번째 평가 | +600 s |
| **합계** | **30 ~ 40분** |

> [!NOTE]
> **30~40분이 느려 보이면 그것이 정확한 이해다.** 1차 탐지는 Grafana `LogIngestStalled`가 **10분**에 한다(라이브). heartbeat는 **"Grafana째로 죽었을 때"의 백스톱**이다. 5.7일 → 40분은 **205배 개선**이고, 이 장치의 목적은 최소 지연이 아니라 **부재의 탐지**다.

### 6.3 하트비트 카탈로그 v1 — 3개

| 우선 | monitor | 송신자(data05 systemd timer) | 판정 조건 | 잡히는 실패 |
|---|---|---|---|---|
| **1** | `keiwi-log-ingest` | `keiwi-heartbeat-log-ingest.timer` | OpenSearch `keiwi-logs-*` 최신 `@timestamp`가 **10분 이내**일 때만 POST | **5.7일 사고 그 자체.** 인입 정체 + data05 사망 + 네트워크 단절을 하나로 |
| 2 | `keiwi-stack-alive` | `keiwi-heartbeat-stack.timer` | Prometheus `/-/healthy` **AND** Grafana `/api/health`가 둘 다 200일 때만 | **Grafana가 죽어 Grafana 알림이 못 뜨는 경우** |
| 3 | `keiwi-fleet-scrape` | `keiwi-heartbeat-scrape.timer` | `count(up==1) >= N`일 때만 | 전 노드 스크랩 소실 |

**설계 규칙 4개**
1. **판정은 로컬에서, 전송은 "보낼지 말지"만.** 사유·수치를 실어 보내지 않는다.
2. **콘솔을 송신자로 쓰지 않는다.** 요청 구동형 체크인은 "야간 무트래픽"과 "콘솔 사망"을 구분할 수 없다. 송신자는 **항상 systemd timer**.
3. **콘솔 생존은 GlitchTip의 GET monitor로 본다.** ⚠️ 이때 `…ALLOW_PRIVATE_IPS`를 **`True`로 켜야 한다** — 기본 `False`라 SSRF 가드가 사설 IP 모니터를 **조용히 `NETWORK` 실패**시킨다. 모르면 하루를 태운다(GV-2에서 정확한 키 이름 확정).
4. **배치는 `roles/watchdog`** — hardware-ops **T4-12**가 만드는 그 role이다. **새 role을 만들지 않는다.** Slack 관찰자와 나란히 들어가고, 둘은 대체가 아니라 직교한다.

### 6.4 정직해야 하는 부분 — 관찰자가 피관찰자와 같은 호스트다

data05가 죽으면 Logstash·Prometheus·Grafana·**GlitchTip이 함께** 죽고 아무 알림도 안 뜬다. 도입 이유가 무성 실패 탐지인데 그 케이스에서 무성이 된다.

**범위를 정확히 말한다**: 실제 5.7일 사고는 *filebeat 설정 오류로 인입만 멈춘 것*이고 data05는 살아 있었다 → `keiwi-log-ingest`가 **100% 잡는다**. 남는 구멍은 **"호스트 전체 사망"** 하나다.

**권고안 — data03 교차 관찰자(신규 egress 0)**

| 항목 | 내용 |
|---|---|
| 동작 | data03 systemd timer가 5분마다 GlitchTip `/_health/`(경로는 GV-2에서 확인) + Grafana `/api/health` 확인 → **3회 연속 실패 시 data03이 직접 `hooks.slack.com`에 1줄** |
| egress | **새 클래스 0.** 이미 승인된 Slack egress 예외(ADR-0018) 범위 안 |
| 미커버 | "data03 동시 사망" → Grafana `NodeDown`(라이브)이 잡는다 ⇒ **2-of-N** |
| 마찰 | 노드 계정·`:764`·NOPASSWD 적용 완료 상태[실측]라 접근 마찰 0 |
| 소속 | hardware-ops **T4-12**의 `roles/watchdog`에 항목 추가(신규 role 아님) |

**사외 1비트 외부 관찰자는 별건으로 남긴다.** "GlitchTip을 골랐으니 필요 없다"로 넘기지 않는다 — 기관 네트워크 단절은 위 어느 장치도 덮지 못한다(§10 Q3).

### 6.5 워커가 죽으면 탐지기가 죽는다

`dispatch_checks`는 **워커 경로에서 돈다**[조사]. `SERVER_ROLE: all_in_one`이라 web과 한 컨테이너지만, 내부 워커 루프가 멈추면 **web은 200을 주는데 down 판정이 안 일어난다.**

- **AC-E-11이 이 사실을 실증하고 문서화한다.** 무성 실패 탐지기가 무성으로 실패할 수 있다는 것을 런북에 적는다.
- 보완: `/metrics`를 Prometheus가 스크랩하므로(§2.3) `up{job="glitchtip"}`로 프로세스 생존은 Grafana가 본다. **워커 루프 생존을 나타내는 메트릭이 있는지는 [미확인]** → tasks E4-4에서 확인 후, 없으면 "heartbeat monitor의 `MonitorCheck` 행 수 증가"를 Grafana에서 감시하는 방안을 검토한다.

---

## 7. 실패 모드와 안전장치

| # | 실패 모드 | 이번 세션의 근거 | 안전장치 | 검증 |
|---|---|---|---|---|
| **F1** | **빈 시크릿이 스택을 내린다** | 빈 `SLACK_BOT_TOKEN` 하나가 **Grafana 전체를 기동 불가**로 만들었다 | ① `check-env.sh`가 `up -d` **전에** 키 존재·길이·형식을 검사해 exit 1 ② **GV-5로 GlitchTip의 실제 거동을 먼저 측정** ③ compose 분리(§2.1)로 실패가 Grafana에 전파되지 않는다 | AC-E-2 |
| **F2** | **DSN 미설정이 콘솔 기동을 막는다** | `config/env.ts`가 fail-fast throw 패턴이다 — 그대로 복사하면 F1을 콘솔에 재현한다 | `getGlitchTipDsn(): string \| undefined` — throw 금지. 미설정 시 `Sentry.init`을 **호출하지 않고** 로그 1줄 | **AC-E-3**(미설정·빈값·깨진값 3회 기동) |
| **F3** | **GlitchTip이 죽어 콘솔이 느려진다/막힌다** | — | SDK 전송은 비동기·fire-and-forget. 루프백이라 DNS·TLS 지연 없음. **전송 실패가 요청 경로를 블록하지 않는지 실측** | **AC-E-4**(컨테이너 정지 중 `/overview` 200 + p95 응답시간 무변화) |
| **F4** | **에러 폭주가 디스크를 먹는다** | — | ① `ignoreErrors`(`/^\[vllm\] HTTP 5\d\d$/` — vLLM 502는 이미 Grafana에서 본다 · `NEXT_NOT_FOUND`·`NEXT_REDIRECT` — Next 제어흐름 예외는 에러가 아니다) ② GlitchTip `event_throttle_rate` → **429 + Retry-After**(SaaS의 "쿼터 초과 시 조용한 드롭"이 없다 — 자체호스팅이 나은 지점) ③ `sampleRate: 1.0` 유지(에러가 희소하고 놓치면 도입 의미가 없다) | AC-E-17 |
| **F5** | **Slack 알림이 조용히 안 간다** | SNI 차단을 TCP만 보고 오판했다 | GV-4를 **눈으로 확인하는 게이트**로 못 박음. `GLITCHTIP_ALLOW_PRIVATE_IPS` 기본 `False`가 warning 로그만 남기고 차단하는 것을 명시 | AC-E-8 |
| **F6** | **heartbeat가 "보내지고 있다"는 착각** | 5.7일 사고의 본질(모든 존재 검증 통과) | **AC-E-10이 "보냈다"가 아니라 "안 보내면 울린다"를 검증한다.** timer를 정지시키고 40분 기다려 Slack 도착을 확인 | **AC-E-10** |
| **F7** | **워커 정지 = 탐지기 무성 실패** | §6.5 | 사실을 문서화 + `up{job="glitchtip"}` 감시 | AC-E-11 |
| **F8** | **최초 가입 개방(`ENABLE_USER_REGISTRATION` 기본 `True`)** | 기본값이 안전하지 않다[조사] | 첫 사용자 생성 **직후** `False`로 전환하고 재기동. 절차 게이트 | AC-E-9 |
| **F9** | **설정 드리프트 — GlitchTip 설정에 파일 프로비저닝이 없다** | ADR-0016 교훈(UI 수제는 재생성 시 소실) | 프로젝트·alert recipient·monitor는 **DB 안에만** 존재한다. 완화: ① `pg_dump` 일 1회(§2.6) ② `docs/runbooks/glitchtip-down.md`에 **UI 재구성 절차를 순서대로** 적어 재현 가능하게 | AC-E-18 |
| **F10** | **Turbopack 크래시로 콘솔 502** | #19367[조사] | ① `serverExternalPackages: ["@opentelemetry/api"]` 추가(비용 0) ② **GV-8 게이트** ③ 실패 시 **SDK 10.8.0 핀** + ADR 기록 ④ Turbopack에서 무효인 `disableLogger`·`automaticVercelMonitors`·`webpack.*`는 쓰지 않는다 | AC-E-14 |
| **F11** | **`withSentryConfig` 래핑이 기존 `next.config.ts`를 깬다** | `turbopack.root`·`allowedDevOrigins`가 깨지면 **하이드레이션이 죽고 화면은 멀쩡해 보인다**(파일 주석의 기존 사고) | 래핑 후 두 키가 최종 config에 남아 있는지 확인 + 브라우저에서 **클릭 동작**까지 확인 | AC-E-15 |

---

## 8. 수용 기준 (기계 검증)

> `<GT>` = `http://127.0.0.1:8090`, `<PID>` = GlitchTip 프로젝트 id, `<KEY>` = DSN public key.

| # | 검증 | 명령 / 기대 |
|---|---|---|
| **AC-E-1** | **compose 파싱**(GV-1) | `docker-compose -f /data/glitchtip/docker-compose.yml config >/dev/null && echo OK` → `OK`. anchor 파싱 실패 시 anchor를 전개한 변형으로 교체하고 그 사실을 파일 주석에 남긴다 |
| **AC-E-2** | **배포 전 env 검증**(F1) | `bash infra/error-tracking/scripts/check-env.sh /data/glitchtip/.env; echo rc=$?` → `rc=0`. 그리고 `SECRET_KEY=`를 빈 값으로 바꾸면 **`rc=1` + 어느 키가 문제인지 출력** |
| **AC-E-3** | **콘솔 부팅 안전성**(F2) | ① DSN 키 삭제 ② `GLITCHTIP_DSN=` ③ `GLITCHTIP_DSN=not-a-dsn` — 각각 `npm run build && npm run start` 후 `curl -o /dev/null -w '%{http_code}' localhost:3105/overview` → **3회 모두 200** + stderr에 비활성 로그 1줄, throw 0건 |
| **AC-E-4** | **GlitchTip 정지 시 콘솔 무영향**(F3) | `docker stop glitchtip-web` 후 의도적 500 유발 → 콘솔 프로세스 생존 + `/overview` **200** + 동일 라우트 p95가 정지 전 대비 **+100 ms 이내** |
| **AC-E-5** | **ingest 애플리케이션 응답**(TCP 아님) | `curl -s -o /dev/null -w '%{http_code}' -X POST "<GT>/api/<PID>/envelope/?sentry_key=<KEY>" --data-binary @envelope.txt` → **200**. 잘못된 key → **4xx**(둘 다 확인해야 통과) |
| **AC-E-6** | **페이로드 실측 — 이 스펙의 핵심 게이트** | tunnel 대상을 로컬 echo 서버로 돌려 원시 envelope를 덤프 → `grep -E '192\.168\.\|data05lx\|CF_Authorization\|Cookie\|/home/\|abs_path\|context_line\|"vars"\|modules\|query='` → **0 hit**. 동시에 `keiwi-console`과 상대 경로 `apps/console/`은 **존재**. `maxValueLength` 실효값 기록 |
| **AC-E-7** | **클라이언트 왕복 + 직행 금지** | Playwright(기존 devDep)로 의도적 throw → 네트워크 인터셉트에서 POST **1건**, 대상 호스트가 **우리 오리진**(GlitchTip 호스트 0건) + GlitchTip에 이슈 1건 |
| **AC-E-8** | **Slack 도달 + 필드 경계**(GV-4·F5) | recipient 저장 → `send_test_notification` → `#keiwi-web` 도착. 메시지에 `server_name=keiwi-console` **존재**, `data05lx`·`192.168.`·OS 계정명 **부재** |
| **AC-E-9** | **가입 차단**(F8) | 첫 사용자 생성 후 `ENABLE_USER_REGISTRATION=False` 재기동 → 가입 페이지 POST가 **거부**(4xx 또는 폼 미제공) |
| **AC-E-10** | **부재 탐지 실증 — 도입의 유일한 목적**(F6) | `systemctl stop keiwi-heartbeat-log-ingest.timer` → **40분 대기** → GlitchTip UI monitor가 **down** + `#keiwi-web`에 uptime 알림 도착. 이어서 timer 재시작 → **복구 알림** 도착 |
| **AC-E-11** | **워커 생존 의존성 문서화**(F7) | 워커 루프를 정지시킨 상태에서 AC-E-10 재실행 → **down 알림이 오지 않음을 확인하고 런북에 기록**. "안 온다"가 통과 조건이다 |
| **AC-E-12** | **정적 금지 규칙**(CI) | `bash apps/console/scripts/check-error-tracking.sh` → `OK`. 실패 규칙: `tunnelRoute` · `captureCheckIn` · `Sentry.setUser(` · `enableLogs:\s*true` · `includeLocalVariables:\s*true` · `autoSessionTracking:\s*true` · DSN 리터럴(`@[0-9.]+:8090/`) · `sourcemaps` 블록에 `disable: true` **부재** · `telemetry: false` **부재** |
| **AC-E-13** | **클라이언트 번들·로그 누출 0** | `grep -rl -E 'glitchtip\|sentry_key\|8090' apps/console/.next/static` → **0건**. `journalctl -u keiwi-heartbeat-* \| grep -c heartbeat_check` → **0**(UUID가 로그에 없다) |
| **AC-E-14** | **Turbopack 무크래시**(GV-8·F10) | `npm run build` 성공 + `npm run dev` 30초 후 전 라우트 200 + 로그에 `Maximum call stack size exceeded` **0건**. 실패 시 `@sentry/nextjs@10.8.0` 핀 + ADR-0022에 결과 기록 |
| **AC-E-15** | **기존 config 보존**(F11) | 래핑 후 `turbopack.root`·`allowedDevOrigins`가 최종 config에 존재 + Playwright로 `/overview`에서 **클릭 1회가 상태를 바꾼다**(하이드레이션 생존) |
| **AC-E-16** | **리소스 상한 실효** | `docker inspect glitchtip-web --format '{{.HostConfig.Memory}}'` → **0이 아님**. 0이면 compose 1.29에서 무시된 것 → `docker run` 플래그 또는 systemd 슬라이스로 대체하고 그 사실을 기록 |
| **AC-E-17** | **폭주 방어**(F4) | `ignoreErrors` 대상 에러를 100회 발생시켜 GlitchTip 이벤트 수 **증가 0**. 그리고 throttle 초과 시 응답이 **429**(조용한 200이 아님) |
| **AC-E-18** | **런북 + 재구성 절차**(F9) | `test -e docs/runbooks/glitchtip-heartbeat-missed.md && test -e docs/runbooks/glitchtip-down.md` → 둘 다 존재. 후자에 **프로젝트·recipient·monitor 3종 UI 재구성 순서**가 있다 |
| **AC-E-19** | **Prometheus 통합** | `curl -s 'http://localhost:9090/api/v1/query?query=up{job="glitchtip"}' \| grep -c '"value"' ≥ 1` → GlitchTip 프로세스 생존이 Grafana에서 보인다 |
| **AC-E-20** | **기존 검증 무회귀** | `npm run verify`(lint·typecheck·test·build·check:secrets·check:no-raw-hex + **check:error-tracking**) 통과 |

---

## 9. 기존 문서에 되돌려 반영할 것 (§7 드리프트=버그)

| 대상 | 반영 |
|---|---|
| `specs/observability-alerting/sentry.md` | §3.3(status=error) · §5.3(Crons 미확인) · §6.1(SaaS 전제) · §6.2(Grafana iframe 근거) — **정정 4건은 [README §4](./README.md#4-sentrymd에-되돌려-반영할-정정-4건-7-드리프트버그)의 표를 그대로 옮긴다.** 문서 상단에 "배치 결정은 ADR-0022로 종결" 명시 |
| `specs/alerting/spec.md` §3.0 | W1 관찰자 선택지에 **GlitchTip Heartbeat(자체호스팅, egress 0)** 추가. 기존 "외부 heartbeat 예외"보다 우선 |
| `specs/alerting/spec.md` §5 | 채널표에 **앱 에러 = SEV2 → `#keiwi-web`(GlitchTip webhook)** 행 추가 |
| `specs/hardware-ops/tasks.md` T4-12 | `roles/watchdog`에 **GlitchTip 헬스 체크 + data03 교차 관찰자** 항목 추가(신규 role 금지) |
| `docs/runbooks/log-ingestion-stopped.md` | dead man's switch 구현체를 `keiwi-log-ingest` heartbeat로 명시 + **탐지 지연 30~40분** 수치 |
| `apps/console/.env.example` | `GLITCHTIP_DSN`·`NEXT_PUBLIC_GLITCHTIP_DSN` 키 + "미설정이면 에러 트래킹만 비활성" 주석 |
| `infra/monitoring/prometheus.yml` | `glitchtip` job 1개(`172.18.0.1:8090`, `metrics_path: /metrics`) |

---

## 10. 결정 대기

| # | 질문 | 왜 게이트인가 | 분기 |
|---|---|---|---|
| **Q1** | 클라이언트 DSN을 **더미 + 수동 tunnel**로 갈 것인가, 실제 DSN을 브라우저에 노출할 것인가 | 후자는 CF Access 302로 이벤트가 **조용히 사라질 수 있다**(§5.1) | **권고: 더미 + tunnel.** AC-E-6/AC-E-7 결과로 확정 |
| **Q2** | `/api/assistant` 예외를 **완전 제외**할지, `request` 재구성만으로 충분한지 | ADR-0014 "어시스턴트 egress 0"을 문자 그대로 지키려면 제외가 맞다. 그러나 어시스턴트가 우리 앱에서 가장 깨지기 쉽다 | 제외 → `ignoreErrors`에 라우트 추가, 진단은 journald / 포함 → AC-E-6이 본문 부재를 실증해야 한다 |
| **Q3** | data05 전체 사망 대비: **data03 교차 관찰자**(권고, egress 0) / 사외 1비트 / 미커버 수용 | **명시적으로 하나 고른다.** "GlitchTip으로 해결됐다"는 사실이 아니다(§6.4) | 권고 = data03 교차 관찰자. 사외 1비트는 별건 백로그 |
| **Q4** | 소스맵을 GlitchTip에 업로드할지 | 사내 열람자 = Access 통과자 **전원** | **v1 OFF.** 스택 가독성이 실제로 부족하다고 판명된 뒤에 재검토 |
| **Q5** | 에러 이벤트 보존 90일을 그대로 둘지 | 보존 연장 = **열람 창 연장**(파일경로·내부 IP가 든 스택트레이스) | 권고 = 90일 유지. 업타임만 365일 |

---

## 11. 스코프 아웃

[README §6](./README.md#6-이-스펙이-하지-않는-것-스코프-아웃--암묵-누락-금지)에 있다. 여기서 반복하지 않는다.

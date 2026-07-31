# 에러 트래킹 — Tasks

> 권위: [spec.md](./spec.md) / [README](./README.md) / [ADR-0022](../../docs/decisions/0022-error-tracking-glitchtip.md). `[x]`=완료, `[ ]`=잔여.
> **`[server]` = 사람이 적용(§11).** 표시 없는 항목은 에이전트가 레포에 산출물을 **생성**하는 것까지다.
> 크기: **S**=반나절 이내 · **M**=1~3일 · **L**=1주+.

> [!CAUTION]
> **순서 원칙 — 가장 작은 검증부터, 한 번에 하나씩.**
> 이번 세션에 **프로비저닝 3파일을 동시에 투입해 Grafana를 죽였다**(불허 키 + 빈 토큰 + 잘못된 쿼리가 한꺼번에). 원인 분리에 3회의 재기동이 들었다.
> 그래서 이 순서는 **"측정 → 1개 투입 → 검증 → 다음"**이다. 두 항목을 같은 작업창에 묶는 것을 금지한다.
> 각 단계의 통과 조건은 spec §8의 `AC-E-*`이며, **AC가 통과하지 않으면 다음 단계로 가지 않는다.**

---

## E0 — 측정만 (컨테이너 0개 · 코드 0줄 · 되돌릴 것 0)

> 이 단계는 **아무것도 만들지 않는다.** spec §0의 게이트를 실측으로 채우는 것이 전부다. 결과는 ADR-0022의 "결과" 절에 기록한다.

- [x] **E0-1** `[server]` (S) **GV-6·GV-7 포트·런타임 실사** — `ss -ltnp | grep -E ':(8090|8091|5432)\b'` · `docker ps | grep -i cloudflare`. 산출물: ADR-0022에 3줄(8090 가용 여부 / cloudflared = 호스트|컨테이너 / 호스트 PG 점유 확인). **선행: 없음**
- [x] **E0-2** (S) **GV-2 env 키 사전 확인** — `glitchtip/settings.py`의 `env(...)` 호출부에서 우리가 쓸 키를 **전부** 대조. 특히 **`GLITCHTIP_ALLOW_PRIVATE_IPS` vs `GLITCHTIP_UPTIME_ALLOW_PRIVATE_IPS`**(조사에서 이름이 두 가지로 나타났다) · 보존 키 6종 · `GLITCHTIP_PII_SCRUB_DEFAULT` · `ALLOWED_HOSTS` · `/_health/` 경로. 산출물: **키 이름 확정 표**(존재/부재/정확한 스펠링). **선행: 없음.** 막고 있는 것: E1-1
- [x] **E0-3** (S) **정본 compose 샘플 고정** — `https://glitchtip.com/assets/compose.sample.yml`를 받아 `infra/error-tracking/upstream/compose.sample.yml`로 **원문 그대로 커밋**(diff 기준선). **선행: 없음**
- [x] **E0-4** (S) **`@sentry/nextjs` peerDeps 확인** — `npm view @sentry/nextjs peerDependencies` → `next: ^16.0.0-0` 포함 확인 + 설치는 하지 않는다. 산출물: 버전 1줄. **선행: 없음**

**E0 실측 결과 (2026-07-30):**
- **E0-1**: 호스트 PG는 `127.0.0.1:5432` 전용(브리지 무충돌·컨테이너 포트 미노출로 해소) · 8090/8091 미점유 · **cloudflared = 호스트 프로세스**(3개) → 터널 대상은 `127.0.0.1:8090`
- **E0-2**: "모순"이던 두 키는 **둘 다 실존** — `GLITCHTIP_ALLOW_PRIVATE_IPS`(일반)·`GLITCHTIP_UPTIME_ALLOW_PRIVATE_IPS`(uptime 전용, 우리가 쓸 것). `GLITCHTIP_PII_SCRUB_DEFAULT` 실존(값은 JSON, settings.py L249) · 보존 키 6종 실존 · 캐시는 `VALKEY_URL`이 정본 · `ENABLE_USER_REGISTRATION`+`ENABLE_OPEN_USER_REGISTRATION` 실존
- **E0-3**: 정본 고정 완료(`upstream/compose.sample.yml`) — postgres:18·valkey:9·glitchtip:6, anchor+merge key 구조
- **E0-4**: `@sentry/nextjs` **10.69.0**, peerDeps `next: ^13.2.0 || ^14.0 || ^15.0.0-rc.0 || ^16.0.0-0` → Next 16 공식 지원
- **GV-1 통과**: compose 1.29.2가 anchor·merge key·mem_limit·env 치환 전부 파싱(『config』 실측, 핵심 항목 7개 보존)

> [!NOTE]
> E0이 끝나면 "무엇을 쓸 수 있는지"가 확정된다. **E0 없이 E1을 시작하면 게이트②(존재하지 않는 키)를 재현한다.**

---

## E1 — GlitchTip 기동 (컨테이너 3개, 라이브 관제 스택 무접촉)

- [x] **E1-1** (S) `infra/error-tracking/docker-compose.yml` 생성 — spec §2.2의 변경 3건만 적용(PG 비밀번호 / 포트 2줄 바인드 / 호스트 포트 미노출), **E0-2에서 확인된 키만** 사용. `mem_limit` 3건. **선행: E0-1, E0-2, E0-3**
- [x] **E1-2** (S) `infra/error-tracking/.env.example` + `scripts/check-env.sh` 생성 — 키 목록만(값 0). 검사: 키 존재 · `SECRET_KEY` ≥ 64자 · 개행/따옴표 없음 · `GLITCHTIP_DOMAIN`이 `https://`. 검증: **AC-E-2**. **선행: E1-1**
- [x] **E1-3** `[server]` (S) **GV-1 파싱 게이트** — `/data/glitchtip/`에 복사 후 `docker-compose config`. 검증: **AC-E-1**. anchor 파싱 실패 시 전개 변형으로 교체하고 **이유를 파일 주석에 남긴다**. **선행: E1-2**
- [x] **E1-4** `[server]` (S) **GV-5 빈 시크릿 거동 측정** — 격리 프로젝트에서 `SECRET_KEY=`로 `up -d` → `docker logs`. **기동 실패인지 경고만인지 기록.** 이 결과가 `check-env.sh`의 강도를 정한다. **선행: E1-3**
- [x] **E1-5** `[server]` (S) **정상 기동** — `check-env.sh` 통과 후 `postgres` → 헬스 확인 → `web`·`valkey` 순서로. compose 1.29 recreate 시 `docker rm -f` 후 `up -d`. 검증: `curl -o /dev/null -w '%{http_code}' 127.0.0.1:8090` → 200 · **AC-E-16**(mem_limit 실효). **선행: E1-4**
- [ ] **E1-6** `[server]` (S) **첫 사용자 생성 → 즉시 `ENABLE_USER_REGISTRATION=False` → 재기동.** 검증: **AC-E-9**. **선행: E1-5.** ⚠️ 이 항목을 미루면 가입이 열린 상태로 남는다(기본값이 안전하지 않다)
- [ ] **E1-7** `[server]` (S) Cloudflare 터널 라우트 `glitchtip.excusa.uk` + Access 정책 — E0-1의 cloudflared 런타임 판정에 따라 대상 주소 결정. `grafana.excusa.uk`와 동일 패턴(§14). **선행: E1-5**
- [x] **E1-8** (S) `infra/monitoring/prometheus.yml`에 `glitchtip` job 1개 추가(`172.18.0.1:8090`). **레포만.** 검증: **AC-E-19**. **선행: E1-5**
- [ ] **E1-9** `[server]` (S) E1-8 라이브 반영 — 레포본을 `/data/monitoring/prometheus.yml`에 정렬 후 `docker compose restart prometheus`. **라이브 파일 직접 편집 금지(§12).** **선행: E1-8**

---

## E2 — Slack 1건 (알림 경로를 SDK보다 먼저 뚫는다)

> **왜 SDK보다 먼저인가**: 알림이 안 가는 것을 나중에 발견하면 "SDK가 문제인지 Slack이 문제인지" 두 변수가 섞인다. Slack 경로를 **먼저 1건으로 확정**해 두면, 이후 실패의 원인이 하나로 줄어든다.

- [x] **E2-1** `[server]` (S) Slack **incoming webhook** 발급(`#keiwi-web`) — Grafana의 bot token과 **다른 시크릿**이다(spec §3 NOTE). URL은 GlitchTip UI에만 입력, 레포·메모에 남기지 않는다. **선행: E1-6**
- [ ] **E2-2** `[server]` (S) **GV-4 실물 도달 게이트** — 프로젝트 1개(`keiwi-console`) 생성 → recipient `webhook` 저장 → `send_test_notification`. 검증: **AC-E-8**(`#keiwi-web` 도착 + `data05lx`·내부 IP 부재). **선행: E2-1.** ⚠️ **눈으로 확인하지 않고 다음으로 가지 않는다** — 실패 패턴③(TCP만 보고 판정) 재발 지점
- [ ] **E2-3** `[server]` (S) `ProjectAlert` 설정 — `timespan_minutes: 5`, `quantity: 1`, `uptime: True`. **선행: E2-2**
- [ ] **E2-4** `[server]` (S) **`GLITCHTIP_PII_SCRUB_DEFAULT` 활성**(E0-2에서 확인된 키 이름으로) — `sensitive_keys`에 `user`·`cmdline`·`pid`·`query`·`message`. 서버측 2차 방어(spec §5.5). **선행: E2-3**

---

## E3 — 콘솔 SDK (여기서만 코드가 늘어난다 — 한 번에 하나씩)

- [x] **E3-1** (S) **부팅 안전성 먼저** — `src/config/env.ts`에 `getGlitchTipDsn(): string | undefined` 추가(**throw 금지**) + `.env.example` 키 2개. **아직 `Sentry.init`은 없다.** 검증: **AC-E-3**이 이 시점에도 통과(SDK 없이도 통과해야 한다 = 기준선). **선행: E0-4**
- [x] **E3-2** (S) `@sentry/nextjs` 설치 + `next.config.ts`에 `withSentryConfig` 래핑 + `serverExternalPackages: ["@opentelemetry/api"]`. `sourcemaps:{disable:true}` · `telemetry:false` · `release:{create:false,finalize:false}`. **Turbopack에서 무효인 옵션 금지.** 검증: **AC-E-14**(#19367) · **AC-E-15**(`turbopack.root`·`allowedDevOrigins` 보존 + 클릭 동작). **선행: E3-1**
  - 실패 시: `@sentry/nextjs@10.8.0` 핀 → 재검증 → **ADR-0022에 결과 기록.** 최신 추격 금지
- [ ] **E3-3** (M) `sentry.server.config.ts` — `beforeSend` **화이트리스트 재구성**(spec §5.4) + `serverName: "keiwi-console"` + IP 마스킹 정규식 + `enableLogs:false`·`enableMetrics:false`·`sendClientReports:false`·`tracesSampleRate:0`·`maxValueLength:500`·`ignoreErrors`. **선행: E3-2**
- [ ] **E3-4** (S) **AC-E-6 페이로드 실측 — 이 단계의 관문.** tunnel/DSN 대상을 로컬 echo 서버로 향한 채 의도적 500 유발 → 원시 envelope 덤프 → grep. **선행: E3-3.** ⚠️ **여기를 통과하기 전에 실제 DSN을 넣지 않는다.** §3.2 표가 "가설"이라는 사실을 바이트로 판정하는 유일한 지점
- [ ] **E3-5** (S) `instrumentation.ts`(`register()` + `export const onRequestError = Sentry.captureRequestError`) + `sentry.edge.config.ts`. **`sentry.client.config.ts`를 만들지 않는다**(Next 16 + Turbopack은 auto-import 하지 않는다). **선행: E3-4**
- [ ] **E3-6** `[server]` (S) **AC-E-5 ingest 도달** — `curl -X POST "$GT/api/$PID/envelope/?sentry_key=$KEY"` → 200 + 잘못된 key → 4xx. **둘 다** 확인. **선행: E2-2, E3-5**
- [ ] **E3-7** `[server]` (S) **서버 왕복** — 동일 init 모듈을 import하는 **일회성 스크립트**에서 `captureException` → 60초 내 GlitchTip 이슈 1건 + **`#keiwi-web` 알림 1건**(= US-1 달성). **프로덕션에 셀프테스트 라우트를 남기지 않는다.** **선행: E3-6**
- [ ] **E3-8** (M) `instrumentation-client.ts` + `src/app/global-error.tsx`(신규) + `/monitoring` tunnel route handler(서버측 2차 화이트리스트·body 상한·자기 계측 제외·middleware negative matcher). `denyUrls`는 **브라우저 확장 패턴만**(Grafana 금지). 검증: **AC-E-7**(POST 대상 = 우리 오리진). **선행: E3-7**
- [ ] **E3-9** (S) `apps/console/scripts/check-error-tracking.sh` + `package.json`의 `verify`에 편입. 검증: **AC-E-12** · **AC-E-13** · **AC-E-20**. **선행: E3-8**
- [ ] **E3-10** `[server]` (S) **AC-E-4 격리 검증** — `docker stop glitchtip-web` 상태에서 콘솔 `/overview` 200 + p95 +100 ms 이내. **선행: E3-8**
- [ ] **E3-11** `[server]` (S) **AC-E-17 폭주 방어** — `ignoreErrors` 대상 100회 → 이벤트 증가 0 / throttle 초과 시 **429**. **선행: E3-7**

---

## E4 — Dead man's switch (5.7일 사고의 해법 — 여기가 목적지다)

- [ ] **E4-1** `[server]` (S) **GV-3 heartbeat URL 대조** — monitor `keiwi-log-ingest` 생성(`interval 600`, `confirmation_threshold 2`) → UI 표시 URL과 코드 도출 URL **문자 단위 diff** → `curl -X POST` **200 + `MonitorCheck` JSON**. **GET으로 시험하지 않는다.** **선행: E2-3**
- [ ] **E4-2** (S) `infra/ansible/roles/watchdog/templates/keiwi-heartbeat-log-ingest.sh.j2` + timer(120s) — OpenSearch 최신 `@timestamp` 판정을 **로컬에서** 하고 **정상일 때만 POST**. 사유·수치·호스트명 전송 금지. UUID는 `/etc/keiwi/heartbeat.env`(0600). **`roles/watchdog`은 hardware-ops T4-12의 role이다 — 새로 만들지 않는다.** **선행: E4-1**
- [ ] **E4-3** `[server]` (S) E4-2 배포 → 10분 관찰 → monitor **up**. 검증: **AC-E-13**(journald에 UUID 0건). **선행: E4-2**
- [ ] **E4-4** `[server]` (S) **AC-E-10 부재 탐지 실증 — 이 스펙 전체의 통과 조건.** `systemctl stop …timer` → **40분 대기** → monitor **down** + `#keiwi-web` 알림 → 재시작 → **복구 알림**. 그리고 **AC-E-11**(워커 정지 시 알림이 오지 **않는다**는 사실 기록). **선행: E4-3**
- [ ] **E4-5** (S) monitor 2·3 추가(`keiwi-stack-alive`·`keiwi-fleet-scrape`) — E4-2 스크립트 패턴 복제. **E4-4가 통과한 뒤에만.** **선행: E4-4**
- [ ] **E4-6** (M) **콘솔 생존 GET monitor** — ⚠️ `…ALLOW_PRIVATE_IPS`를 **`True`로** (E0-2에서 확정한 키 이름). 켜지 않으면 SSRF 가드가 **조용히 `NETWORK` 실패**시킨다. `confirmation_threshold 2`. **선행: E4-4**
- [ ] **E4-7** (M) **data03 교차 관찰자**(§10 Q3이 권고안으로 확정된 경우만) — data03 timer가 GlitchTip `/_health/` + Grafana `/api/health`를 5분 주기 확인, 3회 연속 실패 시 **data03이 직접 `hooks.slack.com`에 1줄.** hardware-ops **T4-12에 항목 추가**(신규 role 금지). **선행: E4-4, Q3 결정**

---

## E5 — 문서·백업·정리 (여기까지가 "끝났다")

- [ ] **E5-1** (S) 런북 2종 — `docs/runbooks/glitchtip-heartbeat-missed.md`(증상: down 알림 → 판별 3줄: timer 상태 / OpenSearch 신선도 / GlitchTip 워커 → 조치 → **오탐 판별법**) · `docs/runbooks/glitchtip-down.md`(**UI 재구성 순서**: 프로젝트 → recipient → monitor 3종, Slack 크레덴셜 2종의 차이). 검증: **AC-E-18**. **선행: E4-4**
- [ ] **E5-2** (S) 기존 문서 반영 7건(spec §9) — sentry.md 정정 4건 · alerting spec §3.0·§5 · hardware-ops tasks T4-12 · log-ingestion 런북 · `.env.example` · prometheus.yml. **선행: E4-4**
- [ ] **E5-3** `[server]` (S) `pg_dump` 일 1회 timer → `/data/backup/glitchtip/`(0600). ⚠️ **monitor UUID가 이 덤프에만 있다** — 잃으면 heartbeat 전부가 조용히 404를 받는다. **선행: E4-5**
- [ ] **E5-4** (S) ADR-0022 "결과" 절 갱신 — E0의 실측값 · GV-1~GV-8 통과/불통과 · SDK 버전(10.69.0 또는 10.8.0 핀) · 탐지 지연 실측치. **선행: E4-4**
- [ ] **E5-5** `[server]` (**2주 대기**) 운영 관찰 — 이벤트 종류·건수·오탐·디스크 증가. 판단 항목: `ignoreErrors` 추가 여부 / 보존 90일 유지 여부 / `#keiwi-web` 노이즈 수준. **선행: E5-1**

---

## 백로그 (게이트 미충족 또는 별건)

- [ ] **BE-01** 사외 1비트 외부 관찰자 — **기관 네트워크 단절**은 data03 교차 관찰자도 덮지 못한다. "GlitchTip을 골랐으니 필요 없다"는 사실이 아니다. 별도 ADR
- [ ] **BE-02** `mrkdown_in` 오타(Slack 정본은 `mrkdwn_in`) 업스트림 이슈 제출 — 표시 품질만. **포크하지 않는다**
- [ ] **BE-03** Slack 본문 하드코딩(`"GlitchTip Alert"`) 개선 — 업스트림 #429 추적. 모바일 푸시에 무엇이 터졌는지 안 보이는 문제
- [ ] **BE-04** 소스맵 업로드(Q4) — 열람자 = Access 통과자 전원이라는 사실을 먼저 정리
- [ ] **BE-05** GlitchTip 워커 루프 생존 메트릭 — `/metrics`에 있는지 확인(spec §6.5 [미확인]). 없으면 `MonitorCheck` 행 증가를 Grafana에서 감시
- [ ] **BE-06** `@sentry/nextjs` 내장 소스맵 업로드 동작 여부 — v1은 `disable:true`라 무관. 업로드를 켤 때만 필요
- [ ] **BE-07** 어시스턴트 라우트 완전 제외(Q2) 결정 — AC-E-6 결과에 따름

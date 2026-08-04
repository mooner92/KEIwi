# 에러 트래킹 — GlitchTip 자체호스팅 + 로그 인입 하트비트

관제 스택의 **앱 계층**을 담당한다. 메트릭(Prometheus)·로그(OpenSearch)가 인프라를 보는 동안,
여기는 콘솔 런타임 예외와 **"관측 스택 자체의 침묵"**을 본다.

- 결정: [ADR-0022](../../docs/decisions/0022-error-tracking-glitchtip.md) — Sentry.io 대신 자체호스팅
  (Slack 연동이 무료 티어에 없고, KEI 내부 스택트레이스를 외부로 보내지 않기 위해).
- 스펙: [`specs/error-tracking`](../../specs/error-tracking/README.md)

## 구성

| 경로 | 내용 |
| --- | --- |
| `docker-compose.yml` | GlitchTip 6.2.2(web·worker·PostgreSQL·Redis). 포트는 루프백 바인드 |
| `heartbeat/` | 로그 인입 dead man's switch — **정상일 때만** ping(5분). 신호 부재가 곧 장애 신호 |
| `scripts/` | 배포·점검 보조 |
| `upstream/` | 업스트림 참조본(비교용) |

## 왜 하트비트가 별도인가

Grafana 알림은 data05에서 돌고, 그 data05가 죽으면 알림도 죽는다. 하트비트는 **판정을
GlitchTip(외부 관점)에 맡겨** "신호가 오지 않는 것"을 장애로 본다 — Grafana가 죽어도 동작한다.
로그 인입 중단 탐지 시간이 **5.7일 → 약 40분**으로 줄었다.

남은 한계: GlitchTip도 data05에 있어 **호스트 전체 장애는 못 잡는다.**
그 위 계층은 [`specs/external-watchdog`](../../specs/external-watchdog/README.md)(제안 단계).

## 반출 정책

콘솔 예외는 `apps/console/src/lib/sentry-scrub.ts`가 **화이트리스트 재조립**으로 걸러 보낸다
(삭제 나열이 아니다 — SDK가 새 필드를 추가해도 모르는 필드는 기본 소멸).
원시 페이로드 게이트가 실측으로 검증한다(단위 테스트가 못 잡은 유출 2건을 이 게이트가 잡았다).

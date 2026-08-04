# ADR-0018 — 알림 엔진은 Grafana 통합 알림, 통지 채널은 Slack(egress 예외 1건)

- 상태: **채택 · 라이브**(2026-07-31 가동)
- 날짜: 결정 2026-07-30 · **기록 2026-08-04(사후)**
- 관련: [0008 로그 파이프라인](./0008-log-pipeline.md) · [0022 GlitchTip](./0022-error-tracking-glitchtip.md) · [`specs/alerting`](../../specs/alerting/spec.md)

> [!NOTE]
> **사후 기록(retroactive)이다.** 결정은 2026-07-30에 내려져 이미 라이브에서 돌고 있었는데
> ADR 파일이 없었다. 그런데 `specs/hardware-ops`·`error-tracking`·`observability-alerting`·
> `auto-remediation`과 ADR-0022까지 **7개 문서가 "ADR-0018"을 근거로 인용**하고 있었다
> — 죽은 참조였다(2026-08-04 `check-doc-index.sh` D4가 적발). 번호는 인용된 것을 따른다.

## 맥락

알림 계층이 0건이던 시기에 로그 인입이 **5.7일간 조용히 멈췄고 아무도 몰랐다**
(발견 경로는 알림이 아니라 우연한 조회). 알림을 세워야 했고, 두 가지를 정해야 했다:
**무엇이 알림을 평가하는가**(엔진)와 **어디로 보내는가**(채널).

## 결정 1 — 엔진: Grafana 통합 알림 (Alertmanager 별도 운용 안 함)

- 규칙·수신처·라우팅을 **파일 프로비저닝**으로 레포에 두고, 사람이 라이브에 복사한다(§11·§12).
- Prometheus `rules/`는 **recording 전용**이다 — `alert:` 키를 금지하고 게이트로 강제한다
  (`check-rules.sh --record-only`). 알림 정본이 둘로 갈리면 "어느 쪽이 진짜인가"를 잃는다.

**왜 Alertmanager를 따로 두지 않나**: 5노드·1인 규모에서 관제 스택이 하나 더 늘면
그 자체가 감시 대상이 된다. Grafana가 이미 대시보드·데이터소스·인증을 쥐고 있고,
알림 UI·침묵(silence)·라우팅이 내장이다. 운용 표면을 늘리지 않는 쪽을 택한다.

**대가**: Grafana 알림기의 한계를 그대로 받는다 — 특히 **Slack `thread_ts` 미지원**
(실측: `/api/alert-notifiers`). 발생→해결을 한 스레드로 묶으려면 중계가 필요하고,
그것이 [ADR-0025 alert-relay](./0025-alert-relay-webhook.md)의 출발점이 됐다.

## 결정 2 — 채널: Slack (egress 예외 1건, 명시 승인)

헌장 §I-1은 온프레미스 원칙이다. Slack 통지는 그 **예외**이며, 예외의 범위를 여기서 못박는다.

### 나가는 것 / 나가지 않는 것

| 나간다 | 나가지 않는다 |
| --- | --- |
| alertname · severity · 노드 식별자 · 현재값·임계 | 원문 로그 라인 |
| 시작 시각 · 요약 문장 | 연구자 계정·개인 경로·명령 원문 |
| 콘솔·대시보드·런북 **링크** | 스택트레이스·메트릭 덤프 |

링크는 Zero Trust 뒤라 외부인에겐 무용지물이고, 상세는 링크로 넘겨 **반출량 자체를 줄인다.**
이 상한은 이후 [`specs/alert-enrichment`](../../specs/alert-enrichment/README.md) §4.1과
`keiwi_redaction`이 코드로 강제한다.

### 웹훅이 아니라 bot token

웹훅 URL은 하나가 채널 하나에 고정돼 채널 수만큼 시크릿이 는다. bot token은 토큰 1개로
recipient만 바꿔 여러 채널에 보낼 수 있고 멘션도 된다. 토큰은 레포 밖(§13).

### ⚠️ 이 망은 `slack.com`을 SNI 차단한다 [실측 2026-07-30]

- `slack.com/api/api.test` → TLS 리셋(3/3 재현). **TCP는 열리는데 핸드셰이크가 죽는다.**
- `api.slack.com/api/api.test` → `{"ok":true}` 정상

Grafana 기본 엔드포인트가 `slack.com`이므로 `endpointUrl: https://api.slack.com/api/chat.postMessage`를
**반드시 명시**해야 한다. TCP 도달성만 보고 "Slack 안 막혔다"고 판단했다가 틀렸다 —
차단 판정은 TLS 레벨까지 확인한다.

## 대안과 기각 근거

| 대안 | 기각 이유 |
| --- | --- |
| 이메일(SMTP) | 사내 릴레이 필요·모바일 도달 느림·스레드 없음. 알림 피로에 취약 |
| Alertmanager 별도 | 위 "엔진" 항목 — 관제 스택 증가가 곧 감시 대상 증가 |
| 자체 알림 UI 구현 | §I-2(단일 콘솔=Grafana, 재구현 금지) 정면 위반 |
| Slack 없이 콘솔 배지만 | 사람이 콘솔을 안 보면 5.7일 사건이 그대로 재발한다 — **밀어내는 채널**이 필요 |

## 결과 (2026-08-04 기준)

- 규칙 14건 라이브(초기 9건 → SMART·위생 추가), 채널 2개(`#keiwi-infra`·`#keiwi-web`).
- **egress 예외는 이 1건으로 상한**을 삼는다. 이후 GlitchTip(ADR-0022)은 자체호스팅이라
  예외를 늘리지 않았고, 외부 watchdog(`specs/external-watchdog`)은 **별도 ADR로 정식 결정**해야 한다.
- 임계는 업계 기본값이 아니라 **자체 30일 분포**에서 뽑는다(`specs/alerting` §1) — 업계
  기본값(디스크 80%·메모리 10%·GPU 85°C)은 우리 baseline에서 셋 다 상시 발화한다[실측].

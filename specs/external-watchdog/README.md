# external-watchdog — 사이트 전체 침묵을 밖에서 잡는다 (L4)

> [!IMPORTANT]
> **상태: 제안(Draft).** 외부 SaaS 의존을 새로 도입하는 결정이므로 게이트(§9 질문 답변 + ADR-0023 채택) 통과 전
> 구현 착수 금지. 계정 생성·Slack 배선은 사람 작업(§11).

## 1. 문제 — 지금 감시 계층은 전부 "안"에 있다

현재 3계층이 서로 다른 실패 도메인을 덮지만, **셋 다 사이트 안에서 돈다**:

| 계층 | 감시 주체 | 위치 | 잡는 것 | 못 잡는 것 |
| --- | --- | --- | --- | --- |
| L1 | Grafana 알림 9건 | data05 | 노드·디스크·GPU·로그 인입 지표 | **data05 자신** |
| L2 | GlitchTip 하트비트 (dead man's switch) | data05 | 로그 파이프라인 침묵 (5.7일→40분) | **data05 호스트 장애** |
| L3 | 크로스노드 watchdog (hardware-ops T4-12, **미구현**) | data03 | data05 호스트 다운 | **사이트 전체 이벤트** |

L3까지 완성해도 남는 구멍: **전원·네트워크·인터넷 회선 등 사이트 단위 사건**이면 감시자와 피감시자가
함께 죽어 아무도 알리지 못한다.

### 이 걱정은 가설이 아니라 실적이다

2026-08-02 SEL 백필([`infra/monitoring/bmc/`](../../infra/monitoring/bmc/README.md))에서 실측:
**6년간 시설 전원(AC) 상실 4회, data03·data04 동시, 최장 57분.** 매번 PSU 이중화가 흡수해
무중단이었지만, 이중 급전이 모두 끊기는 사건·네트워크 절단·화재 대피 차단 등은 같은 회로 공유
구조에서 **전 플릿 동시 침묵**으로 나타난다. 그때 지금 체계는 아무것도 보내지 못한다.

## 2. 검토한 대안

### 2-1. "N번 서버가 (N+1), (N+2)를 감시하는 링" — 기각

| 이유 | 근거 |
| --- | --- |
| **GlitchTip은 watchdog 프리미티브가 아니다** | 노드당 web+worker+PostgreSQL+Redis ≈ 메모리 1.8GB. 에러 트래커를 감시자로 복제하는 것은 자원·운영 비용 대비 과잉 |
| **링을 완성해도 사이트 사건은 못 잡는다** | 링의 모든 노드가 같은 전원 회로·같은 회선 위에 있다 — 위 SEL 실측이 그 증거 |
| **플릿이 링을 만들 수 없는 구성이다** | data01은 16.04 EOL, data02는 Windows 미수집. 실질 링 후보는 3대뿐 |

크로스노드 감시 자체는 유효하다 — 다만 그 답은 링이 아니라 **T4-12(경량 timer 스크립트 1개)**이고,
이미 hardware-ops에 설계되어 있다. 이 스펙은 그 위의 L4만 다룬다.

### 2-2. 외부 서비스 비교 (전부 이 망에서 TLS 도달 실측 완료, 2026-08-02)

| 서비스 | 무료 티어 | Slack | 판정 |
| --- | --- | --- | --- |
| **Healthchecks.io** | **체크 20개**, 팀 3명 | **무료** | ✅ **채택 후보** — dead man's switch 전용 설계, 필요 기능이 전부 무료 |
| Sentry.io | cron 모니터 **1개** + uptime **1개**, 에러 5k/월 | **유료 잠금** (webhook 우회는 가능하나 비공식) | ❌ 기각 — 에러 트래킹은 이미 ADR-0022에서 같은 이유(Slack 유료)로 기각했고, DMS 용도로도 수량·기능이 열세 |
| UptimeRobot | 모니터 50개, 5분 간격 | 무료 | 🟡 보류 — outside-in 프로브(§5)용 보완재. 1차 범위 밖 |
| Cloudflare Worker cron | Workers 무료 티어 | webhook 자작 | ❌ 기각 — 자작 코드·상태 관리가 늘어 "감시자를 감시"하는 문제가 재귀함 |

> Sentry 무료로 "웬만하면 해결"은 **이 용도에는 성립하지 않는다** — 무료 cron 모니터가 1개뿐이라
> 2중 발신(§3) 설계가 불가능하고, Slack 통보가 유료 잠금이라 알림이 이메일로 격하된다.

## 3. 설계 — Healthchecks.io 체크 2개, 서로 다른 실패 도메인에서 발신

```text
data05 (관제 스택 호스트)          data03 (독립 노드)
  keiwi-l4-ping.timer 5분           keiwi-l4-ping.timer 5분
        │ POST (빈 본문)                  │ POST (빈 본문)
        ▼                                ▼
  hc-ping.com/<uuid-A>            hc-ping.com/<uuid-B>
        └────────── Healthchecks.io ──────────┘
                    grace 15분 초과 시 → Slack #keiwi-infra
```

- **무조건 발신(liveness)** — L2 하트비트와 달리 판정 없이 "타이머가 돌면 핑"한다.
  파이프라인 건강은 L2가 이미 판정한다. L4의 질문은 오직 **"이 호스트가 살아서 밖으로 나갈 수 있는가"**이고,
  판정 로직이 없을수록 자기 자신이 고장날 확률이 낮다.
- **2개 체크의 침묵 조합이 곧 진단이다**:

| A(data05) | B(data03) | 판정 | 1차 조치 |
| --- | --- | --- | --- |
| 침묵 | 정상 | data05 호스트/전원/모니터링 스택 | data03 경유로 data05 확인 |
| 정상 | 침묵 | data03 호스트 or 그 노드의 outbound | data05에서 data03 확인 |
| 침묵 | 침묵 | **사이트 사건**(전원·네트워크·회선) | 물리 확인 / 시설 문의 |

- 주기 5분 / grace 15분 — 기존 L2와 같은 논리(주기 2배 + 여유 1회로 지터 오탐 방지).
  일시 회선 플랩(1~2회 누락)은 grace가 흡수한다.

## 4. 반출 정책 — 무엇이 밖으로 나가나

이 설계가 외부에 노출하는 것 **전부**:

| 나가는 것 | 내용 |
| --- | --- |
| 핑 URL의 UUID | 무의미 난수 (계정에만 매핑) |
| 발신 시각 패턴 | "5분마다 무언가 살아 있음" |
| 발신 IP | KEI 공인 IP |

**호스트명·메트릭·로그·스택트레이스는 일절 나가지 않는다** (빈 본문 POST).
그럼에도 이것은 KEIwi 최초의 **상시 외부 SaaS 의존**이므로 ADR-0023으로 명시 채택해야 한다
(egress-0 원칙의 예외를 "생존 신호 1비트"로 한정하는 결정). UUID는 시크릿에 준해 레포 밖 관리(§13).

## 5. 이 설계의 한계 (정직하게)

- **Healthchecks.io 자체의 장애·오탐** — 제3자 SaaS를 신뢰 루트에 추가하는 것. 완화: grace 15분 + 체크 2개
  동시 오탐 확률은 낮음. 그들의 장애는 "오탐 알림"으로 나타나지 침묵으로 나타나지 않는다(안전한 방향).
- **outbound 정책 변화 리스크** — 이 망은 `slack.com`을 SNI 차단한 전례가 있다. `hc-ping.com`이 미래에
  차단되면 L4 전체가 상시 오탐이 된다. 완화: 차단 시 알림이 즉시 오므로(침묵→발화) 조용히 죽지는 않는다.
- **outside-in 프로브는 범위 밖** — `grafana.excusa.uk`를 밖에서 찔러 "터널·콘솔이 실제로 응답하나"를 보는
  것은 보완재다(UptimeRobot). 단 Cloudflare Access가 앞에 있어 익명 프로브는 엣지 302만 보고 원점을 못 본다 —
  Access 제외 `/healthz` 라우트 신설이 선행이라 별도 결정으로 미룬다.
- **판정 없는 liveness의 맹점** — 호스트는 살았는데 관제 스택만 죽은 경우 L4는 침묵하지 않는다.
  그건 L1~L3의 일이다. L4에 판정을 넣어 이 맹점을 메우려는 유혹은 §3의 단순성 원칙으로 거부한다.

## 6. 게이트 — 착수 전 답해야 할 질문

- [ ] **Q1.** 외부 SaaS 의존(생존 신호 1비트)을 승인하는가? → 승인 시 ADR-0023 작성
- [ ] **Q2.** 계정 생성·Slack 통합 연결(사람 작업, §11) — 누가 언제?
- [ ] **Q3.** 알림 채널 `#keiwi-infra` 확정? (사이트 사건은 인프라 소관이라는 판단)
- [ ] **Q4.** data03에 systemd timer 배포는 Ansible role로? (기존 `[server]` 절차 준수)

## 7. 태스크 (게이트 통과 후)

- [ ] **TW-1** (S) ADR-0023 작성 — 외부 생존 신호 채택, egress 예외 범위 한정
- [ ] **TW-2** (S) `infra/monitoring/l4-watchdog/` — `keiwi-l4-ping.{sh,service,timer}` (UUID는 `/etc/keiwi/` 레포 밖)
- [ ] **TW-3** (S) `[server]` Healthchecks.io 계정 + 체크 2개 생성 + Slack 통합 (grace 15분)
- [ ] **TW-4** (S) `[server]` data05·data03에 timer 배포 (data03은 Ansible, data05는 로컬)
- [ ] **TW-5** (S) 실증 — 한쪽 timer를 의도적으로 stop → 15분 내 Slack 수신 확인 → 기록
- [ ] **TW-6** (S) README·알림 문서에 L4 계층 추가, 런북에 §3 판정표 반영

## 참고

- 무료 티어 근거: [Sentry Pricing](https://sentry.io/pricing/) · [Last9 Sentry 분석](https://last9.io/blog/sentry-pricing/) · [Healthchecks.io 요금](https://www.capterra.com/p/249957/Healthchecksio/pricing/)
- 도달성 실측(2026-08-02): `sentry.io`·`hc-ping.com`·`healthchecks.io`·`api.uptimerobot.com` 전부 TLS 정상, data03에서도 `hc-ping.com` 301 확인
- 관련: [ADR-0022 GlitchTip](../../docs/decisions/0022-error-tracking-glitchtip.md) · [hardware-ops T4-12](../hardware-ops/tasks.md) · [L2 하트비트](../../infra/error-tracking/heartbeat/)

# 알림 상관 — SPEC (소음 억제 · 사건 객체)

> 계기: OpenObserve 조사(2026-08-16). 그쪽 도입은 기각했으나 **알림 모델 두 가지**는
> 우리 실제 결함과 맞물려 차용 가치가 있다고 판단했다 — ADR-0027(신설 예정) §대안.

## 0. 문제

**① 같은 원인이 채널에 반복 등장한다.** 현재 방어는 Grafana `notification-policies`의
`group_by` + `repeat_interval`인데, 그건 **라우팅 설정이지 중복제거가 아니다.** 규칙이
재평가될 때마다 새 메시지가 나가고, 사람은 "이미 아는 것"을 다시 읽는다.
실측: DatasourceNoData 10분 간격 반복(2026-08-11).

**② "사건"이라는 객체가 없다.** 알림은 낱개로 흐르고, 여러 알림이 하나의 원인에서
나왔다는 사실은 **사람 머릿속에만** 있다. 실측(2026-08-14 data04):

| 시각 | 알림 | 실제 |
|---|---|---|
| T+0 | `DiskUsageHigh` /home 98% | ← 하나의 사건 |
| T+0 | `DiskFillPredicted` 4일 내 소진 | ← 같은 사건 |
| T+2m | OOM kill (relay) | ← 같은 사건의 2차 효과 |
| T+4m | gunicorn WORKER TIMEOUT | ← 같은 사건의 3차 효과 |

네 건이 따로 흘렀고, 하나로 묶여 있었다면 **원인(한 계정 홈의 모델 저장소 121GB)까지의
거리가 훨씬 짧았을 것이다.** 실제로는 사람이 `du`를 여섯 번 돌려서 찾았다.

## 1. 이미 있는 것 / 없는 것

이 스펙이 **다시 만들지 않는 것**을 먼저 못박는다(`infra/alert-relay/alert_relay.py` 실측):

| 기능 | 상태 | 위치 |
|---|---|---|
| Grafana `fingerprint` → 스레드 귀속(발생·해결 한 스레드) | ✅ 있음 | `ThreadStore` |
| 동일 **배달** 중복 억제 300초(웹훅 재전송 방어) | ✅ 있음 | `DeliveryLedger` |
| 동일 지문 **재발화** 강등(새 메시지 → 스레드 답글) | ❌ 없음 | 이 스펙 C1 |
| 서로 다른 지문의 **사건 상관** | ❌ 없음 | 이 스펙 C2 |
| 사건 객체 · 콘솔 표면 | ❌ 없음 | 이 스펙 C3 |

`DeliveryLedger`는 **같은 배달이 두 번 오는 것**을 막지, **같은 문제가 계속 발화하는 것**을
막지 않는다. 둘은 다른 문제다.

## 2. 범위 경계

세 스펙이 알림을 다루므로 소유권을 명시한다:

- **`alert-enrichment`** — 알림 **1건의 내용 품질**(현재값·딥링크·스레드·귀속)
- **`alert-correlation`(이 스펙)** — 알림 **여러 건 사이의 관계**(재발화·상관·사건)
- **`auto-remediation`** — 사건에 대한 **조치**(L1 제안 · L2 실행)

사건 객체는 이 스펙이 소유하고, `auto-remediation`은 그것을 **소비**한다(제안의 단위가
알림 1건에서 사건 1건으로 올라간다 — 그쪽 B03 "few-shot 예시 풀"의 자연스러운 입력).

## 3. 비목표

- **ML 이상탐지** — 규칙 기반만. 근거를 설명할 수 없는 묶음은 이 스펙에서 만들지 않는다.
- **알림 규칙 자체의 재작성** — `alert-rules.yaml` 14규칙은 그대로 둔다.
- **신규 저장소·서비스** — relay의 기존 SQLite에 테이블을 더한다(§5).
- **OpenObserve 도입** — 기각(ADR-0027 신설 예정).

## 4. 설계

### C1 — 재발화 강등 (cooldown)

지문별 마지막 **채널 게시** 시각을 기록하고, 억제창(기본 30분) 안의 재발화는
**새 메시지 대신 원 스레드 답글**로 강등한다.

```
발화 → 지문 조회
  ├ 스레드 없음                      → 새 메시지 (지금과 동일)
  ├ 스레드 있음 · 억제창 밖          → 새 메시지 + 이전 스레드 링크
  └ 스레드 있음 · 억제창 안          → 스레드 답글 "N회째 (최초 HH:MM)"
```

**억제창을 Grafana가 아니라 relay에 두는 이유**: Grafana의 `repeat_interval`은 라우트
단위라 규칙마다 다른 창을 줄 수 없고, 무엇보다 **"몇 번째 재발인지"를 사람에게 보여줄
수 없다.** 5회째 재발과 1회째는 다른 정보다.

### C2 — 사건 상관 (correlation)

서로 다른 지문을 **선언적 규칙**으로 묶는다. 규칙은 코드가 아니라 데이터다:

```yaml
# infra/alert-relay/correlation.yaml (신규)
- id: disk-pressure-cascade
  when: {node: same, within: 15m}
  alerts: [DiskUsageHigh, DiskFillPredicted, OomKillOccurred]
  reason: "디스크 압박이 OOM·서비스 실패로 2차 전파"
  runbook: disk-pressure.md
```

`when.node: same` + `within` 이 상관의 전부다. **인과를 추론하지 않는다** — 선언된
조합이 같은 노드·같은 시간창에 나타났을 때만 묶는다.

### C3 — 사건 객체

```
incident = {id, opened_at, node, alerts[], state, correlation_id, thread_ts}
state ∈ {open, resolved}   # resolved = 구성 알림 전부 해소
```

콘솔 표면은 **기존 `/incidents` 라우트를 확장**한다(현재 어시스턴트 딥링크 대상).
신규 라우트를 만들지 않는다.

### C4 — 정직성 규약 (이 스펙의 핵심 제약)

**잘못 묶는 것이 안 묶는 것보다 위험하다.** 사건 하나로 접히면 그 안의 알림은 채널에서
사라지고, 오귀속이면 **진짜 문제가 은폐된다.** 따라서:

1. 상관은 **추정**임을 UI·Slack 양쪽에 명시한다("추정 연결 — 규칙 `disk-pressure-cascade`")
2. 묶임 여부와 무관하게 **각 알림의 원문은 스레드에 남는다**(접기는 채널 표면만)
3. 상관 규칙이 매칭에 실패하면 **낱개로 흐른다**(fail-open — 침묵보다 소음이 낫다)
4. `severity: critical`은 억제창을 무시한다(§C1 예외)

## 5. 저장

relay의 기존 SQLite(`/data/alert-relay/threads.db`)에 테이블 2개를 더한다.
**신규 인프라 의존성 0** — 이 스펙에 ADR이 필요 없는 이유다.

```sql
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, opened_at TEXT, node TEXT,
  correlation_id TEXT, thread_ts TEXT, state TEXT
);
CREATE TABLE IF NOT EXISTS incident_alerts (
  incident_id TEXT, fingerprint TEXT, first_at TEXT, count INTEGER,
  PRIMARY KEY (incident_id, fingerprint)
);
```

`ThreadStore`가 이미 쓰는 **메모리 티어 폴백 패턴**(sqlite가 받아주지 않은 것만 메모리)을
그대로 따른다 — DB가 죽어도 알림은 계속 나가야 한다.

## 6. 수용기준

| ID | 검증 | 통과 |
|---|---|---|
| **AC-1** | 동일 지문 5회 발화(억제창 내) | 채널 새 메시지 **1건** + 스레드 답글 4건, "5회째" 표기 |
| **AC-2** | 2026-08-14 data04 픽스처 리플레이(4알림) | 사건 **1건**으로 묶임 + 각 원문 스레드 잔존 |
| **AC-3** | 상관 규칙이 매칭 안 되는 조합 | 낱개 발송(fail-open) — **유실 0** |
| **AC-4** | `severity: critical` 재발화 | 억제창 무시하고 새 메시지 |
| **AC-5** | sqlite 파일 삭제 후 발화 | 메모리 티어로 계속 발송 |
| **AC-6** | 게이트: `correlation.yaml`의 alertname이 `alert-rules.yaml`에 실존 | 오타 규칙 검출 |
| **AC-7** | 게이트 자기검증(역증명) | 일부러 깨진 규칙을 심어 AC-6이 무는지 |

## 7. 선행조건 · 위험

**선행: E3 컷오버(`alert-enrichment` T-E3-6).** relay가 아직 **섀도**라 실채널 경로 밖에
있다. 이 스펙의 모든 산출물은 relay 안에서 동작하므로, **컷오버 전에는 실효가 0이다.**
구현은 먼저 할 수 있으나 **가치는 컷오버 시점에 발생한다.**

| 위험 | 대응 |
|---|---|
| 오귀속으로 사건 은폐 | C4-2(원문 스레드 잔존) · C4-3(fail-open) · C4-4(critical 예외) |
| 억제창이 길어 재발을 놓침 | 기본 30분 · 규칙별 override · "N회째" 표기로 빈도 노출 |
| 상관 규칙이 방치되어 낡음 | AC-6 게이트가 alertname 실존을 강제 |
| relay 장애가 알림 유실로 | C4-3 · AC-5 — relay는 **강등만** 하고 발송은 막지 않는다 |

## 8. 단계

| 단계 | 내용 | 크기 |
|---|---|---|
| **P0** | C1 재발화 강등 + AC-1·4·5 | S |
| **P1** | C2 상관 규칙 로더 + C3 사건 객체 + AC-2·3 | M |
| **P2** | 게이트(AC-6·7) + `/incidents` 콘솔 표면 | M |
| **P3** | `auto-remediation` 연결(제안 단위를 사건으로) | 보류 — L2 파일럿 후 |

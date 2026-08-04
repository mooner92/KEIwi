---
id: alert-relay-rollback
kind: procedure
category: infra
service: keiwi-alert-relay
status: active
first_seen: 2026-08-03
last_verified: 2026-08-03
# tier 1 = L1 제안까지. **알림 경로 자체를 고치는 런북**이라 자동화가 구조적으로 위험하다 —
#   자동 조치가 틀리면 그 실패를 알려 줄 채널이 방금 자기가 끊은 그 채널이다
#   (Facebook 2021: 복구 도구가 사라진 네트워크 안에 있었다 / spec §6). 그래서 상한은 1이고,
#   실행은 사람이 §0의 "지금 어느 단계인가"를 읽고 판단한 뒤에 한다.
tier: 1
actions:
  - id: check-relay-health
    title: relay 자체 건강 (db_ok·last_webhook_at·queue_depth)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -s -m 3 localhost:8130/healthz | python3 -m json.tool
  - id: restart-relay
    title: relay 재시작 (프로세스가 안 뜰 때)
    risk: medium
    reversible: true
    idempotent: true
    command: >-
      sudo systemctl restart keiwi-alert-relay
  - id: disable-enrichment
    title: 보강만 끄기 — 1차 알림 전달에는 영향 없음
    risk: medium
    reversible: true
    idempotent: true
    command: >-
      sudo sed -i 's/^#\{0,1\}RELAY_ENRICH=.*/RELAY_ENRICH=0/' /data/alert-relay/env
  - id: rollback-to-direct-slack
    title: 직송 복귀 — 컷오버 후 알림이 멈췄을 때의 최종 수단
    # 되돌릴 수는 있다(직전 백업을 같은 자리에 복사). 그러나 라이브 알림 라우팅을
    # 바꾸는 조치라 잘못 실행되면 알림이 통째로 사라진다 — 사람 판단 전용.
    risk: high
    reversible: true
    idempotent: true
    command: >-
      sudo cp infra/monitoring/grafana/rollback/contact-points.fallback.yaml
      /data/monitoring/grafana/provisioning/alerting/contact-points.yaml
---

# 런북 — alert-relay 롤백 / 장애 대응 (알림 경로 복구)

> **한 줄: 알림이 안 오면 원인을 찾기 전에 직송으로 되돌린다. 조사는 알림이 복구된 다음이다.**
>
> 정본 [specs/alert-enrichment §3.4](../../specs/alert-enrichment/spec.md) · 결정 [ADR-0025](../decisions/0025-alert-relay-webhook.md) · 서비스 [infra/alert-relay/README.md](../../infra/alert-relay/README.md)
>
> 표기 규약: `"<…>"` 자리표시자는 따옴표 안에 둔다(게이트 R10).

## 0. 지금 어느 단계인가 — 먼저 이것부터

| 단계 | 실채널(`#keiwi-infra`) 전달 주체 | relay가 죽으면 |
| --- | --- | --- |
| **섀도**(현재 기본) | **Grafana 직송** — relay와 무관 | `#keiwi-relay-test`만 조용해진다. **긴급 아님** |
| **컷오버 후** | **relay** | 실채널 알림이 멈춘다. **긴급 — §2로** |

```bash
systemctl is-active keiwi-alert-relay
grep -n 'RELAY_SLACK_CHANNEL' /data/alert-relay/env
grep -n 'name: slack-infra' -A 8 /data/monitoring/grafana/provisioning/alerting/contact-points.yaml
```

판독: `RELAY_SLACK_CHANNEL`이 `#keiwi-relay-test`이고 `slack-infra`의 `type:`이 `slack`이면
**아직 섀도**다(직송이 살아 있다). `slack-infra`가 webhook을 가리키면 컷오버 상태다.

## 1. 이 런북이 말하는 것 / 말하지 않는 것

- 말하는 것: relay가 **알림 경로**로서 실패했을 때의 복구. 전달 복구가 최우선이고 근본 원인은 그 다음이다.
- 말하지 않는 것: 답글 #1·#2(귀속·LLM 분석)의 품질 문제. 그건 장애가 아니라 **기능 저하**다 —
  `RELAY_ENRICH=0`으로 끄고(§4) 평상시처럼 다루면 된다.
- relay는 알림을 **만들지 않는다.** 규칙·임계는 여전히 Grafana 소관이다(`specs/alerting`).

## 2. 30초 판별 (복붙 가능한 명령만)

```bash
curl -s -m 3 localhost:8130/healthz | python3 -m json.tool
systemctl status keiwi-alert-relay --no-pager | head -20
journalctl -u keiwi-alert-relay -n 50 --no-pager
```

| 관찰 | 뜻 | 첫 조치 |
| --- | --- | --- |
| `/healthz` 200 + `db_ok: true` + 최근 `last_webhook_at` | relay는 정상, **웹훅이 안 온다** | §3-A(Grafana 쪽) |
| `/healthz` 200인데 `last_webhook_at`이 오래됨 | 라우팅·도달성 문제 | §3-A |
| `/healthz` 503 (`db_ok: false`) | sqlite 손상·권한·**디스크 풀**. ⚠️ **알림 전달은 계속되고 있다**(메모리 티어) — 503은 "죽었다"가 아니라 "디스크를 보라"다. 급하지만 롤백 사안은 아니다 | §3-C |
| `duplicates` 가 빠르게 증가 | Grafana가 재시도 중이다(응답 지연·5xx). 게시는 1회로 눌리고 있다 — **도배는 없다**. 원인은 Slack 지연이거나 relay 과부하 | §3-D · `queue_depth` 동시 확인 |
| 연결 거부 | 프로세스 다운 | §3-B |
| `queue_depth`가 계속 증가 | 어시스턴트가 느리거나 멈춤 — **1차 전달은 무사하다** | §4(보강만 끄기) |
| 로그에 `slack ... 최종 실패` | Slack 토큰·SNI·레이트리밋 | §3-D |

## 3. 조치 (파괴 강도 순)

### A. 웹훅이 도달하지 않는다 (relay는 정상)

```bash
docker exec grafana wget -qO- --timeout=3 http://host.docker.internal:8130/healthz || echo UNREACHABLE
docker logs grafana 2>&1 | tail -50 | grep -iE 'webhook|alert-relay|provision'
```

- `UNREACHABLE`이면 컨테이너→호스트 경로 문제다. `contact-points.relay.yaml`의 `url:`을
  도달 가능한 주소(`172.17.0.1` 등)로 바꾸고 Grafana를 재시작한다.
- 401이 로그에 보이면 공유 시크릿 불일치다 — `/data/alert-relay/env`와 `/data/monitoring/.env`의
  `RELAY_SHARED_SECRET`이 같은 값인지 확인한다(값을 화면에 찍지 말고 해시로 비교):

```bash
sudo awk -F= '/^RELAY_SHARED_SECRET=/{print $2}' /data/alert-relay/env | sha256sum
sudo awk -F= '/^RELAY_SHARED_SECRET=/{print $2}' /data/monitoring/.env | sha256sum
```

### B. 프로세스가 안 뜬다

```bash
sudo systemctl restart keiwi-alert-relay
sleep 2
curl -s -m 3 localhost:8130/healthz || journalctl -u keiwi-alert-relay -n 30 --no-pager
```

- `기동 거부 — 누락 env`가 보이면 시크릿 배선이 빠진 것이다(§13 경로 확인).
- `StartLimitBurst` 초과로 멈춰 있으면 `sudo systemctl reset-failed keiwi-alert-relay` 후 재시도.
- **2분 안에 안 살아나면 §5(롤백)로 간다.** 컷오버 상태에서 디버깅은 알림 공백을 늘릴 뿐이다.

### C. sqlite 문제

> **먼저 알아둘 것: 이 상태에서도 알림은 나가고 있다.** relay는 저장 실패를 흡수하고
> 메모리 티어로 계속한다(ADR-0025 보강 ①). 그러니 순서는 **① 디스크 확보 → ② DB 수리**이지
> 롤백이 아니다. `journalctl -u keiwi-alert-relay | grep 'sqlite .* 실패'` 로 사유를 먼저 본다.
> 가장 흔한 사유가 **디스크 풀**이고, 그건 십중팔구 지금 발화 중인 DiskUsageHigh 자체다.

```bash
df -h /data                                     # ← 사유 1순위
ls -l /data/alert-relay/threads.db
sudo -u keiwi-relay sqlite3 /data/alert-relay/threads.db 'pragma integrity_check;'
```

- 손상이면 **파일을 옮기고 재기동**한다. 잃는 것은 스레드 매핑뿐이다 —
  새 알림은 새 스레드로 정상 게시되고, 진행 중 알림의 해결 답글만 최상위로 나간다(설계된 폴백).

```bash
sudo systemctl stop keiwi-alert-relay
sudo -u keiwi-relay mv /data/alert-relay/threads.db "/data/alert-relay/threads.db.bad.$(date +%s)"
sudo systemctl start keiwi-alert-relay
```

### D. Slack 전송 실패

```bash
curl -s -m 5 -X POST https://api.slack.com/api/auth.test \
  -H "Authorization: Bearer $(sudo awk -F= '/^SLACK_BOT_TOKEN=/{print $2}' /data/alert-relay/env)" | head -c 200
```

- `{"ok":true...}`가 아니면 토큰 문제다. **`slack.com`이 아니라 `api.slack.com`**임을 반드시 확인한다
  (이 망은 `slack.com` SNI가 차단돼 있다 — 2026-07-30 실측).

## 4. 보강만 끄기 (전달은 유지)

답글 품질이 나쁘거나 GPU가 필요할 때. **알림 전달에는 영향이 없다.**

```bash
sudo sed -i 's/^#\{0,1\}RELAY_ENRICH=.*/RELAY_ENRICH=0/' /data/alert-relay/env
grep -c '^RELAY_ENRICH=0' /data/alert-relay/env
sudo systemctl restart keiwi-alert-relay
```

## 5. 롤백 — 직송 복귀 (목표 5분 이내)

**컷오버 후에만 필요하다.** 되돌리기 조건(ADR-0025): 섀도 게이트 실패 · 유실 발생 ·
유지 부담이 편익을 넘었다고 판단될 때.

```bash
sudo cp /data/monitoring/grafana/provisioning/alerting/contact-points.yaml \
        "/data/monitoring/grafana/provisioning/alerting/contact-points.yaml.pre-rollback.$(date +%s)"
sudo cp infra/monitoring/grafana/rollback/contact-points.fallback.yaml \
        /data/monitoring/grafana/provisioning/alerting/contact-points.yaml
sudo docker restart grafana
sleep 15
sudo docker logs grafana 2>&1 | tail -30 | grep -i 'provision.*err' || echo "PROVISION_OK"
```

그 다음 **도착을 눈으로 확인한다**(로그 없음 = 확인 아님):

```bash
echo "Grafana UI → Alerting → Contact points → slack-infra → Test 로 실제 메시지 도착 확인"
echo "소요 시간을 기록한다 (AC-E3-6: 5분 미만)"
```

relay는 굳이 멈추지 않아도 된다(라우팅이 사라지면 웹훅이 안 온다). 멈추려면:

```bash
sudo systemctl disable --now keiwi-alert-relay
```

**하지 말 것**: 롤백을 "임시로" 해놓고 기록하지 않는 것. 되돌린 이유와 시각을
ADR-0025의 되돌리기 기록에 남긴다 — 남기지 않으면 다음 사람이 같은 실험을 반복한다.

## 6. 사후·재발방지

- 유실이 있었나? `journalctl -u keiwi-alert-relay --since "<시각>"`의 웹훅 수신 건수와
  Grafana 로그의 발송 건수를 대조한다. 차이가 있으면 그 수를 섀도 게이트 기록에 남긴다.
- relay 다운을 **watchdog이 먼저 알렸나?** 사람이 먼저 알았다면 그것이 진짜 결함이다
  (`specs/external-watchdog` — `/healthz` 등록 확인).
- 같은 원인으로 두 번 롤백했다면 임계나 재시도를 만지지 말고 **구조**를 다시 본다
  (직송 유지 + 보강만 별도 채널이 더 나은 선택일 수 있다 — ADR-0025 대안 B).

## 관련

- [infra/alert-relay/README.md](../../infra/alert-relay/README.md) — 설치·계약·운영
- [ADR-0025](../decisions/0025-alert-relay-webhook.md) — 왜 중계를 도입했나 / 되돌리기 조건
- [specs/alert-enrichment](../../specs/alert-enrichment/README.md) — 사건·4단계·게이트
- [disk-pressure](./disk-pressure.md) — relay가 귀속 답글을 붙이는 대표 알림

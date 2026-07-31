# 로그 인입 하트비트 — dead man's switch

> 2026-07-24~30 로그가 **5.7일간 조용히 멈췄고 아무도 몰랐다.** 이 타이머가 그 재발을 막는다.
> 탐지 시간 5.7일 → **약 40분**(205배).

## 원리 — 부재가 신호다

```
5분마다: OpenSearch 최근 30분 유입 확인
  ├─ ≥100건(정상) ─> POST 하트비트 ─> GlitchTip "살아있음"
  └─ <100건 · 조회 실패 · 스크립트 자체 실패
                   ─> 아무것도 안 보냄
                   ─> 600초 후 GlitchTip이 Down 판정 ─> #keiwi-web
```

GlitchTip 하트비트에는 `status` 파라미터가 없다[정본 확인]. 실패를 **보고할 수단이 없고**
신호의 부재만이 장애 신호다. 그래서 판정을 스크립트가 하고 **정상일 때만** 보낸다.

이 구조 덕에 **스크립트가 죽어도, 타이머가 멈춰도, 서버가 꺼져도** 결과는 같다 — ping이
안 가고 알림이 뜬다. 안전한 방향으로 실패한다.

## Grafana `LogIngestStalled` 규칙과 중복인가

아니다. **같은 것을 다른 실패 도메인에서** 본다.

| | 감시 주체 | Grafana가 죽으면 | data05가 죽으면 |
| --- | --- | --- | --- |
| Grafana `LogIngestStalled` | Grafana 자신 | ❌ 함께 죽음 | ❌ |
| 이 하트비트 | GlitchTip | ✅ 동작 | ❌ (GlitchTip도 data05) |
| T4-12 크로스노드 watchdog(예정) | data03 | ✅ | ✅ |

> [!NOTE]
> **관측 시스템은 자기 자신의 죽음을 감지할 수 없다.** 이 하트비트는 *부분* 장애
> (Logstash만 정지 = 실제 겪은 유형)를 덮고, data05 전체 장애는
> [`specs/hardware-ops`](../../../specs/hardware-ops/tasks.md) T4-12의 몫이다.

## 배포 (사람, §11)

```bash
# ① 스크립트
sudo mkdir -p /opt/keiwi/heartbeat
sudo install -m 0755 -o root -g root keiwi-log-heartbeat.sh /opt/keiwi/heartbeat/

# ② 시크릿 — 하트비트 URL(레포 밖, §13). 반드시 로컬 주소 + POST.
#    UI가 알려주는 https://glitchtip.excusa.uk/... 는 터널(E1-7) 완료 전엔 도달 불가다.
sudo sh -c 'printf "하트비트 URL(로컬 형식): "; stty -echo; read -r U; stty echo; echo; printf "GLITCHTIP_HEARTBEAT_URL=%s\n" "$U" > /data/glitchtip/heartbeat.env; chmod 600 /data/glitchtip/heartbeat.env; printf "→ 저장 길이: %d자\n" "${#U}"'

# ③ 유닛
sudo install -m 0644 keiwi-log-heartbeat.service keiwi-log-heartbeat.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now keiwi-log-heartbeat.timer

# ④ 검증 — 즉시 1회 실행 후 로그 확인
sudo systemctl start keiwi-log-heartbeat.service
sudo journalctl -u keiwi-log-heartbeat -n 5 --no-pager
#    기대: "OK: 최근 30m NNNNN건 — 하트비트 전송(200)"
sudo systemctl list-timers keiwi-log-heartbeat.timer --no-pager
```

## 튜닝

| 값 | 기본 | 근거 |
| --- | --- | --- |
| ping 주기 | **5분** | 모니터 interval(600s)의 절반 — 한 번 걸러도 여유 1회 |
| 판정 창 | **30분** | 짧으면 순간 공백에 과민, 길면 탐지가 늦다 |
| 임계 | **100건** | 정상은 30분에 ≈27,500건[실측]. Grafana 규칙과 **같은 값**을 쓴다 — 두 경로의 판정이 갈리면 안 된다 |

환경변수로 덮어쓸 수 있다: `HEARTBEAT_WINDOW` · `HEARTBEAT_MIN_DOCS` · `OPENSEARCH_URL`.

## 검증된 시나리오 (2026-07-31 실측)

| 상황 | 동작 |
| --- | --- |
| 정상(27,325건) | 하트비트 전송 200 ✓ |
| 인입 정지 | ping 보류 ✓ |
| OpenSearch 불가 | ping 보류 ✓ |
| URL 미설정 | FATAL 로그 + exit 1 ✓ |

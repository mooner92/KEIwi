# alert-relay — Grafana webhook → Slack 스레드 + 비동기 보강

> 정본: [specs/alert-enrichment/spec.md §3](../../specs/alert-enrichment/spec.md) · 결정 근거 [ADR-0025](../../docs/decisions/0025-alert-relay-webhook.md) · 롤백 [docs/runbooks/alert-relay-rollback.md](../../docs/runbooks/alert-relay-rollback.md)

2026-08-03 첫 실전 알림이 남긴 요구 — "알림에 **분석과 귀속을 붙여라**" — 를 푸는
유일한 신규 서비스다. Grafana 13 Slack 알림기에 `thread_ts`가 없다는 실측이 출발점이고,
**중계가 원 메시지를 직접 게시하면 응답으로 `ts`를 쥔다**는 것이 해법이다.

```
Grafana ──webhook(JSON: labels·annotations·values·fingerprint·startsAt·
        │         title/message는 E1 템플릿으로 렌더된 상태)
        ▼
alert-relay (data05 · Python3 stdlib 전용 · systemd · :8130)
  1. 시크릿 검증 → 배달 멱등키 등록(메모리) → 즉시 chat.postMessage(렌더된 title+message
     그대로) → ts를 fingerprint와 함께 sqlite 저장(**실패해도 흡수**) → Grafana에 200
                                                            [동기 · LLM 무관 · 디스크 무관]
  2. (비동기) E4 결정적 수집기 → 스레드 답글 #1              [수 초]
  2b. (비동기) 디스크 알림이면 **사용자 통보 폼** → 스레드 답글 #1b [즉시]
  3. (비동기) POST :3105/api/assistant → 스레드 답글 #2      [1~3분]
  4. resolved 웹훅 → 같은 fingerprint의 ts로 "✅ 해결" 답글
egress: api.slack.com 하나 그대로. LLM은 로컬 vLLM. 신규 외부 통신 0.
```

## 왜 이렇게 만들었나 (읽지 않고 고치면 깨지는 것들)

| 결정 | 이유 |
| --- | --- |
| **동기 경로에 LLM이 없다** | 알림 전달이 vLLM에 의존하면 GPU가 바쁠 때 알림이 죽는다. 게시 → 200 → 그 다음에 비동기. vLLM이 꺼져 있어도 1차 전달은 무손실(AC-E3-2) |
| **메시지 정본은 E1 템플릿 한 곳** | payload의 렌더된 `title`/`message`를 **그대로** 올린다. relay가 다시 조립하면 포맷 정본이 둘이 되고 다음 사람은 어느 쪽을 고칠지 모른다 |
| **Slack 반출은 단일 함수** | `build_slack_payload()` 하나만이 Slack으로 나간다. 모든 텍스트가 여기서 `redact()`를 통과하고, 세탁 뒤에도 하드 규칙에 걸리면 **게시하지 않는다**. 게이트 P3가 우회 경로(별칭 포함)를 기계로 막는다 |
| **세탁 규칙은 E4와 공유** | `keiwi_redaction.py` **한 파일**을 relay와 수집기가 같이 쓴다. 방어가 두 벌이면 한쪽만 고쳐지고 그 비대칭이 사고다 — 실제로 relay 쪽이 URL·`~/`·허용목록 밖 절대경로·하드거부 4종에서 더 약했다[2026-08-04]. 게이트 P6이 "같은 객체인가"를 본다 |
| **`raw`는 경계에서 제거** | 수집기 JSON의 로컬 전용 필드는 `drop_local_only_fields()`가 지운 **사본**만 렌더러에 준다. "참조하지 말자"는 규율이 아니라 구조다(AC-E4-6) |
| **저장 실패 ≠ 전달 실패 ≠ 도배** | sqlite가 죽어도 게시는 되고 Grafana는 200을 받는다. 같은 배달은 `DeliveryLedger`(메모리)가 한 번만 게시한다. **디스크 풀이 곧 DiskUsageHigh** 라서 이 경로가 제일 중요하다 |
| **어시스턴트 실패는 조용히 생략** | Slack에 "분석 실패"를 도배하면 알림 신뢰가 죽는다. 실패는 relay 로그에만 |
| **디스크 알림엔 통보 폼(#1b)** | 90% 초과 발화 시 **복붙용 사용자 통보 문안**을 결정적으로 게시(`render_notice_form`). 수집 실패여도 낸다 — 알림이 이미 임계 초과를 증언한다. **자동 발송은 없다**: 사람에게 가는 통보는 사람이 `[ ]`를 채워 보낸다(§11과 같은 원리). owner는 E4가 이미 허용한 반출 필드 재사용 — 새 반출 없음 |
| **근거 0건이면 답글 #2 없음** | 근거 없는 LLM 문장은 헌장("근거 번호와 함께 출발점만")을 만족하지 못한다. 근거 번호 `[n]`은 relay가 결정적으로 붙인다 — LLM이 안 붙일 수 있다 |
| **재통지는 보강하지 않음** | `repeat_interval`(4h/12h)마다 같은 사건에 GPU를 태우고 같은 답을 쌓을 이유가 없다. `startsAt` 동일 = 같은 알림 인스턴스로 판정 |
| **stdlib 전용(pip 0)** | egress 최소·감사 용이·1인 유지보수. 게이트 P5가 강제 |

## 파일

| 파일 | 내용 |
| --- | --- |
| `alert_relay.py` | 서비스 전부(순수 함수 + sqlite + 멱등 원장 + Slack/어시스턴트 클라이언트 + 워커 + HTTP) |
| `keiwi_redaction.py` | **반출 세탁의 정본.** E4 수집기(`scripts/collectors/attribution_export.py`)가 같은 파일을 import 한다 — 사본이 아니라 공유다. 배포에서도 relay 옆에 함께 깐다 |
| `test_alert_relay.py` | 유닛테스트 48건. mock Slack·mock 어시스턴트를 **로컬 http.server로 띄운다** — 외부 통신 0 |
| `fixtures/` | Grafana webhook 픽스처 3종(firing·resolved·GPU) + E4 수집기 출력 계약 샘플 |
| `keiwi-alert-relay.service` | systemd 유닛(`Restart=always` + 하드닝) |
| `env.example` | 환경변수 예시. **실제 값은 `/data/alert-relay/env`(root:root 0600), 레포 밖**(§13) |
| `provisioning/contact-points.relay.yaml` | Grafana webhook 수신처 — 섀도 배포 때만 복사(디렉터리에 미리 두면 기동 실패 위험) |
| `remediation_l1.py` | **L1 조치 제안**(분류 → 런북 선택 → 정합 검증 → 제안). **실행 수단이 코드에 없다** — `check-remediation-l1.sh` L2·L8이 문법 수준에서 강제 |
| `remediation_l2.py` | **L2 승인 후 실행** — 이 레포에서 프로덕션 상태를 바꿀 수 있는 **유일한 파일**. 데몬이 아니라 CLI다([ADR-0026](../../docs/decisions/0026-auto-remediation-ladder.md)) |
| `test_remediation_l1.py` · `test_remediation_l2.py` | 유닛 47 + 50건. mock vLLM은 로컬 http.server, L2는 tempdir에서 `echo`·`touch`·`sleep` 만 **실제로** 돌린다 — 외부 통신 0 |

## 검증 (레포에서, 배포 없이)

```bash
bash scripts/gates/check-alert-relay.sh              # P1 유닛 · P2 프리셋정합 · P3 반출단일 · P4 raw · P5 stdlib · P6 방어공유+변이
bash scripts/gates/check-alert-relay.sh --self-test  # 역증명 — **게이트 본체의 탐지기**를 깨진 입력에 태운다
cd infra/alert-relay && python3 -m unittest test_alert_relay -v

bash scripts/gates/check-remediation-l1.sh           # L1~L8 (실행 권한 0 · 스키마 폐쇄 · 파서 ≡ PyYAML · L2 대리호출 금지)
bash scripts/gates/check-remediation-l2.sh           # M1~M9 (명령 비인자 · dry-run 기본 · 실행 1지점 · 원장 append-only)
bash scripts/gates/check-remediation-l2.sh --self-test
```

## 설치 (사람, 헌장 §11 — `[server]` T-E3-6)

```bash
# 0) 사용자·디렉터리
sudo useradd --system --home-dir /data/alert-relay --shell /usr/sbin/nologin keiwi-relay
sudo install -d -m 0750 -o keiwi-relay -g keiwi-relay /data/alert-relay
sudo install -d -m 0755 /opt/keiwi/alert-relay

# 1) 코드·유닛
#    ⚠️ keiwi_redaction.py 를 **함께** 깔아라. 없으면 relay 가 import 에서 죽는다(fail-closed).
#       수집기(E4)를 깔 때도 이 파일의 부모 디렉터리가 /opt/keiwi/alert-relay 여야 한다
#       — attribution_export.py 가 `collectors/ 의 부모`에서 이 모듈을 찾는다.
sudo install -m 0644 infra/alert-relay/alert_relay.py /opt/keiwi/alert-relay/
sudo install -m 0644 infra/alert-relay/keiwi_redaction.py /opt/keiwi/alert-relay/
sudo install -m 0644 infra/alert-relay/keiwi-alert-relay.service /etc/systemd/system/

# 2) 시크릿 (레포 밖 · §13). 값은 env.example 의 주석을 따른다.
sudo install -m 0600 -o root -g root /dev/null /data/alert-relay/env
sudo "${EDITOR:-vi}" /data/alert-relay/env

# 3) 기동 전 설정 점검 — 누락 env를 조용히 넘기지 않는다
sudo systemd-run --pipe --wait --property=EnvironmentFile=/data/alert-relay/env \
  /usr/bin/python3 /opt/keiwi/alert-relay/alert_relay.py --check-config

# 4) 기동
sudo systemctl daemon-reload
sudo systemctl enable --now keiwi-alert-relay
curl -s localhost:8130/healthz | python3 -m json.tool
```

### Grafana 쪽 배선 (섀도 S1)

1. `/data/monitoring/.env` 에 `RELAY_SHARED_SECRET=` (relay와 **같은 값**) 추가하고
   compose의 grafana `environment:` 에 `- RELAY_SHARED_SECRET=${RELAY_SHARED_SECRET}` 배선.
2. **도달성 먼저 확인** — Grafana는 컨테이너 안이라 `127.0.0.1`이 호스트가 아니다:

```bash
docker exec grafana wget -qO- http://host.docker.internal:8130/healthz || \
  docker exec grafana wget -qO- http://172.17.0.1:8130/healthz
```

3. 도달되는 주소로 `provisioning/contact-points.relay.yaml` 의 `url:` 을 확정하고 복사.
4. `notification-policies.yaml` 의 섀도 미러 라우트 주석을 해제(첫 `routes:` 항목).
5. `docker restart grafana && docker logs grafana 2>&1 | grep -i 'provision.*err'` → **0건**.

> ⚠️ 순서를 지켜라. 수신처가 없는데 라우트를 먼저 켜면 프로비저닝이 실패하고
> **Grafana가 뜨지 않는다**(inhibitionRules로 이미 겪은 사고 유형).

### ⚠️ 이름이 비슷한 env 두 개 (혼동 주의)

| env | 무엇을 막나 | 기본 |
| --- | --- | --- |
| `RELAY_DEDUP_WINDOW_SEC` | **같은 배달이 두 번 오는 것** — Grafana 웹훅 재전송·재시도 | 300 |
| `RELAY_COOLDOWN_SEC` | **같은 사건이 계속 재통지되는 것** — 창 안이면 스레드 답글로 강등 | 1800 |

둘은 다른 문제를 푼다. 전자가 없으면 한 번의 발화가 여러 메시지가 되고, 후자가 없으면
한 사건이 몇 시간 동안 채널을 채운다. 강등은 **보수적**이다 — 그룹에 새 알림이 섞였거나
`severity: critical` 이면 접지 않는다(spec `alert-correlation` §C4).

## L2 설치 (사람, 헌장 §11 — `[server]` T2-10)

> **먼저 읽어라: [ADR-0026](../../docs/decisions/0026-auto-remediation-ladder.md).**
> 이 절차는 이 플릿에서 **프로덕션 상태를 바꿀 수 있는 유일한 코드**를 설치한다.
> 에이전트는 여기까지 오지 않는다 — 코드 생성이 에이전트, 설치는 사람이다.

### 0) 무엇이 설치되지 **않는가** (이게 이 컴포넌트의 요점이다)

- **서비스가 아니다.** systemd 유닛이 없고, 포트를 열지 않고, 타이머도 없다.
  설치란 곧 **파일 3개를 놓고 sudoers 한 줄을 추가하는 것**이 전부다.
- **자격증명이 없다.** 상주 토큰도 서비스 계정도 없다. 권한은 **명령을 치는 사람의 sudo**다.
- 그래서 되돌리기는 **파일 삭제 + sudoers 항목 회수**로 끝난다. 중지할 서비스가 없다.

### 1) 코드

```bash
# relay와 같은 디렉터리다 — remediation_l2 는 remediation_l1 을, l1 은 keiwi_redaction 을
# **같은 디렉터리에서** import 한다(pip 0 · 경로 조작 0). 셋을 함께 깔아라.
sudo install -o keiwi -g keiwi -m 0644 \
  remediation_l1.py remediation_l2.py keiwi_redaction.py /opt/keiwi/alert-relay/

# 런북 코퍼스가 없으면 파이프는 전부 "매뉴얼 없음"으로 끝난다(죽지는 않는다).
# 레포 체크아웃을 읽게 하거나, 런북만 복사한 뒤 경로를 지정한다.
echo 'KEIWI_RUNBOOKS_DIR=/opt/keiwi/runbooks' | sudo tee -a /etc/environment
```

### 2) 감사 원장

```bash
sudo install -d -o keiwi -g keiwi -m 0700 /var/log/keiwi
# 파일 자체는 첫 기록 때 0600으로 만들어진다. 원장에는 명령 전문과 출력 꼬리가 들어간다.
```

- 기본 경로는 `/var/log/keiwi/remediation.jsonl`, `KEIWI_REMEDIATION_LEDGER` 로 바꿀 수 있다.
- **로테이션에 주의.** `logrotate` 의 `copytruncate` 는 append-only 가정을 깬다.
  `create` 방식(rename 후 새 파일)만 써라. 원장은 지우지 말고 **옮겨서 보관**한다.

### 3) sudo — 화이트리스트만, 전권 금지

런북 명령 중 `sudo` 가 붙은 것만, **정확한 문자열로** 허용한다. `ALL=(ALL) NOPASSWD: ALL`을
주면 이 설계의 안전 논증이 통째로 무의미해진다.

```sudoers
# /etc/sudoers.d/keiwi-remediation  (visudo -f 로 편집)
# tier≥2 런북의 명령만. 런북이 늘면 여기도 사람이 손으로 늘린다 —
# 그 마찰이 "무엇이 자동 실행 가능한가"를 사람이 한 번 더 보게 만든다.
keiwi ALL=(root) NOPASSWD: /usr/bin/docker restart keiwi-logstash
keiwi ALL=(root) NOPASSWD: /usr/bin/systemctl start keiwi-node-hygiene.service
keiwi ALL=(root) NOPASSWD: /usr/bin/systemctl enable --now keiwi-node-hygiene.timer
```

> 여기 없는 명령은 실행 시 rc≠0으로 실패하고 원장에 그대로 남는다. **조용히 성공한 척하지 않는다.**

### 4) OpenSearch 파생 뷰 (선택)

원장의 **쓰기** 경로는 로컬 파일이다(ADR-0026 — 로그 파이프라인을 고치는 조치의 감사를 그
파이프라인으로 보내지 않는다). 조회 편의를 위해 filebeat 입력을 하나 더한다:

```yaml
# filebeat.yml — 입력 추가. json 파싱만 하고 가공하지 않는다(원장이 정본).
- type: log
  paths: ["/var/log/keiwi/remediation.jsonl"]
  json.keys_under_root: true
  fields: {keiwi_index: "keiwi-remediation"}
```

배송이 끊겨도 원장은 온전하다 — 그것이 이 분리의 목적이다.

### 5) 첫 사용 (dry-run부터)

```bash
python3 /opt/keiwi/alert-relay/remediation_l2.py propose --alert LogIngestStalled --node data03
python3 /opt/keiwi/alert-relay/remediation_l2.py list
python3 /opt/keiwi/alert-relay/remediation_l2.py approve <proposal_id>          # dry-run
python3 /opt/keiwi/alert-relay/remediation_l2.py approve <proposal_id> --apply  # 실행
python3 /opt/keiwi/alert-relay/remediation_l2.py ledger --tail 20
```

- `approve` 는 **인자 없이는 실행하지 않는다.** `--apply` 가 유일한 실행 의사표시다.
- 제안은 기본 1시간 뒤 만료된다(`KEIWI_REMEDIATION_TTL`). 만료된 제안은 다시 받아라 —
  3일 전 제안을 오늘 승인하는 것은 승인이 아니라 추측이다.
- 편의상 `remctl` 로 심볼릭 링크를 걸어도 된다. 링크는 이름일 뿐 권한을 바꾸지 않는다.

### 6) 배치 — control plane은 관제 대상 밖 (§C4)

data05 터널을 고치는 런북을 data05에서 실행하면, 그 터널이 죽었을 때 승인도 실행도 못 한다
(Facebook 2021). L2를 어느 노드에 두든 **"이 노드가 죽어도 승인 경로가 남는가"**를 먼저 답하라.
현재 승인 경로가 **SSH 셸**이므로, 답은 곧 "그 노드에 SSH가 되는가"다.

## E3 ↔ E4 인터페이스 (수집기 계약)

relay는 수집기를 **만들지 않는다**(E4 T-E4-1 소관). 호출 계약만 고정한다:

```
<RELAY_COLLECTOR> --node <dataNN> --mount <path> --since <RFC3339> --json
  → stdout: {node, mount, usage_pct, collected_at,
             top_dirs[{path_category,owner,bytes,delta_bytes?}],
             recent_files[{bytes,mtime,owner,category}],
             sudo_commands[{ts,user,cwd_category,raw}], partial}
  → rc 0 만 채택. 그 밖(미배포·rc≠0·타임아웃·JSON 파싱 실패)은 **답글 #1 생략**.
```

- `raw`는 **로컬 전용**이다. relay가 파싱 직후 `drop_local_only_fields()`로 제거하므로
  Slack 빌더에 도달할 수 없다. 계약 샘플: `fixtures/collector-disk-attribution.json`.
- 대상 알림은 `DiskUsageHigh`·`DiskFillPredicted`. 그 외 알림은 답글 #2만 간다.
- 수집기가 없어도 E3는 성립한다 — 이 독립성이 두 축의 병행 개발을 가능하게 한다.

**계약 실측 (2026-08-03, 원격 접속 없이 리플레이로)** — E4 수집기 산출 JSON을 relay 렌더러에
그대로 통과시켜 사건 결론이 재현되는지 확인했다:

```bash
bash scripts/collectors/disk-attribution.sh \
  --replay scripts/collectors/fixtures/incident-2026-08-03-data04.raw --json --no-llm --no-snapshot \
  | python3 -c 'import json,sys; sys.path.insert(0,"infra/alert-relay"); import alert_relay as ar; \
d=ar.drop_local_only_fields(json.load(sys.stdin)); \
print(ar.build_slack_payload("#keiwi-relay-test", ar.render_attribution_reply(d, {"node":"data04","mount":"/"}))["text"])'
```

결과: `Python 환경 ×35, 합 14.0G (소유 user6, 17:42~17:51)` — 수동 30분 추적과 같은 결론이,
`COMMAND=`·`/home/<user>/…` 0건으로. 다만 수집기도 자체 Slack 문안을 만든다
(`attribution_export.py`) — **렌더러가 둘**이므로 T-E4-4에서 하나로 정리해야 한다.
그 사이의 위험(두 문이 서로 다르게 늙는 것)은 2026-08-04에 **세탁 규칙만 먼저 합쳐** 줄였다:
문장을 조립하는 코드는 아직 둘이지만, 그 결과가 통과하는 정규식·허용목록·하드 거부는
`keiwi_redaction.py` 하나다. 게이트 P6(relay 쪽)과 R6(E4 쪽)이 양방향 경계를 본다.

## 운영

| 상황 | 확인 |
| --- | --- |
| 살아 있나 | `curl -s localhost:8130/healthz` — `db_ok`·`db_error`·`last_webhook_at`·`queue_depth`·`duplicates`·`errors` 포함. 프로세스 생존과 **일이 되고 있음**은 다르다 |
| `db_ok:false` 인데 알림은 온다 | 정상 동작이다. 저장이 죽어도 전달은 계속한다(메모리 티어) — 503은 "죽었다"가 아니라 **"디스크를 보라"** 는 신호다. 재시작하면 스레드 연속성만 끊긴다 |
| 링크가 사라진다 | `journalctl -u keiwi-alert-relay \| grep '링크 삭제'` — 허용 호스트 밖이면 통째로 지운다. 콘솔·Grafana 주소를 바꿨다면 `RELAY_ALLOWED_URL_HOSTS` 를 함께 고쳐라 |
| 답글이 "검열됨"으로 나온다 | 하드 규칙(원문 경로·`COMMAND=`)이 본문에 남았다는 뜻이다. 1차 전달만 폴백 본문으로 나가고 보강 답글은 아예 생략된다 — 사유는 로그에 `반출 차단` 으로 남는다 |
| 답글이 안 붙는다 | `journalctl -u keiwi-alert-relay -n 100` — 어시스턴트 429/502 재시도·수집기 미배포는 전부 로그에 남는다(Slack에는 안 남긴다) |
| 스레드가 갈린다 | `sqlite3 /data/alert-relay/threads.db 'select * from threads order by last_seen desc limit 5'` |
| 보강만 끄고 싶다 | env `RELAY_ENRICH=0` → restart. 1차 전달만 남는다 |
| 같은 알림이 채널에 반복된다 | 정상이 아니다 — 재발화는 스레드 답글로 접힌다(`🔁 재발화 N회째`). `curl -s localhost:8130/healthz` 의 `demoted` 가 0이면 강등이 안 걸린 것이다 |
| 재발화 강등을 끄고 싶다 | env `RELAY_COOLDOWN_SEC=0` → restart. 종전 동작(항상 최상위)으로 돌아간다 |
| 되돌린다 | [docs/runbooks/alert-relay-rollback.md](../../docs/runbooks/alert-relay-rollback.md) — 파일 1개 복사(<5분) |

## 알려진 한계 (정직하게)

- **컷오버 후 relay가 죽으면 Slack 알림이 멈춘다.** 그래서 섀도 2주·watchdog·롤백 1파일·
  stdlib 소형 코드 4중 완화를 의무로 한다(spec §3.4). 이 긴장은 없어지지 않는다.
- HMAC 서명 대상 문자열은 **[검증 필요]** — 세 형태를 모두 허용한다(셋 다 시크릿이 있어야
  만들 수 있어 강도는 같다). 섀도에서 실제 헤더를 보고 하나로 좁힌다.
- Grafana의 웹훅 재시도 정책은 **[가설]**이다. relay 재기동(수 초) 중 발화가 흡수되는지는
  섀도 기간 kill 테스트로 실측한다(T-E3-6).
- 웹훅 픽스처는 2026-08 시점 형태다. Grafana가 payload 스키마를 바꾸면 픽스처도 바꿔야 한다.
- **멱등 원장은 프로세스 메모리다.** relay 재시작 직후(수 초)의 Grafana 재시도는 중복 게시가
  될 수 있다. sqlite 예약을 택하지 않은 이유는 그 반대편이 더 나쁘기 때문이다 — 디스크가
  차면 **알림 자체가 사라진다**. 전달 무손실이 상위 계약이다(§3.2-1).
- **링크 허용목록은 fail-closed 다.** 배선 실수(호스트 변경 후 env 미갱신)면 딥링크가
  조용히 사라지는 대신 WARNING 로그가 남는다. 로그를 안 보면 몇 주 뒤에 안다.
- 게이트 P3/P4는 정적 검사라 **작정한 우회**(이름 계산·다른 파일에서 게시)를 못 잡는다.
  실질 방어는 게시 직전 하드 거부와 `drop_local_only_fields` 경계다 —
  `scripts/gates/check-alert-relay.sh` 머리말에 못 잡는 것 목록이 있다.

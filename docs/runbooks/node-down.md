---
id: node-down
kind: alert
alerts: [NodeDown]
service: node-exporter
category: infra
severity: critical
affected_nodes: [data01, data03, data04, data05]
last_verified: 2026-08-03
# tier 0 = 사람 전용. spec §1: NodeDown의 원인은 물리·전원·네트워크이고 blast가 최고다.
#   게다가 이 알림은 세 상태(노드 down / exporter down / 경로 down)를 구분하지 못한다 —
#   **분기 자체가 사람의 판정**이라 어떤 자동 조치도 첫 단계에서 틀릴 수 있다.
#   아래 actions는 전부 읽기 전용 판별이고, 복구 명령은 판정이 끝난 뒤 각 분기 런북이 맡는다.
tier: 0
actions:
  - id: check-all-targets
    title: 전체 스크랩 타깃 상태 (한 노드의 여러 job 동시 down이 핵심 단서)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -sG localhost:9090/api/v1/query --data-urlencode 'query=up'
  - id: check-tunnel-data04
    title: data04 SSH 터널 생존 확인 (터널 죽음이 NodeDown으로 보인다)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      systemctl status keiwi-tunnel-data04 --no-pager | head -5
  - id: check-tunnel-ports
    title: 터널 4포트가 모두 떠 있는가
    risk: low
    reversible: true
    idempotent: true
    command: >-
      ss -tlnp | grep -E '172.18.0.1:(9104|9404|9837|9987)'
---

# 런북 · 노드 다운 (NodeDown)

> **이 알림은 "노드가 죽었다"가 아니라 "node-exporter가 5분간 응답하지 않았다"이다.**
> 둘은 다르고, KEIwi에서는 **터널 하나가 죽어도 이 알림이 뜬다**(§2.2). 노드에 달려가기 전에
> 30초만 쓰면 셋 중 무엇인지 갈린다.

> 표기 규약: `"<…>"` 자리표시자는 따옴표 안에 둔다(게이트 R10).

## 1. 이 알림이 말하는 것 / 말하지 않는 것

발화식은 `up{job="node-exporter"} < 1` **5분 지속**, `noDataState: Alerting`(타깃이 사라져도 장애로 본다).

가능한 상태는 셋이고 조치가 전부 다르다:

| # | 실제 상태 | 노드 | 조치 |
| --- | --- | --- | --- |
| A | **노드가 죽었다** | down | 전원·콘솔·BMC — 물리 |
| B | **exporter만 죽었다** | 살아있음 | 해당 노드에서 서비스 재시작 |
| C | **경로가 죽었다**(터널·방화벽·네트워크) | 살아있음 | data05에서 터널/ufw 수리 — **노드는 건드리지 않는다** |

**[실측 2026-08-03]** 현재 `up{job="node-exporter"}` = data01·data03·data04·data05 모두 **1**.
(data02는 Windows라 이 job에 없다 — `docs/inventory.yaml`.)

## 2. 30초 판별

### 2.1 어느 타깃이 몇 개 죽었나

```bash
# ① 전체 타깃 상태 — 한 노드의 여러 job이 동시에 죽었는지가 핵심 단서다
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=up' \
  | python3 -c "import sys,json;[print(s['value'][1], s['metric'].get('job'), s['metric'].get('instance'), s['metric'].get('node','')) for s in sorted(json.load(sys.stdin)['data']['result'], key=lambda x:(x['value'][1], x['metric'].get('instance','')))]"
```

| 관찰 | 의미 |
| --- | --- |
| **그 노드의 타깃이 전부 down** | A(노드 down) 또는 C(경로 down) — §2.2로 |
| **node-exporter만 down**, 같은 노드 다른 job은 up | **B** — exporter 프로세스 문제 → §3 |

### 2.2 ⚠️ data04는 터널 경유다 — 터널 죽음이 NodeDown으로 보인다

data04의 **4개 타깃 전부**가 data05의 SSH 터널을 지난다 [실측 `keiwi-tunnel-data04.service`]:

```text
ssh -N -p <SSH_PORT> "$KEIWI_USER_DATA04@192.0.2.14"   # 계정은 env(§13) — infra/ansible/README.md
  -L 172.18.0.1:9104:localhost:9100   # node-exporter  ← NodeDown이 보는 타깃
  -L 172.18.0.1:9404:localhost:9400   # DCGM
  -L 172.18.0.1:9837:localhost:9836   # gpu-model
  -L 172.18.0.1:9987:localhost:9986   # port-exporter
```

**터널 프로세스 하나가 죽으면 data04는 통째로 "down"으로 보인다.** 노드는 멀쩡한데.
그러므로 data04 알림이면 **가장 먼저 터널을 본다**(data05에서, 읽기 전용):

```bash
systemctl status keiwi-tunnel-data04 --no-pager | head -5
ss -tlnp | grep -E '172.18.0.1:(9104|9404|9837|9987)'   # 4개 다 떠 있어야 정상
```

- `inactive`/`failed` → **C 확정.** 터널만 살리면 4개 타깃이 함께 돌아온다.
- `active`인데 포트가 안 보임 → ssh 세션이 반쯤 죽은 상태. 터널 재시작(사람, §11).

### 2.3 노드 자체가 살아 있는가 (A vs C)

```bash
ping -c 3 "<node-ip>"                              # 예: ping -c 3 192.0.2.14
ssh -p <SSH_PORT> "<user>@<node-ip>" 'uptime; systemctl is-system-running'
```

계정은 노드마다 다르다 — **실제 계정명은 레포에 적지 않는다**(대상 노드에서 `ls /home`, 또는 `KEIWI_USER_DATA0N` env). 포트는 전부 **<SSH_PORT>**.

| ping | ssh | 판정 |
| --- | --- | --- |
| ✗ | ✗ | **A — 노드 down.** 전원/BMC/물리. 로그도 그 시각에 끊겼는지 §4로 교차확인 |
| ✓ | ✗ | 네트워크는 살았고 OS·sshd가 문제. 콘솔/BMC 접근 필요 |
| ✓ | ✓ | **B 또는 C** — 노드는 멀쩡하다. §3으로 |

## 3. exporter / 경로 수리 (B·C)

```bash
# 해당 노드에서 (data03·data01은 직접 스크랩, data04는 터널 너머)
ssh -p <SSH_PORT> "<user>@<node-ip>"
systemctl status prometheus-node-exporter --no-pager | head -5   # apt 설치 노드(data03·data04)
curl -s localhost:9100/metrics | head -3                          # 로컬에선 살아 있는가
sudo ufw status | grep -E '9100|9400|9633'                        # data05(.105)에서 오는 접근 허용?
```

- **로컬 curl은 되는데 data05에서 안 된다** → 방화벽·경로(C). data03는 `.105 → 9100` ufw 허용이 전제다.
- **로컬 curl도 안 된다** → exporter 프로세스(B). 재시작은 **사람이**(§11).
- **data01은 apt 패키지가 아니다** — `/usr/local/bin/node_exporter` v1.8.2 수동 설치(16.04). 유닛명이 다르다.
- **data05의 node-exporter는 로컬 컨테이너**다(`node-exporter:9100`). 이 알림이 data05로 뜨면
  거의 확실히 컨테이너 문제이지 노드 문제가 아니다 — 관제 스택 호스트가 죽으면 알림 자체가 안 온다.

복구 후 검증과 재온보딩 절차는 [node-onboarding.md](./node-onboarding.md) **§2.5 검증**이 정본이다
(같은 내용을 여기에 복사하지 않는다 — 두 벌이 되면 한쪽이 반드시 낡는다).

## 4. 교차 확인 — 로그 평면은 뭐라고 하나

메트릭과 로그는 **다른 경로**다(Filebeat → Logstash → OpenSearch). 둘 다 끊겼으면 A쪽에,
로그만 살아 있으면 B/C쪽에 무게가 실린다.

```bash
curl -s 'localhost:9200/keiwi-logs-*/_search' -H 'Content-Type: application/json' -d '{
 "size":0,"aggs":{"n":{"terms":{"field":"fleet_node","size":10},
 "aggs":{"last":{"max":{"field":"@timestamp"}}}}}}' | python3 -m json.tool | grep -E 'key|value_as_string'
```

## 5. 사후·재발방지

- **A(진짜 노드 down)**: 재부팅 원인을 남긴다(계획 재부팅인가, 커널 패닉인가, 전원인가).
  계획 재부팅이었다면 다음부터 정비창을 공지해 알림을 예상 가능하게 만든다.
- **C(터널)**: `keiwi-tunnel-data04`가 몇 번째 죽었는지 세라. 반복되면 **터널 의존 자체가
  단일 장애점**이라는 뜻이다 — data04 직결(ufw 허용)로 옮기는 안건을 올린다.
  터널 죽음과 노드 죽음을 알림 단계에서 구분하려면 blackbox ICMP 프로브가 필요하다
  (설계: [specs/hardware-ops](../../specs/hardware-ops/README.md) `TunnelDownData04`).
- 오탐이었다면 **어느 단계에서 갈렸는지**를 이 런북에 반영한다.

## 관련

- [node-onboarding.md](./node-onboarding.md) — 노드 추가/검증 표준 절차(§2.5 검증)
- [log-ingestion-stopped.md](./log-ingestion-stopped.md) — 로그 평면이 함께 끊겼을 때
- `infra/monitoring/prometheus.yml` — 어느 타깃이 터널이고 어느 것이 직결인지의 정본

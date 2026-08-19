---
id: node-hygiene-coverage-gap
kind: alert
alerts: [NodeHygieneCoverageGap]
service: node-hygiene
category: infra
severity: warning
signature: "fleet:node_hygiene_coverage:gap"
affected_nodes: [data01, data03, data04, data05]
last_verified: 2026-08-03
# tier 1 = L1 제안까지. 자매 런북 node-hygiene-stale(tier 2)과 갈리는 지점이 여기다 —
#   저쪽은 "타이머를 살린다"는 **단일 정답**이지만, 이쪽은 §3 분기표가 다섯 갈래고 그중
#   §4④(유닛 파일 수기 수정)는 명령으로 표현되지도 않는다. **정답형이 아니면 L2 이상이 아니다**
#   (spec §4.1 조건1). 애초에 알림이 "어느 노드인지"조차 말하지 않아 §2 뺄셈이 선행한다.
tier: 1
actions:
  - id: list-live-exporters
    title: 살아 있는 node-exporter 목록 (뺄셈의 왼쪽)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -sG localhost:9090/api/v1/query --data-urlencode 'query=up{job="node-exporter"} == 1'
  - id: list-hygiene-producers
    title: 위생 메트릭을 내는 노드 목록 (뺄셈의 오른쪽)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -sG localhost:9090/api/v1/query --data-urlencode
      'query=node_hygiene_collector_last_run_timestamp_seconds'
  - id: check-textfile-consumer
    title: node-exporter가 textfile 디렉터리를 읽고 있는가 (소비처 확인)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -sG localhost:9090/api/v1/query --data-urlencode
      'query=node_scrape_collector_success{collector="textfile"}'
  - id: run-hygiene-once
    title: 대상 노드에서 수집기 단발 실행
    risk: low
    reversible: true
    idempotent: true
    command: >-
      sudo systemctl start keiwi-node-hygiene.service
  - id: reapply-hygiene-role-dryrun
    title: role 재적용 드라이런 (실적용 전 필수)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      ansible-playbook -i inventory.ini playbooks/agents.yml --tags node-hygiene --check --diff
      --limit "$NODE"
---

# 런북 — NodeHygieneCoverageGap (위생 수집기 커버리지 구멍)

> 이 알림은 **"어떤 노드가 아프다"가 아니라 "어떤 노드를 우리가 못 보고 있다"**를 말한다.
> 구멍이 난 노드에는 드라이버 정합성·재부팅 대기·apt 대기 탐지가 **통째로 없다.**

## 1. 이 알림이 말하는 것 / 말하지 않는 것

발화식: `fleet:node_hygiene_coverage:gap > 0`, 30분 지속.

```
gap = count(up{job="node-exporter"} == 1)
      - (count(node_hygiene_collector_last_run_timestamp_seconds) or vector(0))
```

- **말하는 것**: 스크랩은 되는데(=노드도 exporter도 살아 있다) 위생 `.prom`을 쓰는 생산자가 없는 노드가 N대 있다.
- **말하지 않는 것**: 어느 노드인지. gap은 플릿 집계라 라벨이 없다 — §2에서 뺄셈으로 찾는다.
- **말하지 않는 것 2**: 값이 낡았는지. 그건 `NodeHygieneStale`([런북](./node-hygiene-stale.md))의 몫이다. 이 둘은 역할이 갈린다 — **시리즈가 없으면 여기, 있는데 낡았으면 저기.**

> 왜 이 알림이 존재하나 — 2026-08-02 실측에서 `up`=4인데 위생 메트릭은 2노드뿐이었고, 없는 쪽이 하필 NVIDIA 드라이버가 깨진 data05였다. data05는 62일 동안 `nvidia-smi`가 exit 18인데 알림이 0건이었다. 원인은 role의 가드 하나가 7개 태스크를 전부 게이팅한 것인데, **아무도 그 사실을 몰랐다는 것이 진짜 결함**이다. 그래서 커버리지 자체를 메트릭으로 만들었다.

## 2. 30초 판별 — 어느 노드인가

```bash
# (a) 살아 있는 exporter 전부
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=up{job="node-exporter"} == 1' \
| python3 -c 'import sys,json;print(sorted(r["metric"]["instance"] for r in json.load(sys.stdin)["data"]["result"]))'

# (b) 위생 메트릭을 내는 노드
curl -sG localhost:9090/api/v1/query \
     --data-urlencode 'query=node_hygiene_collector_last_run_timestamp_seconds' \
| python3 -c 'import sys,json;print(sorted(r["metric"]["instance"] for r in json.load(sys.stdin)["data"]["result"]))'
```

(a) − (b) 가 구멍 난 노드다. IP → 노드 id 매핑은 `docs/inventory.yaml`(`192.0.2.1N` → `data0N`).

## 3. 원인 분기표

| 관측 | 원인 | 첫 조치 |
|---|---|---|
| 타이머가 없다 (`systemctl status keiwi-node-hygiene.timer` → not-found) | role이 그 노드에 적용된 적 없음 | §4 ① |
| 타이머는 있는데 inactive | enable 누락(드라이런만 돌았거나 `--check`에서 멈춤) | §4 ① |
| 타이머 active인데 `.prom` 부재 | 스크립트 실행 실패 | §4 ② |
| `.prom`은 있는데 Prometheus에 없다 | node-exporter가 그 디렉터리를 안 읽는다 | §4 ③ |
| exporter가 컨테이너인데 마운트가 없다 | compose 바인드마운트 누락 | §4 ③ |

## 4. 조치 (파괴 강도 순 — 전부 사람이, §11)

**① role 재적용** — 먼저 드라이런, 그 다음 실적용.

```bash
cd infra/ansible
ansible-playbook -i inventory.ini playbooks/agents.yml --tags node-hygiene --check --diff --limit "$NODE"
ansible-playbook -i inventory.ini playbooks/agents.yml --tags node-hygiene --limit "$NODE"
```

`sudo`가 NOPASSWD가 아닌 노드(실측상 data05)는 `-K`를 붙인다. 비밀번호를 `-e ansible_become_password=`로 넘기지 않는다(§13 — 프로세스 목록에 남는다).

**② 수집기 단발 실행 후 로그 확인** (대상 노드에서)

```bash
sudo systemctl start keiwi-node-hygiene.service
systemctl status keiwi-node-hygiene.service --no-pager
sudo journalctl -u keiwi-node-hygiene.service -n 50 --no-pager
ls -l /var/lib/node_exporter/textfile/
```

**③ 소비처(=node-exporter가 그 디렉터리를 읽는가) 확인**

```bash
# host 노드: 실행 인자에 textfile 디렉터리가 있어야 한다
pgrep -af '^([^ ]*/)?(node_exporter|prometheus-node-exporter)( |$)'
# 컨테이너 노드(data05): compose 마운트가 정본이다
grep -n 'textfile' infra/monitoring/docker-compose.yml
# 양쪽 공통 — 소비 여부는 이 두 메트릭이 말한다
curl -sG localhost:9090/api/v1/query \
     --data-urlencode 'query=node_scrape_collector_success{collector="textfile"}'
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=node_textfile_scrape_error'
```

`collector_success`=1 이고 `scrape_error`=0 인데도 시리즈가 없으면 **소비처는 정상이고 생산자만 없다** — ①로 돌아간다. 이것이 2026-08-02에 실제로 있었던 상태다.

**④ 소비처가 없는 노드** — role이 자동 교정하지 않는다. apt 노드가 아니면 `ARGS` 주입 지점이 없어 유닛 파일을 사람이 고쳐야 한다(role의 `assert`/`fail`이 이 상황을 드라이런에서 멈춰 세운다). 유닛에 `--collector.textfile.directory=/var/lib/node_exporter/textfile`를 추가하고 재시작한다.

## 5. 사후 · 재발 방지

- 노드를 새로 온보딩할 때 `inventory.ini`에 **`node_hygiene_consumer`를 반드시 적는다**(host | container). 미선언이면 role이 드라이런에서 assert로 멈춘다 — 이것이 "생산자만 깔리는" 새 실패모드를 막는 장치다.
- gap이 0으로 돌아왔는지 확인: `curl -sG localhost:9090/api/v1/query --data-urlencode 'query=fleet:node_hygiene_coverage:gap'` → `0`.
- 온보딩 절차 전체는 [node-onboarding](./node-onboarding.md).

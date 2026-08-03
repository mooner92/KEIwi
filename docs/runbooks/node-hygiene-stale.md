---
id: node-hygiene-stale
kind: alert
alerts: [NodeHygieneStale]
service: node-hygiene
category: infra
severity: warning
signature: "keiwi-node-hygiene.timer"
affected_nodes: [data01, data03, data04, data05]
last_verified: 2026-08-03
---

# 런북 — NodeHygieneStale (위생 수집기 정지 = 값이 남아 있는데 낡았다)

> **조용한 실패다.** 타이머가 죽어도 node-exporter는 마지막 `.prom`을 계속 서빙한다.
> 그래프는 평평한 선을 그리고 대시보드는 초록이다 — 값의 *존재*가 아니라 *신선도*만이 판별한다.

## 1. 이 알림이 말하는 것 / 말하지 않는 것

발화식: `time() - node_hygiene_collector_last_run_timestamp_seconds > 5400`, 15분 지속.

- **말하는 것**: 이 노드의 위생 값이 90분 넘게 갱신되지 않았다. 타이머 주기가 30분이므로 **연속 3회 이상 실패**했다는 뜻이다(1회 실패는 임계 아래라 봐주고 지나간다).
- **말하지 않는 것**: 값 자체가 틀렸다는 뜻이 아니다. `node_reboot_required`·`node_nvidia_version_mismatch`가 0이어도 **그것은 90분 전 사실**이다. 이 알림이 떠 있는 동안 그 노드의 위생 판단을 신뢰하지 마라.
- 시리즈가 **아예 사라진** 경우는 여기가 아니라 [NodeHygieneCoverageGap](./node-hygiene-coverage-gap.md)이 잡는다.

## 2. 30초 판별

```bash
# (a) 노드별 마지막 수집 이후 경과 초 — 큰 값부터
curl -sG localhost:9090/api/v1/query \
     --data-urlencode 'query=sort_desc(time() - node_hygiene_collector_last_run_timestamp_seconds)'
```

대상 노드(`192.168.1.10N` → `data0N`, `docs/inventory.yaml`)에서:

```bash
systemctl status keiwi-node-hygiene.timer  --no-pager
systemctl status keiwi-node-hygiene.service --no-pager
systemctl list-timers keiwi-node-hygiene.timer --no-pager
sudo journalctl -u keiwi-node-hygiene.service -n 80 --no-pager
ls -l --time-style=full-iso /var/lib/node_exporter/textfile/
```

## 3. 원인 분기표

| 관측 | 원인 | 조치 |
|---|---|---|
| timer가 `inactive`/`dead` | 재부팅 후 enable 누락, 또는 사람이 stop | §4 ① |
| service가 `failed`, journal에 `apt-get` 관련 오류 | apt 락 경합 또는 저장소 오류 | §4 ② — 스크립트는 실패해도 0으로 폴백하므로, 여기서 죽었다면 락이 아니라 다른 원인이다 |
| journal에 `mktemp: cannot create` | textfile 디렉터리 부재/권한 | §4 ③ |
| service는 성공인데 mtime이 옛날 | 다른 프로세스가 `.prom`을 덮어썼다 | 같은 디렉터리를 쓰는 다른 수집기 확인(`ls`로 파일 목록 비교) |
| 노드 시계가 틀어졌다 | NTP 미동기 → `time()` 뺄셈이 거짓 | `timedatectl` 확인 후 NTP 복구. **이 경우 값은 신선한데 알림만 뜬다** |

## 4. 조치 (파괴 강도 순 — 전부 사람이, §11)

**① 타이머 재기동**

```bash
sudo systemctl enable --now keiwi-node-hygiene.timer
systemctl list-timers keiwi-node-hygiene.timer --no-pager
```

**② 수집기 단발 실행 — 실패 원인을 눈으로 본다**

```bash
sudo systemctl start keiwi-node-hygiene.service
sudo journalctl -u keiwi-node-hygiene.service -n 50 --no-pager
```

스크립트는 `set -euo pipefail`이라 중간 실패 시 `.prom`을 **갱신하지 않고** 죽는다(원자적 `mv` 앞에서 멈춘다). 반쯤 쓰인 파일이 노출되지 않는 대신, 조용히 낡는다 — 그래서 이 알림이 필요하다.

**③ 디렉터리·권한 복구** (role 재적용이 정본이다)

```bash
cd infra/ansible
ansible-playbook -i inventory.ini playbooks/agents.yml --tags node-hygiene --check --diff --limit "$NODE"
ansible-playbook -i inventory.ini playbooks/agents.yml --tags node-hygiene --limit "$NODE"
```

`sudo`가 NOPASSWD가 아닌 노드(실측상 data05)는 `-K`를 붙인다.

## 5. 사후 · 재발 방지

- 복구 확인: 위 §2 (a)의 값이 **1800 미만**으로 떨어지면 정상(타이머 주기 30분).
- 이 알림이 뜬 구간 동안의 위생 판단은 **소급 신뢰하지 않는다.** 특히 그 구간에 `node_nvidia_version_mismatch`가 0이었다는 것은 근거가 되지 못한다.
- 같은 노드에서 반복되면 타이머 주기(`node_hygiene_timer_interval`)가 아니라 **스크립트가 느린 것**을 의심하라 — `apt-get -s`는 EOL 노드에서 특히 무겁다(data01은 `node_hygiene_apt_enabled=false`로 이미 꺼 뒀다).

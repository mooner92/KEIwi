---
id: memory-pressure
kind: alert
alerts: [MemoryLow, OomKillOccurred]
service: node-exporter
category: system
severity: warning
affected_nodes: [data01, data03, data04, data05]
last_verified: 2026-08-03
---

# 런북 · 메모리 압박 (MemoryLow / OomKillOccurred)

> `MemoryLow` = **곧 죽을 수 있다**(경고) · `OomKillOccurred` = **이미 죽었다**(사후).
> 연구 노드는 메모리를 꽉 채워 쓰는 게 정상이라 %만으로는 판단이 안 된다 —
> **누가 먹고 있는지**를 찾는 것이 이 런북의 전부다.

> 표기 규약: `"<…>"` 자리표시자는 따옴표 안에 둔다(게이트 R10).

## 1. 이 알림이 말하는 것 / 말하지 않는 것

| | MemoryLow | OomKillOccurred |
| --- | --- | --- |
| 식 | `100 * MemAvailable / MemTotal < 5` | `increase(node_vmstat_oom_kill[1h]) > 0` |
| 지속 | 15m | 즉시(`for: 0s`) |
| 뜻 | 여유 5% 미만이 15분째 | 최근 1시간에 커널이 프로세스를 죽였다 |
| 조치 시점 | **예방** | **사후 수습 + 재발 방지** |

**`MemAvailable`이지 `MemFree`가 아니다.** 페이지 캐시는 회수 가능하므로 `free`가 0에 가까워도
정상이다. 이 알림이 뜨면 **회수해도 부족하다**는 뜻이다.

**[실측 2026-08-03] 현재 여유** — `100 * MemAvailable / MemTotal`:

| 노드 | 여유 | 총량 | 비고 |
| --- | --- | --- | --- |
| **data01** | **9.8%** | 377.8 GiB (여유 ≈37 GiB) | 임계 5%까지 4.8%p — **가장 가깝다** |
| data04 | 68.7% | | |
| data05 | 81.4% | | 관제 스택 호스트 |
| data03 | 96.3% | | |

**[실측] OOM kill 카운터**: data03·data04·data05 전부 **0**(사고 없음).

### ⚠️ data01에는 OomKillOccurred가 **원리적으로 발화하지 않는다**

```text
[실측 2026-08-03, data01]
  uname -r                        → 4.4.0-179-generic  (Ubuntu 16.04.7)
  grep -c oom_kill /proc/vmstat   → 0                  ← 커널이 이 항목을 노출하지 않는다
  count by(instance)(node_vmstat_oom_kill) → .103 / .104 / .105 만.  .101 없음
```

`oom_kill` 필드는 신형 커널의 `/proc/vmstat`에만 있다. data01(4.4)은 그 필드가 없어
node-exporter가 시리즈를 만들 수 없고, 규칙의 `noDataState: NoData` 때문에 **조용히 아무 일도
일어나지 않는다.** 즉 **메모리 여유가 가장 적은 노드가 OOM 탐지에서 유일하게 빠져 있다.**

→ data01은 **`MemoryLow`(5%)가 유일한 방어선**이고, OOM 여부는 사람이 §2 ③으로 직접 확인해야 한다.

## 2. 30초 판별

```bash
# ① 현재 여유 (알림 라벨과 대조)
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=100 * node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes' \
  | python3 -c "import sys,json;[print(s['metric'].get('instance'), round(float(s['value'][1]),1)) for s in json.load(sys.stdin)['data']['result']]"

# ② OOM이 실제로 있었나 (data01은 시리즈 자체가 없다 — 위 경고 참조)
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=increase(node_vmstat_oom_kill[24h])'
```

```bash
# ③ 무엇이 죽었나 — 커널 로그가 유일한 증거다 (해당 노드에서)
ssh -p 764 "<user>@<node-ip>"        # 예: ssh -p 764 mhchoi@192.168.1.101
sudo journalctl -k --since '-24h' --no-pager | grep -iE 'out of memory|oom-kill|killed process' | tail -20
free -g
ps -eo pid,user,rss,comm --sort=-rss | head -15     # 지금 누가 먹고 있나 (RSS 기준)
```

> **OpenSearch로는 못 찾는다** — 커널 메시지라 `service`가 `unknown`이고, [실측 2026-08-03]
> `"Out of memory: Killed process"` 구문검색 결과는 **0건**이다(플릿에 OOM 이력이 없거나
> 커널 메시지가 수집 경로를 타지 않는다). 노드의 `journalctl -k`가 정본이다.

## 3. 원인 분기

| 관찰 | 원인 | 조치 |
| --- | --- | --- |
| 한 프로세스의 RSS가 지배적 | 큰 모델 로드·배치 크기 과다 | 소유자 통보 → 파라미터 조정(§4) |
| 여러 잡이 조금씩 쌓임 | 동시 실행 과다 | 스케줄 협의 |
| 계속 우상향(누수) | 애플리케이션 메모리 누수 | 주기 재시작 + 개발자 전달 |
| **캐시가 큰데 `MemAvailable`은 충분** | 정상 | 조치 없음 — `free`만 보고 놀라지 않는다 |
| GPU 노드에서 발생 | 호스트 RAM ≠ VRAM. `DCGM_FI_DEV_FB_USED`는 별개다 | 혼동 금지 |

## 4. 조치 (파괴 강도 순)

1. **소유자 역추적** — 죽이기 전에 누구 것인지 안다(§11).
   ```bash
   curl -sG localhost:9090/api/v1/query --data-urlencode 'query=gpu_model_info' \
     | python3 -c "import sys,json;[print(m['node'],'gpu'+m['gpu'],m['user'],m['framework'],m['model'],'pid='+m['pid']) for m in (s['metric'] for s in json.load(sys.stdin)['data']['result'])]"
   curl -sG localhost:9090/api/v1/query --data-urlencode 'query=keiwi_listening_port_info'
   ```
   두 exporter가 못 잡는 잡(순수 CPU 배치 등)은 노드에서 `ps -eo pid,user,rss,comm --sort=-rss`.
2. **통보 후 조정** — 배치 크기·동시 실행 수 축소, 또는 여유 있는 노드로 이전
   ([실측] data03 여유 96.3%).
3. **재시작** — 누수형이면 소유자 합의 후 해당 서비스만.
4. **`OomKillOccurred` 사후 수습** — 죽은 프로세스가 서비스면 되살아났는지 확인
   (`systemctl is-active`), 연구 잡이면 **소유자에게 알린다.** 본인은 모를 수 있다 —
   커널이 조용히 죽이고 사용자에겐 "프로세스가 사라진" 것으로만 보인다.

**하지 말 것**
- 임계를 5%보다 낮추기 — 5%는 30일 최저 9.9%(data01) 아래로 잡은 값이라 이미 타이트하다.
- 소유자 확인 없이 큰 프로세스 kill(= OOM killer를 사람이 대신하는 것).
- `echo 3 > /proc/sys/vm/drop_caches` 같은 미신적 조치 — `MemAvailable`은 이미 캐시를 여유로 센다.

## 5. 사후·재발방지

- OOM이 실제로 났다면 **죽은 프로세스·시각·RSS**를 인시던트에 남긴다. 커널 로그는 노드
  journald에만 있고 순환 삭제된다.
- 같은 노드가 반복되면 임계 조정이 아니라 **워크로드 배치**(어느 잡을 어느 노드에) 문제다.
- **data01의 탐지 구멍**(§1)은 다음 중 하나로만 닫힌다: ① 커널 업그레이드(16.04 EOL — 별도 안건)
  ② `MemoryLow` 임계를 data01만 완화 없이 유지하며 사람이 주기 점검 ③ textfile collector로
  `/proc/vmstat` 대체 지표 생성. 현재는 ②다 — **이 사실을 모르는 사람이 "OOM 알림이 없으니
  괜찮다"고 읽는 것이 가장 위험하다.**

## 관련

- [disk-pressure.md](./disk-pressure.md) — 같은 "자원 압박" 계열(조치 구조가 같다)
- [node-down.md](./node-down.md) — OOM이 심하면 노드가 응답 불능이 되어 NodeDown으로 번진다
- `docs/inventory.yaml` — 노드별 OS·커널 세대(무슨 지표가 없는지의 근거)

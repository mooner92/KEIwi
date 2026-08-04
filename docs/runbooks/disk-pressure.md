---
id: disk-pressure
kind: alert
alerts: [DiskUsageHigh, DiskFillPredicted]
service: node-exporter
category: infra
severity: warning
affected_nodes: [data01, data03, data04, data05]
last_verified: 2026-08-03
# tier 1 = L1 제안까지. 이 런북은 **진단·분기**가 본체이고 조치는 사람 판단이 지배한다
#   (연구자 데이터 이전·모델 캐시 회수·보존정책 단축은 전부 비가역이거나 협의 사안).
#   spec §1이 DiskUsageHigh를 "L3 후보"로 적은 것은 **화이트리스트 정리에 한정**된 이야기이고,
#   그 좁은 조치만 따로 [disk-usage-high.md](./disk-usage-high.md)(tier 3)로 분리했다.
#   여기에 `--purge`(비가역) 조치가 하나라도 있는 한 게이트 A5가 이 런북의 상한을 1로 묶는다.
tier: 1
actions:
  - id: find-top-consumers
    title: 어느 디렉터리가 먹고 있나 (한 파일시스템 안에서만)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      sudo du -xsh /home /var/lib/docker /var/log /tmp 2>/dev/null | sort -rh | head
  - id: find-owner-gpu
    title: GPU 잡 소유자 역추적 (파괴적 조치 전 필수)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -sG localhost:9090/api/v1/query --data-urlencode 'query=gpu_model_info'
  - id: find-owner-ports
    title: 서비스 소유자 역추적 (포트→프로세스→계정)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -sG localhost:9090/api/v1/query --data-urlencode 'query=keiwi_listening_port_info'
  - id: purge-old-kernels
    title: 구 커널 이미지 제거 (data01 /boot 전용)
    # 비가역이다 — 지운 커널로는 다시 부팅할 수 없다. 16.04에서 커널 제거는 사람이 한다.
    risk: high
    reversible: false
    idempotent: true
    command: >-
      sudo apt autoremove --purge
---

# 런북 · 디스크 압박 (DiskUsageHigh / DiskFillPredicted)

> 두 알림은 **다른 질문**에 답한다. 섞으면 엉뚱한 걸 지운다.
> `DiskUsageHigh` = **이미 높다**(90% 15분) · `DiskFillPredicted` = **곧 찬다**(현 추세로 4시간 내 0).
> **연구 데이터는 재현 불가다. 지우기 전에 소유자를 찾는다.**

> 표기 규약: `"<…>"` 자리표시자는 따옴표 안에 둔다(게이트 R10).

## 1. 이 알림이 말하는 것 / 말하지 않는 것

| | DiskUsageHigh | DiskFillPredicted |
| --- | --- | --- |
| 식 | `100*(1 - avail/size) > 90` | `predict_linear(avail[6h], 4*3600) < 0` |
| 지속 | 15m | 30m |
| 뜻 | 여유가 10% 미만 | 지난 6시간 추세대로면 4시간 뒤 0 |
| 급한가 | **아니다** — 3.5TB의 10%는 350GB다 | **그렇다** — 크기와 무관하게 "곧 멈춘다" |
| 오탐 원인 | 원래 꽉 채워 쓰는 파티션(`/boot` 등) | 모델 다운로드·대용량 복사 같은 **일시적** 쓰기 |

> **둘이 동시에 뜨면 진짜다.** DiskFillPredicted만 떴고 사용률이 낮으면 대개 큰 파일을
> 내려받는 중이다 — 30m `for`가 이미 걸러주지만, 무엇을 받는지는 확인한다.

**[실측 2026-08-03] 현재 분포** — `100*(1 - avail/size)`:

| 노드 | 마운트 | 사용률 | 비고 |
| --- | --- | --- | --- |
| **data04** | `/` (407G) | **87.2%** | 임계 90까지 2.8%p — 가장 가깝다 |
| data05 | `/` (407G) | 69.5% | 관제 스택 호스트 |
| data01 | `/boot` | 60.5% | 작은 파티션이라 커널 몇 개면 찬다 |
| data01 | `/` | 51.6% | |
| data03 | `/` | 10.1% | |
| data04 | `/data` (22T) | 6.2% | **여기에 21T가 남아 있다** |

## 2. 30초 판별 — 무엇이 차고 있나

```bash
# ① 어느 노드/마운트가 문제인가 (알림 라벨과 대조)
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=topk(8, 100 * (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs"}))' \
  | python3 -c "import sys,json;[print(round(float(s['value'][1]),1), s['metric'].get('instance'), s['metric'].get('mountpoint')) for s in json.load(sys.stdin)['data']['result']]"

# ② 늘고 있나 줄고 있나 (24시간 증분, 바이트)
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=delta(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs"}[24h])'
```

```bash
# ③ 그 노드에서 실제 범인 찾기 (읽기 전용)
ssh -p 764 "<user>@<node-ip>"        # 계정은 노드별(레포에 적지 않는다) · 포트는 전부 764
df -h
sudo du -xsh /home /var/lib/docker /var/log /tmp 2>/dev/null | sort -rh | head
```

> **`-x`(한 파일시스템 안에서만)를 빼면 안 된다.** data04는 `/data`가 22T 별도 마운트라
> `du -sh /`가 그것까지 세면서 오래 걸리고 결론이 틀어진다.

## 3. 원인 분기 — 노드마다 범인이 다르다 [실측]

| 노드 | 지배적 소비자 | 첫 조치 |
| --- | --- | --- |
| **data04 `/`** | **`/home` 273G** (사용자 데이터). `/var/lib/docker` 691M · `/var/log` 346M로 **로그·도커는 무죄** | `/data`(21T 여유)로 이전 협의 — **소유자 통보 후** |
| data05 `/` | `/home` 179G + OpenSearch 인덱스(도커 볼륨 `osdata`) | §4 순서대로 |
| data05 `/data` | `/data/vllm` **288G** · `/data/ollama` 31G (모델 캐시) | 안 쓰는 모델 회수(소유자 확인) |
| data01 `/boot` | 구 커널 이미지 | `sudo apt autoremove --purge` (16.04 — 커널 제거는 사람이) |
| 어느 노드든 급증 | 폭주 로그(예: rsyslog) | [rsyslog-omfile-flood.md](./rsyslog-omfile-flood.md) |

> **"디스크가 찼다 = 로그를 지운다"는 KEIwi에서 대체로 틀린다.** data04의 334G 중 로그는
> 0.3G다. 이 알림이 예전에 `infra/logging/README.md`(로그 정리 문서)를 가리켰던 것이
> 바로 그 오답을 유도했다.

## 4. 조치 (파괴 강도 순 — 되돌릴 수 있는 것부터)

0. **화이트리스트 회수를 먼저 한다** — 재생성되는 캐시만 비우는 절차는
   [disk-usage-high.md](./disk-usage-high.md)에 분리돼 있다(journal vacuum · apt clean ·
   dangling 이미지). **연구자 데이터를 건드리지 않고 끝나는 유일한 경로**라 항상 첫 수단이고,
   그래서 그 절차서만 자동경로 후보(tier 3)다. 여기서 얻는 여유가 부족할 때만 아래로 내려간다.
1. **먼저 소유자를 찾는다** (파괴적 조치 전 필수 — §11)
   ```bash
   curl -sG localhost:9090/api/v1/query --data-urlencode 'query=gpu_model_info'   # GPU 잡 소유자
   curl -sG localhost:9090/api/v1/query --data-urlencode 'query=keiwi_listening_port_info'  # 서비스 소유자
   ```
2. **OpenSearch 보존정책**(data05, 로그가 범인일 때) — ISM `keiwi-logs-retention`은 **365일 delete**다.
   ```bash
   curl -s 'localhost:9200/_cat/indices/keiwi-logs-*?h=index,store.size,docs.count&bytes=mb' | sort -k2 -rn | head
   curl -s 'localhost:9200/_plugins/_ism/explain/keiwi-logs-*?pretty' | head -40
   ```
   [실측 2026-08-03] 전체 `keiwi-logs-*` ≈ **23GB** — 급한 상황에서 이걸 지워도 별로 안 준다.
   보존기간 단축은 되돌릴 수 없다(§11 — 사람 판단). 단일 서비스가 도배 중이면 그 서비스만
   지우는 쪽이 낫다([rsyslog-omfile-flood.md](./rsyslog-omfile-flood.md) §정리).
3. **Prometheus TSDB** — `--storage.tsdb.retention.time=30d`(compose). 이미 30일이라 더 줄이면
   30일 분포 기반 임계 산정(§alerting)이 무너진다. **여기는 마지막에 손댄다.**
4. **모델 캐시** — `/data/vllm`(288G)·`/data/ollama`(31G). **누가 쓰는 모델인지 확인 없이 지우지 마라.**
   다시 받으면 되지만 다운로드 시간과 연구 일정이 든다.
5. **이전(移轉)이 삭제보다 낫다** — data04는 `/data`에 21T가 놀고 있다. 지우기 전에 옮길 곳을 본다.
6. **구 커널 회수**(data01 `/boot` 전용) — 작은 파티션이라 커널 몇 개면 찬다.
   ```bash
   dpkg -l 'linux-image-*' | awk '/^ii/{print $2}'   # 먼저 무엇이 지워질지 눈으로 본다
   uname -r                                          # 지금 돌고 있는 커널 — 이건 남아야 한다
   sudo apt autoremove --purge
   ```
   > **비가역이다.** 지운 커널로는 다시 부팅할 수 없다. 16.04(data01)는 커널 제거가
   > 부팅 실패로 이어진 전례가 흔하므로 **정비창에 사람이**, 그리고 현재 커널이 목록에
   > 없는지 확인한 뒤에만 실행한다. `actions`에서 이 조치만 `risk: high`·`reversible: false`인
   > 이유이고, 그 표기 하나가 이 런북 전체의 tier 상한을 1로 묶는다(게이트 A5).

**하지 말 것**
- `/var/log`를 통째로 비우기 — 장애 원인 로그가 거기 있다(journald는 별개지만 앱 로그는 사라진다).
- 소유자 확인 없이 `/home` 정리.
- 임계를 90 → 95로 올리기(알림을 끄는 것과 같다).

## 5. 사후·재발방지

- **왜 찼는지 한 줄** 남긴다(누가·무엇을·언제부터). 같은 노드가 반복되면 용량 증설이나
  마운트 재배치 안건이지, 매번 청소할 일이 아니다.
- `DiskFillPredicted`가 오탐이었다면 무엇을 받고 있었는지 적는다 — 반복되는 대용량 작업은
  예고 가능한 이벤트다.
- 정리 후 `100*(1 - avail/size)`가 실제로 내려갔는지 Prometheus에서 확인한다
  (지웠는데 프로세스가 파일 핸들을 잡고 있으면 공간이 안 돌아온다 — `lsof +L1`).

## 관련

- [log-ingestion-stopped.md](./log-ingestion-stopped.md) — OpenSearch가 watermark로 쓰기를 멈추면 로그도 끊긴다
- [rsyslog-omfile-flood.md](./rsyslog-omfile-flood.md) — 로그 폭주가 원인일 때
- [smart-health-failed.md](./smart-health-failed.md) — 디스크가 물리적으로 문제일 때
- `infra/logging/README.md` §3 — ISM·보존 설계(정본)

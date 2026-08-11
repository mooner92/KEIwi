---
id: disk-usage-high
kind: procedure
# 이 절차서가 답하는 알림. 담당 **진단** 런북은 disk-pressure.md 이고 알림의 runbook_url도
# 그쪽을 가리킨다 — 여기는 그 §4-0에서 갈라져 나온 **조치 절차**다(둘의 역할은 §0 참조).
# alerts 없음 — 소유권은 disk-pressure.md(단일). 같은 alertname을 두 런북이 선언하면
# L1이 ambiguous_runbook으로 제안 0이 된다[실증]. 이 문서는 procedure로서 링크로만 도달.
service: node-exporter
category: infra
affected_nodes: [data01, data03, data04, data05]
last_verified: 2026-08-04
# tier 3 = L3(사전승인 자동) 후보. spec §1이 "DiskUsageHigh — L3 후보(정리 대상 화이트리스트
#   한정)"라고 적은 바로 그 좁은 절차다. 4조건(§4.1) 전부를 만족한다:
#     정답형 — 대상이 §2 표로 고정돼 있고 분기가 없다
#     저blast — 재생성되는 캐시만 건드린다. 실패해도 그 노드의 캐시가 비는 것이 전부다
#     멱등    — 두 번 돌려도 결과가 같다(이미 빈 캐시는 더 비워지지 않는다)
#     가역    — §3의 근거대로 원본이 다른 곳에 남는다
#   **후보일 뿐이다.** 승격은 ADR-0027(신설 예정) + L2 무사고 20회 뒤이고, 그전까지 tier 3은
#   "여기까지는 갈 수 있다"는 상한 선언이지 현재 상태가 아니다.
# tier 1 — alerts 소유권을 disk-pressure로 넘긴 지금, 이 문서는 링크로만 도달하는 절차서다.
# tier≥2는 alertname 실재가 전제(A9 — 도달 불가한 자동 정책 금지). L3 후보 승격은
# T3-2에서 alertname이 아니라 runbook_id 지정으로 별도 결정한다(spec §1).
tier: 1
actions:
  - id: precheck-ingest-alive
    title: '**선행조건** — 로그 인입이 살아 있는가 (journal이 유일본이면 vacuum 금지)'
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -s 'localhost:9200/keiwi-logs-*/_count'; sleep 20; curl -s 'localhost:9200/keiwi-logs-*/_count'
  - id: measure-journal
    title: journald가 실제로 얼마를 쓰고 있나
    risk: low
    reversible: true
    idempotent: true
    command: >-
      journalctl --disk-usage
  - id: measure-apt-cache
    title: apt 캐시가 얼마를 쓰고 있나
    risk: low
    reversible: true
    idempotent: true
    command: >-
      du -sh /var/cache/apt/archives
  - id: journal-vacuum
    title: journald를 200M 상한으로 회수 (원본은 OpenSearch 365일 보존)
    risk: medium
    reversible: true
    idempotent: true
    command: >-
      sudo journalctl --vacuum-size=200M
  - id: apt-clean
    title: 내려받은 .deb 캐시 회수 (필요하면 다시 받는다)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      sudo apt-get clean
  - id: docker-prune-dangling
    title: 태그 없는 dangling 이미지만 회수 (사용 중 이미지는 대상이 아니다)
    risk: medium
    reversible: true
    idempotent: true
    command: >-
      sudo docker image prune -f
  - id: verify-reclaim
    title: 실제로 여유가 생겼는지 확인 (핸들을 잡고 있으면 안 돌아온다)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      df -h /
---

# 런북 · DiskUsageHigh 화이트리스트 회수 절차

> **이 문서는 "무엇을 지우는가"가 아니라 "무엇만 지우는가"를 정하는 문서다.**
> 목록에 없는 경로는 이 절차의 대상이 **아니다** — 애매한 것은 지우지 않는다가 규칙이지,
> 판단해서 지운다가 규칙이 아니다.
>
> 표기 규약: `"<…>"` 자리표시자는 따옴표 안에 둔다(게이트 R10).

## 0. 이 절차서가 [disk-pressure.md](./disk-pressure.md)와 갈리는 지점

| | disk-pressure.md | **이 문서** |
| --- | --- | --- |
| 답하는 질문 | **무엇이 차고 있나** (진단·분기) | **안전하게 얼마를 되찾을 수 있나** (조치) |
| 대상 | 연구자 데이터 포함 전부 | **재생성되는 캐시만** |
| 사람 판단 | 지배적 | 없음(대상이 고정) |
| tier | 1 — 제안까지 | **3** — 자동 후보 |

**순서는 항상 이 문서가 먼저다.** 여기서 끝나면 아무도 다치지 않고, 부족하면
disk-pressure.md §4로 내려가 사람이 판단한다.

## 1. 먼저 기대치를 낮춰라 — 회수량은 작다 [실측 2026-08-03, data04]

data04 `/` 87%에서 이 절차를 실제로 돌린 결과:

| 대상 | 회수 | |
| --- | --- | --- |
| journald | 848M → 200M | **-648M** |
| apt 캐시 | 591M | **-591M** |
| **합계** | | **≈ 1.2GB** |

그리고 같은 노드 `/`의 실제 구성은 **`/home` 272GB**였다(user2 134G · user5 74G ·
user1 23G · user3 22G). 즉 **화이트리스트 회수는 문제의 0.4%를 처리한다.**

> [!IMPORTANT]
> **이 숫자가 이 절차의 존재 이유이자 한계다.** 1.2GB로 임계를 넘길 수 있는 상황이면
> 자동화가 사람 호출 없이 끝내 준다. 넘길 수 없는 상황이면 **자동화가 성공해도 알림은
> 계속 뜨고**, 그때 필요한 것은 청소가 아니라 소유자와의 대화다(disk-pressure.md §3).
> 자동 조치가 "성공했는데 알림이 안 꺼지는" 경우를 결함으로 읽지 마라 — 정상이다.

## 2. 화이트리스트 — 이것만 지운다

| # | 대상 | 도구 | 왜 안전한가 |
| --- | --- | --- | --- |
| 1 | `/var/log/journal` (journald 링버퍼) | `journalctl --vacuum-size` | 같은 로그가 Filebeat→OpenSearch에 **365일** 보존된다(§3) |
| 2 | `/var/cache/apt/archives` (내려받은 `.deb`) | `apt-get clean` | 패키지 저장소에서 다시 받는다. 설치본은 건드리지 않는다 |
| 3 | docker **dangling** 이미지(태그 없음·미사용) | `docker image prune -f` | 사용 중 이미지는 정의상 대상이 아니다. 필요하면 다시 pull |

**도구를 바꾸지 마라.** `rm -rf /var/log/journal/*`은 위 1번과 같은 목적이지만
journald의 인덱스를 깨뜨린다. **경로가 화이트리스트인 것이 아니라 (경로, 도구) 쌍이
화이트리스트다.**

### 이 절차가 절대 건드리지 않는 것 (탐색 제외 규칙)

아래는 "지우면 안 되는 것"이 아니라 **"이 절차가 쳐다보지도 않는 것"**이다.
용량이 커서 눈에 띄더라도 여기서는 후보로 올리지 않는다.

| 제외 대상 | 왜 |
| --- | --- |
| `/home/**` | **연구자 데이터. 재현 불가.** 소유자 통보·협의 사안이다(헌장 §11) |
| `/data/vllm` · `/data/ollama` (모델 캐시) | 다시 받을 수는 있지만 다운로드 시간이 연구 일정이다. **소유자 확인 필수** |
| `/opt/conda/pkgs` | **공용 캐시**다. `conda clean -p`는 다른 사람의 환경 재구성을 유발할 수 있다 — 사용자 승인 사안(백로그 B01) |
| **`/tmp`** | 이름과 달리 안전하지 않다. [실측] data04 `/tmp` 5.1GB의 **내용이 미확인**이고 장기 실행 잡의 스크래치가 섞인다. 내용 감사 전까지 화이트리스트 밖 |
| `/var/log/*.log` (앱 로그) | 장애 원인이 거기 있다. journald와 달리 중앙 수집 보장이 없다 |
| OpenSearch 인덱스 (`keiwi-logs-*`) | 보존정책(ISM 365일)이 정본이다. 개별 삭제는 비가역이고 관측을 깎는다 |
| Prometheus TSDB | 30일 보존이 임계 산정의 전제다. 줄이면 알림 임계 근거가 무너진다 |

> `/tmp`는 spec §4.4 초안의 `allowed_paths` 예시에 들어 있었으나 위 실측을 근거로
> **뺐다.** "관례상 임시 디렉터리"와 "이 플릿에서 실제로 임시인 디렉터리"는 다르다.

## 3. journal vacuum이 "가역"인 근거 — 그리고 그 근거가 깨지는 순간

이 절차에서 유일하게 논쟁적인 것이 1번이다. 지운 journal 항목 자체는 안 돌아온다.
그런데도 `reversible: true`인 이유는 **원본이 다른 평면에 남아 있기 때문**이다:

```text
journald ──▶ keiwi-filebeat ──▶ Logstash ──▶ OpenSearch (keiwi-logs-*, ISM 365일)
```

**따라서 이 근거는 인입이 살아 있을 때만 참이다.** 인입이 끊긴 구간은 노드의 journal이
**유일본**이고, 그 구간을 vacuum하면 되돌릴 수 없다.

> [!CAUTION]
> **가장 위험한 순서**: 디스크가 차서 → OpenSearch가 watermark로 쓰기를 멈추고 →
> 인입이 끊긴 상태에서 → 공간을 벌겠다고 journal을 vacuum. **그 구간의 로그는 영영 사라진다.**
> DiskUsageHigh와 LogIngestStalled가 함께 떠 있으면 이 조합이다.
> 그래서 `precheck-ingest-alive`가 **선행조건이지 진단이 아니다** — 실패하면 멈춘다.

```bash
# 선행조건 — 20초 사이에 건수가 늘어야 인입이 살아 있는 것이다
curl -s 'localhost:9200/keiwi-logs-*/_count'; sleep 20; curl -s 'localhost:9200/keiwi-logs-*/_count'
```

늘지 않으면 **여기서 멈추고** [log-ingestion-stopped.md](./log-ingestion-stopped.md)로 간다.
인입을 먼저 살린 뒤에 돌아온다. (`journalctl --vacuum-*` 대신 `apt-get clean`·docker
prune만 먼저 돌리는 것은 안전하다 — 2·3번은 인입과 무관하다.)

## 4. 회수 가능량 계측 — 지우기 전에 얼마를 벌 수 있는지 안다

```bash
journalctl --disk-usage
du -sh /var/cache/apt/archives
sudo docker system df
```

합계가 현재 여유의 의미 있는 몫이 아니면 **이 절차를 돌리지 않는다.** 1GB를 벌겠다고
로그 보존을 깎는 것은 관측을 파는 것이고, §1의 실측이 그 거래가 대개 손해임을 보여준다.

## 5. 실행 (순서 고정 — 위험도 낮은 것부터)

```bash
sudo apt-get clean
sudo docker image prune -f
sudo journalctl --vacuum-size=200M
```

- **`--vacuum-size=200M`은 삭제가 아니라 상한 설정이다.** 최신 로그부터 200M을 남기고
  오래된 것을 버린다. 상한을 영구화하려면 `/etc/systemd/journald.conf`의
  `SystemMaxUse=`를 손대는 편이 낫다(그쪽은 설정 변경이라 이 절차 밖 · 사람이).
- `docker image prune`에 **`-a`를 붙이지 마라.** `-a`는 "실행 중이 아닌 모든 이미지"를
  지워 다음 배포에서 전부 다시 받게 만든다. 화이트리스트는 **dangling만**이다.
- data01(16.04)은 journald 설정이 다른 세대다. 위 명령은 동작하지만 회수량이 작다.

## 6. 검증 — 지웠는데 안 줄어드는 경우가 있다

```bash
df -h /
sudo lsof +L1 2>/dev/null | head -20
```

`df`가 안 줄었으면 **삭제된 파일을 프로세스가 아직 잡고 있다**(`lsof +L1`의 링크수 0 항목).
그 프로세스를 재시작해야 공간이 돌아오고, 그 재시작은 이 절차 밖이다 — 소유자 확인 후
사람이 한다.

메트릭 평면으로도 확인한다(알림이 실제로 꺼지는지):

```bash
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=100 * (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs"})'
```

## 7. 이 절차가 반복되면 그건 정리 문제가 아니다

같은 노드에서 월 2회 이상 이 절차를 돌리게 되면 **회수로 버티는 상태**다.
그때 필요한 것은 더 공격적인 화이트리스트가 아니라 다음 중 하나다:

- **이전(移轉)** — data04는 `/data`에 21T가 놀고 있다(disk-pressure.md §3).
- **보존 설계 재검토** — journald `SystemMaxUse` 영구 상한.
- **용량 증설 안건.**

화이트리스트를 넓히는 것은 마지막에 검토하고, 넓힐 때는 **(경로, 도구, 안전 근거)**
세 쌍을 §2 표에 함께 적는다. 근거를 못 적으면 넓히지 않는다.

## 관련

- [disk-pressure.md](./disk-pressure.md) — 담당 알림 런북(진단·분기). 여기로 오기 전에 읽는다
- [log-ingestion-stopped.md](./log-ingestion-stopped.md) — §3 선행조건이 깨졌을 때
- [rsyslog-omfile-flood.md](./rsyslog-omfile-flood.md) — 로그 폭주가 원인일 때(정리 대상이 다르다)
- [specs/auto-remediation](../../specs/auto-remediation/spec.md) §1·§4.1 — 이 절차가 L3 후보인 근거

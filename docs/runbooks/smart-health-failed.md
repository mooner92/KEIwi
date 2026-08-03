---
id: smart-health-failed
kind: alert
alerts: [SmartHealthFailed]
service: smartctl-exporter
category: infra
severity: critical
affected_nodes: [data03, data05]
last_verified: 2026-08-03
---

# 런북 · SMART 헬스 실패 (SmartHealthFailed)

> **먼저 한계를 읽어라(§1).** 이 알림은 "디스크가 곧 죽는다"가 아니라
> **"RAID 논리 볼륨이 실패를 보고했다"**이다. KEIwi의 SMART 수집은 RAID 컨트롤러 뒤의
> **물리 디스크를 하나도 보지 못한다.** 이걸 모르면 진단이 처음부터 어긋난다.

> 표기 규약: `"<…>"` 자리표시자는 따옴표 안에 둔다(게이트 R10).

## 1. 한계 — 이 알림이 보는 것은 논리 볼륨뿐이다 [실측 2026-08-03]

```text
smartctl_device 시리즈 3개 — 전부 model_name="HPE LOGICAL VOLUME" (protocol=SCSI)
  data03 sda   serial=PEYHD0DRHBY1W6
  data05 sda   serial=PZXNL0ARHFU8J0
  data05 sdb   serial=PZXNL0ARHFU8J0   ← sda와 같은 시리얼. 물리 디스크 식별자가 아니다
물리 디스크(cciss/,N 뒤의 실제 드라이브) 노출 개수 = 0
```

| 결과 | 뜻 |
| --- | --- |
| **디스크 1장이 죽어도 이 알림은 안 울릴 수 있다** | RAID가 흡수하면 LV는 여전히 PASSED다 |
| **이 알림이 울리면 이미 심각하다** | 논리 볼륨 수준에서 실패 = RAID의 여유가 이미 소진됐을 가능성 |
| `serial_number`로 물리 디스크를 지목할 수 없다 | LV 시리얼이다(data05는 sda·sdb가 동일) |
| 마모도·재할당 섹터·디스크 온도 없음 | 예측용 SMART 속성이 LV에는 없다 |

**커버리지 구멍도 있다** — `infra/monitoring/prometheus.yml`의 `smartctl-exporter` job:

| 노드 | 수집 | 비고 |
| --- | --- | --- |
| data05 | ✅ | 호스트 systemd 익스포터(172.18.0.1:9633) |
| data03 | ✅ | 직접 스크랩(ufw `.105→9633` 허용 전제) |
| **data04** | ❌ | 터널 포트 미추가로 **주석 처리 상태**(9634 배선 대기) |
| **data01** | ❌ | 미배포(16.04) |

→ **data01·data04는 디스크가 죽어도 이 알림이 뜨지 않는다.** "알림이 없다 = 건강하다"가 아니다.

> 물리 디스크 가시화(RAID 뒤 `smartctl -d cciss,N` 수집)는 **[fleet-hardening 축2](../../specs/fleet-hardening/spec.md)**
> 소관이다. 여기에 그 설계를 복사하지 않는다 — 축2가 배포되면 이 §1을 갱신한다(축2 T2-9).

## 2. 30초 판별

```bash
# ① 어느 장치가 실패 보고인가 (1=PASSED, 0=FAILED)
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=smartctl_device_smart_status' \
  | python3 -c "import sys,json;[print(s['metric'].get('node'), s['metric'].get('device'), 'PASSED' if s['value'][1]=='1' else 'FAILED') for s in json.load(sys.stdin)['data']['result']]"

# ② 그 장치가 무엇인가 (LV인지 실제 디스크인지 — 지금은 전부 LV다)
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=smartctl_device'

# ③ 익스포터가 살아 있는가 (NoData와 FAILED를 혼동하지 않기 위해)
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=up{job="smartctl-exporter"}'
```

**③이 0이면 이 알림은 뜨지 않는다** — 규칙의 `noDataState`가 `NoData`이기 때문이다
(스크랩 실패를 오발화로 만들지 않으려는 의도적 선택). 즉 **exporter가 죽은 것과 디스크가
건강한 것이 겉보기에 같다.** 정기적으로 ③을 확인하는 것이 이 알림의 전제 조건이다.

```bash
# ④ 진짜 상태는 노드에서 본다 (읽기 전용 — RAID 컨트롤러 뒤까지 본다)
ssh -p 764 "<user>@<node-ip>"        # 예: ssh -p 764 mooner92@192.168.1.103
sudo smartctl -H /dev/sda                     # LV 수준(익스포터가 보는 것과 동일)
ls -l /sys/class/scsi_generic/                # 컨트롤러 sg 노드 (data03=sg2, data04=sg3, data05=sg4)
sudo smartctl -d cciss,0 -H -i /dev/sg2       # ← 물리 디스크 0번. 인덱스를 0,1,2… 늘려가며 확인
sudo dmesg -T | grep -iE 'hpsa|cciss|I/O error|medium error' | tail -20
```

> `cciss,N`의 **N은 고정된 식별자가 아니다** — 디스크를 교체하면 인덱스가 밀린다.
> 장치를 지목할 때는 **시리얼**을 적어라(축2가 같은 원칙을 쓴다).

## 3. 원인 분기

| 관찰 | 판정 | 조치 |
| --- | --- | --- |
| `smart_status`=0 + `dmesg`에 I/O·medium error | **진짜 디스크 실패** | §4 — 즉시 |
| `smart_status`=0 인데 dmesg 조용 | 컨트롤러/펌웨어 보고 이상 | ④의 `cciss,N`로 물리 디스크 개별 확인 |
| 시리즈 사라짐(NoData) | exporter·스크랩 문제 | [node-down.md](./node-down.md) §3 (경로·서비스) |
| 물리 1장 고장인데 알림 없음 | **정상 동작**(§1 한계) | RAID 상태를 별도로 봐야 한다 — ④ |

## 4. 조치 (데이터가 걸려 있다 — 순서를 지킨다)

1. **백업 상태부터 확인한다.** 연구 데이터는 재현 불가다. 교체·리빌드는 **부하가 걸리는 작업**이고
   그 과정에서 두 번째 디스크가 죽는 사례가 흔하다.
2. **RAID 상태 확인** — 어느 물리 디스크가 degraded인지(④). LV가 FAILED면 이미 여유가 없을 수 있다.
3. **쓰기를 줄인다** — 그 노드에서 도는 대용량 쓰기 잡을 **소유자 통보 후** 일시 중단
   (§11 — 자동 중단 금지). 리빌드 중 추가 부하는 위험하다.
4. **교체 요청** — 시리얼·슬롯·`dmesg` 원문을 첨부한다. HPE Smart Array는 핫스왑이지만
   **정비창에 사람이** 한다.
5. **복구 후 검증** — `smartctl_device_smart_status`가 1로 돌아오고, `up{job="smartctl-exporter"}`가
   1이며, 축2 배포 후라면 물리 디스크 시리즈가 다시 보이는지.

**하지 말 것**
- 알림이 없다는 이유로 data01·data04 디스크를 건강하다고 판정(§1 커버리지 구멍).
- LV 시리얼로 물리 디스크를 지목(같은 값이 여러 장치에 붙는다).
- 리빌드 중 벤치마크·대용량 복사.

## 5. 사후·재발방지

- 교체했다면 **시리얼·슬롯·교체일**을 기록한다. 인덱스(`cciss,N`)는 밀리므로 시리얼이 유일한 고정 키다.
- 같은 노드에서 반복되면 개별 디스크가 아니라 **컨트롤러·백플레인·전원**을 의심한다.
- 이 알림이 한 번도 울리지 않았다는 사실은 **아무것도 증명하지 않는다**(§1). 분기마다
  ④를 수동 점검하는 편이 현 구조에서는 더 신뢰할 수 있다 — 축2 배포로 이 수동 점검을 없애는 것이 목표다.

## 관련

- [fleet-hardening 축2](../../specs/fleet-hardening/spec.md) — RAID 뒤 물리 디스크 SMART 수집 설계
- `infra/monitoring/smartctl-exporter/README.md` — 익스포터 배포(수집 구조)
- [disk-pressure.md](./disk-pressure.md) — 용량 문제(고장과 다른 축)
- [node-down.md](./node-down.md) — exporter가 죽어 NoData일 때

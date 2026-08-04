---
id: disk-grown-defects
kind: alert
alerts: [DiskGrownDefectsGrowing, DiskUncorrectedErrorsGrowing, PhysicalDiskDisappeared]
service: disk-smart-textfile
category: infra
severity: warning
affected_nodes: [data03, data04, data05]
last_verified: 2026-08-03
# tier 1 = L1 제안까지. 처방이 물리 교체라 smart-health-failed와 같은 이유로 자동경로가 없다.
#   유일한 상태 변경 조치인 수집기 킬 스위치는 **관측 사각지대를 만드는 조치**이므로
#   (끄면 물리 디스크가 다시 안 보인다) 사람이 의도적으로 골라야 한다 — risk: medium.
tier: 1
actions:
  - id: list-growing-defects
    title: 어느 디스크가 얼마나 늘었나 (시리얼이 물리 식별자다)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -sG localhost:9090/api/v1/query --data-urlencode
      'query=increase(node_smart_disk_grown_defect_list[24h]) > 0'
  - id: check-collector-freshness
    title: 수집기가 살아 있는가 (낡은 .prom을 현재값으로 오인하지 않기 위해)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -sG localhost:9090/api/v1/query --data-urlencode 'query=time() -
      node_smart_collector_last_run_timestamp_seconds'
  - id: check-disk-count
    title: 대수가 유지되는가 (LV가 절대 말해주지 않는 사실)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -sG localhost:9090/api/v1/query --data-urlencode 'query=node_smart_disks'
  - id: kill-switch-disk-smart
    title: 수집기 자체가 문제일 때의 킬 스위치 (끄면 사각지대가 돌아온다)
    risk: medium
    reversible: true
    idempotent: true
    command: >-
      sudo systemctl disable --now keiwi-disk-smart.timer
---

# 런북 · 물리 디스크 열화 (DiskGrownDefectsGrowing · DiskUncorrectedErrorsGrowing · PhysicalDiskDisappeared)

> RAID 컨트롤러 **뒤**의 물리 디스크가 나빠지고 있다는 신호다.
> 논리 볼륨(`smartctl_device_smart_status`)은 이 상황에서 끝까지 `OK`를 말한다 —
> data04 `ZC1AE78X`는 grown defect 773개를 안고도 LV 판정은 `PASSED`였다.

> **킬 스위치**: 수집기가 문제면 `sudo systemctl disable --now keiwi-disk-smart.timer`
> (읽기 전용 수집이라 끄는 것 자체는 안전하다. 끄면 물리 디스크가 다시 사각지대가 된다).

> 표기 규약: `"<…>"` 자리표시자는 따옴표 안에 둔다(게이트 R10).

## 1. 이 알림이 말하는 것 / 말하지 않는 것

| 알림 | 발화식 | `for` | 실제 의미 |
| --- | --- | --- | --- |
| `DiskGrownDefectsGrowing` | `increase(node_smart_disk_grown_defect_list[24h]) > 0` | 0s | **오늘 새 불량섹터가 생겼다.** 재할당 여력을 갉아먹는 중 |
| `DiskUncorrectedErrorsGrowing` | `increase(node_smart_disk_uncorrected_errors_total[24h]) > 0` | 0s | **재시도로도 못 살린 I/O가 있었다** = 데이터 손실이 실현됨 |
| `PhysicalDiskDisappeared` | `node_smart_disks - (node_smart_disks offset 1h or node_smart_disks) < 0` | 10m | 대수가 줄었다. 어레이는 degraded 상태에서도 OK를 말한다 |

**임계가 증가량인 이유** — data04에 이미 GDL 773·66이 있다. `> 0`(절대값)을 걸면 첫날부터
critical 2건이 상주 발화하고, 그것이 T0-7이 "알림 무시 습관의 시작"으로 지목한 패턴이다.
HPE는 grown defect 권고 수치를 주지 않으므로 "50 넘으면 교체" 같은 임계는 근거가 없다.
**기존 773은 알림이 아니라** 대시보드(syshealth 「결함 섹터 상위 10」)와 교체 티켓으로 처리한다.

**이 알림이 보지 못하는 것 (정직하게)**

- **베이/슬롯 번호.** SES가 data03·04(12슬롯)·data05(8슬롯) 전 슬롯을 `not installed`로 보고한다.
  `cciss,N`의 N은 컨트롤러 내부 열거 순서지 베이가 아니고 **교체하면 밀린다.**
  → 물리 특정은 **오직 시리얼**로 한다. 인덱스로 디스크를 뽑으면 **정상 디스크를 뽑는다.**
- **RAID 어레이 상태.** `ssacli`/`hpssacli`가 4노드 어디에도 없다(범위 밖).
  "몇 본이 빠져도 견디는가"는 이 신호로 알 수 없다.
- **컨트롤러 자체가 사라진 경우.** 그러면 `node_smart_disks` 시리즈가 통째로 없어지고
  `PhysicalDiskDisappeared`는 **울리지 않는다**(뺄셈의 양변이 함께 사라진다).
  그 경우는 `NodeHygieneCoverageGap`·수집기 신선도 쪽에서 잡힌다.
- **data01(27.3T LV).** smartmontools 6.4는 `--json`이 없어 수집 대상이 아니다.
  이 노드는 **여전히 사각지대**다(fleet-hardening T2-17 판정 대기).

## 2. 30초 판별 (복붙 가능한 명령만)

```bash
# ① 어느 디스크가, 얼마나 늘었나 (시리얼이 물리 식별자다)
curl -sG localhost:9090/api/v1/query \
  --data-urlencode 'query=increase(node_smart_disk_grown_defect_list[24h]) > 0' \
  | python3 -c "import sys,json;[print(s['metric'].get('instance'), s['metric'].get('serial'), s['value'][1]) for s in json.load(sys.stdin)['data']['result']]"

# ② 그 디스크의 현재 누적값·모델 (교체 판단의 분모)
curl -sG localhost:9090/api/v1/query \
  --data-urlencode 'query=node_smart_disk_grown_defect_list' \
  | python3 -c "import sys,json;[print(s['metric'].get('instance'), s['metric'].get('serial'), s['value'][1]) for s in sorted(json.load(sys.stdin)['data']['result'], key=lambda x: -float(x['value'][1]))]"

# ③ 수집기가 살아 있는가 (낡은 .prom을 살아있는 값으로 오인하지 않기 위해)
curl -sG localhost:9090/api/v1/query \
  --data-urlencode 'query=time() - node_smart_collector_last_run_timestamp_seconds'

# ④ 대수가 유지되는가 (기대: data03 12 · data04 12)
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=node_smart_disks'
```

**판독표**

| 보이는 것 | 뜻 |
| --- | --- |
| ①이 비었는데 알림이 떴다 | 이미 해소(24h 창이 지나감). 오탐 아님 — ②로 누적값만 확인 |
| ③이 1800보다 크다 | 수집기가 30분 넘게 안 돌았다. 값이 **낡았다** — 타이머부터 본다(§3) |
| ④가 12가 아니다 | 대수 감소. **이것이 LV이 절대 말해주지 않는 사실이다** |
| `node_smart_*`가 아예 없다 | 수집기 미배포 노드. "알림 없음 = 건강"이 아니다 |

```bash
# ⑤ 노드에서 직접 대조 (읽기 전용. -t 를 절대 쓰지 않는다 — 셀프테스트는 부하다)
ssh -p 764 "<user>@<node-ip>"        # 계정은 노드별 — 레포에 적지 않는다(대상 노드 `ls /home`)
ls -l /sys/class/scsi_generic/       # device/type 이 12인 것이 RAID 컨트롤러 (data03=sg2, data04=sg3, data05=sg4)
for n in $(seq 0 15); do
  sudo smartctl --json -d "cciss,$n" /dev/sg2 \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(n if False else d.get('serial_number'), d.get('scsi_grown_defect_list'))"
done
sudo dmesg -T | grep -iE 'smartpqi|hpsa|cciss|I/O error|medium error' | tail -20
```

## 3. 원인 분기표

| 관찰 | 1차 판정 | 첫 조치 |
| --- | --- | --- |
| GDL 증가 + `dmesg`에 medium error | **디스크 열화 진행** | §4 — 교체 계획(즉시 교체는 아니다) |
| GDL 증가인데 `dmesg` 조용 | 재할당이 조용히 성공 중 | 추세만 기록. 증가 속도가 붙으면 교체 |
| 미교정 오류 증가 | **데이터 손실 실현** | §4 — 백업 확인 후 우선 교체 |
| 대수 감소 + 해당 시리얼이 목록에서 사라짐 | 디스크 이탈/사망 | §4 — 어레이 여유 확인이 최우선 |
| 대수 감소인데 시리얼은 그대로 | 프로브 실패(타임아웃) | `node_smart_collector_probe_errors` 확인 → 수집기 §3 |
| ③이 크고 값이 안 변함 | 수집기 정지 | `systemctl status keiwi-disk-smart.timer`·`journalctl -u keiwi-disk-smart` |
| 여러 디스크에서 동시에 증가 | 개별 디스크가 아님 | **컨트롤러·백플레인·전원**을 의심한다 |

수집기 자체가 문제라고 판정됐을 때만(위 표의 마지막 두 행) 킬 스위치를 쓴다:

```bash
sudo systemctl disable --now keiwi-disk-smart.timer
```

> 읽기 전용 수집이라 끄는 것 자체는 안전하지만, **끄면 RAID 뒤 물리 디스크가 다시
> 사각지대가 된다.** 되돌리려면 `sudo systemctl enable --now keiwi-disk-smart.timer`.

## 4. 조치 (파괴 강도 순 · 소유자 확인 게이트)

1. **백업 상태부터 확인한다.** 연구 데이터는 재현 불가다. 교체·리빌드는 부하 작업이고
   그 과정에서 두 번째 디스크가 죽는 사례가 흔하다.
2. **시리얼로 물리 디스크를 특정한다.** ①·②가 준 시리얼을 적는다.
   **`cciss,N`의 N을 베이 번호로 옮겨 적지 않는다** — 그 숫자로 디스크를 뽑으면 정상 디스크를 뽑는다.
3. **어레이 여유를 확인한다.** RAID6이면 2본까지 견디지만, 이미 1본이 나갔다면 여유는 1본이다.
   `ssacli`가 없으므로 이 확인은 **iLO 웹 콘솔 또는 정비창의 사람**이 한다.
4. **쓰기를 줄인다** — 그 노드의 대용량 쓰기 잡을 **소유자 통보 후** 일시 중단(헌장 §11 — 자동 중단 금지).
5. **HPE 예비 부품 확인 → 교체 요청.** 첨부: 시리얼 · 모델 · POH · GDL 추이 · `dmesg` 원문.
   4TB SAS(MB4000JVYZQ / MB004000JWKGU)는 핫스왑이지만 **정비창에 사람이** 한다.
6. **교체 후 검증** — `node_smart_disks`가 원래 값으로 복귀하고, 새 시리얼이 목록에 나타나며,
   그 시리얼의 GDL이 0인지.

**하지 말 것**

- **임계를 올려 알림을 끄는 것.** 이 알림은 증가량 기준이라 올릴 임계 자체가 없다 —
  시끄럽다면 그것은 진짜로 디스크가 나빠지고 있다는 뜻이다.
- `smartctl -t`(셀프테스트) 실행. 디스크에 실제 부하를 걸고, 연구 잡 옆에서 할 일이 아니다.
- 인덱스(`cciss,N`)로 베이를 지목. **되돌릴 수 없는 사고**로 이어진다.
- 논리 볼륨 판정(`smartctl_device_smart_status`)이 `PASSED`라는 이유로 이 알림을 무시하는 것.
  그 판정이 무력하다는 사실이 이 수집기가 존재하는 이유다.

## 5. 사후·재발방지

- **오탐 판정 기준**: 단발 증가(24h에 1~2개, 이후 정지)는 재할당이 정상 동작한 것이다 —
  기록만 남긴다. **지속 증가**(며칠 연속, 또는 하루 수십 개)가 교체 신호다.
  syshealth 「결함 섹터 증가 (7일 창)」에서 선이 계속 떠 있으면 후자다.
- 교체했다면 **시리얼·모델·교체일·직전 GDL**을 기록한다. 인덱스는 밀리므로 시리얼이 유일한 고정 키다.
- 같은 노드에서 여러 디스크가 동시에 나빠지면 개별 디스크가 아니라 구조(컨트롤러·백플레인·전원·발열)를 본다.
- 2주 알림 리뷰(specs/alerting §10-3)에서 발화 수·조치율을 집계한다. 조치를 못 만든 알림은
  임계 상향이 아니라 **삭제** 대상이다.

## 관련

- [smart-health-failed.md](./smart-health-failed.md) — 논리 볼륨 수준 실패(이 런북과 층이 다르다)
- [disk-pressure.md](./disk-pressure.md) — 용량 문제(고장과 다른 축)
- [ADR-0024](../decisions/0024-physical-disk-smart-collection.md) — 왜 textfile 수집인가
- `infra/monitoring/disk-smart/README.md` — 수집 구조·킬 스위치·data01 분기
- [fleet-hardening 축2](../../specs/fleet-hardening/spec.md) — 설계 정본

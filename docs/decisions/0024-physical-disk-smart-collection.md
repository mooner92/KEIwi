# 0024 — 물리 디스크 SMART 수집 방식 (textfile collector vs 업스트림 exporter)

- 상태: 채택(2026-08-03)
- 맥락: [specs/fleet-hardening §2](../../specs/fleet-hardening/spec.md) · [ADR-0017](./0017-node-onboarding-standard.md)(에이전트=Ansible role) · 헌장 §8/§11/§12
- 관련: `infra/monitoring/disk-smart/README.md` · `infra/ansible/roles/disk-smart-textfile/` · `docs/runbooks/disk-grown-defects.md` · [ADR-0022](./0022-error-tracking-glitchtip.md)

## 맥락

플릿의 디스크 건강 신호는 `smartctl_device_smart_status` **3계열이 전부**이고 셋 다
`model_name="HPE LOGICAL VOLUME"`이다. data05 sda·sdb는 `serial_number`까지 동일
(`PZXNL0ARHFU8J0` — 컨트롤러 시리얼이지 디스크 시리얼이 아니다).

RAID 컨트롤러 뒤에는 **물리 디스크 24본**(data03 12 · data04 12)이 있고, 그중 2본이
지금 열화 중이다 [실측 2026-08-03]:

| 노드 | 시리얼 | POH | grown defect | 미교정 | **LV 판정** |
| --- | --- | --- | --- | --- | --- |
| data04 | `ZC1AE78X` | 63,802h | **773** | 0 | PASSED |
| data04 | `ZC1968JB` | 63,802h | **66** | read 8 / write 1 | PASSED |

두 디스크가 구성하는 24.0TB LV은 `SMART Health Status: OK`,
`Error Counter logging not supported`, `Current Drive Temperature: 0 C`를 반환한다.
즉 **논리 볼륨은 이 사실을 구조적으로 말할 수 없고**, 기존 `SmartHealthFailed` 알림은
이 두 디스크에 대해 원리적으로 무력했다.

`smartctl --scan-open`은 물리 디스크를 하나도 찾지 못한다(data03 `/dev/sda -d scsi`뿐).
그러나 **`-d cciss,N` 패스스루는 동작한다** — data03·data04 각 12본이 응답한다.

## 결정

### 1. 업스트림 `smartctl_exporter` 확장을 **기각**하고 node-exporter textfile collector로 간다

두 지점이 우리 하드웨어에서 원리적으로 막는다. **v0.14.0과 현재 master 양쪽에서 같은 행
번호로 직접 확인했다**(2026-08-03, `raw.githubusercontent.com`):

- **B1 `smartctl.go:45` `buildDeviceLabel(inputName, inputType)`** — 인덱스를 라벨에 붙이는
  조건이 `strings.Contains(inputType, ",")`(`smartctl.go:50`)인데, smartctl JSON의
  `device.type`은 `"cciss"`(SATA는 `"sat"`)로 **콤마가 없다**. 12본이 전부 `device="sg2"`가
  되어 중복 계열 → `/metrics` 500. **udev 심볼릭 링크로 우회 가능.**
- **B2 `smartctl.go:116` `if smart.device.interface_ == "scsi"`** — `-d cciss,N` 응답의
  `interface_`는 `"cciss"`라 이 분기에 들어가지 않는다. 그 안의
  `mineSCSIGrownDefectList()`(`smartctl.go:117`)·`mineSCSIErrorCounterLog()`가
  **실행되지 않는다** = grown defect와 미교정 오류, 즉 이 축의 **핵심 신호 전량이 유실**된다.
  **코드 분기라 우회 불가.**

우리가 필요한 바로 그 두 신호가 죽는다. 업스트림 패치 + Go 툴체인 + 오프라인 vendoring +
드리프트 추적 비용은, 4노드에 **이미 살아 있는** textfile 경로(`node_textfile_scrape_error`가
4노드 전부 0)를 놀리면서 치를 비용이 아니다.

덤으로 **신규 포트 0 · 신규 터널 항목 0 · ufw 규칙 0 · Prometheus job 0**이다 —
data04의 별도 터널 포트 블로커가 이 결정으로 **소멸했다**. 기존 `roles/smartctl-exporter`(:9633)는
**유지**하되 대시보드에서 "논리 볼륨"으로 명확히 강등한다(라이브 green이고 LV 단위 사실을 준다).

### 2. 신규 role `disk-smart-textfile` — node-hygiene 확장이 **아니다**

`node-hygiene`은 소비처 선언·apt 노드 판별을 자기 계약으로 갖고 주기가 30분이다.
같은 스크립트에 SMART를 얹으면 **`set -e` 하나로 apt 실패가 SMART 수집까지 죽인다.**
가드 조건(smartctl 버전)도, 주기(15분)도, 실패 영향 범위도 다르다.

### 3. 신규 이름공간 `node_smart_*` — `smartctl_device_*`를 재사용하지 않는다

같은 이름에 LV 사실과 물리 디스크 사실이 섞이면 `count()`·`min()`이 조용히 거짓말을 한다
(3 vs 24). 라벨 스키마도 job도 다르다(`:9633` vs `:9100`).

**만들지 않는 것**도 결정의 일부다: 베이/슬롯 번호(SES가 전 슬롯을 `not installed`로 보고 —
틀린 베이 번호는 **정상 디스크를 뽑는** 되돌릴 수 없는 사고를 만든다) · `verify`·Non-medium
error(JSON에 ABSENT) · `eccfast`/`eccdelayed`(벤더 상대값. data03 `cciss,0`은 eccdelayed 405인데
GDL 0·미교정 0인 정상 디스크다) · 통합 SSD 수명%(벤더마다 속성 id가 달라 합성하면 거짓) ·
RAID 어레이 상태(`ssacli` 4노드 미설치).

### 4. data01(Ubuntu 16.04)은 정적 바이너리 vendoring — **동작 검증 후에만**

apt 후보가 6.4(`--json` 미지원)다. [`infra/logging/filebeat-xenial`](../../infra/logging/filebeat-xenial/README.md)이
세운 전례(xenial 전용 정적 바이너리 vendoring)를 따르고, role은 `disk_smart_smartctl_path`
하나만 override 하면 나머지 경로가 동일하다.

**단, hpsa(P840ar)에서 `-d cciss,N`이 동작하는지는 미검증이다**(실측된 것은 smartpqi뿐).
검증 실패 시 **data01을 범위 밖으로 명시하고 27.3T LV 하나가 사각지대로 남는다는 사실을
숨기지 않는다.**

### 5. 알림은 전부 **증가량** 기준 (절대 임계 금지)

data04에 이미 GDL 773·66이 있어 `> 0`을 걸면 첫날부터 critical 2건이 상주 발화한다 —
T0-7이 "알림 무시 습관의 시작"으로 지목한 패턴이다. HPE가 권고 수치를 주지 않으므로
"50 넘으면 교체" 같은 임계는 근거가 없고, 노드·모델·가동시간마다 의미가 달라 서버별 임계
지옥이 된다. 기존 773은 **대시보드 + 교체 티켓**으로 처리한다.

## 고려한 대안

| 대안 | 왜 기각했나 |
| --- | --- |
| 업스트림 패치 + 자체 빌드 vendoring | Go 툴체인·오프라인 바이너리·드리프트 추적 비용이 셸 1개보다 크고, 살아 있는 textfile 경로를 놀린다. (업스트림 기여 자체는 별건 백로그로 열어 둔다) |
| `roles/smartctl-exporter` 전면 철거 | green 자산을 없애 가치 0을 얻고 `SmartHealthFailed`를 다시 짜야 한다. 문제는 존재가 아니라 **명명이 실제 위험을 은폐**하는 것이었다 |
| `smartctl_device_*` 이름 재사용 | 기존 대시보드가 자동으로 살아나는 매력이 있으나, 관측 스택이 거짓말하지 않는 것이 이 축의 존재 이유다 |
| node-hygiene에 SMART 블록 추가 | 가드를 풀면 apt 판별 로직이 무너지고, apt 실패가 SMART 수집까지 같이 죽인다(한 스크립트 `set -e`) |
| `smartctl -a` 텍스트 병행 파싱 | 파서 표면적 2배 + hardware-ops C5(root 셸의 외부 텍스트 정규식 파싱) 위험 재현 |
| data01에 apt 6.4 설치 후 텍스트 파싱 | 파서 2벌. 텍스트 레이아웃은 버전마다 바뀐다 |
| data01을 조용히 제외 | 27.3T가 사각지대인 사실을 숨기게 된다 — 이 축이 고치려는 실패모드 그 자체 |
| `disk_index`를 베이 번호로 라벨링 | 런북에서 "3번 베이를 빼라"고 쓰게 되고, 틀리면 **정상 디스크를 뽑는다.** 되돌릴 수 없다 |
| `grown_defect_list > 50` 절대 임계 | 임계 근거가 없고(HPE 미제공) day-1 상주 발화 |

## 결과

- **얻는 것**: RAID 뒤 24본이 관측 가능해진다. 열화 2본이 **처음으로 그래프에 뜬다.**
  `node_smart_disks`가 LV이 절대 말해주지 않는 "디스크가 사라졌다"를 알려준다.
  data04 터널 블로커 소멸(신규 포트 0). data05(컨테이너)·data01(수동설치)도 같은 경로로 덮인다.
- **치르는 것**: 연구 노드에서 15분마다 도는 주기 작업이 하나 늘어난다
  (12본 × 4회/시 = 48 커맨드/시 ≒ 0.013 cmd/s. `-i/-H/-A/-l error`는 컨트롤러 펌웨어가 답하는
  메타데이터 조회이지 플래터 탐색이 아니고, `Nice=10`·`IOSchedulingClass=idle`로 양보한다.
  1회 소요 실측 3.6초). 셸+python 수집기 1개를 우리가 유지해야 한다.
- **남는 사각지대**: data01(검증 전) · RAID 어레이 여유 수준 · 베이 번호.
  숨기지 않고 README·런북·spec에 그대로 적었다.

## 되돌리기 조건

**업스트림이 B2(`smartctl.go:116`의 `interface_ == "scsi"` 게이트)를 고쳐 cciss/SAT 응답까지
SCSI miner를 돌리면 이 결정을 재검토한다**(백로그 FB-01). 그 시점에는 기성 exporter를 쓰는 쪽이
유지비가 싸다. B1(라벨 충돌)만 고쳐지는 것으로는 부족하다 — 우리가 필요한 신호는 B2 뒤에 있다.

두 번째 조건: `ssacli`/`hpssacli`가 플릿에 도입되면 어레이 여유 수준을 직접 읽을 수 있게 되고,
그때는 "대수 감소"(`PhysicalDiskDisappeared`)보다 정확한 신호가 생긴다 — 알림을 그쪽으로 옮긴다.

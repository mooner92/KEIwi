# 물리 디스크 SMART 수집 (RAID 컨트롤러 뒤)

> 정본 설계: [`specs/fleet-hardening/spec.md` §2](../../../specs/fleet-hardening/spec.md) ·
> 결정 기록: [ADR-0024](../../../docs/decisions/0024-physical-disk-smart-collection.md) ·
> 런북: [`docs/runbooks/disk-grown-defects.md`](../../../docs/runbooks/disk-grown-defects.md)
>
> 배포는 Ansible role [`infra/ansible/roles/disk-smart-textfile`](../../ansible/roles/disk-smart-textfile)이 한다.
> 이 디렉터리는 **문서와 data01용 벤더링 자리**다 — 실행 코드는 role 안에 있다.

## 1. 무엇을 고치는가

플릿에 들어오는 디스크 건강 신호는 `smartctl_device_smart_status` **3계열이 전부**이고
셋 다 `model_name="HPE LOGICAL VOLUME"`이다. data05 sda·sdb는 `serial_number`까지 같다
(`PZXNL0ARHFU8J0` — 컨트롤러 시리얼이지 디스크 시리얼이 아니다).

그 뒤에 **물리 디스크 24본**이 있고, 그중 2본은 지금 열화 중이다 [실측 2026-08-03]:

| 노드 | 시리얼 | 모델 | POH | grown defect | 미교정 | LV 판정 |
| --- | --- | --- | --- | --- | --- | --- |
| data04 | `ZC1AE78X` | MB4000JVYZQ | 63,802h | **773** | 0 | **PASSED** |
| data04 | `ZC1968JB` | MB4000JVYZQ | 63,802h | **66** | read 8 / write 1 | **PASSED** |

두 디스크가 구성하는 24.0TB LV(`/dev/sdb`)에 `smartctl -a`를 걸면
`SMART Health Status: OK` · `Error Counter logging not supported` · `Current Drive Temperature: 0 C`다.
**논리 볼륨은 구조적으로 이 사실을 말할 수 없다.**

## 2. 왜 기성 `smartctl_exporter`가 아닌가

두 지점이 우리 하드웨어에서 원리적으로 막는다. **v0.14.0과 현재 master 양쪽에서 같은 행 번호로
직접 확인했다**(2026-08-03, `raw.githubusercontent.com`).

### B1 — 라벨 충돌 (`smartctl.go:45` `buildDeviceLabel`)

```go
// smartctl.go:45
func buildDeviceLabel(inputName string, inputType string) string {
	...
	if strings.Contains(inputType, ",") {   // smartctl.go:50
```

인덱스를 라벨에 붙이는 조건이 **`type`에 콤마가 있을 때**다. 그런데 smartctl JSON의
`device.type`은 `"cciss"`(SATA면 `"sat"`)로 **콤마가 없다** — 우리가 넘기는 인자 `cciss,7`이
아니라 응답 값을 본다. 결과: 12본이 전부 `device="sg2"`가 되어 중복 계열 → `/metrics` 500.

B1만이라면 udev 심볼릭 링크로 우회할 수 있다.

### B2 — SCSI miner 미실행 (`smartctl.go:116`) ← **우회 불가**

```go
// smartctl.go:116
if smart.device.interface_ == "scsi" {
	smart.mineSCSIGrownDefectList()      // smartctl.go:117
	smart.mineSCSIErrorCounterLog()
```

`-d cciss,N` 응답의 `interface_`는 **`"cciss"`**라 이 분기에 들어가지 않는다.
`mineSCSIGrownDefectList`·`mineSCSIErrorCounterLog`가 **실행되지 않는다** =
grown defect와 미교정 오류, 즉 **이 축의 핵심 신호 전량이 유실**된다.

이건 설정이 아니라 코드 분기다. 우회 경로가 없다.

> **되돌리기 조건**: 업스트림이 B2의 `interface_ == "scsi"` 게이트를 고쳐 cciss/SAT 응답까지
> 커버하면 이 결정을 재검토한다(백로그 FB-01). 그때는 우리 textfile 수집기를 버리는 쪽이
> 유지비가 싸다. 업스트림 기여도 열려 있는 선택지다(별건 백로그).

## 3. 어떻게 수집하는가

```
systemd timer(15분)
  └─ keiwi-disk-smart.service (oneshot, Nice=10 / IOSchedulingClass=idle)
       └─ /usr/local/bin/keiwi-disk-smart.sh
            ① /sys/class/scsi_generic/*/device/type == 12 → RAID 컨트롤러 sg 노드
            ② timeout 15 smartctl --json --info --health --attributes --log=error \
                 -d cciss,N /dev/sgX      (N=0..24, 연속 부재 4개면 조기 종료)
            ③ python3 json.load 파싱 → 승인된 메트릭만 방출
            ④ mktemp → chmod 0644 → mv -f   (원자적 교체)
       → /var/lib/node_exporter/textfile/keiwi_disk_smart.prom
  └─ node-exporter(:9100)가 그 파일을 읽어 이미 있는 스크랩에 실어 보낸다
```

**신규 포트 0 · 신규 터널 항목 0 · ufw 규칙 0 · Prometheus job 0.**
그래서 data04의 `:9633` 터널 포트 블로커가 이 축에서 **소멸했다** — 이전 계획은
data04에 별도 터널 포트를 뚫어 논리 볼륨 익스포터를 붙이는 것이었고, 그건 LV 3개를
더 보기 위해 새 포트를 여는 일이었다. `prometheus.yml`의 그 안내 블록은 삭제했다.

**컨트롤러 sg 매핑 [실측]**: data03=`sg2`(P816i-a) · data04=`sg3`(P816i-a) ·
data05=`sg4`(P408i-a) · data01=`sg0`(P840ar, 미검증).
탐색은 `type == 12`(RAID controller)로 한다 — `type 13`은 Smart Adapter(인클로저),
`type 0`은 LOGICAL VOLUME이다. 후자를 잡으면 우리는 다시 LV만 보게 된다.

### `cciss,N`의 N은 **베이 번호가 아니다**

컨트롤러 내부 열거 순서이고 디스크를 교체하면 밀린다. SES는 data03·04(12슬롯)·data05(8슬롯)
**전 슬롯을 `not installed`로 보고**하므로 베이를 알아낼 방법 자체가 없다.
→ 물리 식별은 **오직 `serial`**. 런북에도 같은 원칙을 박아 두었다 —
인덱스로 베이를 지목하면 **정상 디스크를 뽑는 사고**가 난다.

## 4. 무엇을 만들고 무엇을 만들지 않는가

승인 목록은 [spec §2.2 D2-3 표](../../../specs/fleet-hardening/spec.md)가 정본이고,
`scripts/gates/check-smart-metric-allowlist.sh`가 그 표와 수집기를 **양방향** 대조한다
(승인 목록 외 0건 AND 미구현 0건). 즉 이 문서의 목록은 사본이고, 표가 계약이다.

**만들지 않는 것과 그 이유**

| 안 만드는 것 | 이유 |
| --- | --- |
| 베이/슬롯 번호 | SES가 전 슬롯을 `not installed`로 보고. 틀린 베이 번호는 되돌릴 수 없는 사고를 만든다 |
| `verify` 오류 카운터 · Non-medium error | JSON에 **ABSENT**(텍스트 출력 전용). 정규식으로 끌어오면 smartmontools 버전마다 깨진다 |
| `errors_corrected_by_eccfast`/`eccdelayed` | 벤더 상대값이고 고장 신호가 아니다 — data03 `cciss,0`은 eccdelayed **405**인데 GDL 0·미교정 0인 정상 디스크다. 405가 대시보드에서 정상 디스크를 빨갛게 만든다 |
| 통합 "SSD 수명 잔량 %" | 벤더마다 속성 id가 달라 합성하면 **거짓**이 된다. 원시/정규화 속성만 낸다 |
| RAID 어레이 상태 | `ssacli`/`hpssacli`가 4노드 어디에도 없다. 범위 밖(백로그) |
| NVMe 계열 | 플릿에 0개 |
| 컨트롤러 미발견 시 `node_smart_disks 0` | "측정 안 함"이 "디스크 0본(정상)"으로 읽히면 이 축이 고치려는 실패모드의 재생산이다. 시리즈 자체를 만들지 않는다 |

**이름공간을 섞지 않는다.** `smartctl_device_*` = 논리 볼륨 사실, `node_smart_*` = 물리 디스크 사실.
합치면 "몇 본인가"를 묻는 모든 쿼리(`count()`·`min()`)가 조용히 틀린 답을 한다(3 vs 24).

### 이름 2건은 Prometheus 관례에 맞춰 스펙 초안에서 바꿨다

`promtool check metrics`가 초안 이름 2건을 lint 위반으로 거부했다(실측 2026-08-03):

| 초안 | 확정 | 근거 |
| --- | --- | --- |
| `node_smart_disk_power_on_hours` | `node_smart_disk_power_on_seconds` | 기본 단위(초) 관례. 형제 메트릭 `smartctl_device_power_on_seconds`와도 맞는다. 수집기가 ×3600 한다 |
| `node_smart_disks_total` | `node_smart_disks` | `_total`은 counter 전용 접미사다. 형제 `smartctl_devices`(gauge)와 같은 형태 |

## 5. 주기·부하 (연구 노드에서 새로 도는 작업이라 근거를 남긴다)

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 타이머 주기 | **15분** | 상한: AC-2-4가 신선도 < 1800s(30분)를 요구 → 2배 여유. 하한: grown defect는 **일 단위**로 변하므로 5분 주기는 프로브만 3배 늘고 정보는 0. `PhysicalDiskDisappeared`가 `offset 1h`를 쓰므로 1시간에 4회는 찍혀야 한다 |
| 프로브 1회 타임아웃 | 15초 | 정상 응답은 0.2초 수준. 15초는 컨트롤러가 리빌드 중이라 느려진 경우까지 봐준 값 |
| 1회 수집 소요 | **3.6초** [실측 data03, 17회 프로브] | AC-2-7 상한 10초 대비 2.8배 여유 |
| 디스크 부하 | 12본 × 4회/시 = **48 커맨드/시 ≒ 0.013 cmd/s** | `-i/-H/-A/-l error`는 INQUIRY·LOG SENSE·MODE SENSE — 컨트롤러 펌웨어가 답하는 메타데이터 조회이지 **플래터 탐색이 아니다**. 연구 잡의 수천 IOPS 옆에서 측정 불가한 수준 |
| 우선순위 | `Nice=10` · `IOSchedulingClass=idle` | 그래도 양보한다 |
| 타이머 분산 | `RandomizedDelaySec=60` | 4노드가 같은 순간에 컨트롤러를 두드리지 않게 |

**`smartctl -t`(셀프테스트)는 절대 쓰지 않는다.** 그건 디스크에 실제 부하를 거는 작업이고,
연구 잡 옆에서 15분마다 할 일이 아니다. 수집기에도 런북에도 그렇게 적혀 있다.

## 6. 킬 스위치

```bash
# 수집만 멈춘다(파일은 남는다 — 값이 낡으면 신선도 메트릭이 그것을 말해준다)
sudo systemctl disable --now keiwi-disk-smart.timer

# 완전 제거
sudo systemctl disable --now keiwi-disk-smart.timer
sudo rm -f /etc/systemd/system/keiwi-disk-smart.{service,timer} \
           /usr/local/bin/keiwi-disk-smart.sh \
           /var/lib/node_exporter/textfile/keiwi_disk_smart.prom
sudo systemctl daemon-reload
```

읽기 전용 수집이라 끄는 것 자체는 안전하다. 다만 끄면 물리 디스크가 **다시 사각지대**가 되고,
`node_smart_*` 시리즈가 사라지면 `PhysicalDiskDisappeared`는 (양변이 함께 사라져) 울리지 않는다.

## 7. data01 (Ubuntu 16.04) 분기

apt 후보가 smartmontools **6.4**이고 `--json`은 7.0부터다. role의 가드(`smartctl >= 7.0`)에
걸려 **지금은 자동으로 스킵**된다 — 사유를 debug로 찍는다.
정적 바이너리 벤더링 설계는 [`smartmontools-xenial/README.md`](./smartmontools-xenial/README.md).

**hpsa(P840ar)에서 `-d cciss,N`이 동작하는지는 미검증이다.** 검증(T2-17) 전에는 배포하지 않는다.
동작하지 않으면 data01을 이 축의 범위 밖으로 명시하고, **27.3T LV 하나가 사각지대로 남는다는
사실을 숨기지 않는다.**

## 8. 게이트

| 게이트 | 무엇을 보나 |
| --- | --- |
| `scripts/gates/check-smart-metric-allowlist.sh` | spec 승인 목록 ↔ 수집기 방출 이름 **양방향** + 픽스처 렌더 노출 형식(`--render-check`) |
| `scripts/gates/render-smart-fixture.sh` (헬퍼) | 라이브 캡처 픽스처 5건으로 **수집기 자체를** 돌려 `.prom` 생성 |
| `scripts/gates/check-rules.sh` | recording rule 구조·문법 |
| `scripts/gates/check-promql-metrics.sh` | 대시보드·규칙이 참조하는 이름이 실재하는지 |
| `scripts/gates/check-runbooks.sh` | 신규 알림 3건 ↔ 런북 왕복 |

**게이트가 못 잡는 것**: 실기에서 `-d cciss,N`이 정말 응답하는지(가짜 sysfs·스텁이므로),
값의 의미(773이 진짜 그 디스크의 결함 수인지 — AC-2-2가 라이브에서 대조), 라벨 스키마.

# 하드웨어 운영 확장 — SPEC (3축 상세 설계)

> 2026-07-30. 권위: [README](./README.md) · 헌장(§I-1·§I-2·§11·§12·§13·§15) · [alerting/spec.md](../alerting/spec.md) v1.1 · ADR-0010(로그 분류)·ADR-0013(용량 판정)·ADR-0017(온보딩).
> 이 문서가 "무엇을 수집하고 무엇에 알리고 무엇으로 증설을 판단할지"의 계약이다. 구현이 벗어나면 구현이 틀린 것(§7).
>
> 표기: **[실측]** = 2026-07-29~30 라이브 확인값 · **[가설]** = 미확인 추정 · `[server]` = 사람이 적용(§11).
> 모든 §x.N 수용 기준은 **명령과 기대 출력**으로 쓴다("잘 된다" 금지, §9).

---

## 0. 선행 게이트 — 이걸 통과하지 않으면 아래 전부 무의미하다

| # | 게이트 | 실측 증거 | 막는 것 | 주체 |
|---|---|---|---|---|
| **G0-1** | data05 NVIDIA 드라이버 커널↔유저스페이스 불일치 | `/proc/driver/nvidia/version`=595.71.05 vs `modinfo nvidia`=595.84 vs `libnvidia-ml.so.1`→595.84. `nvidia-smi` exit **18**. `/var/run/reboot-required` mtime Jul 29 06:08, uptime **58일**. `nvidia-cdi-refresh.service` failed since Jul 24 06:53 | 축3 전체(컨테이너 벤치 기동 불확실), data05 `gpu_vram_total_bytes` 시리즈 부재 → ADR-0013 판정이 data05에서 구조적 unknown | `[server]` 재부팅 1회(다운타임 창) |
| **G0-2** | 로그 인입 6일 중단 | `keiwi-logs-*` 최신 doc `2026-07-24T07:02:19.419Z`. `_stats/indexing` `index_total` delta **0**(8초 간격 2회). 07.20~23 일 92만건(≈10.7 docs/s) → 07.24 27만건에서 절단 | 축2의 S1/L1 규칙(복구 전에 규칙을 만들면 규칙이 즉시 firing), SEL→OpenSearch(축1 P5) | `[server]` 파이프라인 복구 |
| **G0-3** | day-1 오발화 후보 **10건** | `up==0` 2건(vllm `172.18.0.1:8010`, smartctl `192.0.2.15:9633`) · systemd failed 4건(data01=2·data03=1·data04=1) · data04 `/` **0.8653** · data01 mem **0.9011** · XID latch 2건 · 로그중단 1건 · OpenSearch `yellow`(unassigned_shards=37) | 축2 전체 — 그대로 켜면 §15와 alerting §0-5를 첫날 자기 손으로 위반 | 사람(정리) + 에이전트(섀도 모드 배선) |
| **G0-4** | data05 `sudo` NOPASSWD 무력화 | data05 `sudo -n true` → `a password is required`(rc=1). `sudo -n -l`에 `(ALL) NOPASSWD: ALL` **다음에** `(ALL : ALL) ALL` — sudoers는 마지막 매치가 이긴다. self-ssh도 `Permission denied` | 축1의 data05 배포(`ansible_connection=local` + become 실패) → 4노드 중 3노드만 되는 반쪽 배포 | `[server]` sudoers 순서 교정 |

> [!WARNING]
> G0-4 때문에 **data05의 `ipmitool` 실측(SEL·SDR·PSU 구성)만 유일하게 미완**이다. data05의 416W는 hwmon 경로로만 확인됐다. 메모리에 기록된 "NOPASSWD 전면 적용(-K 불필요)"은 **data05에 대해 사실이 아니다.**

> [!TIP]
> **탐지를 수복보다 먼저 넣는다(P1 → P0 일부 역전).** G0-1을 고치면 증거가 사라지고, 그러면 "이 메트릭이 실제로 발화하는가"를 검증할 기회를 잃는다. `node_nvidia_version_mismatch`를 먼저 배포하면 지금 `1`이 관측되고 재부팅 후 `0`으로 떨어지는 것까지 그래프에 남는다.

---

## 1. 축1 — 하드웨어 관측 (BMC)

### 1.1 실측된 하드웨어 사실

**전력 [실측]**

| 노드 | hwmon `power1` | `ipmitool dcmi power reading` | GPU 합(DCGM) |
|---|---|---|---|
| data05 | 416 W | (G0-4로 미측정) | 155.9 W |
| data03 | 211 W | inst 211 / min 208 / max 254 / avg 211 (300s) | 28.7 W |
| data04 | 208 W | inst 335 / min 204 / **max 558** / avg 222 | 33.3 W |
| data01 | **0 W** | (`/dev/ipmi0` 부재) | — |
| **합** | **850 W** | — | **217.8 W (25.6%)** |

**센서 [실측: data03 `ipmitool sdr elist all` = 138 레코드]**
`01-Inlet Ambient` 27°C · `02/03-CPU 1/2` 40°C · `06/10-DIMM` 38°C · `12-HD Max` 35°C · `15-Front Ambient` 36°C · `22-Chipset` 47°C · `23-BMC` **80°C** · `24-BMC Zone` 48°C · `25-HD Controller` 62°C · `27-LOM` 58°C.
**임계값을 BMC가 선언해준다**: `ipmitool sensor get "01-Inlet Ambient"` → Upper Critical **42.0** / Upper Non-Recoverable **47.0**.

**팬 [실측]** `Fan 1 DutyCycle 26.26 percent` · Fan2 35.28 · Fan3 44.30 · Fan4 44.30 · Fan5 36.06 · Fan6 36.06 · `Fans | Fully Redundant` · `Fan N Presence = Device Present`.

**PSU [실측]** data03 PS1 out **165W** / PS2 **60W**, data04 PS1 **15W** / PS2 **210W** — 둘 다 상태는 `Fully Redundant`. data04 `P/S 1 Inlet` 36°C / `P/S 2 Inlet` 40°C. `ipmitool chassis status` → Power on, 결함 없음, **Power Restore Policy: previous**.

**FRU [실측]** data03 `fru print 0` → Chassis/Board/Product Serial `SGH915TGVG`, Part `868705-B21`, Board Mfg Date 2019-04-09. data01 board serial `SGH725TTEA`. data05 SKU `P05172-B21`.

**BMC LAN [실측: in-band `ipmitool lan print 1`]** data03·data04 모두 `IP Address Source: DHCP` / IP `0.0.0.0` / Subnet `0.0.0.0` / Gateway `0.0.0.0` / VLAN Disabled. MAC data03 `08:f1:ea:95:8b:00`, data04 `08:f1:ea:95:8c:98`. 채널 2는 `Invalid channel`. 후보 IP 8개에 `curl -sk https://IP/redfish/v1/` → 전부 443 무응답.
**[가설]** data03 호스트 NIC MAC이 `08:f1:ea:95:8b:02`로 iLO MAC(`…8b:00`)과 베이스+2 관계 → 같은 LOM 보드. shared network port 모드로 전환하면 `192.0.2.0/24`에 올라온다. 별도로 bond0 ARP에 `10.218.18.x`(OUI `00:1a:f4`) 3개 → 동일 L2에 두 번째 L3 대역 존재 흔적(기존 관리 대역 후보, 조사 필요).

### 1.2 hwmon으로는 절대 못 보는 것 (= 수집을 늘려야 하는 이유)

| 신호 | hwmon/node-exporter | BMC(IPMI/Redfish) |
|---|---|---|
| 섀시 전력 | ✅ `power1`(4노드 중 3) | ✅ DCMI(min/max/avg 포함) |
| 팬 | ❌ `node_hwmon_fan_rpm` **EMPTY** | ✅ duty **%**(RPM 아님) + 이중화 상태 + presence |
| 인렛/존 온도 | ❌ | ✅ 138 센서 + **임계값 선언** |
| PSU 개별 출력·이중화 | ❌ | ✅ |
| SEL(하드웨어 이벤트 이력) | ❌ | ✅ (256 entries, rollover) |
| iLO 펌웨어 버전 | ❌ | ✅ `mc info` / Redfish |
| BIOS 버전·SKU·시리얼 | ✅ `node_dmi_info`(이미 수집 중!) | ✅ |
| CPU 패키지 에너지 | ❌ `rapl` collector_success=**0** | — |

### 1.3 수집 경로 결정 — in-band 1차, out-of-band 2차

| 방식 | 장점 | 한계 | 판정 |
|---|---|---|---|
| **[A] in-band FreeIPMI**(`ipmi_exporter` local 모드) | 크레덴셜 **0** · 관리망 불요 · 기존 Ansible role + static job 패턴에 그대로 얹힘 · 성숙(prometheus-community) | KCS 채널 경유로 **느리다**(센서 1회 수백ms~수초) · PSU별 출력 W·엔티티·FRU 시리얼·HPE 센서 네이밍(`01-Inlet Ambient`) 의미가 얇게 잡힘 · root 필요 | **1차 채택** |
| **[B] out-of-band Redfish** | 노드가 꺼져 있어도 관측 · 에이전트 0(agentless 지향과 정합) · `/UpdateService/FirmwareInventory`로 **펌웨어 전량**(IPMI 불가) · `/Chassis/1/Power`의 PowerSupplies 배열(모델·정격W·상태) | **현재 불가** — iLO NIC DHCP·0.0.0.0(§1.1) · 관리망 결선 L급 물리작업 · **BMC 크레덴셜 발생(§13)** · 기관망 IP 협의 | **2차(P7)** |
| **[C] in-band Redfish**(`/dev/hpilo` chif + `ilorest --local`) | 관리망 없이 Redfish 전체 인벤토리 · **크레덴셜 불필요** · 4노드 전부 채널 존재 | `ilorest` 설치 필요(apt에 있음) · HPE 전용 | **보조**(인벤토리 수집용, §1.9) |

**결정(ADR-0019(신설 예정))**: **1차 = in-band(FreeIPMI 기반 + HPE 갭만 자체 수집), 2차 = out-of-band Redfish 승격.**
근거: (a) 관리망이 L급 물리작업 + 기관망 협의라 착수 자체가 막힌다, (b) in-band chif/KCS는 §13 부담이 **0**, (c) 기존 `roles/port-exporter` 3단 패턴 + static job + syshealth 대시보드에 정확히 얹힌다.

**패키지 가용성 [실측]**

| 노드 | `ipmitool` | `freeipmi-tools` | `ilorest` | `python3-hpilo` |
|---|---|---|---|---|
| data03·04 | **설치됨** 1.8.19 | apt 후보 1.6.13-3ubuntu0.1 | apt 후보 3.6.0.0-3 (noble/universe) | 4.4.3-3 |
| data05 | 미설치(후보 있음) | 동일 | 동일 | 동일 |
| data01(xenial) | 후보 1.8.16 | 후보 1.4.11 | 없음 | 없음 |

`ipmi-sensors`(FreeIPMI)는 **현재 전 노드 MISSING** → `ipmi_exporter` 선행 조건.

### 1.4 노출할 지표 (계약)

`keiwi_bmc_*` 네이밍으로 HPE 시맨틱을 보존한다. 라벨 `node`는 전 메트릭 공통(축2 라우팅·inhibition의 매칭 축, §2.4).

| 메트릭 | 타입 | 라벨 | 원천 | 비고 |
|---|---|---|---|---|
| `keiwi_bmc_sensor_celsius` | gauge | `node,sensor,entity` | `sdr type Temperature` | `sensor="01-Inlet Ambient"` 원문 보존 |
| `keiwi_bmc_sensor_threshold_celsius` | gauge | `node,sensor,level` | `sensor get` | `level=upper_critical\|upper_nonrecoverable`. **임계 하드코딩 제거의 핵심** |
| `keiwi_bmc_sensor_state` | gauge | `node,sensor,state` | SDR | `state=ok\|nc\|cr\|ns` |
| `keiwi_bmc_fan_duty_ratio` | gauge | `node,fan` | SDR | **0~1**. RPM 아님(§1.2) |
| `keiwi_bmc_fan_present` | gauge | `node,fan` | SDR presence | |
| `keiwi_bmc_fan_redundancy` | gauge | `node` | `Fans` 엔티티 | 1=Fully Redundant |
| `keiwi_bmc_psu_output_watts` | gauge | `node,psu` | SDR PS Output | data03 165/60, data04 15/210 [실측] |
| `keiwi_bmc_psu_redundancy` | gauge | `node` | `Power Supplies` | **2025년 2회 상실 이력** |
| `keiwi_bmc_psu_present` | gauge | `node,psu` | SDR | |
| `keiwi_bmc_power_watts` | gauge | `node` | `dcmi power reading` inst | hwmon과 교차검증됨 |
| `keiwi_bmc_power_watts_min/max/avg` | gauge | `node` | 동 | data04 max **558W** = 피크 근거 |
| `keiwi_bmc_sel_entries` / `_sel_capacity` / `_sel_used_ratio` | gauge | `node` | `sel info` | 0.46 / 0.64 [실측] |
| `keiwi_bmc_chassis_power_state` | gauge | `node` | `chassis status` | |
| `keiwi_bmc_chassis_health` | gauge | `node` | SysHealth_Stat | 1=OK, 0.5=Non-critical, 0=Critical |
| `keiwi_bmc_power_restore_policy` | gauge | `node,policy` | `chassis status` | `policy="previous"` [실측] — 정전 복귀 서사 |
| `keiwi_bmc_info` | gauge(=1) | `node,ilo_fw,bios_version,product,sku,serial,board_serial` | `mc info`+FRU | iLO5 fw **1.40** |
| `keiwi_bmc_up` | gauge | `node,collector` | 자체 | `collector=sdr\|sel\|dcmi\|fru\|mc`. **부분 실패 가시화** |
| `keiwi_bmc_collector_last_run_timestamp_seconds` | gauge | `node` | 자체 | **stale 값 오해 방지(C5)** |
| `keiwi_bmc_collect_duration_seconds` | gauge | `node,collector` | 자체 | in-band 지연 실측용 |

> [!CAUTION]
> **`keiwi_bmc_fan_rpm`을 만들지 않는다.** HPE는 RPM을 주지 않는다. 없는 메트릭을 만들면 대시보드가 조용히 빈다. 수용 기준 AC-1-6이 이 메트릭의 **부재**를 검증한다.

### 1.5 기성품 vs 자체 구현 — 경계를 PoC로 정한다

**1차: `prometheus-community/ipmi_exporter`를 data03 1노드에만 올려 갭을 표로 만든다.**
백엔드가 ipmitool이 아니라 **FreeIPMI**(`ipmi-sensors`·`ipmi-dcmi`·`ipmi-sel`·`bmc-info`)라 `freeipmi-tools` 설치가 선행.
노출: `ipmi_temperature_celsius` · `ipmi_fan_speed_ratio` · `ipmi_voltage_volts` · `ipmi_current_amperes` · `ipmi_power_watts` · `ipmi_dcmi_power_consumption_watts` · `ipmi_sensor_state` · `ipmi_chassis_power_state` · `ipmi_sel_entries_count` · `ipmi_sel_free_space_bytes` · `ipmi_bmc_info{firmware_revision}` · `ipmi_up{collector=...}`.

**2차: PoC에서 확인된 갭만 자체 구현**(`keiwi-bmc-exporter`). 예상 갭 = PSU별 출력 W · SDR 임계값 추출 · Power Restore Policy · FRU 시리얼/SKU · HPE 센서 네이밍 의미.

> [!NOTE]
> 이 순서 자체가 산출물이다. "직접 만들기 전에 표준을 평가했다"를 표로 남긴다 → `docs/decisions/0019-*.md`의 "고려한 대안" 절이 실측 표가 된다.

**PoC 전 단계로 textfile collector를 쓴다(반나절).** data03에 `keiwi_node_hygiene.prom`이 이미 있고 data05 compose에 `--collector.textfile.directory=/host/textfile`이 배선돼 있다 → **새 포트·새 job·새 ufw 룰이 0**이다. 정식화(exporter)의 이득은 포트별 `up`/스크레이프 지연 관측뿐이므로, PoC는 textfile로 끝낸다.

### 1.6 Ansible role 구조 (`roles/bmc-exporter`)

`roles/port-exporter`의 3단 패턴을 그대로 복제한다.

```
roles/bmc-exporter/
  defaults/main.yml    bmc_exporter_port: 9638
                       bmc_exporter_mode: textfile|exporter
                       bmc_exporter_textfile_dir: /var/lib/node_exporter/textfile
                       bmc_exporter_interval: 60s          # in-band 지연 대응(§1.10 함정)
                       bmc_exporter_src: "{{ playbook_dir }}/../../monitoring/bmc-exporter/bmc-exporter.py"
  tasks/main.yml       1) /dev/ipmi0 존재 확인 → 없으면 skip + debug(data01)
                       2) ipmitool/freeipmi-tools apt 설치(없을 때만)
                       3) /opt/keiwi/bmc-exporter/ 에 vendored 스크립트 copy
                       4) systemd unit(exporter) 또는 oneshot+timer(textfile) template
                       5) enable+start (when: not ansible_check_mode)
  handlers/main.yml    restart bmc-exporter
  templates/           keiwi-bmc-exporter.service.j2 / .timer.j2
```

- `/dev/ipmi0` 부재 노드는 **skip + 이유 출력**(node-hygiene role이 apt node-exporter 부재를 다루는 방식과 동형).
- 코드 요구사항(C5): py3.6 호환(stdlib only, `subprocess.PIPE`+`universal_newlines`, `ThreadingMixIn` 폴백) · 모든 서브프로세스에 timeout · **파싱 실패 시 해당 collector의 `keiwi_bmc_up=0`을 내보내고 직전 값을 재노출하지 않는다.**
- `playbooks/agents.yml`에 `bmc` 태그로 play 추가. 대상 그룹은 `[nodes]`에서 data01 제외(`--limit`이 아니라 role 내부 가드로).

### 1.7 Prometheus job — 반드시 별도 job으로 분리

> [!WARNING]
> **함정: in-band IPMI 폴링은 느리고 무겁다.** data03 SDR이 138 레코드다. `global.scrape_interval=15s`에 그대로 넣으면 BMC를 괴롭히고 스크레이프 타임아웃이 난다.

```yaml
  # BMC(in-band IPMI) — 느린 타깃. global 15s를 쓰지 않는다.
  - job_name: "bmc-exporter"
    scrape_interval: 60s
    scrape_timeout: 30s
    static_configs:
      - targets: ["192.0.2.13:9638"]
        labels: { instance: "192.0.2.13:9638", node: "data03" }
      - targets: ["172.18.0.1:9638"]           # data05 호스트(도커 브리지)
        labels: { instance: "192.0.2.15:9638", node: "data05" }
      # data04 — 직접 도달 불가. keiwi-tunnel-data04.service에 -L 172.18.0.1:9639:localhost:9638 추가 후 해제
      # - targets: ["172.18.0.1:9639"]
      #   labels: { instance: "192.0.2.14:9638", node: "data04" }
```

textfile 모드에서는 job 추가가 **불필요**하다(기존 node-exporter가 그대로 노출). 정식화 시점에만 위 job을 켠다.

### 1.8 recording rules (`rules/keiwi-hardware.yml`) — P1은 이것만으로 성과가 난다

> [!IMPORTANT]
> **이 절의 정본은 `infra/monitoring/rules/keiwi-hardware.yml`이다** (fleet-hardening 축4 T4-1이 공급).
> 아래는 그 요약이며, 초안에 있던 **거짓 규칙 2건은 fleet-hardening spec §4에서 실측으로 확정해 교정했다.**
> 값이 갈리면 레포의 규칙 파일이 이긴다 — 스펙과 파일이 갈라지면 사람이 어느 쪽을 복사할지 판단하게 되고,
> 그 판단이 §12 사고의 입구다.

```yaml
groups:
  - name: keiwi_power
    interval: 60s
    rules:
      # 노드별 섀시 전력(W). acpi_power_meter → hwmon. 라벨 정리로 instance만 남긴다.
      # data01(.101 Gen9)은 ACPI 전력계 객체가 존재하지만 값이 30일 보존 전 구간 0이다
      # (센서 미지원) → 합계에서 제외하고, 제외 사실은 reporting_count로 노출한다.
      - record: instance:node_chassis_power:watts
        expr: sum by (instance) (node_hwmon_power_average_watt{sensor="power1"})

      # ── 정직성 분모(신규). 이게 없으면 노드가 빠질 때 합계 감소가 "절전"으로 보인다. 현재 3/4.
      - record: fleet:node_chassis_power:reporting_count
        expr: count(instance:node_chassis_power:watts > 0) or vector(0)

      - record: fleet:node_chassis_power:watts_sum
        expr: sum(instance:node_chassis_power:watts > 0) or vector(0)

      # GPU 전력 — dcgm instance(:9400)를 node-exporter 형태(:9100)로 정규화해 조인 키 통일.
      - record: instance:gpu_power:watts
        expr: sum by (instance) (label_replace(DCGM_FI_DEV_POWER_USAGE, "instance", "$1:9100", "instance", "(.*):9400"))

      - record: fleet:gpu_power:watts_sum
        expr: sum(instance:gpu_power:watts) or vector(0)

      # GPU가 플릿 전력에서 차지하는 비율. 2026-08-03 실측 0.234(부하에 따라 변동).
      - record: fleet:gpu_power_share:ratio
        expr: fleet:gpu_power:watts_sum / fleet:node_chassis_power:watts_sum

      # 노드별 GPU 점유율·비-GPU 전력(신규) — 증설·재배치 판단의 입력.
      - record: instance:gpu_power_share:ratio
        expr: instance:gpu_power:watts / on(instance) (instance:node_chassis_power:watts > 0)
      - record: instance:node_nongpu_power:watts
        expr: (instance:node_chassis_power:watts > 0) - on(instance) instance:gpu_power:watts

      # 노드별 일일 전력량(kWh). ⚠️ 교정: **원 메트릭 기반**이어야 한다.
      #   레코딩 시리즈([1d])를 참조하면 적용 후 24h 동안 과소값이 나오고 — 첫날 값이 틀리면
      #   신뢰를 잃고 그대로 방치된다. 원 메트릭은 30일치가 이미 있어 즉시 정확하다.
      #   ⚠️ `> 0` 결과 필터 필수 — 없으면 data01이 0 kWh 시리즈를 내고 패널이
      #      "data01은 전력을 안 쓴다"로 읽힌다.
      - record: instance:node_chassis_energy:kwh1d
        expr: sum by (instance) (avg_over_time(node_hwmon_power_average_watt{sensor="power1"}[1d])) * 24 / 1000 > 0

      # GPU 일일 전력량(kWh). DCGM 누적 에너지는 mJ → ÷3.6e9. instance 정규화 포함.
      - record: instance:gpu_energy:kwh1d
        expr: sum by (instance) (label_replace(increase(DCGM_FI_DEV_TOTAL_ENERGY_CONSUMPTION[1d]), "instance", "$1:9100", "instance", "(.*):9400")) / 3.6e9

  - name: keiwi_firmware_drift
    interval: 5m
    rules:
      # ⚠️ 교정 — 초안의 BIOS 버전 카운트 레코드(bios_version만으로 그룹핑하던 것)는 **폐기**한다.
      #   폐기된 레코드의 정확한 이름과 폐기 근거는 fleet-hardening spec §4.2(D4-1·D4-6)에 있다.
      #   ① `by (product)`를 쓴 판본은 라벨 이름 자체가 틀렸다(실제 라벨은 product_name).
      #      존재하지 않는 라벨로 by 하면 전부 {} 한 그룹으로 뭉쳐 max=3이 나오고
      #      아래 BiosVersionDrift(`> 1`)가 **day-1 오발화**한다 [실측 2026-08-03].
      #   ② 라벨을 고쳐도 부족하다. bios_version은 HPE ROM 패밀리 코드(U30/U46/P89)라
      #      동일 모델에서 상수다 — data03·04가 U30/2.2로 같은데 한쪽만 U30/2.4로 올라가도
      #      값이 1 그대로다(구조적 미탐). 실제 리비전은 bios_release다.
      #   → 그룹 키에 bios_release를 넣고 **이름도 바꾼다**(구 이름 잔존을 grep으로 검증하기 위해).
      - record: product:node_bios_revisions:count
        expr: count by (product_name) (count by (product_name, bios_version, bios_release) (node_dmi_info))

      # 분모 — 1대뿐인 모델에서는 드리프트가 정의되지 않는다. Gen10=2, Gen10 Plus=1, Gen9=1.
      - record: product:node_count:count
        expr: count by (product_name) (node_dmi_info)

      - record: fleet:node_bios_drift:count
        expr: count(product:node_bios_revisions:count > 1) or vector(0)
```

> [!NOTE]
> **BIOS 경과일 레코드는 만들지 않는다 — 삭제로 결론(B10 종결. 초안 레코드명은 fleet-hardening spec §4.2 D4-6 참조).**
> `bios_date` 라벨을 시간으로 변환할 수 없어(PromQL은 라벨 문자열을 파싱하지 못한다) 초안의 식은
> **BIOS 릴리스 일자가 아니라 시리즈 수집 시각**을 재고 있었다. 경과일이 다시 필요해지면 exporter 쪽
> (§1.4 `keiwi_bmc_info`)에서 계산해 `keiwi_bmc_bios_age_days` gauge로 내보내는 것이 옳고,
> 그건 **BMC 축의 새 백로그 항목**으로 연다. recording rule로는 만들지 않는다.

### 1.9 SEL → OpenSearch (`category=hardware`)

M2 파이프를 재사용한다. **새 저장소를 만들지 않는다.**

- 수집: `ipmitool sel elist` → JSON 라인 → `/var/log/keiwi/bmc-sel.jsonl` → Filebeat `log` 입력 → Logstash → `keiwi-logs-*`(ISM 365d).
- 필드 계약: `fleet_node` · `category: hardware`(ADR-0010 사전에 1종 추가) · `sel_id` · `sel_record_type` · `sensor` · `event` · `direction`(Asserted/Deasserted) · `severity` · `@timestamp`(UTC 정규화).

> [!CAUTION]
> **함정 1 — SEL 타임존이 노드마다 다르다.** [실측] data03 SEL은 **UTC**, data04는 **KST**. 정규화하지 않으면 하드웨어 사건과 로그·메트릭의 시간 상관이 **9시간** 틀어진다. 수집기가 노드별 `sel time get`을 읽어 오프셋을 계산해 UTC로 변환한다.
>
> **함정 2 — 중복 방지 키.** SEL 엔트리 ID는 rollover로 재사용된다. `_id = sha1(fleet_node + sel_time_utc + sensor + event)`로 멱등 색인한다(엔트리 ID 단독 금지).
>
> **함정 3 — 롤오버가 진행 중이다.** data04 **64%**(166/256), data03 46%. `SEL automatic rollover is enabled`. 최초 수집은 **전량 백필 1회**를 먼저 하고, 그 다음 증분으로 넘어간다.

Grafana annotation으로 SEL 사건을 메트릭 타임라인에 겹친다 → "2025-06-21 PSU2가 죽었을 때 전력 그래프가 이렇게 움직였다"가 한 화면에 보인다.

### 1.10 대시보드 패널안 — `syshealth.json`에 row 2개 추가

기존 row(`디스크 건강(SMART·NVMe)` / `OS 위생`) 옆에 붙인다. 새 대시보드를 만들지 않는다(§I-2).

**Row: 전력 · 냉각**

| 패널 | 타입 | 쿼리 | 표시 |
|---|---|---|---|
| 플릿 전력 | stat | `fleet:node_chassis_power:watts_sum` + `fleet:node_chassis_power:reporting_count` | W. **보고 노드 수를 보조 값으로 함께** 표시(현재 3/4, data01 제외) — 합계 감소가 절전인지 노드 이탈인지 한 화면에서 갈린다 |
| GPU 전력 점유율 | gauge | `fleet:gpu_power_share:ratio` | 0~1 percentunit. 2026-08-03 실측 0.234(부하에 따라 변동 — 고정값으로 읽지 말 것) |
| 노드별 전력 추세 | timeseries | `instance:node_chassis_power:watts` | 24h |
| 일일 전력량 | bar | `instance:node_chassis_energy:kwh1d` | kWh |
| 인렛 온도 vs BMC 임계 | timeseries | `keiwi_bmc_sensor_celsius{sensor=~".*Inlet.*"}` + threshold 라인 `keiwi_bmc_sensor_threshold_celsius{level="upper_critical"}` | °C. **임계선을 데이터로 그린다** |
| 팬 duty | timeseries | `keiwi_bmc_fan_duty_ratio` | percentunit. **RPM 아님** |
| PSU 출력 균형 | bar | `keiwi_bmc_psu_output_watts` | W. data04 15/210 불균형이 보인다 |
| PSU·팬 이중화 | stat(4) | `keiwi_bmc_psu_redundancy`·`keiwi_bmc_fan_redundancy` | 1=OK. 무채색(정상은 유채색 금지 — design §00) |

**Row: BMC · 펌웨어 인벤토리**

| 패널 | 타입 | 쿼리 |
|---|---|---|
| 펌웨어 인벤토리 표 | table | `keiwi_bmc_info` (라벨 → 열: node·product·bios_version·ilo_fw·serial·sku) |
| BIOS 드리프트 | stat | `fleet:node_bios_drift:count` (현재 **0** — 비교 가능한 모델 그룹이 DL380 Gen10 2대뿐이고 거기서 리비전이 같다). 분모 `product:node_count:count`를 같은 row에 함께 띄운다: 그것 없이는 0이 "통일됐다"인지 "비교할 게 없다"인지 구분되지 않는다 |
| SEL 사용률 | bargauge | `keiwi_bmc_sel_used_ratio` (0.46 / 0.64) |
| 최근 하드웨어 이벤트 | logs(OpenSearch) | `category:hardware` 최근 20건 |
| 수집기 신선도 | stat | `time() - keiwi_bmc_collector_last_run_timestamp_seconds` |

### 1.11 `docs/inventory.yaml` 하드웨어 인벤토리 보강

현재 파일은 `ip·hostname·os·gpu·exporters`만 갖고 하드웨어 필드가 **0**이다(`metrics-collection.md` §1이 지적한 그 공백). Ansible이 `ipmitool fru print`·`dmidecode -t memory/processor`·`ilorest --local` 출력을 파싱해 블록을 **생성**하고 사람이 커밋한다(§11).

```yaml
  - id: data03
    ip: 192.0.2.13
    # ... 기존 필드 유지 ...
    hardware:                      # 생성: playbooks/inventory-hw.yml (사람이 diff 확인 후 커밋)
      vendor: "HPE"
      product: "ProLiant DL380 Gen10"
      sku: "868705-B21"
      serial: "SGH915TGVG"
      board_mfg_date: "2019-04-09"
      bios: { version: "U30", release: "2.2", date: "2019-03-19" }
      bmc: { kind: "iLO5", firmware: "1.40", mac: "08:f1:ea:95:8b:00", ip: null, source: "DHCP(미할당)" }
      psu: { count: 2, redundancy: "Fully Redundant" }
      thermal: { inlet_upper_critical_c: 42.0, inlet_upper_nonrecoverable_c: 47.0, fan_count: 6, fan_reports_rpm: false }
      power: { restore_policy: "previous", dcmi_supported: true }
      rack: null                   # 수기 — 실사 필요
      pdu_circuit: null            # 수기 — 실사 필요
```

- `rack`/`pdu_circuit`은 **수기 필드**로 남긴다(실사 없이 채우면 거짓 데이터).
- data01: `bmc.kind: iLO4`, `power.dcmi_supported: false`(0W 실측), `hardware.legacy: true`.
- 이것이 backlog #5(CMDB)와 T1-11(inventory `file_sd`)의 실제 내용물이 된다.

### 1.12 수용 기준 (축1) — 기계 검증

`P=http://192.0.2.15:9090/api/v1/query`, `q()` = `curl -s --data-urlencode "query=$1" $P | jq -r '.data.result[0].value[1] // "EMPTY"'`

| # | 검증 | 명령 / 기대 |
|---|---|---|
| **AC-1-1** | 전력 recording rule 로드 | `promtool check rules infra/monitoring/rules/keiwi-hardware.yml` → `SUCCESS` |
| **AC-1-2** | alert 규칙 혼입 없음(§15·헌장) | `! grep -rqE '^\s*-\s*alert:' infra/monitoring/rules/` → exit 0 |
| **AC-1-3** | 플릿 전력 시리즈 존재 | `q 'fleet:node_chassis_power:watts_sum'` → 숫자, `> 700` |
| **AC-1-4** | GPU 점유율 범위 | `q 'fleet:gpu_power_share:ratio'` → `0 < x < 1` |
| **AC-1-5** | BMC 수집 노드 수 | `q 'count(keiwi_bmc_info)'` → `3`(data03·04·05. data01은 §C6 예외) |
| **AC-1-6** | **팬 RPM 메트릭 부재** | `q 'count(keiwi_bmc_fan_rpm)'` → `EMPTY` |
| **AC-1-7** | 임계값이 데이터로 들어옴 | `q 'keiwi_bmc_sensor_threshold_celsius{sensor="01-Inlet Ambient",level="upper_critical"}'` → `42` |
| **AC-1-8** | 부분 실패 가시화 | `q 'count(keiwi_bmc_up)'` → `≥ 5×노드수`(collector 5종) |
| **AC-1-9** | stale 방지 | `q 'max(time() - keiwi_bmc_collector_last_run_timestamp_seconds)'` → `< 180` |
| **AC-1-10** | 스크레이프가 느린 job을 죽이지 않음 | `q 'max(scrape_duration_seconds{job="bmc-exporter"})'` → `< 30` |
| **AC-1-11** | SEL 색인됨 | `curl -s '…/keiwi-logs-*/_count' -d '{"query":{"term":{"category":"hardware"}}}'` → `count > 0` |
| **AC-1-12** | SEL 시간 정규화 | `category:hardware` 문서 전건에서 `@timestamp` 최댓값 − `sel_time_local` 최댓값 차가 노드별로 일정(오프셋 테이블과 일치), KST 노드 문서가 미래 시각을 갖지 않음 |
| **AC-1-13** | SEL 멱등 | 수집기 2회 연속 실행 후 `_count` 증가분 `= 0` |
| **AC-1-14** | inventory 하드웨어 블록 | `yq '[.nodes[] \| select(.id != "data02") \| select(.hardware == null)] \| length' docs/inventory.yaml` → `0` |
| **AC-1-15** | 대시보드가 프로비저닝본 | `jq -r '.uid' infra/monitoring/dashboards/syshealth.json` → `keiwi-syshealth`, 새 row 2개가 파일에 존재(`jq '[.panels[]\|select(.type=="row")]\|length'` 증가) |

---

## 2. 축2 — 알림 계층

### 2.1 현재 상태 [실측] — 알림이 정말 0이다 (증거 4종)

1. Prometheus **3.11.3**(`/api/v1/status/buildinfo`) · Grafana **13.0.1**(`/api/health`).
2. `curl :9093/-/healthy` → HTTP **000**(연결 실패) = Alertmanager 미존재.
3. `GET /api/v1/provisioning/alert-rules` → `[]`, `GET /api/ruler/grafana/api/v1/rules` → `{}`.
4. `infra/monitoring/prometheus.yml`에 `alerting:` 블록 **자체가 없음**.

즉 지표는 쌓이는데 발화 경로가 물리적으로 없다. §0 G0-2(로그 6일 침묵)가 그 결과다.

### 2.2 엔진 결정 — Alertmanager를 세우지 않는다

| | Alertmanager(standalone) | **Grafana 통합 알림** |
|---|---|---|
| 헌장 정합 | 알림 UI가 Grafana 밖에 하나 더 생김 → §I-2 위반 | **§I-2가 이미 "알림(통합 알림)"으로 명시**(Constitution.md:30) |
| 신규 컴포넌트 | 컨테이너·포트·볼륨 1세트(§12 격리 부담) | **0**(이미 배포됨) |
| inhibition | 지원(전통적 채택 이유) | **Grafana 13에 실제로 있다** ↓ |
| 규칙 포맷 | Prometheus YAML 네이티브 | convert API로 동일 YAML import(§2.3) |

> [!IMPORTANT]
> **결정적 반전 [실측].** inhibition은 "Alertmanager를 써야 하는 유일한 강한 이유"였다. `GET /apis/notifications.alerting.grafana.app/v1beta1` → 리소스 목록에 **`inhibitionrules (kind: InhibitionRule)`**, `receivers`, `routingtrees`, `templategroups`, `timeintervals` 존재. 공식 문서도 "Available in Grafana 13 or higher" + "관리 UI 없음, App Platform API로만"이라 명시. 우리는 13.0.1이다. → **alerting spec §4-3의 inhibition 요구를 Alertmanager 없이 충족한다.**
> 별도로 `rules.alerting.grafana.app/v0alpha1`에 `alertrules`/`recordingrules`도 존재.

**결정(ADR-0018): 엔진 = Grafana 통합 알림.** inhibition은 파일 프로비저닝 대상이 아니라 API 전용이므로 `gcx` CLI로 YAML을 apply한다.

> [!WARNING]
> 도구 리스크: `grafanactl`은 2026-06-01 아카이브 예정, 후속이 `gcx`다. 그리고 공식 문서조차 inhibition에 대해 "조용히 알림을 억제해 문제를 더 찾기 어렵게 만들 수 있다"고 경고한다 → inhibition 규칙은 **4건만**(§2.6 하단) 두고 늘리지 않는다.

### 2.3 규칙의 원본 포맷 — Prometheus YAML로 쓰고 Grafana로 import

| | (A) Grafana 파일 프로비저닝 | **(B) Prometheus 포맷 + convert API** |
|---|---|---|
| 규칙 1개 분량 | **약 50줄**(refId A 쿼리 + B reduce + C threshold 중첩) | **8~10줄** |
| `promtool` 검증 | 불가 | `promtool check rules` / `test rules` 가능 |
| 이식성 | Grafana 전용 | Prometheus·Mimir 어디든 |
| compose 바인드 | 필요(컨테이너 재생성 유발 — §2.4 블로커3) | **불필요**(DB 저장) |

**결정: (B).** `infra/monitoring/alerts/*.yml`에 Prometheus 규칙 포맷으로 커밋하고 import한다.

```
POST /api/convert/prometheus/config/v1/rules
  Authorization: Bearer <SA 토큰>
  X-Grafana-Alerting-Datasource-UID: keiwi-prom
  Content-Type: application/yaml
  X-Disable-Provenance: true                        # UI 편집 허용(야간 임계 응급 수정)
  X-Grafana-Alerting-Alert-Rules-Paused: true       # ← 섀도 모드(§2.8)
```
- 서비스 계정 RBAC: Alerting Rules Reader/Writer + Set provisioning status + Datasources Reader + Folders Creator/Reader/Writer.
- 대안 `mimirtool rules load`(`MIMIR_TENANT_ID=1` 고정)도 동작.
- 미지원: rule group `limit` 옵션.
- 라이브 확인: 이 엔드포인트가 우리 Grafana에 **존재**(인증 없이 403 — 없는 경로는 404, 대조 검증함).

> [!NOTE]
> `X-Disable-Provenance`의 트레이드오프를 ADR에 못박는다. 끄면(provisioned 고정) 야간에 임계를 급히 못 고치고 대응 수단이 silence뿐이다. 켜면 UI 변경이 다음 apply에서 덮여 드리프트가 생긴다. **선택: 켠다(운영 우선). 대신 apply는 항상 레포 → Grafana 단방향이며, UI 변경은 24h 안에 레포로 되돌려 쓴다.**

### 2.4 선행 블로커 3건 (전부 S — 이걸 안 하면 뒤가 깨진다)

| # | 블로커 | 실측 | 조치 |
|---|---|---|---|
| **B1** | Prometheus 데이터소스가 프로비저닝돼 있지 않고 **UID가 무작위** | `GET /api/datasources` → prometheus `uid=bflbhyfj7rzlsb`, `readOnly:false`. `provisioning/datasources/`에는 elasticsearch·opensearch만 | `provisioning/datasources/prometheus.yaml` 신설, `uid: keiwi-prom`·`editable: false`(opensearch.yaml과 동형). **안 하면 무작위 UID를 레포에 하드코딩하고 재생성 시 전부 깨진다** |
| **B2** | job마다 라벨 축이 달라 **inhibition/라우팅 매칭이 성립하지 않는다** | `up` 20 시리즈: node-exporter·dcgm-exporter는 `instance`만(예외: data03 dcgm만 `node=data03`), gpu-model·port·smartctl·vllm은 `node=dataNN` | `prometheus.yml`의 모든 `static_configs`에 `node: "dataNN"` 추가. **없으면 "노드 down → 그 노드 GPU 알림 뮤트"가 원리적으로 불가능** |
| **B3** | 대시보드 uid가 **중복**이라 알림 딥링크가 구버전을 가리킬 수 있다 | 라이브에 `keiwi-gpu`·`keiwi-system`·`keiwi-logs`·`keiwi-model-workload`·`keiwi-syshealth`와 **KRDS 재설계본 `keiwi-*-v3`가 동시 존재** | 정본 uid 확정 후 `dashboard_url` 애너테이션에 고정 |

> [!CAUTION]
> compose에 alerting 프로비저닝 바인드를 추가하면 **컨테이너 재생성**을 유발한다. `infra/monitoring/README.md:100` 경고 — **2026-07-02에 재생성으로 대시보드가 소실된 사고**가 있었다. 그래서 규칙은 convert API(DB 저장) 경로로 넣는다. contact point/mute timing은 파일 프로비저닝이 편하므로 **한 번은** 바인드를 추가해야 하며, 그 작업은 백업과 함께 단독으로 한다(P4 후반).

### 2.5 채널·egress 정책 — 무엇이 외부로 나가는지 명시한다

**도달성 [실측, data05에서 직접]**

| 대상 | 결과 | 해석 |
|---|---|---|
| `POST https://hooks.slack.com/services/T00000000/…` | HTTP **404 + body `no_team`** | TLS·라우팅·애플리케이션 레벨까지 **도달**(웹훅 ID만 가짜) → 프록시·방화벽 예외 없이 오늘 동작 |
| `api.telegram.org` | **000** | 이 환경에서 **애초에 불가** → alerting spec §5의 Telegram 대안은 정책 논쟁 이전에 사실이 정리됐다 |
| example.com / github.com | 200 / 200 | 일반 egress는 열려 있다 |
| slack.com 루트 | 000 | 웹훅 호스트만 열림 |

**헌장 충돌(C1)과 처리.** Slack은 외부 SaaS다 → §I-1과 정면 충돌한다. 웹훅은 **아웃바운드 단방향**이라 인바운드 포트를 열지 않으므로 §I-1의 "외부 노출은 Cloudflare Access 뒤에서만"과는 충돌하지 않는다. 남는 문제는 **데이터 유출**뿐이므로, 유출면을 열거해 통제한다.

**Grafana 알림 1건이 Slack으로 실제로 내보내는 필드**

| 항목 | 내용 | 위험 | v1 처분 |
|---|---|---|---|
| `alertname` | 규칙 이름 | 낮음 | **허용** |
| `severity` | sev1/2/3 | 낮음 | **허용** |
| `node` | data03 등 | 낮음(내부 별칭) | **허용** |
| `job`, `gpu` | 잡·GPU 인덱스 | 낮음 | **허용** |
| `instance` | **내부 IP** `192.0.2.10x:포트` | 중 | **제거**(node로 대체) |
| `modelName` | `NVIDIA A40` / `Quadro RTX 6000` | 중(하드웨어 구성 노출) | **제거** |
| `user` | ownership-attribution v1이 붙인 **연구원 계정명**(/proc uid→pwd) | **높음** | **금지** |
| `pid`, `cmdline`, XID 로그의 `name=VLLM::Worker` | 프로세스 정보 | **높음** | **금지** |
| annotations `summary`/`description` | 임계와 실측값 | 중 | **허용**(수치만, 라벨 보간 금지) |
| `values`/`valueString` | 메트릭 수치 | 중 | 허용 |
| `generatorURL`/`dashboardURL`/`panelURL`/`silenceURL` | 내부 호스트명 또는 외부 도메인(터널 뒤) | 중 | **허용목록 호스트만**(주소는 레포에 적지 않는다 §13 — 현행은 내부 IP `192.0.2.15:3000`·`:3106`) |

> [!CAUTION]
> **가장 주의할 점**: `user` 라벨과 XID 로그의 `pid`/`name`을 템플릿에 그대로 태우면 **연구원 계정명이 외부 SaaS에 영구 적재된다.** 되돌릴 수 없다. 그래서 v1의 Slack 템플릿은 **화이트리스트 방식**(alertname/severity/node/gpu/job만 출력)이며, 블랙리스트가 아니다 — 새 라벨이 생겨도 자동으로 새지 않는다. 상세는 링크로만 보낸다("콘솔에서 확인").

**결정(ADR-0018 §채널)**
1. **1단계 = Slack**, 명시적 egress 예외 **1건**으로 승인 + 라벨 화이트리스트 템플릿 강제. 웹훅 URL은 `.env`만(§13, 레포 금지).
2. **2단계 = self-host ntfy 추가**(야간 SEV1 폰 + 외부 의존 제거). Grafana webhook contact point가 Custom Payload를 지원해 ntfy의 `{topic,title,message,priority,tags}` JSON을 **브릿지 서버 없이** 만들 수 있다.
3. 라우팅은 `severity` 라벨로 둘 다 지원(SEV1은 Slack+ntfy 양쪽 = 이중화).
4. ntfy 단독 채택은 하지 않는다 — 팀 가시성과 즉시 동작을 스스로 버리는 선택이다.

미해결: **폰 OS**(iOS는 ntfy 자체호스트 푸시에 제약) → alerting spec §9의 그 질문이 여기서 실제 리스크가 된다. 2단계 착수 전 확인.

### 2.6 alert 규칙 v1 카탈로그 — 전부 라이브에서 실행해 시리즈 유무·현재값을 확인한 것만 싣는다

공통 규약: `labels.severity ∈ {sev1,sev2,sev3}` · `annotations.summary`(1줄 증상) · `annotations.runbook_url` · `annotations.dashboard_url`.
**런북 담당 규약** (2026-08-03 갱신 — *파일명 kebab 강제* → *frontmatter 선언*): 런북이 담당 alertname을 **선언**하는 것이 정본이고, 파일명 규칙은 폴백이다.

```yaml
---
id: gpu-xid                  # = 파일 stem (콘솔 runbooks.ts:38이 요구)
kind: alert                  # alert | procedure | incident (부재 시 alert로 간주)
alerts: [GpuXidErrorNew]     # ← 이 런북이 담당하는 alertname. 여기가 정본
category: gpu
severity: critical
---
```

- **공통 계약**(모든 `docs/runbooks/*.md`): `id`(=파일 stem) · `kind` · `category`
- **알림 런북 추가 계약**(`kind: alert`만): `alerts`(배열) · `severity`
- kebab 파일명(`NodeDown` → `node-down.md`)은 **`alerts:`가 없을 때만** 폴백으로 쓴다.
  강제하지 않는 이유: `LogIngestStalled`의 kebab은 `log-ingest-stalled.md`인데 실제 런북은
  `log-ingestion-stopped.md`다 — **kebab 강제는 유일하게 올바른 알림 런북을 FAIL시킨다.**
- `kind`로 나눈 이유: 절차서(`node-onboarding.md`)·종결 인시던트(`rsyslog-omfile-flood.md`)는
  담당 알림이 없다. 전 문서에 `alerts`를 강요하면 `alerts: []`·`severity: none` 같은 **거짓 필드**가 생긴다.
- 알림이 아직 없는 런북(`alerts: []`)은 게이트가 **WARN**으로 통과시킨다(런북 먼저·알림 나중을 허용 — T0-3이 막히지 않게).

CI가 이 왕복(알림 → 런북 → `alerts:` 선언)을 검증한다 — 게이트는 fleet-hardening T3-5로 **이관**(`scripts/gates/check-runbooks.sh`, AC-2-6).

#### 2.6.1 가용성

| # | alertname | PromQL | for | SEV | 임계 근거 |
|---|---|---|---|---|---|
| A1 | `NodeDown` | `up{job="node-exporter"} == 0` | 2m | **1** | 15s 스크랩 × 8회 실패. 현재 0건 |
| A3 | `ExporterDown` | `up{job=~"dcgm-exporter\|gpu-model-exporter\|port-exporter\|smartctl-exporter\|vllm\|bmc-exporter"} == 0` | 5m | 2 | **현재 2건**(§0 G0-3) → 사전 정리 필요 |
| A2 | `TunnelDownData04` | data04 타깃 일괄 down **AND** `probe_success{instance="192.0.2.14"} == 1` | 2m | **1** | data04는 4개 타깃 전부 터널(172.18.0.1:9104/9404/9837/9987) 경유라 노드 down과 구분 불가 → **blackbox ICMP 선행 필수** |
| A4 | `VllmDown` | `probe_success{job="blackbox-http",target=~".*:8003/health\|.*:8010/health"} == 0` | 2m | **1** | blackbox 선행 |
| A5 | `StackEndpointDown` | `probe_success{job="blackbox-http",target=~"console\|grafana\|opensearch"} == 0` | 2m | 1/2 | blackbox 선행 |

#### 2.6.2 GPU — spec의 G1 PromQL은 **틀렸다**

> [!CAUTION]
> **최대 함정: `DCGM_FI_DEV_XID_ERRORS`는 카운터가 아니라 latched 게이지다.** [실측] data05 gpu0·gpu1 모두 **43** 고정, 24h range uniq=`['43']`, `changes(...[24h])`=**0**. 공식 정의는 "Value of the **last** XID error encountered"이며 같은 코드가 재발해도 exporter가 감지하지 못한다.
> 따라서 alerting spec §3.2의 `increase(DCGM_FI_DEV_XID_ERRORS[10m]) > 0`은 **양방향으로 틀렸다** — (a) 값이 고정이라 재발을 놓치고, (b) `> 0`으로 쓰면 data05는 2026-06-01부터 **영구 발화**한다.

```yaml
# 선행: DCGM 커스텀 counters csv(§3.4)로 DCGM_EXP_XID_ERRORS_COUNT 활성화
#       + --xid-count-window-size (env DCGM_EXPORTER_XID_COUNT_WINDOW_SIZE, ms)
- alert: GpuXidCritical
  expr: sum by (node,gpu,xid) (DCGM_EXP_XID_ERRORS_COUNT{xid=~"48|63|64|74|79|92|94|95"}) > 0
  labels: { severity: sev1 }
  annotations:
    summary: "{{ $labels.node }} gpu{{ $labels.gpu }} 치명 XID {{ $labels.xid }}"
    runbook_url: ".../docs/runbooks/gpu-xid-critical.md"

- alert: GpuXidApplication            # 앱-레벨 XID는 SEV2 (야간 노이즈 방지)
  expr: sum by (node,gpu,xid) (DCGM_EXP_XID_ERRORS_COUNT{xid!~"0|48|63|64|74|79|92|94|95"}) > 0
  labels: { severity: sev2 }

# csv 확장 전 임시방편: 전이만 감지. 재발 누락은 남는다(한계를 애너테이션에 명시).
- alert: GpuXidLatchChanged
  expr: changes(DCGM_FI_DEV_XID_ERRORS[10m]) > 0
  labels: { severity: sev2 }
```

**하이브리드가 정답임을 데이터가 증명한다.** OpenSearch `keiwi-logs-*`에 원본이 있다 [실측 14건, 전부 2026-06-01]:
`NVRM: Xid (PCI:0000:a2:00): 43, pid=146240, name=VLLM::Worker, channel 0x00000008`
→ DCGM이 43에 latch된 **이유**가 로그에 있고, DCGM은 절대 줄 수 없는 정보(발생 시각·PID·프로세스명)를 로그가 준다. 그리고 `name=VLLM::Worker`는 이 43이 **앱 레벨**임을 증명하므로 spec §3.2의 "치명 XID만 SEV1" 분기가 실데이터로 정당화된다.
→ 알림 애너테이션에 **Logs 워크벤치 딥링크**(host·시간 프리필터)를 넣어 XID의 주체(vLLM 워커인지 연구원 잡인지)를 즉시 판별한다. 단 §2.5에 따라 `pid`/`name`은 Slack 텍스트에 넣지 않는다 — 링크로만.

| # | alertname | PromQL | for | SEV | 근거 |
|---|---|---|---|---|---|
| G2 | `GpuRowRemapFailure` | `DCGM_FI_DEV_ROW_REMAP_FAILURE{modelName="NVIDIA A40"} > 0` | — | **1** | **[실측] 이 메트릭은 A40(data05) 2시리즈만 존재.** RTX 6000엔 시리즈가 아예 없다(row remapping은 Ampere+). 플릿 전체 셀렉터로 쓰면 2노드가 영구 no-data |
| G3 | `GpuThrottling` | `sum by (node,gpu) (DCGM_EXP_CLOCK_EVENTS_COUNT{clock_event=~"hw_thermal\|sw_thermal\|hw_power_brake"}) > 0` | 10m | 2 | **온도 절대 임계(85)를 쓰지 않는다.** 카드별 슬로우다운 포인트가 다르고(현재 A40 50/47°C, RTX6000 38~40°C), `clock_event` 라벨이 원인을 정확히 준다 |
| G4 | `GpuEccDbe` | `increase(DCGM_FI_DEV_ECC_DBE_VOL_TOTAL[10m]) > 0` | — | **1** | csv 확장 선행. RTX 6000은 row remap이 없으므로 **ECC가 유일한 VRAM 건강 신호** |
| H2 | `GpuZombie` | `DCGM_FI_DEV_FB_USED > 1024 and DCGM_FI_DEV_GPU_UTIL < 5` | 30m | 3 | "올라감"이 아니라 **"멈춤"**을 잡는다. 넛지만, 자동 kill 금지(§11) |

#### 2.6.3 자원 · 스택 자기건강 · vLLM

| # | alertname | PromQL | for | SEV | 임계 근거 |
|---|---|---|---|---|---|
| R1 | `DiskCritical` | `instance:node_fs_used:ratio{mountpoint="/"} > 0.95` | 5m | **1** | 기존 recording rule 재사용 |
| R2 | `DiskWarning` | `instance:node_fs_used:ratio{mountpoint="/"} > 0.85` | 30m | 2 | **현재 data04 = 0.8653** → 즉시 발화. G0-3 정리 대상 |
| R2b | `DiskFillingUp` | `instance:node_fs_avail:predict24h_bytes < 0 and instance:node_fs_used:ratio > 0.8` | 1h | 3 | 기존 `predict_linear` rule 재사용. 현재 전 노드 양수 = 안전 |
| R3 | `MemoryLow` | `instance:node_mem_used:ratio > 0.9` | 10m | 2 | **현재 data01 = 0.9011** → 즉시 발화 |
| S1 | `LogIngestStalled` | (OpenSearch 데이터소스) `keiwi-logs-*` 최신 `@timestamp`가 10분 이상 정체 | 10m | 2 | **G0-2가 이 규칙의 실물 증거. 있었다면 6일이 아니라 10분에 알았다** |
| S3 | `OpenSearchUnhealthy` | cluster `status == red` | 5m | 1 | **`!= green`으로 쓰면 안 된다** — 현재 `yellow`(unassigned_shards=37)라 즉시 발화. spec이 red만 지정한 것이 옳다 |
| S5 | `ClockDrift` | `abs(node_timex_offset_seconds) > 0.05` | 10m | 3 | 4노드 모두 <1ms = 건전. 로그 상관 오류 예방 |
| SM1 | `SmartFailure` | `smartctl_device_smart_status == 0` | — | 2 | **현재 data03 1개 디바이스만 수집**(data05 exporter down, data04 터널 미개통). `smartctl_device_attribute` 계열이 없어 마모도 알림은 불가 |
| V1 | `VllmTtftHigh` | 아래 YAML | 10m | 2 | 무트래픽 시 quantile이 **NaN**(실측) → 가드 없으면 조용히 죽은 규칙 |
| V2 | `VllmKvPressure` | `increase(vllm:num_preemptions_total[10m]) > 0 and on() vllm:num_requests_waiting > 0` | 10m | 2 | 두 메트릭 존재 확인 |
| W1 | `Watchdog` | `vector(1)` | — | — | 항상 firing. 관찰자가 heartbeat 부재를 감지(§2.9) |

```yaml
- alert: VllmTtftHigh
  # and on() 가드가 핵심: 트래픽이 없으면 histogram_quantile이 NaN이 되어 규칙이 조용히 죽는다.
  expr: |
    histogram_quantile(0.95, sum by (le) (rate(vllm:time_to_first_token_seconds_bucket[10m]))) > 3
    and on() sum(rate(vllm:time_to_first_token_seconds_count[10m])) > 0.01
  for: 10m
  labels: { severity: sev2 }
```

#### 2.6.4 하드웨어 (축1이 공급하는 신호 — alerting spec 카탈로그에 신규 추가)

이 그룹이 alerting spec §2의 4문 게이트를 가장 깨끗하게 통과한다. 조치가 물리적으로 명확하고(현장 PSU 교체·공조 확인) 런북 한 줄이 분명하다.

```yaml
- alert: PsuRedundancyLost
  expr: keiwi_bmc_psu_redundancy < 1
  for: 1m
  labels: { severity: sev1 }
  annotations:
    summary: "{{ $labels.node }} PSU 이중화 상실 — 단일 전원으로 동작 중"
    # 근거: 2025-05-10·2025-06-21 data03 PSU2가 실제로 두 번 죽었고 관측 스택은 몰랐다.
    runbook_url: ".../docs/runbooks/psu-redundancy-lost.md"

- alert: InletTempNearCritical
  # BMC가 선언한 임계에서 3°C 마진. 절대값(예 40) 하드코딩 금지 — 모델·펌웨어별로 다르다.
  expr: |
    keiwi_bmc_sensor_celsius{sensor=~".*Inlet Ambient"}
      >= on(node, sensor) (keiwi_bmc_sensor_threshold_celsius{level="upper_critical"} - 3)
  for: 10m
  labels: { severity: sev2 }
  annotations:
    summary: "{{ $labels.node }} 인렛 온도 {{ $value }}°C (BMC critical 42°C 근접)"

- alert: ChassisHealthDegraded
  expr: keiwi_bmc_chassis_health < 1
  for: 5m
  labels: { severity: sev2 }        # SysHealth Non-critical 전이 = 2025-06-21에 실제로 일어난 일

- alert: FanNotRedundant
  expr: keiwi_bmc_fan_redundancy < 1 or min by (node) (keiwi_bmc_fan_present) == 0
  for: 5m
  labels: { severity: sev2 }

- alert: SelNearFull
  expr: keiwi_bmc_sel_used_ratio > 0.75
  for: 1h
  labels: { severity: sev3 }        # 현재 data04 0.64 — rollover로 증거가 소실되는 중
  annotations:
    summary: "{{ $labels.node }} SEL {{ $value }} 사용 — 백필·clear 필요"

- alert: BmcCollectorStale
  # 함정 6 대응: 파싱 실패로 stale 값이 초록으로 보이는 것을 막는다.
  expr: time() - keiwi_bmc_collector_last_run_timestamp_seconds > 300
  for: 5m
  labels: { severity: sev2 }

- alert: BiosVersionDrift
  # ⚠️ 교정 — 초안이 참조하던 BIOS 버전 카운트 레코드는 **삭제됐다**(§1.8).
  #   그대로 두면 영구 no-data인 죽은 알림이 된다. 레코드명만 갈아끼우는 것이 아니라
  #   존폐를 판단했고, **존치**로 결론냈다: 드리프트를 알림으로 볼지의 판단 자체는
  #   이 축(알림)의 소관으로 유효하고, 교정 레코드가 같은 의도를 표현하며,
  #   현재값 0이라 day-1 발화도 없다. 활성화(배포) 판단은 §2의 게이트를 그대로 따른다.
  expr: max(fleet:node_bios_drift:count) > 0
  for: 1h
  labels: { severity: sev3 }        # 현재 0 (비교 가능한 모델 그룹은 DL380 Gen10 2대뿐이고 리비전이 같다)

- alert: NvidiaVersionMismatch
  # 축3의 textfile 메트릭. 이 규칙 하나가 G0-1(6일 방치)을 10분 탐지로 바꾼다.
  expr: node_nvidia_version_mismatch == 1
  for: 10m
  labels: { severity: sev2 }
  annotations:
    runbook_url: ".../docs/runbooks/nvidia-driver-mismatch.md"

- alert: NvidiaSmiFailing
  expr: node_nvidia_smi_ok == 0
  for: 10m
  labels: { severity: sev2 }
```

> [!NOTE]
> **PSU 출력 불균형은 알림으로 만들지 않는다.** [실측] data03 165W/60W, data04 15W/210W(14배)인데 둘 다 `Fully Redundant`다. HPE 전원 이중화 모드에 따라 정상일 수 있어 **조치가 불명확**하다 → alerting spec §2 질문 1에서 탈락. 대시보드 패널로만 둔다(§1.10). 이 판단 자체를 런북에 기록한다.

#### 2.6.5 inhibition 규칙 (4건만 — `gcx`로 apply)

| 상위 | 뮤트 대상 | 매칭 라벨 |
|---|---|---|
| `NodeDown` | 그 노드의 G*·R*·SM1·A3·HW* 전부 | `node` |
| `TunnelDownData04` | `node="data04"`의 A3·ExporterDown | `node` |
| `OpenSearchUnhealthy` | `LogIngestStalled`·`LogErrorSpike` | — |
| `PsuRedundancyLost` | 같은 노드의 `ChassisHealthDegraded` | `node` |

전제: **B2(라벨 정규화)**. 지금은 `node` 라벨이 없는 job이 있어 매칭 자체가 성립하지 않는다.

### 2.7 이상탐지 기반 알림

**(a) OpenSearch RCF 재사용 [실측]**
디텍터 `keiwi-log-errors-by-node`(id `zPEuRJ8BgKuBcuAw08Ta`), 10분 주기, feature `error_warn_count`, entity `fleet_node`(data04·data05), state RUNNING·init 100%.
결과 인덱스 `.opendistro-anomaly-results-history-*`에 총 **4582건** 중 `anomaly_grade > 0`은 **18건(0.4%)** — 예: grade 0.6875 / confidence 0.992 / data 5.0 vs expected 34.9.
플러그인 `opensearch-alerting`·`opensearch-notifications`는 **이미 설치**돼 있으나 monitor 0건(`.opendistro-alerting-config` 인덱스 자체가 없음), 채널 0건.

| 경로 | 판정 |
|---|---|
| (A) OpenSearch Alerting monitor → Notifications 채널 | **기각.** 알림 UI가 Grafana 밖에 하나 더 생겨 §I-2 위반(C2) |
| (B) **Grafana 알림 규칙이 `.opendistro-anomaly-results-history-*`를 조회** → `anomaly_grade > 0.7 AND confidence > 0.9` | **채택.** RCF 재사용 + 단일 라우팅 트리. 데이터소스 `keiwi-logs-es`가 이미 프로비저닝돼 있어 **인덱스 패턴만 추가** |

→ `L1 LogErrorSpike`(SEV2). 저트래픽 category 오탐 방지를 위해 **최소 이벤트 하한**을 함께 건다(alerting spec §9의 미해결 질문 — 실데이터로 정하되 초기값 `expected > 10`).

**(b) z-score 밴드는 페이징에 쓰지 않는다 — 수치로 기각한다 [실측]**
`instance:node_cpu_busy:ratio5m > instance:node_cpu_busy:band_upper`를 24h·5m step으로 조회한 breach 수: data04 **15** · data01 **4** · data03 **3** · data05 **3** → **하루 약 25회**.
더 중요한 건 breach가 일어난 **값**이다: data01은 CPU **0.0138(=1.4%)**, data03은 **0.0024(0.24%)**에서 밴드를 뚫었다. 유휴 구간에서 σ→0이 되어 `band_upper ≈ avg`가 되는 z-score의 고전적 실패 모드다. GPU도 동일 — breach 4건은 data04 gpu0의 util 91~100 = 그냥 "학습 시작"이다.

**4중 가드 없이는 쓰지 않는다.**
1. 절대 하한 동시 조건 — `and instance:node_cpu_busy:ratio5m > 0.5`
2. σ 하한 — `and instance:node_cpu_busy:stddev1h > 0.05`
3. `for: 15m`
4. **SEV3 다이제스트 전용 — 페이징 절대 금지**(`sre-addons/aiops-beyond-chat`의 관찰 모드 원칙과 일치)

### 2.8 섀도 모드 → 승격 게이트

1. import 시 `X-Grafana-Alerting-Alert-Rules-Paused: true`(또는 전 규칙을 SEV3 기록 채널로만 라우팅).
2. **2주간** 발화 빈도를 센다. 임계는 실데이터로 조정한다(alerting spec §6-3의 주간 리뷰를 미리 한 번 돌린다).
3. 승격 조건(전부 충족): (a) G0-3의 day-1 후보 10건이 0건, (b) 주 10회 이상 발화하면서 조치가 없는 규칙이 0건, (c) 전 규칙에 런북 파일 존재, (d) inhibition 4건 apply 완료.
4. 승격은 SEV1 → SEV2 → SEV3 순이 아니라 **가용성(A*) + 하드웨어(HW*) 먼저**다. 이 둘이 오탐 확률이 가장 낮다.

> [!WARNING]
> **Prometheus 보존이 30일**(compose `--storage.tsdb.retention.time=30d`)이라 임계 백테스트 창이 30일이다. 로그는 365일이지만 G0-2로 6일 공백이 생겼다. 계절성(학기·과제 마감)을 근거로 한 임계는 이 창으로 정당화할 수 없다 → v1 임계는 전부 "현재값 + 마진"으로 정하고 근거를 규칙 주석에 남긴다.

### 2.9 dead man's switch — Slack이 오히려 가장 값싸게 SPOF를 깬다

Prometheus·Grafana·OpenSearch·터널·(예정)알림이 전부 data05 단일 호스트에 있다. **G0-2가 정확히 그 실패 모드다.**
Slack egress를 1건 승인하면 **관찰자를 알림 스택 밖에 둘 수 있다**: data03(또는 data04)에 cron 1개 → `curl -sf http://192.0.2.15:9090/-/healthy` 및 Grafana `/api/health` 확인, 실패 시 **자기 자신이** Slack 웹훅 POST. Grafana 쪽에는 `Watchdog`(`vector(1)`)를 두고 관찰자가 heartbeat 부재를 감지한다.
`roles/watchdog`으로 추가(기존 role 5종과 동형).

> [!WARNING]
> **미검증 전제**: data03/data04에서 `hooks.slack.com` 도달 가능 여부. 이번 조사에서 두 노드는 권한 정책상 확인하지 못했다. 사람이 각 노드에서 1줄 `curl`로 확인해야 한다(tasks T2-11).

### 2.10 alerting spec의 사실 드리프트 3건 (§7 — 드리프트는 버그)

| 위치 | 기존 서술 | 실측 |
|---|---|---|
| §2 KEIwi 함정 | "data01/02는 수집 대상이 아니므로 절대 알림 대상이 아니다. 셀렉터는 data03/04/05로 한정" | **data01은 2026-07-24 온보딩되어 수집 중**(`up`에서 `.101`의 node·port·gpu-model 3개 모두 1). 단 드라이버 418로 DCGM 불가 → "node/port/gpu-model은 data01 포함, dcgm은 03/04/05만"으로 분기. **진짜 no-data는 data02(Windows)뿐** |
| §9 미해결질문 | "data03 DCGM 실제 기동?" | **기동 확인**(`up{job="dcgm-exporter",instance="192.0.2.13:9400"}=1`, XID·온도 시리즈 정상) |
| (신규 발견) | — | **data05는 `node_systemd_unit_state` 시리즈가 없다**(compose의 `--collector.systemd`가 컨테이너에서 동작하지 않음 — 101/103/104만 존재) → recording rule `instance:node_systemd_units_failed:count`가 data05에 대해 **영구 no-data**. 알림을 걸기 전에 이 구멍을 알고 있어야 한다(초록 오해 방지) |

추가로, 기존 rule은 `state="failed"`만 세므로 **`activating (auto-restart)` 크래시루프를 원리적으로 못 잡는다** — data05의 431,899회 재시작이 그 증거다. 신규 신호 필요: 유닛 `NRestarts` 또는 `activating` 지속.

### 2.11 수용 기준 (축2)

| # | 검증 | 명령 / 기대 |
|---|---|---|
| **AC-2-1** | 규칙 문법 | `promtool check rules infra/monitoring/alerts/*.yml` → `SUCCESS`, 전 규칙에 `for` 또는 즉시성 근거 주석 |
| **AC-2-2** | 데이터소스 uid 고정 | `curl -s $G/api/datasources/uid/keiwi-prom \| jq -r .readOnly` → `true` |
| **AC-2-3** | 라벨 정규화(B2) | `q 'count(up) - count(up{node=~"data0[1-5]"})'` → `0` |
| **AC-2-4** | 규칙 import 완료 | `curl -s -H "Authorization: Bearer $T" $G/api/v1/provisioning/alert-rules \| jq length` → `≥ 20` |
| **AC-2-5** | 섀도 모드 | 동 응답 `jq '[.[]\|select(.isPaused==true)]\|length'` == 전체 length |
| **AC-2-6** | **런북 왕복 CI 게이트** (fleet-hardening T3-5로 **이관** — 경로 정정 `scripts/check-runbooks.sh` → `scripts/gates/check-runbooks.sh`) | `bash scripts/gates/check-runbooks.sh` → 모든 alertname이 `docs/runbooks/*.md` 전용 런북을 가리키고 그 런북이 frontmatter `alerts:`로 담당을 선언(§2.6 규약, kebab은 폴백), 위반 시 exit 1 |
| **AC-2-7** | 딥링크 정본 | 전 규칙 `dashboard_url`이 `-v3`가 아닌(또는 정본으로 확정된) uid만 참조: `! grep -q 'keiwi-.*-v3' infra/monitoring/alerts/*.yml` |
| **AC-2-8** | XID 규칙이 latched 게이지를 쓰지 않음 | `! grep -qE 'increase\(DCGM_FI_DEV_XID_ERRORS' infra/monitoring/alerts/*.yml` |
| **AC-2-9** | Slack 라벨 화이트리스트 | 템플릿 파일에 `user`·`pid`·`cmdline`·`instance`·`modelName` 문자열 부재: `! grep -qE '\.user\|\.pid\|\.cmdline\|\.instance\|modelName' infra/monitoring/grafana/provisioning/alerting/templates/*.yaml` |
| **AC-2-10** | 시크릿 미커밋 | `npm run check:secrets` 통과 + `! grep -rq 'hooks.slack.com/services/T' .`(레포 전체) |
| **AC-2-11** | inhibition apply | `gcx get inhibitionrules -o json \| jq length` → `4` |
| **AC-2-12** | Watchdog 상시 발화 | `q 'ALERTS{alertname="Watchdog",alertstate="firing"}'` → `1` |
| **AC-2-13** | 관찰자 독립성 | data05 Prometheus 컨테이너 정지 후 **60분 내** data03 관찰자가 Slack 발화(수동 검증, 런북에 절차 기록) |
| **AC-2-14** | day-1 오발화 0 | 승격 직전 `q 'count(ALERTS{alertstate="firing",severity!="none"})'` → `≤ 1`(Watchdog만) |

---

## 3. 축3 — 도입검증 · 증설판단

### 3.1 순서를 바꿔야 한다 — 표준화가 벤치마크의 선행 조건이다

"벤치마크를 넣는 방법"을 조사하러 갔더니 라이브 장애(G0-1)와 표준화 부재(README §1.5)가 먼저 나왔다. 이 둘은 회피 불가한 선행 조건이다.

- **드리프트를 남긴 채 측정하면 노드 간 비교가 불가능하다.** data05 벤치 스택 = torch 2.11.0+cu130(CUDA 13.0), data04 = 드라이버 535 → **CUDA 12.2 천장** → 동일 벤치 바이너리 사용 불가. data04용 cu121 별도 빌드가 필요해진다.
- **깨진 드라이버 위에서 컨테이너 벤치는 기동 자체가 불확실하다.** data05 `nvidia-cdi-refresh.service`가 failed라 nvidia-container-toolkit CDI 스펙 재생성이 안 된다.

### 3.2 드리프트 탐지는 신규 exporter 0개로 오늘 된다

**(a) 이미 붙어 있는 라벨** — dcgm-exporter가 모든 메트릭에 `DCGM_FI_DRIVER_VERSION` 라벨을 붙인다 [실측].

```yaml
# rules/keiwi-standards.yml — record:만. 표준 버전은 라벨 비교가 아니라 문서(inventory)와의 join이 정석.
groups:
  - name: keiwi_standards
    interval: 5m
    rules:
      # 플릿에서 관측된 GPU 드라이버 버전 종류 수. ⚠️ 교정 — 라벨 필터가 **필수**다.
      #   초안 식(필터 없음)이 반환한 2는 "버전 2종"이 아니라 "라벨 있는 버킷 1 + **라벨 없는 버킷 1**"
      #   이었다 [실측 2026-08-03: {DCGM_FI_DRIVER_VERSION="595.71.05"}=2 · {}=4,
      #   label/DCGM_FI_DRIVER_VERSION/values는 값이 **1개뿐**]. data03·04의 dcgm-exporter가
      #   버전 라벨을 방출하지 않기 때문이고, 전 노드가 같은 버전이 되어도 계속 2를 보고한다.
      #   → 라벨 있는 것만 세고, 사각지대 크기를 fleet:gpu_driver_unlabeled:count로 **반드시 동반 노출**한다.
      #   필터만 걸고 끝내면 "1종으로 통일됨"이라는 더 나쁜 거짓말이 된다. 교정 후 실측 = 1.
      - record: fleet:gpu_driver_versions:count
        expr: count(count by (DCGM_FI_DRIVER_VERSION) (DCGM_FI_DEV_GPU_UTIL{DCGM_FI_DRIVER_VERSION!=""})) or vector(0)

      # 이 지표가 **못 보는** GPU 수. 현재 4(data03 ×2 + data04 ×2). 0이 되어야 위 값이 플릿 전체를 뜻한다.
      - record: fleet:gpu_driver_unlabeled:count
        expr: count(DCGM_FI_DEV_GPU_UTIL{DCGM_FI_DRIVER_VERSION=""}) or vector(0)

      # 커널 릴리스 종류 수. 실측 = 4 (4.4.0-179 / 6.8.0-101 / 6.8.0-117 / 6.8.0-134).
      - record: fleet:kernel_releases:count
        expr: count(count by (release) (node_uname_info))
```

**(b) 라벨로는 못 잡는 것** — DCGM 라벨은 **커널모듈** 버전(595.71.05)을 보고한다. 유저스페이스(595.84)와의 불일치가 안 보인다. **G0-1이 정확히 이 사각지대였다.** → textfile 4메트릭이 필요하다.

```sh
# roles/node-hygiene/templates/keiwi-node-hygiene.sh.j2 에 블록 추가 (신규 role 불필요)
node_nvidia_kernel_module_version{version="595.71.05"} 1   # awk from /proc/driver/nvidia/version
node_nvidia_userspace_version{version="595.84"} 1          # ldconfig -p → readlink -f (※ 각주)
node_nvidia_smi_ok 0                                       # `nvidia-smi -L`; echo $?  → 0=정상
node_nvidia_version_mismatch 1                             # 두 값 비교
```

> [!NOTE]
> **※ NVML 경로를 하드코딩하지 마라 — data01에서 깨진다** [실측 2026-08-03, 4노드 전수].
> `readlink libnvidia-ml.so.1`을 고정 경로(`/usr/lib/x86_64-linux-gnu/`)로 쓰면 data01은
> NVML이 **`/usr/lib/nvidia-418/libnvidia-ml.so.1`**이라 빈 문자열이 나오고, 그것을 mismatch로
> 해석하면 legacy 노드가 영구 오탐한다. `ldconfig -p`로 링커가 실제로 고르는 경로를 얻은 뒤
> `readlink -f`로 실파일까지 따라간다 — 4노드(418.39 / 595.71.05 / 535.309.01 / 595.84) 전부 정확했다.
>
> **구현은 fleet-hardening T1-3**이고, 거기서 메트릭 2개가 더 붙는다:
> `node_nvidia_probe_ok`(두 버전을 모두 파싱했는가 — 판정불능과 정상의 구분)와
> `node_nvidia_smi_exit_code`(런북이 exit 18로 분기). 파싱 실패 시 mismatch를 1로 두면 data01이
> 영구 오탐하고, 0으로 두면 "측정하지 않은 것이 정상으로 보이는" 이 사고의 실패모드를
> 메트릭 레벨에서 재생산한다 — 그래서 **세 번째 상태**가 필요하다.

> [!IMPORTANT]
> **`node_nvidia_smi_ok` 단 하나가 6일 방치를 1분 탐지로 바꾼다.** 이 문장이 P1의 정당화 전부다. 배선처는 이미 존재한다 — node-exporter `--collector.textfile.directory`가 data01/03/04에 적용돼 있고 data04에 `keiwi_node_hygiene.prom`이 실존한다. data05는 compose에 `/var/lib/node_exporter/textfile:/host/textfile:ro` 마운트가 이미 있다.

### 3.3 벤치마크 도구 판정표 — 우리 환경 실측 기준

| 도구 | 가능? | 남기는 수치 | 제약 |
|---|---|---|---|
| **torch.distributed**(all_reduce·P2P·H2D·GEMM) | ✅ **즉시** | busbw GB/s · D2D/H2D GB/s · bf16 TFLOPS | `/data/vllm/env`에 torch 2.11.0+cu130 + **NCCL 2.28.9** 존재 [실측]. 설치 0 |
| `dcgmi diag -r 1\|2\|3 -j` | ⚠️ 조건부 | 테스트별 pass/fail · PCIe 대역폭 · 메모리 오류 | **`dcgmi`가 플릿 전무.** DCGM은 data05 dcgm-exporter **컨테이너 안에만** 존재(스크랩 Hostname=`a7d78c3cd143`). 호스트에 `datacenter-gpu-manager-4-core` apt 설치 필요. r1=deployment(수초, **드라이버 정합성 — G0-1을 바로 잡는 항목**), r2=+PCIe/P2P(~2분), r3=+stress(~12분, **GPU 배타 점유**) |
| `nccl-tests`(all_reduce_perf) | ⚠️ 컴파일 선행 | size별 algbw/busbw + 지연 | **`nvcc`가 플릿 어디에도 없다**(`/usr/local/cuda*` 부재). `nvidia/cuda:13.0-devel` 컨테이너로 빌드 → G0-1 수복 선행 |
| `nvbandwidth` | ⚠️ CMake+nvcc | host↔device·device↔device 전조합 매트릭스 | cross-socket SYS 페널티 정량화에 가장 정밀 |
| `gpu-burn` | ⚠️ nvcc | 안정성·열·전력 상한 | **스로틀 메트릭을 먼저 켜야 한다**(§3.4). RTX6000·A40은 섀시 풍량 의존이 큰 카드 |
| MLPerf Inference | ❌ 어렵다 | — | **불필요**. vLLM 메트릭 369 시리즈(`vllm:time_to_first_token_seconds`·`inter_token_latency_seconds`·`e2e_request_latency_seconds`·`generation_tokens_total`)가 라이브 수집 중 → **실 워크로드가 곧 벤치마크**다. "합성 벤치 대신 실제 서빙 SLI로 세대 비교"가 우리 문맥에서 더 설득력 있다 |
| 멀티노드 NCCL over TCP | ✅ 가능(낮은 수치 예상) | 노드간 busbw GB/s | IB/RoCE 없음. bond0 + `ens10f0~f3` 4포트 중 **f0만 UP**. `NCCL_SOCKET_IFNAME=bond0`·`NCCL_IB_DISABLE=1`. **낮은 수치 자체가 결론** — "이 네트워크로는 멀티노드 병렬이 성립하지 않는다"를 GB/s로 증명해 100GbE/IB 투자 임계를 만든다 |

**토폴로지 결론 [실측]**: 플릿 전체 **NVLink 0**. data03·data04 `nvidia-smi topo -m` = GPU0↔GPU1 **SYS**(PCIe + 소켓간 UPI 횡단), NUMA 0/1, CPU affinity `0-9,20-29` / `10-19,30-39`. `nvidia-smi nvlink -s` = "all links are inActive" = **커넥터는 있으나 브리지 미장착**. RTX 6000 `pcie.link.gen.max = 3`. data05 A40은 `0000:2b:00.0`와 `0000:a2:00.0`(다른 루트 컴플렉스), `DCGM_FI_DEV_NVLINK_BANDWIDTH_TOTAL = 0`.

> [!IMPORTANT]
> **결정적 반전**: `torch.cuda.can_device_access_peer(0,1)` 및 `(1,0)` 모두 **True** (data05). SYS 토폴로지인데도 GPU간 **P2P DMA가 활성**이다 → NCCL이 호스트 메모리 경유(SHM bounce)가 아니라 **PCIe P2P 경로**를 쓴다. 이 한 줄이 예상 결과를 수 GB/s ↔ 수십 GB/s로 바꾼다. 그래서 벤치 시 `NCCL_DEBUG=INFO` 로그로 실제 선택 경로를 **이중 검증**한다.

> [!CAUTION]
> **NVLink 브리지 추가를 쉽게 권고하지 않는다.** 커넥터가 있고 `nvlink -s`가 inActive라 "브리지만 끼우면 될 것" 같지만, 두 GPU가 **서로 다른 NUMA 소켓**에 물려 있다. 브리지는 물리적으로 인접한 2/3슬롯 간격을 요구하므로 현 슬롯 배치에서 장착 가능한지는 **섀시를 열어 슬롯 간격을 실측**해야 한다. 안 열어보고 구매 권고하면 틀린다.

### 3.4 DCGM counters csv 확장 (알림·벤치 공통 선행)

현재 라이브 DCGM 메트릭 20종 = **3.3.5 기본 csv 그대로** [실측].
**없어서 지금 알림이 불가능한 것**: `DCGM_FI_DEV_ECC_SBE_VOL_TOTAL`·`ECC_DBE_VOL_TOTAL`·`*_AGG_TOTAL` · `THERMAL_VIOLATION` · `POWER_VIOLATION` · NVLink 에러 4종(CRC_FLIT/CRC_DATA/REPLAY/RECOVERY) · **`DCGM_EXP_XID_ERRORS_COUNT`** · **`DCGM_EXP_CLOCK_EVENTS_COUNT`** · RETIRED_SBE/DBE/PENDING · `POWER_MGMT_LIMIT` · `SLOWDOWN_TEMPERATURE`.
이들은 3.3.5~3.4.0 태그의 `etc/default-counters.csv`에 **주석 처리된 채 존재**(라인 8·31·32·37·43~46·49~51·54~57).

- 산출물: `infra/monitoring/dcgm/keiwi-counters.csv` + compose에 `-f` 마운트 + `--xid-count-window-size` / `--clock-events-count-window-size`.
- `DCGM_EXP_CLOCK_EVENTS_COUNT`의 `clock_event` 라벨 값(소스 확인): `gpu_idle`·`clocks_setting`·`power_cap`·`hw_slowdown`·`sync_boost`·`sw_thermal`·`hw_thermal`·`hw_power_brake`·`display_clocks` → **G3을 온도 임계 대신 원인 라벨로 정확히 잡는다.**
- csv 변경은 data03/04/05 exporter **재시작**을 요구한다(사람, §11).

> [!NOTE]
> `DCGM_FI_DEV_MEMORY_TEMP`는 A40에서 **0**으로 나온다 [실측] → 메모리 온도를 신뢰하지 말 것. 패널·알림에서 제외한다.

### 3.5 벤치마크 이력화 — `node-hygiene` 패턴 복제

```
roles/gpu-benchmark/   templates/keiwi-gpu-bench.sh.j2   (mktemp 동일디렉터리 + chmod 0644 + mv -f 원자교체 + set -euo pipefail)
                       templates/keiwi-gpu-bench.timer.j2 (OnCalendar=weekly + Persistent=true, 수동 트리거 가능)
                       defaults/main.yml (bench_textfile_dir, bench_sizes, bench_iters, bench_enabled: false)
```

출력 `/var/lib/node_exporter/textfile/keiwi_gpu_bench.prom`:

```
keiwi_gpu_bench_nccl_allreduce_busbw_gbps{gpus="2",size_bytes="268435456"}
keiwi_gpu_bench_p2p_bandwidth_gbps{src="0",dst="1"}
keiwi_gpu_bench_h2d_bandwidth_gbps{gpu="0"}
keiwi_gpu_bench_matmul_tflops{gpu="0",dtype="bf16"}
keiwi_gpu_bench_dcgm_diag_pass{level="2",test="pcie"}
keiwi_gpu_bench_last_run_timestamp_seconds / _duration_seconds / _exit_code
keiwi_gpu_bench_meta{driver_version="595.71.05",nccl="2.28.9",torch="2.11.0+cu130",kernel="6.8.0-134"} 1
```

> [!IMPORTANT]
> **`keiwi_gpu_bench_meta`가 없으면 "드라이버 바꾸고 느려졌나"에 영구히 답할 수 없다.** 벤치 결과는 반드시 스택 버전과 함께 저장한다.

**가장 값나가는 파생 지표 — 자기 자신 대비 회귀 탐지**

```promql
keiwi_gpu_bench_matmul_tflops / quantile_over_time(0.5, keiwi_gpu_bench_matmul_tflops[90d]) < 0.9
```
절대 임계 없이 "이 GPU가 90일 중위값보다 10% 느려짐"을 잡는다(열화·스로틀·펌웨어/드라이버 회귀). 상용 하드웨어 관리 SW가 파는 기능이 이것이다.

카디널리티 통제: 크기 스윕은 **대표 3~4개만** textfile에 남기고 전체 스윕 원본은 JSON 아티팩트로 별도 보관.

**PoC 노드 선정 — data03이 유일한 최적 후보 [실측]**

| 노드 | 판정 | 근거 |
|---|---|---|
| **data03** | **최적** | 완전 유휴(가용 VRAM 97.7%/97.7%, util 0, 전력 11.1W/17.1W) · 드라이버 595.71.05 정합 · CUDA 13.2 천장(torch cu130 호환) · `.105`에서 SSH `:<SSH_PORT>` 직접 · Prometheus가 9100/9400/9836/9986/9633을 **직접 스크랩** → textfile 즉시 반영 · 2GPU SYS로 cross-socket 특성 측정 가능 |
| data05 | 지금은 부적합 | GPU0에 vLLM 상주(가용 VRAM 8.66%) · G0-1 미수복 · CDI 깨짐. **단 수복 후에는 A40(PCIe4·sm8.6) vs RTX6000(PCIe3·sm7.5) 세대 비교의 다른 한쪽으로 필요** |
| data04 | 2순위 | 유휴 편(52.3%/76.1%)이나 CUDA 12.2 천장 → **동일 바이너리 불가**. 접근도 터널 경유. 역설적으로 "표준화 안 하면 비교조차 못 한다"의 산증인 |
| data01 | 제외 | 418.39 / 커널 4.4 / Tesla M4 3.7GiB / CUDA 10.1. 현대 스택 불가 → **legacy 예외 선언**(ADR-0020(신설 예정)) |

> [!CAUTION]
> **벤치마크는 "읽기 전용"이 아니다.** all_reduce·gpu-burn·`dcgmi diag -r3`는 GPU를 배타 점유하고 전력·온도를 상한까지 올린다. §11/§12 게이트를 통과해야 하고, 실행 노드에 상주 워크로드가 있으면 OOM·서비스 중단을 유발한다. 이 조사에서 실제 벤치는 **의도적으로 실행하지 않았다** — capability 질의(`can_device_access_peer`·`get_device_properties`)까지다.

### 3.6 증설 판단 지표 체계 — 실재하는 시리즈만으로 구성

```yaml
# rules/keiwi-capacity.yml — 2단 recording rule 필수(서브쿼리 비용 통제)
groups:
  - name: keiwi_capacity_gpu
    interval: 60s
    rules:
      # 축1) GPU-hours 점유율
      - record: gpu:util_busy:bool
        expr: DCGM_FI_DEV_GPU_UTIL >= bool 10
      - record: fleet:gpu_hours_busy:1d
        expr: sum(avg_over_time(gpu:util_busy:bool[1d])) * 24
      - record: fleet:gpu_hours_capacity:1d
        expr: count(DCGM_FI_DEV_GPU_UTIL) * 24

      # 축2) VRAM 여유 — ADR-0013이 확정한 binding 제약(util 아님)
      - record: gpu:vram_free:ratio
        expr: DCGM_FI_DEV_FB_FREE / (DCGM_FI_DEV_FB_FREE + DCGM_FI_DEV_FB_USED)
      - record: node:vram_best_free:ratio
        expr: max by (instance) (gpu:vram_free:ratio)

  - name: keiwi_capacity_slow          # 서브쿼리는 별도 그룹 + 긴 interval
    interval: 5m
    rules:
      # 전 노드가 "자리 없음"인 시간 비율(7일). ADR-0013의 full 임계 0.15 재사용 → 정책 일관성.
      - record: fleet:no_room:ratio7d
        expr: |
          avg_over_time(
            (count(node:vram_best_free:ratio < 0.15) == bool count(node:vram_best_free:ratio))[7d:5m]
          )
      # 30일 후 VRAM 포화 예측. 창을 조달 리드타임(수개월)에 맞춰 잡는다.
      - record: fleet:vram_used_predict30d:ratio
        expr: predict_linear(avg_over_time(gpu:vram_used:ratio[1d])[14d:1h], 86400 * 30)
```

**축3) 대기 시간 — 수요 초과의 직접 증거.** `vllm:request_queue_time_seconds_bucket`·`num_requests_waiting`·`num_preemptions_total`·`kv_cache_usage_perc`가 이미 수집 중이라 **합성 지표가 불필요하다.**

**축5) 전력·열 헤드룸.** `instance:gpu_power:watts`(현재 data05 157.1 / data04 32.4 / data03 28.6) · `instance:gpu_energy:kwh1d`(data05 gpu0 누적 4.165e11 mJ ≈ **115.7 kWh** 생애 소비) · 그리고 §1.8의 섀시 전력. 랙 예산은 `inventory.yaml`의 `pdu_circuit`이 채워진 뒤에만 비율로 말한다(그 전에는 W 절대값만).

**증설 트리거 3개 (ADR-0021(신설 예정))**

| # | 트리거 | 조건 | 의미 |
|---|---|---|---|
| **A** | 자리 없음 지속 | `fleet:no_room:ratio7d > 0.5` 가 **4주 연속** | 전 노드에 모델 들어갈 자리가 절반 이상의 시간 동안 없음 |
| **B** | 대기 + 포화 **동시** | `histogram_quantile(0.95, sum by (le)(rate(vllm:request_queue_time_seconds_bucket[30m]))) > 5` **AND** `min(node:vram_best_free:ratio) < 0.15` (30m 지속) | **이 AND가 모델의 지적 핵심.** 큐만 길면 배치·설정 튜닝 문제, VRAM까지 만석이면 진짜 용량 부족 → "증설로 풀리는 문제"와 "설정으로 풀리는 문제"를 데이터로 분리 |
| **C** | 예측 포화 | `fleet:vram_used_predict30d:ratio > 0.85` | 조달 리드타임(GPU 수개월)보다 짧은 예측창은 무의미하다는 논리를 명시. 창 30~90일 |

### 3.7 지금 이 모델이 내놓는 답: **증설 불필요**

[실측] 가용 VRAM — data03 **97.7% / 97.7%**(두 GPU 모두 완전 유휴, 전력 11~17W) · data04 52.3% / 76.1% · data05 8.66%(vLLM 상주) / 80.6%.
병목은 GPU 부족이 아니라 **드라이버 표준화 부재와 유휴 자원 미활용**이다.

> [!IMPORTANT]
> 증설 판단 모델의 첫 산출물이 **"사지 마라, 대신 data03을 쓰라"**인 것이 이 모델을 신뢰할 수 있게 만드는 가장 강한 증거다. 지표 체계를 "증설을 정당화하는 도구"가 아니라 **"증설을 기각할 수도 있는 도구"**로 제시한다.

### 3.8 표준화 결정 (ADR-0020(신설 예정))

1. **표준 드라이버 = 595.x, 커널모듈은 open으로 통일**(data03이 이미 그 형태).
2. **NVIDIA 패키지를 `unattended-upgrades` 블랙리스트에 넣는다.** G0-1의 직접 원인 차단이며, 드라이버는 커널모듈 재적재를 요구하므로 무인 업그레이드 대상이 되어선 안 된다.
3. **data01(418 / 16.04 / Tesla M4)은 표준화 대상이 아니라 명시적 `legacy` 예외**로 선언한다. 억지로 맞추지 않고 경계를 긋는 것이 판단이다.
4. `roles/nvidia-driver`는 목표 버전·플레이버를 inventory 변수로 선언하고 **드리프트를 보고(check 모드)하며 적용은 사람이** 한다(§11).
5. `docs/inventory.yaml`의 드라이버 기재를 실측값으로 교정하고 **커널모듈 플레이버 필드를 신설**한다(현재 "드라이버 535"로 적혀 있어 실측과 불일치 — 문서 드리프트도 발견 사항이다).

### 3.9 은폐 구조 제거 (G0-1의 2차 원인)

| 은폐 | 실측 | 조치 |
|---|---|---|
| 고아 프로세스가 포트를 물어 `up=1` | `:8003` pid 1359993(Jun 16 기동, 구 모델 Qwen3-Coder-30B) · `:9836` pid 2580064(Jun 9, 50일, `/gits/MineSweeper/deploy/gpu-model-exporter.py` = **KEIwi 레포 것이 아님**). Prometheus는 vllm 369 시리즈 정상 응답 | **port-exporter 확장** — 리스닝 프로세스의 실행파일 경로를 기대값과 대조하는 메트릭 추가 |
| 크래시루프를 `state="failed"`가 못 잡음 | `keiwi-gpu-model-exporter` restart counter **431,899** (`Address already in use`) | 유닛 `NRestarts` 또는 `activating` 지속 메트릭 추가 |
| data05가 호스트 systemd를 못 봄 | `node_systemd_unit_state`가 101/103/104만 존재 | 호스트 systemd 노출 또는 textfile 폴백 |
| 고아 exporter가 샘플 0개 노출 | data05 `gpu_vram_total_bytes` 시리즈 **부재** → ADR-0013 판정이 unknown | G0-1 수복 + `keiwi_gpu_model_up` 류 자기건강 메트릭 |
| data05 nodename 불안정 | `node_uname_info` nodename = `89bf04921943`(컨테이너 호스트명, 재생성 시 변경). inventory에는 `efc20b3d818e`로 적혀 있어 **이미 어긋남** → 최근 커밋의 Grafana `var-nodename` 드릴다운이 data05에서 조용히 깨질 수 있다 | `hostnamectl` 정리 또는 드릴다운을 `node` 라벨 기반으로 전환 |

### 3.10 수용 기준 (축3)

| # | 검증 | 명령 / 기대 |
|---|---|---|
| **AC-3-1** | 드리프트 시리즈 존재 **+ 사각지대 동반 노출** | `q 'fleet:gpu_driver_versions:count'` → `1`(라벨 있는 GPU만. 초안이 적은 `2`는 라벨 부재 버킷을 센 거짓값이었다) · `q 'fleet:gpu_driver_unlabeled:count'` → `4`(**필수 동반 검증** — 이 값이 없으면 위의 1은 "통일됐다"는 거짓말이다) · `q 'fleet:kernel_releases:count'` → `4` |
| **AC-3-2** | 유저스페이스 불일치 탐지 | `q 'node_nvidia_version_mismatch'` → G0-1 수복 **전** `1`, **후** `0`. 두 값이 시계열에 모두 남아야 한다. ⚠️ **2026-08-06 개정**: 탐지 배포(T0-2)·증거 보존(fleet-hardening T1-11) 전에 재부팅(T0-4)이 먼저 일어나 "전 `1`" 시계열을 확보하지 못했다 — 본 AC는 **재발 시** 검증 항목으로 유지하고, 현행 통과 기준은 전 GPU 노드 `0` 상시로 둔다 |
| **AC-3-3** | smi 헬스 | `q 'min(node_nvidia_smi_ok)'` → `1` |
| **AC-3-4** | 표준화 완료 | **DCGM 기준으로는 도달 불가**(라벨 부재 GPU 4장이 남는 한 `1`은 부분집합에 대한 참일 뿐이다) → `q 'fleet:gpu_driver_versions:count_hygiene'` → `1` **AND** `q 'fleet:gpu_driver_unlabeled:count'` → `0` 으로 교체. count_hygiene 은 node-hygiene textfile 기반이라 data01(legacy)과 유저스페이스 불일치까지 덮는다. **선행: fleet-hardening 축1 T1-4 배포** |
| **AC-3-5** | DCGM csv 확장 | `q 'count(count by (xid) (DCGM_EXP_XID_ERRORS_COUNT))'` → `≥ 1`, `q 'count(DCGM_FI_DEV_ECC_DBE_VOL_TOTAL)'` → `≥ 6` |
| **AC-3-6** | clock_event 라벨 | `q 'count(count by (clock_event) (DCGM_EXP_CLOCK_EVENTS_COUNT))'` → `≥ 1` |
| **AC-3-7** | 벤치 신선도 | `q 'time() - max(keiwi_gpu_bench_last_run_timestamp_seconds)'` → `< 691200`(8일, weekly 타이머 + 여유) |
| **AC-3-8** | 벤치 메타 라벨 | `q 'count(keiwi_gpu_bench_meta)'` → `≥ 1`, 라벨에 `driver_version`·`nccl`·`torch`·`kernel` 4개 모두 존재 |
| **AC-3-9** | 회귀 탐지 쿼리 성립 | `q 'count(keiwi_gpu_bench_matmul_tflops / quantile_over_time(0.5, keiwi_gpu_bench_matmul_tflops[90d]))'` → `≥ 1`(데이터 90일 누적 후) |
| **AC-3-10** | 카디널리티 통제 | `q 'count(count by (size_bytes) (keiwi_gpu_bench_nccl_allreduce_busbw_gbps))'` → `≤ 4` |
| **AC-3-11** | 증설 트리거 시리즈 | `q 'fleet:no_room:ratio7d'` → `0 ≤ x ≤ 1`, `q 'fleet:gpu_hours_busy:1d / fleet:gpu_hours_capacity:1d'` → `0 ≤ x ≤ 1` |
| **AC-3-12** | 서브쿼리 비용 | `q 'max(prometheus_rule_group_last_duration_seconds{rule_group=~".*capacity_slow.*"})'` → `< 30` |
| **AC-3-13** | 벤치 role 안전 기본값 | `grep -q 'bench_enabled: false' infra/ansible/roles/gpu-benchmark/defaults/main.yml` → exit 0 (명시적 옵트인 없이 GPU를 점유하지 않는다) |
| **AC-3-14** | inventory 드라이버 교정 | `yq '.nodes[] \| select(.gpu != null) \| .driver' docs/inventory.yaml`이 실측 4값(418.39 / 595.71.05 open / 535.309.01 / **595.84**)과 일치 — data05는 2026-08-06 재부팅 후 595.84로 정합(원안의 595.71.05는 재부팅 전 커널 모듈 값) |

---

## 4. 미해결 질문 (착수 전 확인 — 답이 없으면 해당 단계만 멈춘다)

| # | 질문 | 막는 것 |
|---|---|---|
| Q1 | data05 sudoers를 어떻게 교정할지(순서 수정 vs 별도 파일 우선순위) | 축1 data05 배포(G0-4) |
| Q2 | data01의 `ipmi_devintf` modprobe를 영구화(`/etc/modules-load.d`)할지, data01을 하드웨어 관측 예외로 확정할지 | AC-1-5의 기대값(3 vs 4) |
| Q3 | Gen9/iLO4에서 전력 0W의 원인 — iLO Advanced 라이선스인가 P89(2017) 펌웨어 제약인가 **[가설 단계]** | 플릿 전력 합계의 정직성(§1.8 주석) |
| Q4 | SRE **폰 OS** — iOS면 ntfy 자체호스트 푸시에 제약 | 채널 2단계(ntfy) |
| Q5 | data03/data04에서 `hooks.slack.com` 도달 가능? | dead man's switch(§2.9) |
| Q6 | data04로 ICMP를 ufw가 허용하나? | A2(터널 down 구분) |
| Q7 | 대시보드 uid 정본 — `keiwi-*` vs `keiwi-*-v3` | AC-2-7 |
| Q8 | `10.218.18.0/24`가 기존 관리 대역인가(ARP OUI `00:1a:f4` 3건) | P7 관리망 설계 |
| Q9 | data05 재부팅 시 `:8003` 고아가 사라지고 systemd가 신 모델(Qwen2.5-Coder-32B)을 띄운다 → **어시스턴트 모델이 조용히 바뀐다.** 의도된 변경인가 | G0-1 수복 절차 |
| Q10 | L1 최소 이벤트 하한(저트래픽 category 오탐 방지 절대 임계) | §2.7 (a) |

## 5. 스코프 아웃

[README §6](./README.md#6-이-스펙이-하지-않는-것-스코프-아웃--암묵-누락-금지)과 동일. 추가로 이 spec 범위에서 제외:
- **PSU 출력 불균형 알림**(§2.6.4 주석 — 조치 불명확으로 게이트 탈락, 패널만)
- **BIOS 경과일 recording rule** — **삭제로 종결**(B10, fleet-hardening T4-7. 초안 레코드명은 fleet-hardening spec §4.2 D4-6). PromQL로 라벨 날짜 파싱이 불가해 초안 식은 릴리스 일자가 아니라 수집 시각을 재고 있었다. 경과일이 다시 필요하면 exporter 쪽 `keiwi_bmc_bios_age_days` 신설을 BMC 축의 새 백로그로 연다
- **팬 RPM 기반 어떤 것도**(§1.2)
- **자동 조치·자동 kill**(§11)

## 6. 이 스펙이 요구하는 ADR

| ADR | 제목 | 필수 결정 항목 |
|---|---|---|
| **0018** | 알림 엔진과 채널 | 엔진=Grafana 통합 알림 / 규칙 원본=Prometheus 포맷 + convert API / **Slack egress 예외 1건**(유출 필드 목록·화이트리스트 포함) / `X-Disable-Provenance` 정책 / inhibition=v1beta1 + `gcx` |
| **0019** | BMC 수집 방식 | in-band(FreeIPMI + chif) 1차 / out-of-band Redfish 2차 / ipmi_exporter PoC 갭 표(고려한 대안) / 크레덴셜 0 근거 |
| **0020** | 드라이버·펌웨어 표준 | 표준=595.x open / NVIDIA를 unattended-upgrades 제외 / data01 legacy 예외 |
| **0021** | GPU 증설 판단 기준 | 트리거 A/B/C + 예측창이 조달 리드타임보다 길어야 하는 논리 + ADR-0013 임계(0.15) 재사용 |

## 7. 기존 문서에 반영할 것 (새 파일을 만들지 않는다)

| 문서 | 반영 |
|---|---|
| `specs/sre-addons/metrics-collection.md` | T2-8("발견 선행 — Quadro라 BMC 없을 수 있음")을 **실측으로 확정 처리하고 Tier 1/2로 승격**. §1 표의 "전원" 사각지대 행을 갱신. T1-5/6(스로틀·PCIe/NVLink)은 §3.4로 흡수 |
| `specs/alerting/spec.md` | §2 함정(data01 수집 중) · §9(data03 DCGM 기동 확인 · Telegram 불가) 교정. §3.2 G1 PromQL을 §2.6.2로 교체. **§3.8에 하드웨어 카탈로그(HW*) 추가** |
| `docs/inventory.yaml` | `hardware:` 블록(§1.11) + 드라이버·커널모듈 실측 교정(§3.8-5) |
| `docs/runbooks/` | 신규: `nvidia-driver-mismatch.md`(G0-1, T0-3) · `psu-redundancy-lost.md` · `inlet-temp-near-critical.md` · `sel-near-full.md`. ~~`gpu-xid-critical.md`~~·~~`log-ingest-stalled.md`~~는 **작성하지 않는다** — fleet-hardening 축3의 `gpu-xid.md`·기존 `log-ingestion-stopped.md`가 담당하고 frontmatter `alerts:`로 선언한다. **담당은 파일명이 아니라 선언이 정본**(§2.6 규약, AC-2-6) |
| `infra/monitoring/README.md` | BMC job의 60s/30s 분리 이유 · alerting 바인드 추가 시 백업 절차(2026-07-02 사고 재발 방지) |

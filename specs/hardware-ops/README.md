# KEIwi 하드웨어 운영 확장 (Hardware Ops)

> **한 문장: 지금까지 KEIwi는 OS 안쪽만 봤다. 이 스펙 묶음은 쇠(iron)와 전기까지 본다.**
>
> 메트릭·로그 관제(M1·M2)는 라이브다. 그런데 관측 경계가 커널에서 끝난다 —
> 팬·PSU·인렛 온도·섀시 전력·BIOS/iLO 펌웨어·하드웨어 이벤트 로그(SEL)는 한 건도 수집되지 않는다.
> 그리고 **알림 규칙이 0건**이라, 관측된 것조차 아무도 깨우지 않는다.

- 작성 2026-07-30. 상태: **스펙 작성 완료 → 게이트(§0 선행 4건) 통과 후 착수.**
- 권위: 헌장(§I-1 온프렘 · §I-2 단일 콘솔=Grafana · §11 생성/적용 분리 · §12 라이브 직접수정 금지 · §13 시크릿 레포 밖 · §15 알림 노이즈 최소화).
- 이 폴더가 하드웨어·알림·도입검증 3축의 **단일 진실원(SoT)**이다. 코드가 여기서 벗어나면 코드가 틀린 것(§7).
- 이 문서의 모든 수치는 2026-07-29~30 라이브 실측이다. 추정은 "가설"로 표기했다.

---

## 1. 왜 지금 이 방향인가

### 1.1 사실 1 — 플릿은 HPE ProLiant DL380 4대이고, BMC가 4노드 전부에 있다

`specs/sre-addons/metrics-collection.md` T2-8은 "⚠️ ipmi/redfish_exporter — **발견 선행**: Quadro라 BMC 없을 수 있음"으로 1년 가까이 멈춰 있었다. 발견을 끝냈다.

| 노드 | 모델 | BIOS | BMC | `/dev/ipmi0` | `/dev/hpilo` |
|---|---|---|---|---|---|
| data01 | ProLiant DL380 **Gen9** | P89 (2017-02-17) | iLO4 (`103c:3307`) | **없음**(`ipmi_devintf` 미로드) | 있음 |
| data03 | ProLiant DL380 **Gen10** | U30 rel 2.2 (2019-03-19) | iLO5 fw **1.40** | 있음 | 있음 |
| data04 | ProLiant DL380 **Gen10** | U30 rel 2.2 (2019-03-19) | iLO5 fw **1.40** | 있음 | 있음 |
| data05 | ProLiant DL380 **Gen10 Plus** | U46 rel 1.58 (2022-01-13) | iLO5 | 있음 | 있음 |

`/dev/hpilo/d0ccb0~15`(CCB 16채널)이 **4노드 전부**에 있다 → BMC 크레덴셜 없이 in-band로 Redfish를 호출할 수 있다. §13(시크릿 레포 밖) 부담이 **0**인 경로가 이미 열려 있다.

### 1.2 사실 2 — 섀시 전력 850W가 이미 Prometheus에 들어와 있는데 아무 대시보드도 안 쓴다

`node_hwmon_power_average_watt{chip="lnxsybus:00_acpi000d:00",sensor="power1"}` 실측: data05 416W · data03 211W · data04 208W · data01 0W → `sum()` = **850W**.
교차검증: data03 `ipmitool dcmi power reading` = Instantaneous **211W**(min 208 / max 254 / avg 211) — hwmon 값과 일치.
대비: `sum(DCGM_FI_DEV_POWER_USAGE)` = **217.8W** → **GPU는 플릿 전력의 25.6%뿐**, 나머지 632W가 아이들 오버헤드.

> [!NOTE]
> 이 수치는 **설치 0 · egress 0 · 크레덴셜 0**으로 오늘 대시보드에 올릴 수 있다. `acpi_power_meter`가 iLO의 섀시 전력계를 읽고 node-exporter hwmon 컬렉터가 이미 노출 중이다(`collector_success=1`).

### 1.3 사실 3 — SEL에 실제 PSU 장애 이력이 있고, 관측 스택은 전혀 모른다. 게다가 소실 임박이다

data03 `ipmitool sel elist`:
- 2025-05-10 `Power Supply 2 | Power Supply AC lost | Asserted` + `Power Supplies | Redundancy Lost`
- 2025-06-21 `Power Supply 2 | Failure detected` → `AC lost` → `Redundancy Lost` → `Chassis SysHealth_Stat | Transition to Non-critical from OK`

**PSU2가 두 번 죽고 섀시 헬스가 Non-critical로 떨어진 사건이 우리 관측 스택에 흔적 0이다.**
SEL 용량: data03 120 entries / **46%**, data04 166 entries / **64%**, 최대 256 + `SEL automatic rollover is enabled` → 방치하면 오래된 증거부터 덮어써 영구 소실된다. 이건 "나중에 해도 되는 일"이 아니라 **시간이 자산을 깎고 있는 항목**이다.

### 1.4 사실 4 — 알림 계층이 0이어서, 로그 인입이 6일간 조용히 끊긴 것을 몰랐다

`keiwi-logs-*` 최신 문서 `@timestamp = 2026-07-24T07:02:19.419Z`, 현재 2026-07-30 → **6일 침묵**.
`_stats/indexing`의 `index_total`을 8초 간격으로 두 번 측정 → delta **0**(지금도 죽어 있다).
그런데 filebeat는 `active`, Logstash는 `:5044` LISTEN — **모든 신호등이 초록인데 관측이 눈이 멀었다.**

동일 구조의 두 번째 사례: data05 NVIDIA 드라이버가 커널(595.71.05) ↔ 유저스페이스(595.84) 불일치로 `nvidia-smi`가 exit 18인데, `torch.cuda.is_available()`은 `True`다. **부분 고장이라 6일간 아무도 몰랐다.** 그 사이 `keiwi-gpu-model-exporter`는 재시작 카운터 **431,899**회를 돌았고, 포트를 물고 있던 고아 프로세스 덕에 Prometheus는 `up=1`을 보고했다.

> [!IMPORTANT]
> 이 두 사고가 이 스펙의 존재 이유다. 서사는 "알림을 만들었다"가 아니라
> **"알림이 없어서 6일을 몰랐고, 그 사고를 근거로 설계했다"**다.

### 1.5 사실 5 — 표준화 부재가 이미 벤치마크의 비교 가능성을 파괴했다

| 노드 | 커널 | 드라이버 | 커널모듈 | CUDA 천장 | GPU |
|---|---|---|---|---|---|
| data01 | 4.4.0-179 (16.04.7) | 418.39 | proprietary | **10.1** | Tesla M4 ×1 (3790 MiB) |
| data03 | 6.8.0-134 | 595.71.05 | **open** | 13.2 | Quadro RTX 6000 ×2 |
| data04 | 6.8.0-101 (24.04.4) | **535.309.01** | proprietary | **12.2** | Quadro RTX 6000 ×2 |
| data05 | 6.8.0-117 | 595.71.05 / **595.84** | proprietary | 13.x | A40 ×2 |

드리프트 축이 4개(드라이버 3 브랜치 · 커널모듈 2 플레이버 · 커널 4 릴리스 · OS 2종)다. data05 벤치 스택이 torch 2.11.0+cu130인데 **data04는 CUDA 12.2 천장이라 같은 바이너리를 돌릴 수 없다.** 즉 "노드 간 성능 비교"라는 벤치마크의 목적 자체가 성립하지 않는다.

---

## 2. 3개 축과 우선순위

| 축 | 채우는 공백 | 신규 컴포넌트 | egress | 크레덴셜 |
|---|---|---|---|---|
| **축1 하드웨어 관측(BMC)** | 전력·팬·인렛온도·PSU·SEL·펌웨어·하드웨어 인벤토리 | 1단계 0개 / 2단계 exporter 1개 | 0 | **0**(in-band chif) |
| **축2 알림 계층** | 발화 경로 0건 → SEV 라우팅·inhibition·런북 고리 | 0개(Grafana 내장) | Slack 예외 1건(승인 필요) | 웹훅 URL 1건(§13) |
| **축3 도입검증·증설판단** | 벤치마크 0건, 표준·드리프트 탐지 0, 증설 근거 0 | 1단계 0개 / 2단계 role 2개 | 0 | 0 |

### 우선순위 — 축 단위가 아니라 "설치 0인 것부터"

축을 순서대로 하지 않는다. **세 축 각각의 "이미 들어와 있는 데이터로 되는 부분"을 먼저 전부 처리한다.** 실패 위험이 0이고, 첫 성과가 반나절 안에 나오며, 그 결과가 뒤 단계의 임계 튜닝 근거가 된다.

| 파동 | 내용 | 축 | 크기 | 왜 이 순서 |
|---|---|---|---|---|
| **P0** | 선행 게이트 4건(§0) — 드라이버 수복·로그 인입 복구·day-1 오발화 정리·data05 sudo | — | M | 이걸 안 하면 알림 첫날 10건이 터지고 3노드만 되는 반쪽 배포가 된다 |
| **P1** | 전력·BIOS 드리프트 recording rules + 대시보드 row / `node_nvidia_smi_ok` textfile 4메트릭 | 1·3 | **S** | 신규 컴포넌트 0. **`node_nvidia_smi_ok` 하나가 6일 방치를 1분 탐지로 바꾼다** |
| **P2** | 알림 as-code 전제 3종(라벨 정규화·데이터소스 uid 고정·대시보드 uid 정본) | 2 | S | 이걸 건너뛰면 무작위 uid를 레포에 하드코딩하고 inhibition이 원리적으로 불가능해진다 |
| **P3** | ipmi_exporter PoC(data03 1노드) → 갭 표 작성 | 1 | M | "직접 만들기 전에 표준을 평가했다"는 순서가 산출물이다 |
| **P4** | 알림 규칙 v1 커밋 + 섀도 모드 2주 + 채널 승격(Slack) | 2 | M | P1·P3의 신호가 있어야 하드웨어 알림을 함께 넣을 수 있다 |
| **P5** | `keiwi-bmc-exporter` 정식화 + SEL → OpenSearch(`category=hardware`) | 1 | M | SEL 롤오버(data04 64%)가 진행 중이라 P4와 병행 가능 |
| **P6** | 드라이버 표준화 role → 벤치마크(data03) → 이력화 → 증설 판단 모델 | 3 | L | 표준화 전에 측정하면 재작업 |
| **P7** | BMC 관리망 결선 → out-of-band Redfish 승격 | 1 | L | 기관망 IP 협의 + 물리작업 + 크레덴셜(§13). **P1~P6과 절대 묶지 않는다** |

---

## 3. 기존 자산과의 연결 — 새로 만드는 것보다 재사용이 많다

| 필요한 것 | 재사용할 기존 자산 | 신규 |
|---|---|---|
| textfile 메트릭 배선 | `infra/ansible/roles/node-hygiene/`(mktemp 동일디렉터리 + `mv -f` 원자교체 + timer) · data03 `keiwi_node_hygiene.prom` 실존 · data05 compose에 `--collector.textfile.directory` 배선 완료 | 스크립트 블록만 |
| 자체 exporter | `infra/monitoring/port-exporter/port-exporter.py`(125행, stdlib only, py3.6 폴백) · `gpu-model-exporter.py`(224행) | `bmc-exporter.py` |
| Ansible role 3단 패턴 | `roles/port-exporter/{defaults,tasks,handlers,templates}` | `roles/bmc-exporter`·`nvidia-driver`·`gpu-benchmark` |
| recording rule 네이밍 | `rules/keiwi-recording.yml`의 `level:metric:operation` 규약(`instance:node_fs_avail:predict24h_bytes` 등) | `keiwi-hardware.yml`·`keiwi-standards.yml`·`keiwi-capacity.yml` |
| 하드웨어 대시보드 | `dashboards/syshealth.json`(SMART·systemd·보안패치 row 구조 존재) | row 2개 추가(전력·냉각 / BMC·펌웨어) |
| SEL 로그 저장 | M2 파이프(Filebeat→Logstash→OpenSearch `keiwi-logs-*`, ISM 365d) + ADR-0010 category 사전 | `category=hardware` 1종 |
| 용량 판정 논리 | ADR-0013(VRAM binding · 이산 등급 · no-data≠여유) | 시간축 확장(증설 트리거) |
| 알림 정책 | `specs/alerting/spec.md` v1.1(5원칙·SEV 3단·4문 게이트·inhibition·W1) | 규칙 파일 + 엔진 결정 |
| 인벤토리 | `docs/inventory.yaml`(단일 기준) | `hardware:` 블록 |

> [!NOTE]
> 문서 반영 방식: **새 스펙으로 쪼개지 말 것.** `specs/sre-addons/metrics-collection.md`의 T2-8("발견 선행")과 §1 표의 "전원" 사각지대는 이 스펙의 실측으로 **확정 처리하고 Tier를 승격**시킨다. 이 폴더는 그 승격된 항목의 상세 설계다.

---

## 4. 헌장과 충돌하는 지점 — 숨기지 않고 여기서 다룬다

| # | 충돌 | 헌장 조항 | 처리 |
|---|---|---|---|
| C1 | **Slack 웹훅 = 외부 SaaS로 알림 텍스트 유출** | §I-1 온프레미스 only | ADR-0018로 **명시적 egress 예외 1건** 승인 + 나가는 필드 화이트리스트(alertname/severity/node/gpu/job만) 강제. `user`·`pid`·`cmdline` 금지. 상세는 링크로만. → spec §2.5 |
| C2 | OpenSearch Alerting monitor를 쓰면 **알림 UI가 Grafana 밖에 하나 더 생긴다** | §I-2 단일 콘솔 | 채택하지 않는다. Grafana 알림 규칙이 `.opendistro-anomaly-results-history-*`를 조회하는 경로로 RCF를 재사용 → 라우팅 트리 단일 유지. → spec §2.7 |
| C3 | BMC 관리망 결선·iLO IP 배정은 **되돌리기 어려운 물리·네트워크 변경** | §11 · §12 | P7로 완전 분리. 에이전트는 절대 손대지 않고 별도 ADR + 사람의 작업창. 기관망(gw 192.168.1.1은 우리 것이 아님)이라 IP는 협의 사항 |
| C4 | out-of-band Redfish는 **BMC 크레덴셜이 생긴다** | §13 | 1차를 in-band(chif, 크레덴셜 0)로 택한 근거의 절반이 이것. 2차 승격 시 `.env`만, 레포 금지 |
| C5 | `ipmitool`/`ilorest`는 **root 필요**(`/dev/ipmi0`·`/dev/hpilo` 모두 `crw------- root`) | §15 안전 | port-exporter·smartctl-exporter가 이미 root systemd 전례 → 정책적 신규성 0. 단 셸 출력 파싱이므로 입력 검증·타임아웃·**부분 실패 시 stale 값 노출 금지**를 코드 요구사항으로 명시 |
| C6 | data01(Gen9)·data02(Windows)는 **하드웨어 관측 커버리지 밖** | §I-5 이기종 1급 | data01은 `/dev/ipmi0` 부재(modprobe = 사람) + Gen9/iLO4에서 DCMI 전력 미보고(0W) → **명시적 예외로 선언**하고 전력 합계에서 제외. data02는 대상 아님 |
| C7 | 알림을 켜면 §15의 "노이즈 최소화"가 첫날 깨질 수 있다 | §15 | day-1 발화 후보 **10건 실측**(§0 G0-3) → 사전 정리 + 섀도 모드 2주 게이트. → spec §2.8 |

---

## 5. 파일 지도

| 파일 | 내용 |
|---|---|
| **README.md**(이 문서) | 왜 지금 이 방향인가 · 3축과 우선순위 · 기존 자산 연결 · 헌장 충돌 |
| [spec.md](./spec.md) | 3축 상세 설계 + 축별 **기계 검증 가능한 수용 기준** |
| [tasks.md](./tasks.md) | 실행 순서(크기·선행조건·에이전트/사람 구분) |

신설 예정 ADR(이 스펙이 요구하는 결정):

| ADR | 제목 | 축 |
|---|---|---|
| **0018** | 알림 엔진 = Grafana 통합 알림 / 규칙 원본 = Prometheus 포맷 import / Slack egress 예외 1건 | 2 |
| **0019** | BMC 수집 방식 — in-band(chif·FreeIPMI) 1차, out-of-band Redfish 2차 | 1 |
| **0020** | GPU 드라이버·펌웨어 표준과 무인 업그레이드 제외 · data01 legacy 예외 | 3 |
| **0021** | GPU 증설 판단 기준(3 트리거) — ADR-0013의 시간축 확장 | 3 |

---

## 6. 이 스펙이 하지 않는 것 (스코프 아웃 — 암묵 누락 금지)

- **BMC 설정 변경 일체** — 네트워크·사용자·펌웨어 업데이트. 이 스펙은 **센서 읽기와 로그 수집만**이다.
- **OS 설치 자동화**(PXE/kickstart/MAAS) — 경험 0. 범위 밖으로 명시한다.
- **UPS/PDU(`nut_exporter`·`snmp_exporter`)** — T1★·T2-9는 여전히 "발견 선행". 이번 조사에서 UPS·관리형 PDU 존재를 확인하지 못했다.
- **팬 RPM 패널** — HPE는 RPM을 노출하지 않는다(duty cycle % only, `node_hwmon_fan_rpm`도 EMPTY). 없는 데이터를 전제한 패널을 설계하지 않는다.
- **멀티노드 분산학습·IB/RoCE 도입** — 측정으로 한계를 수치화하는 것까지가 축3의 범위다.
- **사용자 귀속 알림/이메일**(헌장 M5) — v1은 SRE-facing만(alerting spec §8 유지).
- **자동 조치(self-heal)** — GPU kill·서비스 재기동 자동화 금지(§11). 넛지·알림까지.

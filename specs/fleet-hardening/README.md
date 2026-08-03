# 플릿 하드닝 (Fleet Hardening)

> **한 문장: 관측 스택이 초록인데 사실이 아닌 지점 5곳을 닫는다.**
>
> KEIwi는 메트릭·로그·알림이 전부 라이브다. 그런데 라이브를 실측해 보면
> **탐지가 없는 노드**, **컨트롤러 뒤에 통째로 가려진 디스크**, **30일째 수집만 되고 아무도 안 쓰는 메트릭**,
> **임계와 다른 알림 문구**, **red인 채 태그된 릴리스**가 동시에 존재한다.
> 전부 능력 문제가 아니라 우선순위 문제로 미뤄진 것이고, 전부 실재하는 운영 부채다.

- 작성 2026-08-02. 상태: **스펙 작성 완료 → 축1부터 착수.**
- 권위: 헌장(§I-1 온프렘 · §I-2 단일 콘솔=Grafana · §9 기계 검증 · §11 생성/적용 분리 · §12 라이브 직접수정 금지 · §13 시크릿 레포 밖 · §15 알림 노이즈 최소화).
- 이 폴더가 5축의 **단일 진실원(SoT)**이다. 코드가 여기서 벗어나면 코드가 틀린 것(§7).
- 이 문서의 모든 수치는 **2026-08-02 라이브 실측**이다. 실측하지 못한 것은 "미측정"이라 쓴다. 추정은 **[가설]**로 표기한다.

---

## 1. 왜 이 스펙이 존재하나 — 결함 5종, 전부 실측

### 1.1 커버리지 구멍 — 탐지가 없는 노드가 있다는 것을 아무도 몰랐다

`count(up{job="node-exporter"} == 1)` = **4** 인데 `count(node_hygiene_collector_last_run_timestamp_seconds)` = **2**.
위생 메트릭이 나오는 건 data03·data04뿐이고, **정작 NVIDIA 드라이버가 깨진 data05와 legacy 노드 data01에 없다.**

원인은 `infra/ansible/roles/node-hygiene/tasks/main.yml:8-12`의 stat 가드가 **7개 태스크**(헤더 21·30·41·51·63·75·86행) **전부**를 게이팅하는 것인데, 실측하면 data05·data01 모두 node-exporter가 이미 textfile 디렉터리를 정상적으로 읽고 있다(`node_scrape_collector_success{collector="textfile"}`=1). **배관은 완비돼 있고 생산자만 없다.**

그 결과 data05는 62.1일 uptime 동안 커널모듈 595.71.05 ↔ 유저스페이스 595.84 불일치로 `nvidia-smi`가 exit 18인데 알림이 **0건**이었다. DCGM은 온도 51/47°C·전력 81/75W를 정상 보고 중이고, `DCGM_FI_DRIVER_VERSION` 라벨은 **커널모듈 버전만** 말하므로 이 드리프트를 구조적으로 볼 수 없다.

### 1.2 사각지대 — RAID 컨트롤러 뒤 물리 디스크가 한 본도 안 보인다

`count by(instance,model_name)(smartctl_device)` → data03 `HPE LOGICAL VOLUME`=1, data05 `HPE LOGICAL VOLUME`=2. **물리 디스크 0본.**

그런데 `-d cciss,N`으로 컨트롤러를 열면 data03 12본 + data04 12본 = **최소 24본**이 나오고, 그중 둘은 이미 열화 중이다 —
data04 `ZC1AE78X`가 grown defect **773개**(가동 63,777h), `ZC1968JB`가 defect 66개 + 읽기 미교정 8건 + 쓰기 미교정 1건.
**두 디스크 모두 `smart_status.passed = true`**라서, 라이브 알림 `SmartHealthFailed`(`smartctl_device_smart_status < 1`)는 디스크별로 켜도 발화하지 않는다. 유일한 데이터 손실 알림이 구조적으로 무력하다.

같은 볼륨(`/dev/sdb`, 24.0TB)에 `smartctl -a`를 걸면 `SMART Health Status: OK` / `Current Drive Temperature: 0 C`가 나온다 — 마스킹의 직접 증거다.

### 1.3 미배선 — 30일 수집한 섀시 전력을 한 번도 근거로 쓴 적이 없다

`sum by(instance)(node_hwmon_power_average_watt)` → data05 ~393W · data04 ~211W · data03 ~212W · data01 **0W**(합계 **약 810~820W** — 2026-08-02 세 시점 실측 816/820/812W, 부하에 따라 변동한다).
`grep -rn 'hwmon_power' infra/` → **0건**. `rules/`·`dashboards/` 어디에도 소비처가 없다.

그리고 이 공백을 메우려고 `specs/hardware-ops`가 미리 써 둔 recording rule 2건이 **라이브에서 거짓임을 확인**했다:
- `product:node_bios_versions:count`는 `bios_version`(HPE ROM 패밀리 코드 U30/U46/P89)만 그룹핑해 **항상 1**을 반환한다. 실제 리비전은 `bios_release`(data05 실측 `U46` / `1.58`)다 → 구조적 미탐.
- `fleet:gpu_driver_versions:count`가 반환하는 2는 "버전 2종"이 아니라 **"라벨 있는 버킷 1 + 라벨 없는 버킷 1"**이다. `DCGM_FI_DRIVER_VERSION` 라벨 값은 라이브에 `595.71.05` 하나뿐이고 data03·data04는 라벨 자체를 안 붙인다.

### 1.4 문구 드리프트 — 임계는 92°C인데 알림은 85°C라고 말한다

`alert-rules.yaml:196` `evaluator: gt, params: [92]` vs `:204` `summary: 'GPU 과열 … — 85°C 초과 10분'`.
라이브 Grafana API가 반환하는 summary도 동일하므로 **배포 드리프트가 아니라 정본 결함**이다.

같은 파일의 runbook_url 9건 중 **알림 전용 런북을 가리키는 건 1건**(LogIngestStalled)뿐이다. 나머지는 온보딩 절차서·설치 README·스펙 문서를 가리키는데, 문제는 "다른 문서"가 아니라 **발화한 단어조차 없는 문서**라는 점이다 — `grep -ci xid specs/hardware-ops/README.md` = **0**인데 `GpuXidErrorNew`가 그 문서를 가리킨다. `grep -ci oom docs/runbooks/node-onboarding.md` = **0**인데 `OomKillOccurred`가 그 문서를 가리킨다.

### 1.5 게이트 미작동 — 검증이 red인 채 v0.2.0이 태그됐다

`.github/workflows` 디렉터리가 **없다**(헌장 §9는 "CI가 강제한다"고 선언, `docs/branching.md:192`는 "CI(`npm run verify`) 초록일 때만 머지"를 이미 규약).
유일한 로컬 게이트 `check:secrets`는 origin/main에서 **rc=1**이고, 그 상태로 `v0.2.0` 태그가 나갔다.

히트 16건을 분류하면 오탐 14건(XML 네임스페이스 URI 2 · 테스트 픽스처 9 · JSDoc 예시 1 · 호스트 리터럴이 없는 템플릿 리터럴 1 · 배포 무관 GitHub 링크 1)이고 진짜는 2건이다. 규칙 이름은 "secrets"인데 실제 의미가 "src 안의 모든 외부 URL 금지"라서 **오탐이 상시화되어 무시되는 게이트**가 됐다. 동시에 이 규칙은 개인키·`ghp_`·`xoxb-`·Slack 웹훅·GlitchTip DSN을 **한 종도 탐지하지 못한다.**

그 사이 검사받지 않은 프로비저닝 결함이 실제로 쌓였다 — `datasources/elasticsearch.yaml`과 `opensearch.yaml`이 **같은 name·uid(`keiwi-logs-es`)를 서로 다른 type으로** 선언한다. §12의 "레포본을 라이브에 복사" 절차를 그대로 따르면 uid가 충돌한다.

> [!IMPORTANT]
> 다섯 결함의 공통 형태는 **"측정하지 않은 것이 정상으로 보인다"**다.
> 그래서 이 스펙의 성공 조건은 "메트릭을 늘렸다"가 아니라
> **"측정하지 않은 영역의 크기가 숫자로 대시보드에 뜨고, 0으로 수렴하는지 기계가 판정한다"**이다.
> 그것이 `fleet:node_hygiene_coverage:gap`(현재 2) · `node_smart_disks` · `fleet:node_chassis_power:reporting_count`(현재 3/4) · `fleet:gpu_driver_unlabeled:count`(현재 4) · `fleet:node_reboot_required:count`(현재 2)가 존재하는 이유다.
>
> **그리고 그 지표들은 알림이 아니다.** 알림으로 만드는 순간 "도입 첫날부터 상주 발화"가 되고, 그것이 hardware-ops T0-7이 「알림 무시 습관의 시작」으로 지목한 패턴이다. 이 스펙에서 **재부팅 부채(축1)·GDL(축2)·전력(축4)은 전부 패널 + 티켓**이고, 알림 승격은 부채가 0이 되거나 2주 섀도를 거친 뒤의 별도 태스크다.

---

## 2. 5개 축

| 축 | 닫는 결함 | 신규 컴포넌트 | 신규 포트 | 라이브 재시작 |
|---|---|---|---|---|
| **1. GPU 스택 정합성 + 커버리지 구멍** | §1.1 | 0 (기존 role 가드 분할) | 0 | node-exporter(data05) 1회 |
| **2. 물리 디스크 SMART 가시화** | §1.2 | role 1개(textfile) | **0** | 0 |
| **3. GPU 장애 런북 + runbook_url 무결성 게이트** | §1.4 | 게이트 1개 | 0 | Grafana 프로비저닝 리로드 |
| **4. 섀시 전력 배선 + 드리프트 규칙 검증** | §1.3 | 0 (규칙·패널만) | 0 | Prometheus SIGHUP |
| **5. CI 파이프라인 (§9 이행)** | §1.5 | 워크플로 2개 + 게이트 레지스트리 | 0 | 0 |

축 간 결합은 셋뿐이다: **축1이 축4의 드라이버 정본 데이터원을 공급**하고, **축2·3·4가 만든 게이트를 축5가 실행**하며, **축3이 고친 알림 문구를 축5의 게이트가 검증**한다.

---

## 3. 기존 스펙과의 관계 — 대체가 아니라 선행조건이거나 교정이다

### 3.1 `specs/hardware-ops` — 재정의하지 않는다

| hardware-ops 항목 | 이 스펙의 처리 |
|---|---|
| **T0-1** NVIDIA 정합성 4메트릭 정의 | **메트릭 이름 4개를 그대로 쓴다.** 축1 T1-3이 **그 구현**이다. 다만 구현안 2곳을 교정한다(§3.2) |
| **T0-2** T0-1 배포 → data05 mismatch=1 관측 | **현행 role로는 원리적으로 불가능**하다(stat 가드가 data05를 스킵). 축1 T1-1/T1-4가 **하드 선행조건** |
| **T0-3** `docs/runbooks/nvidia-driver-mismatch.md` | **작성하지 않는다.** hardware-ops 소관. 축3은 교차링크·frontmatter 계약·로그 진단 쿼리만 제공하고, 축1 T1-11이 증거 스크린샷을 첨부 |
| **T0-4** data05 재부팅 | hardware-ops 소관. **축1 T1-11이 게이트**(§4 순서 제약) |
| **T0-6** data05 sudoers 순서 교정 | **재정의 금지.** 이 스펙에서 data05 특권이 필요한 태스크 **전수**(축1 T1-4·T1-7·T1-9 · 축2 T2-15·T2-16 · 축3 T3-10 · 축4 T4-8~T4-10)의 선행 조건으로 인용하고 **T0-6 없이 진행하는 대안 경로를 §4.2.1에 명시**한다. 실측 `sudo -n true` rc=**1**(data01·03·04는 0) |
| **T0-7 하위 항목**: data05 smartctl down | T0-7 자체의 제목은 「day-1 오발화 후보 정리」(멀티 항목)이고 smartctl은 그 하위 1건이다. 그 하위 항목의 결론은 **"exporter는 무죄 — ufw가 docker 브리지→9633 유입을 드랍"**이며 **이미 해소됨**(`up{job="smartctl-exporter"}` .103=1 .105=1). 축2는 "그 exporter가 살아나도 논리 볼륨 3개뿐"임을 보여주므로 **성과 해석만** 정정한다 |
| **T1-1/T1-2** `keiwi-hardware.yml`·`keiwi-standards.yml` | **같은 파일명을 쓴다.** 축4가 교정된 정본 내용을 공급 — 파일을 분기하면 두 정본이 생겨 §12 사고가 난다 |
| **T1-4/T1-5** syshealth 전력 row | 축4 T4-6/T4-10이 정본. 냉각(인렛온도·팬 duty)은 **BMC 축(hardware-ops P3) 소관 — 손대지 않는다** |
| **T2-1** `datasources/prometheus.yaml` 신설 | hardware-ops 소관. 축5 T5-12(참조 무결성 게이트)의 선행 |
| **T2-2** `prometheus.yml`에 `node: dataNN` 라벨 | hardware-ops 소관. 축4는 `instance`를 `:9100`으로 정규화해 조인하고, T2-2 적용 후 단순화 가능함을 규칙 주석에 남긴다 |
| **T2-5** `scripts/check-runbooks.sh` | **축3이 인수한다.** 선언된 대상(`infra/monitoring/alerts/`)이 존재하지 않는 디렉터리라 라이브 평면을 영원히 검사 못 한다 |
| **T4-3** `gpu-xid-critical.md` · `node-down.md` · `exporter-down.md` | **3항목 모두 축3이 인수한다.** `gpu-xid.md` 하나가 `GpuXidErrorNew`·`GpuXidCritical`을, `node-down.md` 하나가 **노드 down과 exporter down 분기를 함께** 담당 → hardware-ops T4-3에서 세 항목 삭제 제안(T3-8). 파일을 나누면 두 문서가 서로를 가리키다 둘 다 낡는다. 나머지 3종(`psu-redundancy-lost`·`inlet-temp-near-critical`·`sel-near-full`)은 **BMC 축 소관 — 손대지 않는다** |
| **T6-x** 드라이버 표준화·벤치마크·증설 | **범위 밖.** 예방·측정 축이고 이 스펙은 탐지·가시화 축이다 |
| **B10** `instance:node_bios_age:days` 결론 | 축4 T4-7에서 **삭제로 종결** |

### 3.2 이 스펙이 hardware-ops에 대해 발견한 교정 (전부 실측 근거)

1. **T0-2의 기대치가 현행 role로는 달성 불가.** `spec.md:696`이 "배선처는 이미 존재한다"고 정확히 관찰했지만, **role이 그 배선에 무언가를 배달하는지는 확인하지 않았다.** → 축1 T1-1/T1-4 선행.
2. **`spec.md:690`의 `readlink libnvidia-ml.so.1` 구현안이 data01에서 오탐한다.** data01의 NVML은 `/usr/lib/x86_64-linux-gnu/`가 아니라 `/usr/lib/nvidia-418/`에 있고 전자에는 `libnvidia-ml.so.*`가 **0개**다 → 경로 하드코딩 시 빈 문자열 → mismatch 오탐. `ldconfig -p` 경유는 4노드 전부에서 검증됨.
3. **`spec.md:261` "BIOS 드리프트 현재 2, 목표 1"은 거짓.** 실측 `max(product:node_bios_versions:count)` = **1**. 비교 가능한 모델 그룹은 DL380 Gen10 2대뿐이다.
4. **`spec.md:676` 주석의 `535.309.01`은 Prometheus에 존재하지 않는 값이다.** `label/DCGM_FI_DRIVER_VERSION/values` → `["595.71.05"]` 1개뿐. 다른 경로에서 본 값을 PromQL 결과인 양 적었다.
5. **`spec.md:856` AC-3-4(표준화 후 = 1)는 도달 불가.** data03·data04에 라벨이 없어 data04를 595로 올려도 값이 바뀌지 않는다.
6. **`spec.md:488` SM1 주석의 원인 진단이 틀렸다.** "`smartctl_device_attribute` 계열이 없어 마모도 알림 불가"라 적었지만, 계열이 없는 건 exporter 배포 문제가 아니라 **컨트롤러가 물리 디스크를 안 내주기 때문**이고 배포해도 안 생긴다.
7. **`spec.md:427` "alertname kebab = 파일명" 규칙은 현실과 충돌한다.** `LogIngestStalled` → `log-ingest-stalled.md`인데 실제 파일은 증상 중심으로 개명된 `log-ingestion-stopped.md`(T0-5 각주)다. 기계적 kebab 게이트는 **유일하게 올바른 런북을 FAIL시킨다** → frontmatter `alerts:` 선언을 정본, kebab을 폴백으로.

교정은 축4 T4-7 · 축3 T3-8 · 축1 T1-10이 수행한다. **hardware-ops를 대체하지 않고 그 문장만 고친다.**

### 3.3 기타 스펙

- `specs/alerting/spec.md:256` — "runbook_url 없으면 머지 금지"라는 **정책만** 있고 강제 수단이 없다. 축3이 채운다. §10-3의 열린 질문(SmartHealthFailed noDataState 승격)은 축2 T2-19에서 종결.
- `specs/error-tracking/spec.md:425` AC-E-12 · `specs/observability-alerting/sentry.md:513` T-S2d — 존재를 주장하는 게이트 스크립트가 **실재하지 않는다**(§7 드리프트). 축5는 스크립트를 대신 쓰지 않고 "미구현"을 명시 표기해 드리프트만 해소한다.
- `specs/sre-addons/backlog.md:38` "Ansible 성숙화 — molecule + ansible-lint + CI" — 축5가 ansible-lint + syntax-check + j2 렌더 스모크만 채택하고 molecule은 근거를 남겨 기각.
- `specs/sre-addons/aiops-beyond-chat.md:50,116` "SMART 5·187·188·197·198 전이 알림" — 축2가 실현하되 **ATA 디스크(data04 SSD 2본)에만** 해당한다. 플릿 대부분인 SAS HDD에는 그 속성 id가 없고 등가물은 `scsi_grown_defect_list`다.
- `specs/krds-redesign/tasks.md:51` T060 · `specs/design/06-implementation.md:154` Playwright 시각 게이트 — **범위 밖.** 살아있는 콘솔+Grafana가 필요해 GitHub 호스티드에서 못 돈다(축5 ADR-0023에 경계 명문화).

---

## 4. 실행 순서와 순서 제약

### 4.1 되돌릴 수 없는 제약 (구속력 있음)

```
축1 T1-1..T1-3 (레포)
   → 축1 T1-4  [server] node-hygiene 4노드 배포
   → 축1 T1-11 [server] data05 mismatch=1 증거 캡처 (query_range + 패널 스크린샷)
   → ★그 다음에★ hardware-ops T0-4 (data05 재부팅)
```

data05를 먼저 재부팅하면 `node_nvidia_version_mismatch` 1→0 전이가 시계열에 남지 않고 **되돌릴 수 없다.**
hardware-ops AC-3-2("수복 전 1, 후 0, 두 값이 시계열에 모두 남아야")는 이 순서를 지켜야만 달성 가능하며, 현재 role로는 애초에 data05에 메트릭이 없어 달성 불가다. 위반 여부는 **AC-1-13이 `query_range`로 사후에도 기계 판정**한다.

현 라이브가 62.1일 uptime + 재부팅 대기 상태라 언제든 사람이 무심코 재부팅할 수 있다. 그래서 축1 T1-4는 **data05를 같은 파동(W1) 안에서 처리하고 다음 파동으로 미루지 않는다.** 파동 **내부**의 배포 순서는 T1-4가 정한 저위험 순서(data03 → data04 → data01 → data05)를 따른다 — data01을 data05보다 앞에 두는 것은 §7.3(16.04 EOL 노드에서 문제 시 중단 가능하게)의 요구다. "미루지 않는다"는 **파동 간** 제약이고 "마지막에 둔다"는 **파동 내** 순서라 서로 충돌하지 않는다.

> [!WARNING]
> **data05만 `sudo -n`이 실패한다** [실측 2026-08-02] — `sudo -n true` rc=**1**(`sudo -n -l`에 `(ALL) NOPASSWD: ALL` **뒤로** `(ALL : ALL) ALL`이 와서 마지막 매칭 규칙이 이긴다). **data01·data03·data04는 전부 rc=0**이다(같은 날 4노드 전수 실측).
> 그리고 이건 T1-4 ②(적용)만의 문제가 아니다. `ansible.cfg`가 `become = True`·`become_ask_pass = False`이고 data05는 `ansible_connection=local`이라 **드라이런도 첫 태스크에서 죽는다** — 실측 `ansible -i inventory.ini data05 -m command -a 'id'` → `MODULE FAILURE / sudo: a password is required`. 같은 명령이 data01·data03·data04에서는 `root`를 반환한다. 즉 T1-4의 "`-K` 불필요"는 **data01·data03·data04에만** 참이고, **AC-1-2의 4호스트 드라이런은 `-K` 없이는 착수 시점부터 red다** — AC-1-2의 명령을 `-K` 없이 그대로 돌린 PLAY RECAP 실측: `data01 failed=0` · `data03 failed=0` · `data04 failed=0` · **`data05 ok=0 failed=1`**.
> **sudoers를 고치는 것 자체가 라이브 변경이라 에이전트가 하지 않는다 — hardware-ops T0-6 `[server]`(사람)이다**(§11·§12). 기다리는 동안 T1-4를 멈추지 않기 위한 대안 경로와 **become이 필요한 태스크 전수 목록은 §4.2.1**에 있다.

### 4.2 나머지 선행조건

| 항목 | 선행 | 사유 |
|---|---|---|
| **축1 T1-4 (드라이런 ① 포함, data05)** | **hardware-ops T0-6** 또는 `-K` | `sudo -n` rc=1이라 Ansible `become`이 비밀번호를 요구한다. 되돌릴 수 없는 순서 제약의 핵심 태스크라 대기보다 `-K`가 안전. **data05에서 특권이 필요한 태스크는 이것 하나가 아니다 — 전수는 §4.2.1** |
| 축1 T1-12 (`scripts/gates/promtool.sh` + `tools/promtool_fallback.py`) | 없음 | AC-1-10·축2 T2-10·축4 T4-4·축5 T5-15가 전부 이것을 경유한다. 로컬 promtool 부재 + `docker` **그룹 미가입**으로 소켓 권한 거부(실측 — sudoers 문제가 아니라 T0-6으로도 안 풀린다). 해석기만으론 부족해 **폴백 엔진까지 같은 태스크**다: 없으면 promtool AC가 첫날 전부 exit 2다(spec §0.2.2) |
| 축1 T1-14 (RebootRequiredStale 승격) | **축1 T1-13**(부채 청산) | 부채 나이 실측 **.103 = 16.0일**(0→1 전이 2026-07-17 06:24 UTC) · **.104 = ≥30일**(보존 30d 전 구간 1이라 상한 미상). `count(min_over_time(node_reboot_required[Xd]) == 1)`이 X=7d 2 · 14d 2 · **30d 1**이고 보존이 30d라 X>30d는 표현 자체가 안 된다 → **어떤 임계로도 day-1 발화 0이 불가능**하므로 임계가 아니라 **적용 시점**을 미룬다 |
| 축4 T4-6 (죽은 패널 3개 제거) | 축4 T4-1·T4-2 | W4(축2)까지 미루면 메트릭명 가드가 W2부터 red — CI 도입 전에 치워야 한다 |
| 축5 T5-26 (게이트 도구 설치) | 없음 (**W0**) | yamllint·shellcheck·ansible-lint·**promtool** 전부 미설치(실측) → `verify-all.sh` rc=2. **promtool은 Release 바이너리를 `~/.local/bin`에 설치**(sha256 대조) — 이것으로 `check-rules.sh --test`(AC-4-3·4-4)와 `check-prometheus.sh`(AC-5-8)가 로컬에서도 전강도로 돌고, `promtool.sh --which`가 `none`→`path`가 된다(spec §0.2.1) |
| 축2 T2-15 (data05 디스크 실측·배포) | **hardware-ops T0-6**, 또는 대화형 `sudo`(실측) + `-K`(role 적용) | `sudo -n` 실패로 물리 디스크 대수 미측정. 추정 대수를 적지 않는다. **T0-6은 편의이지 물리적 차단이 아니다** — 사람이 비번을 입력하면 지금도 실측 가능하다(§4.2.1) |
| 축2 T2-17 (data01 디스크) | 축2 T2-11 + **hpsa 동작 검증** | P840ar/hpsa에서 `-d cciss,N` 미검증. 실패 시 범위 밖으로 명시 |
| 축4 T4-11 (`count_hygiene` 승계) | **축1 T1-4** | 축1이 hardware-ops T0-1을 구현하므로 의존 대상은 T0-2가 아니라 축1 T1-4다 |
| 축5 T5-12 (P5 참조 무결성 배선) | **hardware-ops T2-1** | 지금 강제하면 축5가 축2를 블로킹해 CI가 red인 채 도입된다 |
| 축5 T5-25 (required 등록) | 축5 T5-24(1주 정보성 관찰) | red가 일상이 되면 게이트가 무시된다 — 지금 `check:secrets`에 일어난 일 |
| 축2 T2-19 (알림 승격) | 축2 T2-16 + **2주 섀도** | `specs/alerting` 승격 절차 |

#### 4.2.1 data05 특권 선행조건 — `become`/`sudo`가 필요한 태스크 전수

data05는 **관제 스택 호스트이자 Ansible control 노드**(`inventory.ini`: `ansible_connection=local`)다. 그래서 이 스펙의 `[server]` 태스크 상당수가 data05에서 특권을 요구한다. 근거는 전부 2026-08-02 실측이다.

| 실측 | 값 |
|---|---|
| `sudo -n true` (data05) | rc=**1** · `sudo: a password is required` |
| `sudo -n true` (data01·data03·data04) | rc=**0** (세 노드 각각 실측 — 4노드 전수 조사 결과 실패는 data05뿐) |
| `ansible … data05 -m command -a 'id'` | **FAILED** · `sudo: a password is required` — `ansible.cfg`의 `become = True`가 모든 play·ad-hoc에 걸린다 |
| 같은 명령 (data01·data03·data04) | `root` |
| `docker ps` (data05, sudo 없이) | `permission denied … /var/run/docker.sock` — `mooner92`는 `docker` 그룹이 아니다(`id` 확인) |
| `ls -ld /data/monitoring/rules` | `drwxr-xr-x root root` — 복사에 sudo 필요 |

**sudoers 파일 교정은 라이브 변경이므로 에이전트가 하지 않는다 — hardware-ops T0-6 `[server]`(사람)이다**(§11 생성/적용 분리 · §12 라이브 직접수정 금지).

| 태스크 | data05에서 특권을 요구하는 부분 | T0-6 전 대안 |
|---|---|---|
| **축1 T1-4 ①** 드라이런 | 4호스트 `--check` — `become=True`라 data05는 첫 태스크에서 실패 | **`-K`**. NOPASSWD인 나머지 3노드는 입력값을 쓰지 않는다 |
| **축1 T1-4 ②** data05 적용 | 동일 | `--limit data05 -K`로 분리 실행(프롬프트 1회) |
| 축1 T1-7 | `/data/monitoring/rules/` 복사 · `docker kill -s HUP` | 대화형 `sudo` |
| 축1 T1-9 | `docker logs` · `docker compose up -d node-exporter` | 대화형 `sudo` |
| 축2 T2-15 | `smartctl -d cciss,N`(로컬 셸) + role 적용(Ansible) | 대화형 `sudo` + `-K` |
| 축2 T2-16 | 대시보드·규칙 복사 · `docker kill -s HUP` | 대화형 `sudo` |
| 축3 T3-10 | 프로비저닝 경로 복사 · Grafana 리로드 | 대화형 `sudo` |
| 축4 T4-8 | 규칙 복사(`root:root 644`) | 대화형 `sudo` |
| 축4 T4-9 | `sudo docker kill -s HUP prometheus` | 대화형 `sudo` |
| 축4 T4-10 | 프로비저닝 바인드 경로 복사 | 대화형 `sudo` |
| 축5 T5-26 | **apt로 설치할 때만** | `pipx`·정적 바이너리(사용자 레벨)면 특권 불필요 — 그 경로를 택한다 |

특권이 **필요 없는** `[server]` 태스크(대조군): T1-11·T4-12(`curl localhost:9090`) · T5-3(격리 worktree dev 서버) · T5-23~T5-25(GitHub) · T2-12~T2-14·T2-17(대상이 data03·04·01이고 셋 다 NOPASSWD).

**경로 선택**

- **권장(A)** — W0에서 사람이 hardware-ops **T0-6**을 먼저 끝낸다(sudoers 규칙 순서 교정 + `visudo -cf` 검증, 기대 `sudo -n true` rc=0). 위 표의 **비밀번호 프롬프트가 전부** 사라진다(`-K` 불필요, `sudo docker …`도 무입력 통과). 5분짜리 사람 작업이므로 W0에 두는 것이 가장 싸다. 단 **`docker` 그룹 미가입 자체는 T0-6이 바꾸지 않는다** — sudo 없는 `docker`는 여전히 안 되고, 게이트 스크립트가 docker에 의존하는 문제는 별개 논점이다(spec §0.2).
- **기본(B)** — T0-6을 기다리지 않고 **Ansible 구간은 `-K`, 로컬 셸 구간은 대화형 `sudo`**로 진행한다. §4.1의 "T1-4를 뒤로 미루지 않는다"가 A보다 우선한다 — data05 재부팅은 언제든 일어날 수 있고 그때 잃는 증거는 되돌릴 수 없다. **A와 B는 배타가 아니다**: T0-6이 이미 끝났으면 자동으로 A이고, 안 끝났으면 B로 그냥 진행한다. 어느 쪽이든 **T1-4는 W1 안에서 끝낸다.**
- **금지(C)** — ① 에이전트가 data05 sudoers를 편집하는 것(§12 위반) ② 비밀번호를 `-e ansible_become_password=…`나 파일로 넘기는 것(§13 — 프로세스 목록·셸 히스토리에 남는다. 프롬프트를 쓴다) ③ `sudo -n`을 전제한 스크립트로 위 태스크를 감싸는 것 — **조용히 실패해 "적용됐다"는 착각을 만든다.**

### 4.3 권장 착수 순서

| 파동 | 내용 | 왜 이 순서 |
|---|---|---|
| **W0** | 축5 T5-1~T5-5(check-no-secrets 재설계 + 진짜 결함 4건) + **T5-26(게이트 도구 설치)** + **(권장) hardware-ops T0-6** `[server]` | 다른 축이 만드는 게이트가 얹힐 바닥. 지금 red인 것을 먼저 green으로. 도구가 없으면 실행기가 rc=2다. **T0-6(data05 sudoers, 5분 사람 작업)을 여기서 끝내면 §4.2.1 표의 `-K`·대화형 `sudo` 예외가 통째로 사라진다** — 권장일 뿐 W1의 차단 조건은 아니다(안 되면 경로 B) |
| **W1** | 축1 T1-12(promtool 해석기 **+ 폴백 엔진**) → T1-1~T1-11 **증거 캡처까지** | 되돌릴 수 없는 제약(§4.1). 나머지 축은 언제 해도 되지만 이건 아니다. **T1-13(재부팅 부채 티켓)은 정비창 협의라 파동에 묶이지 않고, T1-14(알림 승격)는 부채가 0이 된 뒤** — 파동이 아니라 조건이 게이트다 |
| **W2** | 축4(규칙·테스트·게이트·**죽은 패널 정리**) + 축3(런북·문구 교정·**기존 런북 3종 정비**) | 둘 다 라이브 변경이 SIGHUP·프로비저닝 리로드뿐이고, **CI 도입 시점 red 8종 중 5종이 여기서 해소된다**(spec §7.2 표) |
| **W3** | 축5 T5-6~T5-25(워크플로 + 관찰 + required) | 앞 축의 게이트가 다 떨어진 뒤 켜야 첫날 red를 피한다 |
| **W4** | 축2(디스크) — data03 → data04 → data05 → data01 | 유일하게 신규 role이 생기는 축. 열화 디스크 2본이 그래프에 뜨는 것이 성공 증명 |

> [!NOTE]
> W4를 마지막에 두는 것은 중요도 순서가 아니다. 축2만 유일하게 **연구 노드에서 주기 작업이 새로 도는** 축이라, 앞선 축들로 관측·게이트를 먼저 세워 두고 도입하는 것이 안전하다. 열화 디스크 2본에 대한 조치(T2-18)는 축2 착수와 무관하게 지금 티켓으로 열 수 있다.

---

## 5. 파일 지도

| 파일 | 내용 |
|---|---|
| **README.md**(이 문서) | 왜 이 스펙인가 · 5축 요약 · 기존 스펙 관계 · 순서 제약 |
| [spec.md](./spec.md) | 축별 문제(실측)→설계→주요 판단→**기계 검증 가능한 AC 표** + 축 간 의존·위험 |
| [tasks.md](./tasks.md) | 실행 체크박스(크기·선행조건·`[server]` 구분) |

신설 예정 ADR:

| ADR | 제목 | 축 | 태스크 |
|---|---|---|---|
| **0023** | CI 파이프라인 — GitHub 호스티드 전용 · molecule 기각 · 서드파티 액션 0 · 러너 시크릿 0 · **self-test 픽스처는 커밋하지 않고 런타임 조립**(PUBLIC 레포 push protection) | 5 | T5-21 |
| **0024** | 물리 디스크 SMART 수집 방식 — 업스트림 `smartctl_exporter` 기각(B1·B2 소스 근거) · 신규 role `disk-smart-textfile` · 신규 이름공간 `node_smart_*` · data01 정적 바이너리 vendoring · **되돌리기 조건**(업스트림이 B2를 고치면 재검토) | 2 | T2-20 |

> ADR 0018~0021은 hardware-ops가 예약, 0022는 사용 중이라 **0023**부터 쓴다.
> 0024를 추가하는 이유: 헌장 §8("모든 의존성·컴포넌트 선택은 ADR")에 비춰 축2가 네 건의 큰 선택을 하는데 spec §2.3 판단표는 `docs/decisions/`에 남는 아티팩트가 아니다(§10 "컨텍스트에 없으면 존재하지 않는다").

---

## 6. 이 스펙이 하지 않는 것 (스코프 아웃 — 암묵 누락 금지)

- **BMC 수집 일체**(ipmi/redfish·팬 duty·인렛온도·PSU 개별 출력·SEL) — `specs/hardware-ops` P3/P5/P7 소관. 축4는 hwmon·DCGM만 쓴다.
- **드라이버 표준화·무인 업그레이드 블랙리스트** — hardware-ops T6-1/T6-2(예방 축). 이 스펙은 **탐지**까지다.
- **RAID 어레이 상태**(degraded/rebuilding/스페어) — `ssacli`/`hpssacli`가 4노드 어디에도 없다(`dpkg -l` 확인). HPE MCP 저장소 vendoring이 필요해 백로그.
- **NVMe 계열 메트릭** — 플릿에 NVMe **0개**(`lsblk -d` 4노드 확인).
- **베이/슬롯 번호** — SES가 3개 Gen10 노드 전 슬롯을 `not installed`로 보고한다. 물리 식별은 `serial`로만 한다.
- **전력 알림** — 810W→900W일 때 취할 조치가 정의되지 않는다(랙 전력 예산·PSU 정격 미측정). 조치 불명확한 신호는 패널이지 알림이 아니다.
- **자동 조치(self-heal)** — GPU 프로세스 kill·서비스 재기동 자동화 금지(§11). 넛지·알림까지.
- **Playwright 시각 QA의 CI 편입** — 살아있는 콘솔+Grafana가 필요. `docs/testing.md`의 격리 빌드에서 사람이 수행.
- **self-hosted runner** — 연구 워크로드 간섭 + §12 우회 경로 + 신규 운영 대상 3중 비용(ADR-0023).
- **디스크 물리 교체** — 축2는 가시화까지다. 열화 2본의 처분은 알림이 아니라 티켓(T2-18).
- **재부팅 실행** — 축1은 부채를 **측정·노출**까지다. 실제 재부팅은 티켓(T1-13)이고 알림 승격은 그 뒤(T1-14). data05 재부팅은 hardware-ops T0-4 소관.
- **내부망 정보의 공개 레포 노출 억제** — 이 레포는 **PUBLIC**이고(spec §5.1) 런북·AC·인벤토리는 이미 `192.168.1.10N`·`:764`·계정명·`localhost:9200`을 담고 있다. 축3이 만드는 런북 6종도 같은 관행을 따른다. **이건 이 스펙이 새로 만든 위험이 아니라 이미 합의된 트레이드오프**이므로 여기 명문화만 하고 바꾸지 않는다(축5 S2의 사설 IP 금지는 `apps/console/src` 런타임 소스 한정 — 배포 산출물이 환경에 못 박히는 것을 막는 규칙이지 정보 은닉 규칙이 아니다). 재검토가 필요하면 ADR-0023에 근거를 남기고 별건으로 연다.

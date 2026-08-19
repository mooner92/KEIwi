# 하드웨어 운영 확장 — Tasks

> 권위: [spec.md](./spec.md) / [README](./README.md). `[x]`=완료, `[ ]`=잔여.
> **`[server]` = 사람이 적용(§11).** 표시 없는 항목은 에이전트가 레포에 산출물을 **생성**하는 것까지다.
> 크기: **S**=반나절 이내 · **M**=1~3일 · **L**=1주+.
> 순서 원칙: **설치 0 · 신규 컴포넌트 0인 것부터.** 첫 성과가 P1(반나절)에 나온다.

---

## P0 — 선행 게이트 (이걸 안 하면 뒤가 전부 깨진다)

> [!WARNING]
> **T0-1(탐지)을 T0-3(수복)보다 먼저 한다.** 수복하면 증거가 사라지고, "이 메트릭이 실제로 발화하는가"를 검증할 기회를 잃는다. mismatch=1 → 재부팅 후 0으로 떨어지는 것까지 그래프에 남겨야 한다.

- [x] **T0-1** (S) `node-hygiene` role에 NVIDIA 정합성 4메트릭 블록 추가 — `node_nvidia_smi_ok` · `node_nvidia_kernel_module_version` · `node_nvidia_userspace_version` · `node_nvidia_version_mismatch`. **선행: 없음.** 산출물: `roles/node-hygiene/templates/keiwi-node-hygiene.sh.j2` 수정. 검증: AC-3-2·AC-3-3. **완료 2026-08-06** — 구현 실체는 fleet-hardening T1-3(메트릭 6종: 위 4개 + `node_nvidia_probe_ok`·`node_nvidia_smi_exit_code`)이고 이 태스크는 그것을 인수한다.
  - ⚠️ **구현은 fleet-hardening T1-3이다** — 메트릭 이름 4개는 그대로 쓰고(재정의 금지), 실측 교정 2건이 붙는다: ⓐ 유저스페이스 경로를 `ldconfig -p`→`readlink -f`로 해석(하드코딩하면 data01의 `/usr/lib/nvidia-418`에서 깨진다, spec §T0-1 각주) ⓑ `node_nvidia_probe_ok`·`node_nvidia_smi_exit_code` 2종 추가(판정불능/미수집 구분). 이 태스크는 **그 산출물을 인수**한다.
- [ ] **T0-2** `[server]` (S) T0-1 배포 — `ansible-playbook playbooks/agents.yml --tags node-hygiene --check` → 실적용. **선행: T0-1, fleet-hardening T1-4.** 기대: data05에서 `node_nvidia_version_mismatch = 1` 관측(=탐지 성공 증명)
  - ⚠️ **fleet-hardening T1-4 없이는 이 태스크 단독으로 기대치를 달성할 수 없다** — 교정 전 role은 `/etc/default/prometheus-node-exporter` stat 가드가 7개 태스크를 전부 게이팅해서 **data05(컨테이너)·data01(수동설치)를 통째로 스킵**한다. 스크립트에 블록을 넣어도 data05에 도달하지 않으므로 mismatch=1이 영원히 관측되지 않는다(fleet-hardening spec §1.1 커버리지 갭).
- [x] **T0-3** (S) 런북 `docs/runbooks/nvidia-driver-mismatch.md` 생성 — 증상(`nvidia-smi` exit 18) → 판별 3줄(`/proc/driver/nvidia/version` vs `modinfo nvidia` vs `readlink libnvidia-ml.so.1`) → 원인(무인 업그레이드 + 미재부팅) → 조치(재부팅) → 예방(ADR-0020(신설 예정)). **frontmatter 계약 필수**(fleet-hardening spec §3.2 D3-2): `id: nvidia-driver-mismatch` · `kind: alert` · `category: gpu` · `severity: critical` · `alerts: []`(탐지 알림 신설 전이므로 빈 배열이 정상 — 게이트가 **WARN**으로 통과시킨다) + `docs/README.md` 런북 표에 한 줄(게이트 R9). 교차링크: [`gpu-xid.md`](../../docs/runbooks/gpu-xid.md) §4가 이 문서를 가리킨다(XID와 혼동해 재부팅하는 오조치 방지). **선행: 없음.** **완료 2026-08-06** — 증상(exit 18·비대칭 생존·auto-restart 루프)·판별 3줄·조치(모델 교체 주의 포함)·예방 수록.
- [x] **T0-4** `[server]` (M) **data05 재부팅으로 드라이버 수복 — 완료 2026-08-06**(사용자 직접 재부팅). 사전 확인: Q9(`:8003` 고아 소멸 → 어시스턴트 모델이 Qwen3-Coder-30B → Qwen2.5-Coder-32B로 바뀜, 의도 확인) · `:9836` 고아(`/gits/MineSweeper/...`) 처분. 사후 검증: `nvidia-smi` 정상 · 4유닛 active · `gpu_vram_total_bytes`에 data05 시리즈 복귀(ADR-0013 판정 회복) · CDI 재생성 성공 · `node_nvidia_version_mismatch = 0`. **선행: T0-2, T0-3, fleet-hardening T1-11(증거 보존)**
  - 🚫 **되돌릴 수 없는 순서 제약** — 재부팅이 T1-11보다 먼저 일어나면 `node_nvidia_version_mismatch`의 **1→0 전이가 시계열에 남지 않는다.** 그러면 이 태스크의 사후 검증 `= 0`은 "고쳤다"가 아니라 "원래 0이었다"와 구분되지 않고, AC-3-2("수복 전 1, 후 0, 두 값이 시계열에 모두 남아야")가 **영구 미달성**이 된다. T1-11이 `query_range` 응답을 JSON으로 커밋하는 것이 이 게이트의 완료 조건이다(TSDB 보존 30d 뒤에는 그 파일이 유일한 증거다). 위반 여부는 fleet-hardening AC-1-13이 재부팅 후 30일까지 기계 판정한다.
  - ✅ **사후 검증 통과**: `nvidia-smi` 정상(595.84 정합) · CDI 재생성(`/var/run/cdi/nvidia.yaml`) · `gpu_vram_total_bytes` data05 2장 복귀(ADR-0013 판정 회복) · vllm-qwen25-coder-32b 정상 기동.
  - 🚫 **위 순서 제약이 실제로 위반됐다** — 재부팅이 T0-2 배포·fleet-hardening T1-11(증거 보존)보다 **먼저** 일어나 `node_nvidia_version_mismatch`의 **1→0 전이가 시계열에 남지 않았다.** 따라서 AC-3-2는 이 사건으로는 **영구 미달성**이고, 재발 시 검증하는 항목으로 전환한다(spec §3.10 개정). 지금의 `= 0`은 "고쳤다"가 아니라 "현재 정합"만 뜻한다.
  - **부수 확인**: Q9 — `:8003` 모델이 Qwen3-Coder-30B → **Qwen2.5-Coder-32B**로 교체됨(의도된 변화). `.env.local` `VLLM_MODEL` 교정 + 콘솔 재시작으로 어시스턴트 복구. `:9836` 고아는 PM2 덤프에서 삭제 처분. `vllm-ocr-8010`은 disabled 유지. PM2 startup 미등록이 발견돼 `pm2-mooner92.service` 등록(재부팅 회복력 보강).

- [x] **T0-5** `[server]` (M) **로그 인입 복구**(G0-2) — **완료 2026-07-30.** 원인은 하나가 아니라 **독립 결함 2개**였다:
  ① **수신측**(data03·04·05) — `/KEIwi`에서 `git checkout`이 `:ro` 바인드된 `logs.conf`를 다시 써 라이브 Logstash가 리로드하다 죽음(`No configuration found in the configured sources` 15초마다 반복). `docker restart keiwi-logstash`로 복구 후 백로그 flush.
  ② **발신측**(data01) — filebeat 7.17이 지원하지 않는 `include_matches: - not _SYSTEMD_UNIT=…`(8.x 문법)가 조용히 이벤트를 전멸시킴(`output.events active=0`, 커서 6일 정지, **ERROR 0줄**, systemctl은 active). 블록 제거로 복구.
  런북은 `docs/runbooks/log-ingestion-stopped.md`로 작성(계획한 `log-ingest-stalled.md`에서 증상 중심으로 개명). 검증: 4노드 전부 실시간 인입, 최근 24h 849k 이벤트.
  → **이 사고가 축2(알림)의 존재 근거다.** 5.7일간 아무도 몰랐고 발견 경로는 알림이 아니라 우연한 조회였다.
- [ ] **T0-6** `[server]` (S) **data05 sudoers 교정**(G0-4). `sudo -n -l`에서 `(ALL) NOPASSWD: ALL` **뒤에** `(ALL : ALL) ALL`이 오는 순서 문제. `visudo -cf`로 검증. 기대: `sudo -n true` rc=0. **선행: 없음.** 막고 있는 것: 축1의 data05 배포 전체 — 구체적으로 **fleet-hardening T1-4**(드라이런 ①까지 포함. `ansible.cfg`가 `become=True`라 `--check`도 특권을 요구한다) · **T1-7**(`/data/monitoring/rules/` 복사 + `docker kill -s HUP`) · **T1-9**(`docker logs`/`compose up -d node-exporter`). 대안 경로는 `-K`와 대화형 `sudo`이고, 되돌릴 수 없는 순서 제약 때문에 **T0-6이 안 끝났으면 기다리지 않고 그 경로로 진행한다**(fleet-hardening README §4.2.1)
- [~] **T0-7** `[server]` (M) **day-1 오발화 후보 정리** — 2026-07-30 전 항목 진단 완료, 일부 실행 완료. 항목별 판정:
  - [x] **OpenSearch yellow** — **완료(green, unassigned 0)**. 원인: unassigned 37개 전부 `.opendistro-*` 시스템 인덱스의 **replica** 샤드(단일노드라 원천 할당 불가). 기존 인덱스 `number_of_replicas: 0` + ISM history가 매일 rollover로 재발하므로 인덱스 템플릿(`opendistro-system-replica0`)로 재발 차단. `keiwi-logs-*` 149개는 이미 0이었음.
  - [x] **data05 smartctl down** — **exporter는 무죄.** 6일째 `active`, `*:9633` 전체 바인드, 호스트에선 3주소 모두 200. Prometheus 컨테이너에서만 `context deadline exceeded` = **ufw가 docker 브리지→9633 유입을 드랍**(9836·9986은 허용돼 up — 9633만 규칙 누락). 적용 1줄: `sudo ufw allow from 172.18.0.0/16 to any port 9633 proto tcp`
  - [x] **vllm `:8010` down** — **근본 원인(T0-4) 해소 2026-08-06.** 재부팅 후 `vllm-qwen25-coder-32b` 정상 기동(GPU0, 8003 서빙), auto-restart 루프 소멸. `vllm-ocr-8010`은 **disabled·정지 상태 유지**(MineSweeper OCR — 필요 시 수동 `systemctl start`, GPU1 유휴).
  - [ ] **systemd failed — data03·04 `networkd-wait-online`** — 원인 실측: `eno2`가 no-carrier인데 configured → 전 인터페이스 대기 타임아웃. **`--any` drop-in을 node-hygiene role에 코드화 완료**(`node_hygiene_fix_wait_online`), 적용 대기. ⚠️ 2026-08-06 재부팅에서 **data05도 동일 failed 관측** — 적용 대상 3노드로 확대.
  - [x] **systemd failed — data01 `rc-local`** — ⚠️ **건드리지 마라.** rc.local이 설정하는 `192.0.2.51`이 현재 bond0의 **primary IP로 라이브**(:<SSH_PORT> 응답, .101이 오히려 secondary). 업타임 1.22년이라 부팅 시 실제 IP 소스를 검증할 수 없음 — disable 시 재부팅 후 접속 불능 위험. failed 상태는 known-issue로 문서화(2021-04부터, 5년 무해).
  - [ ] **systemd failed — data01 `unattended-upgrades`** — 16.04 EOL이라 apt 소스가 죽어 서비스 무의미. disable 무방(낮은 우선순위).
  - [~] **data04 `/` 86%** — 시스템측 정리 실행(journal 848M→200M 상한 + apt 캐시 591M) → **~1GB 회수에 그침**. 본질은 `/home` 272G(user2 134G · user5 74G · user1 23G · user3 22G) = **연구자 데이터라 관리자가 못 지움 → 통보 대상**. 후보: `/opt/conda/pkgs` 캐시 21G(`conda clean -p`, **공용이라 사용자 승인 필요**) · `/tmp` 5.1G(내용 확인 필요). 알림은 % 대신 `predict_linear`로 전환(실측: 24h 후 57GB 여유 = 당장 안전).
  - [ ] **data01 메모리 90%** — 원인 특정: **user6의 Jupyter 커널 1개가 RSS 291GB(73.6%)**, 2025년부터 상주. 추가 커널 3개(16G·14G·3.8G). swap 41G 사용 중 = 시스템 압박. **자동 kill 금지(§11) — 연구자 통보 필요.** 유휴/좀비 GPU·메모리 넛지(백로그 #9)의 실증 사례 1호.
  **선행: 없음.** 막고 있는 것: 축2 승격(AC-2-14). 남은 것 전부 사람 적용/통보/결정.
- [x] **T0-8** (S) `specs/alerting/spec.md` 사실 드리프트 3건 교정(spec §2.10) — **이미 완료돼 있었음**: alerting spec **v2(2026-07-30)** changelog ③에 3건 교정 반영 확인(2026-08-06 체크박스만 소급). data01 수집 중 / no-data는 data02뿐 / data03 DCGM 기동 확인 / data05 systemd 수집기 미작동 전부 반영됨
- [x] **T0-9** (S) `docs/inventory.yaml` 드라이버·커널모듈 실측 교정 — **완료 2026-08-06**: 418.39(proprietary) / 595.71.05(open) / 535.309.01(proprietary) / **595.84**(proprietary — 재부팅 후 정합) + `kernel_module` 필드 신설. 콘솔 zod 스키마는 비-strict라 무해(라이브 `/api/fleet/status` 200 확인). ⚠️ data05가 proprietary로 로드됨 — data03(open)과 플레이버 상이, ADR-0020(T6-1)에서 표준 확정 필요. 검증: AC-3-14(개정)

---

## P1 — 설치 0으로 첫 성과 (반나절, 실패 위험 0)

- [ ] **T1-1** (S) `rules/keiwi-hardware.yml` 생성 — **정본은 fleet-hardening 축4 T4-1이 공급했다**(레포에 이미 있다). 레코드 13종: `instance:node_chassis_power:watts` · `fleet:node_chassis_power:reporting_count`(정직성 분모) · `fleet:node_chassis_power:watts_sum`(0W 노드 제외) · `instance:gpu_power:watts` · `fleet:gpu_power:watts_sum` · `fleet:gpu_power_share:ratio` · `instance:gpu_power_share:ratio` · `instance:node_nongpu_power:watts` · `instance:node_chassis_energy:kwh1d`(원 메트릭 기반 + `> 0`) · `instance:gpu_energy:kwh1d` · `product:node_bios_revisions:count`(bios_release 포함) · `product:node_count:count` · `fleet:node_bios_drift:count`. **`record:`만 — `alert:` 키 금지**(`scripts/gates/check-rules.sh`가 강제). 검증: AC-1-1·AC-1-2 및 **축4 AC-4-1·AC-4-2·AC-4-3·AC-4-7~AC-4-10·AC-4-12**. **선행: 없음**
- [ ] **T1-2** (S) `rules/keiwi-standards.yml` 생성 — **정본은 fleet-hardening 축4 T4-2가 공급했다**. `fleet:gpu_driver_versions:count`(라벨 필터 필수 — **현재 1**, 초안의 "2"는 라벨 부재 버킷을 센 거짓값) · `fleet:gpu_driver_unlabeled:count`(**현재 4** — 동반 필수) · `fleet:kernel_releases:count`(현재 4) · `fleet:gpu_driver_versions:count_hygiene`(`or vector(0)` 금지). 검증: AC-3-1 및 **축4 AC-4-1·AC-4-4·AC-4-11**. **선행: 없음**
- [ ] **T1-3** `[server]` (S) T1-1·T1-2를 라이브 `/data/monitoring/rules/`에 반영 + **`sudo docker kill -s HUP prometheus`**. ⚠️ **`docker compose restart` 금지**(prometheus 서비스 포함 — 이 명령을 문자 그대로 남기지 않는 이유는 축4 AC-4-14가 그 문자열의 부재로 교정을 판정하기 때문이다) — 스크레이프·평가 공백에 더해 컨테이너 재생성 리스크가 있고, fleet-hardening spec §7.3이 이 명령을 2026-07-02 대시보드 소실 사고의 원인으로 지목한다. `--web.enable-lifecycle=false`라 HTTP reload(405)도 불가하다. 재적용 후 `prometheus_config_last_reload_successful`=1 **그리고** 신규 그룹 `health=ok`를 **둘 다** 확인한다(실패해도 Prometheus는 구 설정을 조용히 유지한다). **라이브 파일 직접 편집 금지(§12) — 레포본 복사.** 검증: AC-1-3·AC-1-4 및 축4 AC-4-17
- [x] ~~**T1-4**~~ **[폐기 — 중복]** fleet-hardening **T4-6**이 row 400「전력 (섀시 · GPU)」로 완료했다. 아래 원문은 이력용:
  -  (S) `syshealth.json`에 **row 「전력 · 냉각」 추가**(플릿 전력 stat / GPU 점유율 gauge / 노드별 추세 / 일일 kWh). BMC 메트릭 의존 패널은 P3 이후로 분리해 지금은 hwmon·DCGM만. 검증: AC-1-15. **선행: T1-1**
- [x] ~~**T1-5**~~ **[폐기 — 중복]** fleet-hardening **T4-10**과 같은 일이다. 아래 원문은 이력용:
  -  `[server]` (S) 대시보드 프로비저닝 반영. **`docker cp` 주입 금지**(README:100 — 2026-07-02 재생성으로 대시보드 소실 사고). 바인드 마운트 경로에 복사. **선행: T1-4**

> [!NOTE]
> P1이 끝나면 JD 관점 두 항목이 실물로 커버된다 — "사용률·용량 지표를 근거로 증설 시점 판단(전력)"과 "펌웨어·BIOS 드리프트". 신규 컴포넌트 0개다.

---

## P2 — 알림 as-code 전제 3종 (전부 S)

- [ ] **T2-1** (S) `grafana/provisioning/datasources/prometheus.yaml` 신설 — `uid: keiwi-prom`, `editable: false`(opensearch.yaml과 동형). **현재 무작위 `bflbhyfj7rzlsb`를 레포에 하드코딩하는 사태 방지.** 검증: AC-2-2. **선행: 없음**
- [ ] **T2-2** (S) `prometheus.yml` 전 `static_configs`에 `node: "dataNN"` 라벨 추가(B2). **inhibition·라우팅의 공통 축.** 검증: AC-2-3. **선행: 없음**
- [ ] **T2-3** `[server]` (S) T2-1·T2-2 적용 + prometheus restart. Grafana 데이터소스가 프로비저닝본으로 바뀌면 기존 대시보드의 `${datasource}` 변수 동작을 함께 확인
- [ ] **T2-4** (S) 대시보드 uid 정본 확정(Q7) — `keiwi-*` vs `keiwi-*-v3` 중복 해소. 결정 후 `dashboard_url` 애너테이션 규약 문서화. 검증: AC-2-7. **선행: 없음**
- [x] **T2-5** (S) ~~`scripts/check-runbooks.sh` 작성~~ → **fleet-hardening T3-5로 이관**(대상 경로 `scripts/gates/check-runbooks.sh` — 구현 완료). 이관 근거: ① 레포 전역 게이트 경로가 `scripts/gates/check-*` 한 곳으로 통일됐다(fleet-hardening spec §0.2) ② **kebab 강제에는 반례가 있다** — `LogIngestStalled`의 kebab은 `log-ingest-stalled.md`인데 실제 런북은 `log-ingestion-stopped.md`다. 기계적 kebab 게이트는 **유일하게 올바른 알림 런북을 FAIL시킨다.** 정본은 frontmatter `alerts:` 선언이고 kebab은 폴백이다(R5) ③ 검사 대상을 `infra/monitoring/alerts/*.yml`(미생성)에 더해 Grafana provisioning YAML(라이브 평면)까지 넓혔다. 배선은 `npm run verify`가 아니라 `scripts/verify-all.sh`(레포 전역 게이트 정본, §0.2). 검증: AC-2-6(경로 정정본)

---

## P3 — BMC PoC (M) — "직접 만들기 전에 표준을 평가했다"를 산출물로

- [ ] **T3-1** `[server]` (S) data03에 `freeipmi-tools` 설치(현재 `ipmi-sensors`가 전 노드 MISSING). data03에 `ipmitool` 1.8.19는 이미 있음. **1노드만.** **선행: 없음**
- [ ] **T3-2** `[server]` (S) **data05 BMC 실측 완료** — G0-4 해소 후 `ipmitool sdr elist all` / `sel info` / `sel elist` / `dcmi power reading` / `fru print 0` / `chassis status` / `mc info` 수집 → 4노드 하드웨어 사실표 완성(spec §1.1의 data05 공백 채움). **선행: T0-6**
- [ ] **T3-3** `[server]` (M) `prometheus-community/ipmi_exporter`를 data03 local 모드로 기동(:9290) → **갭 표 작성**: 어떤 메트릭이 채워지고 무엇이 비는지(PSU별 출력 W · 엔티티 의미 · iLO 펌웨어 · HPE 센서 네이밍 · SDR 임계값). 이 표가 ADR-0019(신설 예정)의 "고려한 대안" 절이 된다. **선행: T3-1**
- [ ] **T3-4** (S) `docs/decisions/0019-bmc-collection-method.md` — in-band 1차 / out-of-band 2차 + T3-3 갭 표 + 크레덴셜 0 근거(§13). **선행: T3-3**
- [ ] **T3-5** (S) textfile PoC — `keiwi_bmc.prom` 생성 스크립트(node-hygiene 원자교체 패턴 복제). **새 포트·새 job·새 ufw 룰 0.** 대표 메트릭만: 전력·인렛온도+임계·팬 duty·PSU 출력·PSU/팬 이중화·SEL 사용률·`keiwi_bmc_info`·`keiwi_bmc_up`·`_collector_last_run_timestamp_seconds`. **선행: T3-3**
- [ ] **T3-6** `[server]` (S) T3-5를 data03에 배포 → `syshealth.json`의 전력·냉각 row에 BMC 패널 추가(인렛온도 vs 임계선 · 팬 duty · PSU 균형). 검증: AC-1-6(팬 RPM 메트릭 **부재**)·AC-1-7(임계 42 데이터로 들어옴). **선행: T3-5, T1-4**

---

## P4 — 알림 규칙 v1 → 섀도 2주 → 채널 승격 (M)

- [ ] **T4-1** (S) `docs/decisions/0018-alerting-engine-and-channel.md` — 엔진=Grafana 통합 알림(§I-2 + Grafana 13 inhibition 실측 근거) / 규칙 원본=Prometheus 포맷 + convert API / **Slack egress 예외 1건 + 유출 필드 표 + 라벨 화이트리스트** / `X-Disable-Provenance` 정책. **선행: 없음.** 사용자 승인 필요(§C1)
- [ ] **T4-2** (M) `infra/monitoring/alerts/` 규칙 v1 커밋 — `availability.yml`(A1·A3) · `gpu.yml`(G2·G3·H2 + XID는 T5-2 후) · `resource.yml`(R1·R2·R2b·R3) · `hardware.yml`(HW 8종) · `stack.yml`(S5·Watchdog) · `vllm.yml`(V1 가드 포함·V2). 전 규칙에 `severity`·`summary`·`runbook_url`·`dashboard_url`. 검증: AC-2-1·AC-2-8. **선행: T2-4, T2-5, T3-5**
- [ ] **T4-3** (M) 런북 **3종** 생성 — `psu-redundancy-lost.md`(2025-05-10·06-21 실사건 인용) · `inlet-temp-near-critical.md` · `sel-near-full.md`. **BMC 축 소관 3종만 남긴다.** 검증: AC-2-6이 통과할 때까지. **선행: T4-2**
  - ~~`gpu-xid-critical.md`~~ → **삭제**. fleet-hardening 축3의 [`docs/runbooks/gpu-xid.md`](../../docs/runbooks/gpu-xid.md)가 담당한다(frontmatter `alerts: [GpuXidErrorNew, GpuXidCritical]`로 이미 선언 — `GpuXidCritical`이 배포되면 그 런북이 자동으로 대응된다). 코드별 분기표·원문 대조 절차가 이미 그 파일에 있다.
  - ~~`node-down.md`~~·~~`exporter-down.md`~~ → **축3 [`node-down.md`](../../docs/runbooks/node-down.md) 하나로 통합**. "exporter down인지 노드 down인지"는 진단의 **첫 분기**이지 별개 문서가 아니다 — §2에 그 분기(+ data04 터널 오판 경로)를 담았다. **파일을 나누면 두 문서가 서로를 가리키다 둘 다 낡는다.** `ExporterDown`(A3) 알림이 생기면 그 런북 frontmatter `alerts:`에 한 줄 추가하면 된다(파일 신설 불필요).
- [ ] **T4-4** `[server]` (S) Grafana 서비스 계정 + 토큰 발급(RBAC: Alerting Rules Reader/Writer · Set provisioning status · Datasources Reader · Folders CRW). 토큰은 `.env`만(§13). 주의: Grafana admin 비밀번호가 compose 값과 불일치한다는 기록(README:156). **선행: T2-3**
- [ ] **T4-5** `[server]` (S) **섀도 모드 import** — `POST /api/convert/prometheus/config/v1/rules` + `X-Grafana-Alerting-Alert-Rules-Paused: true`. 검증: AC-2-4·AC-2-5. **선행: T4-2, T4-4**
- [ ] **T4-6** (S) `gcx` 도입 + inhibition 4건 정의(spec §2.6.5). `grafanactl`은 2026-06-01 아카이브 예정 — `gcx`를 쓴다. 검증: AC-2-11. **선행: T2-2(라벨 정규화)**
- [ ] **T4-7** `[server]` (**2주 대기**) 섀도 관찰 — 규칙별 발화 횟수 집계 → 임계 조정. 승격 조건 4개(spec §2.8) 전부 충족 확인. **선행: T4-5, T0-7**
- [ ] **T4-8** (S) Slack contact point + **라벨 화이트리스트 템플릿**(alertname/severity/node/gpu/job만. `user`·`pid`·`cmdline`·`instance`·`modelName` 금지). 검증: AC-2-9·AC-2-10. **선행: T4-1 승인**
- [ ] **T4-9** `[server]` (M) alerting 프로비저닝 바인드 추가 — **컨테이너 재생성을 유발한다.** 대시보드·Grafana DB 백업을 먼저 하고 이 작업만 단독으로. **선행: T4-8**
- [ ] **T4-10** `[server]` (S) 승격 — paused 해제, mute timing(야간 SEV2/3 보류) 적용, silence를 온보딩·정비 런북 단계에 추가. 검증: AC-2-14. **선행: T4-7, T4-9**
- [ ] **T4-11** `[server]` (S) **Q5 확인**: data03·data04에서 `curl -sS -m 5 -X POST https://hooks.slack.com/services/TEST` 1줄 → 도달성 판정. **선행: 없음.** 막고 있는 것: T4-12
- [ ] **T4-12** (M) `roles/watchdog` 생성 — data03에 cron/timer 1개로 data05 Prometheus `/-/healthy` + Grafana `/api/health` 확인, 실패 시 **자기 자신이** Slack POST. Grafana 쪽 `Watchdog`(`vector(1)`)과 짝. 검증: AC-2-12·AC-2-13. **선행: T4-11, T4-8**
- [ ] **T4-13** (M) L1 이상탐지 알림 — Grafana 알림 규칙이 `.opendistro-anomaly-results-history-*`를 조회해 `anomaly_grade > 0.7 AND confidence > 0.9`(+ 최소 이벤트 하한 Q10). **OpenSearch Alerting monitor를 쓰지 않는다**(§I-2, C2). 데이터소스 `keiwi-logs-es`에 인덱스 패턴만 추가. **선행: T0-5(인입 복구), T4-10**
- [ ] **T4-14** (S) z-score 밴드 알림은 **4중 가드 + SEV3 다이제스트 전용**으로만 작성(절대 하한 0.5 · σ 하한 0.05 · `for: 15m` · 페이징 금지). 근거 수치(하루 25회 breach, CPU 1.4%·0.24%에서 발화)를 규칙 주석에 남긴다. **선행: T4-2**

---

## P5 — BMC 정식화 + SEL 중앙화 (M) — SEL 롤오버가 진행 중이라 P4와 병행

- [ ] **T5-1** (M) `infra/monitoring/bmc-exporter/bmc-exporter.py` — port-exporter 패턴(stdlib only, py3.6 폴백, 125행급). 요구사항: 서브프로세스 timeout · 입력 검증 · **부분 실패 시 `keiwi_bmc_up{collector}=0` + stale 값 재노출 금지**(C5) · SDR에서 **임계값 자동 추출**. **선행: T3-3(갭 확정)**
- [ ] **T5-2** (M) `roles/bmc-exporter` 3단 구조 + `playbooks/agents.yml`에 `bmc` 태그 play. `/dev/ipmi0` 부재 노드는 skip+이유 출력. **선행: T5-1**
- [ ] **T5-3** (S) `prometheus.yml`에 `bmc-exporter` job 추가 — **`scrape_interval: 60s` / `scrape_timeout: 30s`**(15s global 사용 금지 — SDR 138 레코드). data04는 터널 `-L 172.18.0.1:9639` 추가 후 주석 해제. 검증: AC-1-10. **선행: T5-2**
- [ ] **T5-4** `[server]` (M) data03·data05 배포 → data04(터널) → 검증 AC-1-5·AC-1-8·AC-1-9. **선행: T5-3, T0-6**
- [ ] **T5-5** (M) SEL 수집기 + Logstash 배선 — `category=hardware`(ADR-0010 사전 1종 추가) · **타임존 UTC 정규화**(data03 UTC / data04 KST 실측) · `_id = sha1(fleet_node+sel_time_utc+sensor+event)` 멱등. 검증: AC-1-11·AC-1-12·AC-1-13. **선행: T0-5**
- [ ] **T5-6** `[server]` (S) **SEL 전량 백필 1회**(data03 120건 / data04 166건 — rollover 전에 확보) → 증분 전환. **선행: T5-5**
- [ ] **T5-7** (S) Grafana annotation으로 SEL 사건을 메트릭 타임라인에 겹치기 + `syshealth.json`에 「BMC · 펌웨어 인벤토리」 row 추가. **선행: T5-5, T5-4**
- [ ] **T5-8** (M) `playbooks/inventory-hw.yml` — `ipmitool fru print`·`dmidecode -t memory/processor`·`ilorest --local` 파싱 → `docs/inventory.yaml`의 `hardware:` 블록 **생성**(사람이 diff 확인 후 커밋, §11). `rack`/`pdu_circuit`은 `null`로 남긴다(실사 없이 채우면 거짓 데이터). 검증: AC-1-14. **선행: T5-4**
- [ ] **T5-9** (S) `metrics-collection.md` T2-8 확정 처리 + §1 "전원" 사각지대 행 갱신(spec §7). **선행: T3-4**

---

## P6 — 표준화 → 벤치마크 → 증설 판단 (L)

- [ ] **T6-1** (M) `docs/decisions/0020-gpu-driver-firmware-standard.md` — 표준=595.x open / **NVIDIA를 `unattended-upgrades` 블랙리스트**(G0-1 직접 원인 차단) / data01 legacy 예외. **선행: T0-4**
- [ ] **T6-2** (M) `roles/nvidia-driver` — 목표 버전·플레이버를 inventory 변수로 선언, 현재 상태와 대조해 **드리프트를 보고(check 모드)하고 적용은 사람**(§11). **선행: T6-1**
- [ ] **T6-3** `[server]` (L) data04를 535.309.01 → 595.x로 표준화(다운타임 창). 검증: AC-3-4(**`count_hygiene`=1 AND `unlabeled`=0** — DCGM 라벨만으로는 도달 불가하다는 것이 AC 본문의 결론이다. 옛 표현 `fleet:gpu_driver_versions:count`=1은 폐기). **선행: T6-2**
- [ ] **T6-4** (M) `infra/monitoring/dcgm/keiwi-counters.csv` — `DCGM_EXP_XID_ERRORS_COUNT`·`DCGM_EXP_CLOCK_EVENTS_COUNT`·ECC SBE/DBE(VOL·AGG)·THERMAL/POWER_VIOLATION·NVLink 에러 4종·`POWER_MGMT_LIMIT`·`SLOWDOWN_TEMPERATURE` 주석 해제 + compose `-f` 마운트 + `--xid-count-window-size`/`--clock-events-count-window-size`. **선행: 없음(T4-2의 XID·G4 규칙이 이걸 기다린다)**
- [ ] **T6-5** `[server]` (S) T6-4 적용(data03/04/05 dcgm-exporter 재시작). 검증: AC-3-5·AC-3-6. **선행: T6-4**
- [ ] **T6-6** (S) T4-2의 XID 규칙을 `DCGM_EXP_XID_ERRORS_COUNT` 기반으로 교체하고 임시 `GpuXidLatchChanged`를 제거. `specs/alerting/spec.md` §3.2 PromQL 교정. **선행: T6-5**
- [ ] **T6-7** (M) 벤치 스크립트 — 컴파일 0 경로(torch 2.11.0+cu130 + NCCL 2.28.9). all_reduce busbw(1MiB~1GiB, nccl-tests와 **동일 busbw 공식**) · P2P D2D · H2D/D2H(pin_memory) · bf16 GEMM TFLOPS · `NCCL_DEBUG=INFO`로 실제 경로 확증. **대상 = data03**(완전 유휴·드라이버 정합·직접 스크랩). **선행: T6-3**
- [ ] **T6-8** `[server]` (M) data03에서 벤치 실행(GPU 배타 점유 — §11/§12 게이트 통과 필요). 결과를 `docs/`에 표로. 결론 문장 목표: "NVLink 없는 cross-socket PCIe P2P에서 2-GPU all_reduce는 X GB/s → 이 플릿에서 TP는 손실이 크고 단일 GPU 배치가 유리하다"(= 현 `--tensor-parallel-size 1` 운영을 수치로 사후 정당화). **선행: T6-7**
- [ ] **T6-9** (M) `roles/gpu-benchmark` — node-hygiene 패턴 복제, `OnCalendar=weekly`, **`bench_enabled: false` 기본값**(명시적 옵트인 없이 GPU 점유 금지). 출력 `keiwi_gpu_bench.prom` + **`keiwi_gpu_bench_meta{driver_version,nccl,torch,kernel}`**. 검증: AC-3-7·AC-3-8·AC-3-10·AC-3-13. **선행: T6-8**
- [ ] **T6-10** (S) 회귀 탐지 쿼리 + 패널 — `keiwi_gpu_bench_matmul_tflops / quantile_over_time(0.5, ...[90d]) < 0.9`. 검증: AC-3-9(90일 누적 후). **선행: T6-9**
- [ ] **T6-11** (M) `rules/keiwi-capacity.yml` — 5축 recording rules(2단, 서브쿼리는 별도 그룹 `interval: 5m`). 검증: AC-3-11·AC-3-12. **선행: 없음**
- [ ] **T6-12** (M) `docs/decisions/0021-gpu-capacity-expansion-triggers.md` — 트리거 A/B/C + **B의 AND 논리**(증설로 풀리는 문제 vs 설정으로 풀리는 문제 분리) + 예측창이 조달 리드타임보다 길어야 하는 논리 + ADR-0013 임계 0.15 재사용. **첫 산출물로 "현재 증설 불필요(data03 97.7% 유휴)"를 명시한다.** **선행: T6-11**
- [ ] **T6-13** (M) 은폐 구조 제거(spec §3.9) — port-exporter에 실행파일 경로 대조 추가 · 유닛 `NRestarts`/`activating` 메트릭 · data05 호스트 systemd 노출 또는 textfile 폴백 · data05 nodename 안정화(`89bf04921943` → 드릴다운을 `node` 라벨 기반으로). **선행: T0-4**
- [ ] **T6-14** (M) blackbox_exporter 1컨테이너 — A2(data04 ICMP)·A4(vLLM `/health`)·A5(콘솔·Grafana·OpenSearch)의 **유일한 전제**. Q6(ufw ICMP 허용) 확인 선행. **선행: 없음**
- [ ] **T6-15** (S) A2·A4·A5 규칙 추가. **선행: T6-14**

---

## P7 — out-of-band 승격 (L) — **별도 ADR + 사람의 작업창. P1~P6과 절대 묶지 않는다**

> [!CAUTION]
> iLO shared network port 전환이나 전용 포트 결선은 잘못하면 호스트 NIC1 트래픽과 얽히고 최악의 경우 **원격 접근을 잃는다.** 기관망이라 IP 배정은 협의 사항이다(gw `192.0.2.1`의 MAC `00:08:e3`은 우리 장비가 아니고, ARP에 타 장비 다수 + `10.218.18.x` 대역 흔적). §11/§12에 따라 에이전트는 절대 손대지 않는다. BMC 크레덴셜이 생기는 순간 §13 관리 부담도 함께 생긴다.

- [ ] **T7-1** (S) Q8 조사 — `10.218.18.0/24`(ARP OUI `00:1a:f4` 3건)가 기존 관리 대역인지. 읽기 전용 조사만
- [ ] **T7-2** (M) 관리망 설계 문서 + IP 배정 협의안. **선행: T7-1**
- [ ] **T7-3** `[server]` (L) iLO NIC 결선/모드 전환 + IP 할당. 롤백 절차를 먼저 쓴다. **선행: T7-2 승인**
- [ ] **T7-4** (M) Redfish out-of-band 수집으로 승격 — `/UpdateService/FirmwareInventory`(**펌웨어 전량 — IPMI로는 불가**) · `/Chassis/1/Power`(PSU 모델·정격W) · `/Managers/1/LogServices/IEL`. 크레덴셜은 `.env`만(§13). **선행: T7-3**
- [ ] **T7-5** (S) ADR-0019(신설 예정) 개정 — 2차 승격 결과와 in-band 유지 범위. **선행: T7-4**

---

## 백로그 (게이트 미충족 또는 발견 선행)

- [ ] **B01** UPS/PDU 실사 → `nut_exporter`(T1★)·`snmp_exporter`(T2-9) 언블록 또는 "전원 out-of-band 무가시성"을 리스크로 확정
- [ ] **B02** data01 `ipmi_devintf` modprobe 영구화(Q2) — 하드웨어 관측 4노드 확장 vs legacy 예외 확정
- [ ] **B03** Gen9/iLO4 전력 0W 원인 규명(Q3, 현재 가설 단계)
- [ ] **B04** ntfy self-host(채널 2단계) — Q4(폰 OS) 답변 후
- [ ] **B05** `nvbandwidth`·`nccl-tests` 컴파일 경로(`nvidia/cuda:13.0-devel`) — T0-4 수복 후에만
- [ ] **B06** 멀티노드 NCCL over TCP 측정 — "이 네트워크로는 성립하지 않는다"를 GB/s로 확정해 100GbE/IB 투자 임계 산출
- [ ] **B07** NVLink 브리지 장착 가능성 — **섀시를 열어 슬롯 간격 실측**(안 열어보고 구매 권고 금지)
- [ ] **B08** `datacenter-gpu-manager-4-core` 호스트 설치 → `dcgmi diag -r 2 -j` → textfile 변환(r1이 G0-1을 바로 잡는 항목임을 런북에 명시). r3(stress)는 T6-5 이후에만
- [ ] **B09** `rack`/`pdu_circuit` 실사 → `inventory.yaml` 수기 필드 채움 → 전력 헤드룸을 절대값이 아니라 비율로 말할 수 있게 됨
- [x] **B10** BIOS 경과일 recording rule 결론 — **fleet-hardening T4-7에서 삭제로 종결.** PromQL은 `bios_date` 라벨을 시간으로 파싱하지 못해 초안 식이 릴리스 일자가 아니라 수집 시각을 재고 있었다. 경과일 신호가 다시 필요해지면 exporter 쪽 `keiwi_bmc_bios_age_days` 신설을 **BMC 축의 새 백로그 항목**으로 연다(레코드는 만들지 않는다).

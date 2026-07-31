# 알림 정책 (Alerting Policy) — SPEC v2

> 2026-07-30. 상태: **1차 규칙 9건 라이브**(Grafana 통합 알림, §2). 권위: 헌장(§11 생성·사람 적용 · §12 라이브 직접수정 금지 · egress 0 · §14 Cloudflare Access). 근거: [platform-roadmap](./../sre-addons/platform-roadmap.md)·[backlog #1/#2/#3/#6/#11](./../sre-addons/backlog.md)·[hardware-ops 축2](../hardware-ops/spec.md) + SRE 웹 리서치(Google SRE alerting-on-SLOs·alert fatigue·vLLM 결정매트릭스·DCGM 헬스).
>
> **이 문서가 "무엇을·언제·어디로 알릴지"의 단일 기준.** 단, **임계·지속시간·noDataState의 정본(source of truth)은 규칙 파일이다**: [`infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml`](../../infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml). §2 표는 그 파일의 사본이며, 표와 YAML이 어긋나면 **표(스펙)가 틀린 것**이다.
>
> v1→v2 변경 요약과 절 번호 매핑은 문서 하단 [개정 이력](#개정-이력) 참조.

---

## 0. 철학 — 알림을 거는 5원칙

1. **증상(symptom)에 알린다, 원인(cause)이 아니라.** "CPU 90%"는 알림이 아니다(원인). "vLLM 응답이 3초 넘음"이 알림이다(증상=사용자 영향). 원인은 알림 받고 나서 대시보드로 파고든다.
2. **모든 알림은 actionable.** 받았을 때 **사람이 할 명확한 조치**가 없으면 그것은 알림이 아니라 **대시보드/로그**다. (조치 없는 알림 = 삭제 대상)
3. **페이지(즉시 폰 알림)의 4조건**: 긴급 · 중요 · 조치 가능 · **사람의 판단이 필요**. 넷 다여야 폰을 울린다. 하나라도 빠지면 등급을 낮춘다.
4. **순간이 아니라 지속(for-duration).** 스파이크 한 번에 울리지 않는다. "N분 지속"을 조건에 넣어 깜빡이는 신호를 거른다.
5. **알림 예산이 있다 — 1인 SRE에겐 노이즈 하나가 전체 신뢰를 무너뜨린다.** 놓치면 안 되는 것만 남긴다. "혹시 몰라서" 거는 알림은 결국 다 무시하게 된다.

> 업계 수치: 팀당 주 2000+ 알림 중 실제 조치가 필요한 건 ~3%. 우리는 **처음부터 그 3%만** 만든다.

---

## 1. 임계 결정 프레임워크 (v2 신설 — 핵심 절)

임계를 "어떻게 정하는가"의 기준. §2의 라이브 9건이 전부 이 프레임워크로 정해졌다.

### 1.1 전제 — 데이터는 이미 쌓여 있다

**Q: 데이터가 쌓여야 임계를 정할 수 있는 것 아닌가?** A: 이미 쌓여 있다 — Prometheus 30일 보존 창이 꽉 찼고(compose `--storage.tsdb.retention.time=30d`), 통합 로그는 5개월치가 있다(보존 365d). "업계 기본값으로 시작 → 운영하며 조정"은 **데이터가 없을 때의 방식**이다. 우리는 자기 분포에서 바로 뽑는다.

실증 — 업계 기본값을 그대로 썼다면 **셋 다 첫날부터 상시 발화**였다:

| 지표 | 업계 기본값 | KEIwi 실측(30일) | 결과 |
|---|---|---|---|
| 디스크 사용률 | 80% | 최대 **86.5%** (data04 `/`) | 상시 발화 |
| 메모리 여유 | 10% | 최저 **9.9%** (data01) | 상시 발화 |
| GPU 온도 | 85°C | p99 **87°C** · 최대 **88°C** (data04 GPU1) | 상시 발화 |

첫날부터 상주하는 빨간 알림은 알림 무시 습관의 시작이다(§0-5). 실제로 GpuTempHigh는 초기에 85°C로 잡았다가 이 분포를 확인하고 **92°C로 상향 교정**했다(설정 당시 유휴값 50°C만 보고 분포를 안 본 실수 — §2 표 참조).

### 1.2 지표 3분류 — 분류마다 임계 정하는 방법이 다르다

| 분류 | 정의 | 임계 결정법 | 히스토리 필요? | 해당 라이브 규칙 |
|---|---|---|---|---|
| **① 결정적 실패** | 발생 자체가 문제(happened = broken). 임계 논쟁이 성립하지 않음 | 임계 없음 — `발생 > 0` | 불필요 | NodeDown · LogIngestStalled · GpuXidErrorNew · OomKillOccurred · SmartHealthFailed |
| **② 소진 예측** | "언제 다 차는가". 서버 크기와 무관하게 동일 의미 | `predict_linear` — 미래 시점에 0 미만 | 불필요(추세 창만) | DiskFillPredicted |
| **③ 행동 이탈** | 자기 정상 분포에서 벗어남 | **자기 30일 p99 + 마진** + 지속시간 | **필요** (유일) | DiskUsageHigh · GpuTempHigh · MemoryLow |

- ①이 5건으로 가장 많다 — 데이터도 논쟁도 필요 없는 신호를 최대화하는 것이 설계 원칙이다.
- ③만 히스토리가 필요하고, 그래서 ③은 §1.5의 2주 리뷰로 계속 재검증된다.

### 1.3 서버별 임계는 안티패턴

"data04는 디스크가 늘 높으니 data04만 95%로" 식의 서버별 임계는 만들지 않는다. 대신:

1. **1순위 — 지표 교체로 자기정규화.** 서버별 차이가 사라지는 지표로 바꾼다:
   - 디스크 % → `predict_linear` 소진 예측 (적용됨: DiskFillPredicted — "90%"는 3.5TB에선 350GB 여유인데 울리지만, "4시간 뒤 참"은 크기 무관 동일 의미)
   - 메모리 % → OOM kill 발생 (적용됨: OomKillOccurred — 연구 노드는 상시 타이트해 %가 무의미)
   - GPU 온도 → 스로틀링 발생 ("뜨겁다"가 아니라 "성능이 깎인다"가 진짜 신호 — §10-2, DCGM csv 확장 선행)
2. **2순위 — 서버별이 아니라 클래스(역할)별.** 3클래스: **stack-host**(data05) / **gpu-node**(data03·04) / **legacy**(data01). 현재 Prometheus 타깃 라벨은 `instance`·`job`뿐이라 클래스별 임계를 걸려면 **스크랩단에 `class` 라벨 추가가 선행**된다(§10-1).
3. **함정 — "서버별 임계" 압력의 절반은 안 고친 문제의 합리화다.** data01 메모리 9.9%·data04 `/` 86.5%는 임계를 올려 덮을 대상이 아니라 **고칠 문제**다(T0-7에서 사용자 통보 대상으로 분류됨). 임계 조정 요청이 오면 먼저 묻는다: "이거 고쳐야 하는 상태 아닌가?"

### 1.4 연구원 환경 특성 — 외부 SLA가 없다

- **외부 SLA 없음 → 내부 SLI로 정의**: "GPU를 쓰려 할 때 쓸 수 있는가 / 데이터를 잃지 않는가." 이 두 질문에 닿지 않는 신호는 알림이 아니다.
- **GPU util 100% = 정상.** 실측 이봉분포: p50=0 · max=100(놀거나 풀로 돌거나). → **util 기반 알림 금지.** GPU의 진짜 신호는 포화(VRAM)와 에러(XID)다.
- **1인 운영 · 온콜 없음** → Page(폰)는 **데이터 손실 위험만**: SMART 실패 · 디스크 소진 · 로그 인입 정지. 나머지는 Ticket/Digest.
- **연구 데이터는 재현 불가** → 데이터 손실이 GPU 온도보다 우선순위가 높다. (SmartHealthFailed가 critical, GpuTempHigh가 warning인 이유)

### 1.5 운영 프로세스 — 2주 리뷰 (조치율 기반 프루닝)

**2주마다 규칙별 발화 수와 조치율을 리뷰한다.** 조치율이 낮으면 **삭제 또는 임계 상향 — 예외 없이**(§8-3, 체크리스트는 §10-3).

양쪽 실패의 비용이 다 측정돼 있다:
- **알림 0건의 비용**: 로그 인입이 2026-07-24~30 **5.7일간** 멈췄는데 아무도 몰랐다(대시보드는 "에러 0건"을 초록으로 표시). → LogIngestStalled의 존재 이유.
- **알림 과다의 비용**: 업계 주 2000+ 알림 중 조치 ~3% — "100건인데 아무도 안 봄"은 0건과 같다.

---

## 2. 현행 라이브 규칙 9건 (2026-07-30) — 정본은 YAML

**정본**: [`infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml`](../../infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml) (그룹 `keiwi-infra-core`, interval 1m, 적용은 사람이 `/data/monitoring/grafana/provisioning/alerting/`로 복사 — 헌장 §11). 아래 표는 사본이며 어긋나면 표가 틀린 것.

| 규칙(title) | 분류(§1.2) | 조건 · 임계 | for | noDataState | severity | 근거(실측) |
|---|---|---|---|---|---|---|
| **NodeDown** | ① 결정적 | `up{job="node-exporter"}` **< 1** | 5m | **Alerting** | critical | 현재 4/4 up — 발화 0 확인 후 투입 |
| **LogIngestStalled** | ① 결정적 | OpenSearch(`keiwi-logs-es`) 최근 30분 문서 수 **< 100** | 10m | **Alerting** | critical | 정상 ≈9.8 EPS = 30분 ≈17,600건. 100 미만 = 사실상 정지(0이 아닌 100: 재시작 직후 소량 흐름도 잡기 위해). **5.7일 무성 장애(§1.5)의 해법** |
| **DiskUsageHigh** | ③ 이탈 | 사용률 **> 90**% (`tmpfs\|overlay\|squashfs\|ramfs` 제외) | 15m | NoData | warning | 30일 실측 최대 86.5%(data04 `/`, T0-7 정리 대상) |
| **GpuTempHigh** | ③ 이탈 | `DCGM_FI_DEV_GPU_TEMP` **> 92**°C | 10m | NoData | warning | **85→92 상향(2026-07-30)**: 30일 p99 87°C·최대 88°C(data04 GPU1) — 85는 정상 연구 부하에서 상시 발화하는 결함이었다. 92 = 관측 최대 88 + 여유 4 |
| **MemoryLow** | ③ 이탈 | 가용 메모리 **< 5**% | 15m | NoData | warning | 30일 실측 최저 9.9%(data01, T0-7 대상) — 업계 기본 10%면 상시 발화 |
| **GpuXidErrorNew** | ① 결정적 | `changes(DCGM_FI_DEV_XID_ERRORS[30m])` **> 0** | 0s | NoData | critical | **XID는 latched 게이지** — data05 GPU 2장에 잔존값 43(드라이버 mismatch 사태 흔적)이 있어 `>0` 비교면 첫날부터 상시 발화였다. `changes()`는 새 변화만 잡는다(검증: changes[24h]=0건). §5.2 참조 |
| **OomKillOccurred** | ① 결정적 | `increase(node_vmstat_oom_kill[1h])` **> 0** | 0s | NoData | warning | 발생 = 이미 피해. "메모리 %" 임계보다 정확한 신호(§1.3-1) |
| **SmartHealthFailed** | ① 결정적 | `smartctl_device_smart_status` **< 1** | 0s | **NoData** | critical | 디스크가 스스로 "곧 죽는다"고 말하는 것. 연구 데이터 재현 불가 → 손실 위험 최우선(§1.4) |
| **DiskFillPredicted** | ② 소진예측 | `predict_linear(node_filesystem_avail_bytes[6h], 4*3600)` **< 0** (4시간 내 소진) | 30m | NoData | critical | 서버 크기 무관 동일 의미(§1.3-1). 6h 관찰창: 짧으면 순간 쓰기에 과민, 길면 급증을 놓침. DiskUsageHigh("이미 높다")와 상보("곧 찬다") |

**noDataState 선택 이유** (규칙별):
- **Alerting(2건)** — NodeDown: 스크랩이 아예 안 오는 것(타깃 소멸)도 장애다. LogIngestStalled: 쿼리 자체가 안 되면 그것도 장애다(관측 스택 침묵 실패).
- **NoData(7건)** — 노드가 down이면 그 노드의 디스크·메모리·GPU 시리즈는 NoData가 **정상**이다. Alerting으로 두면 NodeDown 1건이 알림 7건으로 증폭된다(중복 방지, §6-3 inhibition의 저비용 대체). **SmartHealthFailed는 특별 사유**: data05 smartctl 스크랩이 ufw 규칙 적용 전까지 down이라(T0-7), Alerting이면 그 자체가 상주 오발화가 된다. ufw 해소 후 Alerting 승격 재검토(§10-3).

**의도적 미포함**: 이미 죽어 있는 vllm:8010 · data05 smartctl:9633 타깃은 대상에서 제외했다. 첫날부터 상주하는 빨간 알림은 알림 무시 습관의 시작 — **먼저 고치고(T0-7) 그다음 넓힌다.** 9건 전부 투입 전 라이브 실측으로 "현재 발화 0건"을 확인했다.

> 알려진 YAML 내부 표기 결함(임계 아님): GpuTempHigh의 summary 문구가 "85°C 초과"로 남아 있다(임계는 92). 다음 YAML 수정 시 문구만 교정한다 — 이 스펙 표는 임계 92를 따른다.

---

## 3. 심각도 등급 (SEV) — 3단계

| 등급 | 정의 | 기대 응답 | 채널 | 야간(업무외) |
|---|---|---|---|---|
| **SEV1** (페이지) | 사용자/자산에 **즉각적 위협**, 지금 조치 안 하면 손실 확대 | **즉시** | 폰 푸시 | **울림** |
| **SEV2** (경고) | 곧 문제가 됨, 방치 시 SEV1로 악화 가능 | 업무시간 내 | 콘솔 인박스/채팅 | 대기(아침) |
| **SEV3** (기록) | 추세·위생 신호, 조치는 선택 | 2주 리뷰 | 이메일 다이제스트/로그 | 조용 |

- **야간에 폰을 울리는 것은 SEV1뿐.** SEV2/3은 아침에 본다. (1인 SRE 번아웃 방지)
- 등급은 "얼마나 나쁜가"가 아니라 **"얼마나 빨리 사람이 개입해야 하나"**로 정한다.
- §1.4에 따라 Page 후보는 **데이터 손실 위험**(SMART·디스크 소진·로그 정지)이 우선이다.

---

## 4. "알림을 걸어야 하나?" — 판정 체크리스트 (신규 알림 게이트)

새 알림을 만들기 전 **4개 질문**을 통과해야 한다. 하나라도 "아니오"면 알림이 아니라 대시보드/로그로 간다.

1. **이 신호에 사람이 할 명확한 조치가 있는가?** (runbook 한 줄로 쓸 수 있나) — 없으면 ❌ 대시보드로.
2. **지금 조치하지 않으면 상황이 나빠지는가?** — 아니면 SEV를 낮춘다(SEV3).
3. **자동으로 복구되는가?** (재시도·재기동으로 알아서 낫나) — 그렇다면 ❌ 또는 self-heal 후보.
4. **이미 상위 알림이 이 상황을 포함하는가?** (예: 노드 down이면 그 노드의 GPU 알림은 잉여) — 그렇다면 **inhibition**(또는 noDataState=NoData, §2)으로 뮤트, 별도 알림 금지.

> **KEIwi 함정 — no-data ≠ down (v2 교정, hardware-ops [§2.10](../hardware-ops/spec.md)/T0-8).** 설계된 no-data는 **data02(Windows)뿐**이다. **data01은 2026-07-24 온보딩되어 수집 중**(`up`에서 `.101`의 node·port·gpu-model 3개 job 모두 1). 단 data01은 드라이버 418로 DCGM 불가 → 셀렉터는 job별로 분기한다: **node/port/gpu-model은 data01 포함(4노드), dcgm은 data03/04/05만.** (v1의 "data01/02는 수집 대상이 아니다"는 사실 드리프트였다 — 헌장 US4 정직성)
>
> 추가 구멍(§2.10 신규 발견): **data05는 `node_systemd_unit_state` 시리즈가 없다**(compose의 `--collector.systemd`가 컨테이너에서 미동작, 101/103/104만 존재). systemd 기반 규칙을 걸 때 data05는 영구 no-data임을 알고 설계할 것.

---

## 5. KEIwi 알림 카탈로그 (타깃 상태 — 확장 방향)

각 항목: 신호 · 조건(개념) · 지속 · SEV · runbook · 왜 actionable. **라이브 반영분(✅)은 §2가 현행이고 정본은 YAML** — 이 카탈로그는 나머지의 확장 방향이다. 새 항목은 §4 게이트 + §1 프레임워크(3분류 판정)를 통과해야 한다.

라이브 매핑: A1→NodeDown✅ · S1→LogIngestStalled✅ · R1/R2→DiskUsageHigh/DiskFillPredicted✅ · R3→MemoryLow✅+OomKillOccurred✅(S4) · G1→GpuXidErrorNew✅ · G4→GpuTempHigh✅ · (v1 카탈로그에 없던 SMART가 SmartHealthFailed✅로 추가 — §1.4 데이터 손실 우선)

> ⚠️ **셀렉터 주의(구현):** 라벨이 job마다 다르다 — node/dcgm=`instance`(ip:port), gpu-model/port=`node`. 수집 노드 한정은 §4의 v2 교정대로 **job별**로 명시한다(node 계열은 data01 포함, dcgm은 03/04/05).

### 5.0 알림 시스템 자기감시 (Dead man's switch) — ⚠️ 최우선 (critic C1)
**전 알림 스택(Prometheus·Grafana알림·(예정)ntfy·cloudflared)이 data05 단일 호스트에 있다 → data05가 죽으면 그 죽음을 알릴 주체도 함께 죽는다(SPOF).** 이 장치 없이는 아래 카탈로그 전체가 무의미. **알림 시스템 "밖"에서** 침묵을 감지하는 게 다른 무엇보다 먼저다.

| # | 알림 | 방식 | SEV |
|---|---|---|---|
| W1 | **Watchdog(상시 발화)** | `Watchdog`(vector(1))를 항상 firing → **data05 밖 관찰자**가 "N분간 heartbeat 없음"이면 경보 | **1** |

**egress 0 하 관찰자(택1, §12 미해결질문):**
- (권장) **2차 노드 관찰자** — data03/04에 경량 heartbeat 수신기(healthchecks self-host/스크립트) + 독립 푸시 경로. data05가 주기 ping, 끊기면 2차 노드가 SRE에 알림. **진정한 egress 0.** (hardware-ops §2.9는 Slack egress 1건 승인안을 병행 검토)
- (대안) **외부 heartbeat 예외** — 내용 없는 liveness ping만 외부(healthchecks.io 등)로. 데이터 유출 0이라 egress 0의 **명시적 예외 1건**으로 승인·문서화.
- 보조: Prometheus TSDB 자기건강(`prometheus_tsdb_wal_corruptions_total`·스크랩 실패율)·전송실패. 단 data05 내부라 W1 외부 관찰자가 상위 안전망.

### 5.1 가용성 (있어야 산다)
| # | 알림 | 조건 | for | SEV | runbook / 조치 |
|---|---|---|---|---|---|
| A1 ✅ | **노드 down** | 라이브: `up{job="node-exporter"} < 1` (§2 NodeDown — 4노드 전체, noData=Alerting) | 5m | **1** | node-onboarding §검증·전원/네트워크·터널 확인 |
| A2 | **SSH 터널 down (data04)** | data04 exporter 타깃 일괄 down **AND** data04 IP(192.168.1.104) **blackbox ICMP는 OK**(같은 서브넷 — 터널 밖 직접 경로) | 2m | **1** | `systemctl restart keiwi-tunnel-data04`. *blackbox 선행(T02b). ICMP OK가 A1(진짜 down)과 구분 — A1엔 inhibit 안 함* |
| A3 | **exporter down(개별)** | 노드는 up인데 특정 exporter 타깃만 down | 5m | 2 | 해당 서비스 재기동. *A1/A2에 inhibit* |
| A4 | **vLLM 중단** | blackbox `/health` 실패(어시스턴트 엔진) | 2m | **1** | vLLM 서비스 로그·재기동. 어시스턴트 무력화 |
| A5 | **콘솔/Grafana/OpenSearch 응답 없음** | blackbox `probe_success==0` | 2m | 1(콘솔·Grafana) / 2(OS·Logstash) | 컨테이너·포트·Cloudflare 확인 |

### 5.2 GPU 하드웨어 건강 (핵심 자산 — 조용히 학습 오염)

> **GPU util 알림 금지(§1.4).** util은 이봉분포(p50=0·max=100)라 임계가 성립하지 않는다. 신호는 포화(VRAM)·에러(XID)·스로틀이다.

| # | 알림 | 조건 | for | SEV | 조치 |
|---|---|---|---|---|---|
| G1 ✅ | **XID 에러(신규)** | `changes(DCGM_FI_DEV_XID_ERRORS[30m]) > 0` (§2 GpuXidErrorNew) | 0s | **1** | XID 코드 조회(예 48=DBE→GPU 교체 검토)·작업 중단 판단 |
| G2 | **ECC DBE / remapped-row 실패** | 더블비트 ECC 또는 row remap 실패 증가 | — | **1** | VRAM 불안정 — 해당 GPU 격리·교체 검토. *csv 확장(#1) 선행* |
| G3 | **써멀 스로틀 지속** | `rate(DCGM_FI_DEV_THERMAL_VIOLATION[5m]) > 0` | 10m | 2 | 냉각·먼지·팬 확인. 성능 저하 원인. *csv 확장(#1) 선행* |
| G4 ✅ | **GPU 과열** | `DCGM_FI_DEV_GPU_TEMP > 92` (§2 GpuTempHigh — 30일 p99 87°C 실측 기반, §1.1) | 10m | 2 | 부하·냉각 확인. *§10-2에서 G3 스로틀 신호로 교체 예정* |

> **XID latched 함정 (v2 교정 — hardware-ops "§3.2 PromQL이 틀렸다" 반영):** v1의 `increase(DCGM_FI_DEV_XID_ERRORS[10m]) > 0`은 틀렸다. `DCGM_FI_DEV_XID_ERRORS`는 **카운터가 아니라 latched 게이지** — 마지막 XID 코드값이 재부팅 전까지 유지된다(실측: data05 GPU 2장에 잔존값 43). 단순 `>0` 비교는 상시 발화, `increase()`는 게이지 의미론상 부적합. **`changes()`만 허용**(hardware-ops AC-2-8: `increase(DCGM_FI_DEV_XID_ERRORS` 사용 금지 게이트). **XID 분기(critic M4)**: 모든 XID를 SEV1로 하면 야간 노이즈 — 치명 XID만 SEV1(48 DBE·79 fallen off bus·74 NVLink·92 등 HW), 앱-레벨 XID(13/31 등)는 SEV2. 화이트리스트 분기는 라이브 규칙 2주 관찰 후 도입.
>
> 온도 임계 카드별 파라미터화(A40/RTX6000 스로틀 포인트 상이)는 **하지 않는다** — §1.3 안티패턴. 대신 §10-2의 스로틀 신호 교체로 자기정규화한다.

### 5.3 자원 포화 (곧 쓰러진다)
| # | 알림 | 조건 | for | SEV | 조치 |
|---|---|---|---|---|---|
| R1 ✅ | **디스크 임박** | 라이브: 사용률 >90% (§2 DiskUsageHigh) + 소진 예측 `predict_linear[6h]` 4h<0 (§2 DiskFillPredicted) | 15m/30m | **1** | 로그·모델·캐시 정리. OpenSearch ISM 확인 |
| R2 ✅ | **디스크 경고** | R1의 DiskFillPredicted가 "곧 찬다"를 커버 — 별도 15% 임계 규칙은 두지 않음(§1.3-1) | — | 2 | 정리 계획 |
| R3 ✅ | **메모리 부족** | 라이브: 가용 <5% (§2 MemoryLow) + OOM 발생 (§2 OomKillOccurred) | 15m/0s | 2 | 프로세스 확인·OOM 위험 |

### 5.4 vLLM 추론 SLO (도그푸딩 — 느려지면 SRE 본인이 불편)
| # | 알림 | 조건 | for | SEV | 조치(결정매트릭스) |
|---|---|---|---|---|---|
| V1 | **TTFT 초과** | p95 TTFT > 3s | 10m | 2 | 큐↑=부하안정화 / 큐정상=prefill·throttle 점검 |
| V2 | **KV캐시 압박** | `increase(preemptions_total[10m]) > 0 AND (p95 TTFT > 3s OR num_requests_waiting 높음)` | 10m | 2 | max_num_seqs·max_num_batched_tokens 튜닝 |

> **v1=임계 기반(critic M7):** 위 표(=계약)는 단순 임계+for. §6-5의 "SLO multi-window burn-rate"는 error budget이 정의되는 #10(vLLM SLO)/#7(Sloth) **이후 단계**다. vLLM `:metrics` 스크레이프가 데이터 전제(§12).

### 5.5 로그 신호 (근본원인 조기 발견)
| # | 알림 | 조건 | for | SEV | 조치 |
|---|---|---|---|---|---|
| L1 | **에러율 급증** | 노드·category별 error 수가 직전 1h 베이스라인 대비 급증(OpenSearch 이상탐지 RCF) | — | 2 | Logs 워크벤치에서 host·시간 프리필터 → RAG 진단 |

### 5.6 위생·추세 (기록)
| # | 알림 | 조건 | SEV | 조치 |
|---|---|---|---|---|
| H1 | **TLS 인증서 만료 임박** | 만료 < 14d | 3 | 갱신 |
| H2 | **유휴/좀비 GPU** | VRAM 점유 + util≈0 지속(30m, #9 구현 후) | 3 | **넛지만** — 점유자에게 정리 요청. 자동 kill 금지(§11 헌장) |

### 5.7 스택 자기건강 (침묵 실패 방지 — critic M1/M2/M3/M6)
관측 스택 자체가 조용히 멈추면 "초록인데 죽음". 헌장 §15(OOM·runaway) 포함.
| # | 알림 | 조건 | for | SEV | 조치 |
|---|---|---|---|---|---|
| S1 ✅ | **로그 인입 중단** | 라이브: 30분 유입 <100건 (§2 LogIngestStalled, noData=Alerting) | 10m | **1** | Filebeat/Logstash 확인. *L1 로그진단 무력화. 5.7일 무성 장애의 해법* |
| S2 | **Logstash 정체/다운** | 파이프라인 이벤트 정체 또는 `:5044` down | 5m | 2 | Logstash 재기동·백프레셔 |
| S3 | **OpenSearch 상태** | status=red 또는 디스크 watermark 초과 또는 ISM 실패 | 5m | 1(red)/2 | 샤드·디스크·ISM 확인 |
| S4 ✅ | **OOM-kill / runaway**(§15) | 라이브: `increase(node_vmstat_oom_kill[1h]) > 0` (§2 OomKillOccurred) | 0s | 2 | 원인 프로세스·메모리 확인. *runaway(크래시루프)는 미커버 — `state="failed"`만으론 `activating (auto-restart)`를 못 잡는다(hardware-ops §2.10, data05 431,899회 재시작 실증). NRestarts 신호 필요* |
| S5 | **시계 드리프트** | node 시계 편차 초과 | 10m | 3 | NTP 동기(로그 상관 오류 유발) |

> 카탈로그는 **최소 세트**다. "혹시 몰라" 항목을 늘리지 않는다. 새 항목은 §4 체크리스트를 통과해야 추가.

---

## 6. 노이즈 억제 — "쓸모없는 알림이 쏟아진다"를 막는 장치

사용자 최대 우려. 5중 방어:

1. **for-duration(지속성)** — §2·§5의 `for` 열. 순간 스파이크 무시. 단 ① 결정적 실패는 `for: 0s`(발생=문제, 지속 조건이 오히려 신호를 놓침).
2. **grouping·dedup** — 같은 알림을 10~15분 창으로 묶어 한 번만. 동시 다발 시 요약.
3. **inhibition(억제)** — **상위 장애가 하위 알림을 자동 뮤트.** 라벨 기반(job·node)으로 설계. 라이브 1차에서는 **noDataState=NoData가 저비용 대체**로 같은 효과를 낸다(§2 — 노드 down 시 그 노드의 디스크·메모리·GPU 시리즈가 NoData로 침묵).
   - 노드 down(A1) → 그 노드의 G1~G4·R1~R3·A3 뮤트(A4 vLLM은 현재 data05 전용 — `prometheus.yml` 확장 시 셀렉터 재작업).
   - 터널 down(A2) → data04의 A3·exporter 알림 뮤트.
   - **OpenSearch down(S3) → L1(로그 에러율)·S1(인입) 뮤트** — 데이터 소스 상실 시 그 위 알림은 무의미.
   - → "노드 하나 죽었는데 알림 20개" 방지.
4. **silence(침묵)** — **계획 정비 중 수동 뮤트.** 노드 온보딩·재부팅·GPU 드라이버 설치 시 해당 노드/시간 침묵. (온보딩 런북에 "silence 걸기" 단계 추가)
5. **SLO는 multi-window burn-rate** — vLLM SLO 알림은 순간값이 아니라 error budget 소진 속도로(빠른 소진=SEV1급, 느린 소진=티켓). 순간 소음 근본 차단. (#7/#10 이후)

추가 규칙:
- **actionable 아니면 삭제**(§0-2). runbook 없는 알림은 머지 금지.
- **야간 라우팅** — 업무 외 시간엔 SEV1만 폰. SEV2는 아침 큐로.

---

## 7. 채널 라우팅 (기준이 정해지면 채널은 따라온다)

| SEV | 채널 | 도구(egress 0) |
|---|---|---|
| **SEV1** | 폰 푸시(즉시) | **self-host ntfy/Gotify**(Cloudflare 터널로 폰 도달, 내용 외부 유출 0). Telegram은 내용이 외부로 나가 §egress 0 위반 — 예외만 |
| **SEV2** | 콘솔 인박스 / 사내 채팅 | Grafana 알림 → 콘솔 수신 웹훅 |
| **SEV3** | 이메일 다이제스트(격주) / 로그 | 사내 SMTP 있을 때만. 없으면 콘솔 기록 |

- **이메일이 주 채널이 아닌 이유**: 1인 SRE는 메일함을 실시간으로 안 본다 → SEV1엔 부적합. SEV3 다이제스트·감사기록 용도로만.
- 라우팅 트리는 라벨(severity·node·category)로. owner 필드(#5 CMDB)가 생기면 책임자 라우팅(#13)으로 확장.
- 채널 인프라(ntfy vs Slack egress 예외)의 상세 결정은 [hardware-ops 축2 §2.9](../hardware-ops/spec.md)가 다룬다 — 여기서 중복 정의하지 않는다.

---

## 8. 알림 수명주기 — 거버넌스(공식 관리 시스템 요건)

1. **신규 알림 = PR로 제안**(규칙 파일 `infra/monitoring/grafana/provisioning/alerting/`) → §4 체크리스트·§1 분류 판정·runbook 첨부 확인 → 리뷰 → merge → 사람이 라이브 반영(§11).
2. **모든 알림에 필수 애너테이션**: `runbook_url` + 패널 딥링크(`__dashboardUid__`/`__panelId__`). **없으면 머지 금지.**
3. **2주 알림 리뷰**(§1.5): 규칙별 발화 수·조치율 집계. firing이 잦은데(2주 10+) **조치를 못 만든 알림 = 임계 상향 또는 삭제 — 예외 없이.** 체크리스트는 §10-3. 콘솔이 "알림→조치 전환율"을 계측해 프루닝 후보 제시.
4. **포스트모템 연결**: SEV1은 무비난 포스트모템(#4) 작성 → 조치항목을 runbook/규칙으로 피드백(학습 루프).

---

## 9. 구현 매핑 (v2 — 현행)

- **엔진**: **Grafana 통합 알림**(라이브, 별도 컨테이너 0개). Alertmanager는 라벨 기반 inhibition·고급 라우팅이 실제로 필요해지는 시점에 재평가(현재는 noDataState=NoData가 대체, §6-3).
- **규칙 정본**: [`infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml`](../../infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml) — 레포에 커밋, 사람이 `/data/monitoring/grafana/provisioning/alerting/`로 복사 적용(§11). SLO 규칙은 Sloth이 생성(#7, 이후).
- **알림 발화**: self-host ntfy 브릿지(SEV1) + 콘솔 웹훅(SEV2) + SMTP(SEV3) — 채널 상세는 hardware-ops 축2.
- **DCGM 헬스 필드**(G2/G3): 기본 csv에 CLOCK_THROTTLE_REASONS·ECC 없음(실측) — custom csv 확장(#1)이 선행(§10-2).

---

## 10. 향후 작업 (v2 신설)

### 10-1. `class` 라벨 — 스크랩단 추가 (클래스별 임계의 전제)
현재 Prometheus 타깃 라벨은 `instance`·`job`뿐. `prometheus.yml` 스크랩 설정에 3클래스 라벨을 추가한다: `class: stack-host`(data05) / `class: gpu-node`(data03·04) / `class: legacy`(data01). 이후 ③ 이탈 규칙을 서버별이 아니라 클래스별로 걸 수 있다(§1.3-2). data02(Windows)는 수집 제외 유지.

### 10-2. DCGM csv 확장(#1) → GpuTempHigh를 스로틀 신호로 교체
백로그 #1: `CLOCK_THROTTLE_REASONS`(+ ECC 필드) csv 추가 → G3(써멀 스로틀)를 라이브로 올리고, **GpuTempHigh(92°C)를 삭제 또는 SEV3 강등**. "뜨겁다"(카드별 임계 필요)에서 "성능이 깎인다"(카드 무관 자기정규화)로 — §1.3-1의 지표 교체 원칙. G2(ECC DBE)도 같은 확장에 올라탄다.

### 10-3. 2주 리뷰 체크리스트 (매 리뷰 반복)
- [ ] 규칙별 발화 수·조치율 집계 (Grafana alert history) — 조치율 낮으면 삭제/상향, **예외 없이**(§1.5)
- [ ] 오발화 0 유지 확인 — 상주 firing이 있으면 임계가 아니라 **문제를 고쳤는지** 먼저 확인(§1.3-3)
- [ ] T0-7 진행 점검: data04 `/` 86.5% 정리·data01 메모리 9.9% 통보 — 해소되면 ③ 규칙 여유 회복
- [ ] smartctl ufw 해소 여부 → 해소 시 SmartHealthFailed의 `noDataState: NoData → Alerting` 승격 검토(§2)
- [ ] GpuTempHigh summary 문구("85°C") YAML 교정 여부(§2 표기 결함)
- [ ] XID 발화 이력 → 치명/앱-레벨 화이트리스트 분기(§5.2) 도입 판단
- [ ] 확장 판단: blackbox(A2/A4/A5)·dead man's switch(W1)·S2/S3 — §4 게이트 통과분만
- [ ] 이 스펙 §2 표 ↔ alert-rules.yaml 대조(드리프트=버그, 하드웨어-ops §7 원칙)

---

## 11. v1 스코프 아웃 (명시적 — 암묵 누락 금지, critic M5)
- **사용자 귀속 알림/이메일(헌장 M5 flagship)** — v1은 SRE-facing만. 연구원 귀속 넛지·책임자 라우팅은 owner CMDB(#5)+#13 이후. (H2 유휴 넛지는 초안 생성만)
- **SLO burn-rate 알림** — #7(Sloth)/#10(vLLM SLO) 이후. v1은 임계 기반.
- **앱 에러 알림** — [error-tracking(GlitchTip)](../error-tracking/) 스펙의 영역. 인프라 알림과 경계 유지.

## 12. 미해결 질문 (착수 전 확인 — critic Open Questions)
- SRE **폰 OS(iOS/Android)?** — ntfy 셀프호스트 폰 도달성·egress 0 실현 판정.
- **data04로 ICMP를 ufw가 허용**하나? — A2 blackbox ICMP 성립 조건.
- ~~data03 DCGM 실제 기동?~~ → **해소(v2)**: 기동 확인 — `up{job="dcgm-exporter",instance="192.168.1.103:9400"}==1`, XID·온도 시리즈 정상(hardware-ops §2.10 실측).
- **vLLM `/metrics` 스크랩 여부** — V1/V2 데이터 전제(#10).
- **W1 관찰자** — 2차 노드(data03/04) vs 외부 heartbeat 예외 vs Slack egress 1건(hardware-ops §2.9), 어느 쪽으로 갈지 결정.
- **L1 최소 이벤트 하한** — 저트래픽 category에서 3→9건 오탐 방지 절대 임계.

## Tasks
- [x] T00 1차 알림 규칙 9건 라이브(2026-07-30) — Grafana 통합 알림, 정본 `infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml`, 투입 전 발화 0 실측
- [ ] T01 정책 확정(§3 SEV·§5 카탈로그·§7 채널) — §12 미해결질문 답변 후 사용자 승인 *(§1 프레임워크·§2 라이브 9건은 확정분)*
- [ ] T02 DCGM 헬스 필드 확장(#1) — G2/G3 데이터 전제 → GpuTempHigh 교체(§10-2)
- [ ] **T02b blackbox_exporter 배포**(A2/A4/A5 선행) — ICMP(data04)·HTTP(vLLM /health·콘솔·Grafana·OpenSearch·터널)
- [ ] **T02c Dead man's switch(W1)** — Watchdog + 2차 노드 관찰자(또는 egress 예외 승인)
- [ ] T03 잔여 규칙(A2~A5·G2~G3·**S2/S3/S5**) + runbook_url — §4 게이트·2주 리뷰 통과분만
- [ ] T04 라우팅 고도화 — 라벨 기반 inhibition(필요 시 Alertmanager 재평가)/silence + self-host ntfy(SEV1)
- [ ] T05 vLLM :metrics 스크레이프 + V1/V2 + SLO(#7/#10)
- [ ] T06 [server] 사람 적용 + **watchdog(W1) 침묵검증** + 야간 SEV1 폰 푸시 실검증 + 로그중단(S1) 검증
- [ ] T07 `class` 라벨 스크랩단 추가(§10-1) — 클래스별 임계 전제
- [ ] T08 2주 리뷰 1회차(§10-3) — 발화 수·조치율 첫 집계

---

## 개정 이력

| 버전 | 일자 | 변경 내용 |
|---|---|---|
| v1 | 2026-07-04 | 최초 정책 — 5원칙·SEV 3단계·카탈로그(A/G/R/V/L/H)·노이즈 억제·채널·거버넌스 |
| v1.1 | 2026-07-04 | 적대적 검토(critic) 반영 — dead man's switch(현 §5.0)·스택 자기건강(현 §5.7)·A2 재정의·XID 분기·inhibition 라벨화·스코프아웃·미해결질문 |
| **v2** | **2026-07-30** | ① **§1 임계 결정 프레임워크 신설** — 지표 3분류·자기 분포 기반 임계(업계 기본값이면 3건 상시 발화 실증)·서버별 임계 안티패턴과 클래스 설계·연구원 환경 SLI·2주 리뷰. ② **§2 라이브 규칙 9건 반영** — 정본은 `alert-rules.yaml`, 스펙은 사본(드리프트=스펙 버그). ③ **사실 드리프트 3건 교정**(hardware-ops §2.10/T0-8): data01은 수집 중(no-data는 data02뿐, dcgm만 03/04/05 한정) · data03 DCGM 기동 확인(§12 해소) · data05 systemd 수집기 미작동 주의 추가(§4). ④ **XID PromQL 교정**(§5.2): latched 게이지라 `increase()`/`>0` 금지 → `changes()` (hardware-ops "§3.2 PromQL 틀림" 지적 반영, AC-2-8). ⑤ **§10 향후 작업 신설** — class 라벨·csv 확장 후 온도→스로틀 교체·2주 리뷰 체크리스트. ⑥ 주간 리뷰→2주 리뷰 통일(§8), 구현 매핑을 Grafana 통합 알림 현행화(§9). **절 번호 매핑**: v1 §1→§3, §2→§4, §3→§5(§3.2→§5.2), §4→§6, §5→§7, §6→§8, §7→§9, §8→§11, §9→§12 |

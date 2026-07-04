# 알림 정책 (Alerting Policy) — SPEC

> 2026-07-04. 상태: 정책 확정 대기 → 확정 후 구현(Alertmanager, backlog #6). 권위: 헌장(§11 생성·사람 적용 · §12 라이브 직접수정 금지 · egress 0 · §14 Cloudflare Access). 근거: [platform-roadmap](./../sre-addons/platform-roadmap.md)·[backlog #1/#2/#3/#6/#11](./../sre-addons/backlog.md) + SRE 웹 리서치(Google SRE alerting-on-SLOs·alert fatigue·vLLM 결정매트릭스·DCGM 헬스).
>
> **이 문서가 "무엇을·언제·어디로 알릴지"의 단일 기준.** 알림 규칙(PromQL)·채널 설정은 이 정책을 따라야 하며, 벗어나면 규칙이 틀린 것.
>
> **v1.1(2026-07-04) — 적대적 검토(critic) 반영:** dead man's switch(§3.0)·스택 자기건강(§3.7)·A2 재정의·XID 분기·inhibition 라벨화·스코프아웃(§8)·미해결질문(§9) 추가. **T01 정책 확정은 §9 답변 후.**

---

## 0. 철학 — 알림을 거는 5원칙

1. **증상(symptom)에 알린다, 원인(cause)이 아니라.** "CPU 90%"는 알림이 아니다(원인). "vLLM 응답이 3초 넘음"이 알림이다(증상=사용자 영향). 원인은 알림 받고 나서 대시보드로 파고든다.
2. **모든 알림은 actionable.** 받았을 때 **사람이 할 명확한 조치**가 없으면 그것은 알림이 아니라 **대시보드/로그**다. (조치 없는 알림 = 삭제 대상)
3. **페이지(즉시 폰 알림)의 4조건**: 긴급 · 중요 · 조치 가능 · **사람의 판단이 필요**. 넷 다여야 폰을 울린다. 하나라도 빠지면 등급을 낮춘다.
4. **순간이 아니라 지속(for-duration).** 스파이크 한 번에 울리지 않는다. "N분 지속"을 조건에 넣어 깜빡이는 신호를 거른다.
5. **알림 예산이 있다 — 1인 SRE에겐 노이즈 하나가 전체 신뢰를 무너뜨린다.** 놓치면 안 되는 것만 남긴다. "혹시 몰라서" 거는 알림은 결국 다 무시하게 된다.

> 업계 수치: 팀당 주 2000+ 알림 중 실제 조치가 필요한 건 ~3%. 우리는 **처음부터 그 3%만** 만든다.

---

## 1. 심각도 등급 (SEV) — 3단계

| 등급 | 정의 | 기대 응답 | 채널 | 야간(업무외) |
|---|---|---|---|---|
| **SEV1** (페이지) | 사용자/자산에 **즉각적 위협**, 지금 조치 안 하면 손실 확대 | **즉시** | 폰 푸시 | **울림** |
| **SEV2** (경고) | 곧 문제가 됨, 방치 시 SEV1로 악화 가능 | 업무시간 내 | 콘솔 인박스/채팅 | 대기(아침) |
| **SEV3** (기록) | 추세·위생 신호, 조치는 선택 | 주간 리뷰 | 이메일 다이제스트/로그 | 조용 |

- **야간에 폰을 울리는 것은 SEV1뿐.** SEV2/3은 아침에 본다. (1인 SRE 번아웃 방지)
- 등급은 "얼마나 나쁜가"가 아니라 **"얼마나 빨리 사람이 개입해야 하나"**로 정한다.

---

## 2. "알림을 걸어야 하나?" — 판정 체크리스트 (신규 알림 게이트)

새 알림을 만들기 전 **4개 질문**을 통과해야 한다. 하나라도 "아니오"면 알림이 아니라 대시보드/로그로 간다.

1. **이 신호에 사람이 할 명확한 조치가 있는가?** (runbook 한 줄로 쓸 수 있나) — 없으면 ❌ 대시보드로.
2. **지금 조치하지 않으면 상황이 나빠지는가?** — 아니면 SEV를 낮춘다(SEV3).
3. **자동으로 복구되는가?** (재시도·재기동으로 알아서 낫나) — 그렇다면 ❌ 또는 self-heal 후보.
4. **이미 상위 알림이 이 상황을 포함하는가?** (예: 노드 down이면 그 노드의 GPU 알림은 잉여) — 그렇다면 **inhibition**으로 뮤트, 별도 알림 금지.

> **KEIwi 함정 — no-data ≠ down.** data01/02는 수집 대상이 아니므로(설계된 no-data) **절대 알림 대상이 아니다.** 알림 셀렉터는 반드시 수집 노드(data03/04/05)로 한정한다. (헌장 US4 정직성)

---

## 3. KEIwi 알림 카탈로그 (v1 — 무엇에 알릴지)

각 항목: 신호 · 조건(개념) · 지속 · SEV · runbook · 왜 actionable. 실제 PromQL·임계는 구현 시 규칙 파일에 확정(이 표가 계약).

> ⚠️ **셀렉터 주의(구현):** 라벨이 job마다 다르다 — node/dcgm=`instance`(ip:port), gpu-model/port=`node`. "수집노드 한정(data03/04/05)"은 job별 셀렉터로 각각 명시한다.

### 3.0 알림 시스템 자기감시 (Dead man's switch) — ⚠️ 최우선 (critic C1)
**전 알림 스택(Prometheus·Alertmanager·ntfy·cloudflared)이 data05 단일 호스트에 있다 → data05가 죽으면 그 죽음을 알릴 주체도 함께 죽는다(SPOF).** 이 장치 없이는 아래 카탈로그 전체가 무의미. **알림 시스템 "밖"에서** 침묵을 감지하는 게 다른 무엇보다 먼저다.

| # | 알림 | 방식 | SEV |
|---|---|---|---|
| W1 | **Watchdog(상시 발화)** | Alertmanager `Watchdog`를 항상 firing → **data05 밖 관찰자**가 "N분간 heartbeat 없음"이면 경보 | **1** |

**egress 0 하 관찰자(택1, §9 미해결질문):**
- (권장) **2차 노드 관찰자** — data03/04에 경량 heartbeat 수신기(healthchecks self-host/스크립트) + 독립 푸시 경로. data05 Alertmanager가 주기 ping, 끊기면 2차 노드가 SRE에 알림. **진정한 egress 0.**
- (대안) **외부 heartbeat 예외** — 내용 없는 liveness ping만 외부(healthchecks.io 등)로. 데이터 유출 0이라 egress 0의 **명시적 예외 1건**으로 승인·문서화.
- 보조: Prometheus TSDB 자기건강(`prometheus_tsdb_wal_corruptions_total`·스크랩 실패율)·Alertmanager 전송실패. 단 data05 내부라 W1 외부 관찰자가 상위 안전망.

### 3.1 가용성 (있어야 산다)
| # | 알림 | 조건 | for | SEV | runbook / 조치 |
|---|---|---|---|---|---|
| A1 | **노드 down** | `up{job=~"node|dcgm",instance=~"data03/04/05"} == 0` | 2m | **1** | node-onboarding §검증·전원/네트워크·터널 확인 |
| A2 | **SSH 터널 down (data04)** | data04 exporter 타깃 일괄 down **AND** data04 IP(192.168.1.104) **blackbox ICMP는 OK**(같은 서브넷 — 터널 밖 직접 경로) | 2m | **1** | `systemctl restart keiwi-tunnel-data04`. *blackbox 선행(T02b). ICMP OK가 A1(진짜 down)과 구분 — A1엔 inhibit 안 함* |
| A3 | **exporter down(개별)** | 노드는 up인데 특정 exporter 타깃만 down | 5m | 2 | 해당 서비스 재기동. *A1/A2에 inhibit* |
| A4 | **vLLM 중단** | blackbox `/health` 실패(어시스턴트 엔진) | 2m | **1** | vLLM 서비스 로그·재기동. 어시스턴트 무력화 |
| A5 | **콘솔/Grafana/OpenSearch 응답 없음** | blackbox `probe_success==0` | 2m | 1(콘솔·Grafana) / 2(OS·Logstash) | 컨테이너·포트·Cloudflare 확인 |

### 3.2 GPU 하드웨어 건강 (핵심 자산 — 조용히 학습 오염)
| # | 알림 | 조건 | for | SEV | 조치 |
|---|---|---|---|---|---|
| G1 | **XID 에러** | `increase(DCGM_FI_DEV_XID_ERRORS[10m]) > 0` | — | **1** | XID 코드 조회(예 48=DBE→GPU 교체 검토)·작업 중단 판단 |
| G2 | **ECC DBE / remapped-row 실패** | 더블비트 ECC 또는 row remap 실패 증가 | — | **1** | VRAM 불안정 — 해당 GPU 격리·교체 검토 |
| G3 | **써멀 스로틀 지속** | `rate(DCGM_FI_DEV_THERMAL_VIOLATION[5m]) > 0` | 10m | 2 | 냉각·먼지·팬 확인. 성능 저하 원인 |
| G4 | **GPU 과열** | `DCGM_FI_DEV_GPU_TEMP > 85` | 5m | 2 | 부하·냉각 확인 |

> **XID 분기(critic M4):** 모든 XID를 SEV1로 하면 야간 노이즈 — 일부는 앱-레벨(예 13/31 사용자 프로그램 오류)이다. **치명 XID만 SEV1**(48 DBE·79 fallen off bus·74 NVLink·92 등 HW), 앱-레벨 XID는 SEV2. 화이트리스트로 분기. 온도 85는 A40/RTX6000 스로틀 포인트가 달라 카드별 파라미터화(또는 G3 스로틀에 흡수) 권장.

### 3.3 자원 포화 (곧 쓰러진다)
| # | 알림 | 조건 | for | SEV | 조치 |
|---|---|---|---|---|---|
| R1 | **디스크 임박** | 여유 < 5% | 5m | **1** | 로그·모델·캐시 정리. OpenSearch ISM 확인 |
| R2 | **디스크 경고** | 여유 < 15% | 30m | 2 | 정리 계획 |
| R3 | **메모리 부족** | MemAvailable < 10% | 10m | 2 | 프로세스 확인·OOM 위험 |

### 3.4 vLLM 추론 SLO (도그푸딩 — 느려지면 SRE 본인이 불편)
| # | 알림 | 조건 | for | SEV | 조치(결정매트릭스) |
|---|---|---|---|---|---|
| V1 | **TTFT 초과** | p95 TTFT > 3s | 10m | 2 | 큐↑=부하안정화 / 큐정상=prefill·throttle 점검 |
| V2 | **KV캐시 압박** | `increase(preemptions_total[10m]) > 0 AND (p95 TTFT > 3s OR num_requests_waiting 높음)` | 10m | 2 | max_num_seqs·max_num_batched_tokens 튜닝 |

> **v1=임계 기반(critic M7):** 위 표(=계약)는 단순 임계+for. §4-5의 "SLO multi-window burn-rate"는 error budget이 정의되는 #10(vLLM SLO)/#7(Sloth) **이후 단계**다. v1에서 §3.4는 임계, burn-rate 아님(문서 모순 해소). vLLM `:metrics` 스크레이프가 데이터 전제(§9).

### 3.5 로그 신호 (근본원인 조기 발견)
| # | 알림 | 조건 | for | SEV | 조치 |
|---|---|---|---|---|---|
| L1 | **에러율 급증** | 노드·category별 error 수가 직전 1h 베이스라인 대비 급증(OpenSearch 이상탐지 RCF) | — | 2 | Logs 워크벤치에서 host·시간 프리필터 → RAG 진단 |

### 3.6 위생·추세 (기록)
| # | 알림 | 조건 | SEV | 조치 |
|---|---|---|---|---|
| H1 | **TLS 인증서 만료 임박** | 만료 < 14d | 3 | 갱신 |
| H2 | **유휴/좀비 GPU** | VRAM 점유 + util≈0 지속(30m, #9 구현 후) | 3 | **넛지만** — 점유자에게 정리 요청. 자동 kill 금지(§11) |

### 3.7 스택 자기건강 (침묵 실패 방지 — critic M1/M2/M3/M6)
관측 스택 자체가 조용히 멈추면 "초록인데 죽음". 헌장 §15(OOM·runaway) 포함.
| # | 알림 | 조건 | for | SEV | 조치 |
|---|---|---|---|---|---|
| S1 | **로그 인입 중단** | `keiwi-logs-*` 최근 인입 시각이 정체(신선도) | 10m | 2 | Filebeat/Logstash 확인. *L1 로그진단 무력화* |
| S2 | **Logstash 정체/다운** | 파이프라인 이벤트 정체 또는 `:5044` down | 5m | 2 | Logstash 재기동·백프레셔 |
| S3 | **OpenSearch 상태** | status=red 또는 디스크 watermark 초과 또는 ISM 실패 | 5m | 1(red)/2 | 샤드·디스크·ISM 확인 |
| S4 | **OOM-kill / runaway**(§15) | journald OOM-killer 이벤트 또는 프로세스 비정상 종료 | — | 2 | 원인 프로세스·메모리 확인 |
| S5 | **시계 드리프트** | node 시계 편차 초과 | 10m | 3 | NTP 동기(로그 상관 오류 유발) |

> 카탈로그는 **최소 세트**다. "혹시 몰라" 항목을 늘리지 않는다. 새 항목은 §2 체크리스트를 통과해야 추가.

---

## 4. 노이즈 억제 — "쓸모없는 알림이 쏟아진다"를 막는 장치

사용자 최대 우려. 5중 방어:

1. **for-duration(지속성)** — 위 카탈로그의 `for` 열. 순간 스파이크 무시.
2. **grouping·dedup** — 같은 알림을 10~15분 창으로 묶어 한 번만. 동시 다발 시 요약.
3. **inhibition(억제)** — **상위 장애가 하위 알림을 자동 뮤트.** 라벨 기반(job·node)으로 설계.
   - 노드 down(A1) → 그 노드의 G1~G4·R1~R3·A3 뮤트(A4 vLLM은 현재 data05 전용 — `prometheus.yml` 확장 시 셀렉터 재작업).
   - 터널 down(A2) → data04의 A3·exporter 알림 뮤트.
   - **OpenSearch down(S3) → L1(로그 에러율)·S1(인입) 뮤트** — 데이터 소스 상실 시 그 위 알림은 무의미.
   - → "노드 하나 죽었는데 알림 20개" 방지.
4. **silence(침묵)** — **계획 정비 중 수동 뮤트.** 노드 온보딩·재부팅·GPU 드라이버 설치 시 해당 노드/시간 침묵. (온보딩 런북에 "silence 걸기" 단계 추가)
5. **SLO는 multi-window burn-rate** — vLLM SLO 알림은 순간값이 아니라 error budget 소진 속도로(빠른 소진=SEV1급, 느린 소진=티켓). 순간 소음 근본 차단.

추가 규칙:
- **actionable 아니면 삭제**(§0-2). runbook 없는 알림은 머지 금지.
- **야간 라우팅** — 업무 외 시간엔 SEV1만 폰. SEV2는 아침 큐로.

---

## 5. 채널 라우팅 (기준이 정해지면 채널은 따라온다)

| SEV | 채널 | 도구(egress 0) |
|---|---|---|
| **SEV1** | 폰 푸시(즉시) | **self-host ntfy/Gotify**(Cloudflare 터널로 폰 도달, 내용 외부 유출 0). Telegram은 내용이 외부로 나가 §egress 0 위반 — 예외만 |
| **SEV2** | 콘솔 인박스 / 사내 채팅 | Alertmanager → 콘솔 수신 웹훅 |
| **SEV3** | 이메일 다이제스트(주간) / 로그 | 사내 SMTP 있을 때만. 없으면 콘솔 기록 |

- **이메일이 주 채널이 아닌 이유**: 1인 SRE는 메일함을 실시간으로 안 본다 → SEV1엔 부적합. SEV3 다이제스트·감사기록 용도로만.
- 라우팅 트리는 라벨(severity·node·category)로. owner 필드(#5 CMDB)가 생기면 책임자 라우팅(#13)으로 확장.

---

## 6. 알림 수명주기 — 거버넌스(공식 관리 시스템 요건)

1. **신규 알림 = PR로 제안**(규칙 파일 `infra/monitoring/`) → §2 체크리스트·runbook 첨부 확인 → 리뷰 → merge → 사람이 라이브 반영(§11).
2. **모든 알림에 필수 애너테이션**: `runbook_url` + 패널 딥링크(`__dashboardUid__`/`__panelId__`). **없으면 머지 금지.**
3. **주간 알림 리뷰**: firing이 잦은데(주 10+) **조치를 못 만든 알림 = 임계 상향 또는 삭제 후보.** 콘솔이 "알림→조치 전환율"을 계측해 프루닝 후보 제시.
4. **포스트모템 연결**: SEV1은 무비난 포스트모템(#4) 작성 → 조치항목을 runbook/규칙으로 피드백(학습 루프).

---

## 7. 구현 매핑 (참고 — 정책 확정 후)

- **엔진**: Alertmanager(Prometheus 옆 컨테이너 1개) — 또는 **1차는 Grafana 통합 알림**(이미 배포됨, 별도 컨테이너 불요)으로 시작 가능.
- **규칙**: `infra/monitoring/alerts/*.yml`에 커밋(§11). SLO 규칙은 Sloth이 생성(#7).
- **알림 발화**: self-host ntfy 브릿지(SEV1) + 콘솔 웹훅(SEV2) + SMTP(SEV3).
- **DCGM 헬스 필드**(G1/G2): custom metrics csv 확장 필요(#1) — 규칙의 선행.

## 8. v1 스코프 아웃 (명시적 — 암묵 누락 금지, critic M5)
- **사용자 귀속 알림/이메일(헌장 M5 flagship)** — v1은 SRE-facing만. 연구원 귀속 넛지·책임자 라우팅은 owner CMDB(#5)+#13 이후. (H2 유휴 넛지는 초안 생성만)
- **SLO burn-rate 알림** — #7(Sloth)/#10(vLLM SLO) 이후. v1은 임계 기반.

## 9. 미해결 질문 (착수 전 확인 — critic Open Questions)
- SRE **폰 OS(iOS/Android)?** — ntfy 셀프호스트 폰 도달성·egress 0 실현 판정.
- **data04로 ICMP를 ufw가 허용**하나? — A2 blackbox ICMP 성립 조건.
- **data03 DCGM 실제 기동?**(`up{job="dcgm-exporter",instance="192.168.1.103:9400"}==1`) — 아니면 수집노드 내부 no-data로 A1/A3 오발화.
- **vLLM `/metrics` 스크랩 여부** — V1/V2 데이터 전제(#10).
- **W1 관찰자** — 2차 노드(data03/04) vs 외부 heartbeat 예외, 어느 쪽으로 갈지 결정.
- **L1 최소 이벤트 하한** — 저트래픽 category에서 3→9건 오탐 방지 절대 임계.

## Tasks
- [ ] T01 정책 확정(§1 SEV·§3 카탈로그·§5 채널) — §9 미해결질문 답변 후 사용자 승인
- [ ] T02 DCGM 헬스 필드 확장(#1) — G1/G2 데이터 전제
- [ ] **T02b blackbox_exporter 배포**(A2/A4/A5 선행) — ICMP(data04)·HTTP(vLLM /health·콘솔·Grafana·OpenSearch·터널)
- [ ] **T02c Dead man's switch(W1)** — Alertmanager Watchdog + 2차 노드 관찰자(또는 외부 heartbeat 예외 승인)
- [ ] T03 알림 규칙 v1(A1~A5·G1~G4·R1~R3·**S1~S5**) + runbook_url — `infra/monitoring/alerts/`
- [ ] T04 Alertmanager(또는 Grafana 알림) + **라벨 기반 inhibition**/silence + self-host ntfy(SEV1)
- [ ] T05 vLLM :metrics 스크레이프 + V1/V2 + SLO(#7/#10)
- [ ] T06 [server] 사람 적용 + **watchdog(W1) 침묵검증** + 야간 SEV1 폰 푸시 실검증 + 로그중단(S1) 검증

# 자동 조치 (Auto-Remediation) — SPEC

> 2026-08-04. 상태: **초안**. 권위: 헌장(§11 생성·사람 적용 · §12 라이브 직접수정 금지 · §I-1 온프레미스 · §13 시크릿 레포 밖 · §15 노이즈 최소 · §16 멱등). 배경·근거·비교표는 [README](./README.md).
>
> **이 문서가 "무엇을·어떤 조건에서·어떻게 실행하는가"의 단일 기준.** 단, 임계·인자·티어의 정본(SoT)은
> 각각 규칙 파일([`alert-rules.yaml`](../../infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml))과
> allowlist YAML(§4.4)·런북 frontmatter(§2.3)다. 표와 파일이 어긋나면 **파일이 아니라 이 스펙을
> 먼저 고친다**(§7 SDD).
>
> 설계 원칙 한 줄: **감지는 통계(alerting SoT), 진단은 LLM(제안), 실행은 결정론(런북), 승인은 사람(클릭).**

---

## 0. 전제와 불변 규칙 (모든 레벨에 선행)

1. **LLM은 생성만, 상태 변경 0.** L1~L3 어디서도 LLM 프로세스는 프로덕션에 write 권한이 없다. 진단(읽기)과 실행(쓰기) 권한을 **프로세스 수준에서 분리**한다(프롬프트 인젝션 방어 — 로그 텍스트에 심긴 지시가 tool 실행을 유도할 수 없게).
2. **LLM은 명령을 짓지 않고 고른다.** 산출은 `runbook_id` + 검증된 인자(엄격 JSON 스키마). 자유형 셸/명령 문자열 생성 금지.
3. **근거 없으면 조치 없음.** 런북 매칭·검색 신뢰도가 임계 미만이면 제안·버튼을 **숨기고** "매뉴얼 없음 — 진단만" 반환. 신뢰도 점수는 **자동 강등에만** 쓰고 자동 승격엔 쓰지 않는다(캘리브레이션 불신).
4. **모든 조치는 멱등(§16)·가역.** 롤백 스크립트를 못 쓰는 조치는 애초에 자동경로 밖(Tier0).
5. **불변 감사.** 제안·근거번호·승인자·실행·결과·롤백을 OpenSearch `keiwi-remediation-*`에 남긴다. 1인 운영의 유일한 사후검증 근거.

---

## 1. 정답형 인시던트 카탈로그 — 무엇을 대상으로 하나

`specs/alerting`의 라이브 9규칙을 **닫힌 카테고리**로 고정한다(RCACopilot: 열린 생성 대신 닫힌 분류가
정확도 0.766까지). LLM은 이 카테고리 중 하나로 **분류**만 하고, 카테고리마다 런북이 1:1로 매핑된다.

| 알림(alerting SoT) | 정답형? | 조치 성격 | 가역/멱등 | blast | **최대 도달 레벨** |
|---|---|---|---|---|---|
| **LogIngestStalled** | 예 | 수집기 재시작(logstash/filebeat) | 가역·멱등 | 저(관측만) | **L3 후보** |
| **DiskUsageHigh** | 예 | 화이트리스트 경로 tmp·journal·apt 캐시 정리 | 가역(정리는 되돌림 불가지만 대상이 재생성 캐시)·멱등 | 저 | **L3 후보(정리 대상 화이트리스트 한정)** |
| (고아 프로세스 포트 점유) | 예 | 알려진 고아 PID kill(exporter 좀비) | 가역(재기동)·멱등 | 저~중 | **L2**(초기), 이력 후 L3 검토 |
| **DiskFillPredicted** | 부분 | 위 정리 + 통보 | — | 저 | L2(정리) + L0(통보) |
| **OomKillOccurred** | 아니오 | 원인 프로세스는 연구자 것 | **비가역**(데이터) | 고 | **L0/L1**(통보·제안까지) |
| **GpuXidErrorNew** | 아니오 | 드라이버/재부팅 | **비가역** | 고 | **L0/L1** |
| **SmartHealthFailed** | 아니오 | 물리 디스크 교체 | **비가역** | 고 | **L0/L1**(교체 티켓) |
| **NodeDown** | 아니오 | 물리·전원·네트워크 | 비가역·불명 | 최고 | **L0** |
| **GpuTempHigh / MemoryLow** | 아니오 | 부하 조정(연구자 판단) | — | 고 | **L0** |

> **핵심: 라이브 9규칙 중 L3(자동) 후보는 2~3개뿐이다.** 자동화 커버리지는 좁다. 5노드·1인·연구서버에선
> **안전이 커버리지보다 우선**이고, 좁은 화이트리스트가 정직한 상한이다(README §2 STCLab 40%).

---

## 2. L1 — RAG over Runbooks (조치 제안)

### 2.1 흐름

```
알림/조사 패키지(aiops 2-4)  →  vLLM 분류(§1 카테고리)  →  OpenSearch BM25 런북 검색
   →  근거번호 강제 + 근거-조치 정합 검증(§2.4)  →  [제안 답글: 원인 후보 + runbook_id + 명령 블록 + 근거번호]
   →  (매칭 신뢰도 < 임계면 "매뉴얼 없음 — 진단만")
```

- 실행 기능 **없음**. 사람이 명령을 복붙한다. 헌장 §11/§12와 무충돌(순수 생성).
- 자유 텍스트가 아니라 **닫힌 카테고리 + 이름 붙은 런북 선택**. LLM 산출은 `{category, runbook_id, confidence, citations[]}` JSON(엄격 스키마).

### 2.2 코퍼스 = `docs/runbooks/`

기존 런북 3종(log-ingestion-stopped · rsyslog-omfile-flood · node-onboarding) + 정답형 6종을 추가한다.
각 런북은 **탐색 제외 규칙**과 **정확한 명령 블록**을 담아 30B의 좁은 탐색공간을 만든다(STCLab: 런북이
모델보다 품질 이득 큼).

### 2.3 런북 frontmatter (staleness 방어)

`assistant/spec.md:37`이 이미 예고한 "런북 frontmatter"를 정식화한다. 모든 런북 첫머리에:

```yaml
---
runbook_id: log-ingestion-stopped        # kebab, alertname과 매핑
alert_match: [LogIngestStalled]           # 이 런북을 트리거하는 alertname
tier: 2                                    # 도달 가능 최대 레벨(§1)
last_verified: 2026-07-30                  # 이 날짜 이후면 stale 경고
owner: mooner92
reversible: true
idempotent: true
actions:                                   # L2/L3가 참조하는 이름 붙은 조치
  - id: restart-logstash
    command_ref: remediation/restart-logstash.sh   # repo의 리뷰된 스크립트
    dry_run: true
    rollback_ref: remediation/rollback/restart-logstash.sh
---
```

- **`last_verified`가 N일(기본 180) 초과면** L1 제안에 "⚠️ stale 런북" 배지를 달고 L2/L3 자동경로에서 **강등**(제안까지만). stale 런북을 자신있게 인용하는 것(§8 anti-pattern)을 구조적으로 막는다.
- `command_ref`는 **repo에 사람이 작성·PR 리뷰한 스크립트**를 가리킨다. LLM은 이 id만 고른다.

### 2.4 환각 방어 (기존 서버검증 인용의 확장)

1. **매뉴얼 없으면 "없음".** BM25 top-1 스코어 < 임계 또는 `alert_match` 불일치면 조치 제안 금지, 진단만.
2. **근거번호 강제.** 모든 제안에 런북 doc_id + 인용 절을 붙이고 기존 검증기로 서버 검증.
3. **근거-조치 정합 검증기(신규).** LLM이 고른 `runbook_id`/`action.id`가 **인용한 런북에 실제 존재하는지** 코드로 확인. 없으면 제안 폐기(환각 차단).
4. **다중 후보 상충 시 강등.** 카테고리 후보가 2개 이상 신뢰도 근접이면 자동경로 끄고 사람 라우팅(exception-based).

### 2.5 AC (기계 검증)

- **AC-L1-1** `scripts/check-runbook-frontmatter.sh`: 모든 `docs/runbooks/*.md`에 필수 frontmatter 키 7개 존재 + `alert_match`의 모든 값이 `alert-rules.yaml`의 실재 alertname → 누락 시 exit 1. `npm run verify`에 배선(§9).
- **AC-L1-2** 근거-조치 정합: 합성 입력(런북에 없는 `action.id`를 낸 LLM 응답 모킹)에서 제안이 **폐기**되고 "매뉴얼 없음" 반환. 단위 테스트.
- **AC-L1-3** stale 강등: `last_verified`를 200일 과거로 세팅한 런북은 제안에 stale 배지 + `tier` 관계없이 자동경로 후보에서 제외됨. 단위 테스트.
- **AC-L1-4** 매뉴얼 없음 경로: `alert_match` 없는 알림 입력 시 조치 블록 0개, 진단 텍스트만. 단위 테스트.

---

## 3. L2 — 승인 후 실행 (ChatOps HITL)

### 3.1 흐름

```
L1 제안  →  [dry-run diff 게시]  →  Slack [승인]/[거부] 버튼 (또는 CLI 폴백)
   →  사람 승인  →  결정론 remediation-worker가 runbook action 실행  →  결과·검증을 스레드 회신·감사기록
```

- **사람의 클릭 = 헌장 "사람이 적용"**(§11). LLM은 트리거하지 않는다.
- 실행 주체는 **LLM이 아니라 결정론 최소권한 워커**. 워커는 `runbook_id`+검증 인자만 받아 repo의 리뷰된 `command_ref`를 실행.

### 3.2 승인 게이트의 형해화 방지

승인 피로로 습관적 승인이 되면 human-in-the-loop이 무너진다(§8). 승인 카드에 **강제 표기**:
- **무엇을**(runbook_id + action) · **왜**(근거번호·인용 절) · **영향범위**(대상 노드·서비스) · **롤백 방법**(rollback_ref) · **dry-run diff 요약**(적용 시 바뀌는 것).
- 고위험은 2단계 확인 또는 Tier0 강등.

### 3.3 승인 채널 이중화 (§C3/C4)

- 1차: Slack 인터랙티브 버튼(egress 예외, ADR-0018 편승). 나가는 필드 화이트리스트(alertname/severity/node/runbook_id만 — `user`·`pid`·`cmdline` 금지).
- **폴백: CLI 승인**(`remctl approve <proposal_id>`) — Slack 장애 시에도 승인 가능. **control plane은 관제 대상 노드 밖**(data05 터널 런북을 data05에서 실행 금지 — Facebook 2021).

### 3.4 워커 요구사항

- 최소권한(화이트리스트 런북만) · 서브프로세스 timeout · 입력 검증 · **부분 실패 시 stale 결과 노출 금지**.
- 실행 전 **precondition assertion**(런북에 정의) + **dry-run** 선행. 실행 후 **validate**(성공 텔레메트리 확인), 실패 시 rollback 또는 에스컬레이션.

### 3.5 AC

- **AC-L2-1** 승인 없이는 실행 0: 승인 이벤트 없이 워커 큐에 넣으면 실행 거부. 통합 테스트.
- **AC-L2-2** 승인 카드 필수 필드 5종(무엇/왜/영향/롤백/diff) 누락 시 카드 게시 실패. 단위 테스트.
- **AC-L2-3** CLI 폴백: Slack 경로를 모킹 차단해도 `remctl approve`로 실행이 트리거됨. 통합 테스트.
- **AC-L2-4** 감사: 1회 실행마다 `keiwi-remediation-*`에 proposal_id·approver·runbook·result·rollback 필드 존재. 통합 테스트.
- **AC-L2-5** 유출 필드 화이트리스트: Slack payload에 `user`/`pid`/`cmdline`/`instance` 키가 **없음**. 계약 테스트.

---

## 4. L3 — 사전승인 안전조치 자동 (ADR-0024 게이트)

> [!WARNING]
> L3는 사람 클릭 없이 결정론 워커가 라이브를 바꾼다 — **진짜 새 결정**이다. **ADR-0024 승인 전엔
> 코드로 존재해선 안 된다.** 후보별로 L2에서 **N회(기본 20) 무사고** 이력이 쌓인 뒤에만 승격(earned autonomy).

### 4.1 4조건 — 모두 만족해야 L3 후보

1. **정답형** — 매뉴얼에 결정론적 정답이 있고 카테고리가 단일(§1).
2. **저위험(low blast)** — 실패해도 영향이 국소적. 5노드=20%이므로 **노드급 조치는 대부분 자동 실격**.
3. **멱등** — 반복 실행해도 동일 결과(§16).
4. **롤백가능** — 대칭 rollback 스크립트가 존재. 못 쓰면 실격.

→ 현재 통과 후보: **LogIngestStalled 재시작**, **DiskUsageHigh 화이트리스트 경로 정리**(journal vacuum·apt clean — T0-7 실측: journal 848M→200M). 그 외는 L2 이하.

### 4.2 폐루프 + dry-run/rollback

```
detect(alerting) → evaluate(4조건+정책) → pre-check(precondition·동시성·발동이력) →
   dry-run(plan diff) → execute(결정론 워커) → validate(텔레메트리) → [실패 시 auto-rollback + 에스컬레이션]
```

### 4.3 가드레일 (LLM 밖 결정론 코드, fail-closed)

| 가드레일 | 값(초기·보수적) | 근거 |
|---|---|---|
| 동시성 | **1**(2노드 동시 조치 금지) | AWS S3 2017 blast-radius |
| 최소 가동노드 바닥 | 용량이 바닥 밑으로 내려가는 조치 차단 | AWS S3 min-capacity floor |
| 노드당 일일 액션 상한 | **≤ N**(채널당 자동 액션 >20/day면 사람 주의 60~80% 하락) | 알림 피로 |
| 인시던트당 시도 | **≤ 2** 후 정지 + 사람 호출 | 진동 방지 |
| 쿨다운/백오프 | 지수 백오프 | 재시작 폭풍 방지 |
| **발동 메모리 서킷브레이커** | OpenSearch에 "이 런북이 이 노드에 최근 N일 몇 회?" 조회 → 임계 초과 시 **자동실행 대신 근본원인 조사** | rubixkube: 40회/일 재시작이 11주 누수 은폐 |
| **글로벌 break-glass** | 자동경로 즉시 정지 kill-switch(아웃오브밴드) | 1인 운영의 유일한 브레이크 |

### 4.4 정책을 코드로 (경량 allowlist, 풀 OPA 아님)

`infra/remediation/policy.yaml` — 리뷰된 allowlist(PR = §11 정합):

```yaml
- runbook_id: log-ingestion-stopped
  auto_eligible: true            # L3 허용
  requires_earned_runs: 20       # L2 무사고 20회 후 승격
  time_window: "any"
  max_nodes_per_day: 3
- runbook_id: disk-usage-high
  auto_eligible: true
  allowed_paths: [/tmp, /var/log/journal, /var/cache/apt]   # 화이트리스트만
  requires_earned_runs: 20
```

정책 위반 시 **fail-closed**(막는 쪽). auto_eligible=false거나 미등록이면 최대 L2.

### 4.5 L3에서 절대 하지 않는 것 (Tier0 — 영영 사람 전용)

- **재부팅**(드라이버 mismatch — 비가역·전 워크로드 중단)
- **디스크 물리 교체**(SMART 열화 — 물리)
- **커널/드라이버 변경**(무인 업그레이드가 G0-1 사고의 직접 원인)
- **데이터 손실 위험 서비스 종료**
- **연구자 프로세스 kill**(data01 sunakang Jupyter RSS 291GB · OOM 원인 프로세스 — 재현 불가 데이터, §11 명시)
- **다단계 시퀀스**(MicroRemed: 다단계 복구 오류율 비지도 배포 금지 수준)
- 신뢰도가 아무리 높아도 위 항목은 Tier0 고정(Prophet: high-blast+비가역=manual).

### 4.6 AC

- **AC-L3-1** 4조건 게이트: `reversible:false` 또는 `idempotent:false` 런북은 policy 로더가 auto_eligible로 못 올림(로드 실패). 단위 테스트.
- **AC-L3-2** earned-autonomy: `keiwi-remediation-*`의 무사고 L2 실행 < requires_earned_runs면 L3 실행 거부, L2로 강등. 통합 테스트.
- **AC-L3-3** 동시성 1: 노드 A 조치 진행 중 노드 B 조치 요청은 큐 대기(동시 실행 0). 통합 테스트.
- **AC-L3-4** 서킷브레이커: 같은 런북이 같은 노드에 임계 초과 발동 이력이면 실행 대신 "조사" 전환. 통합 테스트.
- **AC-L3-5** dry-run 선행 + rollback 존재: rollback_ref 없는 action은 L3 실행 거부. 단위 테스트.
- **AC-L3-6** break-glass: kill-switch on이면 모든 자동경로 즉시 정지(신규 실행 0). 통합 테스트.
- **AC-L3-7** allowed_paths 강제: disk-usage 런북이 화이트리스트 밖 경로를 인자로 받으면 fail-closed 거부. 단위 테스트.
- **AC-L3-8** Tier0 하드코딩: §4.5 목록에 해당하는 조치는 policy.yaml에 auto_eligible로 등록 자체가 불가(로더가 거부). 단위 테스트.

---

## 5. 로컬 30B 한계 반영 (설계 제약)

- **자율 ReAct 다단계 루프 금지.** 30B는 다단계 오케스트레이션 신뢰 범주 밖(§README 2). 단일 구조화 제안만.
- **생성 아니라 선택.** LLM 산출은 엄격 JSON 스키마(`category`/`runbook_id`/`action.id`/`confidence`/`citations`) + 검증기. KubePlaybook식 명령 생성 리스크를 회피.
- **모델 하한선.** 에이전틱 판단에 7~14B로 다운사이징 금지(STCLab: 7B 툴콜 실패·9B thinking이 루프 파괴·14B 콜드스타트 불안정). GPU 압박 시 **자동경로를 끄고 진단 전용(L0)으로 격하**하는 편이 낫다.
- **신뢰도는 강등 전용.** 자동 승격에 쓰지 않는다(캘리브레이션 불신).

---

## 6. 실패 사례 코퍼스 — 반면교사 (설계에 직접 반영)

| 사례 | 무슨 일 | KEIwi 반영 |
|---|---|---|
| **AWS S3 2017** | 용량제거 도구가 오타로 과다 노드 제거 → 4시간, 복구 자동화마저 S3 의존 | 동시성 1 · 최소노드 바닥 · 삭제형은 화이트리스트 경로만 |
| **AWS US-EAST-1 2025-10** | DynamoDB DNS Enactor 경쟁조건 → 정리 자동화가 DNS 전삭제 → ~15h | 전역·비가역 자동화 금지, 정리는 국소 화이트리스트만 |
| **Knight Capital 2012** | 배포 자동화가 구코드 경로와 상호작용 → 45분 $440M | 독립 서킷브레이커 · 실행 주체와 분리된 kill-switch |
| **Facebook 2021** | 복구 도구가 사라진 네트워크 안에 있어 접근 불가 | control plane 아웃오브밴드(§C4) |
| **Clerk 2026-02** | 정기 auto-analyze가 쿼리플랜 플립 → 트래픽 95% 에러 | "기술적으로 유효한" 자동조치도 운영적으로 치명적 가능 → dry-run·canary |
| **Google SRE(위성)** | decommission 자동화가 전 디스크 삭제 | 멱등·sanity check·상한 |
| **rubixkube** | 메모리 없는 복구가 파드 40회/일 재시작, 11주 누수 은폐 | 발동 메모리 서킷브레이커(§4.3) |
| **k8sgpt-operator** | rollback TODO인 채 auto-patch 출시 | 롤백 없는 조치는 자동경로 밖(§0-4) |

---

## 7. 스코프 아웃 / SoT 경계

- 진단·이상탐지·다이제스트 = `assistant`·`sre-addons/aiops-beyond-chat.md`. 알림 규칙·임계 = `specs/alerting`. 이 스펙은 **그 위의 제안·승인·실행 계층만**.
- L4·자유형 명령·다단계 자율 루프·비가역 조치 자동화 = 하지 않음(README §7).

---

## 8. 위험 등록부 (anti-pattern → 가드)

| 위험 | 가드 | AC |
|---|---|---|
| 승인 게이트 형해화(rubber-stamp) | 승인 카드 5필드 강제 + 고위험 2단계 | AC-L2-2 |
| 진단정확도≠복구유효성(§README 2) | 신뢰도 강등 + 매뉴얼 없으면 조치 없음 | AC-L1-2/4 |
| 해석 환각(71%) | 근거-조치 정합 검증 + 근거번호 강제 | AC-L1-2 |
| blast-radius 폭발 | 동시성 1 · 최소노드 바닥 · Tier0 | AC-L3-3/8 |
| 연쇄/재시작 폭풍 | 발동 메모리 서킷브레이커 · 쿨다운 · 시도≤2 | AC-L3-4 |
| stale 런북 자신있게 인용 | last_verified 강등 | AC-L1-3 |
| 프롬프트 인젝션 | 진단(읽기)·실행(쓰기) 프로세스 분리 + 명령 생성 금지 | AC-L1-2 |
| Slack 종속 승인 불가 | CLI 폴백 · 아웃오브밴드 control plane | AC-L2-3 |
| 롤백 없는 자동 조치 | rollback_ref 없으면 L3 거부 | AC-L3-5 |

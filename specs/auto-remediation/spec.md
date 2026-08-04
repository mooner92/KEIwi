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
| **DiskUsageHigh** | 예 | 화이트리스트 회수 — journal·apt 캐시·dangling 이미지(**`/tmp` 제외**, §4.4) | 가역(정리는 되돌림 불가지만 대상이 재생성 캐시)·멱등 | 저 | **L3 후보(정리 대상 화이트리스트 한정)** |
| (고아 프로세스 포트 점유) | 예 | 알려진 고아 PID kill(exporter 좀비) | 가역(재기동)·멱등 | 저~중 | L2 목표 — **현재 런북은 tier 1**(아래 주) |
| **DiskFillPredicted** | 부분 | 위 정리 + 통보 | — | 저 | L2(정리) + L0(통보) |
| **OomKillOccurred** | 아니오 | 원인 프로세스는 연구자 것 | **비가역**(데이터) | 고 | **L0/L1**(통보·제안까지) |
| **GpuXidErrorNew** | 아니오 | 드라이버/재부팅 | **비가역** | 고 | **L0/L1** |
| **SmartHealthFailed** | 아니오 | 물리 디스크 교체 | **비가역** | 고 | **L0/L1**(교체 티켓) |
| **NodeDown** | 아니오 | 물리·전원·네트워크 | 비가역·불명 | 최고 | **L0** |
| **GpuTempHigh / MemoryLow** | 아니오 | 부하 조정(연구자 판단) | — | 고 | **L0** |

> **핵심: 라이브 9규칙 중 L3(자동) 후보는 2~3개뿐이다.** 자동화 커버리지는 좁다. 5노드·1인·연구서버에선
> **안전이 커버리지보다 우선**이고, 좁은 화이트리스트가 정직한 상한이다(README §2 STCLab 40%).

> [!NOTE] 고아 포트 점유가 표의 L2에 못 미치는 이유 [T1-3에서 발견, 2026-08-04]
> 유일한 실질 조치인 `kill`은 **오검출이 곧 남의 서비스 종료**라 `risk: high`이고, §2.3의
> tier 규칙이 그런 런북의 상한을 1로 강제한다. 이건 게이트가 과했던 것이 아니라
> **선행조건이 없다는 사실이 드러난 것**이다 — "이 pid가 고아다"를 기계가 판정할 시리즈
> (리스닝 프로세스의 실행파일 경로 ↔ 기대값 대조)가 아직 없어서, 지금 L2로 올리면
> 승인 카드에 §3.2가 요구하는 "왜"를 실을 수 없다. 그 시리즈(hardware-ops §3.9)가 배포되고
> 오검출률이 실측되면 risk를 medium으로 내리고 tier 2로 올린다(백로그 B02).
> **tier가 야심보다 낮은 것은 결함이 아니라 미충족 전제의 기록이다.**

**tier 실측 분포** [2026-08-04, 런북 16종] — `check-runbook-actions.sh`가 출력한다:
`t0=4 · t1=9 · t2=1 · t3=2` (actions 64개). 즉 **런북의 81%가 제안 이하**이고,
자동 후보는 `log-ingestion-stopped`·`disk-usage-high` 둘뿐이다. 위 표의 예측과 일치한다.

---

## 2. L1 — RAG over Runbooks (조치 제안)

> **tier의 소비자(2026-08-04 확정)**: L1 파이프라인은 `max_tier==0`이면 제안 대신
> `tier0_human_only` 진단으로 끝낸다 — tier 0 런북은 제안하지 않는다(사람 전용 조치의
> 사다리 의미론). 조치가 아예 없으면 `no_actions`가 우선한다(더 원초적 이유).

### 2.1 흐름

```
알림/조사 패키지(aiops 2-4)
   →  ① 분류: alertname이 있으면 **그대로 카테고리**(LLM 호출 0) · 없을 때만 vLLM 닫힌 분류
   →  ② 런북 선택: frontmatter `alerts` **직매칭**(결정론) · 매칭 없을 때만 로컬 BM25 폴백
   →  ③ 근거번호 강제 + 근거-조치 정합 검증(§2.4)  →  ④ [제안 답글: 원인 후보 + runbook_id
        + action_id + **런북 파일에서 읽은** 명령 블록 + 근거번호]
   →  (어느 단계든 근거가 부족하면 "매뉴얼 없음 — 진단만")
```

- 실행 기능 **없음**. 사람이 명령을 복붙한다. 헌장 §11/§12와 무충돌(순수 생성).
- 자유 텍스트가 아니라 **닫힌 카테고리 + 이름 붙은 런북·조치 선택**. LLM 산출은
  `{category, runbook_id, action_id, confidence, citations[]}` JSON(엄격 스키마).
  **명령 문자열은 LLM 산출에 없다** — 제안에 실리는 명령은 런북 `actions[].command`를
  파일에서 읽은 것이고, 모델이 내는 것은 `action_id`라는 **이름**뿐이다(§0-2).

> [!IMPORTANT] **개정 2026-08-04 — 검색보다 결정론이 먼저다.**
> 초안의 흐름은 "vLLM 분류 → OpenSearch BM25 검색"이었다. 구현하며 **순서를 뒤집었다**:
> 1. `alertname`은 alerting SoT가 만드는 **닫힌 유한 집합**이고, 런북 frontmatter `alerts:`가
>    그 집합을 담당 선언으로 이미 받는다. `check-runbooks.sh` R5/R8이 이 매핑을 **양방향으로
>    강제**한다 — 즉 기계가 지키는 계약이 이미 있다. 계약이 있는 자리에서 검색·추론을 하는 것은
>    정확도를 스스로 깎는 일이다. 그래서 alertname이 매칭되면 **분류기를 부르지 않는다**(GPU 0회·오분류 0).
> 2. **런북 코퍼스를 OpenSearch에 색인하지 않는다**(T1-4 원문에서 의도적으로 벗어난 지점).
>    문서 16편은 인덱스 서버가 필요한 규모가 아니고, 색인은 ① 라이브 상태 변경(§12) ②
>    "인덱스가 최신인가"라는 새 실패 모드 ③ relay의 pip 0·독립 배포 요건 위반을 부른다.
>    코퍼스는 같은 레포 안에 있다 — 파일에서 읽는 것이 더 정확하고 더 싸다.
>    BM25는 **모듈 안의 순수 함수**로 두고 **분류가 실패했을 때만** 돈다. 그때 내놓는 것은
>    조치가 아니라 "읽어볼 런북" 힌트(`runbook_hint`)이고, `action`·`commands`는 끝까지 비어
>    있다 — 아는 유형으로 못 묶은 사건에 조치를 고르는 것은 근거 없는 제안이기 때문이다.
>    (초기 구현은 BM25를 런북 **선택** 폴백에 뒀는데, 카테고리가 정해진 시점엔 담당 런북이
>    반드시 존재하므로 **영원히 실행되지 않는 분기**였다. 죽은 폴백은 "폴백이 있다"는 거짓
>    안전감만 남기므로 실제로 필요한 자리로 옮겼다.)
> 3. LLM이 실제로 판단하는 지점은 **조치 선택 1회**뿐이다. 30B에 단일 스키마 툴콜 1회만
>    맡기는 것이 §5의 모델 한계 제약과도 정합한다.

### 2.2 코퍼스 = `docs/runbooks/`

기존 런북 **14종**이 이미 코퍼스다(초안이 "3종"이라고 적은 것은 T0-2 시점의 수치 — 축2·축3에서
11종이 더 늘었다). 여기에 정답형 조치 절차 2종을 더해 **16종**이 됐다(T1-3):
`disk-usage-high`(화이트리스트 회수) · `orphan-port-holder`(고아 포트 점유).
각 런북은 **탐색 제외 규칙**과 **정확한 명령 블록**을 담아 30B의 좁은 탐색공간을 만든다(STCLab: 런북이
모델보다 품질 이득 큼).

> [!NOTE] 초안의 신규 6종 중 4종은 **새로 만들지 않았다.** `nvidia-driver-mismatch`·
> `oom-kill-occurred`·`smart-health-failed`·`gpu-xid-error`는 각각 기존
> `reboot-required-stale`·`memory-pressure`·`smart-health-failed`·`gpu-xid`가 이미 담당한다.
> 같은 알림에 런북이 둘이면 §2.4-4의 "다중 후보 상충"을 우리 손으로 만드는 것이라
> **중복 신설 대신 기존 런북에 `tier`·`actions`를 소급**했다.

### 2.3 런북 frontmatter — 기존 계약의 **확장** (staleness·조치 방어)

> [!IMPORTANT] 이 절은 2026-08-04에 실측 기준으로 개정됐다.
> 초안은 `runbook_id`·`alert_match` 같은 **새 키 이름**을 제안했으나, 런북 14종은 이미
> `id`·`kind`·`alerts`·`category`·`severity`·`last_verified`를 갖고 있고
> `scripts/gates/check-runbooks.sh`(R6·R6b·R8·R11)가 그것을 강제한다(축3 산출물).
> **이름 체계를 둘로 만들면 두 벌이 서로 다르게 늙는다.** 그래서 기존 키를 그대로 쓰고
> L1에 진짜 없던 두 키만 더한다: **`tier`** 와 **`actions`**.

```yaml
---
# ── 기존 계약(축3 · check-runbooks.sh가 강제) — 그대로 둔다 ──
id: log-ingestion-stopped                  # kebab = 파일 stem (R6)
kind: alert                                # alert | procedure | incident
alerts: [LogIngestStalled]                 # 이 런북이 담당한다고 선언한 alertname (R5·R8)
category: infra
severity: critical
last_verified: 2026-08-03                  # 180일 초과면 stale (R11)
# ── L1 확장(신규 · check-runbook-actions.sh가 강제) ──
tier: 3                                    # 도달 가능 **최대** 자율 레벨 0~3 (§1)
actions:                                   # LLM이 고를 수 있는 조치 화이트리스트
  - id: restart-logstash                   # kebab, 런북 안에서 유일
    title: Logstash 컨테이너 재시작
    risk: medium                           # low | medium | high
    reversible: true                       # 되돌릴 수 있는가
    idempotent: true                       # 두 번 돌려도 같은가 (§16)
    command: sudo docker restart keiwi-logstash   # 사람이 복붙할 **정확한** 명령
---
```

**`tier`의 뜻** — 이 런북의 `actions`가 도달할 수 있는 최대 자율 레벨이다. 현재 상태가 아니라
**상한 선언**이다(L2는 ADR-0023, L3는 ADR-0024 게이트 뒤).

| tier | 뜻 |
|---|---|
| **0** | 사람 전용. 어떤 자동 경로에도 오르지 않는다(재부팅·연구자 프로세스 kill 등 §4.5) |
| **1** | L1 제안까지. 실행 기능 없음 — **현재 구현 상한이 여기다** |
| **2** | L2 승인 후 실행 **후보**(ADR-0023 + policy 등재 후) |
| **3** | L3 사전승인 자동 **후보**(ADR-0024 + earned autonomy 후) |

**tier는 런북 단위이고, 최악의 action이 상한을 정한다.** `risk: high`나 `reversible: false`인
조치가 하나라도 있으면 그 런북 전체가 tier ≤ 1로 강등된다. 이것이 §4.1 4조건을 문장이 아니라
코드로 만든 지점이다(`check-runbook-actions.sh` A5).

> 그래서 조치 성격이 섞인 런북은 **쪼갠다.** `disk-pressure`(진단·연구자 데이터 협의 = tier 1)와
> `disk-usage-high`(재생성 캐시 회수만 = tier 3)를 나눈 것이 그 예다. §1이 DiskUsageHigh를
> "L3 후보(정리 대상 화이트리스트 한정)"라고 적은 그 **한정**을 파일 경계로 구현한 것이다.

**`command`는 `command_ref`가 아니다.** 초안은 repo의 리뷰된 스크립트 경로를 가리키게 했으나,
L1에는 실행기가 없고 사람이 복붙한다 — 존재하지 않는 스크립트를 가리키는 것보다 **런북 본문에
실재하는 명령**을 그대로 담는 편이 검증 가능하다. 게이트 A7이 "이 명령이 런북 본문 코드블록에
실존하는가"를 강제하므로 **문서와 화이트리스트가 갈라질 수 없다.**
`command_ref`/`dry_run`/`rollback_ref`는 실행기가 생기는 **T2-1에서** 도입한다(그때 필요해진다).

- **`last_verified`가 N일(기본 180) 초과면** L1 제안에 "⚠️ stale 런북" 배지를 달고 L2/L3 자동경로에서 **강등**(제안까지만). stale 런북을 자신있게 인용하는 것(§8 anti-pattern)을 구조적으로 막는다.
  `actions`가 비어 있지 않은 런북은 `last_verified`가 **필수**다(A10) — 검증일 없는 명령 화이트리스트는 감사할 수 없다.
- **위험 조치를 숨기지 않는다.** `sudo reboot`도 화이트리스트에 남기되 `risk: high`·
  `reversible: false`·`idempotent: false`로 정직하게 적는다. 숨기면 LLM이 같은 조치를
  **자유 텍스트로 짓게 되고**, 그러면 위험 라벨도 근거번호도 붙지 않는다(§0-2 위반).

### 2.4 환각 방어 (기존 서버검증 인용의 확장)

1. **매뉴얼 없으면 "없음".** `alerts` 직매칭이 없고 BM25 top-1도 임계 미만(또는 top-2와
   근접)이면 조치 제안 금지, 진단만. 런북은 있는데 `actions`가 비었으면 **링크만** 주고
   조치 블록은 0개다.
2. **근거번호 강제.** 근거 번호는 **서버가 매긴다**(assistant의 서버검증 인용과 같은 구조).
   모델은 번호만 참조하므로 doc_id를 날조할 수 없다. 근거번호가 0개면 제안 폐기 —
   "근거 없으면 조치 없음"(§0-3)은 문장이 아니라 검증기의 분기다.
   근거 후보는 **본문에서만** 뽑는다 — YAML 주석(`# tier — …`)은 마크다운 헤딩과 글자가
   같아서, 구분하지 않으면 형식은 옳고 내용은 무의미한 근거가 통과한다. [2026-08-04 실측]
3. **근거-조치 정합 검증기(신규).** LLM이 고른 `runbook_id`/`action_id`가 **인용한 런북에
   실제 존재하는지** 코드로 확인한다. 검증은 인메모리 코퍼스가 아니라 **디스크를 다시 읽어**
   한다(코퍼스가 낡았을 수 있다). 확인 항목: ① runbook_id가 서버가 고른 그 런북인가
   ② 그 파일이 실존하고 같은 id인가 ③ `action_id`가 화이트리스트에 있는가 ④ 제안에 실릴
   **명령이 디스크의 그 조치와 같은가** ⑤ 인용 번호가 전부 유효한가 ⑥ 각 번호의 행이
   **지금도 그 텍스트로** 있는가. 하나라도 어긋나면 제안 폐기(환각 차단).
   거절 사유에 모델 문자열을 그대로 싣지 않는다 — 환각된 `action_id`가 사유를 타고
   스레드·로그로 나가면 인젝션의 배달 경로가 하나 더 생긴다(세탁 후 인용).
4. **다중 후보 상충 시 강등.** 두 런북이 같은 alertname을 담당 선언했거나 BM25 top-1이
   top-2를 충분히 못 이기면 자동으로 고르지 않는다 — 고른 근거가 어디에도 없기 때문이다.
   사람 라우팅(exception-based).
5. **모델이 죽어도 파이프는 산다.** vLLM 연결 거부·타임아웃·스키마 밖 응답은 전부
   "매뉴얼 없음 — 진단만"으로 **우아하게** 끝난다. 모델 장애가 알림 경로를 죽이지 않는다.

### 2.5 AC (기계 검증)

- **AC-L1-1** `scripts/gates/check-runbook-actions.sh`: 모든 `docs/runbooks/*.md`가 `tier`(0~3)와 `actions` 계약을 지킨다 — 필수 6키·risk 열거·**tier↔risk 정합(A5)**·**명령 근거성(A7)**·tier≥2의 실재 alertname(A9). 위반 시 exit 1. `scripts/verify-all.sh`가 글롭으로 자동 편입하고 `ci.yml`에 명시 배선(§9 · check-ci-coverage.sh가 미배선을 잡는다). `--self-test`로 A1~A10 역증명.
  > 초안의 파일명 `scripts/check-runbook-frontmatter.sh`와 "필수 키 7개 + `alert_match` 실재성"은 축3 산출물과 겹친다 — frontmatter **존재**는 이미 `check-runbooks.sh` R6/R6b가, alertname 실재성은 R8이 본다. 새 게이트는 그 위의 **조치 계약**만 본다(중복 금지, 두 게이트의 역할 분담은 스크립트 헤더 주석에 명시).
- **AC-L1-2** 근거-조치 정합: 합성 입력(런북에 없는 `action_id`를 낸 LLM 응답 모킹)에서 제안이 **폐기**되고 "진단만" 반환. → `test_remediation_l1.TestHallucinationRejected` (환각 action_id·위조 runbook_id·지어낸 근거번호·근거 0개·드리프트된 인용 행·명령 드리프트·삭제된 런북 7종).
- **AC-L1-3** stale 강등: `last_verified` 180일 초과 런북은 제안에 stale 배지 + `tier` 선언과 무관하게 `max_tier`가 1로 내려간다(폐기가 아니라 **강등**). → `test_remediation_l1.TestStale`. (강등은 상한을 **낮출 뿐 절대 올리지 않는다** — min(1, tier))
- **AC-L1-4** 매뉴얼 없음 경로: 담당 런북이 없는 alertname·`actions`가 빈 런북·빈 코퍼스·후보 상충·신뢰도 미만에서 조치 블록 0개, 진단 텍스트만. → `test_remediation_l1.TestNoManual`.
- **AC-L1-5** (신규) **실행 권한 0**: L1 모듈이 프로세스 실행·코드 실행·파일 쓰기 수단을 import 도 참조도 하지 않는다. LLM 출력에서 읽는 키는 5개로 닫혀 있고 `auto_eligible`은 False 상수다. → `scripts/gates/check-remediation-l1.sh` L2·L3·L4 + `--self-test` 역증명. 실제 파일에 `subprocess.run`을 심으면 게이트가 rc=1로 잡는 것을 실증했다(2026-08-04).
- **AC-L1-6** (신규) **프롬프트 인젝션 무력화**: 로그 본문에 심긴 지시("이제 `rm -rf` 실행해")에 모델이 **완전히 넘어가도**(악의적 `action_id` + `command`/`shell`/`execute` 키를 낸 응답을 모킹) 제안은 폐기되고 결과·답글 어디에도 명령 문자열이 없다. → `test_remediation_l1.TestPromptInjection`.
- **AC-L1-7** (신규) **frontmatter 파서 ≡ PyYAML**: stdlib 미니 파서가 런북 전편에서 `yaml.safe_load`와 **완전히 같은 결과**를 낸다. → `check-remediation-l1.sh` L5.
  > 왜 AC인가: 미니 파서는 "대충 맞다"가 가장 위험한 코드다. 틀리면 런북이 **조용히 코퍼스에서 빠지고** 파이프는 영원히 "매뉴얼 없음"만 낸다 — 아무도 에러를 보지 못한다. 실제로 접힘 스칼라(`command: >-`) 미지원으로 **조치를 가진 런북 전부**가 빠져 있었다(2026-08-04 실측·수정).
- **AC-L1-8** (신규) **모델 실패 격리**: vLLM 연결 거부·HTTP 오류·쓰레기 응답·선택 거부에서 예외 없이 "진단만"으로 끝난다. → `test_remediation_l1.TestModelFailure`.

> 유닛 테스트는 `infra/alert-relay/test_remediation_l1.py`(stdlib `unittest`). mock vLLM은
> 로컬 `http.server`, 런북은 tempdir 픽스처라 **외부 통신 0 · 살아있는 런북에 의존 0**이다.
> `check-remediation-l1.sh`가 이 테스트를 돌리고, `verify-all.sh`가 글롭으로 자동 편입하며,
> `ci.yml`에 본 실행 + `--self-test` 두 스텝으로 배선했다(`check-ci-coverage.sh`가 미배선을 잡는다).

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
  # ⚠️ `/tmp`는 초안에 있었으나 **뺐다** [실측 2026-08-03]: data04 `/tmp` 5.1GB의 내용이
  #    미확인이고 장기 실행 잡의 스크래치가 섞인다. "관례상 임시 디렉터리"와 "이 플릿에서
  #    실제로 임시인 디렉터리"는 다르다 — 내용 감사 전까지 화이트리스트 밖이다.
  #    경로만이 아니라 **(경로, 도구) 쌍**이 화이트리스트다(런북 disk-usage-high §2).
  allowed_paths: [/var/log/journal, /var/cache/apt]         # 화이트리스트만
  requires_earned_runs: 20
```

정책 위반 시 **fail-closed**(막는 쪽). auto_eligible=false거나 미등록이면 최대 L2.

### 4.5 L3에서 절대 하지 않는 것 (Tier0 — 영영 사람 전용)

- **재부팅**(드라이버 mismatch — 비가역·전 워크로드 중단)
- **디스크 물리 교체**(SMART 열화 — 물리)
- **커널/드라이버 변경**(무인 업그레이드가 G0-1 사고의 직접 원인)
- **데이터 손실 위험 서비스 종료**
- **연구자 프로세스 kill**(data01 user1 Jupyter RSS 291GB · OOM 원인 프로세스 — 재현 불가 데이터, §11 명시)
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

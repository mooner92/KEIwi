# 자동 조치 — Tasks

> 권위: [spec.md](./spec.md) / [README](./README.md). `[x]`=완료, `[ ]`=잔여.
> **`[server]` = 사람이 적용(§11).** 표시 없는 항목은 에이전트가 레포에 산출물을 **생성**하는 것까지다.
> 크기: **S**=반나절 이내 · **M**=1~3일 · **L**=1주+.
> 순서 원칙: **L1(제안)이 가장 먼저·가장 안전** — 실행 기능이 없어 헌장·안전 위험 0. L2/L3는 ADR 게이트 뒤.

---

## P0 — 게이트 (이걸 안 하면 뒤가 성립하지 않는다)

- [ ] **T0-1** (S) `docs/decisions/0026-auto-remediation-ladder.md` — 자율 사다리 L0~L4 정의 + L1/L2 채택 + **L4 미채택 근거**(벤치마크·5노드·1인). **사용자 승인 필요**(헌장 긴장). **선행: 없음.** 검증: 파일 존재 + README §6 링크 유효
- [ ] **T0-2** (S) 정답형 인시던트 ↔ 런북 ↔ 티어 매핑표를 spec §1로 확정하고 `alert-rules.yaml`의 실재 alertname과 교차검증. **선행: 없음**
- [ ] **T0-3** (S) 근거강제·권한분리 원칙(spec §0)을 `assistant`의 기존 서버검증 인용 검증기와 정합 확인 — 재사용 지점 명시. **선행: 없음**

---

## P1 — L1 조치 제안 (RAG over runbooks) — 실행 없음, 즉시·안전

- [x] **T1-1** (S) 런북 frontmatter 스키마 확정(spec §2.3 — 기존 키 재사용 + `tier`·`actions` 추가) + **`scripts/gates/check-runbook-actions.sh`** 작성 — A1~A10(tier↔risk 정합 · 명령 근거성 · tier≥2 실재 alertname), `--self-test` 역증명, `verify-all.sh` 글롭 자동 편입 + `ci.yml` 2스텝 배선. 검증: **AC-L1-1**. **선행: T0-2**
  > 파일명이 초안(`scripts/check-runbook-frontmatter.sh`)과 다르다 — frontmatter **존재** 검증은 축3의 `check-runbooks.sh`가 이미 한다. 중복 게이트를 만들지 않고 **조치 계약** 게이트로 범위를 좁혔다(spec §2.5 AC-L1-1 주 참조).
- [x] **T1-2** (S) 기존 런북 **14종 전부**에 `tier`·`actions` 소급 — 초안이 적은 3종은 T0-2 시점 수치이고 실제 코퍼스는 14종이었다. `actions`는 **본문에 이미 있는 명령만** 구조화(게이트 A7이 강제). 명령이 자리표시자뿐인 `node-onboarding`은 `actions: []` + tier 0. **선행: T1-1**
- [x] **T1-3** (M) 정답형 조치 절차 **2종** 신규 — `disk-usage-high.md`(화이트리스트 회수: journal vacuum·apt clean·dangling 이미지. 실측 회수량 ≈1.2GB와 `/home` 272G 대비를 §1에 명시 · `/tmp`는 내용 미확인이라 화이트리스트 제외) · `orphan-port-holder.md`(고아 포트 점유 — 재시작 431,899회가 어떤 알림도 못 만든 사건). 둘 다 탐색 제외 규칙 + 정확한 명령 블록 + `actions`. **선행: T1-1**
  > 초안의 나머지 4종(`nvidia-driver-mismatch`·`oom-kill-occurred`·`smart-health-failed`·`gpu-xid-error`)은 **만들지 않았다** — 각각 `reboot-required-stale`·`memory-pressure`·`smart-health-failed`·`gpu-xid`가 이미 그 알림을 담당한다. 같은 알림에 런북이 둘이면 spec §2.4-4의 "다중 후보 상충"을 자초하므로 신설 대신 기존 런북을 보강했다. 파일명도 `orphan-port-process` → `orphan-port-holder`로 정정(점유 주체가 프로세스라는 것이 이름의 요점).
- [x] **T1-4** (M) L1 분류·검색 파이프 — **`infra/alert-relay/remediation_l1.py`**(stdlib 전용·pip 0, relay가 import 하는 순수 모듈 + 단독 CLI). 산출 JSON 스키마(`category/runbook_id/action_id/confidence/citations`) 강제. **선행: T1-2, T1-3**
  > **OpenSearch 색인은 하지 않았다**(초안에서 의도적으로 벗어난 지점 — spec §2.1 개정 노트). alertname → frontmatter `alerts` **직매칭이 1순위**이고 BM25는 모듈 안의 순수 함수로 폴백만 한다. 이유 셋: ① `check-runbooks.sh` R5/R8이 이 매핑을 이미 양방향 강제한다 — 계약이 있는 자리에 검색을 쓰면 정확도를 스스로 깎는다 ② 문서 16편은 인덱스 서버가 필요한 규모가 아니고, 색인은 라이브 상태 변경(§12)과 "인덱스가 최신인가"라는 새 실패 모드를 부른다 ③ relay의 pip 0·독립 배포 요건. 결과적으로 **alertname이 매칭되면 분류에 LLM을 부르지 않는다**(GPU 0회·오분류 0).
- [x] **T1-5** (S) 근거-조치 정합 검증기 — LLM이 고른 `runbook_id`/`action_id`가 인용 런북에 실존하는지 **디스크를 다시 읽어** 확인, 없으면 제안 폐기. 명령 드리프트·인용 행 드리프트·삭제된 런북까지 본다. 검증: **AC-L1-2**. **선행: T1-4**
- [x] **T1-6** (S) "매뉴얼 없음" 경로 + stale 강등(`last_verified` > 180d → 배지 + `max_tier` 1). 신뢰도는 **강등에만** 쓴다. 검증: **AC-L1-3·AC-L1-4**. **선행: T1-4**
  > T1-4~T1-6 공통 산출: 유닛 `infra/alert-relay/test_remediation_l1.py`(39건, mock vLLM = 로컬 http.server라 외부 통신 0) + 게이트 `scripts/gates/check-remediation-l1.sh`(L1~L7 · `--self-test` 역증명) + `ci.yml` 2스텝 배선. 게이트가 **실행 권한 0**을 문법 수준에서 강제한다(AC-L1-5).
  > ⚠️ 구현 중 발견한 결함: frontmatter 미니 파서가 접힘 스칼라(`command: >-`)를 지원하지 않아 **조치를 가진 런북 전부가 조용히 코퍼스에서 빠져 있었다**. 파이프는 에러 없이 "매뉴얼 없음"만 냈다. 파서를 고치고 **PyYAML과의 전편 대조를 게이트로 승격**(AC-L1-7)해 재발을 막았다.
- [ ] **T1-7** (S) L1 제안을 조사 패키지(`aiops 2-4`)/알림 스레드에 답글로 게시(근거번호 + 명령 블록, 실행 버튼 없음). **선행: T1-5, T1-6**

> [!NOTE]
> P1이 끝나면 사용자 요청의 안전한 절반이 실물로 커버된다 — "로컬 LLM이 공식 매뉴얼(런북)을 참조해
> 근거와 함께 조치를 제안"까지. 실행 기능이 없어 §11/§12와 완전 무충돌. 신규 데몬 0.

---

## P2 — L2 승인 후 실행 (ChatOps HITL) — ADR-0026(신설 예정) 승인 후

- [ ] **T2-1** (M) `infra/remediation/remediation-worker`(결정론·최소권한, port-exporter/node-hygiene 패턴) — `runbook_id`+검증 인자만 수신, `command_ref` 실행, timeout·입력검증·**부분 실패 시 stale 결과 금지**. precondition·dry-run·validate·rollback 훅. **선행: T1-3**
- [ ] **T2-2** (M) repo 리뷰된 조치 스크립트 + 대칭 rollback 스크립트 작성(`remediation/restart-logstash.sh` + rollback 등). **각 조치는 멱등·가역**(§16). **선행: T2-1**
- [ ] **T2-3** (S) 승인 카드 5필드 강제(무엇/왜/영향/롤백/dry-run diff) — 누락 시 게시 실패. 검증: **AC-L2-2**. **선행: T2-1**
- [ ] **T2-4** (M) Slack 인터랙티브 [승인]/[거부] 버튼 → 승인 이벤트 → 워커 트리거. **유출 필드 화이트리스트**(alertname/severity/node/runbook_id만). 검증: **AC-L2-5**. **선행: T2-3.** 사용자 승인(egress, §C3)
- [ ] **T2-5** (S) **CLI 폴백 승인**(`remctl approve <id>`) — Slack 장애 시에도 실행 가능. 검증: **AC-L2-3**. **선행: T2-1**
- [ ] **T2-6** (S) 감사 인덱스 `keiwi-remediation-*` 배선 — proposal_id·approver·runbook·result·rollback. 검증: **AC-L2-4**. **선행: T2-1**
- [ ] **T2-7** (S) 승인 없이는 실행 0 게이트. 검증: **AC-L2-1**. **선행: T2-1**
- [ ] **T2-8** `[server]` (S) control plane 아웃오브밴드 배치 확인 — data05 터널 관리 런북을 data05에서 실행하지 않도록 워커 노드 배치(§C4). **선행: T2-1**
- [ ] **T2-9** `[server]` (M) L2 파일럿 — LogIngestStalled 재시작을 **섀도(제안+수동실행)로 먼저**, 이후 버튼 승인 실행. `keiwi-remediation-*`에 무사고 실행 이력 축적 시작(L3 earned-autonomy 근거). **선행: T2-4, T2-6**

---

## P3 — L3 사전승인 안전조치 자동 — **ADR-0027(신설 예정) 승인 후에만** (조건부)

> [!CAUTION]
> L3는 사람 클릭 없이 라이브를 바꾼다. **ADR-0027(신설 예정) 없이는 코드로 존재해서도 안 된다.** 각 후보는
> L2에서 무사고 20회(policy `requires_earned_runs`) 이후에만 승격. 후보는 LogIngestStalled 재시작·
> DiskUsageHigh 화이트리스트 정리 2종뿐.

- [ ] **T3-1** (S) `docs/decisions/0024-l3-safe-action-policy.md` — 4조건·가드레일·earned-autonomy + **헌장 L3 예외 문구**(개정 아님, ADR로 예외 경계 정의). **사용자 승인 필수.** **선행: T2-9(이력 축적)**
- [ ] **T3-2** (S) `infra/remediation/policy.yaml` allowlist(spec §4.4) + 로더 — `reversible/idempotent=false`나 Tier0 조치는 auto_eligible 등록 거부(fail-closed). 검증: **AC-L3-1·AC-L3-8**. **선행: T3-1**
- [ ] **T3-3** (M) 가드레일 결정론 구현(LLM 밖) — 동시성 1 · 최소노드 바닥 · 노드당 일일 상한 · 시도≤2 · 쿨다운/백오프. 검증: **AC-L3-3**. **선행: T3-2**
- [ ] **T3-4** (S) **발동 메모리 서킷브레이커** — OpenSearch `keiwi-remediation-*`에서 "이 런북·이 노드·최근 N일 발동 수" 조회, 임계 초과 시 조사 전환. 검증: **AC-L3-4**. **선행: T2-6**
- [ ] **T3-5** (S) earned-autonomy 게이트 — 무사고 L2 실행 < `requires_earned_runs`면 L3 거부·L2 강등. 검증: **AC-L3-2**. **선행: T3-2, T2-9**
- [ ] **T3-6** (S) dry-run 선행 + rollback 필수 강제(없으면 거부) + allowed_paths fail-closed. 검증: **AC-L3-5·AC-L3-7**. **선행: T2-2, T3-2**
- [ ] **T3-7** `[server]` (S) **글로벌 break-glass kill-switch**(아웃오브밴드) — on이면 전 자동경로 즉시 정지. 검증: **AC-L3-6**. **선행: T3-3**
- [ ] **T3-8** `[server]` (M) L3 승격 — 후보 1종(LogIngestStalled)만, dry-run→canary(1노드)→관찰. blast radius 1노드 준수. **선행: T3-3~T3-7 전부**

---

## 백로그 (게이트 미충족 또는 이력 선행)

- [ ] **B01** DiskUsageHigh 화이트리스트 정리의 L3 승격 — L2 무사고 20회 후. `/opt/conda/pkgs`·`/home`은 **공용/연구자 데이터라 영구 Tier0**(사용자 승인·통보만)
- [ ] **B02** orphan-port-holder kill의 **tier 1→2** 승격 — 선행조건이 둘이다(hardware-ops §3.9): ① 리스닝 프로세스의 실행파일 경로를 기대값과 대조하는 메트릭 ② 유닛 `NRestarts`/`activating` 지속 시리즈. 그 위에서 오검출률을 실측한 뒤 kill의 `risk`를 medium으로 내린다. **지금 tier가 1인 것은 게이트 A5의 판정이고, 그 판정을 우회하지 않는다**
- [ ] **B03** L1 few-shot 예시 풀 — 해결된 인시던트(알림→진단→조치→결과)를 `keiwi-remediation-*`에 라벨링해 RAG 예시로(aiops 2-2/2-5 연계). 라벨 확보 부담이라 후순위
- [ ] **B04** 축소판 회귀 벤치 — 5노드 정답형 인시던트 리플레이로 L1 제안 정확도 계기판(AIOpsLab 참조, 완전 자동 아님)
- [ ] **B05** 근거-조치 정합 검증기를 하이브리드 검색(BM25+k-NN, aiops 2-5)로 업그레이드 — 초기 코퍼스 안착 후

# KEIwi 실행 로드맵 — 관측에서 연구원 IDP까지

> 2026-07-04. 5각도 웹 리서치(SRE 실무 워크플로 · IDP/플랫폼엔지니어링 · 당근 Kontrol · 연구랩 IDP · 온프렘 CI/CD · 운영 성숙도) 종합.
> **성격: 전략/방향 문서 — 착수는 순차·구조적으로.** 실행 후보의 세부는 [backlog.md](./backlog.md)(SRE 추가기능 #1~#16).
> KEIwi 현실에 맞춤: 온프렘 · k8s 없음 · 5노드/GPU 6장 · SRE 1인 · egress 0 · 단일 콘솔=Grafana(§I-2) · 에이전트 생성·사람 적용(§11) · 라이브 직접수정 금지(§12).

---

## 1. SRE는 이 콘솔로 실제로 어떻게 일하나

현업 흐름 **탐지→triage→진단→완화(먼저)→복구→무비난 포스트모템**에 세 화면 매핑. 완화의 목표는 영구수정이 아니라 "영향을 빨리 줄이기", RCA는 그 다음.

| 층 | 방법론 | 화면 | 보는 것 |
|---|---|---|---|
| 증상(블랙박스) | Golden Signals / RED | **Overview** | 노드/GPU/vLLM 정상? triage |
| 원인(화이트박스) | USE(Util/Saturation/Errors) | **Resources** | 5노드·6GPU util/saturation/errors |
| 근본원인 | 신호→패턴→상관 | **Logs 워크벤치** | error/warn 우선 → RAG 진단 |
| 타임라인 | annotation | **incidents 보드** | 조사·완화·해결 마킹 |

**트레이싱 없음** → exemplar 대체물 = **host+시간창 라벨로 메트릭↔로그 원클릭 상관**(패널 클릭 → Logs를 `host·시간·category`로 프리필터 딥링크). 이것이 KEIwi가 트레이스 없이 관측성 3기둥 상관을 구현하는 방식.

### 시나리오 A — vLLM TTFT 폭증·OOM (어시스턴트 자체가 느려짐 = 도그푸딩)
전통 4신호로 부족 → TTFT·큐깊이·KV캐시·preemption 필요. 결정 매트릭스: TTFT↑+큐↑=용량부족 / TTFT↑+큐정상=prefill 느림 / ITL↑+큐정상=GPU throttle / preemption↑=KV압박. 완화는 max_num_seqs·부하안정화 먼저(단일 GPU라 레플리카 증설 비현실). **갭: vLLM :metrics 미스크레이프, 결정매트릭스 미인코딩, RAG에 지표스냅샷 미주입.**

### 시나리오 B — 유휴·좀비 GPU (스케줄러 부재 = 최대 실무 이슈)
크래시 후 VRAM 붙잡고 compute 0%가 일상. "data04에 X연구원 40GB·0%·12분" → RAG 넛지 초안 → SRE 발송(자동 kill 금지 §11). **귀속 v1(user 라벨) 완료로 데이터 기반 확보. 갭: held-but-idle 전용 뷰(#9).**

### 시나리오 C — 노드 down (data04 SSH 터널 두절)
노드/터널/exporter 구분 → dmesg/journald → runbook대로 Ansible 재기동. **갭: 알림 발화 없음·blackbox_exporter 부재·runbook_url 미강제.**

**공통 병목 3개:** ① Alertmanager(알림 발화) ② 알림에 runbook+패널 딥링크 ③ 패널→Logs 프리필터.

---

## 2. "공식 관리 시스템" 갭 — 성숙도 Tier

CNCF 성숙도(observe→standardize→self-service→platform)에서 KEIwi는 **observe 완료, 위가 빔**.

**Tier 0(완료):** Prometheus+DCGM+exporters · OpenSearch · Grafana · 콘솔 4화면 · RAG · GPU 귀속 v1.

**Tier 1 — 신뢰성 루프 최소완성(S, 최우선):**
| 갭 | 무엇 | # |
|---|---|---|
| 알림 발화 | Alertmanager + ntfy/Gotify self-host(egress 0) | #6 |
| GPU 경보 | DCGM 헬스확장 + XID/ECC/throttle 알림 | #1·#2 |
| 합성 모니터링 | blackbox_exporter("초록인데 죽음") | #3 |
| runbook 강제 | 모든 알림 runbook_url + 패널 딥링크 | #11 |
| CMDB 씨앗 | inventory→경량 CMDB(owner) | #5 |
| 포스트모템 | 무비난 템플릿(감사추적=승격 근거) | #4 |

**Tier 2 — 신뢰성을 숫자로(M):** #7 SLO-as-code(Sloth) · #10 vLLM SLO · #9 유휴/좀비 · #12 showback · #13 책임자 라우팅.

**Tier 3 — 거버넌스(L, IDP 직전):** RBAC=**자체 인증 금지, Cloudflare Access identity를 권한 소스로**(§14) · Scorecard read-only 점검 · Observability-as-Code(Grafana git-sync·PR).

> 순서 불변: Tier 1(알림) → 2(SLO/귀속) → 3(거버넌스). Alertmanager 없이 SLO·IDP는 순서 역전.

---

## 3. 연구원 특화 IDP 로드맵

### 3.1 당근 Kontrol 공통점 / 차이 — 이식하는 건 도구가 아니라 "제품 사고"
| | 웹개발 IDP(Kontrol) | 연구원 IDP(KEIwi) |
|---|---|---|
| 중심 | 코드→빌드→**배포** | **GPU 잡·노트북·재현 환경** |
| 파이프라인 | 결정적 CI/CD | 확률적 실험(Code+Data+Model) |
| 카탈로그 | 서비스 | **실험/모델/데이터셋 레지스트리** |
| 환경 | 컨테이너 배포 | **재현 환경**(Apptainer) |
| 자원 | 오토스케일 | **공유 GPU 공정성·짧은 job·유휴/좀비** |
| 관측 | 별도 | **Grafana 유지**(§I-2) |

차용: convention-over-config·opinionated(90% 케이스)·"누가·언제·무엇" 감사. **금지**: 배포/CI-CD 문자 이식·Backstage 전면도입.

### 3.2 실행 방식 = "생성→사람 승인"(ops by PR) — §11을 IDP에 녹이는 법
```
콘솔/RAG가 PR 초안 → SRE branch-protection 승인 → merge가 Ansible 트리거(webhook/AWX approval) → 적용
```
콘솔 = 버튼 뒤 CI/Ansible/registry API의 얇은 프론트. Grafana = 관측 전용.

### 3.3 Phase 1→5 (k8s 없이)
| Phase | 무엇 | 도구 | §11 게이트 |
|---|---|---|---|
| **1** 관측→조치 봉합 | Alertmanager·runbook_url·패널→Logs·CMDB | Prometheus/Ansible + ntfy/Gotify + blackbox | 알림 read-only |
| **2** 신뢰성 언어화 | SLO·vLLM SLO·유휴넛지·showback | Sloth/Pyrra·DCGM·zombie-hunter | 넛지만, 회수 사람 |
| **3** 셀프서비스 진입(관측) | 연구원 read-only 뷰 + Scorecard | 콘솔 + Cloudflare Access identity | read-only |
| **4** 셀프서비스 실행(GPU·환경) | 웹에서 잡·노트북·재현환경 | **Open OnDemand + LinuxHost**·**genv**(GPU 환경변수 스케줄러)·**Apptainer**·JupyterHub SSHSpawner | 폼→Ansible 생성→승인 |
| **5** CI/CD·도커빌드·풀 IDP | 이미지빌드→registry→재현배포·실험추적 | **Forgejo/Gitea Actions**·docker buildx·**registry:2→Harbor**·**self-host MLflow**·**DVC** | PR 승인 게이트 |

**피할 것**(k8s 전제): Run:ai 본체·Determined·Kubeflow·Flyte·Nautilus(genv만 예외). 시크릿: **Ansible Vault / SOPS+age**(오프라인). sealed-secrets=k8s 전용.

---

## 4. 다음 1~2 스텝 (당장·저비용·SRE 성장)

**IDP가 아니라 Tier 1 알림 구멍부터.** 세 시나리오가 전부 여기서 막히고, 신규 수집·상태저장 0이라 §11/§12/egress 0 무충돌.

- **스텝 1(S):** #1 DCGM 헬스확장(csv 마운트+재시작) → #2 GPU 헬스 알림(Prometheus 규칙만). dcgm-exporter 이미 라이브 → 수집 0. "화면 봐야 인지" 즉시 해소.
- **스텝 2(M):** #6 Alertmanager(ntfy/Gotify self-host) + #11 모든 알림 runbook_url. 컨테이너 1개. 정비 중 silence, 노드 down 하위알림 inhibition. → 알림→런북→RAG 고리 = toil 감소 정량 성과.
- 이후: #7 SLO-as-code → #9 유휴/좀비(귀속 v1 준비완료) = **Phase 4 진입점**.

**요약:** 지금은 IDP 짓는 때가 아니라 **관측→알림→런북 신뢰성 루프를 닫는 때**. 그 루프가 공식 관리 시스템의 최소 자격이고, 그 위에서만 연구원 IDP(OnDemand·genv·Apptainer·Forgejo)를 순차·튼튼하게 얹는다.

## 출처
Google SRE Incident Management Guide·Workbook · USE/RED/Golden Signals · vLLM :metrics·결정매트릭스 · OpenSearch AD(RCF)/Log Pattern · CNCF platform maturity·Team Topologies TVP · 당근 Kontrol/katalog(daangn tech) · Open OnDemand·run-ai/genv·Apptainer·JupyterHub SSHSpawner · Forgejo/Gitea Actions·registry:2/Harbor · MLflow/DVC · SOPS+age·Ansible Vault. (전체 URL은 리서치 원본 tasks/wr9c08ojr.output)

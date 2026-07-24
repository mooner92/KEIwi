# SRE 추가 기능 · 커리어 성장 — 백로그 (웹 리서치 종합)

> 2026-07-01 4각도 병렬 웹 리서치(신뢰성·리소스관리·GPU관측·커리어) 종합.
> **성격: 리서치/후보 목록 — 착수는 사용자 선택 후.** M3(리소스 관리) 관련 항목은 M3 재개 시 통합 검토.
> 랭킹 기준 = KEIwi 적합성(온프렘 5노드·k8s 없음·Prometheus/DCGM/Grafana/OpenSearch/vLLM/Ansible 기존 스택) × SRE 가치 × 노력(S/M/L). 헌장 §11(에이전트 생성·사람 적용)·§12(라이브 직접수정 금지)·§I-2(단일 콘솔=Grafana) 준수 전제.

## Tier 1 — 즉시 착수 후보 (S, 기존 스택에 규칙/설정만)
| # | 항목 | 노력 | 근거 |
|---|------|:---:|------|
| 1 | **DCGM 헬스 필드 확장**(custom metrics csv: XID·ECC SBE/DBE·remapped-rows·thermal/power violation·PCIe replay·tensor/DRAM active) | S | dcgm-exporter가 data03/04/05에 이미 라이브. csv 하나 마운트+재시작. 아래 알림·유휴탐지의 데이터 전제 |
| 2 | **DCGM GPU 헬스 알림**(XID>0·remapped>0·DBE>0·thermal throttle 지속·타깃 down) | S | 신규 수집 0, Prometheus 규칙만. GPU=플릿 핵심자산, vLLM/RAG 중단 전 조기경보. #1 위에 얹힘 |
| 3 | **blackbox_exporter 합성 모니터링**(:9115 HTTP/TCP/ICMP + 인증서 만료) | S | "메트릭은 초록인데 서비스는 죽은" 구멍. 프로브: 콘솔:3105·Grafana·OpenSearch:9200·Logstash:5044·vLLM /health·터널. 컨테이너 1개 |
| 4 | **무비난 포스트모템 템플릿**(docs/, 요약·타임라인·근본원인·조치항목) | S | 1인 SRE엔 무거운 툴 과함. 타임라인은 OpenSearch+Prometheus에서 구성. /incidents 어시스턴트와 연결 |
| 5 | **inventory→경량 CMDB**(owner·purpose·GPU모델·도입일·보증 필드 추가) | S | inventory.yaml=SoT(§0). 소유자 필드는 #11 알림 라우팅 입력. NetBox 전체는 5노드엔 과함 |

## Tier 2 — 핵심 확장 (M, 신뢰성 루프 완성)
| # | 항목 | 노력 | 근거 |
|---|------|:---:|------|
| 6 | **Alertmanager**(라우팅·중복제거·억제·침묵) + 온프렘 알림 브릿지(ntfy/Gotify self-host, 외부 필요시 Telegram만 예외) | M | 현재 알림 발화 계층 0(M5). Prometheus 옆 컨테이너 1개, k8s 불필요. egress 0 위해 클라우드 대신 사내 self-host. 정비 중 silence, 노드 down시 하위 GPU/포트 알림 inhibition |
| 7 | **SLO/error budget as code**(Sloth CLI → 규칙파일 커밋, 또는 Pyrra 파일시스템 모드) | M | SLI=인프라 가용성(노드 up 비율·scrape 성공률·GPU 정상·로그 인입 신선도). 다중창 다중번레이트 알림 자동생성. Grafana에 SLO 대시보드 프로비저닝(§I-2) |
| 8 | ✅ **v1 완료(2026-07-03)** — 사용자/프로세스별 GPU·서비스 귀속: gpu-model/port-exporter에 user 라벨(/proc uid→pwd), 콘솔 서비스 탭·모델 대시보드에 소유자 표시. [specs/ownership-attribution](../ownership-attribution/spec.md). 유휴탐지(#9)·showback(#12)의 데이터 기반 확보 |
| 9 | **유휴/좀비 GPU 탐지 + 넛지**(고VRAM·저util 지속 → 알림, 회수는 사람) | M | 6장 공유 플릿 최대 낭비원. gpu-zombie-hunter 패턴(N회 샘플링 오탐방지). 자동 kill 금지(§11), 넛지만. #8 의존 |
| 10 | **vLLM 추론 SLO**(TTFT·ITL·num_requests_waiting·kv_cache·preemption + 멀티 burn-rate) | M | vLLM 잡 이미 존재(8003 Qwen3-Coder-30B). model-workload.json에 패널+recording rule. 어시스턴트 체감품질을 SLO로 |
| 11 | **런북 자동화**(모든 알림에 runbook_url 애너테이션, Ansible playbook 준비·사람 실행) | M | docs/runbooks + Ansible role 이미 존재. 알림→런북→RAG 매칭 고리 완성. toil 직접 감소 |
| 12 | **GPU시간 showback 리포트**(recording rule user별 GPU-hours + Grafana 주간 랭킹) | M | 과금 아닌 가시성. 공유자원 분쟁 근거. #8 의존 |
| 13 | **크리티컬 에러→책임자 라우팅**(Alertmanager routing tree = M5) | M | #5 owner 필드를 알림 라벨로 승격. #6 위에 얹힘. read-only(알림만) |

## Tier 3 — 대형/보류 (L, 신규 상태저장·라이브 리스크)
| # | 항목 | 노력 | 근거 |
|---|------|:---:|------|
| 14 | 셀프서비스 GPU 예약/달력(TensorHive형) | L | 큐잉/예약 전무 → GPU 충돌이 "사회적"으로 해결됨. 별도 상태저장=신규 서비스 |
| 15 | 소프트 GPU 공유(MPS·CUDA_VISIBLE_DEVICES·메모리 분수) | L | A40/RTX6000 MIG 미지원=하드분할 불가. 라이브 MPS 토글은 §12 리스크. MIG 불가 문서화는 오해방지에 유용 |
| 16 | Slurm 공유 스케줄링(fair-share) | L | 수동 GPU 배분 toil 제거 표준. 강제 스케줄러 도입은 현 관제/넛지 철학과 상충 — 신중 |

## SRE 커리어 성장 트랙 (KEIwi 위에서 포트폴리오화)
- **SLO-as-code(Sloth)** = #7. "신뢰성을 숫자로 말하기"의 첫 단추·포트폴리오 중심.
- **Observability-as-Code** — Grafana 대시보드·데이터소스·알림을 Terraform provider/git-sync로 Git 관리·PR 리뷰. KRDS 대시보드가 이미 자산.
- **Ansible 성숙화** — molecule 테스트 + ansible-lint + CI + (필요시 Atlantis PR 게이팅). "테스트된 IaC 롤".
- **작은 Chaos Engineering** — k8s 없이 Chaosd/Pumba/stress-ng로 단일노드 장애 주입 → 알림·런북·SLO burn 검증. "CNCF chaos를 non-k8s 물리서버에서" = 차별점.
- **인시던트 훈련** — 런북 라이브러리(5A) + 무비난 포스트모템(#4) + Wheel of Misfortune 게임데이. 문서를 RAG 어시스턴트 검색소스로.
- **Toil 정량화 → self-healing** — toil 목록화·측정(<50%) 후 Alertmanager webhook→Ansible self-heal. 자동화 전/후 시간 그래프=정량 성과.

## 권장 진입 순서 (착수 시)
1(csv)+2(GPU알림) → 3(blackbox) → 6(Alertmanager)+11(runbook_url) → 7(SLO/Sloth)+10(vLLM SLO) → 8(귀속)+9(유휴탐지) → 4(포스트모템)+게임데이. 각 단계가 다음의 데이터/인프라 전제.

## 출처
DCGM: dcgm-exporter dcp-metrics-included.csv, NVIDIA gpu-debug-guidelines. 알림/SLO: Google SRE Workbook(alerting-on-slos), Sloth/Pyrra, Prometheus Alertmanager. GPU 귀속/유휴: 500farm/prometheus-nvidiasmi, gpu-zombie-hunter. vLLM: docs.vllm.ai/design/metrics. 커리어: Grafana Observability-as-Code, ansible molecule, Chaos Mesh/Pumba. (전체 URL은 리서치 원본 tasks/w2y5u6fwl.output)

# 모델 운영(model-ops) — 서빙 가시화 · VRAM 사전판정 · 기동/정지

> 상태: **초안 (사용자 리뷰 대기)** · 2026-08-06
> 권위: [Constitution.md](../../Constitution.md) §7·§11·§14 → 이 spec. 실행 계층은 [ADR-0026](../../docs/decisions/0026-remediation-l2-approval.md)(L2 승인 실행기) 위에 선다.
> 발단: 사용자 요청 — *"모델 뭐 떠있나 직관적으로 보는 페이지 + 설치된 모델을 클릭/드래그로 띄우고 내리기 + 띄우기 전 VRAM 사전판정. 핵심 기능이 될 것."*

---

## 1. 목적 · 배경

GPU 6장 공유 플릿에서 "지금 어떤 모델이 어느 GPU에 떠 있고, 새 모델을 띄울 수 있는가"는 현재 `nvidia-smi`를 칠 수 있는 사람만 안다. 2026-08-06 하루 동안 실증된 비용:

- data05 재부팅으로 `:8003` 모델이 조용히 교체(Qwen3-Coder-30B → Qwen2.5-Coder-32B)되어 어시스턴트가 502 — **"무엇이 떠 있나"를 아무 화면도 보여주지 않아** 원인 파악에 진단이 필요했다.
- GPU0에 39GB(vLLM Qwen2.5-32B-AWQ, 미사용), GPU1에 19GB(ollama qwen3.5:9B)가 떠 있는데, 소유자 본인도 콘솔에서 이를 볼 수 없었다.
- 모델을 내리고 띄우는 일은 sudo + systemd 지식이 필요해 사실상 관리자 1인에게 병목.

M3(여유 리소스, ADR-0012로 Overview 흡수)가 "이 서버에 여유가 있는가"를 답했다면, model-ops는 그 다음 질문 — **"그래서 이 모델을 여기 띄울 수 있는가, 띄워라"** — 를 답한다.

## 2. 사용자 스토리

- **US1 (본다)**: 운영자·연구자가 콘솔에서 노드×GPU 격자로 **지금 서빙 중인 모델**(엔진 vLLM/ollama · 포트 · 소유자 · VRAM 점유)을 본다. `nvidia-smi` 없이.
- **US2 (고른다)**: 노드에 **설치된(디스크에 있는) 모델 카탈로그**를 보고 띄울 후보를 고른다.
- **US3 (판정받는다)**: 모델을 띄우기 **전에** 서버가 VRAM 요구량을 추정해 **가능 / 빠듯 / 불가 / 판정불가** 4단 판정과 근거 수치를 보여준다. 거짓 "가능" 금지(ADR-0013 정직성 원칙 재사용).
- **US4 (띄우고 내린다)**: 판정이 "가능"인 모델을 클릭으로 기동하고, 서빙 중인 모델을 클릭으로 정지한다. 모든 조작은 확인 마찰 1회 이상 + 감사 원장 기록.
- **US5 (추적한다)**: 누가 언제 무엇을 띄우고 내렸는지 원장([ADR-0026](../../docs/decisions/0026-remediation-l2-approval.md) `remediation.jsonl`)에서 재구성할 수 있다.

## 3. 범위

### In (v1)

| 축 | 내용 |
|---|---|
| **조회** | 노드×GPU 서빙 현황(vLLM systemd 유닛 + ollama) · 설치 모델 카탈로그(`/data/vllm/models` 스캔 + `ollama list`) · 소유자 표시([ownership-attribution](../ownership-attribution/spec.md) `user` 라벨 재사용) |
| **판정** | VRAM 사전판정 BFF(§5) — 신규 수집 0, Prometheus(DCGM·gpu-model-exporter) 재사용 |
| **조작** | vLLM 모델 기동/정지 — **data05 우선**, systemd 유닛 표준(§6) + L2 실행기 확장(§7) |
| **감사** | 조작 전량을 L2 원장에 기록(이벤트 스키마 재사용) |

### Out (v1에서 하지 않음)

- **자동 스케줄링·큐잉·예약** — 백로그 #14(Tier 3, L). 판정은 정보 제공이지 배치 결정이 아니다.
- **모델 다운로드/설치** — 카탈로그는 디스크에 이미 있는 것만. 반입은 사람.
- **멀티 GPU 텐서 병렬(TP>1) 판정** — 현 플릿 운영은 TP=1(hardware-ops T6-8이 수치로 사후 정당화 예정). v1 판정은 단일 GPU 기준.
- **ollama 조작** — v1은 표시만(§Q2). 조작은 vLLM(systemd 유닛)부터.
- **자동 롤백·사후 헬스체크 기반 자동 조치** — L3 영역(ADR-0027 이후).
- **드래그&드롭 배치 UX** — v2 후보(§9). v1은 클릭+확인.

## 4. 데이터원 (신규 수집 0)

| 질문 | 소스 | 비고 |
|---|---|---|
| 어떤 모델이 떠 있나 | gpu-model-exporter `:9836/:9837`(모델↔GPU↔pid↔user) | 이미 라이브. ollama는 프로세스로 잡힘 — 모델명은 v1에서 ollama API(`/api/ps`) 보강 |
| GPU별 VRAM 여유 | DCGM `DCGM_FI_DEV_FB_FREE/USED` + `gpu_vram_total_bytes` | ADR-0013과 동일 소스 |
| 설치된 모델·크기 | 콘솔 BFF가 노드별 모델 디렉토리 스캔 | v1 data05=로컬 fs. 원격 노드는 v1.5(§Q4) — inventory에 `model_dir` 필드 추가 |
| 유닛 상태(active/failed) | v1: BFF가 `systemctl show`(읽기, 무권한) · 원격은 port-exporter 간접 확인 | hardware-ops T6-13(유닛 NRestarts 메트릭)과 합류 예정 |

## 5. VRAM 사전판정 — 핵심 로직

**원칙: 추정은 보수적으로, 근거 수치는 전부 노출, 모르면 "판정불가"** (ADR-0013 계승).

vLLM은 가중치만큼이 아니라 **`--gpu-memory-utilization`(기본 0.9)만큼 예약**한다. 따라서 판정식은 두 겹이다:

```
weights_gb   = 모델 디렉토리 실측 크기(safetensors 합) × 1.1   # 로딩 오버헤드 10%
reserve_gb   = gpu_total_gb × gpu_memory_utilization            # vLLM이 실제로 잡을 양
free_gb      = DCGM 실측 여유 VRAM

판정:
  free_gb ≥ reserve_gb            → 가능     (예약 전량 확보)
  weights_gb ≤ free_gb < reserve  → 빠듯     (util을 free/total로 낮추면 가능 — 제안 util 값 명시)
  free_gb < weights_gb            → 불가     (가중치조차 못 올림)
  메트릭 결손·크기 미상            → 판정불가 (거짓 "가능" 금지)
```

- 판정 카드에 표시: 가중치 실측 GB · 요청 util과 예약 GB · 현재 free GB · 판정 근거 한 줄. **"빠듯"일 때는 낮춘 util 값을 함께 제안**(예: "util 0.55로 내리면 KV 캐시 X GB — 컨텍스트 여유 감소").
- GGUF/ollama 모델은 파일 크기 × 1.15 + KV 추정으로 동일 4단 판정(표시용).
- 계산은 전부 서버(BFF) — 클라이언트 추측 금지. 단위 테스트로 경계값 고정(M3 `capacity.test.ts` 패턴).

## 6. 서빙 표준 — systemd 유닛 규약

현행 `vllm-qwen25-coder-32b.service` 수제 패턴을 표준화한다:

- **모델별 유닛** `vllm-<slug>.service` — 포트·모델경로·util·max-model-len을 유닛에 고정(레포 `infra/model-ops/units/`에 정본, 배포는 사람 §11). 명령 치환·환경변수 보간 금지(ADR-0026 보안 규칙 계승).
- **의존 역전 금지**: `hermes-gateway.service`가 `Wants=vllm-*`로 모델을 끌어올리는 현행 구조는 model-ops 조작과 충돌(내려도 되살아남) — 소비자 유닛은 `After=`만 남기고 `Wants=`를 제거한다(§Q3).
- sudoers 화이트리스트는 **유닛 단위**로: `systemctl start/stop vllm-*` 형태 — L2 권한 모델(명령별 화이트리스트)과 동형.

## 7. 실행 경로 — ADR-0026과의 긴장과 해소안

**ADR-0026은 "콘솔/Slack 버튼 실행"을 명시적으로 기각했다**(공개 엔드포인트·사외 신원·승인 피로). 그러나 그 논거는 **알림발(發) 장애 조치** 맥락이다. model-ops 조작은 성격이 다르다:

| | 장애 조치(L2 현행) | 모델 기동/정지(model-ops) |
|---|---|---|
| 개시자 | 알림→LLM 제안 | **사람의 능동 의사** |
| 신원 | 서버 셸 계정 | Cloudflare Access(§14가 공인한 유일 인증) |
| 빈도 | 월 수회 | 주 수회 이상(연구 워크플로) |
| 실패 비용 | 프로덕션 파이프라인 | 해당 GPU 워크로드 1개(가역·멱등) |

**해소안 — 2단계 승격**:

- **v1 (즉시)**: 콘솔은 **판정 카드 + 제안 생성까지**. 실행은 L2 CLI 복붙(`remediation_l2.py approve <id> --apply`) — ADR-0026 무수정, 오늘 착수 가능. 카드에 복붙 한 줄을 그대로 노출한다.
- **v1.5 (ADR-0027 승인 후)**: 콘솔 버튼 실행. 안전장치 4종을 조건으로 — ① Cloudflare Access 신원을 원장 `approver`에 기록 ② 확인 마찰(모델 slug 타이핑) ③ 대상은 `vllm-*` 유닛 화이트리스트만(범용 명령 실행기 금지 — ADR-0026 기각 사유 계승) ④ 실행 주체는 콘솔이 아니라 **로컬 실행기 소켓**(콘솔 프로세스에 sudo를 주지 않는다).

L2 실행기에 추가할 모델 전용 확장(탐색 실측 기반): GPU 선행조건 체크(free VRAM·온도) · GPU별 flock(`/run/lock/keiwi-gpu-<n>.lock`) · 모델별 `timeout_sec` frontmatter · 실행 후 헬스 표시(판정만, 자동 롤백 없음).

## 8. 수용 기준 (기계 검증)

| # | 검증 | 명령 / 기대 |
|---|---|---|
| **AC-M-1** | 서빙 현황 정합 | 페이지의 GPU별 모델 목록 = `curl :9836/metrics`의 모델 시리즈 + `ollama ps`와 일치(수동 대조 스크립트) |
| **AC-M-2** | 카탈로그 정합 | 페이지 카탈로그 = 모델 디렉토리 `ls` 결과와 일치, 각 항목에 실측 GB 표시 |
| **AC-M-3** | 판정 4단 실증 | 실측 케이스 3종 고정: 39GB 점유 GPU에 32B-AWQ → **불가** · 유휴 46GB GPU에 동일 모델 → **가능** · util 0.9 요청이 free보다 크고 가중치는 들어가는 조합 → **빠듯**(제안 util 명시) |
| **AC-M-4** | 판정불가 정직성 | DCGM 결손 노드(예: data01)에서 판정 요청 → "판정불가" + 사유(거짓 "가능" 0건 — 단위 테스트) |
| **AC-M-5** | 원장 기록 | 기동/정지 실행 1회 → `remediation.jsonl`에 proposal·approval·execution 이벤트, `approver` 실명 |
| **AC-M-6** | 확인 마찰 | 조작 UI는 확인 단계 없이 실행 불가(테스트: 확인 생략 경로 0) |
| **AC-M-7** | 검증 게이트 | `npm run typecheck && lint && test` + 판정 로직 경계값 단위 테스트 통과 |

## 9. v2 후보 (백로그)

- 드래그&드롭: 카탈로그의 모델 카드를 GPU 슬롯에 끌어놓으면 판정 카드 생성(제안까지만 — 실행 규칙은 동일).
- data03/04 원격 카탈로그·조작(SSH 경유 실행기 또는 노드별 실행기 배포).
- ollama 모델 조작 · 모델별 TTFT/부하 표시(vLLM SLO, 백로그 #10 합류).
- 유휴 모델 넛지(백로그 #9)와 연동 — "3일째 요청 0건" 배지를 이 페이지에 표시.

## 10. 미해결 질문 (사용자 결정 필요)

- **Q1 (v1.5 게이트)**: 콘솔 버튼 실행(ADR-0027)을 승인할 것인가, v1 복붙 방식을 유지할 것인가? — §7 안전장치 4종이 전제.
- **Q2**: ollama를 v1 조작 대상에 포함할 것인가? (현재 qwen3.5:9B는 사용자 개인 용도 — 콘솔이 건드리지 않는 게 맞는지)
- **Q3**: `hermes-gateway.service`의 `Wants=vllm-qwen25-coder-32b` 제거를 승인하는가? (제거 없이는 콘솔에서 내려도 hermes 재시작 시 되살아난다)
- **Q4**: 어시스턴트 기본 모델 정책 — 8003 상시 서빙을 포기하고 "필요할 때 model-ops로 띄우는" 온디맨드로 갈 것인가? (GPU0 39GB 상시 해방 vs 어시스턴트 첫 응답 지연 +모델 로드 시간)

## 11. 의존 결정

| ADR | 관계 |
|---|---|
| [ADR-0013](../../docs/decisions/0013-capacity-judgment-policy.md) | 판정 4단·정직성 원칙·임계 상수 재사용 |
| [ADR-0026](../../docs/decisions/0026-remediation-l2-approval.md) | 실행기·원장·승인 카드·보안 규칙 재사용. §7의 긴장 해소는 ADR-0027로 |
| ADR-0027 (신설 예정) | 콘솔 개시 조치의 신원·마찰·화이트리스트 — Q1 승인 시 작성 |
| [ADR-0016](../../docs/decisions/0016-gpu-drilldown-dcgm.md) · [ownership-attribution](../ownership-attribution/spec.md) | 모델↔GPU↔소유자 데이터 계보 |

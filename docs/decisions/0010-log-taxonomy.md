# 0010. 서비스 인지형 로그 분류 (category) · log_level 교정 · 보존(ISM)

- 상태: 채택 (2026-06-28)
- 날짜: 2026-06-28
- 후속: [ADR-0008](0008-log-pipeline.md)(로그 파이프라인) 확장. 관련 [spec](../../specs/M2-logs/spec.md)·[plan](../../specs/M2-logs/plan.md).

## 맥락

M2 통합 로그가 data04·data05에서 끝단(콘솔 `/logs`)까지 동작한다. 그러나 현재는 **journald 전체**가 한 덩어리로 흐르고, 운영자가 "누가 에러를 냈나"를 빠르게 못 짚는다. 공용 GPU/연산 서버라 장애 주체가 웹서비스·jupyter·OpenFOAM·vLLM 등으로 다양하다(운영자 요구).

**실측(2026-06-28, OpenSearch 직접 질의)으로 설계를 접지했다:**

- `service`(=`systemd.unit`)에 워크로드가 이미 식별 가능하게 찍힌다: `vllm-*`(GPU/AI, 4.3M+ 문서로 압도적), `ollama`, `open-webui`·`dev-booth-dashboard`(web), `cloudflared`·`containerd`·`rsyslog`(infra), `systemd-*`·`cron`·`ssh`(system), `user@<UID>.service`(사용자 세션).
- **대화형 워크로드(jupyter/OpenFOAM)는 `service`로 안 잡힌다.** `user@<UID>.service` 이벤트의 `command_line`은 **`/usr/lib/systemd/systemd --user`(유저 systemd 매니저 자체)**일 뿐이고, 셸에서 띄운 대화형 프로세스는 **애초에 journald에 안 들어온다**(터미널/파일 출력). → command_line 기반 분류는 막다른 길임을 라이브로 확인.
- **`log_level=error`가 22%로 높지만 상당수가 "진짜"다.** vLLM `error` 표본은 `priority=6(INFO)`인데 본문에 `ERROR 06-01 ... multiproc_executor.py`가 있어 grok 본문매칭(`logs.conf` L133 `\b(ERROR|...)\b`)으로 error가 됐다 — stderr→PRIORITY=3 인플레가 **아니라**, vLLM/torch가 실제 ERROR 레벨로 뱉는 노이즈다. 즉 파이프라인 오분류가 아니라 **앱 verbosity** 문제.

## 결정

**(1) 분류는 단일 `category` keyword 하나.** `systemd.unit`(=`service`)을 운영 범주로 묶는 **상호배타 6값**: `gpu · web · infra · system · user-session · unknown`. Logstash `translate` 필터 + **외부 regex 사전**(`service-category.yml`)으로 파생한다 — if-ladder를 코드에 박지 않고 데이터로 외부화(신규 모델 유닛을 코드 수정 없이 사람이 추가, §11). 스캔 0·결정적. `service_group`·`workload_type` 같은 직교 다축 필드는 **신설하지 않는다**(소비자 없는 과설계 — 필요해지면 그때 ADR).

**(2) 분류의 주 신호는 영원히 `service`(systemd.unit). 포트스캔은 보조에 한정.** 운영자의 "cron으로 열린 포트 조회 → 서비스 식별" 아이디어는 **MVP에서 거절**한다. 정직한 이유: 정작 잡고 싶은 **OpenFOAM은 리스닝 포트가 없어** 스캔에 구조적으로 안 잡힌다(역설). 전 노드 상시 root 주기작업은 §6(지루한 기술)·§11과도 충돌. 포트 디스커버리를 한다면 P2 이후 **'사전 보강 후보 diff 생성(사람 머지)'** 보조 역할로만, 저장은 메트릭(§I-3).

**(3) 대화형 워크로드(jupyter/OpenFOAM)는 "유닛화"가 정공법.** P0에서는 이들을 억지로 끌어올리지 않고 `user-session`으로 **정직하게** 둔다(부재≠장애, spec UL5). 캡처·분류하려면 `systemd-run --user --unit=...` 또는 `jupyter@.service`·`openfoam-run@.service` 템플릿으로 **유닛화**해 고유 `_SYSTEMD_UNIT`을 만든다 → 사전에 `^jupyter-`→`notebook`, `^openfoam-`→`simulation` 키만 추가하면 파이프라인 무변경으로 분류된다.

**(4) `log_level` 교정은 "계측 먼저".** grok 본문 패턴에 `INFO|NOTICE` 추가 + bare-token(L133)을 구조화형(`[ERROR]`·`level=`)·줄머리 앵커로 좁혀 오탐을 줄인다. **본문 명시 ERROR는 계속 승격**(진짜 에러 보존). `log_level_source`(body|priority|default) keyword를 신설해 stderr 인플레 규모를 **정량화한 뒤** PRIORITY=3→warn 다운그레이드 여부를 결정한다. 측정 전 선커밋 금지(진짜 에러를 warn으로 숨길 위험).

**(5) 보존은 OpenSearch ISM.** `keiwi-logs-ism.json`(기본 30일 후 delete, `ism_template`로 신규 일자 인덱스 자동 부착). spec In #2 '보존 기간 정책'을 충족. vLLM 4.3M+ 문서가 용량을 지배 → 디스크 예산 점검 필요.

**(6) 신규 keyword는 인덱스 템플릿에 선적용.** `category`·`log_level_source`를 `keiwi-logs-template.json`에 keyword로 추가 후 사람이 `PUT _index_template`. `manage_template=false`라 선적용 안 하면 동적매핑이 text로 만들어 Grafana terms·변수가 깨진다. **신규 일자 인덱스부터** 적용(과거 인덱스 소급 안 됨).

## 고려한 대안

- **직교 다축 분류(category + workload_type + service_group + gpu flag)** — 8×8 조합의 taxonomy는 소비자가 없어 과설계 → 단일 `category`로 수렴, 필요 시 ADR로 확장.
- **포트스캔/nvidia-smi/docker ps 주기 디스커버리 데몬(주 분류기)** — 포트 없는 연산작업 누락 + blast radius/드리프트(§6·§11) → 거절, 보조로만 연기.
- **command_line 기반 대화형 분류** — 라이브 검증 결과 user@ 이벤트의 command_line은 systemd 매니저 자체라 무효 + argv에 토큰 혼입(§13) → 유닛화로 대체, command_line은 게이트 통과 시 스크럽 후 보완만.
- **모든 `error`를 priority로 강제 다운그레이드** — 상당수가 진짜 vLLM ERROR라 진짜 에러를 숨길 위험 → 계측 후 결정.
- **노이즈 유닛 전면 drop(motd/packagekit/apt-daily)** — 과차단·트러블슈팅 가치 손실 → 보류(필요 시 source단 include_matches).

## 결과

- 운영자가 콘솔에서 `category`로 GPU↔웹↔시스템을 즉시 분리하고, '에러·경고 상위 서비스'로 장애 주체에 빠르게 도달한다(요구 a 충족).
- 분류 규칙이 데이터(사전 파일)라 신규 서비스 추가가 코드리뷰 없이 사람 머지로 끝난다(§11).
- 산출물: `infra/logging/logstash/pipeline/service-category.yml`(사전), `keiwi-logs-ism.json`(보존), `keiwi-logs-template.json`(keyword 추가), `logs.conf` 변경은 [README](../../infra/logging/README.md)에 정확히 문서화(measure-first 게이트라 라이브 선적용 안 함, 사람이 적용).
- 미해결(→ [spec](../../specs/M2-logs/spec.md) openQuestions): GPU 가속 simulation(OpenFOAM+CUDA)이 상호배타 단일 category에서 `gpu`/`simulation` 택일이라 "GPU 주도작업" 필터에서 누락 — boolean 교차 플래그 또는 M1 gpu-model-exporter(pid↔GPU) 교차는 추후 결정. 과거 인덱스 미소급. ISM 기간(30일) 적정성.
- 참조: [ADR-0008](0008-log-pipeline.md), [spec](../../specs/M2-logs/spec.md), 헌장 §I-2/§I-3/§6/§11/§13.

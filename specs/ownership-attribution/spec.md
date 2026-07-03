# 소유 계정 귀속 (Ownership Attribution) — Spec (WHAT · WHY)

- 상태: **v1 구현**(2026-07-03) — 진행은 아래 Tasks 체크리스트.
- 권위: 이 spec은 [`Constitution.md`](../../Constitution.md)에 종속된다. 충돌 시 헌장이 이긴다. 특히 **§11(에이전트 생성·사람 적용, 읽기 전용)**.
- 유래: SRE 백로그 **#8 — 사용자/프로세스별 GPU 귀속**([specs/sre-addons/backlog.md](../sre-addons/backlog.md)). 이 문서는 #8의 **v1**(최소 귀속)이다.
- 원칙: **Spec이 진실의 원천**(헌장 §7). 행동을 바꾸려면 코드보다 이 문서를 먼저 고친다. 수용 기준은 기계 검증 가능(헌장 §9).
- 관련: 표면화는 [service-map](../service-map/spec.md)(콘솔 서비스 탭)와 `model-workload` 대시보드에 얹힌다.

> 무엇을·왜만. 코드 배치·재배포 순서(사람 손)는 아래 "적용".

---

## 목적 (WHY)

스케줄러 없는 **공유 GPU 플릿**(헌장 §6, 6장 공유자원)에서는 "이 모델/서비스가 **누구 것인가**"가 어디에도 남지 않는다. `nvidia-smi`는 PID만, dcgm은 숫자만 준다. 그래서 "data04 8003 포트 그 모델 누가 띄웠나?", "이 vLLM 누구 거라 재기동해도 되나?" 같은 문의에 **매번 SSH로 추적**해야 한다.

이 기능은 그 귀속 부재를 메운다: 이미 수집 중인 GPU 모델·리스닝 포트 메트릭에 **소유 OS 계정명(`user`) 라벨 하나**를 붙여, 문의가 오면 콘솔·대시보드에서 **즉시 식별**한다.

- **WHY — 읽기 전용(헌장 §11).** 익스포터는 관측만 한다. `user` 해석은 `/proc/<pid>/status`의 `Uid:`(world-readable)만 읽으므로 **신규 권한이 0**이다. 회수·kill·정책 집행은 하지 않는다(그건 #9/#12).
- **WHY — 최소 v1.** "선언적 소유자(팀/목적)"가 아니라 **실제 프로세스를 띄운 OS 계정**이다. 문의 대처에 충분하고, 신규 상태저장·인벤토리 확장 없이 지금 스택에 얹힌다.

---

## 계약 (라벨 이름·의미 — 전문 인용, 정확히 지킬 것)

> - 신규 라벨 이름 = **`user`** (소문자). 대상 메트릭 3개: `gpu_model_vram_bytes`, `gpu_model_info`, `keiwi_listening_port_info`.
> - 값 = 해당 PID를 소유한 **OS 계정명**. 해석 경로: `/proc/<pid>/status`의 `Uid:` 첫 값(real uid) → Python 표준 `pwd.getpwuid(uid).pw_name`.
>   - pid가 빈 문자열 / 프로세스 종료 / 파일 없음 → `"unknown"`.
>   - uid는 있으나 passwd 엔트리 없음(`KeyError`) → `"uid:<n>"`.
>   - root는 `"root"`.

해석: root=`root`, 서비스 계정은 그 계정명 그대로(문의 대처 시 "이건 systemd 서비스"임을 시사 — 사람이 아니라 유닛 소유). 라벨 값은 항상 존재하며, 미해석 시에도 `unknown`으로 채워 시리즈가 빠지지 않는다.

---

## 범위

### In (v1)
- 익스포터 2종에 `user` 라벨 추가:
  - `gpu-model-exporter` → `gpu_model_vram_bytes`, `gpu_model_info` (PID = GPU compute-app PID).
  - `port-exporter` → `keiwi_listening_port_info` (PID = 리스닝 소켓 소유 PID).
- 콘솔 **서비스 탭**(service-map): GPU 프로세스 행·리스닝 포트 행에 **소유자** 표시.
- **model-workload** 대시보드 "모델 ↔ GPU 매핑" 테이블에 **소유자** 컬럼.

### Out (v1 비범위)
- 실제 라벨/집계는 정의하되, 정책 판단·자동 조치는 없음(순수 표시).

---

## 수용 기준 (기계 검증 가능 — 헌장 §9)

**AC1 — 메트릭 라벨.** `gpu_model_vram_bytes`, `gpu_model_info`, `keiwi_listening_port_info`의 **모든 시리즈**에 `user` 라벨이 존재하고, 값 해석·폴백이 위 계약과 정확히 일치한다.
- 검증: `curl -s localhost:9836/metrics | grep -qE 'gpu_model_info\{[^}]*user='` 및 `curl -s localhost:9986/metrics | grep -qE 'keiwi_listening_port_info\{[^}]*user='` 이 모두 성공.
- 폴백: pid 빈값/종료 → `user="unknown"`, passwd 없음 → `user="uid:<n>"`, root 프로세스 → `user="root"`.

**AC2 — 콘솔 서비스 탭.** GPU 프로세스 목록과 리스닝 포트 목록의 각 행에 소유자를 표시한다. **`user`가 `"unknown"`인 행은 소유자 표기를 생략**(노이즈 억제)하되 행 자체는 유지한다.
- 검증: `prometheus.ts`의 `GpuModelAgg`·`ListeningPort`가 `user`를 파싱하고(폴백 `"unknown"`), `service-table.tsx`가 `unknown`이 아닐 때만 소유자를 렌더한다. 집계는 소유자가 다르면 분리(같은 모델도 `user`별 별도 행). 콘솔 `typecheck`·`lint`·`test`·`no-raw-hex` 통과.

**AC3 — 대시보드 컬럼.** `model-workload.json` "모델 ↔ GPU 매핑 (VRAM)" 테이블에 `user`를 **"소유자"** 컬럼으로 표시(노드 다음, GPU 앞).
- 검증: `jq '.. | .renameByName? // empty | .user' infra/monitoring/dashboards/model-workload.json` 이 `"소유자"`를 반환.

**AC4 — 신규 권한 0(헌장 §11).** `user` 해석은 익스포터에 **어떤 신규 권한·capability도 요구하지 않는다.** `/proc/<pid>/status`의 `Uid:`는 world-readable이므로, 각 익스포터가 기존에 갖던 권한(gpu-model=호스트 `/proc`+`nvidia-smi`, port=`ss -p`용 기존 특권) 외 추가가 없다.
- 검증: 익스포터 배포 매니페스트(ansible role)에 신규 권한·capability·sudoers 항목 추가가 없음(diff 무관), stdlib `pwd`만 사용.

---

## 비범위 · 후속 백로그

이 v1은 "누가 띄웠나"(관측)까지다. 다음은 **명시적으로 후속**이며 이 스펙에 넣지 않는다:

| 후속 | 백로그 | 이유 |
|---|---|---|
| **선언적 소유자**(팀·목적·도입일 — inventory 확장, 경량 CMDB) | #5 | 실제 uid가 아니라 **선언된 owner** 필드. inventory.yaml=SoT(§0) 확장 + 알림 라우팅 입력. 별도 트랙. |
| **유휴/좀비 GPU 탐지 + 넛지** | #9 | 고VRAM·저util 지속 → 알림(회수는 사람, 헌장 §11). 이 v1의 `user`를 **넛지 대상 식별**에 소비하는 소비자. |
| **per-user GPU-hours showback 리포트** | #12 | recording rule로 `user`별 GPU-hours 집계 + 주간 랭킹. 과금 아닌 가시성. 이 v1 라벨의 소비자. |

즉 #8(이 문서)은 **#9·#12의 공통 데이터 기반**이며, 정책·조치는 그쪽에서.

---

## HOW (요지 — 상세 구현은 코드)

PID → `/proc/<pid>/status`의 `Uid:` 첫 값(real uid) → `pwd.getpwuid(uid).pw_name`. 예외/미존재는 계약 폴백(`unknown` / `uid:<n>`). 두 익스포터가 **동일한 `_user_for_pid(pid)` 헬퍼**(한국어 주석, stdlib `pwd`만)를 공유 구조로 갖는다.

- `gpu-model-exporter`: compute-app PID로 해석해 `gpu_model_*` 라벨셋에 `user` 추가.
- `port-exporter`: `ss -tulnpH`로 얻은 소켓 PID로 해석해 `keiwi_listening_port_info` 라벨셋에 `user` 추가.
- 콘솔: `prometheus.ts`가 `user`를 파싱(폴백 `unknown`), 집계 키에 `user` 포함. `service-table.tsx`가 `unknown`이 아닐 때 소유자 표기.
- 대시보드: `model-workload.json` 테이블의 `organize` 변환에서 `user` → "소유자" rename + 컬럼 순서.

> 서비스 계정으로 뜬 프로세스는 그 계정명이 그대로 소유자로 잡힌다 — 문의 대처 시 "사람이 아니라 systemd 서비스"임을 자연스럽게 시사한다.

---

## 적용 (사람 손 — 헌장 §11)

에이전트는 아티팩트를 레포에 생성만 한다. 라이브 적용은 사람이 한다.

1. **익스포터 재배포** — 전 GPU/노드에 `ansible-playbook infra/ansible/playbooks/agents.yml` (gpu-model-exporter·port-exporter 롤). 멱등(§16).
2. **대시보드 바인드** — `model-workload.json`을 Grafana 프로비저닝 경로로 복사/리로드.
3. **콘솔** — `apps/console` build + restart.
4. **Prometheus 스크랩 설정 변경 불필요** — `user`는 스크랩 라벨이 아니라 **메트릭 자체가 내보내는 라벨**이라 스크랩 config를 안 건드린다.

---

## Tasks 체크리스트

- **익스포터**
  - [ ] `gpu-model-exporter`: `_user_for_pid` + `gpu_model_vram_bytes`·`gpu_model_info`에 `user` 라벨(docstring 갱신).
  - [ ] `port-exporter`: `_user_for_pid` + `keiwi_listening_port_info`에 `user` 라벨(docstring 갱신).
- **콘솔**
  - [ ] `prometheus.ts`: `user` 파싱(폴백 `unknown`) + 집계 키에 `user` 포함 + 테스트("소유자 다르면 분리").
  - [ ] `service-table.tsx`: GPU 프로세스·리스닝 포트 행에 소유자 표시(`unknown` 생략).
- **대시보드**
  - [ ] `model-workload.json` "모델 ↔ GPU 매핑"에 "소유자" 컬럼(rename·순서·width).
- **검증**
  - [ ] AC1: 두 익스포터 `/metrics`에 `user` 라벨 존재(curl grep).
  - [ ] AC2: 콘솔 `typecheck`·`lint`·`test`·`no-raw-hex` 통과.
  - [ ] AC3: `jq`로 대시보드 "소유자" rename 확인.
  - [ ] AC4: ansible 롤에 신규 권한 추가 없음 확인.

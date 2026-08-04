---
id: orphan-port-holder
kind: procedure
# 담당 알림이 **없다.** 이 장애의 신호는 알림이 아니라 침묵이다 — 자세한 것은 §1.
# 탐지 시리즈(유닛 NRestarts·실행파일 경로 대조)는 hardware-ops §3.9의 미배포 과제다.
service: keiwi-gpu-model-exporter
category: infra
affected_nodes: [data05]
first_seen: 2026-08-02
last_verified: 2026-08-03
# tier 1 = L1 제안까지.
#   ⚠️ spec §1은 이 케이스를 "**L2**(초기), 이력 후 L3 검토"로 적었다. 그런데 유일한 실질
#   조치인 `kill`은 오검출이 곧 **남의 서비스 종료**라 risk: high이고, 게이트 A5가 그런
#   런북의 상한을 1로 강제한다. 이 어긋남은 결함이 아니라 **미충족 선행조건의 표시**다:
#   "이 pid가 고아다"를 기계가 판정할 시리즈(실행파일 경로 ↔ 기대값 대조)가 아직 없어서
#   지금 L2로 올리면 승인 카드에 근거를 못 싣는다(hardware-ops §3.9 · 백로그 B02).
#   그 시리즈가 배포되고 오검출률이 실측되면 kill을 risk: medium으로 내리고 tier 2로 올린다.
#   **게이트가 야심을 막고 있는 것이 아니라, 야심의 전제가 아직 없다는 것을 기록하고 있다.**
tier: 1
actions:
  - id: find-port-holder
    title: 그 포트를 지금 누가 물고 있나 (pid가 유일한 실마리)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      sudo ss -tlnp 'sport = :9836'
  - id: check-holder-exe
    title: 그 pid의 실행파일이 우리 것인가 (경로가 다르면 고아다)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      sudo ls -l "/proc/<pid>/exe"
  - id: check-holder-age
    title: 기동 시각 — 유닛보다 오래됐으면 유닛이 만든 프로세스가 아니다
    risk: low
    reversible: true
    idempotent: true
    command: >-
      sudo ps -o pid,ppid,lstart,user,cmd -p "<pid>"
  - id: check-unit-restart-storm
    title: 관리 유닛이 몇 번이나 재시작을 시도했나 (state=failed로는 안 보인다)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      systemctl show keiwi-gpu-model-exporter -p NRestarts --value
  - id: stop-managed-unit
    title: kill 전에 관리 유닛을 먼저 멈춘다 (경쟁 방지)
    risk: medium
    reversible: true
    idempotent: true
    command: >-
      sudo systemctl stop keiwi-gpu-model-exporter
  - id: kill-orphan-pid
    title: 고아 프로세스 종료 — 판정이 틀리면 남의 서비스를 죽인다
    # 가역이다(관리 유닛이 다시 띄운다). 위험한 것은 조치가 아니라 **판정**이다.
    risk: high
    reversible: true
    idempotent: true
    command: >-
      sudo kill "<pid>"
  - id: start-managed-unit
    title: 관리 유닛 기동 (포트가 비었으니 이번엔 붙는다)
    risk: medium
    reversible: true
    idempotent: true
    command: >-
      sudo systemctl start keiwi-gpu-model-exporter
---

# 런북 · 고아 프로세스의 포트 점유 (exporter 좀비)

> **이 장애의 증상은 "이상 없음"이다.** 포트가 열려 있으니 Prometheus는 `up=1`을 보고하고,
> 대시보드는 초록이고, 아무 알림도 울리지 않는다. 그 사이 관리 유닛은 초 단위로 재시작을
> 반복하며 실패하고 있고, 정작 그 exporter가 내야 할 시리즈는 **하나도 안 나온다.**
>
> 표기 규약: `"<…>"` 자리표시자는 따옴표 안에 둔다(게이트 R10).

> [!CAUTION] 실제 사고 (data05, 2026-08-02 실측)
> `keiwi-gpu-model-exporter`의 재시작 카운터가 **431,899**였다. 사유는 전부
> `Address already in use`. 포트 `:9836`을 물고 있던 것은 **6월 9일에 뜬 다른 프로세스**
> (pid 2580064, 50일째)였고 그 실행파일은 **KEIwi 레포의 것이 아니었다**.
> 같은 노드 `:8003`에도 6월 16일 기동한 구 모델 프로세스가 남아 있었다.
>
> 그 결과 data05의 `gpu_vram_total_bytes` 시리즈가 **통째로 없었고**, 그것에 의존하는
> ADR-0013 판정이 `unknown`으로 조용히 무력화됐다. **43만 번의 실패가 어떤 알림도
> 만들지 않았다** — 이것이 이 런북이 존재하는 이유다.

## 1. 왜 어떤 알림도 울리지 않았나 (탐색 제외 규칙)

이 장애를 조사할 때 **다음 신호들은 전부 "정상"을 말한다. 근거로 쓰지 마라.**

| 보고 있으면 안 되는 신호 | 왜 무력한가 |
| --- | --- |
| `up{job="…"}` == 1 | **포트가 열려 있으면 1이다.** 누가 열었는지는 보지 않는다 |
| `systemctl is-active` | 재시작 루프의 `activating` 순간에도 `active`처럼 읽힌다 |
| `node_systemd_unit_state{state="failed"}` | 크래시루프는 `failed`가 아니라 `activating (auto-restart)`다 — **원리적으로 못 잡는다** |
| exporter `/metrics`가 200을 준다 | 고아가 응답하는 것이다. **내용이 비어 있는지**를 봐야 한다 |
| 대시보드가 초록 | 시리즈 **부재**는 대부분의 패널에서 "빈 그래프"이지 빨강이 아니다 |

**유효한 신호는 셋뿐이다**: ① 유닛 `NRestarts` ② 포트 소유 pid의 **실행파일 경로**
③ 기대 시리즈의 **부재**(`count(...) == 0`). ①②는 아직 메트릭이 없어(hardware-ops §3.9)
사람이 §2로 확인해야 한다.

> **의심의 출발점은 대개 ③이다** — "이 노드만 이 시리즈가 없다"는 관찰. 그 관찰을
> `up=1`로 반박당하는 순간 조사가 멈추므로, 위 표를 먼저 읽는 것이 중요하다.

## 2. 판별 (읽기 전용 — 여기서 "고아인가"가 갈린다)

```bash
# ① 포트를 물고 있는 pid (예: gpu-model-exporter의 9836. port-exporter는 9986, vLLM은 8003)
sudo ss -tlnp 'sport = :9836'

# ② 그 pid의 실행파일 — **이 한 줄이 판정의 핵심이다**
sudo ls -l "/proc/<pid>/exe"

# ③ 언제 떴나 · 누구 것인가
sudo ps -o pid,ppid,lstart,user,cmd -p "<pid>"
```

**판정표**

| ②의 경로 | ③의 기동 시각 | 판정 |
| --- | --- | --- |
| 기대 경로(`/opt/keiwi/…`)와 **다름** | 유닛보다 **이르다** | **고아 확정** → §3 |
| 기대 경로와 같음 | 유닛보다 이르다 | 유닛 밖에서 손으로 띄운 같은 프로그램. 소유자 확인 후 §3 |
| 기대 경로와 같음 | 유닛 기동 시각과 **일치** | **정상이다.** 다른 원인을 찾아라 — 여기서 나간다 |
| `ppid`가 1이 아니고 부모가 연구자 셸/노트북 | — | **연구자 프로세스일 수 있다.** kill 금지 → 소유자 통보 |

```bash
# ④ 관리 유닛 쪽 증거 — 몇 번 실패했고 사유가 무엇인가
systemctl show keiwi-gpu-model-exporter -p NRestarts --value
sudo journalctl -u keiwi-gpu-model-exporter -n 20 --no-pager | grep -c 'Address already in use'
```

`NRestarts`가 수천 이상이고 사유가 `Address already in use`면 ①②의 판정과 맞물려
**고아 점유가 확정**된다. 이 두 값이 없으면 아래로 내려가지 마라.

```bash
# ⑤ 거짓 초록의 확인 — up은 1인데 시리즈는 없다
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=up{job="gpu-model-exporter"}'
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=count(gpu_vram_total_bytes)'
```

## 3. 조치 (순서가 곧 안전장치다)

> **kill 전에 §2의 판정표에서 "고아 확정"이 나왔어야 한다.** 이 절차의 위험은
> 명령이 아니라 **판정**에 있다 — `kill` 자체는 유닛이 되살리므로 가역이지만,
> 잘못 지목한 대상이 연구자 서비스면 그건 되살아나지 않는다.

1. **소유자 확인** — 그래도 한 번 더 본다.
   ```bash
   curl -sG localhost:9090/api/v1/query --data-urlencode 'query=keiwi_listening_port_info'
   ```
   `user` 라벨이 관리 계정이 아니면 **멈추고 통보한다**(헌장 §11).
2. **관리 유닛을 먼저 멈춘다.** 안 멈추면 kill 직후 재시작 루프가 포트를 두고 경쟁한다.
   ```bash
   sudo systemctl stop keiwi-gpu-model-exporter
   ```
3. **고아만 종료.**
   ```bash
   sudo kill "<pid>"
   ```
   **`-9`를 쓰지 마라.** 기본 SIGTERM으로 안 죽으면 그것은 "더 센 신호가 필요하다"가
   아니라 **판정이 틀렸다는 신호**일 수 있다 — 멈추고 §2로 돌아간다.
4. **관리 유닛 기동.**
   ```bash
   sudo systemctl start keiwi-gpu-model-exporter
   ```
5. **검증** — 포트 소유자가 바뀌고, 없던 시리즈가 돌아와야 끝이다.
   ```bash
   sudo ss -tlnp 'sport = :9836'
   systemctl show keiwi-gpu-model-exporter -p NRestarts --value
   curl -sG localhost:9090/api/v1/query --data-urlencode 'query=count(gpu_vram_total_bytes)'
   ```
   `NRestarts`는 리셋되지 않는다(카운터다). **줄어드는 것이 아니라 멈추는 것**을 본다.

**하지 말 것**

- `up=1`을 근거로 이 절차를 건너뛰기(§1).
- 판정 없이 포트를 물고 있다는 이유만으로 kill — data05 `:8003`의 고아는 **어시스턴트가
  실제로 쓰고 있던 모델**이었다. 죽이면 모델이 바뀐다(hardware-ops Q9).
- `kill -9`로 밀어붙이기(§3-3).
- **노드 재부팅으로 한 번에 해결하기.** 고아는 사라지지만 원인과 증거도 함께 사라지고,
  재부팅은 Tier0다([reboot-required-stale.md](./reboot-required-stale.md)).

## 4. 사후 · 재발 방지

- **무엇이 그 포트를 물고 있었는지 원문을 남긴다** — 실행파일 경로·기동 시각·소유자.
  이 정보는 프로세스를 죽이는 순간 사라지고, 그러면 "왜 생겼는지"를 영영 못 배운다.
- **탐지를 만든다.** 이 런북이 사람 손에 남아 있는 한 다음 43만 번도 조용할 것이다.
  필요한 것은 두 개이고 둘 다 hardware-ops §3.9의 과제다:
  - 리스닝 프로세스의 **실행파일 경로를 기대값과 대조**하는 메트릭(port-exporter 확장)
  - 유닛 **`NRestarts` 또는 `activating` 지속** 시리즈 — `state="failed"`로는 못 잡는다
- 그 둘이 생기면 이 런북의 `kill-orphan-pid`를 `risk: medium`으로 내리고 `tier: 2`로
  올린다(frontmatter 주석 참조). **그 전에는 올리지 않는다** — 승인 카드에 실을 근거가 없다.
- 같은 노드에서 반복되면 개별 프로세스가 아니라 **유닛 밖에서 프로그램을 띄우는 관행**이
  원인이다. systemd 유닛으로 수렴시키는 것이 근본 처방이다
  ([node-onboarding.md](./node-onboarding.md) §3).

## 관련

- [node-down.md](./node-down.md) — 반대 증상(포트가 안 열림). 이쪽은 **열려 있는데 가짜**다
- [node-hygiene-coverage-gap.md](./node-hygiene-coverage-gap.md) — 시리즈 부재를 다루는 자매 런북
- [reboot-required-stale.md](./reboot-required-stale.md) — 재부팅으로 덮지 않는 이유
- [specs/hardware-ops](../../specs/hardware-ops/spec.md) §3.9 — 은폐 구조 제거(탐지 설계 정본)

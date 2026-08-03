---
id: gpu-xid
kind: alert
alerts: [GpuXidErrorNew, GpuXidCritical]
service: dcgm-exporter
category: gpu
severity: critical
signature: "NVRM: Xid"
affected_nodes: [data03, data04, data05]
last_verified: 2026-08-03
---

<!-- alerts의 GpuXidCritical은 아직 배포되지 않았다(hardware-ops spec.md:448, T4-2 예정).
     게이트 R8이 "미존재 alertname"으로 WARN을 내는 것이 정상이며 FAIL이 아니다. -->

# 런북 · GPU XID 에러 (GpuXidErrorNew / GpuXidCritical)

> **XID는 GPU 드라이버가 내는 오류 코드다.** 하드웨어 고장일 수도, 사용자 커널의 잘못된
> 메모리 접근일 수도 있다. **이 알림 하나로는 둘을 구분할 수 없다** — 구분은 §2에서 원문
> 로그를 봐야 생긴다. 그 전에 노드를 재부팅하면 증거가 사라지고 원인은 영영 미상이 된다.

> 표기 규약: 이 문서의 `"<…>"` 는 사람이 바꿔 넣는 자리표시자다. **따옴표 안에 둔다** —
> 벗기면 bash가 `<`를 입력 리다이렉션으로 파싱한다(게이트 R10이 검사).

## 1. 이 알림이 말하는 것 / 말하지 않는 것

발화식은 `changes(DCGM_FI_DEV_XID_ERRORS[30m]) > 0` — **값이 아니라 변화**다.

`DCGM_FI_DEV_XID_ERRORS`의 공식 정의는 "Value of the **last** XID error encountered"다.
즉 **latched 게이지**이고 다음이 전부 없다:

| 없는 것 | 결과 |
| --- | --- |
| 발생 **횟수** | 같은 코드가 100번 재발해도 값은 그대로다 → 재발을 메트릭으로 못 센다 |
| 발생 **시각** | 값이 언제 박혔는지 메트릭만으로는 알 수 없다 |
| **프로세스**(pid/name) | 누가 일으켰는지 메트릭에 없다 → 원문 로그가 유일한 근거(§2) |
| 초기화 | 재부팅 전까지 남는다 |

**[실측 2026-08-03]** `DCGM_FI_DEV_XID_ERRORS` → data05(A40) gpu0·gpu1 = **43**, data04·data03(Quadro RTX 6000) = **0**.
data05의 43은 **2026-06-01**에 박힌 값이고 `count(changes(DCGM_FI_DEV_XID_ERRORS[24h])>0)` = 빈 벡터다.

> **값이 0이 아니라는 이유로 재조사하지 마라.** data05의 43은 이미 판정이 끝난 과거 사건이다
> (§3 사례). `> 0` 비교로 규칙을 바꾸면 그 순간부터 영구 발화한다 — 그래서 `changes()`를 쓴다.

**이 알림이 실제로 말하는 것**: "지난 30분 안에 이 GPU의 마지막 XID 코드가 **바뀌었다**" = 새 XID가 방금 발생했다.

## 2. 30초 판별 — 코드 읽고 원문과 대조 (여기서 HW/앱이 갈린다)

**두 개를 같이 봐야 판정이 된다.** (a)만 보면 코드는 알지만 원인 프로세스를 모르고,
(b)만 보면 어느 물리 GPU인지 라벨로 확정되지 않는다.

```bash
# (a) 코드: 어느 GPU가 무슨 코드인가 (data05에서 실행 — Prometheus 로컬)
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=DCGM_FI_DEV_XID_ERRORS'
```

```bash
# (b) 원문: pid/name은 여기에만 있다
#     알림의 instance(192.168.1.10N:9400) → fleet_node=data0N 로 바꿔 넣는다(docs/inventory.yaml).
NODE=data05
curl -s "localhost:9200/keiwi-logs-*/_search" -H 'Content-Type: application/json' -d "{
  \"size\":20,\"sort\":[{\"@timestamp\":\"desc\"}],
  \"query\":{\"bool\":{\"must\":[
    {\"match_phrase\":{\"message\":\"NVRM: Xid\"}},
    {\"term\":{\"fleet_node\":\"$NODE\"}},
    {\"range\":{\"@timestamp\":{\"gte\":\"now-24h\"}}}]}},
  \"_source\":[\"@timestamp\",\"fleet_node\",\"message\"]}"
```

**읽는 법** — 실제로 돌아온 줄(2026-06-01, data05):

```text
NVRM: Xid (PCI:0000:2b:00): 43, pid=146239, name=VLLM::Worker, channel 0x00000008
NVRM: Xid (PCI:0000:a2:00): 43, pid=146240, name=VLLM::Worker, channel 0x00000008
```

| 토큰 | 뜻 |
| --- | --- |
| `PCI:0000:2b:00` | **물리 GPU 주소**. `nvidia-smi -q \| grep -A2 'GPU 0000'`로 gpu 인덱스와 대조 |
| `43` | **분기 키** — §3 표로 간다 |
| `pid=…, name=…` | **원인 프로세스 후보**. 이게 붙어 있으면 앱 레벨 후보다 |
| `channel 0x…` | GPU 채널 번호. 참고용(같은 채널 반복이면 같은 컨텍스트) |

**함정 2개 (모르면 "로그가 없다"는 오판을 한다)**

1. **`service`가 `unknown`이다.** 커널 메시지라 systemd 유닛이 없다 → 콘솔 `/logs`의 서비스
   패싯으로는 절대 못 찾는다. **`message` 구문검색(`match_phrase`)만 유효**하다.
2. **`node` 라벨은 data03 계열에만 있다**(`infra/monitoring/prometheus.yml`의 스크랩단 부여).
   data04·data05 시리즈에는 `node`가 없고 `instance` IP만 있다 → 알림 본문의 instance를
   `docs/inventory.yaml`로 노드명에 매핑한 뒤 OpenSearch의 `fleet_node`에 넣는다.
3. **(b)가 0건이면 창을 넓혀라.** 이 메트릭은 latched라 값이 몇 달 전 것일 수 있다 — data05의
   43은 **2026-06-01**이고 `now-24h`로는 안 나온다. `gte`를 `now-90d`로 바꾸거나 range 절을
   통째로 빼고 다시 조회한다. 그래도 0건이면 §4의 "원문이 없을 때"로 간다.

## 3. Xid 코드 분기표

| Xid | 뜻 | 1차 판정 | 첫 조치 |
| --- | --- | --- | --- |
| **13 · 31 · 43** | illegal address / GPU stopped processing | **앱 레벨**(사용자 커널의 잘못된 메모리 접근)이 일반적 | pid 소유자 확인(§5) → **해당 잡만** 재시작. **노드 재부팅 금지** |
| **48** | DBE(double-bit ECC) | 하드웨어 | remapped rows 확인(§4) → 교체 검토 |
| **63 · 64** | row remap 발생 / 실패 | 하드웨어 | 정비창 재부팅으로 remap 반영, 실패(64)면 교체 |
| **74** | NVLink 오류 | 하드웨어 / 배선 | 물리 점검 |
| **79** | GPU has fallen off the bus | 하드웨어 / 전원·PCIe | 전원·라이저 점검. 이 코드는 GPU가 이미 사라진 상태다 |
| 그 외 | — | NVIDIA Xid 표 대조 | **원문에 `pid`가 있으면 앱 쪽부터** |

> **KEIwi가 실제로 본 코드는 43 하나뿐이다.** 원문 4건(2026-06-01, data05 GPU 2장)에
> `pid=146239/146240, name=VLLM::Worker`가 붙어 있었다 → **1차 판정: 앱 레벨.**
> `infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml`의 옛 주석은 이 43을
> "드라이버 mismatch 사태의 흔적"이라고 단정했으나 **원문에 그 근거가 없다** — 드라이버
> mismatch는 별개의 시그니처(`NVRM: API mismatch`)로 지금도 진행 중이다(§4). 주석은 교정됐다.
>
> **단정하지 않는 이유**: 근거가 원문 4건뿐이다. 아래 승격 조건에 걸리면 HW 의심으로 올린다.

**앱 → HW 승격 조건** (하나라도 해당하면 §6의 HW 경로)
- 24시간 안에 **같은 GPU**에서 3회 이상 재발
- 원문에 `pid`/`name`이 **없다**(커널·드라이버 자체 오류일 가능성)
- 서로 다른 사용자·프레임워크의 잡에서 같은 GPU만 반복해서 죽는다

## 4. 하드웨어 확증 — 있는 신호와 없는 신호 (실측)

```bash
# 확증 3종 (data05에서 실행). 전부 0이면 "지금은 하드웨어 증거 없음"이다.
for m in DCGM_FI_DEV_UNCORRECTABLE_REMAPPED_ROWS DCGM_FI_DEV_ROW_REMAP_FAILURE DCGM_FI_DEV_PCIE_REPLAY_COUNTER; do
  echo "== $m"
  curl -sG localhost:9090/api/v1/query --data-urlencode "query=$m" \
    | python3 -c "import sys,json;[print(' ',s['metric'].get('instance'),'gpu'+s['metric'].get('gpu',''),s['value'][1]) for s in json.load(sys.stdin)['data']['result']]"
done
```

**[실측 2026-08-03]** 세 지표 전부 **0**. 그리고 **비대칭이 있다**:

| 신호 | data05 (A40 ×2) | data03·data04 (Quadro RTX 6000 ×4) |
| --- | --- | --- |
| `UNCORRECTABLE_REMAPPED_ROWS` | 있음 (0) | **없음** |
| `ROW_REMAP_FAILURE` | 있음 (0) | **없음** |
| `PCIE_REPLAY_COUNTER` | 있음 (0) | 있음 (0) |
| ECC SBE/DBE 계열 | **없음** (현 DCGM csv 미포함) | **없음** |

> **RTX 6000에는 row remapping 기능 자체가 없다.** 즉 data03·data04의 XID는 **확증할 메트릭
> 경로가 존재하지 않는다** — 원문 로그 + 해당 노드 `dmesg` + **재현성**이 유일한 근거다.
> "메트릭이 0이니 하드웨어는 멀쩡하다"는 이 두 노드에서 **성립하지 않는 추론**이다.

**원문이 없을 때(§2의 (b)가 계속 0건)** — 해당 노드에서 직접 본다:

```bash
ssh -p 764 "<user>@<node-ip>"        # 예: ssh -p 764 mhchoi@192.168.1.104
sudo dmesg -T | grep -i 'NVRM: Xid' | tail -20
nvidia-smi -q | grep -iE 'Remapped Rows|Retired Pages|ECC Errors' -A3 | head -40
```

**DCGM으로 판별할 수 없는 것 — 드라이버 mismatch**

XID와 혼동하기 쉬운 별개 장애다. `nvidia-smi`가 exit 18로 죽고 커널 로그에
`NVRM: API mismatch`가 쌓이지만 **DCGM 메트릭은 아무 변화도 보이지 않는다.**
data05가 지금도 이 상태다 — **[실측 2026-08-03] 최근 1시간 720건 · 24시간 17,283건.**

```bash
# 지금 mismatch가 흐르고 있는가 (0이어야 정상)
curl -s "localhost:9200/keiwi-logs-*/_count" -H 'Content-Type: application/json' \
 -d '{"query":{"bool":{"must":[{"match_phrase":{"message":"NVRM: API mismatch"}},
     {"range":{"@timestamp":{"gte":"now-1h"}}}]}}}'
```

이 값이 크면 XID와 **원인이 다른** 문제가 병행 중이다 → `nvidia-driver-mismatch.md`
(hardware-ops T0-3 산출)를 함께 본다. **둘을 혼동해 재부팅하면 XID 증거만 잃고 mismatch는
그대로 남는다** — 순서는 "XID 원문 확보 → mismatch 처리"다.

## 5. 누가 쓰고 있나 (파괴적 조치 전 **필수**)

```bash
# GPU를 점유 중인 프로세스와 소유자 (user 라벨이 소유자다)
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=gpu_model_info' \
  | python3 -c "import sys,json;[print(m['node'],'gpu'+m['gpu'],m['user'],m['framework'],m['model'],'pid='+m['pid']) for m in (s['metric'] for s in json.load(sys.stdin)['data']['result'])]"
```

**[실측 2026-08-03]** 예: `data04 gpu0 mhchoi ollama ollama pid=391942`, `data04 gpu0/1 mhchoi uvicorn 04_rag_api`.

> **연구 잡을 죽이기 전에 소유자에게 통보한다(헌장 §11 — 자동 종료 금지).**
> 재현 불가능한 학습·추론이 돌고 있을 수 있고, XID 43은 대개 그 잡 하나만 재시작하면 끝난다.
> data05처럼 exporter가 붙지 않은 노드면 `ssh` 후 `nvidia-smi`의 프로세스 표로 확인한다.

## 6. 조치 트리 (파괴 강도 순 — 위에서 아래로만 내려간다)

1. **앱 판정**(§3에서 13/31/43 + 원문에 pid 있음)
   → 소유자 통보 → **해당 프로세스만** 재시작. 노드·드라이버는 건드리지 않는다.
2. **24h 내 같은 GPU에서 3회 반복**
   → 해당 GPU 배제 안내(사용자에게 "이 카드 쓰지 마세요") + 인시던트 기록 → HW 경로로 승격.
3. **HW 코드**(48/63/64/74/79) 또는 승격됨
   → ① 잡 대피(소유자 합의) → ② **정비창** 재부팅(remap 반영·latch 해제)
   → ③ 재부팅 후에도 재발하면 교체 요청. RTX 6000은 확증 메트릭이 없으므로 **재현성**이 근거다.
4. **79(fallen off the bus)만 예외** — GPU가 이미 응답하지 않으므로 프로세스 재시작이 무의미하다.
   잡 대피 후 곧바로 3번으로 간다.

**하지 말 것**
- 원문 로그 확보 **전** 재부팅 (latch 값과 dmesg가 함께 사라진다)
- 소유자 통보 없이 프로세스 kill
- `>0` 비교로 알림 규칙 변경 (data05가 첫날부터 영구 발화)

## 7. 사후

- **재발화하지 않는 것이 정상이다.** latched 값은 재부팅 전까지 남고 `changes()`는 변화만
  본다 → 조치 후 알림이 조용해도 "값이 아직 43인데?"로 놀라지 않는다.
- **판정 근거(원문 1줄)를 인시던트에 남긴다.** data05의 43이 앱 레벨이라는 결론은
  `name=VLLM::Worker` 한 줄이 전부다. 이걸 안 적으면 다음 사람이 같은 43을 처음부터
  다시 조사한다 — 이 런북이 존재하는 이유다.
- 재부팅으로 latch를 지웠다면 그 시각을 남긴다(그 전 값은 되살릴 수 없다).
- 로그 보존은 365일(M2) — 그 이후 원문은 사라진다. 판정 근거를 문서에 옮겨두는 편이 안전하다.

## 관련

- [gpu-thermal.md](./gpu-thermal.md) — 과열·스로틀(다른 신호, 다른 조치)
- `docs/runbooks/nvidia-driver-mismatch.md` — 드라이버 mismatch (hardware-ops T0-3 예정)
- [specs/hardware-ops](../../specs/hardware-ops/README.md) — XID 카운터(`DCGM_EXP_XID_ERRORS_COUNT`) 도입 계획
- [node-onboarding.md](./node-onboarding.md) §2.5 — 노드 접속·검증 절차

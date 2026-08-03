---
id: gpu-thermal
kind: alert
alerts: [GpuTempHigh]
service: dcgm-exporter
category: gpu
severity: warning
affected_nodes: [data03, data04, data05]
last_verified: 2026-08-03
---

# 런북 · GPU 과열 (GpuTempHigh)

> **"뜨겁다"는 증상이지 장애가 아니다.** 진짜 문제는 **성능이 깎이는가**(스로틀링)이고,
> 그 신호는 지금 우리 DCGM csv에 없다(§2). 이 알림은 그 대리 지표이며, 여유가 **2°C**밖에
> 없다는 것을 알고 읽어야 한다.

> 표기 규약: `"<…>"` 자리표시자는 따옴표 안에 둔다(게이트 R10).

## 1. 이 알림이 말하는 것 / 말하지 않는 것

발화식은 `DCGM_FI_DEV_GPU_TEMP > 92` **10분 지속**.

**말하는 것**: 이 GPU가 10분 넘게 92°C를 넘었다.
**말하지 않는 것**: 카드가 실제로 클럭을 낮췄는지(=연구 잡이 느려졌는지). 그건 §2에서 따로 본다.

**임계 근거와 현재 여유 [실측 2026-08-03]** — `max_over_time(DCGM_FI_DEV_GPU_TEMP[30d])`:

| 노드 | GPU0 | GPU1 | 카드 |
| --- | --- | --- | --- |
| data04 | 81 | **90** ← 최댓값 | Quadro RTX 6000 |
| data05 | 71 | 77 | A40 |
| data03 | 50 | 42 | Quadro RTX 6000 |

30일 최대 = **90°C(data04 GPU1)** → 92 임계까지 **여유 2°C**.

> 이전에 85°C였다가 92°C로 올렸다(2026-07-30). 85는 정상 연구 부하에서 상시 발화하는
> 결함이었다 — 설정 당시 **유휴값 50°C만 보고 부하 분포를 안 본 실수**다.
> 그 이력 주석은 `alert-rules.yaml`에 그대로 남겨둔다(지우면 92의 근거가 사라진다).
>
> **여유가 2°C라는 뜻**: 재발화가 잦아지면 임계를 또 올릴 게 아니라 **공조·부하·먼지를
> 의심하라.** 임계를 올리는 것은 온도계를 부수는 것과 같다. 90은 이미 카드 사양 한계
> 근처이고, 여기서 임계를 올리면 남는 안전 마진이 없다.

## 2. 30초 판별 — 진짜 스로틀링인가

```bash
# ① 지금 온도 (알림 대상 GPU 확인)
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=DCGM_FI_DEV_GPU_TEMP' \
  | python3 -c "import sys,json;[print(s['metric'].get('instance'),'gpu'+s['metric'].get('gpu',''),s['value'][1]+'C') for s in json.load(sys.stdin)['data']['result']]"

# ② 스로틀 대체 판별 — 클럭이 떨어졌는데 사용률은 유지되면 스로틀 의심
#    (DCGM_FI_DEV_CLOCK_THROTTLE_REASONS가 현 csv에 없어 직접 판정이 불가하다)
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=DCGM_FI_DEV_SM_CLOCK'
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=DCGM_FI_DEV_GPU_UTIL'
```

**판독표**

| SM_CLOCK | GPU_UTIL | 판정 |
| --- | --- | --- |
| **급락**(예 1700 → 900) | **유지**(높음) | **스로틀 의심** — 열이 실제로 성능을 깎고 있다 → §4 |
| 급락 | 함께 0으로 | 정상 — 잡이 끝난 것이다. 온도도 곧 떨어진다 |
| 유지(높음) | 유지 | 아직 안 깎였다 — 감시만. 단 92°C 지속은 수명에 나쁘다 |
| 낮음(≈300) | 0 | 유휴. 알림이 살아 있다면 해제 대기 중이다 |

**[실측 2026-08-03 기준선]** 유휴 SM_CLOCK: data04·data03 = **300**, data05 = **1740**(잡 상주).
즉 "300이면 유휴"라는 판정은 RTX 6000 두 노드에만 쓴다 — 카드마다 유휴 클럭이 다르다.

**쓰면 안 되는 신호**

| 지표 | 왜 안 되나 [실측] |
| --- | --- |
| `DCGM_FI_DEV_MEMORY_TEMP` | data05(A40)에서 **0을 보고**하고 data03·data04(RTX 6000)엔 **시리즈 자체가 없다**. 0을 "메모리는 시원하다"로 읽으면 오판이다 |
| `DCGM_FI_DEV_CLOCK_THROTTLE_REASONS` | **현 csv에 없다**(빈 벡터). 있는 척 쿼리를 짜면 no-data가 조용히 통과한다 — hardware-ops T6-4에서 csv 확장 예정 |

## 3. 원인 분기

| 관찰 | 1차 원인 | 확인 |
| --- | --- | --- |
| 한 노드의 **모든** GPU가 동시에 뜨겁다 | 공조·흡배기(랙 온도, 먼지, 팬 고장) | 물리 확인 + `sensors`/BMC inlet 온도 |
| **한 장만** 뜨겁다 | 그 카드의 부하 편중 또는 팬·써멀 열화 | §4 소유자 확인 → 부하 분산 |
| 최근에 새 잡이 붙은 뒤부터 | 부하 증가(정상 동작) | `gpu_model_info`로 언제 뭐가 붙었는지 |
| 유휴인데 뜨겁다 | 팬 고장·먼지·주변 온도 | **하드웨어 점검 우선** |

```bash
# 카드 자체의 스로틀·셧다운 임계 확인 (해당 노드에서)
ssh -p 764 "<user>@<node-ip>"        # 예: ssh -p 764 mhchoi@192.168.1.104
nvidia-smi -q -d TEMPERATURE
nvidia-smi -q -d PERFORMANCE | grep -iA6 'Clocks Event Reasons\|Clocks Throttle Reasons'
```

> **KEIwi는 이 값을 아직 측정하지 않았다.** 그래서 이 런북은 명령만 제공하고
> "RTX 6000의 슬로다운 임계는 N°C다" 같은 숫자를 **단정하지 않는다.**
> 처음 실행한 사람은 결과를 이 절에 적어 넣어라(그때 `last_verified`도 갱신).

## 4. 조치 (파괴 강도 순)

1. **소유자 확인** — 누가 이 GPU를 쓰고 있는가.
   ```bash
   curl -sG localhost:9090/api/v1/query --data-urlencode 'query=gpu_model_info' \
     | python3 -c "import sys,json;[print(m['node'],'gpu'+m['gpu'],m['user'],m['framework'],m['model']) for m in (s['metric'] for s in json.load(sys.stdin)['data']['result'])]"
   ```
2. **부하 조정 협의** — 배치 크기·동시 잡 수를 줄이거나 다른 카드로 분산. **통보 후 사람이 한다**(§11).
3. **물리 점검**(유휴인데 뜨겁다 / 노드 전체가 뜨겁다) — 흡기구 먼지, 팬 RPM, 랙 흡기 온도.
4. **파워리밋 조정 `nvidia-smi -pl <W>`** — **연구 성능에 직접 영향**을 준다.
   **사람 판단 + 사전 공지 필수. 자동화 금지(헌장 §11).** 되돌릴 때도 같은 절차다.

**하지 말 것**
- **임계를 92에서 더 올리는 것** — 여유 2°C는 "임계가 낮다"가 아니라 "카드가 한계 근처"라는 뜻이다.
- 소유자 통보 없이 잡 종료 또는 파워리밋 변경.
- `MEMORY_TEMP`가 0인 것을 근거로 "괜찮다" 판정(§2).

## 5. 사후·재발방지

- 발화 구간의 `GPU_TEMP`·`SM_CLOCK`·`GPU_UTIL`을 함께 캡처해 인시던트에 남긴다
  (스로틀 여부는 **사후에는 재구성이 어렵다** — 클럭 급락은 순간이다).
- 같은 GPU가 월 3회 이상 발화하면 임계 조정이 아니라 **배치·공조 재검토** 안건으로 올린다.
- `CLOCK_THROTTLE_REASONS`가 csv에 들어오면(hardware-ops T6-4) §2의 대체 판별을 **직접 판별로
  교체**하고 이 절을 지운다. 대체 판별은 임시 수단이다.

## 관련

- [gpu-xid.md](./gpu-xid.md) — XID 에러(다른 신호). 과열이 XID를 유발하기도 한다(79 등)
- [specs/hardware-ops](../../specs/hardware-ops/README.md) — DCGM csv 확장(스로틀·ECC) 계획
- `infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml` — 임계 정본과 이력 주석

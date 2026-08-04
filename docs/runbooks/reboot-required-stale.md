---
id: reboot-required-stale
kind: alert
alerts: [RebootRequiredStale]
service: node-hygiene
category: infra
severity: warning
signature: "node_reboot_required"
affected_nodes: [data03, data04, data05]
last_verified: 2026-08-03
# tier 0 = 사람 전용. **재부팅은 spec §4.5의 Tier0 고정 항목 1번**이다 — 비가역이고 그 노드의
#   전 워크로드를 중단시킨다. 아래 reboot-node는 화이트리스트에서 **빼지 않고 남겨 둔다**:
#   숨기면 L1이 "재부팅하세요"를 자유 텍스트로 짓게 되고, 그러면 위험 라벨도 근거번호도
#   붙지 않는다. risk:high + reversible:false + idempotent:false 로 정직하게 적어 두면
#   게이트 A5가 이 런북의 상한을 강제로 0~1에 묶고, L3 정책 로더도 등재를 거부한다(AC-L3-8).
tier: 0
actions:
  - id: check-reboot-debt
    title: 지금 재부팅 부채가 있는 노드
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -sG localhost:9090/api/v1/query --data-urlencode 'query=node_reboot_required == 1'
  - id: check-pending-packages
    title: 무엇 때문에 대기 중인가 (커널? glibc?)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      cat /run/reboot-required.pkgs
  - id: find-owner-gpu
    title: 누가 쓰고 있는지 먼저 본다 (예고 없이 죽이지 않는다)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -sG localhost:9090/api/v1/query --data-urlencode 'query=gpu_model_info'
  - id: reboot-node
    title: 재부팅 — 정비창에 사람이. 자동경로 영구 제외(Tier0)
    risk: high
    reversible: false
    idempotent: false
    command: >-
      sudo reboot
---

# 런북 — RebootRequiredStale (재부팅 부채가 14일 넘게 방치)

> [!IMPORTANT]
> **이 알림은 아직 켜져 있지 않다.** 규칙은 `alert-rules.yaml`에 **의도적으로 없다** — 지금 켜면
> 첫날부터 2~3건이 상주 발화하기 때문이다. 승격 조건과 절차가 §5에 있고, 그 전까지 이 문서는
> **부채를 청산하는 절차서**로 쓴다. (fleet-hardening T1-13 → T1-14)

## 1. 이 알림이 말하는 것 / 말하지 않는 것

승격 후 발화식: `min_over_time(node_reboot_required[14d]) == 1`, for 15m.

- **말하는 것**: 이 노드는 **14일 내내 한 번도** 재부팅 대기 상태를 벗어난 적이 없다.
- **말하지 않는 것**: 부채가 정확히 며칠 됐는지. 나이는 `0→1` 전이 시각으로만 알 수 있고, 그것도 TSDB 보존(30d) 안에 전이가 들어 있을 때만이다. 창(`min7d`/`min14d`/`min30d`) 3개가 나이를 **구간으로** 묶어줄 뿐이다.
- **말하지 않는 것 2**: 드라이버가 깨졌는지. `node_reboot_required`는 드라이버 사고의 **예측 신호가 아니다** — 실측 반증: data05의 `/run/reboot-required.pkgs`에는 nvidia 패키지가 **없는데** `dpkg -l`은 nvidia-driver-595가 595.84로 설치돼 있었다. apt가 드라이버 업그레이드를 그 파일에 기록하지 않는다. 드라이버 판정은 `node_nvidia_version_mismatch`가 정본이다.

### `for: 14d`가 아니라 `min_over_time(...[14d])`인 이유

Grafana/Prometheus가 재시작하면 pending 상태가 리셋된다. `for: 14d`는 14일 무중단 평가를 요구하므로 **영원히 발화하지 않는 죽은 규칙**이 된다. `min_over_time`은 저장된 시계열을 보므로 재시작에 영향받지 않는다. 보존 30d > 창 14d 확인됨(`docker-compose.yml`의 `--storage.tsdb.retention.time=30d`).

### 임계 14일은 실측이 아니라 **정책값**이다

연구 GPU 노드의 재부팅은 사고 대응이 아니라 **예약 작업**이고, 정비창을 잡는 데 2주면 충분하다는 운영 판단이다. 근거 없는 수치를 실측인 양 쓰지 않기 위해 명시한다.

실측 분포는 이 값을 **고를 수 없다**는 것만 알려준다 [2026-08-02]:

| `count(min_over_time(node_reboot_required[Xd]) == 1)` | X=7d | X=14d | X=30d |
|---|---|---|---|
| 값 | 2 | 2 | **1** |

`node_reboot_required offset 31d`는 **빈 벡터**다(보존 30d 밖). 즉 X>30d는 표현 자체가 불가능하고 `min[60d]` ≡ `min[30d]`다. **표현 가능한 상한(30d)에서도 발화가 1건**이므로 어떤 임계를 골라도 day-1 발화 0을 만들 수 없다. 그리고 발화를 피하려고 임계를 올리는 것은 임계 근거가 아니다. → 임계가 아니라 **적용 시점**을 미룬다.

## 2. 30초 판별

```bash
# (a) 지금 부채가 있는 노드
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=node_reboot_required == 1'

# (b) 부채의 "굵기" — 창별로 보면 나이가 구간으로 묶인다
for w in 7d 14d 30d; do
  echo "== min_over_time[$w] =="
  curl -sG localhost:9090/api/v1/query \
       --data-urlencode "query=min_over_time(node_reboot_required[$w]) == 1"
done

# (c) 무재부팅 기간(일) — 부채 나이가 아니다. 헷갈리지 말 것.
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=sort_desc(instance:node_uptime:days)'
```

대상 노드에서 **무엇 때문에 대기 중인지**:

```bash
cat /run/reboot-required.pkgs
```

> [!CAUTION]
> **`/run/reboot-required`의 mtime을 부채 나이로 쓰지 마라.** apt가 `.pkgs`에 패키지를 추가할 때마다 갱신되므로 **생성 시각이 아니라 마지막 갱신 시각**이다. 실측: data03의 mtime은 2026-07-28인데 실제 `0→1` 전이는 **07-17 06:24 UTC**였다(11일 차이).

## 3. 원인 분기표

| `.pkgs` 내용 | 뜻 | 급한가 |
|---|---|---|
| `linux-image-*` | 커널 업데이트가 적재 대기 | 보안 패치면 예. 정비창 우선순위 상향 |
| `libc6` | glibc 교체 — 재시작 안 한 프로세스는 옛 코드를 계속 쓴다 | 중간 |
| `linux-base` 등 메타패키지 | 위와 동반 | 낮음 |
| nvidia 관련 | **드물다.** 있으면 드라이버 mismatch와 함께 본다 | `node_nvidia_version_mismatch`로 교차 확인 |

## 4. 조치 — 부채 청산 절차 (fleet-hardening T1-13, `[server]`)

**자동 재부팅은 금지다**(§11). 순서를 지킨다.

1. **오래된 것부터.** 실측 기준 data04(부채 ≥30일, 보존 한계라 상한 미상, uptime 151.30일, pending `linux-image` 8개) → data03(부채 16.0일, uptime 28.79일) → data05(fleet-hardening T1-4 배포 후 메트릭 도달. **재부팅 자체는 hardware-ops T0-4 소관**이므로 여기서는 추적만 한다).
2. **누가 쓰고 있는지 먼저 본다.** 연구 잡을 예고 없이 죽이지 않는다.
   ```bash
   curl -sG localhost:9090/api/v1/query --data-urlencode 'query=gpu_model_info'
   curl -sG localhost:9090/api/v1/query --data-urlencode 'query=keiwi_listening_port_info'
   ```
3. **정비창 협의 → 대피 안내.** 소유자에게 시각을 통보하고 체크포인트/잡 종료를 요청한다.
4. **재부팅.** 대상 노드에서 **사람이** 수행한다. 1~3을 건너뛰고 여기로 오지 않는다.
   ```bash
   uptime                                  # 마지막으로 확인 — 방금 누가 재부팅했을 수도 있다
   sudo reboot
   ```
   > **비가역이다.** 이 명령은 `actions` 화이트리스트에 `risk: high`·`reversible: false`·
   > `idempotent: false`로 올라가 있고, 그 표기 때문에 어떤 자동 경로에도 등재될 수 없다
   > (spec §4.5 Tier0 · AC-L3-8). L1은 이 명령을 **보여줄 수는 있어도 실행 버튼을 달 수 없다.**
5. **사후 검증.**
   ```bash
   curl -sG localhost:9090/api/v1/query --data-urlencode 'query=fleet:node_reboot_required:count'
   curl -sG localhost:9090/api/v1/query --data-urlencode 'query=node_nvidia_version_mismatch'
   ```
   data05는 추가로 hardware-ops T0-4의 검증 목록(4유닛 active · CDI 재생성 · `gpu_vram_total_bytes` 시리즈 복귀)을 따른다.

> **data05 재부팅 전 반드시 fleet-hardening T1-11(증거 캡처)을 끝낼 것.** 재부팅이 먼저면 `node_nvidia_version_mismatch`의 1→0 전이가 시계열에 남지 않고 **되돌릴 수 없다.**

## 5. 승격 절차 (fleet-hardening T1-14, `[server]`)

**관문 2개를 모두 통과한 뒤에만** 규칙을 켠다. 하나라도 0이 아니면 그만큼이 즉시 발화 대상이라는 뜻이므로 **승격을 멈춘다.**

```bash
# 관문 ① 지금 부채가 있는 노드 수
curl -sG localhost:9090/api/v1/query \
     --data-urlencode 'query=fleet:node_reboot_required:count'          # 기대 0

# 관문 ② 알림식 그대로 — "켜면 몇 건이 즉시 뜨는가"
curl -sG localhost:9090/api/v1/query \
     --data-urlencode 'query=count(min_over_time(node_reboot_required[14d]) == 1) or vector(0)'
                                                                        # 기대 0 (2026-08-02 실측 2)
```

> [!CAUTION]
> **관문 ②를 "빈 벡터인가"로 쓰면 영원히 통과하지 못한다.** 수집기는 파일이 없을 때 메트릭을 빼는 게 아니라 **`node_reboot_required 0`을 항상 방출한다**(`roles/node-hygiene/templates/keiwi-node-hygiene.sh.j2`의 `reboot=0` 초기화 + 무조건 `echo`). 재부팅 뒤에도 시리즈는 살아 있고 `min_over_time`은 0을 반환한다 — 빈 벡터가 되는 경우가 없다.
> 관문식을 **알림식과 동일하게** 두는 것이 핵심이다. 그래야 "관문 통과 = day-1 발화 0"이 항등식이 된다.

관문을 통과하면 `infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml`에 아래 블록을 추가하고 프로비저닝을 재적용한다.

```yaml
      - uid: keiwi-reboot-required-stale
        title: RebootRequiredStale
        condition: C
        for: 15m
        data:
          - refId: A
            relativeTimeRange: { from: 600, to: 0 }
            datasourceUid: bflbhyfj7rzlsb
            model:
              refId: A
              instant: true
              # for: 14d를 쓰지 않는 이유는 런북 §1 참조(재시작이 pending을 리셋한다).
              expr: 'min_over_time(node_reboot_required[14d])'
          - refId: C
            datasourceUid: __expr__
            model:
              refId: C
              type: threshold
              expression: A
              conditions:
                - evaluator: { type: gt, params: [0] }
        noDataState: NoData
        execErrState: Alerting
        labels:
          severity: warning     # spec의 sev3 ≡ 이 파일의 warning (notification-policies 어휘)
          domain: infra
          node: '{{ $labels.instance }}'
        annotations:
          summary: '{{ $labels.instance }} 재부팅 대기 14일 연속 — 정비창을 잡아야 한다'
          runbook_url: https://github.com/mooner92/KEIwi/blob/main/docs/runbooks/reboot-required-stale.md
```

적용 후 `for` 창 15분이 지난 뒤 발화 0건을 확인한다(관문식 = 알림식이므로 ①②가 0이면 이 값도 0이어야 하고, 아니면 관문 검증이 깨진 것이다).

```bash
curl -s localhost:3000/api/prometheus/grafana/api/v1/alerts \
| python3 -c "import sys,json;a=[x for x in json.load(sys.stdin)['data']['alerts'] if x.get('labels',{}).get('alertname')=='RebootRequiredStale'];print(len(a))"
```

## 6. 사후 · 재발 방지

- 부채는 **상시 참이 되기 쉬운 신호**다. 다시 상주 발화가 되면 임계를 올리지 말고 **정비창 주기**를 손본다 — 임계를 올려 조용하게 만드는 것은 알림을 끄는 것과 같다.
- 부채 현황은 syshealth 대시보드 「표준 드리프트」 row의 「재부팅 부채 ≥14일 노드」 stat과 창별 table에서 상시 볼 수 있다(알림이 없어도 보인다).

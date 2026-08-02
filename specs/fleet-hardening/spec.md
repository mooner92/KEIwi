# 플릿 하드닝 — SPEC (5축 상세 설계)

> 2026-08-02. 권위: [README](./README.md) · 헌장(§9·§11·§12·§13·§15·§I-1·§I-2) · [hardware-ops/spec.md](../hardware-ops/spec.md) · [alerting/spec.md](../alerting/spec.md).
> 이 문서가 "무엇을 탐지하고 무엇을 게이트로 강제할지"의 계약이다. 구현이 벗어나면 구현이 틀린 것(§7).
>
> 표기: **[실측]** = 2026-08-02 라이브 확인값 · **[가설]** = 미확인 추정 · **미측정** = 조사하지 못함 · `[server]` = 사람이 적용(§11).
> 모든 AC는 **명령과 기대 출력**으로 쓴다("잘 된다" 금지, §9).

---

## 0. 공통 규약

### 0.1 검증 헬퍼

AC 표의 `q` 는 아래 함수다. **data05에서 실행**한다(Prometheus·Grafana·OpenSearch 모두 로컬).

```bash
q() { curl -s --get http://localhost:9090/api/v1/query --data-urlencode "query=$1" \
      | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['result'])"; }
```

레포 대상 AC의 작업 디렉터리는 `/home/mooner92/keiwi-design`(worktree)이다. **`/KEIwi`는 프로덕션이므로 검증에도 쓰지 않는다.**

### 0.2 게이트 레지스트리 — 축 간 충돌 해소

축2·3·4가 각각 게이트 스크립트를 만들고 축5가 실행기를 만든다. 경로가 갈리면 실행기가 못 찾는다. **정본 규약:**

| 항목 | 규약 |
|---|---|
| 레포 전역 게이트 | `scripts/gates/check-*.{sh,py}` **한 곳만** |
| 실행기 | `scripts/verify-all.sh` — `scripts/gates/check-*` 를 **글롭으로 순회**. 새 게이트는 배선 작업 없이 자동 편입 |
| **헬퍼(게이트 아님)** | `scripts/gates/` 안에 있어도 `check-`로 시작하지 **않으면** 글롭 대상이 아니다 — `promtool.sh`(바이너리 해석기) · `render-templates.py` · `render-smart-fixture.sh` · `lib.sh`. 헬퍼는 반드시 어떤 `check-*` 게이트가 **호출**해야 하며, 아무도 호출하지 않는 헬퍼는 죽은 코드다 |
| 콘솔 스코프 게이트 | `apps/console/scripts/`(`check-no-secrets.sh`·`check-no-raw-hex.sh`) 유지 — 성격이 다르므로 섞지 않는다. **픽스처도 `apps/console/scripts/fixtures/`에 둔다**(레포 루트 `scripts/gates/fixtures/`를 콘솔 스크립트가 읽으면 스코프 경계가 무너진다) |
| **중복 실행 금지** | `verify-all.sh`는 글롭으로 `scripts/gates/check-*`를 돌린 뒤 콘솔 게이트를 **한 번만** 호출한다. `scripts/gates/check-secrets.sh`(콘솔 스크립트 래퍼)를 두면 같은 검사가 두 번 돈다 → **래퍼를 만들지 않고**, 콘솔 스크립트를 `verify-all.sh`가 직접 호출한다(AC-5-20이 검증) |
| 종료코드 | `0` 통과(WARN 포함) / `1` 정책 위반 / `2` 환경 오류(의존 부재). **`2`를 분리하는 이유는 파서가 없을 때 CI가 조용히 통과하지 않게 하기 위함이다** |
| Makefile | **만들지 않는다.** 실행 경로가 둘이 되면 어느 쪽이 정본인지 사람이 판단해야 한다 |

hardware-ops T2-5가 선언한 `scripts/check-runbooks.sh` 경로는 `scripts/gates/check-runbooks.sh`로 정정한다(T3-8).

**exit 2의 실제 의미 [실측 2026-08-02, data05]**: `yamllint`·`shellcheck`·`ansible-lint`·`promtool` 모두 **이 호스트에 없다**(`command -v` 전부 MISSING). `docker` 바이너리는 `/usr/bin/docker`에 있으나 소켓이 **permission denied**다 — 소켓은 `srw-rw---- root docker`인데 `id -nG`에 `docker` 그룹이 없다. 즉 T5-26(도구 설치)을 하기 전에는 `verify-all.sh`가 rc=0이 될 수 없고 rc=2가 정상이다. `verify-all.sh`는 요약표에 게이트별로 `PASS/FAIL/SKIP(env)`을 찍고, **SKIP(env)가 하나라도 있으면 전체 rc=2**로 종료한다 — "안 돌았는데 초록"을 만들지 않기 위함이다. CI(GitHub 호스티드)에는 전부 설치되므로 rc=2는 로컬 전용 상태다.

**단, promtool은 예외다.** `yamllint`류는 없으면 검사가 통째로 사라지지만, promtool 의존 게이트는 §0.2.2의 **폴백 엔진**으로 강도를 낮춰 계속 돈다. 그래서 `check-rules.sh --check`와 `check-smart-metric-allowlist.sh --render-check`는 promtool이 하나도 없는 이 호스트에서도 **첫날부터 rc=0**이고 SKIP을 만들지 않는다. 폴백이 원리적으로 불가능한 것은 둘이다 — `check-rules.sh --test`(PromQL 평가 엔진 필요)와 `check-prometheus.sh`(docker 마운트 필요). 단 **`verify-all.sh` 요약표에 `SKIP(env)`으로 남는 것은 `check-prometheus.sh` 하나다** — 글롭은 게이트를 **인자 없이** 부르고, `check-rules.sh`는 인자 없음 호출에서 promtool 부재 시 `--test`를 `--test --schema-only`로 **자동 강등**해 SKIP 대신 `NOTE`를 남긴다(rc 0/1, 절대 2가 아님 — D4-4 인자 없음 행). `SKIP(env: promtool)` + rc=2는 **명시적 `check-rules.sh --test` 단독 호출**(AC-4-3·AC-4-4의 로컬 실행)에서만 나온다.

### 0.2.1 promtool 해석기 — `scripts/gates/promtool.sh` (헬퍼)

> [!IMPORTANT]
> `docker run … prom/prometheus:<tag> promtool check rules …`는 **동작하지 않는다.** 이 이미지의 `ENTRYPOINT`가 `/bin/prometheus`라서 실제로는 `prometheus promtool check rules …`가 실행되고 인자 파싱에서 죽는다. 반드시 `--entrypoint=/bin/promtool`을 주고 인자에서 `promtool`을 뺀다.

AC와 게이트는 raw docker 명령을 직접 쓰지 않고 이 헬퍼를 경유한다. 해석 순서:

```bash
# scripts/gates/promtool.sh — argv를 그대로 promtool에 넘긴다. 전부 실패하면 exit 2.
#  1) PATH의 promtool                      (있으면 최우선)
#  2) docker run --rm --entrypoint=/bin/promtool -v "$PWD:/w" -w /w prom/prometheus:v3.11.3 "$@"
#     ⚠️ 이미지가 USER nobody로 돌므로 마운트 파일이 others-readable이어야 한다(git 기본 644 → OK).
#     ⚠️ docker 소켓 권한 거부(이 호스트 실측)면 즉시 다음 단계로.
#  3) 캐시된 Release 바이너리 ~/.cache/keiwi/promtool-3.11.3 (있으면 사용)
#  4) KEIWI_PROMTOOL_ALLOW_DOWNLOAD=1 일 때만 GitHub Release 다운로드 → sha256 검증 → 캐시
#
# KEIWI_PROMTOOL_ENGINE=none 이면 위 해석을 전부 건너뛰고 --which=none 으로 동작한다.
#   폴백 경로 강제 스위치 — T5-26이 promtool을 설치한 뒤에는 자동 해석이 항상 path를
#   반환하므로, 이 스위치 없이는 §0.2.2 폴백 경로를 검증할 방법이 사라진다(AC-1-16 ②③ 전용).
#
# scripts/gates/promtool.sh --which
#   → path|docker|cache|none 중 하나를 1줄 출력하고 시도 경로를 stderr에. 항상 exit 0.
#     게이트는 이 값으로 엔진을 정하고, AC는 이 값으로 기대 강도를 정한다.
```

**해석 결과 실측 [2026-08-02, data05 — T5-26 전 시점]** — 네 경로가 전부 막혀 있다:

| 경로 | 결과 | 근거 |
|---|---|---|
| PATH | MISSING | `command -v promtool` → rc=1 |
| docker | permission denied | 소켓이 `srw-rw---- root docker`인데 `id -nG` = `mooner92 adm cdrom sudo dip plugdev lxd ollama conda` — **`docker` 그룹 미가입**이다. `sudo -n docker ps`도 `a password is required`로 실패한다. 즉 **sudoers 문제가 아니라 그룹 문제**라 hardware-ops T0-6(sudoers 교정)으로도 풀리지 않는다 |
| 캐시 | 없음 | 최초 상태 |
| 다운로드 | 도달은 되나 **기본 비활성** | `api.github.com` → 200, Release 애셋 range 요청 → 206 [실측]. 네트워크는 살아 있다. 그러나 게이트가 매 실행마다 외부 바이너리를 받아 실행하는 것은 공급망 표면이므로 **옵트인**으로 둔다. 사람이 T5-26에서 한 번 설치하는 쪽이 정본이다 |

따라서 **T5-26 전 이 호스트의 기본값은 `--which` = `none`**이다. **T5-26(W0)이 promtool Release 바이너리를 `~/.local/bin`에 설치하면 `path`가 된다** — `~/.local/bin`은 이 호스트 PATH에 이미 있다 [실측]. W0가 W1(T1-12)보다 앞이므로 **W1 이후 판정 시점의 정상값은 `path`**이고, `none` 상태는 새 클론 또는 `KEIWI_PROMTOOL_ENGINE=none`(위 스위치)으로만 재현한다. 게이트는 promtool이 있다고 전제하지 않는다 — 없으면 §0.2.2의 폴백 엔진으로 내려간다.

`promtool.sh`는 **게이트가 아니라 헬퍼**다(`check-`로 시작하지 않으므로 글롭 대상 아님). 산출은 축1 **T1-12**이고 축4 `check-rules.sh`·축5 `check-prometheus.sh`가 재사용한다 — 축1이 W1에서 먼저 필요하기 때문에 축1에 둔다.

### 0.2.2 폴백 엔진 — `tools/promtool_fallback.py` (헬퍼)

promtool이 하나도 없을 때 게이트가 `exit 2`로 죽는 대신 **강도를 낮춰 계속 돌게 하는** 순수 Python 구현이다. 새 의존을 만들지 않는다 — `python3`(`/home/mooner92/.pyenv/shims/python3`)와 **PyYAML 6.0.1**이 이미 있다 [실측].

| 서브명령 | 대체 대상 | **검증하는 것** | **검증하지 못하는 것** |
|---|---|---|---|
| `check-rules` | `promtool check rules` | YAML 파싱 · 중복 키 · 최상위 `groups`가 리스트 · 그룹의 `name`/`rules` 필수 · 각 룰이 `record`\|`alert` 중 **정확히 하나** · `expr` 존재하고 비어있지 않음 · `record` 이름이 `^[a-zA-Z_:][a-zA-Z0-9_:]*$` · `labels`/`annotations`가 맵 · `interval`/`for`가 duration 문자열 · **`expr`의 `()`·`[]`·`{}` 균형과 따옴표 종결**(문자열 리터럴 상태기계 — §D4-4의 토크나이저와 같은 것을 쓴다) | **PromQL 문법·의미 전부.** 함수명·인자 개수·타입(range vs instant vector)·연산자 결합·`by`/`without` 정합·라벨 매처 연산자·집계 중복 라벨. 예: `sum(rate(foo[5m])`(괄호 부족)는 **잡지만**, `sum(rate(foo))`(range 셀렉터 누락 — promtool은 거부)는 **통과시킨다** |
| `check-metrics` | `promtool check metrics` | 노출 형식 lint — 메트릭명·라벨명 정규식 · `# HELP`/`# TYPE`이 메트릭당 1회이고 **샘플보다 먼저** · 라벨 따옴표 종결과 이스케이프 · 값이 파싱 가능한 float(`NaN`/`+Inf` 포함) · 타임스탬프가 정수 · **동일 `(name, labels)` 중복 샘플** | promtool의 lint 규칙 집합과 1:1이 아니다. 히스토그램 `le`·서머리 `quantile` 라벨의 **의미적** 정합(버킷 단조성 등)은 보지 않는다 |
| — | `promtool test rules` | **없다 — 폴백이 원리적으로 불가능하다.** | PromQL **평가 엔진**을 다시 구현해야 하므로 만들지 않는다 |

> [!WARNING]
> **`test rules`에는 폴백이 없다.** 여기가 로컬과 CI의 검증 강도가 갈리는 지점이고, 과장하지 않기 위해 따로 못 박는다. 규칙의 *문법*이 아니라 *의미*를 잠그는 회귀 테스트(D4-3 · AC-4-3 · AC-4-4)는 **promtool이 있어야만 판정된다.** 폴백은 "규칙 파일이 구조적으로 멀쩡한가"까지만 말할 수 있고 "규칙이 옳은 값을 내는가"는 말할 수 없다.

**게이트별 검증 강도 — 3단**

| 게이트 | 로컬 T5-26 전(`--which`=none — `KEIWI_PROMTOOL_ENGINE=none`으로 재현) | 로컬 T5-26 후(promtool 설치) | CI (GitHub 호스티드) |
|---|---|---|---|
| `check-rules.sh --check` | `RULES_OK engine=structural` **rc=0** | `RULES_OK engine=promtool` rc=0 | `engine=promtool` rc=0 |
| `check-rules.sh --test` | `SKIP(env: promtool)` **rc=2** | `SUCCESS` rc=0 | `SUCCESS` rc=0 |
| `check-rules.sh --test --schema-only` | rc=0 (테스트 파일 **스키마만**) | rc=0 | rc=0 |
| `check-smart-metric-allowlist.sh --render-check` | `EXPOSITION_OK engine=structural` **rc=0** | `engine=promtool` rc=0 | `engine=promtool` rc=0 |
| `check-prometheus.sh` (`check config`, 라이브 동형 마운트) | `SKIP(env: docker)` **rc=2** | `WARN: 글롭 동형성 미검증` rc=0 | 동형 마운트 rc=0 |

> **엔진 이름을 반드시 출력한다.** `engine=structural`이 찍히는데 아무도 그것을 보지 않으면 "안 돌았는데 초록"과 실질적으로 같아진다. `verify-all.sh` 요약표는 게이트별 `PASS/FAIL/SKIP(env)` 옆에 **엔진을 함께 찍고**, `engine=structural`이 1건이라도 있으면 요약 말미에 `NOTE: N개 게이트가 축소 강도로 실행됨(promtool 부재) — CI가 정본 판정`을 남긴다(rc에는 영향 없음).

`promtool_fallback.py`는 게이트가 아니라 **헬퍼**다(`scripts/gates/` 밖의 `tools/`에 두므로 글롭과 무관하다). 산출은 축1 **T1-12** — `promtool.sh`와 같은 태스크에서 함께 만든다. 둘을 나누면 "해석기는 있는데 폴백이 없어 여전히 exit 2"인 중간 상태가 생긴다.

### 0.3 메트릭명 가드와 "아직 없는 메트릭" (축1·2 ↔ 축4 상호작용)

축4의 `check-promql-metrics.sh`는 라이브 `__name__` 스냅샷(918개)과 대조해 오타를 잡는다. 그런데 축1이 만드는 `node_nvidia_*`, 축2가 만드는 `node_smart_*`는 **배포 전이라 스냅샷에 없다** → 정상 규칙이 FAIL한다.

**해소**: 스냅샷 파일을 둘로 나눈다.

| 파일 | 내용 | 갱신 |
|---|---|---|
| `infra/monitoring/metric-names.txt` | 라이브 `__name__` 스냅샷 | `curl -sG localhost:9090/api/v1/label/__name__/values \| jq -r '.data[]' \| sort` |
| `infra/monitoring/metric-names.pending.txt` | **이 스펙이 배포할 예정인 메트릭.** 각 줄에 `<메트릭명>  # spec §N` 형식으로 근거 필수 | 사람이 수기. 라이브에 나타나면 **제거해야 한다**(AC-4-6이 검사) |

가드는 두 파일의 합집합을 허용집합으로 쓴다. pending에 근거 주석 없는 줄이 있으면 exit 1 — "일단 넣고 보자"를 막는다.

> [!WARNING]
> **recording rule 이름은 스냅샷 비교에서 제외한다.** Prometheus는 record 이름을 `__name__` 값으로 노출하므로(918개 중 **119개가 `:` 포함** [실측]) 이 스펙이 새 record를 배포하는 순간 라이브 스냅샷이 커밋본보다 20여 개 앞선다. 그래서 AC-4-6의 diff는 **`:`를 포함하지 않는 이름만** 비교하고, 배포 직후 스냅샷 재생성은 **T4-12**가 담당한다(T1-7·T2-16·T4-9 각각의 배포 뒤).

**배포 전 red 회피(라이브 실측 기반)** — 가드를 `--dashboards`까지 켜면 `syshealth.json`이 참조하는 **`smartctl_device_attribute`·`smartctl_device_available_spare`·`smartctl_device_percentage_used` 3개가 918개 스냅샷에 없어** 즉시 FAIL한다(§2.1의 "0계열"이 바로 이 셋이다). 이 죽은 패널을 치우는 작업은 원래 축2 T2-6(W4)이었으나 **가드·CI는 W2/W3**이라 CI가 두 파동 내내 red가 된다. 그래서 **죽은 패널 6·7·8 정리를 축4 T4-6(W2, 같은 파일을 이미 여는 태스크)으로 이관**한다. 축2 T2-6은 물리 디스크 패널 **추가**만 담당한다.

---

## 1. 축 1 — GPU 스택 정합성 탐지 + node-hygiene 커버리지 구멍 교정

### 1.1 문제 (실측)

| 사실 | 실측값 |
|---|---|
| 커버리지 갭 | `count(up{job="node-exporter"}==1)`=**4** / `count(node_hygiene_collector_last_run_timestamp_seconds)`=**2** → 갭 **2** |
| 누락 노드 | `count by(instance)({__name__=~"node_apt_.*\|node_reboot_required\|node_hygiene.*"})` → .104=**4**, .103=**4**, **.105·.101 없음**. 4종 = `node_reboot_required` · `node_apt_upgrades_pending` · `node_apt_security_upgrades_pending` · `node_hygiene_collector_last_run_timestamp_seconds` |
| 근본 원인 | `roles/node-hygiene/tasks/main.yml:8-12`의 `/etc/default/prometheus-node-exporter` stat → `when: _nodeexp_default.stat.exists`가 **7개 태스크(헤더 21·30·41·51·63·75·86행, 가드 28·38·49·58·70·82·93행) 전부**를 게이팅. 여기에 14행 debug 태스크가 `when: not …stat.exists`로 **반대 방향 가드**를 하나 더 갖는다 |
| 스킵 범위 정정 | 스킵되는 것은 컨테이너 노드(.105)뿐 아니라 **수동설치 노드 .101**도 포함(`/usr/local/bin/node_exporter` v1.8.2, Ubuntu 16.04 → apt 패키지 아님) |
| **배선은 완비** | .101 cmdline = `--collector.textfile.directory=/var/lib/node_exporter/textfile`(디렉터리 존재·비어 있음, `keiwi-node-hygiene.timer`=**inactive**) · .105 compose가 `/host/textfile:ro` 마운트. 두 노드 모두 `node_textfile_scrape_error`=0, `node_scrape_collector_success{collector="textfile"}`=1 → **소비처 정상, 생산자만 부재** |

**드라이버 버전 매트릭스 [실측 2026-08-02]** (running=`/proc/driver/nvidia/version` NVRM, NVML=`ldconfig -p`→`readlink -f`)

| 노드 | running | NVML | `nvidia-smi -L` rc | mismatch |
|---|---|---|---|---|
| .101 | 418.39 | 418.39 | 0 | 0 |
| .103 | 595.71.05 | 595.71.05 | 0 | 0 |
| .104 | 535.309.01 | 535.309.01 | 0 | 0 |
| **.105** | **595.71.05** | **595.84** | **18** | **1** |

**DCGM은 구조적 사각지대다.** .105 DCGM `up`=1, 온도 51/47°C, 전력 81.3/75.5W, `FB_USED` 41548MB — 완전 정상 보고. 라벨 `DCGM_FI_DRIVER_VERSION="595.71.05"`는 **커널모듈** 값이라 유저스페이스 595.84와의 드리프트를 볼 수 없다. 게다가 이 라벨은 **.105에만 존재**(.103·.104 dcgm-exporter 원본 메트릭 수 30 vs .105 38) → 플릿 전체 소스로 쓸 수 없다.

**`node_reboot_required`는 예측 신호가 될 수 없다.** .105 `/run/reboot-required.pkgs` = linux-image-6.8.0-{124,134,136} · linux-base · libc6 — **nvidia 패키지 없음**. 그런데 `dpkg -l`은 nvidia-driver-595가 **595.84**로 설치됐음을 보여준다. apt가 드라이버 업그레이드를 이 파일에 기록하지 않았다 → **버전 직접 대조만이 신뢰 가능**하다.

**재부팅 대기 실태 [실측 2026-08-02]** `node_reboot_required` .103=1, .104=1. 단 두 노드 모두 **현재 mismatch=0**이다. uptime .103=28.79일 / .104=**151.30일**(pending linux-image 8개) / .105=62.14일 / .101=451.01일(16.04 EOL, reboot-required 파일 자체 부재). 즉 .103·.104에 살아 있는 것은 "불일치"가 아니라 **불일치를 조용히 만들 수 있는 전제조건(장기 미재부팅)**이다.

**부채의 나이 — 정확히 측정하면 이렇다 [실측 2026-08-02, 설계 근거]**

| 쿼리 | .103 | .104 |
|---|---|---|
| `min_over_time(node_reboot_required[7d])` | **1** | **1** |
| `min_over_time(node_reboot_required[14d])` | **1** | **1** |
| `min_over_time(node_reboot_required[30d])` | **0** | **1** |
| `count_over_time(node_reboot_required[14d])` | 80,639 | 80,640 (=15s×14d 만점) |
| `node_reboot_required offset 29d` / `offset 30d` | 0 / 0 | **1 / 1** |
| `node_reboot_required offset 31d` | 빈 벡터(보존 밖) | 빈 벡터(보존 밖) |
| 0→1 전이 시각 (`query_range` 30d, step 60s) | **2026-07-17 06:24 UTC** (직전 표본 06:23 = 0) | **전이 없음** — 보존 전 구간(07-03~) 1, 0 표본 0개 |
| **부채 나이** | **16.0일** | **≥30일 — 보존 한계라 상한 미상** |
| `/run/reboot-required` mtime | 2026-07-28 06:33 | 2026-07-29 06:15 |

즉 **두 노드 다 이미 14일 연속 부채 상태**다. .103은 07-17에 부채가 생겼고(16.0일), .104는 **TSDB 보존 30d 전 구간이 1**이라 언제 시작했는지 알 수 없다 — 정직한 표기는 **"≥30일(보존 한계)"**이고, 그보다 오래됐다는 추정치를 지어내지 않는다(uptime 151.30일은 부채 나이가 아니라 무재부팅 기간이다). data05도 `/run/reboot-required`가 07-29부터 존재하는데 메트릭이 안 나온다 — §1.1 커버리지 갭의 일부다.

> [!CAUTION]
> **mtime을 부채 나이로 쓸 수 없다.** .103의 mtime은 07-28인데 실제 0→1 전이는 **07-17 06:24**다(11일 차이). apt가 `/run/reboot-required.pkgs`에 패키지를 추가할 때마다 mtime이 갱신되기 때문이다 → mtime은 **생성 시각이 아니라 마지막 갱신 시각**이다.
> 나이를 주는 유일한 신호는 **TSDB의 0→1 전이 시각**이고, 그것도 **보존 30d 안에 전이가 들어 있을 때만** 정확하다(.103은 가능, .104는 불가능). 그래서 이 스펙은 노드별 "나이(일)" 메트릭을 만들지 않고 `min_over_time` 창(7d/14d/30d)을 그대로 노출한다(D1-4) — 창 3개는 나이를 **구간으로 묶어주고**(예: .103 = (14d, 30d] → 실제 16.0일, .104 = ≥30d), 보존 밖은 정직하게 구분 불가로 남는다.

**같은 노드의 두 번째 구멍.** `count by(instance)(node_systemd_unit_state)` → .104=1280, .103=1145, .101=1050, **.105=0**. `node_scrape_collector_success{collector="systemd"}`=**0**(.105만). 결과: data05 `nvidia-cdi-refresh.service`가 로컬 `systemctl`에서 `failed`인데 **Prometheus에서 관측 불가** — 이번 사고의 2차 증거가 통째로 유실됐다. compose 주석(52-72행)이 이미 원인 후보(D-Bus 소켓 `:ro`)를 예측해 두었다.

### 1.2 설계

**원칙: 메트릭을 새로 만드는 일이 아니라, 이미 정의된 메트릭이 도달하지 못하는 배송 경로를 고치는 일이다.**
hardware-ops T0-1의 메트릭 이름 4개는 **그대로 쓴다**(재정의 금지).

#### D1-1. role 가드 분할 — `roles/node-hygiene/tasks/main.yml`

7개 태스크 중 **진짜 apt 전용은 ARGS 주입(30행) 하나뿐**이다. 나머지 6개는 호스트 레벨 작업이라 설치 방식과 무관하다. 여기에 "없으면 스킵" 안내 debug 태스크(14행)가 반대 방향 가드를 갖는데, **이 문장이 사실이 아니게 되므로 함께 고친다.**

| 태스크(현행 행) | 현행 가드 | 변경 후 |
|---|---|---|
| **안내 debug (14)** | `when: not stat.exists` | **삭제.** "apt 미설치 = role 스킵"이라는 문장 자체가 이 스펙이 없애는 동작이다. 남기면 data01·data05에서 SKIPPED가 계속 잡혀 AC-1-2의 "스킵 0"이 불가능하다 |
| textfile 디렉터리 (21) | `stat.exists` | **가드 없음** |
| ARGS lineinfile (30) | `stat.exists` | `when: node_hygiene_is_apt_node` ← **유일한 apt 전용** |
| 마커 copy (41) | `stat.exists` | **가드 없음** |
| 스크립트 template (51) | `stat.exists` | **가드 없음** |
| `.service` template (63) | `stat.exists` | **가드 없음** |
| `.timer` template (75) | `stat.exists` | **가드 없음** |
| timer enable (86) | `stat.exists and not check_mode` | `when: not ansible_check_mode` |

같은 파일 1-6행 헤더 주석("대상: apt로 node-exporter가 깔린 노드(data03/04). data05는 컨테이너 → 이 role은 자동 스킵")도 **거짓이 되므로 함께 교체**한다.
`playbooks/agents.yml`이 같은 주장을 한 번 더 한다(38-40행 주석 + 41행 play 이름의 "apt 노드") — **T1-1이 함께 교체**한다. role만 고치면 플레이북이 사라진 동작을 계속 주장한다. 같은 파일 **9행의 `-K` 안내("대상의 sudo가 NOPASSWD가 아니면 필요(예 data04 mhchoi)")도 실측과 반대**다 — data04는 NOPASSWD(rc=0)이고 `-K`가 필요한 노드는 **data05**다(README §4.2.1).

가드를 그냥 없애면 "소비처 없는 노드에 생산자만 깔리는" **새 실패모드**가 생긴다 — 지금 고치는 것과 정확히 같은 종류의 재발이다. 그래서 소비처를 **명시적으로 선언**하게 한다.

```yaml
# 기존 stat 태스크는 유지(변수명도 유지) — 의미만 좁힌다
- name: set_fact — apt node-exporter 여부(ARGS 주입 대상 판별에만 사용)
  ansible.builtin.set_fact:
    node_hygiene_is_apt_node: "{{ _nodeexp_default.stat.exists }}"

- name: 소비처 선언 강제(명시적 옵트인 — 미선언 노드에 생산자만 깔리는 것 방지)
  ansible.builtin.assert:
    that: node_hygiene_consumer in ['host', 'container']
    fail_msg: >-
      node_hygiene_consumer 미선언({{ inventory_hostname }}).
      inventory.ini에 host(=node-exporter가 --collector.textfile.directory로 직접 읽음)
      또는 container(=compose 바인드마운트로 읽음)를 선언하라.

- name: 소비처 실증 검증(host 노드 — 실행 중 node-exporter가 정말 이 디렉터리를 읽는가)
  ansible.builtin.shell: >-
    pgrep -af '(^|/)(node_exporter|prometheus-node-exporter)'
    | grep -q -- '--collector.textfile.directory={{ node_hygiene_textfile_dir }}'
  register: _consumer_ok
  changed_when: false
  failed_when: false
  # ⚠️ 필수. shell/command 모듈은 --check에서 스킵되어 _consumer_ok에 rc가 없고,
  #    아래 fail의 `rc | default(1) != 0`이 참이 되어 data01(consumer=host + 非apt)이
  #    드라이런에서 거짓 실패한다 → AC-1-2의 "4호스트 failed=0"이 착수 시점부터 깨진다.
  #    레포의 기존 관용구와 동일하다 — roles/gpu-model-exporter/tasks/main.yml:9-13,
  #    roles/port-exporter/tasks/main.yml:7-11이 이미 `command` 프로브에
  #    changed_when/failed_when/check_mode 3종을 같은 이유로 붙여 뒀다.
  check_mode: false
  when: node_hygiene_consumer == 'host'

- name: 소비처 없음 — 자동 교정 불가(사람이 유닛 수정 필요, §11)
  ansible.builtin.fail:
    msg: >-
      {{ inventory_hostname }}의 node-exporter가 {{ node_hygiene_textfile_dir }}를 읽지 않는다.
      apt 노드가 아니라 ARGS 자동 주입도 불가 → 유닛 파일을 사람이 고쳐야 한다.
  when:
    - node_hygiene_consumer == 'host'
    - not node_hygiene_is_apt_node
    - _consumer_ok.rc | default(1) != 0
```

**`--check`에서의 동작 규약(두 가드는 목적이 다르다)**

| 가드 | `--check` 동작 | 근거 |
|---|---|---|
| `assert`(소비처 미선언) | **실패한다** | 미선언은 드라이런에서 잡아야 배포 전에 고친다(AC-1-14가 이 실패를 확인) |
| `fail`(소비처 부재) | **판정한다 — 스킵하지 않는다** | `check_mode: false`로 pgrep을 실제 실행하므로 `--check`에서도 rc가 존재한다. `rc` 부재는 "이 태스크가 아예 안 돌았다"는 뜻이므로 `default(1)`로 **fail-closed** — `check_mode: false`를 빠뜨리면 드라이런이 **시끄럽게** 깨져(4호스트 중 data01) 즉시 드러난다. 조용히 통과하는 쪽으로 기울이지 않는다 |

`defaults/main.yml` 추가: `node_hygiene_consumer: host` · `node_hygiene_apt_enabled: true` · `node_hygiene_nvidia_enabled: true`.
`inventory.ini` 추가: data05 `node_hygiene_consumer=container`, data01 `node_hygiene_apt_enabled=false`.

#### D1-2. NVIDIA 정합성 블록 — `templates/keiwi-node-hygiene.sh.j2`

hardware-ops T0-1의 4메트릭을 구현하되 실측으로 확인된 **2가지를 교정**한다.

- **교정 1 — 유저스페이스 경로 하드코딩 금지.** `spec.md:690`의 `readlink libnvidia-ml.so.1`은 data01(`/usr/lib/nvidia-418/`)에서 실패한다. `ldconfig -p`로 해석한다(4노드 검증 완료).
- **교정 2 — 판정 불능과 정상을 구분한다.** 파싱 실패 시 mismatch를 1로 만들면 data01이 영구 오탐하고, 0으로 만들면 **이 축 전체의 실패모드(측정하지 않은 것이 정상으로 보임)를 메트릭 레벨에서 재생산**한다. 세 번째 상태가 필요하다.

```bash
# ── NVIDIA 커널모듈 ↔ 유저스페이스 정합성 (hardware-ops T0-1 구현) ──────────
{% if node_hygiene_nvidia_enabled %}
if [ -r /proc/driver/nvidia/version ]; then
  # running = 현재 적재된 커널모듈. 문자열 레이아웃이 노드마다 다르다 [실측]:
  #   .105 "x86_64 Kernel Module  595.71.05" / .103 "Open Kernel Module for x86_64  595.71.05  Release Build"
  #   → 필드 위치가 아니라 "첫 버전꼴 토큰"으로 스캔한다.
  nv_run="$(awk '/NVRM version/{for(i=1;i<=NF;i++) if($i ~ /^[0-9]+\.[0-9]+/){print $i; exit}}' \
            /proc/driver/nvidia/version 2>/dev/null || true)"

  # userspace = NVML 실제 파일. 경로 하드코딩 금지(data01은 /usr/lib/nvidia-418).
  nv_link="$(ldconfig -p 2>/dev/null | awk '/libnvidia-ml\.so\.1 /{print $NF; exit}' || true)"
  nv_user=""
  if [ -n "${nv_link}" ]; then
    nv_user="$(readlink -f "${nv_link}" 2>/dev/null | sed -n 's/.*libnvidia-ml\.so\.//p')"
  fi
  # readlink가 심볼릭이 아닌 .so.1 자체로 떨어지면 "1"이 나온다 → 버전꼴 아니면 폐기(오탐 방지).
  case "${nv_user}" in [0-9]*.[0-9]*) : ;; *) nv_user="" ;; esac

  # nvidia-smi -L = 디바이스 열거만(CUDA 컨텍스트·커널 launch 없음). set -e 회피 + 행 방지 timeout.
  nv_smi_rc=0
  timeout 20 nvidia-smi -L >/dev/null 2>&1 || nv_smi_rc=$?

  nv_probe=0; nv_mismatch=0
  if [ -n "${nv_run}" ] && [ -n "${nv_user}" ]; then
    nv_probe=1
    [ "${nv_run}" != "${nv_user}" ] && nv_mismatch=1
  fi
  NVIDIA_BLOCK=1
fi
{% endif %}
```

노출 메트릭(`NVIDIA_BLOCK` 조건부):

| 메트릭 | 출처 | .105 현재값 | 소유 |
|---|---|---|---|
| `node_nvidia_kernel_module_version{version="…"}` | `/proc/driver/nvidia/version` | `595.71.05` → 1 | hardware-ops T0-1 |
| `node_nvidia_userspace_version{version="…"}` | `ldconfig -p` → `readlink -f` | `595.84` → 1 | hardware-ops T0-1 (경로 교정) |
| `node_nvidia_smi_ok` | `nvidia-smi -L` rc==0 | `0` | hardware-ops T0-1 |
| `node_nvidia_version_mismatch` | 두 값 비교 | `1` | hardware-ops T0-1 |
| `node_nvidia_smi_exit_code` | rc | `18` | **신규** — 런북이 exit 18로 분기 |
| `node_nvidia_probe_ok` | 두 값 모두 파싱됨 | `1` | **신규** — 판정불능/미수집 구분 |

> GPU가 없는(=`/proc/driver/nvidia/version` 부재) 노드에서는 이 6개를 **아무것도 내보내지 않는다.** 0을 내보내면 "GPU 없음"이 "GPU 고장"으로 보인다.

apt 블록도 `{% if node_hygiene_apt_enabled %}` … `{% endif %}`로 감싼다(data01 EOL 노이즈 차단).

#### D1-3. 커버리지 자체를 메트릭화 — `rules/keiwi-hygiene-coverage.yml` (신규, **record 전용**)

기존 `rules/keiwi-recording.yml` 헤더가 "이 파일에 alert 키가 하나라도 있으면 헌장 위반"이라 명시하므로, 레코딩은 `rules/`, 알림은 Grafana 프로비저닝으로 분리한다(라이브 관례 준수).

```yaml
groups:
  - name: keiwi_hygiene_coverage
    interval: 60s
    rules:
      # 이 구멍이 다시 조용히 열리는 것을 막는 유일한 신호.
      - record: fleet:node_exporter_up:count
        expr: count(up{job="node-exporter"} == 1)
      - record: fleet:node_hygiene_reporting:count
        expr: count(node_hygiene_collector_last_run_timestamp_seconds) or vector(0)
      - record: fleet:node_hygiene_coverage:gap
        expr: >-
          count(up{job="node-exporter"} == 1)
          - (count(node_hygiene_collector_last_run_timestamp_seconds) or vector(0))
      - record: fleet:gpu_driver_mismatch:count
        expr: count(node_nvidia_version_mismatch == 1) or vector(0)
      - record: fleet:gpu_driver_probe_failed:count
        expr: count(node_nvidia_probe_ok == 0) or vector(0)
      - record: instance:node_uptime:days
        expr: (time() - node_boot_time_seconds) / 86400

      # ── 재부팅 부채. 알림이 아니라 패널·티켓의 입력이다(D1-4).
      #    나이를 지어내지 않고 관측 창을 그대로 노출한다 — mtime은 갱신 시각이라 못 쓴다(§1.1).
      - record: fleet:node_reboot_required:count
        expr: count(node_reboot_required == 1) or vector(0)
      - record: instance:node_reboot_debt:min7d
        expr: min_over_time(node_reboot_required[7d])
      - record: instance:node_reboot_debt:min14d
        expr: min_over_time(node_reboot_required[14d])
      - record: instance:node_reboot_debt:min30d
        expr: min_over_time(node_reboot_required[30d])
```

현재값 `gap` = **2**(4−2). 목표 **0**. record **10건**(alert 0건).

#### D1-4. 알림 — `grafana/provisioning/alerting/alert-rules.yaml`

`NvidiaVersionMismatch`·`NvidiaSmiFailing`은 **hardware-ops spec.md:555-566이 이미 정의**했다. 재정의하지 않는다. 이 축은 그 규칙이 .105·.101에서 구조적 no-data가 되지 않도록 메트릭을 도달시키는 역할만 한다. 아래 2건은 hardware-ops·alerting 어느 스펙에도 없다(grep 확인).

| alert | expr | for | severity | runbook |
|---|---|---|---|---|
| `NodeHygieneCoverageGap` | `fleet:node_hygiene_coverage:gap > 0` | 30m | sev3 | `node-hygiene-coverage-gap.md` |
| `NodeHygieneStale` | `time() - node_hygiene_collector_last_run_timestamp_seconds > 5400` | 15m | sev3 | `node-hygiene-stale.md` |

두 규칙 모두 **배포 시점 값이 정상 쪽**이다: `gap`은 T1-4 완료 후 0(그래서 T1-7이 T1-4 완료 30분 뒤), `stale`은 타이머가 30분 주기라 5400s 여유.

##### RebootRequiredStale — **이번 파동에서 알림으로 만들지 않는다**

당초 설계는 `min_over_time(node_reboot_required[14d]) == 1`, for 15m, "14일 연속이라 오늘은 발화하지 않는다"였다. **이 근거는 라이브 실측과 정반대였다** — §1.1 표대로 .103·.104 **둘 다 이미 `min_over_time[14d]`=1**이고 `count_over_time[14d]`가 만점(80,639/80,640)이다. 규칙을 그대로 켜면 **적용 즉시 2건이 상주 발화**하고, T1-4로 data05에 메트릭이 도달하면 신규 시리즈의 `min_over_time`도 1이라 **3건**이 된다.

그것은 이 스펙이 §2.3(축2)에서 "GDL 절대 임계 금지 — 첫날 상주 발화 = hardware-ops T0-7이 지목한 알림 무시 습관의 시작"이라고 스스로 쓴 실패를 그대로 재현하는 것이다. **같은 원칙을 여기에도 적용한다.**

**세 선택지를 실측으로 검토했다** [2026-08-02]

| 선택지 | 실측 결과 | 판정 |
|---|---|---|
| **(A) 알림을 만들되 기존 부채를 예외 처리** — 노드 예외 목록 또는 "특정 시점 이후 전이만" | 예외 대상이 **.104**다. 그런데 .104는 `min[30d]`=1·uptime 151.30일로 **플릿에서 가장 오래되고 가장 위험한 부채**다 | **기각.** ① 정확히 봐야 할 노드를 영구히 가린다 ② 노드 목록 하드코딩은 §1.3에서 이미 기각한 패턴(추가/제거 때 손으로 고쳐야 하고, 잊으면 지금 상황이 그대로 재현) ③ "특정 시점 이후"를 PromQL로 쓰려면 offset 상수를 박아야 하는데, 그 상수는 보존 30d 밖으로 밀리는 순간 **조용히 뜻이 바뀐다**(시간이 지나면 저절로 참이 되는 규칙) ④ Grafana silence는 만료되고 만료 시점에 아무도 기억하지 못한다 |
| **(B) 임계를 실측 분포에서 재도출** | `count(min_over_time(node_reboot_required[Xd]) == 1)` → X=7d **2** · X=14d **2** · X=30d **1**(.104). 그리고 `node_reboot_required offset 31d`는 **빈 벡터** — 보존이 30d라 **X>30d는 표현 자체가 불가능**하다(`min[60d]` ≡ `min[30d]`, 값이 아니라 데이터가 없다) | **기각 — 불가능함이 증명된다.** 표현 가능한 임계의 상한이 30d인데 그 상한에서도 발화가 **1건**이다. 즉 **어떤 임계를 골라도 day-1 발화 0을 만들 수 없다.** 게다가 발화를 피하려고 임계를 올리는 것은 임계 근거가 아니다 — 이 스펙의 핵심 원칙("임계는 자기 분포에서 뽑는다")을 형식만 흉내 내는 일이다 |
| **(C) 알림이 아니라 패널 + 티켓으로 강등** | 부채 2건(T1-4 후 3건)은 **상시 참**이고, 해소 수단은 알림 수신자가 즉시 할 수 있는 조치가 아니라 **정비창 협의 + 연구 잡 대피**다(§11 자동 조치 금지) | **채택.** 이 스펙의 기존 원칙 그대로 — "조치가 불명확하거나 상시 참인 신호는 알림이 아니다". 단 **강등을 종착점이 아니라 경유지로 둔다**: T1-13이 부채를 청산하면 신호는 더 이상 상시 참이 아니고, 그때 T1-14가 알림으로 승격한다 |

> [!NOTE]
> 선택지 (C)의 "주간 리포트"는 채택하지 않았다 — KEIwi에 주간 리포트 채널이 **없다**(`grep -rl '주간 리포트' specs/ infra/ docs/` → 0건). 없는 채널을 스펙이 새로 만들면 축1의 범위가 넓어지고, 무엇보다 **티켓(T1-13)이 리포트보다 강한 추적 수단**이다(담당·기한·완료 판정이 붙는다). 리포트를 대신하는 것은 syshealth 패널이고, 그 패널이 승격 준비 상태(`부채 ≥14일 노드 수`)를 그대로 보여준다.

| 단계 | 태스크 | 내용 |
|---|---|---|
| ① 관측 | T1-5 | `fleet:node_reboot_required:count` + `instance:node_reboot_debt:min{7,14,30}d` **record만** |
| ② 노출 | 축4 T4-6 | syshealth 「표준 드리프트」 row에 **「재부팅 부채 ≥14일 노드」** stat + 창별 table. ⚠️ 「재부팅 대기 노드」 stat(패널 id 2)과 「재부팅 대기 (노드별)」 table(패널 id 9)은 **이미 존재한다**(실측, `syshealth.json`) — 같은 제목을 하나 더 만들지 않는다. 신규 패널은 **승격 임계와 같은 양**(창 14d 부채)을 보여주는 것이라 의미가 겹치지 않는다 |
| ③ 청산 | **T1-13** `[server]` | 기존 부채 3건(.103·.104 + T1-4 후 .105)을 **재부팅 티켓**으로 처리. T2-18(열화 디스크)과 같은 성격 — 파동을 기다리지 않는다 |
| ④ 승격 | **T1-14** `[server]` | `fleet:node_reboot_required:count`가 **0이 된 뒤에만** 알림을 켠다. 그러면 day-1 발화가 구조적으로 불가능하다 |

**승격 시점의 규칙안**(T1-14에서 확정): `min_over_time(node_reboot_required[14d]) == 1`, for 15m, sev3, 런북 `reboot-required-stale.md`.
`for: 14d` 대신 `min_over_time(...[14d])`인 이유는 유효하다 — Grafana/Prometheus 재시작이 pending을 리셋하므로 장기 `for`는 발화하지 않는 죽은 규칙이 된다. 보존 **30d**(`docker-compose.yml:24` `--storage.tsdb.retention.time=30d`) > 14d 확인됨.
**임계 14일의 근거**: 연구 GPU 노드 재부팅은 사고가 아니라 예약 작업이고, 정비창을 잡는 데 2주면 충분하다는 운영 판단이다. 실측 근거가 아니라 **정책값**임을 명시한다(근거 없는 수치를 실측인 양 쓰지 않는다). 실측 분포는 이 값을 **고를 수 없다**는 것만 알려준다((B) 기각 근거) — 그래서 임계는 분포가 아니라 정책에서 오고, 대신 **적용 시점**을 분포가 결정한다(부채 0).

> [!CAUTION]
> **승격 관문을 "빈 벡터"로 쓰면 영원히 통과하지 못한다.** 수집기는 파일이 없을 때 메트릭을 빼는 게 아니라 **`node_reboot_required 0`을 항상 방출**한다(`roles/node-hygiene/templates/keiwi-node-hygiene.sh.j2` — 31행 `reboot=0` 초기화, 53행에서 조건 없이 `echo "node_reboot_required ${reboot}"`). 따라서 재부팅 뒤에도 시리즈는 살아 있고 `min_over_time(node_reboot_required[14d])`는 **0을 반환**한다 — 빈 벡터가 되는 경우는 없다.
> 관문은 **알림 식 그대로** 써야 한다: `count(min_over_time(node_reboot_required[14d]) == 1) or vector(0)` → **`0`**. 지금 이 값은 **2**다(실측). T1-14의 완료 조건을 이 형태로 고정한다.

#### D1-5. data05 systemd 수집기 복구 — `infra/monitoring/docker-compose.yml`

1순위 가설은 compose 주석(69-72행)이 이미 적어둔 대로 **D-Bus 소켓 `:ro` 마운트**다(소켓 `connect()`는 쓰기 권한 필요, 실측 소켓 모드 `srw-rw-rw-`).

```diff
-      - /run/dbus/system_bus_socket:/run/dbus/system_bus_socket:ro
+      # systemd 수집기는 D-Bus 소켓에 connect()해야 한다 — :ro면 실패(2026-08-02 실측 success=0).
+      - /run/dbus/system_bus_socket:/run/dbus/system_bus_socket
```

`/run/systemd:ro`는 유지. **적용 전 서버에서 `docker logs node-exporter | grep -i systemd`로 원인을 확정**하고, 다르면 이 태스크를 재설계한다(추정만으로 적용하지 않는다).

### 1.3 주요 판단

| 결정 | 근거 | 기각한 대안 |
|---|---|---|
| hardware-ops T0-1의 메트릭 이름 4개를 그대로 쓰고 **구현·배송 경로만** 담당 | `spec.md:555-566`(NvidiaVersionMismatch 555-561 · NvidiaSmiFailing 563-566)이 이미 두 알림 규칙을 이 이름으로 작성했고 AC-3-2·AC-3-3도 이 이름을 참조한다. 이름을 바꾸면 기존 스펙 전체가 드리프트한다. 실제 결함은 이름이 아니라 "스크립트가 data05에 도달하지 않는다"는 배송 문제 | `keiwi_gpu_driver_*` 새 네임스페이스 + 별도 exporter — 메트릭 2벌·알림 2벌이 생기고 hardware-ops AC가 죽는다 |
| 새 role을 만들지 않고 **기존 role의 가드를 분할** | .105·.101 모두 node-exporter가 이미 textfile을 정상적으로 읽고 있다(`collector_success`=1). 6개 태스크 중 진짜 apt 전용은 1개뿐 → 가드 범위 축소가 최소 변경 | `roles/node-hygiene-container` 신설 — 템플릿이 2벌이 되고 다음 메트릭 추가 때 한쪽만 고쳐지는 드리프트. .101은 컨테이너도 아니어서 3벌이 필요해진다 |
| 유저스페이스 버전을 **`ldconfig -p`**로 해석 | data01 NVML은 `/usr/lib/nvidia-418/libnvidia-ml.so.1`이고 `/usr/lib/x86_64-linux-gnu/`에는 `libnvidia-ml.so.*`가 0개다. 경로 고정 시 빈 문자열 → 오탐. `ldconfig -p`+`readlink -f`는 4노드(418.39/595.71.05/535.309.01/595.84) 전부에서 정확 | `nvidia-smi --version` 파싱 — .105에서는 에러 메시지로 동작하지만 정상 노드는 포맷이 완전히 다르다. **고장 상태와 정상 상태에서 파싱 경로가 갈리는 탐지기는 신뢰할 수 없다** |
| DCGM 라벨을 드라이버 버전 소스로 **쓰지 않는다** | (1) 커널모듈 버전만 보고하므로 유저스페이스 드리프트가 원리적으로 안 보인다 — 이 사고의 사각지대가 정확히 그것 (2) 라벨 자체가 .105에만 존재(메트릭 수 38 vs 30) | DCGM 라벨 기반 단독 사용 — hardware-ops T1-2가 그 레코딩을 정의하지만 보완재이지 대체재가 아니다 |
| `node_reboot_required`를 **예측 신호로 쓰지 않는다** | 실측 반증: .105 `reboot-required.pkgs`에 nvidia 패키지가 없는데 `dpkg -l`은 595.84 설치를 보여준다. apt가 드라이버 업그레이드를 기록하지 않았다 | `reboot_required == 1 and pkgs contains nvidia` 복합 조건 — 참이 되는 경우가 없어 영구 침묵하는 죽은 규칙 |
| 재부팅 부채를 **알림이 아니라 record + 패널 + 티켓**으로 두고, 알림은 부채 0 이후로 미룬다(T1-13→T1-14) | 실측상 `count(min_over_time(node_reboot_required[Xd]) == 1)`이 X=7d **2** · 14d **2** · 30d **1**이고, `offset 31d`는 빈 벡터(보존 30d)라 **X>30d는 표현 자체가 불가능**하다 → **표현 가능한 어떤 임계도 day-1 발화를 0으로 만들지 못한다**(§1.2 D1-4 선택지 표). 그것이 T0-7이 "알림 무시 습관의 시작"으로 지목한 패턴이다 | ① 즉시 알림 — day-1 red 2~3건 ② 임계를 30d·60d로 올림 — 30d에서도 .104가 발화하고 60d는 보존 밖이라 `min[30d]`와 동일식이다. **발화를 피하려고 임계를 올리는 것은 임계 근거가 아니다** ③ 기존 2건 silence — silence는 만료되고 그때 아무도 기억하지 못한다 ④ 노드 예외 목록 / "특정 시점 이후 전이만" — 예외 대상이 가장 오래된 부채(.104)라 **정확히 봐야 할 것을 가리고**, 하드코딩 목록은 이 표 아래에서 이미 기각한 패턴이며, offset 상수는 보존 밖으로 밀리면 **조용히 뜻이 바뀐다** |
| 판정 불능을 `node_nvidia_probe_ok=0`으로 **별도 노출** | 파싱 실패 시 0(정상)을 내보내면 같은 실패모드를 메트릭 레벨에서 재생산하고, 1(고장)을 내보내면 legacy 노드가 영구 오탐한다 | 메트릭 미노출 — no-data와 "수집기가 안 도는 것"이 구분되지 않아 이번 사고와 동일한 모호성이 남는다 |
| 커버리지 자체를 메트릭·알림으로 만든다 | 근본 원인은 드라이버 불일치가 아니라 **"탐지가 없는 노드가 있다는 것을 아무도 몰랐다"**다. 개별 메트릭만 추가하면 다음번에 같은 방식으로 빠지는 노드가 생긴다 | 노드 목록 하드코딩 `absent()` — 노드 추가/제거마다 손으로 고쳐야 하고, 잊으면 정확히 지금 상황이 재현된다 |
| data01에서 **apt 카운터만** 끈다 | 실측 248건이 영구 대기(16.04 EOL이라 영원히 줄지 않는다). 신호 가치 0인데 30분마다 가장 무거운 작업을 돌린다. data01은 Jupyter 커널 RSS 291GB로 이미 메모리 압박 | data01 전체 제외 — 커버리지 갭이 1로 남아 알림이 영구 발화하거나 예외를 하드코딩하게 되어 같은 종류의 사각지대를 만든다 |
| data05 systemd 복구를 이 축에 포함 | 같은 노드·같은 증상 계열(관측 부재)이고, 이번 사고의 2차 증거(`nvidia-cdi-refresh` failed)가 정확히 이 구멍 때문에 안 보인다. compose 주석이 원인 후보를 적어둬 변경 범위가 1줄 | hardware-ops T0-8에 위임 — T0-8은 `alerting/spec.md`의 서술을 "미작동"으로 **문서 교정**하는 태스크일 뿐 실제 복구가 아니다 |

### 1.4 수용 기준

| ID | 수용기준 | 검증 |
|---|---|---|
| **AC-1-1** | role 가드가 ARGS 주입 태스크에만 남는다 | `test "$(grep -c 'when: _nodeexp_default.stat.exists' infra/ansible/roles/node-hygiene/tasks/main.yml)" = 0 && grep -q 'when: node_hygiene_is_apt_node' infra/ansible/roles/node-hygiene/tasks/main.yml && echo PASS` → `PASS` |
| **AC-1-2** | 드라이런이 4노드 전부에서 `failed=0`·`unreachable=0`이고 각 노드가 changed를 계획 | `cd infra/ansible && ansible-playbook -i inventory.ini playbooks/agents.yml --tags node-hygiene --check --diff -K 2>&1 \| tail -12` → PLAY RECAP에 data01·03·04·05 **4호스트**, 각 `changed>0`·`failed=0`·`unreachable=0`. (14행 안내 debug 태스크를 지웠으므로 `skipped`는 ARGS 주입 1건만 — data01·data05에서 `skipped=1`이 정상) ⚠️ **`-K`는 선택이 아니다** — `ansible.cfg`가 `become = True`·`become_ask_pass = False`이고 data05는 `ansible_connection=local` + `sudo -n` rc=1이라, 없이 돌리면 data05가 `sudo: a password is required`로 **`failed=1`**이 된다 [실측]. NOPASSWD인 data01·03·04는 입력값을 쓰지 않는다. hardware-ops **T0-6** 완료 후에는 `-K`를 뺀다(README §4.2.1). 비번을 `-e ansible_become_password=`로 넘기지 않는다(§13 — 프로세스 목록에 남는다) |
| **AC-1-3** | 커버리지 갭 0 (현재 2) | `q 'fleet:node_hygiene_coverage:gap'` → `0` |
| **AC-1-4** | 위생 수집기가 4노드 전부에서 보고 | `q 'count(node_hygiene_collector_last_run_timestamp_seconds)'` → `4` (배포 전 2) |
| **AC-1-5** | data05에서 불일치가 **실제로 1로 탐지**된다 — hardware-ops T0-2의 기대치가 비로소 달성 가능해진다 | `q 'node_nvidia_version_mismatch{instance="192.168.1.105:9100"}'` → `1` · `node_nvidia_smi_ok` → `0` · `node_nvidia_smi_exit_code` → `18` (재부팅 전) |
| **AC-1-6** | 정상 3노드 오탐 0 — 특히 NVML 경로가 다른 data01 | `q 'node_nvidia_version_mismatch{instance!="192.168.1.105:9100"}'` → 전부 `0` · `q 'count(node_nvidia_probe_ok == 1)'` → `4` |
| **AC-1-7** | 버전 라벨이 실측 매트릭스와 정확히 일치 | `q 'node_nvidia_kernel_module_version'` / `q 'node_nvidia_userspace_version'` → kernel .101=418.39 .103=595.71.05 .104=535.309.01 .105=595.71.05 / userspace .105만 **595.84** |
| **AC-1-8** | 재부팅 대기가 3노드에서 관측(현재 .105 누락) | `q 'node_reboot_required == 1'` → .103·.104·.105 **3시리즈** (배포 전 2) |
| **AC-1-9** | data01 apt 카운터 미수집(EOL 248건 노이즈 차단), 나머지 위생은 정상 | `q 'node_apt_upgrades_pending{instance="192.168.1.101:9100"}'` → EMPTY · `q 'node_hygiene_collector_last_run_timestamp_seconds{instance="192.168.1.101:9100"}'` → 1시리즈 |
| **AC-1-10** | 레코딩 규칙이 유효하고 alert 키가 없다(헌장·파일 규약) | `bash scripts/gates/check-rules.sh --check infra/monitoring/rules/keiwi-hygiene-coverage.yml && test "$(grep -c '^[[:space:]]*- alert:' infra/monitoring/rules/keiwi-hygiene-coverage.yml)" = 0 && echo PASS` → `RULES_OK engine=…` + `PASS` (record **10건**, alert 0건). **promtool 부재와 무관하게 rc=0이어야 한다** — 없으면 `engine=structural`로 내려간다(§0.2.2). ⚠️ `promtool.sh`를 직접 부르지 말 것(엔진 없으면 exit 2) · raw `docker run … prom/prometheus … promtool`도 **동작하지 않는다**(§0.2.1) |
| **AC-1-11** | 커버리지 갭 알림과 런북이 실재 — 구멍이 다시 열리면 사람이 안다 | `grep -q 'NodeHygieneCoverageGap' … alert-rules.yaml && grep -q 'NodeHygieneStale' … && ls docs/runbooks/node-hygiene-coverage-gap.md docs/runbooks/node-hygiene-stale.md` → 알림 2건 + 런북 2파일 |
| **AC-1-12** | data05 systemd 수집기 복구 — `nvidia-cdi-refresh` 실패가 Prometheus에서 보인다 | `q 'node_scrape_collector_success{collector="systemd",instance="192.168.1.105:9100"}'` → `1`(현재 0) · `q 'count(node_systemd_unit_state{instance="192.168.1.105:9100",name=~".*nvidia.*"})'` → `>0`(현재 0) |
| **AC-1-13** | **증거 보존** — 재부팅 후 1→0 전이가 시계열에 모두 남는다. 순서 제약 위반을 **재부팅 후 30일 이내** 기계 판정 | 아래 스니펫 → `has1 True has0 True`. ⚠️ TSDB 보존이 정확히 **30d**라 그 이후에는 `has1 UNKNOWN`이 정상이다 — 영구 증거는 T1-11이 커밋하는 JSON 스냅샷이다 |
| **AC-1-14** | 소비처 미선언 노드에 생산자만 깔리는 새 실패모드가 차단(회귀 테스트) | `cd infra/ansible && ansible-playbook -i inventory.ini playbooks/agents.yml --tags node-hygiene --check --limit data03 -e 'node_hygiene_consumer=' 2>&1 \| grep -c 'node_hygiene_consumer 미선언'` → `≥1` (assert는 `--check`에서도 실패해야 한다 — D1-1 `--check` 규약. 대상이 data03 하나뿐이고 data03은 NOPASSWD라 `-K` 불필요 [실측]) |
| **AC-1-15** | **재부팅 부채가 알림이 아니라 지표로 존재한다** — day-1 상주 발화 0 | ① `q 'count(instance:node_reboot_debt:min14d) - count(node_reboot_required)'` → **`0`** (부채 창 record가 보고 노드 전부를 덮는다) ② `q 'count(instance:node_reboot_debt:min7d) - count(instance:node_reboot_debt:min30d)'` → **`0`** (창 3개가 같은 노드 집합에 다 존재) ③ **2단 판정 — T1-14 승격 관문(D1-4)이 판별자다**: 관문 2개(`fleet:node_reboot_required:count`=0 **및** `count(min_over_time(node_reboot_required[14d]) == 1) or vector(0)`=0)를 충족하기 **전에는** `! grep -q 'RebootRequiredStale' infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml; echo $?` → **`0`**(규칙 부재 — 있으면 day-1 상주 발화), **T1-14 완료 후에는** 같은 grep의 정답이 반대(규칙 존재)이며 그 판정은 **AC-1-17로 이관**된다. 단일 시점 정답은 하나다: "부채>0인데 규칙 존재"만이 red다 — 이렇게 쓰지 않으면 T1-14의 산출물이 이 AC를 영구 red로 만든다(배타 해소). ⚠️ **부채의 "값"을 AC로 박지 않는다** — T1-13이 부채를 0으로 만드는 것이 이 스펙의 목표인데 `count`=2를 수용 기준으로 두면 **목표 달성이 곧 AC red**다. 값의 스냅샷(`fleet:node_reboot_required:count`=**2**, T1-4 후 3 / `min14d` .103·.104 각 1)은 §1.1의 실측 기록이지 수용 기준이 아니다 |
| **AC-1-16** | **promtool이 없어도 규칙 게이트가 돈다** — 해석기가 부재를 정직하게 보고하고 폴백이 그것을 메운다 | ① `bash scripts/gates/promtool.sh --which; echo rc=$?` → `path\|docker\|cache\|none` 중 1줄 + **`rc=0`**(부재는 오류가 아니라 상태다. 시도 경로가 stderr에 남는다. 기대값은 시점에 따라 다르다 — **T5-26 전 `none`, T5-26 후 `path`**: `~/.local/bin`은 이 호스트 PATH에 이미 있다 [실측]. W0(T5-26)가 W1(T1-12)보다 앞이므로 통상 판정 시점의 정답은 `path`다) ② **폴백 강제 스위치로 폴백 경로를 검증한다**(§0.2.1 — promtool이 설치돼 있어도 이 판정이 성립하는 이유): `KEIWI_PROMTOOL_ENGINE=none bash scripts/gates/check-rules.sh --check infra/monitoring/rules/keiwi-hygiene-coverage.yml; echo rc=$?` → `RULES_OK engine=structural` + `rc=0` ③ 폴백이 진짜로 검사한다는 역증명: `printf 'groups:\n- name: x\n  rules:\n  - record: bad\n    expr: sum(rate(foo[5m])\n' > /tmp/ac116.yml; KEIWI_PROMTOOL_ENGINE=none bash scripts/gates/check-rules.sh --check /tmp/ac116.yml; echo rc=$?` → **`rc=1`**(괄호 불균형). ⚠️ 이 AC는 promtool 설치를 요구하지 않는다(요구하면 새 클론에서 red다) — 동시에 **설치돼 있어도 red가 아니다**: ②③이 스위치로 엔진을 고정하므로 T5-26(W0) 후에도 폴백 경로가 항상 검증된다. 스위치 없이 자동 해석에 맡기면 T5-26 후 ②가 영원히 promtool 경로만 돌아 **폴백이 조용히 썩는다** |
| **AC-1-17** | `[server]` **T1-14 승격이 "규칙 존재 + day-1 발화 0"으로 완결된다** — AC-1-15 ③의 2단 중 후단 | ① 적용 직전 관문 재확인: `q 'fleet:node_reboot_required:count'` → `0` · `q 'count(min_over_time(node_reboot_required[14d]) == 1) or vector(0)'` → `0` ② 규칙·런북 존재: `grep -c 'RebootRequiredStale' infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml` → `≥1` · `ls docs/runbooks/reboot-required-stale.md` → 존재 ③ 라이브 반영 + 발화 0(적용 후 `for` 창 15m 경과 뒤): `curl -s localhost:3000/api/prometheus/grafana/api/v1/alerts \| python3 -c "import sys,json;a=[x for x in json.load(sys.stdin)['data']['alerts'] if x.get('labels',{}).get('alertname')=='RebootRequiredStale'];print(len(a))"` → `0`(firing·pending 0건 — 관문식=알림식이므로 ①이 0이면 이 값도 0이어야 하고, 아니면 관문 검증이 깨진 것이다) |

```bash
# AC-1-13 — has1이 False면 재부팅이 먼저 일어나 증거가 소실된 것이다.
#          결과가 비면(보존 만료·미배포) 예외로 죽지 않고 UNKNOWN을 출력한다.
curl -s --get http://localhost:9090/api/v1/query_range \
  --data-urlencode 'query=node_nvidia_version_mismatch{instance="192.168.1.105:9100"}' \
  --data-urlencode "start=$(date -d '30 days ago' +%s)" \
  --data-urlencode "end=$(date +%s)" --data-urlencode 'step=300' \
| python3 -c "
import sys,json
res=json.load(sys.stdin)['data']['result']
if not res:
    print('has1 UNKNOWN has0 UNKNOWN — 보존 만료(30d) 또는 미배포. T1-11 스냅샷을 보라'); raise SystemExit(0)
v=[p[1] for p in res[0]['values']]
print('has1',('1' in v),'has0',('0' in v))"
```

> T1-11은 이 `query_range` 응답을 `docs/runbooks/nvidia-driver-mismatch.md` 옆에 **JSON 파일로 커밋**한다. TSDB 보존(30d) 만료 후에도 남는 유일한 증거이며, AC-1-13은 30일 이내의 보조 판정이다.

---

## 2. 축 2 — 물리 디스크 SMART 가시화 (RAID 컨트롤러 뒤)

### 2.1 문제 (실측)

Prometheus에 들어오는 디스크 건강 신호는 `smartctl_device_smart_status` **3개가 전부**이고 셋 다 `model_name="HPE LOGICAL VOLUME"`이다. data05 sda·sdb는 `serial_number`까지 동일(`PZXNL0ARHFU8J0`) — 컨트롤러 시리얼이지 디스크 시리얼이 아니다.

노출 메트릭 전량 `count by(__name__)({__name__=~"smartctl_.*"})`: `smartctl_device` 3 · `_smart_status` 3 · `_temperature` 6 · `_capacity_bytes` 3 · `_capacity_blocks` 3 · `_block_size` 6 · `_smartctl_exit_status` 3 · `smartctl_devices` 2.
**`smartctl_scsi_grown_defect_list`·`smartctl_device_attribute`·`smartctl_read_total_uncorrected_errors`·`smartctl_device_power_on_seconds`는 0계열이다.**

스캔이 물리 디스크를 못 본다: `smartctl --scan-open` → data05 `/dev/sda -d scsi`·`/dev/sdb -d scsi`, data03 `/dev/sda`, data04 `/dev/sda`·`/dev/sdb`뿐. 세 노드 모두 `/sys/class/scsi_generic`에 물리 디스크 노드가 없다(Smart Adapter·LOGICAL VOLUME·RAID 컨트롤러만).

**컨트롤러 [실측]** data03 = HPE **P816i-a SR Gen10**(smartpqi, LV 1개 36.4T) · data04 = **P816i-a SR Gen10**(smartpqi, LV 447.1G + 21.8T) · data05 = **P408i-a SR Gen10**(smartpqi, LV 447.1G + 3.5T, SES 8베이) · data01 = HP **P840ar** Gen9(hpsa, LV 27.3T). NVMe는 4노드 전부 0개.

**`-d cciss,N`은 smartpqi에서 동작한다 [핵심 실측]** data03 `sudo smartctl -i -d cciss,0 /dev/sg2` → `Product: MB004000JWKGU / Serial number: V6GN52VS / 4.00 TB / SAS (SPL-4)`.

| 노드 | 물리 디스크 | 구성 |
|---|---|---|
| data03 | **12본** | 전부 4TB SAS 7200rpm. `cciss,12`=`HPE Smart Adapter`(디스크 아님), 13+ = `No such device or address`. 36.4TiB LV ≒ 12×4TB RAID6과 정합 |
| data04 | **12본** | `cciss,0`·`4`는 **SATA SSD**(`INTEL SSDSC2BB480G7`, `GIGABYTE GP-GSTFS31480GNTD`, 각 480GB, `device.type=sat`), 나머지 10본은 SAS 4TB |
| data05 | **미측정** | 사유: hardware-ops T0-6(sudoers 순서) 미해소. 추정 대수를 적지 않는다 |
| data01 | **미측정** | smartmontools 미설치, 후보 6.4(`--json`은 7.0부터). hpsa에서 `-d cciss,N` 동작 미검증 |

**살아있는 고장 전조 2건 (현재 관측 불가)**

| 디스크 | POH | grown defect | 미교정 오류 | `smart_status.passed` |
|---|---|---|---|---|
| data04 `ZC1AE78X` (MB4000JVYZQ) | 63,777h | **773** | 0 | **true** |
| data04 `ZC1968JB` | 63,777h | **66** | read **8** / write **1** | **true** |

두 디스크 모두 passed=true라 라이브 `SmartHealthFailed`(`smartctl_device_smart_status < 1`)는 **디스크별로 켰어도 발화하지 않는다.**
마스킹의 직접 증거: 이 둘이 구성하는 24.0TB LV(`/dev/sdb`)에 `smartctl -a` → `SMART Health Status: OK` · `Error Counter logging not supported` · `Current Drive Temperature: 0 C` · `Device does not support Self Test logging`.

나머지는 정상 베이스라인: data03 12본 GDL=0·미교정=0(온도 31~41℃, POH 4,118~4,120h 11본 + 68,808h 1본 `ZC112XQT`), data04 SAS 8본 GDL=0·미교정=0(POH ~4,119h).

**기성 exporter가 원리적으로 못 한다 [소스 확인, v0.14.0 및 현재 master 동일]**

| # | 위치 | 내용 | 결과 |
|---|---|---|---|
| B1 | `smartctl.go:45 buildDeviceLabel(name,type)` | `type`에 콤마가 있을 때만 인덱스를 라벨에 붙인다. 그런데 smartctl JSON의 `device.type`은 `"cciss"`(SATA는 `"sat"`) — **콤마가 없다** | 12본이 전부 `device="sg2"` → 중복 계열 → `/metrics` 500 |
| B2 | `smartctl.go:116 if smart.device.interface_ == "scsi"` | `interface_` = `"cciss"` ≠ `"scsi"` | `mineSCSIGrownDefectList`·`mineSCSIErrorCounterLog` **미실행** = 이 축의 핵심 신호 전량 유실 |

B1은 udev 심볼릭 링크로 우회 가능하지만 **B2는 코드 분기라 우회 불가**다. 배포된 바이너리는 `0.14.0 (rev ef5c03d, 2025-04-22)`.

**죽은 대시보드 패널 3개** `dashboards/syshealth.json` 패널 6·8은 `smartctl_device_percentage_used`/`_available_spare`(NVMe 전용, 플릿 NVMe 0개), 패널 7은 `smartctl_device_attribute{attribute_name="Reallocated_Sector_Ct"}`(0계열) → **영구 공백**.

### 2.2 설계

#### D2-1. 기성 exporter를 버리고 node-exporter textfile collector로 간다

B2가 코드 분기 문제라 우회 불가고, 업스트림 패치 + Go 빌드 + 오프라인 vendoring + 드리프트 관리 비용 대비 이미 4노드에 살아 있는 textfile 경로가 압도적으로 싸다.

#### D2-2. data04 `:9634` 터널 블로커는 **소멸한다**

textfile은 node-exporter가 읽는다. data04 node-exporter는 이미 `172.18.0.1:9104 → data04:9100` 터널로 스크랩 중이고 `/var/lib/node_exporter/textfile/keiwi_node_hygiene.prom`이 실제로 쓰이고 있다(`node_textfile_scrape_error`가 4노드 전부 0). 따라서:

- **신규 포트 0 · 신규 터널 항목 0 · ufw 규칙 0 · Prometheus job 0개 추가.**
- `infra/monitoring/prometheus.yml:119-127`의 `:9634` 활성화 안내 블록을 **삭제**하고 "물리 디스크는 textfile 경로로 수집한다"로 대체. ⚠️ **128행(공백)·129-131행은 건드리지 않는다** — 129-131은 GlitchTip job의 `ENABLE_OBSERVABILITY_API=True` 없으면 404라는 운영 경고이고 이 축과 무관하다.
- 덤으로 **data01(16.04)·data05(컨테이너)도 같은 경로로 커버된다** — 기존 `roles/smartctl-exporter`는 apt 노드 전제라 두 노드를 못 덮었다.

기존 `roles/smartctl-exporter`(:9633)는 **유지한다.** 이미 라이브·green이고 LV 단위 용량·블록크기·컨트롤러 판정이라는 별개 사실을 준다. 다만 대시보드에서 **"논리 볼륨"**으로 명확히 강등한다 — `min(smartctl_device_smart_status)`가 "플릿 디스크 건강"인 것처럼 읽히는 현재 제목이 실제 위험을 은폐한다.

#### D2-3. 만드는 메트릭 / 만들지 않는 것

접두사는 **`node_smart_`**(textfile 경로 관례, `node_reboot_required`·`node_apt_upgrades_pending`과 동일). `smartctl_device_*`를 재사용하지 않는다 — LV 사실과 물리 디스크 사실이 같은 이름으로 섞이면 `count()`·`min()`이 거짓말을 한다(3 vs 27이 뒤섞인다).

| 메트릭 | 타입 | JSON 소스 | 적용 |
|---|---|---|---|
| `node_smart_disk_info{controller,ctrl_dev,disk_index,protocol,model,serial,firmware,form_factor,rotation_rate}` | gauge=1 | `scsi_model_name`\|`model_name`, `serial_number`… | 전체 |
| `node_smart_disk_health_passed{controller,disk_index,serial}` | gauge 1/0 | `smart_status.passed` | 전체 |
| `node_smart_disk_temperature_celsius` | gauge | `temperature.current` | 전체 |
| `node_smart_disk_temperature_trip_celsius` | gauge | `temperature.drive_trip` | 존재 시 |
| `node_smart_disk_power_on_hours` | gauge | `power_on_time.hours` | 전체 |
| `node_smart_disk_capacity_bytes` | gauge | `user_capacity.bytes` | 전체 |
| **`node_smart_disk_grown_defect_list`** | gauge | `scsi_grown_defect_list` | SAS |
| **`node_smart_disk_uncorrected_errors_total{op="read"\|"write"}`** | counter | `scsi_error_counter_log.<op>.total_uncorrected_errors` | SAS |
| `node_smart_disk_rereads_rewrites_total{op=…}` | counter | `…errors_corrected_by_rereads_rewrites` | SAS |
| `node_smart_disk_processed_bytes_total{op=…}` | counter | `…gigabytes_processed` × 1e9 | SAS |
| `node_smart_disk_ata_attribute_raw{attr_id,attr_name}` | gauge | `ata_smart_attributes.table[]` **화이트리스트 5·187·188·197·198·199·231·233만** | SATA |
| `node_smart_disk_ata_attribute_normalized{attr_id,attr_name}` | gauge | 동상 `.value` | SATA |
| **`node_smart_disks_total{controller,ctrl_dev}`** | gauge | 발견된 물리 디스크 수 | 전체 |
| `node_smart_collector_last_run_timestamp_seconds` / `_duration_seconds` / `_probe_errors` | gauge | 자체 | 전체 |

`node_smart_disks_total`이 이 축의 조용한 핵심이다. **LV은 멤버 디스크가 빠져도 끝까지 `OK`를 말한다** — 대수가 12→11로 떨어지는 것만이 "디스크가 사라졌다"를 말해준다.

**만들지 않는다 (HPE/smartctl이 주지 않는 값을 지어내지 않는다)**

- **베이/슬롯 번호** — SES는 data03/04(12슬롯)·data05(8슬롯) 전 슬롯을 `not installed`로 보고한다. `cciss,N`의 N은 베이가 아니다. 물리 식별은 **`serial`**.
- **`verify` 오류 카운터 · Non-medium error count** — JSON에 ABSENT(텍스트 출력 전용). 정규식으로 끌어오면 smartmontools 버전마다 깨진다.
- **`errors_corrected_by_eccfast`/`eccdelayed`** — 벤더 상대값이고 고장 신호가 아니다(data03 `cciss,0`은 eccdelayed 405인데 GDL 0·미교정 0인 정상 디스크).
- **통합 "SSD 수명 잔량 %"** — 벤더마다 속성 id가 달라 합성하면 거짓이 된다. 원시/정규화 속성만.
- **RAID 어레이 상태** — `ssacli`/`hpssacli`가 4노드 어디에도 없다. 범위 밖(백로그).
- **NVMe 계열** — 플릿에 0개.

#### D2-4. 수집기 (`roles/disk-smart-textfile/templates/keiwi-disk-smart.sh.j2`)

```bash
set -euo pipefail
# 1) 컨트롤러 sg 노드 탐색: /sys/class/scsi_generic/* 중 device/type == 12 (RAID)
#    실측 매핑 — data03=sg2, data04=sg3, data05=sg4, data01=sg0(P840ar, 미검증)
#    폴백: model이 ^P[0-9]+i 패턴
# 2) N = 0 .. {{ disk_smart_max_index }}(기본 24)
#    timeout {{ disk_smart_probe_timeout }}(기본 15) \
#      smartctl --json --info --health --attributes --log=error -d cciss,$N /dev/sgX
#    · 파싱은 python3 json.load (정규식/jq 금지 — jq는 노드에 없다)
#    · device_type.name != "disk"        → 어댑터(data03 cciss,12) → 스킵, 오류 아님
#    · exit_status bit1(=2, open failed) → 부재 → miss_streak++
#    · miss_streak >= {{ disk_smart_miss_streak }}(기본 4) → 조기 종료
# 3) TMP=$(mktemp "$TEXTFILE_DIR/.keiwi_disk_smart.XXXXXX"); … ; mv -f "$TMP" \
#      "$TEXTFILE_DIR/keiwi_disk_smart.prom"       # node-hygiene과 동일한 원자적 교체
```

node-hygiene의 원자적 쓰기·trap·`chmod 0644`·`mv -f` 패턴을 그대로 따른다(`templates/keiwi-node-hygiene.sh.j2:16,62-65`).

유닛은 oneshot + timer. `Nice=10` · `IOSchedulingClass=idle` · `NoNewPrivileges=true` · `ProtectHome=true` · `ReadWritePaths={{ disk_smart_textfile_dir }}` · `TimeoutStartSec=180`.
**`PrivateDevices=true` 금지** — `/dev/sgN`을 숨기면 수집 불가(smartctl-exporter 유닛 주석과 동일 이유).
타이머는 `OnBootSec=5min` · `OnUnitActiveSec={{ disk_smart_interval }}`(기본 15min) · `Persistent=true`.

role 가드는 node-hygiene과 **다르게** 잡는다: `disk_smart_textfile_dir` 존재 + `smartctl --version >= 7.0` 두 조건 → 4노드 전부를 덮는다.
버전 조회는 `command` 모듈이므로 **`check_mode: false`를 반드시 붙인다** — 안 붙이면 `--check`에서 그 태스크가 스킵돼 register에 `rc`가 없고 가드가 통째로 거짓이 되어 role 전체가 드라이런에서 사라진다(T2-12가 기대하는 "changed 3개"가 안 나오고, AC-2-10의 `changed=0`은 **공허하게** 통과한다). D1-1의 pgrep 태스크와 **같은 결함**이고 같은 규약을 따른다.

#### D2-5. Prometheus / Grafana 배선

`rules/keiwi-recording.yml`에 추가(현행 파일은 `record:`만 허용):

```yaml
- record: instance:node_smart_disks:count
  expr: sum by (instance) (node_smart_disks_total)
- record: instance:node_smart_defects:max
  expr: max by (instance) (node_smart_disk_grown_defect_list)
- record: serial:node_smart_defects:increase7d
  expr: max by (instance, serial) (increase(node_smart_disk_grown_defect_list[7d]))
- record: instance:node_smart_uncorrected:increase24h
  expr: sum by (instance, serial) (increase(node_smart_disk_uncorrected_errors_total[24h]))
```

`dashboards/syshealth.json` row `id=200`을 **"디스크 건강 (물리 디스크 · 논리 볼륨)"**으로 바꾸고: stat `물리 디스크 수`(`sum(node_smart_disks_total)`) · table `물리 디스크 목록`(`node_smart_disk_info` + GDL join) · table `결함 섹터 상위`(`topk(10, …)`) · timeseries `결함 섹터 증가(7d)`. 패널 1·5 제목에 "논리 볼륨" 명시.

> [!NOTE]
> **죽은 패널 6·7·8 제거는 이 축이 하지 않는다 — 축4 T4-6(W2)으로 이관했다.** 세 패널이 참조하는 `smartctl_device_percentage_used`·`_attribute`·`_available_spare`가 라이브 918개 스냅샷에 없어서, 축4의 메트릭명 가드가 W2에 켜지는 순간 CI가 W4까지 red로 남기 때문이다(§0.3). 축2는 **추가**만 하고 정리는 이미 같은 파일을 여는 T4-6이 한다.

#### D2-6. 알림 (섀도 우선, day-1 오발화 0)

**절대값 임계 금지.** data04에 GDL 66·773이 이미 있어 `> 0`을 걸면 첫날부터 상주 발화 = hardware-ops T0-7이 정리한 습관을 다시 만든다. 전부 **증분** 기반으로 간다.

| 후보 | 식 | for | 근거 |
|---|---|---|---|
| `DiskGrownDefectsGrowing` | `increase(node_smart_disk_grown_defect_list[24h]) > 0` | 0s | 오늘 새 불량섹터 = 열화 진행 중 |
| `DiskUncorrectedErrorsGrowing` | `increase(node_smart_disk_uncorrected_errors_total[24h]) > 0` | 0s | 미교정 I/O = 데이터 손실 실현 |
| `PhysicalDiskDisappeared` | `node_smart_disks_total < node_smart_disks_total offset 1h` | 10m | LV이 절대 말해주지 않는 사실 |
| `SmartHealthFailed` **확장** | 기존 refId A(`smartctl_device_smart_status`)에 refId B(`node_smart_disk_health_passed`) 추가, OR 결합 | 0s | `alert-rules.yaml:318-346` 규칙의 무력화 해소. alerting §10-3 열린 질문 종결 |

전부 `specs/alerting`의 2주 섀도 절차를 거쳐 승격한다 — 이 축은 **규칙 파일 생성까지**다.

#### D2-7. data01 분기

P840ar/hpsa + smartmontools **6.4**(`--json` 미지원). `infra/logging/filebeat-xenial/`이 세운 전례(xenial 전용 정적 바이너리 vendoring)를 따른다: `infra/monitoring/disk-smart/smartmontools-xenial/smartctl`(정적 7.x)를 role이 배포하고 `disk_smart_smartctl_path`로 주입. **hpsa에서의 `-d cciss,N` 동작은 미검증** — [server] 검증 태스크(T2-17) 통과 후에만 배포하고, 실패 시 **data01을 범위 밖으로 명시하고 사유를 남긴다**(27.3T LV 하나가 사각지대로 남는다는 사실을 숨기지 않는다).

### 2.3 주요 판단

| 결정 | 근거 | 기각한 대안 |
|---|---|---|
| 기성 `smartctl_exporter`를 확장하지 않고 textfile로 | B1(라벨 충돌)은 udev로 우회 가능하나 **B2(SCSI miner 미실행)는 코드 분기라 우회 불가** — 우리가 필요한 바로 그 두 신호가 죽는다 | 업스트림 패치 + 자체 빌드 vendoring — Go 툴체인·오프라인 바이너리·드리프트 추적 비용이 셸 1개보다 크고, 살아있는 textfile 경로를 놀린다 (업스트림 기여는 별건 백로그) |
| `roles/smartctl-exporter`(:9633) 유지하되 "논리 볼륨"으로 강등 | 라이브 green이고 LV 단위 사실을 준다. 문제는 존재가 아니라 **명명이 실제 위험을 은폐**하는 것 | 전면 철거 — green 자산을 없애 가치 0을 얻고 `SmartHealthFailed`를 다시 짜야 한다 |
| `node_smart_*` 새 이름공간 | 같은 이름에 LV과 물리 디스크가 섞이면 "몇 본인가"를 묻는 모든 쿼리가 조용히 틀린 답을 한다. 라벨 스키마도 job도 다르다(`:9633` vs `:9100`) | `smartctl_device_*` 재사용 — 기존 대시보드가 자동으로 살아나는 매력이 있으나 관측 스택이 거짓말하지 않는 것이 이 축의 존재 이유다 |
| 알림 임계를 `increase(…[24h]) > 0` 증분으로 | GDL 66·773이 이미 있다. 절대 임계는 첫날 critical 2건 상주 = T0-7이 "알림 무시 습관의 시작"으로 지목한 패턴. 기존 773은 대시보드 + 교체 티켓으로 처리 | `grown_defect_list > 50` — 임계 근거가 없고(HPE가 권고 수치를 주지 않는다) 노드·모델·가동시간마다 의미가 달라 서버별 임계 지옥 |
| 베이/슬롯 번호를 만들지 않고 `serial`로만 식별 | SES가 3개 Gen10 노드 전 슬롯을 `not installed`로 보고한다. `cciss,N`의 N은 컨트롤러 내부 열거 순서지 베이가 아니고 교체 시 밀린다 | `disk_index`를 베이로 라벨링 — 런북에서 "3번 베이를 빼라"고 쓰게 되고, 틀리면 **정상 디스크를 뽑는다.** 되돌릴 수 없는 사고 |
| `verify`·Non-medium·통합 SSD 수명% 미생성 | 앞 둘은 JSON에 ABSENT(텍스트 전용), SSD 수명%는 벤더별 속성 id가 달라 합성하면 거짓 | `smartctl -a` 텍스트 병행 파싱 — 파서 표면적 2배 + hardware-ops C5(root 셸의 외부 텍스트 파싱) 위험 재현 |
| `eccfast`/`eccdelayed` 버리고 `rereads_rewrites`·`total_uncorrected_errors`만 | data03 `cciss,0`은 eccdelayed 405인데 완전 정상 — 벤더 상대값이라 고장 신호가 아니다. 405라는 큰 숫자가 대시보드에서 정상 디스크를 빨갛게 만든다 | 전 카운터 방출 |
| node-hygiene 확장이 아니라 **별도 role** | node-hygiene은 apt 노드 가드로 data01·data05를 **구조적으로 배제**한다. 물리 디스크는 그 둘을 반드시 덮어야 한다. 가드 조건도 주기도 다르다(30min vs 15min) | node-hygiene에 SMART 블록 추가 — 가드를 풀면 apt 판별 로직이 무너지고, apt 실패가 SMART 수집까지 같이 죽인다(한 스크립트 `set -e`) |
| data01은 **hpsa 동작 검증 뒤에만** 배포 | 6.4는 `--json` 미지원이고 hpsa에서 `-d cciss,N`이 될지 미검증. `filebeat-xenial`이 정적 vendoring 전례를 세웠다 | apt로 6.4 설치 후 텍스트 파싱(파서 2벌) / data01을 조용히 제외(27.3T가 사각지대인 사실을 숨김) — 둘 다 거부 |

> [!IMPORTANT]
> **이 표의 판단 4건은 헌장 §8("모든 의존성·컴포넌트 선택은 ADR")의 대상이다** — 업스트림 `smartctl_exporter` 기각 · 신규 role `disk-smart-textfile` 신설 · 신규 이름공간 `node_smart_*` · data01용 정적 바이너리 vendoring. 표는 훌륭한 근거이지만 `docs/decisions/`에 남는 아티팩트가 아니고, §10("컨텍스트에 없으면 존재하지 않는다")에 따르면 다음 사람에게는 없는 것과 같다.
> → **ADR-0024 「물리 디스크 SMART 수집 방식 — textfile collector vs 업스트림 exporter」**를 신설한다(T2-20). B1·B2 소스 인용, 4노드 커버리지 비교, vendoring 전례(`infra/logging/filebeat-xenial`), 그리고 **업스트림이 B2를 고치면 이 결정을 재검토한다**는 되돌리기 조건을 담는다.

### 2.4 수용 기준

| ID | 수용기준 | 검증 |
|---|---|---|
| **AC-2-1** | 물리 디스크가 노드별로 발견된다 — data03 12본, data04 12본(SAS 10 + SATA SSD 2) | `q 'sum(node_smart_disks_total)'` → **≥ 24** (data05·data01 배포 후 상향하고 spec에 실측치 기록) |
| **AC-2-2** | 열화 디스크 결함 수가 라이브 smartctl 값과 일치(마스킹 해소의 직접 증명) | 아래 스니펫 → `MATCH:773` |
| **AC-2-3** | LV 계열과 물리 디스크 계열이 이름공간으로 분리 | `q 'count(smartctl_device_smart_status)'` → `3`(불변) · `q 'count(node_smart_disk_health_passed)'` → `≥24` |
| **AC-2-4** | 수집기 신선도 — stale `.prom`을 살아있는 값으로 오인하지 않는다 | `q 'max(time() - node_smart_collector_last_run_timestamp_seconds)'` → `< 1800` |
| **AC-2-5** | textfile 파서 오류 0 | `q 'max(node_textfile_scrape_error)'` → `0` |
| **AC-2-6** | 생성되는 `.prom`이 노출 형식 규약을 만족(CI, 라이브 불요) | `bash scripts/gates/check-smart-metric-allowlist.sh --render-check; echo rc=$?` → `EXPOSITION_OK engine=…` + `rc=0`. 내부적으로 `render-smart-fixture.sh`(헬퍼)로 4케이스를 렌더하고 `promtool check metrics`(있으면) 또는 `tools/promtool_fallback.py check-metrics`(§0.2.2)로 검사한다. ⚠️ **맨몸 `promtool`은 이 호스트에 없다**(실측) — 그래도 rc=0이어야 하며 `engine=structural`로 내려간다. 폴백은 노출 형식 lint까지만 하고 히스토그램/서머리의 의미적 정합은 보지 않는다 |
| **AC-2-7** | 연구자 워크로드 영향 상한 — 수집 1회 10초 미만 | `q 'max(node_smart_collector_duration_seconds)'` → `< 10` (기준선 data03 3.22s) |
| **AC-2-8** | 신규 리스닝 포트·터널 항목 0 | `! grep -q '9634' infra/monitoring/prometheus.yml && echo REPO_CLEAN` + data04 `ss -ltn \| grep -cE ':963[0-9]'`가 배포 전후 동일 |
| **AC-2-9** | 물리 디스크 패널이 실재하고 죽은 패널이 되살아나지 않았다 | 아래 스니펫 → `dead [] physical True`. **죽은 패널 제거 자체는 축4 AC-4-19(W2)가 판정**하고, 이 AC는 W4 최종 상태를 확인한다 |
| **AC-2-10** | role 멱등 — 두 번째 `--check`에서 changed=0 | `cd infra/ansible && ansible-playbook playbooks/agents.yml --tags disk-smart --check --limit data03,data04 \| tail -5` → PLAY RECAP `changed=0` |
| **AC-2-11** | **day-1 오발화 0** — 기존 GDL 66·773이 있어도 발화하지 않는다(증분 설계 검증) | `q 'count(increase(node_smart_disk_grown_defect_list[24h]) > 0)'` · `q 'count(increase(node_smart_disk_uncorrected_errors_total[24h]) > 0)'` · `q 'count(node_smart_disks_total < (node_smart_disks_total offset 1h))'` → **세 값 모두 0** (24h 관측 후 재확인) |
| **AC-2-12** | 근거 없는 메트릭 금지 — 방출 메트릭 집합 == spec 승인 목록 | `bash scripts/gates/check-smart-metric-allowlist.sh` → `OK: 승인 목록 외 0건, 미구현 0건` (exit 0) |
| **AC-2-13** | 안전 — textfile 밖에 쓰지 않고 실패 시 부분 출력을 남기지 않는다 | `grep -q 'set -euo pipefail' …/keiwi-disk-smart.sh.j2 && grep -q 'ReadWritePaths' …/keiwi-disk-smart.service.j2 && grep -q 'mv -f' …/keiwi-disk-smart.sh.j2 && ! grep -qE '(^\|[^a-z])eval ' …/keiwi-disk-smart.sh.j2 && echo SAFE_OK` |
| **AC-2-14** | `SmartHealthFailed`가 물리 디스크를 실제로 감시한다 | `python3 -c "import yaml;d=yaml.safe_load(open('infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml'));r=[x for g in d['groups'] for x in g['rules'] if x.get('uid')=='keiwi-smart-fail'][0];e=[m['model'].get('expr','') for m in r['data']];assert any('node_smart_disk_health_passed' in s for s in e);print('OK')"` |
| **AC-2-15** | 신규 알림 3건 전부 runbook_url이 실재 파일을 가리킨다 | `test -f docs/runbooks/disk-grown-defects.md` + 3규칙의 `annotations.runbook_url`에 `disk-grown-defects.md` 포함 |

```bash
# AC-2-2 — Prometheus 값과 노드 실측값이 같으면 통과(그 사이 증가했다면 두 값이 함께 오른다).
# ⚠️ cciss 인덱스를 하드코딩하지 않는다 — §7.4가 "인덱스는 교체 시 밀린다"고 스스로 적었고
#    설계 원칙이 serial 고정이다. 인덱스를 순회해 serial이 일치하는 응답을 찾는다.
SER=ZC1AE78X
P=$(curl -s --get --data-urlencode "query=node_smart_disk_grown_defect_list{serial=\"$SER\"}" \
     http://localhost:9090/api/v1/query \
   | python3 -c "import sys,json;r=json.load(sys.stdin)['data']['result'];print(int(float(r[0]['value'][1])) if r else 'NOSERIES')")
S=$(ssh -p 764 mhchoi@192.168.1.104 "for n in \$(seq 0 24); do sudo -n smartctl --json -d cciss,\$n /dev/sg3 2>/dev/null; done" \
   | python3 -c "
import sys,json
buf=sys.stdin.read()
dec=json.JSONDecoder(); i=0
while i < len(buf):
    while i < len(buf) and buf[i] not in '{': i+=1
    if i >= len(buf): break
    try: obj,i = dec.raw_decode(buf,i)
    except ValueError: i+=1; continue
    if obj.get('serial_number')=='$SER': print(obj.get('scsi_grown_defect_list')); break
else: print('NOTFOUND')")
[ "$P" = "$S" ] && echo MATCH:$P

# AC-2-9 — row가 접힌 채 저장되면 하위 패널이 d['panels'] 밖으로 들어가므로 중첩까지 본다.
python3 -c "
import json
d=json.load(open('infra/monitoring/dashboards/syshealth.json'))
ps=d['panels']+[q for p in d['panels'] for q in (p.get('panels') or [])]
dead=[(p.get('id'),t.get('expr')) for p in ps for t in (p.get('targets') or [])
      if any(k in t.get('expr','') for k in ['percentage_used','available_spare','smartctl_device_attribute'])]
phys=any('node_smart_disks_total' in t.get('expr','') for p in ps for t in (p.get('targets') or []))
print('dead',dead,'physical',phys); assert not dead and phys"
```

---

## 3. 축 3 — GPU 장애 런북 + runbook_url 무결성 CI 게이트

### 3.1 문제 (실측)

라이브 알림 9건은 전부 runbook_url을 Slack 본문에 렌더링하는데(`contact-points.yaml:46,69`), 알림 전용 런북을 가리키는 건 `LogIngestStalled` 1건뿐이다.

| runbook_url | 알림 수 |
|---|---|
| `docs/runbooks/node-onboarding.md` | 3 (NodeDown·MemoryLow·OomKillOccurred) |
| `infra/logging/README.md` | 2 (DiskUsageHigh·DiskFillPredicted) |
| `specs/hardware-ops/README.md` | 2 (GpuTempHigh·GpuXidErrorNew) |
| `infra/monitoring/smartctl-exporter/README.md` | 1 (SmartHealthFailed) |
| `docs/runbooks/log-ingestion-stopped.md` | 1 (LogIngestStalled) |

문제는 "다른 문서를 가리킨다"가 아니라 **발화한 단어조차 없는 문서를 가리킨다**는 것이다:
`grep -ci xid specs/hardware-ops/README.md` = **0** · `grep -ci oom docs/runbooks/node-onboarding.md` = **0** · `grep -ciE '교체|replace' infra/monitoring/smartctl-exporter/README.md` = **0**.
게다가 그 smartctl README 7행은 **"수집만. 알림/recording rule 미생성(사용자 알림 보류 — 헌장 정책)"**이라 적혀 있는데, 라이브에는 `SmartHealthFailed`(critical)가 존재하고 그 알림이 이 문서를 가리킨다.

**문구 드리프트** `alert-rules.yaml:196` `gt 92` vs `:204` summary `'… 85°C 초과 10분'`. 라이브 API 반환값도 동일하고 레포본과 diff 무차이 → **배포 드리프트가 아니라 정본 결함.**
게다가 여유가 헤더 주석보다 좁아졌다: `max_over_time(DCGM_FI_DEV_GPU_TEMP[30d])` → data04 GPU1 **90**, data05 GPU1 77, data03 50. `:17` 주석은 "최대 88 + 여유 4"라 적혀 있으나 현재 여유는 **2°C**.

**XID 실태** `DCGM_FI_DEV_XID_ERRORS` → .105 gpu0/gpu1 = **43**, .103/.104 = 0. `count(changes(…[24h])>0)` → 빈 벡터. latched 게이지라 `changes()` 방식이 상시발화를 막고 있다는 설계 근거는 유효하다.
OpenSearch 원문 4건(2026-06-01, `fleet_node=data05`): `NVRM: Xid (PCI:0000:2b:00): 43, pid=146239, name=VLLM::Worker, channel 0x00000008`.
**pid/name이 붙어 있으므로 앱 레벨 후보** — `alert-rules.yaml:249` 주석이 이 43을 "드라이버 mismatch 사태의 흔적"이라 단정한 것은 원문 근거가 없다.

**드라이버 mismatch는 지금도 라이브다** data05가 `NVRM: API mismatch: the client nvidia-smi … 595.84, but this kernel module has the version 595.71.05`를 **일일 ~31,300건** 생성 중(7d: 07-27 31638 / 07-28 31314 / 07-29 31315 / 07-30 31300 / 07-31 25360 / 08-01 17285). 누적 257,892건(2026-06-01~). data04도 동일 시그니처를 2026-03-04~06-09에 2,038건 남겼다. **이 조건을 읽는 알림은 0건.**

**하드웨어 확증 신호의 비대칭 [실측]** `DCGM_FI_DEV_UNCORRECTABLE_REMAPPED_ROWS`·`ROW_REMAP_FAILURE`는 **data05(A40)에만** 존재(2건). data03/04의 Quadro RTX 6000에는 없다. PCIe replay는 6장 모두 0. `DCGM_FI_DEV_MEMORY_TEMP`는 A40에서 0으로 보고되고 RTX 6000엔 시리즈 자체가 없다 → **온도 런북에서 쓰면 안 된다.**

**게이트 부재** `.github/workflows` 없음. `infra/monitoring/alerts/` 디렉터리도 없음 → **hardware-ops T2-5가 대상으로 삼은 경로가 존재하지 않는다** = 라이브 평면을 영원히 검사하지 못한다. `specs/alerting/spec.md:256`은 "runbook_url 없으면 머지 금지"라는 정책만 있고 강제 수단이 없다.

**콘솔 인덱싱 누락** `docs/runbooks/log-ingestion-stopped.md` 1행이 `# 런북 · …`로 시작 — frontmatter가 없다. `apps/console/src/lib/runbooks.ts:38`이 `fm.id` 없는 파일을 버리므로 **유일하게 올바른 알림 런북이 어시스턴트에 인덱싱되지 않는다.**

### 3.2 설계

#### D3-1. alertname별 판정 (전부 새로 쓰지 않는다)

| alertname | 현 runbook_url | 실측 적합성 | 판정 | 새 runbook_url |
|---|---|---|---|---|
| GpuXidErrorNew | hardware-ops/README | `xid` 0회 | **신규** | `docs/runbooks/gpu-xid.md` |
| GpuTempHigh | hardware-ops/README | 임계 근거만, 조치 없음 | **신규** | `docs/runbooks/gpu-thermal.md` |
| SmartHealthFailed | smartctl-exporter/README | "수집만·알림 미생성" 선언 | **신규** | `docs/runbooks/smart-health-failed.md` |
| OomKillOccurred | node-onboarding | `oom` 0회 | **통합 신규** | `docs/runbooks/memory-pressure.md` |
| MemoryLow | node-onboarding | 동일 조치 경로 | **통합**(위와 1파일) | `docs/runbooks/memory-pressure.md` |
| DiskUsageHigh | logging/README | 정리 절차는 있으나 알림용 아님 | **통합 신규** | `docs/runbooks/disk-pressure.md` |
| DiskFillPredicted | logging/README | 동일 | **통합**(위와 1파일) | `docs/runbooks/disk-pressure.md` |
| NodeDown | node-onboarding | §2.5 검증 절차는 재사용 가치 있음 | **신규(얇게)** + onboarding 링크 | `docs/runbooks/node-down.md` |
| LogIngestStalled | log-ingestion-stopped | **적합** | **재작성 금지**, frontmatter만 | 변경 없음 |

신규 6파일. 두 쌍을 각각 1파일로 묶는 근거: 조치 경로가 같고(누가 먹고 있나 → 소유자 넛지 → 회수), **런북이 많을수록 갱신 안 된 문서가 늘어난다.**

#### D3-2. frontmatter 계약 (두 결함을 한 번에 고친다)

```yaml
---
id: gpu-xid                  # 파일 stem과 일치 — runbooks.ts:38이 요구
kind: alert                  # alert | procedure | incident  (부재 시 alert로 간주)
alerts: [GpuXidErrorNew]     # 신설 필드: 이 런북이 담당하는 alertname
service: dcgm-exporter
category: gpu
severity: critical
signature: "NVRM: Xid"       # 어시스턴트 결정적 매칭 키
affected_nodes: [data03, data04, data05]
last_verified: 2026-08-02
---
```

`loadRunbooks()`는 `id/service/category/signature`만 화이트리스트로 읽으므로(`runbooks.ts:38-46` 확인) `kind`·`alerts`·`severity`·`last_verified` 추가는 **콘솔 코드 변경 없이 하위호환**이다. 동시에 frontmatter가 생기면 `log-ingestion-stopped.md`가 어시스턴트에 인덱싱된다.

##### `kind` 분류가 필요한 이유 — 기존 런북 2건이 계약을 만족할 수 없다 [실측]

| 파일 | 현재 frontmatter | 성격 |
|---|---|---|
| `node-onboarding.md` | `id`·`kind: procedure`·`category`·`status`·`first_seen`·`last_seen` | 절차서. 담당 알림이 없고 `severity`가 무의미 |
| `rsyslog-omfile-flood.md` | `id`·`service`·`category`·`signature`·`affected_nodes`·`status: resolved`·`fix_kind` | **종결된 인시던트 기록**. 역시 알림·심각도가 없다 |
| `log-ingestion-stopped.md` | **없음**(1행이 `# 런북 · …`) | 알림 런북 — T3-4가 채운다 |

`alerts`·`severity`를 전 문서에 강요하면 이 둘은 `alerts: []`·`severity: none` 같은 **거짓 필드**를 달게 된다. 그래서 계약을 두 층으로 나눈다:

| 층 | 요구 | 대상 |
|---|---|---|
| **공통** | `id`(=파일 stem) · `kind` ∈ {alert, procedure, incident} · `category` | `docs/runbooks/*.md` 전부 |
| **알림 런북 추가** | `alerts`(배열) · `severity` | `kind: alert`(부재 시 기본값)만 |

이건 escape hatch가 아니다 — `# runbook-check:ignore` 같은 무력화 주석과 달리 **문서의 종류를 선언**하는 것이고, 잘못 선언하면 R5(alertname 왕복)가 즉시 잡는다. T3-4가 두 기존 문서에 `kind`를 채운다(`rsyslog-omfile-flood.md`는 `kind: incident` 한 줄, `node-onboarding.md`는 이미 `kind: procedure`라 변경 0).

> `alerts:` 선언을 쓰는 이유 — hardware-ops `spec.md:427`의 "alertname kebab = 파일명" 규칙은 `LogIngestStalled` → `log-ingest-stalled.md` vs 실제 `log-ingestion-stopped.md` 반례 때문에 **유일하게 올바른 런북을 FAIL시킨다.** 선언이 정본, kebab은 폴백.

#### D3-3. `docs/runbooks/gpu-xid.md` (이 축의 핵심)

**§1 이 알림이 말하는 것 / 말하지 않는 것** — 발화식은 `changes(DCGM_FI_DEV_XID_ERRORS[30m]) > 0`, 값이 아니라 **변화**다. 이 메트릭은 latched: 마지막 코드만 남고 횟수·시각·프로세스가 없다. [실측] data05 두 장이 2026-06-01부터 43을 유지 중이고 `changes[24h]`=0. **값이 0이 아니라는 이유로 재조사하지 마라.**

**§2 30초 판별 — 코드 읽고 원문과 대조 (여기서 HW/앱이 갈린다)**

```bash
# (a) 코드: 어느 GPU가 무슨 코드인가
curl -sG localhost:9090/api/v1/query --data-urlencode 'query=DCGM_FI_DEV_XID_ERRORS'

# (b) 원문: pid/name은 여기에만 있다 (알림 instance 192.168.1.10N → fleet_node=data0N, docs/inventory.yaml)
NODE=data05
curl -s "localhost:9200/keiwi-logs-*/_search" -H 'Content-Type: application/json' -d "{
  \"size\":20,\"sort\":[{\"@timestamp\":\"desc\"}],
  \"query\":{\"bool\":{\"must\":[
    {\"match_phrase\":{\"message\":\"NVRM: Xid\"}},
    {\"term\":{\"fleet_node\":\"$NODE\"}},
    {\"range\":{\"@timestamp\":{\"gte\":\"now-24h\"}}}]}},
  \"_source\":[\"@timestamp\",\"fleet_node\",\"message\"]}"
```

읽는 법 — PCI 주소=물리 GPU / `pid`,`name`=원인 프로세스 후보 / 코드=분기 키.
**함정 2개**: ① 커널 메시지라 `service`가 `unknown`이다 → 서비스 패싯으로 못 찾고 `message` 구문검색만 유효. ② `node` 라벨은 data03 시리즈에만 있다(`prometheus.yml:98` 주석대로) → data04/05는 instance IP로 매핑.

**§3 코드 분기표**

| Xid | 뜻 | 1차 판정 | 첫 조치 |
|---|---|---|---|
| 13·31·43 | illegal address / GPU stopped processing | **앱 레벨**(사용자 커널 오류)이 일반적 | pid 소유자 확인 → 해당 잡만 재시작. **노드 재부팅 금지** |
| 48 | DBE(double-bit ECC) | 하드웨어 | remapped rows 확인 → 교체 검토 |
| 63·64 | row remap 발생/실패 | 하드웨어 | 정비창 재부팅으로 remap 반영, 실패 시 교체 |
| 74 | NVLink 오류 | 하드웨어/배선 | 물리 점검 |
| 79 | GPU has fallen off the bus | 하드웨어/전원·PCIe | 전원·라이저 점검 |
| 그 외 | — | NVIDIA Xid 표 대조 | 원문에 pid가 있으면 앱 쪽부터 |

> KEIwi가 실제로 본 코드는 **43 하나뿐**이고 원문에 `name=VLLM::Worker`가 붙어 있었다 → 앱 레벨로 판정. `alert-rules.yaml:249` 주석의 단정은 이 축에서 사실로 교정한다.

**§4 하드웨어 확증 — 있는 신호와 없는 신호(실측)** 있다: `UNCORRECTABLE_REMAPPED_ROWS`·`ROW_REMAP_FAILURE`·`PCIE_REPLAY_COUNTER`(현재 전부 0). **한계**: remap 계열은 data05(A40)에만 존재 — data03/04(RTX 6000)는 row remapping이 없어 확증 경로가 없고 원문 로그 + `dmesg` + 재현성이 유일 근거다. ECC SBE/DBE는 현 DCGM csv에 없다(hardware-ops T6-4 예정) — **이 런북은 그 의존 없이 성립한다.** DCGM으로 드라이버 mismatch는 판별 불가 → `nvidia-driver-mismatch.md` 병행 확인.

**§5 누가 쓰고 있나 (파괴적 조치 전 필수)** `gpu_model_info{node="data05"}`의 `user` 라벨이 소유자다(라이브 예: node=data04, user=mhchoi, framework=ollama, pid=391942). **연구 잡을 죽이기 전에 통보한다(§11: 자동 종료 금지).**

**§6 조치 트리(파괴 강도 순)** 앱 판정 → 소유자 통보 → 프로세스만 재시작 / 24h 내 동일 GPU 3회 반복 → 해당 GPU 배제 안내 + 인시던트 기록 / HW 코드 → 잡 대피 → 정비창 재부팅 → 재발 시 교체 요청.

**§7 사후** latched 값은 재부팅 전까지 남는다. 재발화하지 않는 것이 정상. 판정 근거(원문 1줄)를 인시던트에 남겨 다음 사람이 43을 처음부터 다시 조사하지 않게 한다.

#### D3-4. `docs/runbooks/gpu-thermal.md`

- **임계 근거와 현재 여유**: 92°C/10m. 30일 최대 = data04 GPU1 **90°C** → 여유 **2°C**(주석의 "88+4"는 낡음). 재발화가 잦아지면 임계가 아니라 공조/부하를 의심하라.
- **진짜 신호는 "성능이 깎이는가"인데 `CLOCK_THROTTLE_REASONS`가 현 csv에 없다**(T6-4 예정). 대체 판별: `DCGM_FI_DEV_SM_CLOCK` 급락 + `DCGM_FI_DEV_GPU_UTIL` 유지 = 스로틀 의심.
- **쓰지 말 것**: `DCGM_FI_DEV_MEMORY_TEMP`(A40에서 0, RTX 6000엔 시리즈 없음).
- 카드 임계는 `nvidia-smi -q -d TEMPERATURE`로 확인 — **KEIwi에서 미측정**이므로 런북은 명령만 제공하고 숫자를 단정하지 않는다.
- 조치: 소유자 확인 → 부하 조정 협의. **`nvidia-smi -pl`(파워리밋)은 연구 성능에 직접 영향** → 사람 판단·사전 공지, 자동화 금지(§11).

#### D3-5. 드라이버 mismatch — 이 축의 처리

작성은 **hardware-ops T0-3**. 이 축은 세 가지만 한다.
1. `gpu-xid.md` §4에서 교차링크(둘을 혼동해 재부팅하는 오조치 방지).
2. T0-3 산출물에 frontmatter 계약 요구(`id: nvidia-driver-mismatch`, `alerts: []`, `category: gpu`, `severity: critical`) — 알림이 생기기 전이므로 빈 배열이 정상이고 게이트는 이를 **WARN(비치명)**으로 통과시킨다.
3. 오늘 유일하게 작동하는 30초 진단 쿼리를 제공:

```bash
curl -s "localhost:9200/keiwi-logs-*/_count" -H 'Content-Type: application/json' \
 -d '{"query":{"bool":{"must":[{"match_phrase":{"message":"NVRM: API mismatch"}},
     {"range":{"@timestamp":{"gte":"now-1h"}}}]}}}'   # data05 현재 ≈1,300/h — 0이어야 정상
```

> 탐지 알림 신설은 hardware-ops 소관이다. **이 축은 알림을 만들지 않는다.**

#### D3-6. 나머지 4종 골격 (공통 5절)

`① 이 알림이 말하는 것/아닌 것 → ② 30초 판별(복붙 명령) → ③ 원인 분기표 → ④ 조치(파괴 강도 순, 소유자 확인 게이트) → ⑤ 사후·재발방지`

- `node-down.md`: exporter down인지 노드 down인지 먼저 가른다(`up{job="node-exporter"}` vs ping/ssh :764). **data04는 터널 경유라 터널 죽음도 NodeDown으로 보인다** — 이 오판 경로를 명시. 복구는 node-onboarding §2.5 링크.
- `disk-pressure.md`: 두 알림의 의미 차(이미 높다 vs 곧 찬다) → OpenSearch ISM · Prometheus TSDB · 모델 캐시 순 정리.
- `memory-pressure.md`: `node_vmstat_oom_kill` 증가 → journald에서 죽은 프로세스 확인 → `gpu_model_info`/`keiwi_listening_port_info`로 소유자 역추적.
- `smart-health-failed.md`: **한계를 먼저 쓴다** — `smartctl_device`가 노출하는 건 `HPE LOGICAL VOLUME`뿐이고 RAID 뒤 물리 디스크는 0개다. 즉 이 알림은 논리 볼륨 수준에서만 발화한다. 수집 구조 변경은 **축2 소관이므로 링크만** 건다(축2 완료 후 §한계 절을 갱신하는 것은 T2-9의 일).

#### D3-7. `scripts/gates/check-runbooks.sh` 규격

스타일은 `apps/console/scripts/check-no-secrets.sh` 관례(`#!/usr/bin/env bash`, `set -euo pipefail`, 헤더에 목적·실행법, 마지막 `OK:` 한 줄).

**입력(있는 것만 자동 인식)** — `infra/monitoring/grafana/provisioning/alerting/*.yaml`(alertname=`title`) · `infra/monitoring/alerts/*.yml`(alertname=`alert`, hardware-ops T4-2가 만들면 자동 편입).

| ID | 검사 | 결과 |
|---|---|---|
| R1 | 모든 규칙에 `annotations.summary`·`runbook_url` 존재 | FAIL |
| R2 | URL이 `^https://github\.com/mooner92/KEIwi/blob/main/(.+)$` 형식 | FAIL |
| R3 | 캡처 경로가 워킹트리에 실존(`test -f`) | FAIL |
| R4 | 경로가 `docs/runbooks/*.md`여야 함(README·spec 금지) | FAIL — **현재 5건**(DiskUsageHigh·DiskFillPredicted·GpuTempHigh·GpuXidErrorNew·SmartHealthFailed) |
| R5 | 그 런북 frontmatter `alerts:`에 해당 alertname 포함(없으면 kebab 폴백) | FAIL — **현재 9건 전부**(어느 런북도 `alerts:`를 갖고 있지 않다). R4가 못 잡는 `node-onboarding.md` 3건을 여기서 잡는다 |
| R6 | frontmatter 공통 계약: `id`(=파일 stem)·`kind`∈{alert,procedure,incident}·`category` | FAIL |
| R6b | `kind: alert`(부재 시 기본값) 문서에 한해 `alerts`·`severity` 추가 요구 | FAIL |
| R7 | summary 안의 `NN°C`/`NN%` 토큰 ⊆ 그 규칙 evaluator params | FAIL — **현재 GpuTempHigh** |
| R8 | `alerts:`가 비었거나 미존재 alertname을 가리키는 런북 | **WARN**(exit 0) |
| R9 | 모든 `docs/runbooks/*.md`가 `docs/README.md`에서 링크됨 | PASS(현재 3/3 링크됨) |
| R10 | 런북 내 ` ```bash ` 블록이 **블록마다 개별** `bash -n` 통과 | FAIL — **현재 `rsyslog-omfile-flood.md`**(T3-4가 고친다) |
| R11 | `last_verified`가 180일 초과 | WARN |

> **R4가 5건인 이유(6이 아니다)** — 9건 중 `node-onboarding.md`를 가리키는 3건(NodeDown·MemoryLow·OomKillOccurred)은 **경로가 이미 `docs/runbooks/`라 R4를 통과**한다. 이 3건의 결함("`oom`이라는 단어조차 없는 문서")은 경로가 아니라 **담당 선언**의 문제이므로 R5가 잡는다. 경로 규칙 하나로 두 종류의 결함을 잡으려 하면 둘 다 놓친다.

> **R10을 블록 단위로 쪼개는 이유** — 전 블록을 이어붙여 한 번에 `bash -n`하면 앞 블록의 미완결 구문이 뒤 블록 오류로 보고돼 오탐 표면이 커진다. 블록마다 파일을 만들어 검사하고 **실패한 블록의 시작 행 번호를 출력**한다.

R7의 정밀도: **단위(`°C`/`%`)가 붙은 숫자만** 대조하므로 LogIngestStalled의 "정상 ≈17,600건"은 오탐이 되지 않는다. 검증 — GpuTempHigh 85°C ∉ {92} FAIL / DiskUsageHigh 90% ∈ {90} PASS / MemoryLow 5% ∈ {5} PASS.

**옵션** `--check-main`(`git cat-file -e origin/main:<path>`, post-merge 잡 전용) · `--self-test`(fixture로 exit 1 확인) · `--quiet`. **종료코드는 §0.2 규약**을 따른다.
**구현** bash 래퍼 + `python3` 히어독(PyYAML 6.0.1 로컬 확인). 없으면 exit 2 + `pip install pyyaml` 안내.

#### D3-8. 문구 드리프트 교정 (부수 과제)

- `alert-rules.yaml:204` → `'GPU 과열 {{ $labels.instance }} GPU{{ $labels.gpu }} — 92°C 초과 10분'` (R7이 재발을 막는다)
- `:17`·`:173` 주석의 "최대 88 / 여유 4" → 실측 **90 / 여유 2**로 갱신
- `:249` XID 43 원인 단정 → 원문 근거(`pid`/`name=VLLM::Worker`)에 맞춰 교정
- 9건 runbook_url을 D3-1 표대로 재배선

#### D3-9. 기존 런북 3종 정비 (게이트 day-1 red 제거)

게이트를 켜기 전에 **현재 red인 3건을 먼저 초록으로** 만든다 — 이것이 §7.2가 "도입 시점에 red를 만드는 항목을 미리 제거했다"고 말한 목록에 빠져 있던 부분이다.

| 파일 | 결함 | 조치 |
|---|---|---|
| `log-ingestion-stopped.md` | ① frontmatter 없음 → 콘솔 미인덱싱 + R6 FAIL ② R10은 **초록이지만** 66행이 rsyslog와 같은 무따옴표 자리표시자다 | ① frontmatter 추가(`kind: alert`, `alerts: [LogIngestStalled]`, `category`, `severity`, `signature`, `last_verified`) ② **본문은 66행 1줄만** — 아래 표기 규약대로 따옴표를 씌운다(예방) |
| `rsyslog-omfile-flood.md` | ① `kind` 없음 → R6 FAIL ② **`bash -n` 실패** → R10 FAIL | ① `kind: incident` 한 줄 ② **41행** `ssh -p 764 <user>@<node-ip>`의 자리표시자를 **따옴표로 감싼다**(게이트가 찍는 `:40`은 ` ```bash ` **블록 시작 행**이고 문제의 명령은 그 다음 줄이다) |
| `node-onboarding.md` | 없음(이미 `id`·`kind: procedure`·`category` 보유) | **변경 0** — `kind` 분류 덕분이고, `<…>` 자리표시자 4곳은 전부 **주석 안 또는 작은따옴표 안**이라 R10에 걸리지 않는다(실측) |

`bash -n` 실패의 정확한 원인 [실측]: bash가 `<user>`의 `<`를 **입력 리다이렉션**으로 파싱한다. 최소 수정:

```diff
-ssh -p 764 <user>@<node-ip>          # 예: ssh -p 764 mhchoi@192.168.1.104
+ssh -p 764 "<user>@<node-ip>"        # 예: ssh -p 764 mhchoi@192.168.1.104
```

따옴표 안에서는 리다이렉션으로 해석되지 않고(검증: `bash -n` 통과) 사람이 읽는 의미도 그대로다.

**전수 검사 결과 [실측 2026-08-02 — 런북 3파일 · ` ```bash ` 블록 11개 전량]**

| 위치 | 형태 | R10 | 처리 |
|---|---|---|---|
| `rsyslog-omfile-flood.md:41` | `ssh -p 764 <user>@<node-ip>   # 주석` | **FAIL** | T3-4가 고친다. 끝의 `>` 뒤에 리다이렉션 대상이 없어 `unexpected token 'newline'` |
| `log-ingestion-stopped.md:66` | `ssh -p 764 <user>@<ip> '…'` | PASS | 뒤따르는 인용문이 우연히 `>`의 대상이 되어 **문법만** 통과한다. 복붙하면 `user: No such file or directory`로 즉시 죽는다(실측). 같은 표기이므로 T3-4가 함께 통일 |
| `node-onboarding.md:147·148` | `# <user>…` / `echo '<user> …'` | PASS | 주석·작은따옴표 안이라 구조적으로 안전. **변경 없음** |

> **표기 규약 — `<…>` 자리표시자는 따옴표 안에 둔다.** 축3이 새로 쓰는 런북 6종과 최소 골격 템플릿(T3-3)에 이 규약을 넣는다. R10이 잡는 것은 *문법 오류*뿐이라 무따옴표 표기는 **우연히 통과할 수 있고**(위 표 2행), 그 상태로 남으면 다음 편집에서 다시 red가 된다. 규약을 문서 쪽에 두는 이유는 게이트를 하나 더 늘리지 않기 위해서다 — 같은 결함을 두 번 잡는 규칙은 유지비만 늘린다.

### 3.3 주요 판단

| 결정 | 근거 | 기각한 대안 |
|---|---|---|
| kebab 규칙 대신 **frontmatter `alerts:` 선언** | `log-ingestion-stopped.md`라는 반례가 이미 존재한다. 기계적 kebab 게이트는 유일하게 올바른 런북을 FAIL시킨다 | hardware-ops AC-2-6의 kebab 강제 유지 — 올바른 파일을 개명하게 만들거나 예외를 하드코딩하게 된다 |
| 4개 알림을 **2개 런북으로 통합** | 조치 경로가 같다. 런북 수가 곧 유지보수 부채이고, 갱신 안 된 문서는 없느니만 못하다 | alertname 1:1 파일 — 8개 파일 중 절반이 서로 복붙이 된다 |
| `nvidia-driver-mismatch.md`를 **쓰지 않는다** | hardware-ops T0-3 소관. 여기서 쓰면 같은 내용 2벌 | 이 축에서 작성 — T0-3이 죽은 태스크로 남는다 |
| Xid 43을 **"1차 판정 앱 레벨"**로 쓰되 단정하지 않는다 | 근거가 원문 4건뿐이다. 24h 내 동일 GPU 3회 반복이면 HW 의심으로 승격하는 조건을 명시하고, RTX 6000엔 remap 확증 경로가 없다는 한계도 적는다 | "43 = 앱 레벨"로 단정 — 하드웨어 열화 초기 증상을 놓친다 |
| R3(워킹트리 존재)는 **FAIL**, main 존재는 `--check-main`으로 분리 | runbook_url이 `blob/main` 고정이라 런북을 추가하는 그 PR에서는 main에 파일이 없어 404다(닭-달걀) | 항상 main 검사 — 첫 PR부터 영구 red |
| 알림 없는 런북(`alerts: []`)은 **WARN** | 게이트가 hardware-ops T0-3 진행을 막으면 안 된다. "런북 먼저·알림 나중"도 허용해야 한다 | FAIL — 축 간 데드락 |
| escape hatch(주석으로 게이트 무력화)를 **만들지 않는다** | 예외가 자라면 게이트가 장식이 된다. 대신 최소 골격 템플릿을 제공해 30초에 만들 수 있게 한다 | `# runbook-check:ignore` |

### 3.4 수용 기준

| ID | 수용기준 | 검증 |
|---|---|---|
| **AC-3-1** | 게이트가 존재·실행 가능하고 교정 완료 상태에서 통과 | `bash scripts/gates/check-runbooks.sh; echo exit=$?` → 마지막 줄 `OK: runbooks check passed`, `exit=0` |
| **AC-3-2** | **게이트가 실제로 실패할 수 있다**(항상 통과하는 가짜 게이트 방지) | `bash scripts/gates/check-runbooks.sh --self-test; echo exit=$?` → R1~R7 각 위반이 1건씩 보고, `exit=1` |
| **AC-3-3** | 레포의 모든 알림이 `docs/runbooks/` 전용 런북을 가리킨다(게이트와 독립 검증) | 아래 스니펫 → `bad=[]`, exit 0. **개수를 하드코딩하지 않는다** — 축1 T1-6이 2건, 축2 T2-8이 3건을 같은 파일에 추가하므로 파동에 따라 9→11→14가 된다 |
| **AC-3-4** | 런북이 실존하고 해당 alertname을 frontmatter로 선언(왕복 매핑) | 아래 스니펫 → `[]`, exit 0 |
| **AC-3-5** | GpuTempHigh **발화 문구**의 드리프트 제거 | `test "$(grep -c 'summary:.*85°C' …/alert-rules.yaml)" = 0 && test "$(grep -c '92°C 초과 10분' …/alert-rules.yaml)" = 1 && echo PASS` → `PASS` (현재 각각 **1**·**0**). ⚠️ **스코프는 `summary:` 행이다.** 파일 전체로 `85°C`를 세면 **원리적으로 0이 될 수 없다** — 실측 전체 3건 중 2건(`:21`「85°C 결함의 교훈」·`:171`「85°C였다가 92°C로 상향(2026-07-30)」)이 **상향 근거를 남긴 이력 주석**이고 T3-6은 이를 지우지 않는다(지우면 92의 근거가 사라진다). 지워야 할 것은 사람에게 발신되는 문구뿐이다 |
| **AC-3-6** | 모든 런북이 frontmatter **공통 계약**(`id`=stem·`kind`·`category`)을 만족하고, `kind: alert` 문서는 `alerts`·`severity`도 갖는다 | 아래 스니펫 → `[]`, exit 0. **도입 전 실행 결과(실측)**: `[('docs/runbooks/log-ingestion-stopped.md','no-frontmatter'), ('docs/runbooks/rsyslog-omfile-flood.md',"alert-missing:['alerts','severity']")]`, exit 1 — 후자는 `kind`가 없어 기본값 `alert`로 간주된 결과이고 `kind: incident` 한 줄로 해소된다 |
| **AC-3-7** | 콘솔 어시스턴트가 모든 런북을 인덱싱(frontmatter 누락 회귀 차단) | `cd apps/console && npx vitest run src/lib/runbooks.test.ts` → `loadRunbooks().length == docs/runbooks/*.md 개수`, 통과 |
| **AC-3-8** | 런북의 진단 명령이 복붙 가능한 문법 (**블록 단위 판정**) | 아래 스니펫 → 출력 없음, exit 0. **도입 전 실행 결과(실측 2026-08-02)**: `SYNTAX FAIL: docs/runbooks/rsyslog-omfile-flood.md:40` **1건뿐**, exit 1 — bash가 `<user>`의 `<`를 입력 리다이렉션으로 파싱한다. ⚠️ 출력의 `:40`은 ` ```bash ` **블록 시작 행**이고 문제의 명령은 **41행**이다(스니펫이 `start`를 찍는다). **T5-6로 `verify-all.sh`를 켜기 전에 T3-4가 이 1건을 제거해야 CI 첫날 red가 아니다** — 전수 검사·나머지 2건의 판정은 §3.2 D3-9 표 |
| **AC-3-9** | XID 런북의 원문 대조 쿼리가 실제로 증거를 반환(설계가 라이브에서 성립) | `curl -s 'localhost:9200/keiwi-logs-*/_count' -H 'Content-Type: application/json' -d '{"query":{"bool":{"must":[{"match_phrase":{"message":"NVRM: Xid"}},{"term":{"fleet_node":"data05"}}]}}}'` → `count ≥ 4` |
| **AC-3-10** | 알림 없는 런북은 WARN이지 FAIL이 아니다 — 게이트가 T0-3 진행을 막지 않는다 | 임시 `docs/runbooks/zz-orphan.md`(`alerts: []`) + `docs/README.md` 링크 추가 후 게이트 실행 → `WARN: zz-orphan` 출력 + `exit=0`. 확인 후 원복 |
| **AC-3-11** | 게이트가 실행 체인에 배선돼 사람이 잊어도 돈다 | `bash scripts/verify-all.sh --dry-run \| grep -c 'check-runbooks'` → `1` |
| **AC-3-12** | `[server]` 라이브 반영 후 Grafana가 **모든** 규칙에 대해 새 URL을 서빙 | `curl -s localhost:3000/api/v1/provisioning/alert-rules \| python3 -c "import sys,json;r=json.load(sys.stdin);bad=[x['title'] for x in r if '/docs/runbooks/' not in x['annotations'].get('runbook_url','')];print('rules',len(r),'bad',bad);raise SystemExit(1 if bad else 0)"` → `bad []`, exit 0 (개수는 참고 출력 — 파동에 따라 늘어난다) |
| **AC-3-13** | `[server]` 배포된 summary에 낡은 임계가 없다 | `curl -s localhost:3000/api/v1/provisioning/alert-rules \| python3 -c "import sys,json;print([x['annotations']['summary'] for x in json.load(sys.stdin) if x['title']=='GpuTempHigh'])"` → `['… 92°C 초과 10분']` |
| **AC-3-14** | 머지 후 Slack에 실리는 URL이 실제로 열린다(public 레포, main 기준) | `bash scripts/gates/check-runbooks.sh --check-main` exit 0 + **모든 규칙의** `runbook_url`에 `curl -o /dev/null -w '%{http_code}'` → 전부 `200` (개수 하드코딩 금지) |

```bash
# AC-3-3 — 개수는 참고 출력이고 판정은 bad==[] 하나뿐이다(파동마다 규칙 수가 늘어난다).
python3 -c "import yaml,sys;d=yaml.safe_load(open('infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml'));\
r=[x for g in d['groups'] for x in g['rules']];\
bad=[x['title'] for x in r if 'blob/main/docs/runbooks/' not in x['annotations'].get('runbook_url','')];\
print('rules',len(r),'bad',bad);sys.exit(1 if bad else 0)"

# AC-3-4
python3 - <<'PY'
import yaml,re,sys
d=yaml.safe_load(open('infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml'))
bad=[]
for g in d['groups']:
    for x in g['rules']:
        p=x['annotations']['runbook_url'].split('blob/main/')[-1]
        try: fm=yaml.safe_load(re.match(r'^---\n(.*?)\n---',open(p).read(),re.S).group(1))
        except Exception: bad.append((x['title'],'no-frontmatter')); continue
        if x['title'] not in (fm.get('alerts') or []): bad.append((x['title'],p))
print(bad); sys.exit(1 if bad else 0)
PY

# AC-3-6 — 공통 계약 + kind:alert 추가 계약(D3-2)
python3 - <<'PY'
import glob,re,yaml,os,sys
KINDS={'alert','procedure','incident'}
bad=[]
for f in sorted(glob.glob('docs/runbooks/*.md')):
    m=re.match(r'^---\n(.*?)\n---',open(f).read(),re.S)
    fm=yaml.safe_load(m.group(1)) if m else None
    if not fm: bad.append((f,'no-frontmatter')); continue
    stem=os.path.basename(f)[:-3]
    if fm.get('id')!=stem: bad.append((f,'id!=stem')); continue
    kind=fm.get('kind','alert')
    if kind not in KINDS: bad.append((f,f'kind={kind!r}')); continue
    if 'category' not in fm: bad.append((f,'no-category')); continue
    if kind=='alert':
        miss=[k for k in ('alerts','severity') if k not in fm]
        if miss: bad.append((f,f'alert-missing:{miss}'))
print(bad); sys.exit(1 if bad else 0)
PY

# AC-3-8 — 블록마다 개별 bash -n. 실패 시 블록 시작 행을 함께 출력한다.
python3 - <<'PY' 
import glob,re,subprocess,sys,tempfile,os
fail=0
for f in sorted(glob.glob('docs/runbooks/*.md')):
    lines=open(f).read().split('\n'); buf=None; start=0
    for i,l in enumerate(lines,1):
        if buf is None and re.match(r'^```bash\s*$',l): buf=[]; start=i; continue
        if buf is not None and l.startswith('```'):
            with tempfile.NamedTemporaryFile('w',suffix='.sh',delete=False) as t:
                t.write('\n'.join(buf)); p=t.name
            r=subprocess.run(['bash','-n',p],capture_output=True,text=True); os.unlink(p)
            if r.returncode: print(f'SYNTAX FAIL: {f}:{start}'); print(r.stderr.strip()); fail=1
            buf=None; continue
        if buf is not None: buf.append(l)
sys.exit(fail)
PY
```

---

## 4. 축 4 — 섀시 전력 배선 + 드리프트 recording rule 검증 게이트

### 4.1 문제 (실측)

**메트릭명은 단수 `_watt`가 맞다.** `q 'node_hwmon_power_average_watt'` → 4시리즈(.105=394W · .104=211W · .103=211W · .101=0W, 라벨 `chip="lnxsybus:00_acpi000d:00" sensor="power1"`). `q 'node_hwmon_power_average_watts'` → **(empty)**. **오타 시 조용한 no-data 확정.**

**소비처 0건** `grep -rn 'hwmon_power' infra/` → 0. `DCGM_FI_DEV_POWER_USAGE`는 `gpu.json:207,281`·`gpu-v3.json:240,410`·`model-workload*.json`에서 쓰이지만 **섀시 전력과 대조하는 패널은 없다.**

> **순시 전력은 부하에 따라 변동한다.** 2026-08-02 두 시점 실측이 816W / 820W / 812W였다. 본문에 고정값을 박지 않고 **약 810~820W(변동)**로 쓰고, AC는 범위(700~1200W)로 판정한다.

| 측정 | 값 |
|---|---|
| `sum(node_hwmon_power_average_watt{sensor="power1"} > 0)` | **약 810~820**(변동) |
| `count(… > 0)` / `count(…)` | **3 / 4** (data01 Gen9만 0W 미보고) |
| `sum(DCGM_FI_DEV_POWER_USAGE) / sum(섀시 > 0)` | **0.266** |
| 노드별 GPU 점유율 | .105 **0.388** · .104 **0.159** · .103 **0.130** |
| 1일 에너지 교차검증 (data05) | GPU 3.716 kWh ÷ 섀시 9.431 kWh = **0.394** ≈ 순시 0.388 → DCGM 에너지 카운터 신뢰 가능 |
| 비-GPU 전력(섀시−GPU) | .105 244W · .104 174W · .103 183W — GPU를 빼도 노드당 180~240W 상시 |

**hardware-ops의 recording rule 2건이 거짓이다 [실측]**

| 규칙 | 라이브 결과 | 원인 |
|---|---|---|
| `product:node_bios_versions:count` | Gen10 Plus=1, Gen10=1, Gen9=1, `max(...)` = **1** | `/sys/class/dmi/id/bios_version` = `U46`(HPE ROM 패밀리 코드), 실제 리비전은 `bios_release` = `1.58`. data03·data04는 둘 다 `U30 / 2.2 / 03-19-2019` — 한쪽만 U30 v2.4로 올라가도 값이 1 그대로다 → **구조적 미탐** |
| `fleet:gpu_driver_versions:count` = 2 | `count by (DCGM_FI_DRIVER_VERSION)(DCGM_FI_DEV_GPU_UTIL)` → `{…="595.71.05"}=2`, `{}=`**4** | 2는 "버전 2종"이 아니라 "라벨 있는 버킷 1 + **라벨 없는 버킷 1**". `label/DCGM_FI_DRIVER_VERSION/values` → `["595.71.05"]` **1개뿐**. 스펙이 적은 `535.309.01`은 Prometheus에 **존재하지 않는 값**이다 |

교정식 실측 검증: `count(count by (DCGM_FI_DRIVER_VERSION)(DCGM_FI_DEV_GPU_UTIL{DCGM_FI_DRIVER_VERSION!=""})) or vector(0)` → **1** / `count(DCGM_FI_DEV_GPU_UTIL{DCGM_FI_DRIVER_VERSION=""}) or vector(0)` → **4**(사각지대 크기) / `count by (product_name)(count by (product_name,bios_version,bios_release)(node_dmi_info))` → 전부 1, `count(… > 1) or vector(0)` → **0**.

**`fleet:kernel_releases:count`는 맞다** — `count(count by (release)(node_uname_info))` = **4**(.104=6.8.0-101 / .103=6.8.0-134 / .105=6.8.0-117 / .101=4.4.0-179). 교정 불필요.

**드리프트를 볼 수 있는 모델 그룹은 하나뿐** `count by (product_name)(node_dmi_info)` → DL380 Gen10=**2**, Gen10 Plus=1, Gen9=1. **1대뿐인 모델에서는 드리프트가 정의되지 않으므로 분모를 함께 노출해야 한다.**

**적용 경로 [실측]** 라이브 `rule_files: [/etc/prometheus/rules/*.yml]`, compose가 `/data/monitoring/rules:/etc/prometheus/rules:ro` 바인드(`docker-compose.yml:20`). **`--web.enable-lifecycle=false`** → `POST /-/reload`는 **405**. 재적용은 `docker kill -s HUP prometheus`이며 성공 판정은 `prometheus_config_last_reload_successful`(현재 1).

**비용** kWh 쿼리 실측 지연 0.022s / 0.019s. 기존 rule group 최대 평가시간 `prometheus_rule_group_last_duration_seconds` = **0.0092s**.

### 4.2 설계

> **이 축은 hardware-ops T1-1~T1-5를 대체하지 않고 그 파일들의 정확한 내용을 공급한다.** 파일을 분기하면 두 정본이 생기고, 사람이 어느 쪽을 복사할지 판단해야 하는 순간 §12 사고가 난다.

#### D4-1. `rules/keiwi-hardware.yml` (hardware-ops T1-1의 정본)

```yaml
groups:
  - name: keiwi_power
    interval: 60s
    rules:
      # 노드별 섀시 전력(W). 라벨 정리(chip/sensor/job 제거) → instance는 <ip>:9100 형태.
      - record: instance:node_chassis_power:watts
        expr: sum by (instance) (node_hwmon_power_average_watt{sensor="power1"})

      # ── 정직성 분모. 이게 없으면 노드가 빠질 때 합계 감소가 "절전"으로 보인다. 현재 3.
      - record: fleet:node_chassis_power:reporting_count
        expr: count(instance:node_chassis_power:watts > 0) or vector(0)

      - record: fleet:node_chassis_power:watts_sum
        expr: sum(instance:node_chassis_power:watts > 0) or vector(0)

      # GPU 전력 — instance를 node-exporter 형태(:9100)로 정규화해 조인 키를 통일.
      - record: instance:gpu_power:watts
        expr: |
          sum by (instance) (
            label_replace(DCGM_FI_DEV_POWER_USAGE, "instance", "$1:9100", "instance", "(.*):9400")
          )
      - record: fleet:gpu_power:watts_sum
        expr: sum(instance:gpu_power:watts) or vector(0)
      - record: fleet:gpu_power_share:ratio
        expr: fleet:gpu_power:watts_sum / fleet:node_chassis_power:watts_sum

      # 노드별 GPU 점유율 — hardware-ops에 없던 것. .105=0.388 .104=0.159 .103=0.130.
      # "같은 섀시인데 왜 하나는 39%고 하나는 13%인가"가 증설·재배치 판단의 입력이다.
      - record: instance:gpu_power_share:ratio
        expr: instance:gpu_power:watts / on(instance) (instance:node_chassis_power:watts > 0)

      # 비-GPU 전력(냉각·CPU·디스크 몫). .105=244W .104=174W .103=183W.
      - record: instance:node_nongpu_power:watts
        expr: (instance:node_chassis_power:watts > 0) - on(instance) instance:gpu_power:watts

      # ── 일일 전력량. ⚠️ 원 메트릭 기반이어야 한다. 레코딩 시리즈([1d])를 참조하면
      #    적용 후 24h 동안 과소값이 나오고 Prometheus 재시작 공백에도 취약하다.
      #    ⚠️ `> 0` 필터 필수 — 없으면 data01이 0 kWh 시리즈를 내고 패널이
      #       "data01은 전력을 안 쓴다"로 읽힌다(watts_sum에는 붙여놓고 여기만 빠뜨렸던 실패모드).
      #       필터를 결과에 거는 이유: 원 시계열에 `> 0`을 걸고 subquery로 평균내면
      #       "간헐적 0"인 노드에서 낮은 샘플이 빠져 에너지가 과대집계된다. 결과 필터는
      #       "항상 0인 노드"만 떨어뜨린다. 실측 두 식 모두 .103=5.09 .104=6.28 .105=9.43, .101 제외.
      - record: instance:node_chassis_energy:kwh1d
        expr: sum by (instance) (avg_over_time(node_hwmon_power_average_watt{sensor="power1"}[1d])) * 24 / 1000 > 0

      # GPU 일일 전력량. DCGM 누적 에너지는 mJ → ÷3.6e9.
      - record: instance:gpu_energy:kwh1d
        expr: |
          sum by (instance) (
            label_replace(increase(DCGM_FI_DEV_TOTAL_ENERGY_CONSUMPTION[1d]),
                          "instance", "$1:9100", "instance", "(.*):9400")
          ) / 3.6e9

  - name: keiwi_firmware_drift
    interval: 5m
    rules:
      # ⚠️ 교정: bios_version(HPE ROM 패밀리 U30/U46/P89)만으로는 동일 모델 내 리비전
      #    차이를 못 본다 — 실측 bios_version=U46, bios_release=1.58.
      - record: product:node_bios_revisions:count
        expr: count by (product_name) (count by (product_name, bios_version, bios_release) (node_dmi_info))

      # 분모 — 1대뿐인 모델에서는 드리프트가 정의되지 않는다. Gen10=2, Gen10Plus=1, Gen9=1.
      - record: product:node_count:count
        expr: count by (product_name) (node_dmi_info)

      - record: fleet:node_bios_drift:count
        expr: count(product:node_bios_revisions:count > 1) or vector(0)
```

**삭제**: `product:node_bios_versions:count`(항상 1 — 구조적 미탐) · `instance:node_bios_age:days`(hardware-ops §1.8 삭제 후보 → **B10 결론 = 삭제**).

#### D4-2. `rules/keiwi-standards.yml` (hardware-ops T1-2의 정본)

```yaml
groups:
  - name: keiwi_standards
    interval: 5m
    rules:
      # ⚠️ 교정: 원식이 반환하는 2는 "버전 2종"이 아니라 "라벨 있는 버킷 1 + 라벨 없는 버킷 1"이다.
      #    → 라벨 있는 것만 세고, 사각지대 크기를 별도 시리즈로 반드시 함께 노출한다.
      - record: fleet:gpu_driver_versions:count
        expr: count(count by (DCGM_FI_DRIVER_VERSION) (DCGM_FI_DEV_GPU_UTIL{DCGM_FI_DRIVER_VERSION!=""})) or vector(0)

      # 이 지표가 못 보는 GPU 수. 현재 4(data03 x2 + data04 x2). 0이 되어야 위 값이 플릿 전체를 뜻한다.
      - record: fleet:gpu_driver_unlabeled:count
        expr: count(DCGM_FI_DEV_GPU_UTIL{DCGM_FI_DRIVER_VERSION=""}) or vector(0)

      - record: fleet:kernel_releases:count
        expr: count(count by (release) (node_uname_info)) or vector(0)

      # ── 축1 T1-4(node-hygiene NVIDIA 블록) 배포 후 자동으로 살아난다.
      #    시리즈가 없으면 결과 비어 무해. or vector(0) 금지 — 0을 "드리프트 없음"으로 오독하게 된다.
      - record: fleet:gpu_driver_versions:count_hygiene
        expr: count(count by (version) (node_nvidia_kernel_module_version))
```

> **드라이버 드리프트의 정본은 DCGM 라벨이 아니라 node-hygiene textfile이다.** DCGM 라벨은 data01(DCGM 불가)을 아예 못 보고 유저스페이스 불일치도 못 본다. 축1 T1-4가 배포되면 `count_hygiene`가 플릿 전체(data01 포함)를 덮고, `fleet:gpu_driver_versions:count`는 **DCGM 부분집합 지표로 강등**된다(T4-11).

**`or vector(0)` 사용 원칙(설계 규약)**: 0이 **모호하지 않은 값일 때만** 붙인다. 드리프트 카운트(0=드리프트 없음)에는 붙이고, "관측된 버전 수"류(0=데이터 없음과 구분 불가)에는 붙이지 않는다.
**모든 `fleet:` 집계는 커버리지 동반 시리즈를 함께 낸다**(`reporting_count` · `unlabeled:count` · `product:node_count:count`).

#### D4-3. `rules/tests/` — promtool 단위 테스트 (핵심 산출물)

거짓 규칙이 다시 들어오지 못하게 하는 **회귀 테스트**다. 라이브 접근 없이 CI에서 돈다. **구 규칙에서 반드시 red가 되는 케이스를 넣는다** — 즉 이 테스트가 있었다면 두 거짓 규칙은 머지되지 않았다.

`tests/keiwi-hardware.test.yml` 핵심 케이스:

```yaml
rule_files: ["../keiwi-hardware.yml"]
evaluation_interval: 1m
tests:
  # (A) BIOS 미탐 회귀 — 같은 U30인데 리비전만 다름. 구 규칙은 1(미탐), 신 규칙은 2.
  - interval: 1m
    input_series:
      - series: 'node_dmi_info{instance="192.168.1.103:9100",product_name="ProLiant DL380 Gen10",bios_version="U30",bios_release="2.2"}'
        values: '1x10'
      - series: 'node_dmi_info{instance="192.168.1.104:9100",product_name="ProLiant DL380 Gen10",bios_version="U30",bios_release="2.4"}'
        values: '1x10'
    promql_expr_test:
      - expr: product:node_bios_revisions:count
        eval_time: 10m
        exp_samples: [{labels: 'product:node_bios_revisions:count{product_name="ProLiant DL380 Gen10"}', value: 2}]
      - expr: fleet:node_bios_drift:count
        eval_time: 10m
        exp_samples: [{labels: '{}', value: 1}]

  # (B) 0W 노드 제외 + 정직성 분모 → watts_sum=816, reporting_count=3
  # (C) :9400 → :9100 정규화 조인 성립 → instance:gpu_power_share:ratio{instance="192.168.1.105:9100"}=0.5
```

`tests/keiwi-standards.test.yml` 핵심 케이스: 라벨 있는 GPU 2장 + 라벨 없는 GPU 2장 입력 → `fleet:gpu_driver_versions:count`=**1**(구 규칙이면 2), `fleet:gpu_driver_unlabeled:count`=**2**.

#### D4-4. 게이트 2종 (`scripts/gates/`)

라이브에 promtool 바이너리가 없고 docker 소켓은 권한 거부이므로 **§0.2.1의 `promtool.sh` 해석기를 경유**하고, 해석기가 `none`을 반환하면 **§0.2.2의 폴백 엔진으로 내려간다.** 이미지는 라이브 실측 버전 **`prom/prometheus:v3.11.3`**에 핀한다(파서 차이로 CI와 라이브 판정이 갈리는 것 방지).

`scripts/gates/check-rules.sh` — 서브명령 3개를 갖는다. **엔진 선택은 게이트가 하고 호출자는 신경 쓰지 않는다:**

| 호출 | promtool 있을 때 | promtool 없을 때 | rc |
|---|---|---|---|
| `check-rules.sh --check [파일…]` | `promtool.sh check rules` (인자 없으면 `infra/monitoring/rules/*.yml` 전체) + **`rules/`에 `alert:` 키 혼입 금지** | `tools/promtool_fallback.py check-rules` + 같은 `alert:` 금지 검사 | `0`/`1` — **절대 `2`가 아니다** |
| `check-rules.sh --test [파일…]` | `promtool.sh test rules` (인자 없으면 `infra/monitoring/rules/tests/*.test.yml` 전체) | **폴백 없음** → `SKIP(env: promtool)` | `0`/`1` / 엔진 없으면 `2` |
| `check-rules.sh --test --schema-only` | (엔진 무관) `.test.yml`의 스키마만 검사 — `rule_files` 존재·경로 실재 · `tests[]`가 리스트 · 각 케이스에 `input_series`와 `promql_expr_test` · `exp_samples`의 `labels`/`value` 존재 | 좌동 | `0`/`1` |
| 인자 없음 | `--check` + `--test` | `--check` + `--test --schema-only`(자동 강등, `NOTE:` 출력) | 위 조합 |

**출력 규약**: 첫 줄에 `RULES_OK engine=promtool|structural` 또는 `RULES_FAIL …`을 찍는다. 엔진을 감추면 축소 강도로 돈 것을 아무도 모른다(§0.2.2).

축5의 `check-prometheus.sh`(라이브 동형 `check config`)와 역할이 겹치지 않는다.

`scripts/gates/check-promql-metrics.sh` — **`_watt` → `_watts` 오타를 빌드 실패로 바꾸는 가드.** `rules/*.yml` + `dashboards/*.json`의 expr에서 메트릭 식별자를 뽑아 §0.3의 두 스냅샷 파일 합집합 + 자체 record 이름과 대조한다. 스냅샷에 없는 이름 = 조용한 no-data 후보 → exit 1. 구현은 `tools/promql_metric_guard.py`.

**실제 코퍼스 실행 결과 [실측 2026-08-02 — 프로토타입 스모크가 아니라 대시보드 10개 전수]**

| 결과 | 건수 | 내용 |
|---|---|---|
| 진짜 미존재 메트릭 | **3** | `syshealth.json` 패널 6·7·8의 `smartctl_device_percentage_used`·`smartctl_device_attribute`·`smartctl_device_available_spare` — §0.3이 지목한 그것 |
| **토크나이저 오탐** | **2** | `Reallocated_Sector_Ct`(라벨 **값**)·`apt_upgrades_pending`(`node_apt_upgrades_pending`의 부분 토큰) |

오탐 2건은 설계 요구사항으로 승격한다 — **파서는 (a) 문자열 리터럴 안(라벨 매처의 값), (b) 라벨 매처의 키를 모두 제외해야 한다.** 단순 `\b[a-zA-Z_:][a-zA-Z0-9_:]*\b` 정규식으로는 부족하고, `promtool`이 없어도 도는 최소 PromQL 토크나이저(따옴표·중괄호 상태기계)가 필요하다. 이 두 케이스를 `--self-test` 픽스처로 못 박는다. **이 토크나이저는 §0.2.2 폴백 엔진의 괄호·따옴표 균형 검사와 같은 모듈을 쓴다**(`tools/promtool_fallback.py`가 노출) — 두 벌을 만들면 한쪽만 고쳐져 갈라진다.
오타 탐지 자체는 스냅샷 대조로 성립함을 확인했다(`node_hwmon_power_average_watt` ∈ 918 / `_watts` ∉ 918 / 자체 record `fleet:…` OK).

#### D4-5. `dashboards/syshealth.json` — row 2개 추가

기존 마지막 패널이 y=32에서 끝난다. **새 대시보드를 만들지 않는다(§I-2).** `${datasource}` + `$instance`(= `label_values(node_uname_info, instance)` → `<ip>:9100` 형식이라 전력 패널과 그대로 맞는다) 관용구를 따른다. uid `keiwi-syshealth` 불변, 기존 패널 id 1~11·100/200/300 불변, 신규 row id는 400/500대.

**Row 「전력」**(id 400, y=32)

| 패널 | 타입 | expr | 표시 |
|---|---|---|---|
| 플릿 섀시 전력 | stat | A `fleet:node_chassis_power:watts_sum` / B `fleet:node_chassis_power:reporting_count` | W. **B를 보조 텍스트로 함께 표시** — "3/4 노드 보고(data01 미보고)". 값 감소가 절전인지 노드 이탈인지 한 화면에서 갈린다 |
| GPU 전력 점유율(플릿) | gauge | `fleet:gpu_power_share:ratio` | percentunit 0~1 (현재 0.266) |
| 노드별 전력 추세 | timeseries | `instance:node_chassis_power:watts{instance=~"$instance"}` | W, 24h |
| 노드별 GPU 점유율 | bargauge | `instance:gpu_power_share:ratio{instance=~"$instance"}` | .105 0.39 / .104 0.16 / .103 0.13 |
| 전력 구성(GPU vs 비-GPU) | timeseries(stacked) | `instance:gpu_power:watts` + `instance:node_nongpu_power:watts` | W |
| 일일 전력량 | bar | `instance:node_chassis_energy:kwh1d` + `instance:gpu_energy:kwh1d` | kWh |

**Row 「표준 드리프트」**(id 500)

| 패널 | 타입 | expr | 표시 |
|---|---|---|---|
| BIOS 드리프트 모델 수 | stat | `fleet:node_bios_drift:count` | 0=정상, threshold 1→orange, `noValue: "0"` |
| BIOS 리비전 인벤토리 | table | `node_dmi_info` → `instance·product_name·bios_version·bios_release·bios_date` | 비교 가능한 모델이 DL380 Gen10 2대뿐임이 표에서 드러난다 |
| GPU 드라이버 버전 수(관측) | stat | `fleet:gpu_driver_versions:count` | 1=통일 |
| **드라이버 미관측 GPU** | stat | `fleet:gpu_driver_unlabeled:count` | **현재 4.** threshold 1→orange. description에 *"이 지표가 못 보는 GPU 수"* 명기 |
| 커널 릴리스 수 | stat | `fleet:kernel_releases:count` | 현재 4 |
| **재부팅 부채 ≥14일 노드** | stat | `count(instance:node_reboot_debt:min14d == 1) or vector(0)` | **현재 2**(실측, T1-4 후 3). threshold 1→orange, `noValue: "0"`. **T1-14 승격 임계와 같은 식**이라 이 값이 0이 되는 순간이 승격 가능 시점이다 — description에 *"알림 승격은 T1-14 — 이 값이 0이 된 뒤"* 명기. ⚠️ **기존 패널 id 2 「재부팅 대기 노드」와 다른 양**이다(그쪽은 현재 대기 노드 수). 같은 제목을 하나 더 만들지 않는다 |
| 재부팅 부채 창 | table | `instance:node_reboot_debt:min7d` · `min14d` · `min30d` | 노드×창 매트릭스. 나이를 지어내지 않고 창을 보여준다(§1.1). 기존 패널 id 9 「재부팅 대기 (노드별)」는 **현재값 1/0**만 보여주므로 대체하지 않고 나란히 둔다 |

**Row 「디스크 건강」(id 200) — 죽은 패널 정리도 여기서 한다**

| 패널 | 현행 expr | 조치 | 근거 |
|---|---|---|---|
| 6 | `smartctl_device_percentage_used` | **삭제** | 플릿 NVMe **0개**(`lsblk -d` 4노드) → 영구 공백 |
| 8 | `smartctl_device_available_spare * 100` | **삭제** | 동일 |
| 7 | `smartctl_device_attribute{attribute_name="Reallocated_Sector_Ct"}` | **삭제** | RAID 뒤라 0계열. 대체 신호(`node_smart_disk_grown_defect_list`)는 축2 T2-6이 넣는다 |

세 이름 모두 라이브 918개 스냅샷에 **없다**(실측). 축2(W4)까지 미루면 축4 가드·축5 CI가 두 파동 내내 red다(§0.3) → **W2인 이 태스크가 처리한다.** 삭제로 row 200이 일시적으로 비는 것은 사실을 드러내는 것이지 후퇴가 아니다 — 그 자리는 T2-6이 물리 디스크 패널로 채운다.

> [!CAUTION]
> **전력 알림은 만들지 않는다.** 820W→900W일 때 1인 운영자가 취할 조치가 정의되지 않는다(랙 전력 예산·PSU 정격 **미측정**). 조치가 불명확한 신호는 패널이지 알림이 아니다 — hardware-ops가 PSU 불균형을 같은 이유로 스코프 아웃한 것과 동일 판단. `fleet:node_bios_drift:count`·`fleet:gpu_driver_unlabeled:count`의 알림 승격도 알림 축(hardware-ops 축2)이 결정한다. **`rules/`에는 `record:`만 넣는다.**

#### D4-6. hardware-ops 거짓 서술 교정 (T4-7) — **11곳**

| 위치 | 현재 | 교정 |
|---|---|---|
| `spec.md:212` | `product:node_bios_versions:count`(bios_version만) | `product:node_bios_revisions:count`(+`bios_release`) + `fleet:node_bios_drift:count` |
| `spec.md:261` | BIOS 드리프트 "현재 **2**, 목표 1" | **거짓** → 현재 **0**. 비교 가능 모델 그룹은 DL380 Gen10 2대뿐 |
| `spec.md:216·221·889` | `instance:node_bios_age:days` 삭제 후보 | **삭제 확정**(B10 종결) |
| `spec.md:676` | 주석 "2026-07-30 실측 = 2 (595.71.05, 535.309.01)" | **거짓** → 라벨 필터 추가. `535.309.01`은 Prometheus에 없는 값이라 주석에서 제거. (`:677`은 `- record:` 행이다 — 인용 행 1 정정) |
| `spec.md:853` (AC-3-1) | "→ 숫자(현재 `2`)" | **현재 `1`** + `fleet:gpu_driver_unlabeled:count` → `4`를 필수 동반 검증으로 추가 |
| `spec.md:856` (AC-3-4) | 표준화 후 `= 1` | **도달 불가** → `count_hygiene = 1` **AND** `unlabeled:count = 0`으로 교체(축1 T1-4 선행) |
| `spec.md:200` | kWh가 레코딩 시리즈 참조 | 원 메트릭 기반 + `> 0` 필터로 교체(적용 후 24h 과소집계·data01 0kWh 회피) |
| `tasks.md:42·43` | T1-1·T1-2 규칙 목록 | 교정된 레코드명으로 갱신 + "검증: 축4 AC" 참조 |
| **`tasks.md:44` (T1-3)** | 라이브 적용 절차가 **`docker compose restart prometheus`** | **`docker kill -s HUP prometheus`로 교정.** 같은 파일명(`keiwi-hardware.yml`·`keiwi-standards.yml`)을 쓰기로 한 이상, 이 절차가 남아 있으면 §7.3이 2026-07-02 대시보드 소실 사고의 원인으로 지목하고 T4-9가 금지한 명령을 hardware-ops 쪽에서 그대로 실행하게 된다 |
| **`spec.md:551`** (`BiosVersionDrift` 알림) | `expr: max(product:node_bios_versions:count) > 1` — **삭제될 레코드를 참조하는 알림 규칙**. 그대로 두면 영구 no-data **죽은 알림**이 되고, `:554` 주석 "현재 2"도 거짓(실측 `max(product:node_bios_versions:count)`=1, 드리프트 현재 0) | **레코드명 교체가 아니라 존폐 판단이다 — 존치하되 재작성**: `expr: max(fleet:node_bios_drift:count) > 0`, 주석을 "현재 0"으로. 삭제하지 않는 근거: BIOS 드리프트를 알림으로 볼지의 판단 자체는 hardware-ops(알림 축) 소관으로 유효하고, 교정 레코드가 같은 의도를 표현하며, 현재값 0이라 day-1 발화도 없다. 이 교정은 죽은 참조 제거까지만 — 활성화(배포) 판단은 hardware-ops에 남긴다 |
| **`tasks.md:151`** (B10 백로그) | `instance:node_bios_age:days` 결론을 미결로 유지("exporter 쪽으로 이동" 대기) — grep에 계속 걸려 AC-4-13이 영구 red | **"fleet-hardening T4-7에서 삭제로 종결" 표기**(README §3.1의 결론 그대로). 레코드는 만들지 않는다. 경과일 신호가 다시 필요해지면 exporter 쪽 `keiwi_bmc_bios_age_days` 신설은 BMC 축의 새 백로그 항목으로 연다 |

#### D4-7. 라이브 적용 경로 (`[server]`, §11·§12)

> [!NOTE]
> data05는 `sudo -n`이 실패한다 [실측] — `sudo -n -l` 출력에서 `(ALL) NOPASSWD: ALL` **뒤에** `(ALL : ALL) ALL`이 와서 마지막 규칙이 이긴다(hardware-ops **T0-6**이 고칠 대상이고, sudoers 편집은 라이브 변경이라 **사람 몫**이다 — §11·§12). 아래 명령은 **대화형 `sudo`(비밀번호 입력)로 사람이 수행**한다. `sudo -n`을 전제한 스크립트로 감싸지 말 것 — 조용히 실패한다. data05에서 특권이 필요한 태스크 전수는 **README §4.2.1**.

```bash
# 1) 레포에서 먼저 게이트 통과 (사람이, 레포 클론에서)
bash scripts/gates/check-rules.sh && bash scripts/gates/check-promql-metrics.sh

# 2) 복사 — 라이브 파일 직접 편집 금지(§12)
sudo cp infra/monitoring/rules/keiwi-hardware.yml  /data/monitoring/rules/
sudo cp infra/monitoring/rules/keiwi-standards.yml /data/monitoring/rules/
sudo chown root:root /data/monitoring/rules/*.yml && sudo chmod 644 /data/monitoring/rules/*.yml

# 3) 설정 재적용 — 재시작 금지. --web.enable-lifecycle=false 라 POST /-/reload 는 405.
sudo docker kill -s HUP prometheus

# 4) 성공 판정 (실패해도 Prometheus는 구 설정을 조용히 유지하므로 반드시 확인)
curl -sG --data-urlencode 'query=prometheus_config_last_reload_successful' localhost:9090/api/v1/query
curl -s 'localhost:9090/api/v1/rules?type=record' \
  | jq -r '.data.groups[].rules[] | "\(.name) \(.health)"' | grep -E 'keiwi_(power|standards|firmware)'
```

대시보드는 **`docker cp` 주입 금지**(`infra/monitoring/README.md:135-136` CAUTION — 2026-07-02 익명뷰어 적용 재생성 때 keiwi-gpu·model-workload·logs 대시보드 소실 사고. 같은 취지가 `:46`과 `docs/runbooks/node-onboarding.md:119`에도 있다). 프로비저닝 바인드 경로에 복사한다.

### 4.3 주요 판단

| 결정 | 근거 | 기각한 대안 |
|---|---|---|
| BIOS 그룹 키에 `bios_release` 추가 + 규칙명 변경 | `bios_version`은 HPE ROM 패밀리 코드라 동일 모델에서 상수다. **이름을 바꿔야** 구 규칙 참조가 레포에 남았는지 grep으로 검증 가능하다(AC-4-13) | `bios_date`로 그룹핑 — 같은 리비전에서도 벤더 재배포로 달라지고, 문자열이라 PromQL이 비교 순서를 못 준다(hardware-ops가 `node_bios_age:days`에서 이미 부딪힌 벽) |
| 드라이버 카운트에 라벨 필터 + **`unlabeled:count` 동반 필수** | 필터만 걸고 끝내면 "1종으로 통일됨"이라는 **더 나쁜 거짓말**이 된다. 사각지대 크기를 같은 대시보드에 숫자로 띄우는 것이 조건 | data03·04 dcgm-exporter 업그레이드 — GPU 노드 컨테이너 재기동은 연구 워크로드 중단 위험이고, 애초에 DCGM 라벨은 커널모듈 버전만 보여 유저스페이스 불일치를 못 잡는다 |
| kWh를 **원 메트릭** 기반으로 | 레코딩 시리즈 참조는 적용 후 24h 동안 과소값을 낸다 — **첫날 값이 틀리면 신뢰를 잃고 그대로 방치된다.** 원 메트릭은 30일치가 이미 있어 즉시 정확(실측 .105=9.43kWh, `count_over_time[1d]`=5760으로 결측 0) | `kwh30d` 추가 — retention이 정확히 30d이고 .103/.101은 30일 전 데이터가 없다. **경계에서 조용히 틀리는 지표는 만들지 않는다** |
| 조인 키를 `label_replace`로 `:9100` 정규화 | syshealth `$instance`가 `:9100` 형식이라 패널 필터가 그대로 동작하고, `keiwi-recording.yml`의 기존 노드 규칙 전부가 같은 키를 쓴다. 3노드 조인 성립 실측 | `node` 라벨 — 라이브에서 `node`는 dcgm .103·gpu-model·port-exporter에만 있고 **node-exporter 4타깃에는 없다**. 붙이는 것은 hardware-ops T2-2의 일이며 이 축이 `prometheus.yml`을 건드리면 스코프 침범 |
| 모든 `fleet:` 집계에 커버리지 동반 시리즈 강제 | `sum(x > 0)`은 노드가 사라져도 값이 줄 뿐이라 "절전"과 "관측 상실"이 구분되지 않는다. data05가 61일 망가진 채였던 환경에서 이건 이론적 위험이 아니다 | `absent()` 알림 — 조치가 정의되지 않은 신호를 알림으로 올리지 않는다는 원칙 위반 |
| `or vector(0)`을 0이 모호하지 않을 때만 | "관측된 드라이버 버전 수 = 0"은 데이터 없음과 구분 불가라 **초록 거짓말**이 된다 | 전 규칙 일괄 적용 — 일관성은 좋아 보이나 "데이터 없음"을 "정상"으로 렌더링하는 게 정확히 이 스펙이 고치려는 결함이다 |
| 검증을 **`promtool test rules` 단위 테스트**로 | §9의 실질 이행. 라이브 없이 돌고 규칙의 문법이 아니라 **의미**를 잠근다 | 라이브 쿼리 결과만 AC로 — 지금 hardware-ops가 그렇게 했고 그래서 "현재 2"라는 거짓 기대값이 검증 없이 박혔다. 라이브 AC는 배포 후 확인용으로 남기되 **게이트는 오프라인이어야** 한다 |
| 메트릭명 존재 가드를 별도 스크립트로 | `promtool check rules`는 `_watts`를 **문법상 유효한 메트릭 참조로 통과시킨다** — 오타는 배포 후 빈 패널로만 드러난다 | 리뷰어 눈 검사 — 1인 운영이라 리뷰어가 작성자와 같은 사람이다. **사람 눈은 게이트가 아니다** |
| 전력 알림 미생성 | 조치가 정의되지 않는다 | `watts_sum > 1000` — 임계 근거가 없고, 근거 없는 임계는 무시 습관을 만든다(T0-7 교훈) |
| 라이브 적용을 `docker kill -s HUP` | `--web.enable-lifecycle=false`(405)라 HTTP reload 불가, restart는 스크레이프·평가 공백과 컨테이너 재생성 리스크 | `--web.enable-lifecycle=true`로 compose 변경 — 라이브 compose 변경은 §12 위반이고 범위 밖 |
| hardware-ops와 **같은 파일명**을 쓴다 | 산출물이 새 기능이 아니라 아직 라이브가 아닌 스펙 내용의 교정이다 | `keiwi-power.yml`·`keiwi-drift.yml` 신설 — 이름은 더 정확하지만 T1-1/T1-2가 죽은 태스크로 남아 나중에 누군가 거짓 규칙을 되살릴 여지를 남긴다 |

### 4.4 수용 기준

| ID | 수용기준 | 검증 |
|---|---|---|
| **AC-4-1** | 규칙 2파일이 구조적으로 유효(로컬) · **문법상** 유효(promtool 있을 때) | `bash scripts/gates/check-rules.sh --check infra/monitoring/rules/keiwi-hardware.yml infra/monitoring/rules/keiwi-standards.yml; echo rc=$?` → `RULES_OK engine=…` + `rc=0`. **엔진에 무관하게 rc=0이어야 한다.** `engine=structural`이면 §0.2.2 표의 왼쪽 열까지만 검증된 것이고 **PromQL 문법 판정은 CI가 정본**이다. ⚠️ raw `docker run … prom/prometheus … promtool`은 **ENTRYPOINT가 `/bin/prometheus`라 실행되지 않는다**(§0.2.1) |
| **AC-4-2** | `rules/`에 `alert:` 키 혼입 없음(record 전용) | `! grep -rqE '^[[:space:]]*-[[:space:]]*alert:' infra/monitoring/rules/; echo $?` → `0` |
| **AC-4-3** `[CI 정본]` | **BIOS 미탐 회귀 테스트** — 같은 모델·같은 `bios_version`·다른 `bios_release`를 드리프트로 잡는다(구 규칙이면 반드시 실패) | **판정**: `bash scripts/gates/check-rules.sh --test infra/monitoring/rules/tests/keiwi-hardware.test.yml; echo rc=$?` → `SUCCESS` + `rc=0`, (A)에서 revisions=2 · drift=1. **promtool이 있어야만 판정된다**(§0.2.2 — `test rules`는 폴백 불가) → **CI `infra-iac` 잡이 정본**이고, 엔진 없는 로컬에서는 `SKIP(env: promtool)` + `rc=2`가 **정답**이다. **로컬에서 지금 실행 가능한 부분**: `bash scripts/gates/check-rules.sh --test --schema-only infra/monitoring/rules/tests/keiwi-hardware.test.yml; echo rc=$?` → `rc=0`(`rule_files`·`tests[].input_series`·`promql_expr_test[].exp_samples` 스키마와 기대값 존재까지). 스키마는 "테스트가 깨졌다"를 잡고 "규칙이 옳다"는 잡지 못한다 |
| **AC-4-4** `[CI 정본]` | 라벨 부재 버킷을 버전으로 세지 않는다(구 규칙이면 2가 나와 실패) | **판정**: `bash scripts/gates/check-rules.sh --test infra/monitoring/rules/tests/keiwi-standards.test.yml; echo rc=$?` → `SUCCESS` + `rc=0`, versions=1 · unlabeled=2. AC-4-3과 같은 이유로 **CI 정본**, 엔진 없는 로컬은 `rc=2`가 정답. **로컬 실행 가능 부분**: `--schema-only` → `rc=0` |
| **AC-4-5** | 메트릭명 가드가 존재하지 않는 이름을 잡는다(`_watt` vs `_watts`) | `bash scripts/gates/check-promql-metrics.sh` exit 0, 그리고 `_watts` 오타 파일에 대해 `--extra /tmp/typo.yml` → **exit 1** |
| **AC-4-6** | 스냅샷이 낡지 않았다 **+** pending 파일이 청소된다 (**두 명령 모두 `0`**) | ① 스냅샷 누락(**record 이름 제외** — §0.3): `diff <(curl -sG localhost:9090/api/v1/label/__name__/values \| jq -r '.data[]' \| grep -v ':' \| sort) <(grep -v ':' infra/monitoring/metric-names.txt \| sort) \| grep -c '^<'` → `0` ② pending 청소: `comm -12 <(sort infra/monitoring/metric-names.txt) <(cut -d'#' -f1 infra/monitoring/metric-names.pending.txt \| tr -d '[:blank:]' \| grep -v '^$' \| sort) \| wc -l` → `0`. **전제: T4-12(배포 직후 스냅샷 재생성)가 완료된 상태** |
| **AC-4-7** | 라이브 적용 후 플릿 전력 시리즈가 존재하고 값이 실측 범위 | `q 'fleet:node_chassis_power:watts_sum'` → `700 < x < 1200` (실측 820) |
| **AC-4-8** | 정직성 분모가 함께 산출 | `q 'fleet:node_chassis_power:reporting_count'` → `3` |
| **AC-4-9** | 노드별 GPU 점유율이 GPU 3노드 전부에서 산출(`:9400`→`:9100` 조인 성립) | `q 'instance:gpu_power_share:ratio'` → **3시리즈**(전부 `:9100` 형식), 각 `0 < x < 1` |
| **AC-4-10** | 일일 전력량이 적용 직후부터 정확(레코딩 축적 대기 없음) | `q 'instance:node_chassis_energy:kwh1d{instance="192.168.1.105:9100"}'` → 첫 평가 시점에 `8 < x < 12` (실측 9.43) |
| **AC-4-11** | 드라이버 지표의 사각지대가 숫자로 노출 | `q 'fleet:gpu_driver_versions:count'` → `1` · `q 'fleet:gpu_driver_unlabeled:count'` → `4` (hardware-ops가 적은 "현재 2"가 아니다) |
| **AC-4-12** | BIOS 드리프트가 리비전 기준이고 분모가 함께 존재 | `q 'fleet:node_bios_drift:count'` → `0` · `q 'count(product:node_count:count > 1)'` → `1` |
| **AC-4-13** | 거짓 레코드명이 **적용 대상 코퍼스에서** 완전히 사라졌다 | `! git grep -q 'product:node_bios_versions:count\|instance:node_bios_age:days' -- infra/monitoring/rules/ infra/monitoring/dashboards/ specs/hardware-ops/ ; echo $?` → `0`. **T4-7의 11곳(D4-6) 전부 교정 후에만 통과한다** — 교정 전 실측 히트는 hardware-ops **8줄**(`spec.md:212·216·221·261·551·889` · `tasks.md:42·151`)이고, D4-6이 9곳이던 초안은 그중 `spec.md:551`·`tasks.md:151` 2줄을 못 덮어 **영구 rc=1**이었다(D4-6 10·11행이 그 둘이다). ⚠️ **스코프를 `specs/ infra/` 전체로 잡으면 영구 rc=1** — 이 스펙 자신의 README·spec·tasks가 그 이름을 "삭제 대상"의 근거로 인용하기 때문이다(실측: fleet-hardening 3파일 히트). 삭제해야 할 것은 **규칙·대시보드·hardware-ops 문장**이지 삭제 근거를 적은 문서가 아니다 |
| **AC-4-14** | hardware-ops의 거짓 기대값이 교정됐다 | `grep -c '현재 \`2\`' specs/hardware-ops/spec.md` → `0`(현재 1) · `grep -q 'fleet:gpu_driver_unlabeled:count' specs/hardware-ops/spec.md` · `grep -q 'count_hygiene' specs/hardware-ops/spec.md` · `! grep -q 'docker compose restart prometheus' specs/hardware-ops/tasks.md` (D4-6 9번째 행) |
| **AC-4-15** | syshealth에 row 2개 추가 + 플릿 전력 stat이 커버리지 동반 표시 | `jq -r '.uid' …/syshealth.json` → `keiwi-syshealth` · `jq '[.panels[]\|select(.type=="row")]\|length'` → `5`(현재 3) · 「플릿 섀시 전력」 targets에 `reporting_count` 포함 → `true` |
| **AC-4-16** | 대시보드가 참조하는 모든 레코드명이 규칙 파일에 실제로 정의됨(패널 no-data 방지) | `bash scripts/gates/check-promql-metrics.sh --dashboards infra/monitoring/dashboards --rules infra/monitoring/rules; echo rc=$?` → `OK` + `rc=0`. **전제: AC-4-19(죽은 패널 3개 제거)가 먼저 통과** |
| **AC-4-19** | **죽은 패널 3개가 제거됐다 — CI가 W2부터 초록일 수 있는 조건** | `python3 -c "import json;d=json.load(open('infra/monitoring/dashboards/syshealth.json'));ps=d['panels']+[q for p in d['panels'] for q in (p.get('panels') or [])];print([(p.get('id'),t.get('expr')) for p in ps for t in (p.get('targets') or []) if any(k in t.get('expr','') for k in ['percentage_used','available_spare','smartctl_device_attribute'])])"` → `[]`. **도입 전 실행 결과(실측): 3건**(패널 6·7·8) |
| **AC-4-17** | 라이브 재적용 성공 + 새 그룹 health=ok | `q 'prometheus_config_last_reload_successful'` → `1` · `/api/v1/rules?type=record`의 `keiwi_(power\|standards\|firmware)` 그룹 전 규칙 `health=ok` |
| **AC-4-18** | 새 그룹 평가 비용이 기존 수준을 크게 넘지 않는다 | `q 'max by (rule_group) (prometheus_rule_group_last_duration_seconds{rule_group=~".*keiwi-(hardware\|standards).*"})'` → 각 그룹 `< 0.5s` (기존 최대 0.0092s) |

---

## 5. 축 5 — CI 파이프라인 (헌장 §9 이행)

### 5.1 문제 (실측)

헌장 §9는 "모든 spec의 acceptance criteria는 실행·검증 가능해야 하며 **CI가 강제한다**"고 선언하는데, `.github/workflows` 디렉터리 자체가 없다(worktree·프로덕션 양쪽 확인 — `.github`에는 CODEOWNERS·ISSUE_TEMPLATE·PR 템플릿만). `docs/branching.md:192`는 이미 "Require status checks to pass — CI(`npm run verify`) 초록일 때만 머지"를 규약한다. **강제 장치를 문서가 전제하는데 실체가 없다.**

**게이트가 red인 채 릴리스됐다** `bash apps/console/scripts/check-no-secrets.sh` → **rc=1**, 히트 16행. `git tag` → v0.1.0·v0.2.0.

히트 16건 분류 — **오탐 14건**: XML 네임스페이스 URI 2(`icon.svg:1`, `opengraph-image.tsx:9` — `xmlns="http://www.w3.org/2000/svg"`는 식별자이지 엔드포인트가 아니다) · 테스트 픽스처 9(`grafana-host.test.ts:4,19,22,32,36` · `sentry-scrub.test.ts:17,29,38,123`) · JSDoc 예시 1(`grafana-host.ts:45`) · **호스트 리터럴이 존재하지 않는 템플릿 리터럴** 1(`grafana-host.ts:64` `` return `http://${h}:${LAN_GRAFANA_PORT}`; `` — 정규식이 `http://` 뒤 `$`를 외부 호스트로 오인) · 배포 무관 공개 링크 1(`about/page.tsx:261`).
**진짜 2건**: `layout.tsx:9` `metadataBase: new URL("https://keiwi.excusa.uk")`, `layout.tsx:24` `url: "https://keiwi.excusa.uk"`.

**스캔 사각지대** 스크립트는 `apps/console/src`만 본다. 같은 성격의 리터럴이 밖에 있다 — `apps/console/next.config.ts:31` `allowedDevOrigins: ["127.0.0.1","localhost","192.168.1.105","*.excusa.uk"]`. `infra/`·`docs/`·`.github/`는 전혀 검사되지 않는다.

**진짜 시크릿 탐지 능력 0** 규칙 1은 `https?://`로 시작하는 문자열만 본다. 개인키·`ghp_`·`xoxb-`·Slack 웹훅·GlitchTip DSN·Cloudflare 터널 토큰은 전부 통과한다.

**S1 패턴 8종을 `git ls-files` 전체에 실제로 돌린 결과 [실측] — 히트 1건**

| 위치 | 값 | 성격 |
|---|---|---|
| `apps/console/scripts/sentry-payload-probe.mjs:51` | `SECRET_TOKEN` 상수에 Slack 봇 토큰 꼴이 **통짜 리터럴**로 박혀 있다(`xoxb` 접두 + `PROBE`·`SECRET`·`TOKEN`을 `-`로 이은 값 — 아래 규약대로 값을 그대로 옮겨 적지 않는다) | **합성 픽스처.** Sentry 스크러버가 Slack 토큰 꼴을 마스킹하는지 검증하는 프로브 하네스 |

이 1줄은 `slack_token`과 `generic` **두 패턴에 동시에** 걸린다. 나머지 6패턴 0건. 즉 **커밋된 실제 자격증명은 0건이지만, S1을 "예외 0"으로 켜면 이 1줄 때문에 도입 즉시 red다.** `sentry-scrub.ts:29`의 `xoxb-…`는 U+2026(줄임표)이라 `[0-9A-Za-z-]{10,}`에 걸리지 않고, `sentry-scrub.test.ts`에는 토큰 리터럴이 없다(전수 확인).

> [!CAUTION]
> **S1의 코퍼스(`git ls-files` 전체)에는 이 스펙 문서 자신도 포함된다.** 그래서 위 값을 문서 본문에 **그대로 옮겨 적으면** 프로브를 고쳐도 AC-5-3이 red로 남는다 — 이 스펙 초안이 실제로 그랬다(실측: `spec.md` 2행 + `tasks.md` 1행 = **히트 3건**. 지금은 미추적이라 `git ls-files`에 안 잡히고, **커밋되는 순간 발현**한다).
> **규약 — 자격증명 꼴 리터럴을 문서에 재현하지 않고 위치와 구성으로만 기술한다.** S1에 예외를 파는 대신 문서를 고치는 것이 §5.2의 원칙("오탐은 허용리스트가 아니라 규칙 재정의·산출물 교정으로 없앤다")과 같은 처리다. 이 규약은 축3이 만드는 런북 6종·ADR-0023 본문에도 그대로 적용된다.

**해소 — 예외를 만들지 않고 픽스처 쪽을 고친다.** `sentry-scrub.ts:34`의 스크러버 정규식이 `/\bxox[baprs]-[A-Za-z0-9-]{6,}/`이므로 프로브가 검증하려면 **런타임 값이 그 꼴이어야** 한다. 값을 바꾸면 프로브가 무의미해지므로 **51행의 통짜 리터럴만 없애고 실행 시 조립**한다(런타임 값·검증력 불변). 교체 후 51행:

```js
// S1(자격증명 리터럴 금지)에 걸리지 않도록 조립한다. 런타임 값은 종전과 동일하며
// sentry-scrub의 Slack 패턴을 그대로 만족한다 — 프로브의 검증력은 불변.
const SECRET_TOKEN = ["xoxb", "PROBE", "SECRET", "TOKEN"].join("-");
```

> diff가 아니라 **교체 후 코드**만 싣는 이유가 위 규약이다 — `-` 행에 원본 리터럴을 실으면 그 diff 블록 자체가 S1 히트가 된다.

이 기법은 T5-5의 self-test 픽스처에도 같은 이유로 적용한다(§D5-1 자기 검증).

**규칙 3(번들 노출)은 조용히 skip된다** — `if [ -d .next/static ]` 가드. `npm run verify`가 build 뒤에 돌려 우연히 동작하지만, CI에서 순서를 바꾸면 게이트가 **무음으로 통과**한다.

**CI 베이스라인은 전부 green이다** (워크플로만 없을 뿐 게이트는 오늘 통과한다) — `lint` rc=0 / `typecheck` rc=0 / `test` 7파일 88건 0.383s / `build` **rc=0, 9.6s, 환경변수 하나도 없이 성공**(서버 전용 env는 런타임 fail-fast) → **러너에 시크릿 0으로 CI 구성 가능**.
자산 규모: YAML 38개 전부 파싱 성공 · 대시보드 JSON 10개 유효 · Python exporter 2개 `py_compile` 통과 · 추적 셸 4개 · Jinja2 템플릿 7개 · Ansible role 5개·플레이북 2개(`--syntax-check` **오프라인 rc=0**).

**스펙이 존재를 주장하는 게이트 3개가 실재하지 않는다(§7 드리프트)** — `apps/console/scripts/check-error-tracking.sh`(`specs/error-tracking/spec.md:425` AC-E-12가 실행을 요구, `README.md:124`는 "`npm run verify` 편입"이라 기술) · `scripts/check-sentry-egress.sh`(`sentry.md:513` T-S2d) · `scripts/check-runbooks.sh`(hardware-ops `tasks.md:59`). `find` → 0건.

**검사받지 않은 프로비저닝 결함** `datasources/elasticsearch.yaml`(`name/uid: keiwi-logs-es`, `type: elasticsearch`)과 `opensearch.yaml`(같은 name·uid, `type: grafana-opensearch-datasource`)이 **동일 uid를 중복 선언**한다. 라이브에는 `opensearch.yaml` 1개뿐 → 레포가 라이브보다 파일이 하나 많고, **§12의 "레포본 복사" 절차를 따를수록 사고가 되는 지뢰**다.
알림 규칙은 프로비저닝되지 않은 무작위 uid `bflbhyfj7rzlsb`를 참조한다(hardware-ops T2-1이 고칠 대상).

**버전 핀 근거** Prometheus **3.11.3**(`/api/v1/status/buildinfo`) · Grafana **13.0.1**(`/api/health`) · 레포 **PUBLIC**(`gh repo view`) → 호스티드 러너 과금 0.

**build 게이트는 이 호스트에서 구조적으로 불가능하다** — `docs/testing.md:19-24`: "`npm run verify`는 build를 포함 — 라이브 주의(§12). 콘솔은 `apps/console/.next`를 **라이브로 서빙**하므로 … 에이전트 검증은 build 제외로". **GitHub 호스티드로 옮기는 것이 이 제약의 정답이다.**

### 5.2 설계

#### D5-0. 소유 경계

- **소유**: CI 하네스(워크플로·`verify-all.sh`·게이트 배치 규약)와 **레포 전역 게이트**(시크릿·YAML·JSON·셸·파이썬·compose·promtool config·ansible·Grafana 프로비저닝).
- **비소유**: 각 축의 도메인 게이트 *내용*. `check-runbooks.sh`(축3) · `check-rules.sh`/`check-promql-metrics.sh`(축4) · `check-smart-metric-allowlist.sh`(축2) · `check-error-tracking.sh`/`check-sentry-egress.sh`(각 스펙 소관, **미구현**). 축5는 §0.2 규약과 글롭 실행만 제공한다.

#### D5-1. 선결과제 — `check-no-secrets.sh` 재설계

현재 규칙 1은 이름은 "secrets"인데 실제 의미가 **"src 안의 모든 외부 URL 금지"**다. 이 잘못된 추상화가 오탐 14건과 탐지 실패를 동시에 만든다. **허용리스트를 붙이지 않고 규칙을 4개로 쪼갠다** — 오탐은 예외가 아니라 규칙 재정의로 사라진다.

**S1 — 자격증명 리터럴 금지** (스코프: `git ls-files` 전체, 테스트 포함, **예외 0**). 실제 형식만 매칭한다.

> [!IMPORTANT]
> **정규식 엔진을 못 박는다: `python3` `re`.** 아래 패턴은 `(?i)` 인라인 플래그·`\s`·`{10,}`를 쓰는 PCRE 문법이라 **`grep -E`에서는 조용히 안 잡힌다**(`(?i)`가 리터럴로 취급되고 `\s`가 매칭되지 않는다). `grep -P`는 GNU grep 전제가 필요하고 러너·노드 이식성이 갈린다. bash 래퍼 안에서 `python3` 히어독으로 구현하고, `--self-test`가 **패턴별로 픽스처 1건씩** 잡는지 확인한다 — 이 스펙이 고치려는 "게이트가 죽은 것과 조용한 것의 구분"을 게이트 자신에게 먼저 적용한다.

| 패턴 | 대상 |
|---|---|
| `-----BEGIN [A-Z ]*PRIVATE KEY-----` | SSH/TLS 개인키 |
| `xox[baprs]-[0-9A-Za-z-]{10,}` | Slack 토큰 |
| `hooks\.slack\.com/services/T[A-Z0-9]{6,}/B[A-Z0-9]{6,}/[A-Za-z0-9]{16,}` | Slack 웹훅 **실 URL** |
| `ghp_[A-Za-z0-9]{36}` · `github_pat_[A-Za-z0-9_]{22,}` | GitHub 토큰 |
| `https?://[0-9a-f]{32}@` | Sentry/GlitchTip DSN |
| `eyJ[A-Za-z0-9_-]{100,}` | Cloudflare 터널 토큰(JWT) |
| `(?i)(password\|passwd\|secret\|token\|api[-_]?key)\s*[:=]\s*['"][^'"${<][^'"]{7,}['"]` | 값이 `${`(보간)·`<`(자리표시자)로 시작하지 **않는** 하드코딩 |

> 이 엄격한 형식 덕분에 hardware-ops `spec.md:390`의 `services/T00000000/…`, `tasks.md:86`의 `services/TEST`는 **예외 없이 자연 통과**한다(`/B…/…` 세그먼트가 없다). 허용리스트가 필요 없는 이유가 여기 있다.

**S2 — 배포 결합 리터럴 금지** (스코프: **런타임 소스만** — `apps/console/src/**` 빼기 `**/*.test.ts(x)`·`**/__tests__/**`, 더하기 `apps/console/next.config.ts`). 패턴: 사설 IP `\b(?:10\.\d{1,3}|192\.168\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3})\.\d{1,3}\b` + 자체 도메인 `\b[a-z0-9-]+\.excusa\.uk\b`(스크립트 상단 `OWNED_DOMAINS` 상수 1곳).
`localhost`·`127.0.0.1`·`github.com`·`www.w3.org`는 통과 — **규칙이 "배포마다 달라지는 값"만 보기 때문**이지 예외 목록이 아니다. `xmlns`도, 템플릿 리터럴도 리터럴 호스트가 없으므로 구조적으로 안 걸린다.

> **테스트를 S2에서 빼는 것은 스코프 정의이지 면제가 아니다.** S2의 목적은 "배포 산출물이 환경에 못 박히지 않게"인데 테스트는 배포되지 않는다. 더구나 `sentry-scrub.test.ts`는 **사설 IP 마스킹을 검증**하는 테스트라 픽스처에서 사설 IP를 빼면 테스트가 무의미해진다. 반대로 S1은 커밋 자체가 유출이므로 테스트에도 예외를 두지 않는다.

**S3 — 서버 전용 env의 클라이언트 번들 노출 금지 (fail-loud)** — `.next/static` 부재 시 **skip이 아니라 exit 1**. 명시적 `KEIWI_SKIP_BUNDLE_CHECK=1`로만 우회하고 CI에서는 금지. 키: `PROMETHEUS_URL|OPENSEARCH_URL|VLLM_URL|VLLM_MODEL|GLITCHTIP_DSN|INVENTORY_PATH`. (실측: 현재 빌드에는 노출 0)

**S4 — `.env` 실파일 추적 금지** (레포 전체) — `git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.env\.example$'`. 확인된 추적 파일은 `.env.example` 4개뿐이라 확장 후에도 green.

**자기 검증(`--self-test`)** — 각 규칙이 자기 패턴을 실제로 잡는지 확인한다. 못 잡으면 rc=1. **"게이트가 조용해진 것"과 "게이트가 죽은 것"을 구분하는 유일한 방법이다.**

> [!CAUTION]
> **픽스처를 파일 리터럴로 커밋하지 않는다.** 이 레포는 **PUBLIC**이고(§5.1), GitHub push protection / secret scanning은 **유효성과 무관하게 패턴만 보고 차단**한다. `ghp_` 36자·Slack 웹훅 꼴·개인키 헤더를 파일에 그대로 커밋하면 **게이트를 도입하는 그 PR이 push되지 않는다** — 게이트를 세우려다 게이트에 막히는 자기모순이다.
>
> **규격**: `--self-test`는 픽스처를 **런타임에 문자열 조립으로 생성**해 `mktemp -d`에 쓰고, 검사 후 지운다. 접두사를 분할 결합해 소스에 완전한 패턴이 존재하지 않게 한다.
>
> ```python
> # scripts/... --self-test 내부 (예시)
> GH  = "ghp" + "_" + "A"*36
> SLK = "https://hooks.slack." + "com/services/T" + "0"*8 + "/B" + "0"*8 + "/" + "x"*24
> PEM = "-----BEGIN" + " RSA PRIVATE KEY-----"
> ```
>
> 픽스처 **위치는 콘솔 스코프**(`apps/console/scripts/fixtures/`)다 — §0.2가 "콘솔 게이트와 레포 전역 게이트를 섞지 않는다"고 규약했는데 콘솔 스크립트가 레포 루트 `scripts/gates/fixtures/`를 읽으면 그 경계가 무너진다. 런타임 생성이라 실제로는 `mktemp -d` 아래에만 존재하고, 커밋되는 것은 **생성 로직뿐**이다. 이 판단은 **ADR-0023에 근거로 기록**한다(다음 사람이 "왜 픽스처 파일이 없지?"라고 묻고 되살리는 것을 막는다).

**진짜 결함 3건은 코드를 고친다**

| 대상 | 조치 |
|---|---|
| `src/app/layout.tsx:9,24` | `src/config/env.ts`에 `getSiteUrl()` 신설(`NEXT_PUBLIC_SITE_URL`, 미설정 시 `http://localhost:3105`) → `metadataBase: new URL(getSiteUrl())`, `openGraph.url: getSiteUrl()`. `.env.example`에 키 추가 |
| `next.config.ts:31` | `allowedDevOrigins: (process.env.KEIWI_DEV_ORIGINS ?? "").split(",").filter(Boolean).concat(["127.0.0.1","localhost"])` — dev 전용, 기본값에 배포 값 없음 |
| `grafana-host.ts:45` JSDoc · `grafana-host.test.ts:4` 픽스처 | 실도메인 → RFC 2606 `grafana.example.com`. 테스트는 순수 문자열 비교라 동작 불변 |
| `scripts/sentry-payload-probe.mjs:51` | S1 유일 히트. 리터럴 → 런타임 조립(위 diff). **런타임 값·프로브 검증력 불변** |

#### D5-2. 게이트 레지스트리 구현

```
scripts/
  verify-all.sh                     # 로컬 = CI 동형 실행기. 기본 build 제외, --with-build로만(§12)
                                    #   ① scripts/gates/check-*.{sh,py} 글롭 순회
                                    #   ② apps/console/scripts/check-no-secrets.sh · check-no-raw-hex.sh 를 각 1회
                                    #   ※ gates/ 안에 콘솔 스크립트 래퍼를 두지 않는다 — 두면 ②와 중복 실행(AC-5-20)
  gates/
    lib.sh                          # (헬퍼) gate_begin/gate_fail/요약표
    promtool.sh                     # (헬퍼) promtool 해석기 — PATH→docker(--entrypoint)→캐시→[옵트인]Release. 축1 T1-12
                                    #   --which 로 path|docker|cache|none 을 알린다 (항상 rc=0)
    check-yaml.sh                   # yamllint(-c .yamllint.yml) 전 추적 YAML
    check-json.sh                   # 대시보드 전수 파싱 + uid 유일성 + title 존재 (도입 시점 red 1건:
                                    #   keiwi-logs 중복 — T5-8이 logs.import.json 삭제로 해소, §7.2 표 9번)
    check-shell.sh                  # shellcheck -S warning, 추적 *.sh 전수
    check-python.sh                 # py_compile + import 스모크
    check-compose.sh                # docker compose -f <각 파일> config -q
    check-prometheus.sh             # promtool check config (라이브 동형 마운트) — promtool.sh 경유, 폴백 없음(D5-4)
    check-grafana-provisioning.py   # 프로비저닝 유효성(D5-3)
    render-templates.py             # (헬퍼) j2 오프라인 렌더 — check-ansible.sh가 호출
    check-ansible.sh                # ansible-lint + syntax-check + render-templates.py 호출
    # ↓ 다른 축이 떨어뜨리면 글롭으로 자동 편입 (배선 작업 0)
    check-runbooks.sh               # 축3
    check-rules.sh · check-promql-metrics.sh   # 축4
    check-smart-metric-allowlist.sh            # 축2 (render-smart-fixture.sh는 이 게이트가 호출하는 헬퍼)
    render-smart-fixture.sh                    # (헬퍼) 축2
tools/                              # 게이트가 아니라 게이트가 import/호출하는 파이썬 모듈 — 글롭과 무관
    promtool_fallback.py            # (헬퍼) promtool 부재 시 축소 강도 엔진(§0.2.2). check-rules|check-metrics. 축1 T1-12
    promql_metric_guard.py          # (헬퍼) 메트릭명 가드 — promtool_fallback의 토크나이저를 공유. 축4 T4-4
apps/console/scripts/
    check-no-secrets.sh · check-no-raw-hex.sh  # 콘솔 스코프(§0.2)
    fixtures/                       # (런타임 생성 로직만 — 자격증명 리터럴 커밋 금지, D5-1)
```

> **`check-` 접두사가 계약이다.** `promtool.sh`·`render-*`·`lib.sh`는 게이트가 아니라 헬퍼이므로 글롭 대상이 아니고, 반드시 어떤 `check-*`가 호출해야 한다(§0.2). 이 규약이 없으면 "만들었는데 아무도 안 부르는 스크립트"가 생긴다 — §5.1이 지적한 미구현 게이트 3건과 같은 종류의 드리프트다.

#### D5-3. 프로비저닝 유효성 게이트

| 규칙 | 내용 | 현재 |
|---|---|---|
| P1 | `datasources/*.yaml`의 `uid` 유일성 | **FAIL** — `keiwi-logs-es` 중복 |
| P2 | 같은 파일들의 `name` 유일성 | **FAIL** — 동일 |
| P3 | `alert-rules.yaml` 규칙 `uid`·`title` 유일성 | PASS(중복 0. 현재 9건이지만 축1 T1-6이 2건, 축2 T2-8이 3건을 더하므로 **개수를 게이트에 하드코딩하지 않는다**) |
| P4 | `evaluator.params[0]` 수치가 `annotations.summary`에 등장 | **FAIL 1건** — `keiwi-gpu-temp-high`: 92 vs "85°C". summary에 숫자가 없으면 skip |
| P5 | `datasourceUid ∈ (프로비저닝된 uid ∪ {__expr__})` | **FAIL** — `bflbhyfj7rzlsb`. **hardware-ops T2-1 완료 후 배선**(T5-12) |

P1·P2 해소: **`elasticsearch.yaml`을 삭제한다.** 라이브에 없는 파일이고, 같은 uid를 다른 type으로 두 번 선언하면 §12의 복사 절차가 그대로 사고가 된다. 파일을 남겨두면(주석 처리든 `.disabled`든) 다음 사람이 되살릴 여지가 남는다.
P4 해소는 **축3 T3-6 소관**(문구 소유) — 축5는 게이트만 만들고 red→green 전환을 확인한다(T5-14).

#### D5-4. promtool — 라이브 동형 마운트

```bash
# check-prometheus.sh 내부. promtool.sh(§0.2.1)와 달리 여기는 마운트 경로가 라이브 동형이어야
# 하므로 docker 경로를 직접 쓴다 — 그래서 --entrypoint 지정이 특히 중요하다.
docker run --rm \
  -v "$PWD/infra/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
  -v "$PWD/infra/monitoring/rules:/etc/prometheus/rules:ro" \
  --entrypoint=/bin/promtool prom/prometheus:v3.11.3 \
  check config /etc/prometheus/prometheus.yml
```

> [!WARNING]
> `--entrypoint`를 빼면 이미지 기본 ENTRYPOINT `/bin/prometheus`가 실행되어 `prometheus check config …`가 되고 즉시 죽는다. 이미지가 `USER nobody`로 돌므로 마운트 파일이 others-readable이어야 한다(git 기본 644라 충족).
> docker 경로가 막히면(이 호스트는 `docker` 그룹 미가입으로 소켓 permission denied [실측]) `promtool.sh`가 찾아낸 로컬/캐시 바이너리로 내려가되, **마운트 동형성이 사라지므로 `rule_files` 글롭 해석은 검증되지 않는다** — 그 경우 게이트는 `WARN: 글롭 동형성 미검증(로컬 바이너리 경로)`을 찍고 exit 0으로 통과한다.
> **docker도 promtool도 없으면(이 호스트의 기본 상태) `SKIP(env: docker)` + exit 2다.** `check config`는 §0.2.2의 폴백 대상이 아니다 — prometheus 설정 스키마 전체(스크레이프 잡·relabel·서비스 디스커버리)를 순수 Python으로 재현하는 것은 검증이 아니라 두 번째 파서를 만드는 일이고, 그 파서가 틀리면 거짓 초록이 된다. **`check config`의 정본은 CI**이고, 로컬은 T5-26에서 promtool을 설치한 뒤에야 WARN 경로로 올라선다. CI(호스티드)에서는 docker가 살아 있으므로 항상 동형 경로로 돈다.

`rule_files: "/etc/prometheus/rules/*.yml"` 글롭이 **라이브와 동일한 경로로 해석**되므로 규칙 문법뿐 아니라 "라이브에서 규칙이 실제로 로드되는가"까지 검증된다. pull 3회 재시도 + 실패 시 GitHub Release 바이너리 폴백.

#### D5-5. Ansible — molecule 기각, 3단 오프라인 검증

`ansible-lint`(profile `moderate`) + `ansible-playbook --syntax-check`(오프라인 rc=0 실측) + **Jinja2 렌더 스모크**.

`render-templates.py`가 각 role의 `defaults/main.yml`을 컨텍스트로 `templates/*.j2` 7개를 `ChainableUndefined`로 렌더한다(미정의 변수는 통과, **문법 오류만** 실패). 결과를 확장자로 갈라 넘긴다:
- `keiwi-node-hygiene.sh.j2` → `shellcheck` — 노드에서 실제로 도는 수집 스크립트다. 문법 오류 = 메트릭 소실.
- `filebeat.yml.j2` → `yamllint` — 들여쓰기 하나가 **로그 인입 정지**(6일 침묵 사고와 동일 계열)를 만든다.
- `*.service`/`*.timer` → 렌더만 확인(`systemd-analyze`는 러너에서 의존성 경고 노이즈가 커서 제외).

#### D5-6. 워크플로

`.github/workflows/ci.yml` — `on: push(main,dev) / pull_request`, `concurrency: ci-${{ github.ref }}` cancel-in-progress, `permissions: contents: read`.

| 잡 | 내용 |
|---|---|
| `console` | ubuntu-24.04 · setup-node(22, cache npm) · `npm ci → lint → typecheck → test → build → check:secrets → check:no-raw-hex` (**build가 반드시 S3보다 앞**) |
| `repo-gates` | shellcheck(프리인스톨) · `pip install yamllint` · check-yaml/json/python/compose/grafana-provisioning · check-secrets(레포 전역 S1·S4) |
| `infra-iac` | `pip install ansible-lint` · **promtool 설치**(아래) · check-ansible · check-prometheus(docker) · **check-rules `--check` + `--test`** · check-promql-metrics |

**CI에서 promtool을 설치한다 — 여기가 검증 강도의 정본이다.** 서드파티 액션 0 원칙을 지키기 위해 마켓플레이스 액션을 쓰지 않고 `run:` 스텝 하나로 끝낸다:

```yaml
- name: install promtool
  run: |
    set -euo pipefail
    v=3.11.3   # 라이브 실측 버전과 동일 핀 (§D5-4)
    curl -sSLo /tmp/p.tgz "https://github.com/prometheus/prometheus/releases/download/v${v}/prometheus-${v}.linux-amd64.tar.gz"
    echo "${PROMTOOL_SHA256}  /tmp/p.tgz" | sha256sum -c -
    # ↑ PROMTOOL_SHA256은 T5-18에서 릴리스의 sha256sums.txt를 실제로 받아 확인한 값을
    #   워크플로에 리터럴로 박는다. 이 스펙에 값을 적지 않는다 — 확인 안 한 해시는 근거 없는 수치다.
    tar -xzf /tmp/p.tgz -C /tmp --strip-components=1 "prometheus-${v}.linux-amd64/promtool"
    sudo install -m 0755 /tmp/promtool /usr/local/bin/promtool
    promtool --version
```

이 스텝이 있어야 `promtool.sh --which`가 CI에서 `path`를 반환하고, **로컬에서 `SKIP(env)`이던 `check-rules.sh --test`(AC-4-3·AC-4-4)가 CI에서 실제로 판정된다.** 로컬은 `engine=structural`까지, CI는 promtool 전강도 — 이 비대칭이 §0.2.2에 표로 명시돼 있고 의도된 것이다. 러너에 docker가 프리인스톨돼 있으므로 `check-prometheus.sh`도 동형 마운트 경로로 돈다.

설계 고정점:
- **`paths:` 필터를 쓰지 않는다.** required status check가 skip되면 브랜치 보호가 영구 pending으로 머지를 막는다. 총 소요 ~2분이고 퍼블릭이라 과금 0 — 절약할 것이 없는 곳에서 알려진 함정을 밟을 이유가 없다.
- **서드파티 액션 0.** `actions/checkout`·`actions/setup-node`만. 나머지는 러너 프리인스톨(shellcheck·jq·docker·python3) + `pip install`. 액션 major는 도입 시 `gh api repos/actions/checkout/releases/latest --jq .tag_name`으로 **실제 확인 후 핀**(추측 금지).
- **러너에 시크릿 0.** `next build`가 env 없이 rc=0임을 실측했다 → 워크플로에 `secrets.*` 참조가 한 건도 없어야 한다(AC-5-15).

`.github/workflows/release.yml` — `on: push: tags: ['v*']` → `verify-all.sh --with-build` 재실행 + `CHANGELOG.md`에 해당 태그 섹션 존재 확인. **v0.2.0이 red인 채 태그된 사건에 대한 직접 대응**이다(태그를 되돌리진 못하지만 릴리스 커밋에 빨간 표시가 남고 후속 릴리스가 멈춘다).

**브랜치 보호 `[server]`** — 이 환경의 `gh`는 협업자 토큰이라 코드로 못 건다 → `docs/branching.md` §7① 체크리스트에 **status check 이름 3개(`console`·`repo-gates`·`infra-iac`)**를 적어 소유자가 등록한다.

### 5.3 주요 판단

| 결정 | 근거 | 기각한 대안 |
|---|---|---|
| **GitHub 호스티드 전용**, self-hosted runner 금지 | 러너를 data03/05에 두면 ① 연구 GPU 워크로드와 CPU·디스크를 경쟁 ② 러너가 내부망 자격으로 라이브에 도달해 **§12를 우회하는 경로**가 생김 ③ 관제 대상이 아닌 새 상태저장 서비스가 늘어남. 실측으로 모든 게이트가 내부망 없이 rc=0 | data03 self-hosted + 라이브 실쿼리 검증 — 3중 비용 |
| **molecule 기각**, ansible-lint + syntax-check + j2 렌더 스모크로 대체 | ① role 5개가 전부 systemd 유닛을 설치해 privileged + systemd 이미지가 필요 ② 타깃이 균질하지 않다(`filebeat-xenial` 별도 존재, 16.04는 2021 EOL이라 apt 저장소가 없어 컨테이너 프로비저닝이 네트워크 의존·플레이키) ③ 실제 위험("템플릿 오렌더"·"태스크 문법 오류")은 초 단위 검사로 90% 잡힌다 ④ 남는 위험(유닛이 실제로 뜨는가)은 §11의 현행 절차(`--check` 후 사람이 `systemctl is-active`)가 담당 | molecule + docker 드라이버 — 초기 구축 L, CI 5~10분, xenial 경로는 재현 불가 |
| 오탐을 허용리스트가 아니라 **규칙 재정의**로 제거 | 오탐 14건의 원인은 "src 안의 모든 외부 URL 금지"라는 잘못된 추상화다. 허용리스트는 자라면서 게이트를 무의미하게 만들고 **탐지 실패는 그대로 남는다** | `# check-secrets:ignore` 인라인 주석 / `.secretsignore` |
| 테스트를 S2에서 제외하되 **S1은 예외 없음** | 두 규칙의 목적이 다르다. `sentry-scrub.test.ts`는 사설 IP 마스킹을 검증하는 테스트라 픽스처를 빼면 테스트가 무의미해진다 | 픽스처를 RFC 5737(192.0.2.0/24)로 교체 — 사설 대역 판정 로직을 검증하는 테스트라 문서용 대역으로 바꾸면 **테스트가 거짓 통과**한다 |
| `verify-all.sh`는 기본 build 미실행, **build 게이트는 CI가** | 콘솔은 `apps/console/.next`를 라이브로 서빙한다 — 같은 디렉터리에서 build를 돌리면 운영이 깨진다(§12). 이 호스트에서는 build 게이트를 상시 돌릴 방법이 구조적으로 없었다. **CI 도입의 가장 큰 실익이 "자동화"가 아니라 "라이브를 안 건드리고 빌드를 검증할 유일한 장소"다** | 로컬 verify에 build 포함 + 격리 worktree 수동 절차 — 절차가 길어 실제로는 생략되고 v0.2.0과 같은 결과 |
| `paths:` 필터 미사용 | required check가 skip되면 GitHub이 영구 pending으로 취급해 머지 불가 | `dorny/paths-filter` — 서드파티 + pending 함정 + 1인 운영에 무의미한 최적화 |
| 서드파티 액션 0 + 버전 실제 확인 후 핀 | 퍼블릭 레포 워크플로는 공급망 공격 표면이다. 필요한 도구가 전부 프리인스톨/`pip` 한 줄이라 이득이 없다. 버전을 추측하면 첫 실행에서 깨진다 | 편의 액션(`ludeeus/action-shellcheck` 등) |
| promtool을 **라이브 동형 경로**로 마운트, v3.11.3 핀 | 글롭까지 똑같이 해석되므로 "라이브에서 실제로 로드되는가"가 검증된다. 버전 핀은 파서 차이로 CI와 라이브 판정이 갈리는 것을 막는다 | 임의 경로 `check rules`만 — 글롭 오타·경로 변경을 놓친다 |
| 전제 미충족 시 **skip이 아니라 fail-loud** | §9가 요구하는 것은 "명령이 이 출력을 낸다"이고, 그 반대 실패 모드가 **"검사가 안 돌았는데 초록"**이다 | 현행 조건부 skip — 게이트 존재 자체가 거짓 안심을 준다 |
| P5(참조 무결성)는 스크립트에 넣되 **배선은 T2-1 이후** | 지금 강제하면 축5가 축2를 블로킹해 CI가 red인 채 도입되고, 그 red가 일상이 되면 게이트 전체가 무시된다 — **정확히 지금 check:secrets에 일어난 일** | 즉시 강제 / 축5가 T2-1을 대신 수행(축 경계 침범) |
| `elasticsearch.yaml`을 **삭제**(주석·rename 아님) | 라이브에 없는 파일이고 §12 절차를 따를수록 사고가 된다. 남겨두면 다음 사람이 되살린다. **되돌리기 어려운 것은 오히려 반대 방향**(두 파일을 라이브에 복사해 uid 충돌 상태로 Grafana가 재시작되는 것) | uid를 `keiwi-logs-es-legacy`로 변경 — 안 쓰는 데이터소스가 하나 더 생기고 ADR-0010 계열 문서와 어긋난다 |

### 5.4 수용 기준

| ID | 수용기준 | 검증 |
|---|---|---|
| **AC-5-1** | CI 워크플로가 존재·유효하고 잡이 정확히 3개 | `python3 -c "import yaml;d=yaml.safe_load(open('.github/workflows/ci.yml'));print(sorted(d['jobs']))"` → `['console','infra-iac','repo-gates']` |
| **AC-5-2** | 전체 게이트가 로컬에서 초록(로컬 = CI 동형) | **T5-26(도구 설치) 완료 후** `bash scripts/verify-all.sh; echo rc=$?` → `rc=0`, 요약표 FAIL 0건·SKIP 0건. **T5-26 전에는 `rc=2`가 정답이다** — `yamllint`·`shellcheck`·`ansible-lint`·`promtool` 모두 이 호스트에 없음이 실측이고(§0.2), rc=0이 나오면 게이트가 조용히 건너뛴 것이다. **T5-26 전 verify-all 요약표의 `SKIP(env)`은 `check-prometheus.sh` 1건이다** — 글롭이 `check-rules.sh`를 **인자 없이** 불러 `--test`는 `--test --schema-only`로 자동 강등되고(SKIP이 아니라 `NOTE` — D4-4), `--check`·`--render-check`는 폴백으로 돌아 T5-26 전에도 PASS다(§0.2.2). `SKIP(env: promtool)` rc=2는 **명시적 `check-rules.sh --test` 단독 호출**(AC-4-3·4-4 로컬)에서만 나온다 |
| **AC-5-3** | 선결과제 해소 — check:secrets 통과(도입 전 rc=1, 히트 16건) | `cd apps/console && npm run check:secrets; echo rc=$?` → `rc=0`. 전제 **3개가 전부** 충족돼야 한다: T5-2(layout.tsx) · T5-4(`sentry-payload-probe.mjs:51` S1 유일 히트) · **이 스펙 3파일이 §5.2 CAUTION 규약(자격증명 꼴 리터럴 재현 금지)을 지킬 것**. S1 코퍼스가 `git ls-files` 전체라 **스펙 문서도 대상**이고, 초안이 그 리터럴을 3행 담고 있어 커밋 시 red가 될 상태였다(교정 완료). 재확인: 8패턴을 `git ls-files` + `specs/fleet-hardening/*`에 돌려 히트가 T5-4 전 **1건**(probe만) · T5-4 후 **0건** |
| **AC-5-4** | **오탐 0** — xmlns·템플릿 리터럴·테스트 픽스처·github 링크를 출력하지 않는다 | `bash apps/console/scripts/check-no-secrets.sh 2>&1 \| grep -cE 'xmlns\|icon\.svg\|opengraph-image\|\.test\.ts\|LAN_GRAFANA_PORT\|github\.com'` → `0` |
| **AC-5-5** | **게이트 자기검증** — 런타임 조립한 가짜 자격증명을 S1(8패턴)~S4가 각각 탐지 | `bash apps/console/scripts/check-no-secrets.sh --self-test; echo rc=$?` → `rc=0` + `S1 detect ok (8/8 patterns)`·`S2~S4 detect ok` 4줄. 한 패턴이라도 못 잡으면 rc=1. **정규식 엔진 오설정(`grep -E`로 `(?i)`·`\s`)이 여기서 잡힌다**(D5-1). 실행 후 `mktemp -d` 정리 확인: `ls /tmp \| grep -c keiwi-selftest` → `0` |
| **AC-5-20** | 게이트가 **중복 실행되지 않는다**(§0.2 규약) | `bash scripts/verify-all.sh --dry-run \| grep -c 'check-no-secrets'` → `1` · `ls scripts/gates/ \| grep -c 'check-secrets'` → `0`(콘솔 스크립트 래퍼를 만들지 않는다) · `bash scripts/verify-all.sh --dry-run \| grep -cE 'promtool\.sh\|promtool_fallback\.py\|render-templates\.py\|render-smart-fixture\.sh\|lib\.sh'` → `0`(헬퍼는 글롭 대상이 아니다 — `tools/`는 `scripts/gates/` 밖이라 애초에 글롭에 걸리지 않는다) |
| **AC-5-6** | S2 스코프가 `next.config.ts`를 포함(사각지대 해소) | `next.config.ts`에 사설 IP 1줄 임시 추가 → 게이트 `rc=1` → `git checkout --` 원복 |
| **AC-5-7** | S3가 빌드 산출물 부재 시 조용히 skip하지 않는다 | `git worktree add --detach /tmp/keiwi-ac57 HEAD` 후 그 안에서 게이트 실행 → `FAIL(S3)` 출력·rc=1. **정리 필수**: `git worktree remove /tmp/keiwi-ac57 --force`(`docs/testing.md` 격리 빌드 절차와 동일 — 빼먹으면 worktree 등록이 남는다). ⚠️ **라이브 `apps/console/.next`를 삭제하지 말 것 — 반드시 격리 worktree에서(§12)** |
| **AC-5-8** `[CI 정본]` | promtool이 라이브 동형 경로에서 config + rules 글롭을 검증 | `bash scripts/gates/check-prometheus.sh; echo rc=$?` → **CI(docker 있음)**: `rc=0` + `SUCCESS` + rules 로드 표시. **로컬 T5-26 후**: `rc=0` + `WARN: 글롭 동형성 미검증`. **로컬 T5-26 전**: `SKIP(env: docker)` + `rc=2`가 **정답**이다 — `docker` 그룹 미가입은 게이트가 고칠 수 있는 문제가 아니고 `check config`에는 폴백을 두지 않는다(D5-4) |
| **AC-5-9** | Ansible lint + syntax-check가 오프라인 통과 | `bash scripts/gates/check-ansible.sh; echo rc=$?` → `rc=0` (lint 0 violations, 플레이북 2개 rc=0) |
| **AC-5-10** | j2 7개가 오프라인 렌더되고 렌더된 셸·YAML이 각각 통과 | `python3 scripts/gates/render-templates.py --out /tmp/j2 && ls /tmp/j2 \| wc -l && shellcheck -S warning /tmp/j2/*.sh && yamllint -c .yamllint.yml /tmp/j2/*.yml` → 7개, rc=0 |
| **AC-5-11** | 데이터소스 uid·name 유일성 — 도입 전엔 실제 결함을 잡고 조치 후 통과 | `python3 scripts/gates/check-grafana-provisioning.py; echo rc=$?` → 조치 후 `rc=0`. **조치 전엔 rc=1 + `DUP uid keiwi-logs-es: elasticsearch.yaml, opensearch.yaml`** — 이 red→green 전환이 게이트 동작의 증거 |
| **AC-5-12** | 알림 임계값↔summary 문구 정합(드리프트 탐지) | `python3 scripts/gates/check-grafana-provisioning.py --check threshold-drift; echo rc=$?` → 교정 후 `rc=0`. 교정 전엔 rc=1 + `keiwi-gpu-temp-high: params[0]=92, summary에 92 없음(85 발견)` |
| **AC-5-13** | YAML 게이트가 중복 키를 잡는다(PyYAML `safe_load`는 조용히 마지막 값을 취해 못 잡는 결함) | `printf 'a: 1\na: 2\n' > /tmp/dup.yml; yamllint -c .yamllint.yml -f parsable /tmp/dup.yml; echo rc=$?` → `rc=1`, `duplication of key`. ⚠️ `.yamllint.yml`의 규칙 이름은 **`key-duplicates`**다 — `duplicate-key`라는 규칙은 yamllint에 **존재하지 않으며** 그렇게 쓰면 `invalid config: no such rule`로 게이트가 exit 2가 된다(메시지 `duplication of key`는 `key-duplicates`가 낸다) |
| **AC-5-14** | 대시보드 JSON 전수 파싱 + uid 유일 — **T5-8의 정본 결정(logs.import.json 삭제) 완료 후에만 통과한다** | `bash scripts/gates/check-json.sh; echo rc=$?` → `rc=0`, `uid dup: 0`(T5-8 후 `dashboards: 9` — 파일 수는 참고 출력이다: hardware-ops T2-4의 `-v3` 정본 결정으로 더 줄 수 있어 **개수를 게이트 판정에 하드코딩하지 않는다**). **도입 전 실측: `uid dup: 1`(`keiwi-logs` — `logs.json`·`logs.import.json`) → rc=1**이 정답이고, 이 red→green 전환이 게이트 동작의 증거다(§7.2 표 9번) |
| **AC-5-15** | **러너에 시크릿 0** — 워크플로에 secrets 참조가 0건이고 그 상태로 build 성공 | `grep -c 'secrets\.' .github/workflows/ci.yml` → `0` · `gh run list --workflow=ci.yml --limit 1 --json conclusion -q '.[0].conclusion'` → `success` |
| **AC-5-16** | `verify-all.sh`가 기본으로 build를 돌리지 않는다(§12 라이브 `.next` 보호) | `bash scripts/verify-all.sh --dry-run \| grep -c 'next build'` → `0` · `--with-build --dry-run` → `1` |
| **AC-5-17** | 태그 워크플로가 `v*`에서 발동 | `python3 -c "import yaml;d=yaml.safe_load(open('.github/workflows/release.yml'));print(d[True]['push']['tags'])"` → `['v*']` (PyYAML은 `on:`을 `True`로 파싱) |
| **AC-5-18** | `[server]` main·dev 브랜치 보호에 3개 status check가 required로 등록 | `gh api repos/mooner92/KEIwi/branches/{main,dev}/protection --jq '.required_status_checks.contexts'` → `["console","repo-gates","infra-iac"]` 포함. ⚠️ 협업자 토큰은 403 — **소유자 계정에서 실행** |
| **AC-5-19** | 실재하지 않는 게이트를 **참조하는 쪽 문장**이 전부 표기를 갖는다(§7 드리프트 해소) | `grep -rn 'check-error-tracking\.sh\|check-sentry-egress\.sh\|check-runbooks\.sh' specs/ docs/ --exclude-dir=fleet-hardening \| grep -vcE '미구현\|이관'` → `0` (현재 **8**). ⚠️ **코퍼스에서 이 스펙 자신을 뺀다** — AC-4-13과 같은 이유이되 방향이 반대다. 넣으면 §5.1·D5-0·T5-22·이 AC 행이 전부 `미구현`을 포함하므로 **T5-22를 하지 않아도 통과하는 자기충족 AC**가 된다(실측: 원안 `… specs/ docs/ \| grep -c '미구현'` → 히트 3건이 **전부 fleet-hardening 자기 파일**, 그중 하나가 이 AC 행 자신이다). 표기를 달아야 하는 것은 **참조하는 쪽 문서**이지 그 사실을 적은 문서가 아니다. 파일이 실제로 생기면 표기를 제거하는 것이 해당 축의 완료 조건 |

---

## 6. 축 간 의존관계

```
                    ┌─────────────────────────────────────────────┐
  [W0] 축5 T5-1..5  │ check-no-secrets 재설계 + 진짜 결함 3건       │  선행 없음
                    └───────────────┬─────────────────────────────┘
                                    │ (게이트 바닥)
  [W1] 축1 T1-12 (promtool.sh + promtool_fallback.py) ──► AC-1-10 · 축4 T4-4 · 축5 T5-15
       축1 T1-1..3 ─► T1-4[server] ─► T1-11[server] 증거 캡처 ══► hardware-ops T0-4 (재부팅)
             │           ▲    │                                    ▲
             │  T0-6 or -K ┘   └─────────────────────────► 축4 T4-11 (count_hygiene 승계)
             │
             └─ T1-13[server] 재부팅 부채 청산 ─► T1-14[server] RebootRequiredStale 승격
  [W2] 축4 T4-1..7 ────────────────────────► 축4 T4-8..10 [server] 복사·HUP·대시보드 ─► T4-12 스냅샷 재생성
             └─ T4-6 (죽은 패널 3개 제거) ──────────► 축4 AC-4-16 · 축5 T5-18 이 green일 수 있는 조건
       축3 T3-4 (기존 런북 3종: frontmatter + bash -n) ─► R6·R10 day-1 red 해소
       축3 T3-1..5 ─► T3-6 (문구 교정) ────► 축3 T3-10..11 [server]
                              │
                              └─────────────────────► 축5 T5-14 (P4 게이트 red→green 확인)
  [W3] 축5 T5-6..22 ─► T5-23[server] PR ─► T5-24[server] 1주 관찰 ─► T5-25[server] required
                  │
                  └─ T5-12 (P5 배선) ◄── hardware-ops T2-1
  [W4] 축2 T2-1..11 ─► T2-12..14[server] data03·04 ─► T2-15[server] data05 ◄── hardware-ops T0-6
                                                  └─► T2-17[server] data01 (hpsa 검증 게이트)
                    T2-8(알림) ──► 2주 섀도 ──► T2-19[server] 승격
  [W0] 축5 T5-26[server] 게이트 도구 설치 (yamllint·shellcheck·ansible-lint + promtool→~/.local/bin)
                  ├─► AC-5-2·5-9·5-10·5-13
                  └─► (promtool 전강도) AC-4-3·4-4·5-8 로컬 판정 가능 · promtool.sh --which=path (§0.2.1)
```

`══►` = **되돌릴 수 없는 순서 제약**(§README 4.1). 나머지는 논리적 선행이다.

| 의존 | 이유 | 위반 시 |
|---|---|---|
| 축1 T1-11 → hardware-ops T0-4 | mismatch 1→0 전이 증거 | **영구 소실.** AC-1-13이 사후 판정 |
| 축1 T1-4 → 축4 T4-11 | `node_nvidia_kernel_module_version` 시리즈가 있어야 `count_hygiene`가 값을 낸다 | 규칙은 무해하게 비어 있다(`or vector(0)` 미사용) |
| 축3 T3-6 → 축5 T5-14 | P4(임계↔문구) 게이트가 red면 CI 도입 첫날 red | 게이트 무시 습관 |
| hardware-ops T2-1 → 축5 T5-12 | P5가 `bflbhyfj7rzlsb`를 잡는다 | 축5가 축2(hardware-ops)를 블로킹 |
| hardware-ops T0-6 → 축2 T2-15 | `sudo -n` 실패로 data05 디스크 조회 불가 | 대수를 추정으로 적게 된다 — 금지. **차단은 아니다**: 대화형 `sudo`면 지금도 실측 가능 |
| **hardware-ops T0-6 → data05 특권 태스크 전수**(축1 T1-4·T1-7·T1-9 · 축2 T2-15·T2-16 · 축3 T3-10 · 축4 T4-8~T4-10) | data05만 `sudo -n true` rc=**1**이다 [실측] — `(ALL) NOPASSWD: ALL` 뒤에 `(ALL : ALL) ALL`이 와서 마지막 규칙이 이긴다(data01·03·04는 rc=0). `ansible.cfg` `become=True`라 **T1-4는 드라이런부터** 걸리고, 로컬 셸 태스크는 `docker`(그룹 미가입)·`/data/monitoring`(root 소유)에서 걸린다 | **되돌릴 수 없는 순서 제약의 핵심 태스크가 멈춘다.** 회피: T0-6을 기다리지 않고 **Ansible은 `-K`, 로컬 셸은 대화형 `sudo`**(README §4.2.1 경로 B). sudoers 교정 자체는 라이브 변경이라 **사람(`[server]`) 몫**이고 에이전트가 하지 않는다(§11·§12) |
| 축4 T4-6(죽은 패널 제거) → AC-4-16·AC-4-19 / 축5 T5-18 | 세 죽은 메트릭이 918개 스냅샷에 없어 대시보드 가드가 FAIL | CI가 W2~W4 내내 red — §7.2가 막겠다고 한 그 실패모드 |
| 축1 T1-13(부채 청산) → 축1 T1-14(알림 승격) | `count(min_over_time(node_reboot_required[14d]) == 1)` = **2** [실측] — 부채 .103 **16.0일** · .104 **≥30일**(보존 한계). 보존 30d 상한에서도 1이라 **임계 조정으로는 못 피한다** | day-1 상주 발화 2~3건 |
| 축1 T1-12(`promtool.sh` + `promtool_fallback.py`) → 축1 AC-1-10 · 축4 T4-4 · 축5 T5-15 | 로컬 promtool 부재 + `docker` 그룹 미가입 [실측] | 이것이 없으면 promtool AC 5건이 **실행 불가**. 폴백까지 함께 만들어야 `--check` 계열이 T5-26 전에도 돈다(§0.2.2) |
| T5-26(도구 설치) → AC-5-2·5-9·5-10·5-13 · **AC-4-3·4-4·5-8(로컬 전강도)** | yamllint·shellcheck·ansible-lint·**promtool** 전부 MISSING [실측 — T5-26이 promtool Release 바이너리도 `~/.local/bin`에 설치하고, 그 순간 §0.2.1의 `--which`가 `none`→`path`로 바뀐다] | `verify-all.sh`가 rc=0이 될 수 없다(rc=2가 정상). promtool 몫이 없으면 `check-rules.sh --test`·`check-prometheus.sh`는 CI에서만 판정된다 |
| 축1·축2 메트릭 → 축4 게이트 | 배포 전 메트릭은 라이브 스냅샷에 없다 | §0.3 `metric-names.pending.txt`로 해소 |
| T1-7·T2-16·T4-9(배포) → T4-12(스냅샷 재생성) | record 이름이 `__name__`으로 노출돼 스냅샷이 즉시 낡는다 | AC-4-6이 영구 red |
| 모든 축의 게이트 → 축5 T5-24/25 | 나중에 떨어지는 게이트가 red를 만들면 required가 머지를 막는다 | 1주 정보성 관찰 기간이 완충 |

---

## 7. 위험과 완화

### 7.1 되돌릴 수 없는 위험 (최우선)

| 위험 | 완화 |
|---|---|
| **순서 위반 — data05를 탐지 배포 전에 재부팅하면 증거가 영구 소실.** 현재 62.1일 uptime + 재부팅 대기라 언제든 사람이 무심코 재부팅할 수 있다 | T1-11을 hardware-ops T0-4의 명시적 게이트로 걸고(T1-10에서 양쪽 tasks.md에 교차 기재), **AC-1-13이 `query_range`로 위반을 사후에도 기계 판정**한다. T1-4에서 data05를 뒤로 미루지 않는다 |
| **런북의 파괴적 단계가 연구 워크로드를 날린다** — 프로세스 kill·GPU reset·`nvidia-smi -pl`·노드 재부팅 | 모든 파괴적 단계 앞에 **소유자 확인 게이트**(`gpu_model_info`의 user/pid/model)를 필수 절차로 배치하고 각 단계에 `[server]` 표기(§11). Xid 43 같은 앱 레벨 코드에는 **"노드 재부팅 금지"**를 명시 |
| **베이 번호를 지어내면 정상 디스크를 뽑는다** | 베이/슬롯 메트릭을 아예 만들지 않는다. 물리 식별은 `serial`만(§2.3) |

### 7.2 게이트·CI 위험

| 위험 | 완화 |
|---|---|
| **CI가 red인 채 required로 등록되어 머지 전면 정지.** 1인 운영이라 우회할 사람도 없다 | T5-24의 **1주 정보성 관찰 기간**을 필수 선행으로 두고, 도입 시점에 red를 만드는 항목을 전수 확인해 각각 담당 태스크를 배정했다(아래 표). 나머지 게이트는 현재 baseline이 전부 green임을 실측 |

**도입 시점 red 목록 — 전수 실행으로 확인, 전부 담당 태스크 배정 [실측 2026-08-02]**

| # | red 항목 | 실행 결과 | 해소 | 파동 |
|---|---|---|---|---|
| 1 | P5 참조 무결성 | `bflbhyfj7rzlsb` 미프로비저닝 | T5-12(배선을 T2-1 이후로 분리) | W3 |
| 2 | P1·P2 데이터소스 uid/name 중복 | `keiwi-logs-es` 2회 | T5-13(`elasticsearch.yaml` 삭제) | W3 |
| 3 | P4 임계↔문구 | `keiwi-gpu-temp-high` 92 vs "85°C" | 축3 T3-6 | W2 |
| 4 | **S1 자격증명 리터럴** | `sentry-payload-probe.mjs:51` **1건**(`slack_token`·`generic` 동시 매칭). ⚠️ 이 스펙 초안 자체가 그 리터럴을 3행 담고 있어 **커밋되는 순간 4건**이 될 상태였다 | T5-4(런타임 조립) + **§5.2 CAUTION 규약**(문서에 리터럴 재현 금지, 교정 완료) | **W0** |
| 5 | **R6 frontmatter 계약** | `log-ingestion-stopped.md`·`rsyslog-omfile-flood.md` **2건** | T3-4 | W2 |
| 6 | **R10 `bash -n`** | `rsyslog-omfile-flood.md:40`(블록 시작 행, 명령은 41행) **1건** — 런북 3파일·bash 블록 11개 전수 확인 | T3-4 | W2 |
| 7 | **메트릭명 가드(대시보드)** | `syshealth.json` 죽은 메트릭 **3건** | **T4-6으로 이관**(원래 T2-6/W4) | **W2** |
| 8 | **게이트 도구 부재** | yamllint·shellcheck·ansible-lint·promtool 전부 MISSING → rc=2 | T5-26(설치) + T1-12(`promtool.sh` 해석기 **+ 폴백 엔진**). promtool 몫은 폴백이 대부분 흡수해 **verify-all 안에서는 `check-prometheus.sh`(check config)만 SKIP으로 남는다**(글롭의 인자 없는 `check-rules.sh`는 `--test --schema-only` 자동 강등 `NOTE` — D4-4). 명시적 `check-rules.sh --test` 단독 호출만 추가로 SKIP rc=2 | W0/W1 |
| 9 | **대시보드 uid 중복** | `check-json.sh` 도입 즉시 red — `logs.json`·`logs.import.json`이 **둘 다 `uid: keiwi-logs`**(10파일 중 unique 9 [실측]). `logs.import.json`은 이 항목 전까지 스펙 어디에도 언급이 없던 파일이고, hardware-ops T2-4의 `keiwi-*` vs `keiwi-*-v3` 정본 결정 범위(-v3 계열)에 **들지 않는다** | **T5-8**(정본 `logs.json` 확정 + `logs.import.json` 삭제 — 게이트를 만드는 같은 태스크가 자기 red를 해소한다) | W3 |

4~9는 최초 스펙에 누락돼 있었다. **required 등록(T5-24~25) 전에 전부 해소되도록 배치**한 것이 이 표의 목적이다 — 1~8은 W3 이전 파동에서, 9는 게이트를 만드는 T5-8 자신이 같은 커밋에서 해소한다(W3, T5-23 PR보다 앞).
| **오탐이 우회 문화를 만들어 게이트가 장식이 된다**(지금 check:secrets에 일어난 일) | 오탐을 허용리스트가 아니라 **규칙 재정의**로 없앤다. `--self-test`로 "조용한 것"과 "죽은 것"을 구분한다. 이후 오탐이 나오면 예외를 붙이지 않고 규칙 문서를 고치는 것을 ADR-0023 원칙으로 못 박는다 |
| **게이트가 응급 알림 추가를 막는다** | escape hatch는 만들지 않는다. 대신 최소 골격 30초 템플릿(T3-3 산출물)을 제공하고, `alerts:`가 빈 런북은 **WARN으로 통과**시켜 "런북 먼저·알림 나중"도 허용 |
| **메트릭명 스냅샷이 낡아 정상 메트릭을 오탐 → 게이트를 끄게 된다**(가장 흔한 CI 붕괴 경로) | 스냅샷을 **상위집합**으로 취급해 "스냅샷에 없는 이름"만 실패시키고, §0.3 pending 파일로 미배포 메트릭을 근거와 함께 허용한다. AC-4-6이 라이브 대비 누락분만 센다 |
| **docker pull 실패로 promtool 게이트가 플레이키** | CI는 pull 3회 재시도 + Release 바이너리(sha256 검증) 설치를 함께 두므로 둘 중 하나만 되면 판정된다. `infra-iac` 잡만 red이므로 원인이 명확. 관찰 기간에 플레이키율을 측정해 반복되면 바이너리 경로를 기본으로 승격 |
| **폴백 엔진이 통과시킨 규칙을 CI promtool이 거부해 "로컬 초록 → CI 빨강"이 반복된다** | 그것이 **설계된 동작**이다(§0.2.2 — 폴백은 PromQL 의미를 못 본다). 은폐하지 않기 위해 게이트가 `engine=structural`을 매번 출력한다. 반복되면 처방은 폴백 강화가 아니라 **T5-26으로 로컬에 promtool을 설치하는 것**이다 — 폴백에 PromQL 파서를 덧붙이기 시작하면 두 번째 파서를 유지보수하게 되고, 그 파서가 틀리면 거짓 초록이 된다 |
| **`next build`가 나중에 빌드타임 env를 요구하면 러너에 시크릿을 넣게 된다**(§13 훼손) | "env 없이 build 통과"를 AC-5-15로 못 박고 `secrets.` 참조 0건을 grep 검증. `config/env.ts`의 fail-fast는 런타임 게터에서만 일어나야 한다는 제약을 ADR-0023에 기록 |
| **§I-1(온프렘 only)과 충돌한다는 지적으로 도입이 되물려진다** | ADR-0023에서 선제 정리: §I-1은 **메트릭·로그·도메인 데이터**의 온프렘 유지 규정이고 CI는 그중 어느 것도 다루지 않는다. 레포는 이미 PUBLIC이고 러너에 시크릿을 넣지 않는다. **오히려 self-hosted runner가 §12 우회 경로를 만들어 위험이 크다** |

### 7.3 라이브 운영 위험

| 위험 | 완화 |
|---|---|
| **규칙 파일이 잘못된 채 복사되면 SIGHUP이 실패하고 Prometheus는 구 설정을 조용히 유지**한다 — "적용 완료"로 넘어가고 대시보드만 빈 패널 | 복사 전 게이트 통과를 필수 관문으로 절차에 못 박고(T4-8), 직후 `prometheus_config_last_reload_successful`=1 **그리고** 신규 그룹 health=ok를 **둘 다** 확인(AC-4-17). 롤백 = 복사한 2파일 삭제 후 재 SIGHUP |
| `docker compose restart prometheus` 오사용 → 스크레이프·평가 공백 + 최악의 경우 대시보드 소실(2026-07-02 실사고) | 적용 절차(§4.2 D4-7)에 `docker kill -s HUP`만 명시하고 restart를 금지 문구로 박는다. 대시보드는 `docker cp` 금지, 바인드 경로 복사만 |
| **라이브 `.next` 파괴** — AC-5-7이나 `--with-build`를 프로덕션에서 실행 | `verify-all.sh` 기본 build 미실행(AC-5-16이 강제) + AC-5-7 검증 명령 자체를 격리 worktree로 작성 + `$PWD`가 `/KEIwi`이면 `--with-build`를 거부하는 가드 |
| data05 node-exporter 컨테이너 재생성(T1-9) 시 짧은 메트릭 공백 — **관제 스택 자체를 건드린다** | `docker compose up -d node-exporter`로 **해당 서비스만** 재생성(예상 공백 ~15초, Prometheus·Grafana 무관). 롤백 = 이전 compose 재적용(1분). data05는 관제 호스트라 연구 워크로드 영향 0. **진단(로그 확인)을 선행해 추정 기반 변경을 금지** |
| 라이브 프로비저닝 리로드가 진행 중 알림의 `for` 타이머를 초기화 | T3-10을 **발화 0건일 때만** 수행하고, 직후 API로 9건 조회(AC-3-12). 변경 내용이 annotations 문자열뿐이라 판정 로직에는 영향 없음 |
| `data01`(16.04 EOL, systemd 229, uptime 451일, Jupyter 커널 RSS 291GB) 배포가 노드를 불안정하게 | `node_hygiene_apt_enabled=false`로 가장 무거운 apt 시뮬레이션을 끈다(EOL이라 248건 영구대기 = 신호 가치 0). 남는 작업은 파일 stat·`/proc` 읽기·`nvidia-smi -L`뿐. systemd 229는 `OnUnitActiveSec` 지원 확인. Ansible 도달성은 gpu-model·port-exporter 배포로 입증됨. **T1-4에서 data01을 data05보다 먼저** 두어 문제 시 중단 가능하게 |

### 7.4 수집기·탐지 위험

| 위험 | 완화 |
|---|---|
| **연구 워크로드 지연** — smartctl passthrough가 RAID 컨트롤러에 SCSI 명령을 넣는다. 리빌드 중 어레이는 큐가 포화 | 실측 12본 3.22초(디스크당 0.22초), 15분 주기 → **듀티 사이클 0.36%**. `Nice=10` + `IOSchedulingClass=idle`, 호출마다 `timeout 15`, `TimeoutStartSec=180`, oneshot이라 중첩 없음. **킬 스위치 `systemctl stop keiwi-disk-smart.timer`를 런북 첫 줄에** |
| 열화 디스크(GDL 773)에 주기 질의가 상태를 악화 | `--info --health --attributes --log=error`는 전부 **읽기 전용 로그페이지 조회**이고 미디어 접근이 아니다. `-t short` 같은 self-test는 role defaults에 플래그 자체를 두지 않는다. 조사 과정에서 여러 번 질의했으나 카운터 변동 없음 |
| `nvidia-smi` 주기 호출이 GPU 워크로드 방해 | `nvidia-smi -L`은 디바이스 열거만 — CUDA 컨텍스트·커널 launch 없음. 주기 30분, `timeout 20`으로 행 방지. 실측 정상 3노드 1초 미만. 워크로드가 실제로 도는 data04 배포 후 `DCGM_FI_DEV_GPU_UTIL` 변화 확인 |
| `cciss,N` 인덱스가 불안정 — 교체·재부팅 후 번호가 밀리면 시계열이 끊기거나 **다른 디스크에 연결** | 물리 식별을 `serial` 라벨로 고정하고 `disk_index`는 정보성. 알림·recording rule 전부 `by (instance, serial)` |
| **대수가 줄었을 때 counter가 그냥 사라져 아무도 모른다** — LV이 저지르는 실패를 새 메트릭이 반복 | `node_smart_disks_total`을 1급 메트릭으로 두고 `PhysicalDiskDisappeared`(`< offset 1h`)를 함께 정의. `node_smart_collector_probe_errors`로 "조회 실패"와 "디스크 부재"를 구분 |
| textfile `.prom`이 stale인 채 남으면 죽은 값을 살아있는 값으로 읽는다 | `_last_run_timestamp_seconds`를 항상 방출하고 AC-2-4가 30분 신선도를 기계 검증. `set -euo pipefail` + `mktemp`+`mv -f`라 부분 출력이 남지 않고, 실패 시 이전 파일이 유지되되 타임스탬프가 안 갱신돼 stale이 드러난다 |
| 가드 제거로 **소비처 없는 생산자**만 깔리는 새 실패모드(지금 고치는 것과 같은 종류의 재발) | `node_hygiene_consumer` 미선언 시 assert 실패(AC-1-14가 회귀 테스트) + `NodeHygieneCoverageGap`이 런타임에서 30분 내 같은 상황을 잡는다 |
| **버전 문자열 파싱이 미래 릴리스에서 깨져 조용히 오탐/미탐** (레이아웃이 노드마다 이미 다르다) | 필드 위치가 아닌 '첫 버전꼴 토큰' 스캔으로 4노드 검증 완료. 버전꼴이 아니면 폐기하고 `node_nvidia_probe_ok=0`으로 떨어뜨려 **오탐 대신 판정불능**을 노출. `fleet:gpu_driver_probe_failed:count`가 이 상태 자체를 관측 |
| **`RebootRequiredStale`이 배포 직후 즉시 발화해 알림 피로** — 초안은 "14일 연속이라 오늘은 발화 안 함"이라 적었으나 **실측이 정반대**였다(.103·.104 둘 다 `min_over_time[14d]`=1, `count_over_time`=만점, 부채 나이 16.0일·≥30일) | **알림을 이번 파동에서 만들지 않는다.** 임계 재도출로는 못 고친다 — 보존 30d가 표현 가능한 창의 상한인데 그 상한에서도 `count(min[30d]==1)`=1이다(§1.2 D1-4 선택지 표). record + syshealth 패널로만 노출하고(T1-5·T4-6), 기존 부채는 T1-13 재부팅 티켓으로 청산한 뒤 T1-14에서 승격한다 — `fleet:node_reboot_required:count`=0이 승격 전제라 **day-1 발화가 구조적으로 불가능**하다. AC-1-15 ③이 승격 전 "규칙 부재"를, **AC-1-17**이 승격 후 "규칙 존재 + 발화 0"을 기계 확인(2단 판정 — T1-14의 산출물이 AC를 red로 만드는 배타를 없앤다) |
| 승격(T1-14) 시점에 다시 같은 실수 | T1-14의 완료 조건에 **적용 직전 `q 'count(min_over_time(node_reboot_required[14d]) == 1) or vector(0)'` = `0`**을 넣는다(현재 **2**). 값이 0이 아니면 그만큼이 즉시 발화 대상이라는 뜻이므로 승격을 멈춘다 |
| **승격 관문 자체가 통과 불가능하게 쓰여 승격이 영원히 안 되거나, 관문을 무시하고 켜게 된다** — 초안은 관문을 "`min_over_time(...)`이 빈 벡터일 것"으로 적었다 | **수집기가 `node_reboot_required 0`을 항상 방출**하므로(`keiwi-node-hygiene.sh.j2` 31·53행) 재부팅 뒤에도 시리즈는 살아 있고 그 식은 **0을 반환한다 — 빈 벡터가 되는 경우가 없다.** 관문을 **알림 식 그대로**(`count(... == 1)` = 0) 고쳤다. 관문식과 알림식이 같으면 "관문이 통과 = day-1 발화 0"이 항등식이 된다 |
| ARGS `lineinfile`이 기존 ARGS를 통째로 교체하는 기존 위험 | 이 스펙은 동작을 바꾸지 않지만 가드 분할로 **적용 대상이 apt 노드 2개로 축소**돼 노출면이 준다. T1-4 드라이런 `--diff`로 변경분 없음을 확인(실측상 .103·.104 모두 이미 원하는 플래그가 있어 changed가 나오지 않아야 정상) |
| root 셸이 외부 명령 출력을 파싱(hardware-ops C5와 동일 범주) | 고정 argv만(`eval`·문자열 조립 없음), JSON은 정규식이 아니라 `python3 json.load`, 유닛 `ReadWritePaths` 제한, `NoNewPrivileges=true`. **AC-2-13이 이 네 가지를 grep으로 검증** |

### 7.5 문서·설계 위험

| 위험 | 완화 |
|---|---|
| **런북이 작성 직후부터 낡는다** — 게이트는 '존재'만 검사한다. 실제로 `alert-rules.yaml:17` 주석이 3일 만에 실측(88→90)과 어긋난 전례가 있다 | frontmatter `last_verified` + R11(180일 초과 WARN). 그리고 **기계가 확인 가능한 사실은 문서가 아니라 게이트에 넣는다**(R7 임계 숫자 대조) |
| hardware-ops 교정 중 다른 축(BMC·SEL·벤치마크)이 참조하는 문장을 깨뜨린다 | 교정 범위를 §4.2 D4-6의 **11곳**으로 한정하고 전부 recording rule 이름·기대값·PromQL·알림 expr·적용 명령에 국한. BMC·SEL·인벤토리·벤치마크 문단은 건드리지 않는다. AC-4-13·AC-4-14가 grep으로 확인 |
| **런북 파일 소유가 두 스펙에 겹친다** — hardware-ops T4-3이 `node-down.md`·`exporter-down.md`를, 축3 T3-3이 `node-down.md`를 만든다 | T3-8이 hardware-ops T4-3에서 두 항목을 **삭제하고 축3 `node-down.md` 참조로 대체**하도록 제안한다(`gpu-xid-critical.md`와 같은 처리). 축3 `node-down.md`는 "exporter down vs 노드 down 분기"를 §2로 담아 `exporter-down.md`를 흡수한다 — 파일을 나누면 두 문서가 서로를 가리키다 둘 다 낡는다 |
| AC-3-4를 `count_hygiene` 기준으로 바꾸면 **축1 배포까지 검증 불가 상태**가 된다 | 의존을 T4-11에 명시적 태스크로 드러낸다. 그 전까지는 `fleet:gpu_driver_unlabeled:count`(4 → 0)가 진행률 지표. **도달 불가능한 AC를 방치하는 것보다 의존이 보이는 AC가 낫다** |
| `smart-health-failed.md`가 축2와 겹쳐 상충하는 절차가 생긴다 | 축3 런북은 '지금 무엇이 보이고 무엇이 안 보이는가'와 조치만 다루고 수집 구조 변경은 링크만. 축2 완료 후 §한계 절 갱신은 **축2 T2-9의 일**로 배정 |
| 대시보드 패널 3개 삭제가 파괴적으로 보인다 | 삭제 근거가 실측(NVMe 0개, `smartctl_device_attribute` 0계열, 세 이름 모두 918개 스냅샷에 부재)이고 git 추적 파일이라 되돌리기 쉽다. 커밋 메시지에 실측 근거를 남긴다 |
| **삭제(T4-6/W2)와 대체 추가(T2-6/W4) 사이 두 파동 동안 row 200이 얇아진다** | 의도적이다 — 그 기간의 얇은 row가 **"RAID 뒤를 못 본다"는 사실의 정직한 표현**이고, 죽은 패널 3개는 그 사실을 "측정했는데 0"인 것처럼 보이게 했다(이 스펙의 결함 5종 공통 형태). 두 태스크의 커밋 메시지에 서로를 참조로 남겨 중간 상태가 미완이 아니라 설계임을 드러낸다 |
| `node_smart_*` 신설이 `smartctl_device_*`와 이원화를 만들어 두 곳을 봐야 한다 | 대시보드에서 물리 디스크를 1급으로 올리고 LV을 보조로 강등해 시선 우선순위를 하나로. 알림도 `SmartHealthFailed` **한 규칙에 두 쿼리를 OR**로 묶어 운영자가 보는 알림 개수는 늘지 않게 |
| syshealth.json 수정 중 gridPos 충돌로 매일 보는 대시보드 레이아웃이 깨진다 | 기존 마지막 패널이 y=32에서 끝남을 확인 → 신규 row는 y=32 이후에만. uid·기존 패널 id 불변, 신규 row id는 400/500대. AC-4-15가 row 3→5와 uid를 검증. 롤백 = 이전 JSON 복사 후 30초 주기 자동 반영 |
| `next.config.ts` 변경이 dev HMR을 깨뜨린다 — 이 값이 틀리면 하이드레이션이 통째로 죽고 **화면은 멀쩡해 보여** 진단이 어렵다 | 기본값에 `127.0.0.1`·`localhost`를 항상 포함하고 LAN IP·자체 도메인만 env로 뺀다. `.env.example`에 사고 이력 주석 이관. 변경 후 dev 서버로 클릭 반응 직접 확인을 T5-3의 완료 조건으로(정적 검사로는 안 잡히는 회귀) |
| **그 확인 자체가 라이브를 죽인다** — `npm run dev`는 `next dev -p **3105**`이고 `:3105`는 **라이브 콘솔이 점유 중**(`next-server` pid 22388, 실측). worktree에서 실행해도 같은 포트를 잡으러 간다 | T5-3의 완료 조건을 **격리 worktree + 포트 3199**로 못 박고 `[server]` 표시(§12). `docs/testing.md`가 이미 규약한 절차다: `node_modules/.bin/next dev -p 3199`. **`npm run dev`를 그대로 쓰지 않는다** — 스크립트에 포트가 박혀 있어 플래그로 못 덮는다 |

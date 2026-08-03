#!/usr/bin/env bash
# Prometheus 설정 게이트 — 라이브 동형 마운트로 `check config` (§5 D5-4 / T5-15)
#
# 왜 마운트 경로가 라이브와 같아야 하나:
#   prometheus.yml 의 `rule_files:` 는 **/etc/prometheus/rules/*.yml** 글롭이다. 임의 경로에서
#   설정만 검사하면 글롭이 아무것도 매칭하지 않아도 promtool은 SUCCESS를 낸다 — 즉
#   "라이브에서 규칙이 실제로 로드되는가"는 검증되지 않는다. 컨테이너 안에 라이브와 같은
#   경로로 마운트해야 글롭 해석까지 같아진다.
#
# ⚠️ `--entrypoint=/bin/promtool` 이 필수다. prom/prometheus 이미지의 기본 ENTRYPOINT는
#    /bin/prometheus 라서 생략하면 `prometheus check config …` 가 실행되고 즉시 죽는다.
#    이미지가 USER nobody 로 돌므로 마운트 파일이 others-readable 이어야 한다(git 기본 644 → OK).
#
# 3단 강도(§0.2.2):
#   docker 있음            → 동형 마운트. rules 로드까지 검증. rc=0
#   docker 없고 promtool만 → 설정 문법만. **WARN: 글롭 동형성 미검증** 을 찍고 rc=0
#   둘 다 없음             → SKIP(env: docker) rc=2
#
# 폴백(순수 python)을 만들지 않는 이유(D5-4):
#   prometheus 설정 스키마 전체(스크레이프 잡·relabel·서비스 디스커버리)를 다시 구현하는 것은
#   검증이 아니라 **두 번째 파서를 만드는 일**이고, 그 파서가 틀리면 거짓 초록이 된다.
#   `check config` 의 정본은 CI다.
#
# 이 게이트가 **못** 잡는 것: 스크레이프 타깃이 실제로 응답하는지, 라벨이 의도대로 붙는지.
#   그건 라이브 질의(§0.1의 q)와 대시보드가 본다.
#
# exit: 0 통과(WARN 포함) / 1 설정 오류 / 2 환경 부족(SKIP)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

IMAGE="${KEIWI_PROMTOOL_IMAGE:-prom/prometheus:v3.11.3}"   # 라이브 실측 버전 핀
CFG="infra/monitoring/prometheus.yml"
RULES_DIR="infra/monitoring/rules"

[[ -f "$CFG" ]] || { echo "FAIL: $CFG 없음"; exit 1; }

# ── ① docker 동형 마운트 ────────────────────────────────────────────────
if docker info >/dev/null 2>&1; then
  # pull 실패는 네트워크 사정이지 설정 오류가 아니다 — 3회 재시도 후 아래 단계로 내려간다.
  pulled=0
  for _ in 1 2 3; do
    if docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull -q "$IMAGE" >/dev/null 2>&1; then
      pulled=1; break
    fi
    sleep 3
  done
  if [[ $pulled -eq 1 ]]; then
    out="$(docker run --rm \
      -v "$PWD/$CFG:/etc/prometheus/prometheus.yml:ro" \
      -v "$PWD/$RULES_DIR:/etc/prometheus/rules:ro" \
      --entrypoint=/bin/promtool "$IMAGE" \
      check config /etc/prometheus/prometheus.yml 2>&1)"
    rc=$?
    printf '%s\n' "$out"
    if [[ $rc -ne 0 ]]; then
      echo "PROMETHEUS_FAIL engine=docker(동형 마운트)"
      exit 1
    fi
    echo "PROMETHEUS_OK engine=docker(동형 마운트) image=$IMAGE"
    exit 0
  fi
  echo "docker 이미지 확보 실패 — 로컬 바이너리 경로로 내려간다" >&2
fi

# ── ② 로컬/캐시 promtool (동형성 없음) ──────────────────────────────────
ENGINE="$(bash "$HERE/promtool.sh" --which 2>/dev/null)"
if [[ "$ENGINE" == "none" || "$ENGINE" == "docker" ]]; then
  # docker 경로는 위에서 이미 실패했으므로 여기서는 부재와 같다.
  echo "SKIP(env: docker) — 동형 마운트도 로컬 promtool도 없다. check config에는 폴백이 없다(D5-4)" >&2
  exit 2
fi

out="$(bash "$HERE/promtool.sh" --run check config "$CFG" 2>&1)"
rc=$?
printf '%s\n' "$out"
if [[ $rc -ne 0 ]]; then
  echo "PROMETHEUS_FAIL engine=$ENGINE"
  exit 1
fi
echo "WARN: 글롭 동형성 미검증(로컬 바이너리 경로) — rule_files 글롭이 라이브 경로로 해석되지 않았다"
echo "PROMETHEUS_OK engine=$ENGINE (설정 문법만)"
exit 0

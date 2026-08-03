#!/usr/bin/env bash
# T1-12 ① — promtool 해석기 (spec §0.2.1)
#
# 게이트가 promtool을 어떻게 찾는지를 한 곳에 모은다. 게이트마다 제각각 찾으면
# "이 머신에서는 왜 통과하고 저 머신에서는 왜 실패하는가"를 설명할 수 없다.
#
# 경로 우선순위: path → docker → cache → (다운로드는 기본 비활성)
#   PATH   : command -v promtool
#   docker : prom/prometheus 이미지의 promtool (--entrypoint 필수 — 이 이미지 ENTRYPOINT는
#            /bin/prometheus라서 인자로 promtool을 넘기면 `prometheus promtool ...`이 실행된다)
#   cache  : 이전에 내려받아 둔 ~/.cache/keiwi/promtool
#   download: 게이트가 매 실행마다 외부 바이너리를 받아 실행하는 것은 공급망 표면이다.
#            사람이 T5-26에서 한 번 설치하는 쪽이 정본이라 기본 비활성(옵트인).
#
# 부재는 오류가 아니라 상태다 — --which 는 항상 exit 0 이고 상태를 1줄 출력한다.
# 게이트는 이 값으로 엔진을 정하고, AC는 이 값으로 기대 강도를 정한다.
#
# 폴백 강제 스위치:
#   KEIWI_PROMTOOL_ENGINE=none  → promtool이 설치돼 있어도 없는 것으로 취급한다.
#   이 스위치가 없으면 T5-26(W0) 이후 폴백 경로가 영원히 실행되지 않아 조용히 썩는다.

set -uo pipefail

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/keiwi/promtool"
DOCKER_IMAGE="${KEIWI_PROMTOOL_IMAGE:-prom/prometheus:v3.11.3}"
ALLOW_DOWNLOAD="${KEIWI_PROMTOOL_DOWNLOAD:-0}"

# 어느 경로를 쓸지 결정한다. stdout에 path|docker|cache|none 1줄, stderr에 시도 기록.
resolve() {
  if [[ "${KEIWI_PROMTOOL_ENGINE:-}" == "none" ]]; then
    echo "KEIWI_PROMTOOL_ENGINE=none — 폴백 강제(설치 여부와 무관)" >&2
    echo none; return 0
  fi

  if command -v promtool >/dev/null 2>&1; then
    echo "path: $(command -v promtool)" >&2
    echo path; return 0
  fi
  echo "path: MISSING" >&2

  if docker info >/dev/null 2>&1; then
    echo "docker: 사용 가능 ($DOCKER_IMAGE)" >&2
    echo docker; return 0
  fi
  echo "docker: 사용 불가 (소켓 권한 또는 미설치)" >&2

  if [[ -x "$CACHE" ]]; then
    echo "cache: $CACHE" >&2
    echo cache; return 0
  fi
  echo "cache: 없음" >&2

  [[ "$ALLOW_DOWNLOAD" == "1" ]] && echo "download: 옵트인이나 미구현 — T5-26으로 설치하라" >&2
  echo none
}

# 해석된 경로로 promtool을 실제 실행한다. 인자는 그대로 전달.
run() {
  local engine; engine=$(resolve 2>/dev/null)
  case "$engine" in
    path)   promtool "$@" ;;
    cache)  "$CACHE" "$@" ;;
    docker)
      # --entrypoint 없이 부르면 /bin/prometheus 가 실행된다. 반드시 명시한다.
      docker run --rm -v "$PWD:/w:ro" -w /w --entrypoint=/bin/promtool "$DOCKER_IMAGE" "$@" ;;
    none)
      echo "promtool 없음 — 폴백 엔진을 쓰라(check-rules.sh)" >&2
      return 2 ;;
  esac
}

case "${1:-}" in
  --which) resolve; exit 0 ;;
  --run)   shift; run "$@"; exit $? ;;
  *)
    cat >&2 <<'USAGE'
usage: promtool.sh --which          경로 상태 1줄 출력 (항상 exit 0)
       promtool.sh --run ARGS...    해석된 경로로 promtool 실행 (없으면 exit 2)

env: KEIWI_PROMTOOL_ENGINE=none   폴백 강제
     KEIWI_PROMTOOL_IMAGE=...     docker 경로 이미지
USAGE
    exit 64 ;;
esac

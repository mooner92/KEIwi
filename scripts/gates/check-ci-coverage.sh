#!/usr/bin/env bash
# CI 커버리지 게이트 — 모든 게이트가 CI 어딘가에서 실제로 돈다 (§0.2 · D5-2 / T5-18)
#
# 왜 필요한가:
#   로컬 실행기(verify-all.sh)는 `scripts/gates/check-*` 를 **글롭**으로 순회하므로 새 게이트가
#   배선 없이 편입된다. 그런데 CI 워크플로는 도구 체인이 셋으로 갈려 잡별로 스텝을 **명시**한다.
#   그 비대칭 때문에 "로컬에서는 도는데 CI에서는 안 도는 게이트"가 생길 수 있고, 그건
#   §5.1이 지적한 "존재를 주장하는데 실재하지 않는 게이트"와 같은 종류의 드리프트다.
#   이 게이트가 그 간극을 막는다 — 새 게이트를 만들면 CI에 넣거나, 안 넣는 이유를 밝혀야 한다.
#
# 판정: scripts/gates/check-* 와 콘솔 게이트 2종이 ci.yml 본문에 **이름으로** 등장하는가.
#   npm 스크립트로 부르는 경우(`check-no-raw-hex.sh` → `check:no-raw-hex`)도 인정한다.
#
# 이 게이트가 **못** 잡는 것:
#   · 이름만 적히고 실제로는 주석 처리된 스텝. 문자열 존재만 본다.
#   · 잡이 실제로 성공했는가(그건 GitHub이 판정한다).
#   · release.yml 은 대상이 아니다(그쪽은 verify-all.sh 를 통째로 돌려 글롭이 살아 있다).
#
# exit: 0 통과 / 1 미배선 게이트 존재
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

CI=".github/workflows/ci.yml"
[[ -f "$CI" ]] || { echo "FAIL: $CI 없음 — 헌장 §9의 강제 장치가 실재하지 않는다"; exit 1; }

mapfile -t GATES < <(find scripts/gates -maxdepth 1 \( -name 'check-*.sh' -o -name 'check-*.py' \) -printf '%f\n' | sort)
CONSOLE=(check-no-secrets.sh check-no-raw-hex.sh)

missing=0
for g in "${GATES[@]}" "${CONSOLE[@]}"; do
  # npm 스크립트 별칭: check-no-raw-hex.sh → check:no-raw-hex
  alias_name="${g%.sh}"
  alias_name="${alias_name/-/:}"
  if grep -q -e "$g" -e "$alias_name" "$CI"; then
    continue
  fi
  echo "FAIL 미배선: $g 가 $CI 어느 잡에서도 실행되지 않는다"
  missing=$((missing + 1))
done

total=$(( ${#GATES[@]} + ${#CONSOLE[@]} ))
echo "CI_COVERAGE gates=$total missing=$missing"
[[ $missing -eq 0 ]] || exit 1
echo "CI_COVERAGE_OK"
exit 0

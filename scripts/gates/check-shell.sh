#!/usr/bin/env bash
# 셸 게이트 — 추적된 *.sh 전수에 shellcheck (spec fleet-hardening §5 D5-2 / T5-9)
#
# 왜 -S warning 인가: info·style 까지 켜면 지적이 수백 건이 되고, 그러면 사람이
# 억제 주석을 달기 시작한다. 억제가 늘면 게이트는 조용히 무의미해진다 —
# **위반은 억제하지 말고 스크립트를 고친다**는 것이 이 게이트의 운영 규약이다.
#
# 대상: `git ls-files '*.sh'`. node_modules 는 git 미추적이라 자동으로 빠진다.
#
# 이 게이트가 **못** 잡는 것:
#   · 런타임 동작. 문법이 맞아도 논리가 틀린 것은 못 본다.
#   · Jinja2 템플릿 안의 셸(`*.sh.j2`). 렌더 전에는 shellcheck가 파싱하지 못하므로
#     check-ansible.sh 가 render-templates.py 로 **렌더한 뒤** 같은 shellcheck를 돌린다.
#   · 확장자가 .sh 가 아닌 실행 스크립트(shebang만 있는 파일).
#
# exit: 0 통과 / 1 위반 / 2 shellcheck 부재(SKIP)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "SKIP(env: shellcheck) — scripts/gates/install-gate-tools.sh 로 설치" >&2
  exit 2
fi

# 추적본 + 미추적·비무시. 새 게이트 스크립트가 커밋 전에도 린트를 받아야 한다 —
# 추적본만 보면 "만들 때는 통과, 커밋한 다음 red"가 된다.
mapfile -t FILES < <(git ls-files -c -o --exclude-standard '*.sh' | sort -u)
# 삭제 예정이거나 이미 지워진 추적 파일은 건너뛴다(인덱스와 작업트리가 갈릴 수 있다).
KEEP=()
for f in "${FILES[@]}"; do [[ -f "$f" ]] && KEEP+=("$f"); done
if [[ ${#KEEP[@]} -eq 0 ]]; then
  echo "SHELL_OK (대상 0개)"; exit 0
fi

# -x: source 된 파일을 따라간다(verify-all.sh → gates/lib.sh). 없으면 SC1091 오탐이 난다.
out="$(shellcheck -x -S warning "${KEEP[@]}" 2>&1)"
rc=$?
if [[ $rc -ne 0 ]]; then
  printf '%s\n' "$out"
  echo "SHELL_FAIL files=${#KEEP[@]}"
  exit 1
fi
echo "SHELL_OK files=${#KEEP[@]} (-S warning)"
exit 0

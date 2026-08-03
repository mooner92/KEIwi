#!/usr/bin/env bash
# YAML 게이트 — 추적된 전 YAML에 yamllint (spec fleet-hardening §5 D5-2 / T5-7)
#
# 왜 이 게이트가 필요한가:
#   ① **중복 키**. PyYAML `safe_load`는 중복 키를 조용히 마지막 값으로 덮어쓴다 —
#      파이썬으로 파싱만 하는 검사는 원리적으로 못 잡는다. 프로비저닝 YAML에서 이게
#      일어나면 "레포에는 적혀 있는데 라이브에는 없는 설정"이 된다.
#   ② **들여쓰기 한 칸**. filebeat.yml 계열은 들여쓰기 하나가 로그 인입을 통째로 멈춘다
#      (6일 침묵 사고와 같은 계열의 실패다).
#
# 이 게이트가 **못** 잡는 것:
#   · 스키마 정합성. 키 이름이 그 도구에 유효한지는 보지 않는다(그건 각 도구의 config
#     검사 — check-prometheus.sh · check-compose.sh · check-ansible.sh 몫이다).
#   · 미추적 YAML. 코퍼스가 `git ls-files`라 로컬 임시 파일은 대상이 아니다.
#
# exit: 0 통과 / 1 위반 / 2 yamllint 부재(SKIP)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

if ! command -v yamllint >/dev/null 2>&1; then
  echo "SKIP(env: yamllint) — pipx install yamllint 또는 scripts/gates/install-gate-tools.sh" >&2
  exit 2
fi

CONF="$ROOT/.yamllint.yml"
[[ -f "$CONF" ]] || { echo "FAIL: $CONF 없음"; exit 1; }

# 추적본 + 미추적·비무시(새 워크플로·프로비저닝 파일이 커밋 전에도 검사되도록).
mapfile -t FILES < <(git ls-files -c -o --exclude-standard '*.yml' '*.yaml' | sort -u)
if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "YAML_OK (대상 0개)"; exit 0
fi

# -f parsable: 사람이 아니라 로그가 읽는 형식. 경고와 에러를 함께 낸다.
out="$(yamllint -c "$CONF" -f parsable "${FILES[@]}" 2>&1)"
rc=$?
warn=$(grep -c '\[warning\]' <<<"$out" || true)
err=$(grep -c '\[error\]' <<<"$out" || true)
[[ -n "$out" ]] && printf '%s\n' "$out"
if [[ $rc -ne 0 ]]; then
  echo "YAML_FAIL files=${#FILES[@]} error=$err warning=$warn"
  exit 1
fi
echo "YAML_OK files=${#FILES[@]} error=0 warning=$warn"
exit 0

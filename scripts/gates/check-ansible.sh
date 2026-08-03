#!/usr/bin/env bash
# Ansible IaC 게이트 — 3단 오프라인 검증 (spec fleet-hardening §5 D5-5 / T5-16)
#
#   ① ansible-lint (profile moderate, .ansible-lint 설정)
#   ② ansible-playbook --syntax-check (플레이북 전수)
#   ③ Jinja2 렌더 스모크 → 렌더된 셸은 shellcheck, YAML은 yamllint
#
# 왜 ③이 있나:
#   role 5개가 노드에서 실제로 도는 **수집 스크립트와 설정 파일**을 템플릿으로 배포한다.
#   `keiwi-node-hygiene.sh.j2` 의 문법 오류는 메트릭 소실이고, `filebeat.yml.j2` 의 들여쓰기
#   하나는 로그 인입 정지다(6일 침묵 사고와 같은 계열). 둘 다 배포는 **성공**한 채 수집만
#   조용히 죽는 실패라 렌더 전 파일만 봐서는 안 잡힌다.
#
# 왜 molecule 을 쓰지 않는가(ADR-0023 요약):
#   role 전부가 systemd 유닛을 설치해 privileged 컨테이너가 필요하고, 타깃이 균질하지 않다
#   (16.04는 2021 EOL이라 apt 저장소가 없어 컨테이너 프로비저닝이 네트워크 의존·플레이키).
#   실제 위험의 대부분은 초 단위 오프라인 검사로 잡히고, 남는 위험(유닛이 실제로 뜨는가)은
#   §11의 현행 절차(사람이 --check 후 systemctl is-active)가 담당한다.
#
# 이 게이트가 **못** 잡는 것:
#   · 태스크가 대상 노드에서 실제로 성공하는지(멱등성·권한·패키지 가용성).
#   · defaults 이외의 변수 조합. 렌더는 defaults 컨텍스트 하나로만 돈다.
#
# exit: 0 통과 / 1 위반 / 2 도구 부재(SKIP)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ANSIBLE_DIR="$ROOT/infra/ansible"
cd "$ROOT" || exit 2

[[ -d "$ANSIBLE_DIR" ]] || { echo "ANSIBLE_OK (대상 없음)"; exit 0; }

missing=()
command -v ansible-lint >/dev/null 2>&1     || missing+=(ansible-lint)
command -v ansible-playbook >/dev/null 2>&1 || missing+=(ansible-playbook)
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "SKIP(env: ${missing[*]}) — scripts/gates/install-gate-tools.sh 로 설치" >&2
  exit 2
fi

fail=0

# ── ① lint ────────────────────────────────────────────────────────────────
out="$(cd "$ANSIBLE_DIR" && ansible-lint -c "$ROOT/.ansible-lint" 2>&1)"
rc=$?
if [[ $rc -ne 0 ]]; then
  printf '%s\n' "$out"
  echo "ANSIBLE_FAIL lint(rc=$rc)"
  fail=1
else
  warn=$(grep -c '(warning)' <<<"$out" || true)
  echo "ansible-lint OK (warning=$warn — .ansible-lint 에 근거 기록)"
fi

# ── ② syntax-check ────────────────────────────────────────────────────────
mapfile -t PLAYBOOKS < <(find "$ANSIBLE_DIR/playbooks" -maxdepth 1 -name '*.yml' 2>/dev/null | sort)
for p in "${PLAYBOOKS[@]}"; do
  out="$(cd "$ANSIBLE_DIR" && ansible-playbook -i inventory.ini --syntax-check "$p" 2>&1)"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    printf '%s\n' "$out"
    echo "ANSIBLE_FAIL syntax-check: $p"
    fail=1
  fi
done
echo "syntax-check OK playbooks=${#PLAYBOOKS[@]}"

# ── ③ 렌더 스모크 ─────────────────────────────────────────────────────────
TMP="$(mktemp -d -t keiwi-j2-XXXXXX)"
# shellcheck disable=SC2064  # TMP 를 지금 값으로 고정해 확장한다(나중에 바뀌면 안 지워진다)
trap "rm -rf '$TMP'" EXIT

if ! python3 "$HERE/render-templates.py" --out "$TMP"; then
  echo "ANSIBLE_FAIL j2 렌더"
  fail=1
fi

shopt -s nullglob
RSH=("$TMP"/*.sh)
RYML=("$TMP"/*.yml "$TMP"/*.yaml)
shopt -u nullglob

if [[ ${#RSH[@]} -gt 0 ]]; then
  if command -v shellcheck >/dev/null 2>&1; then
    if ! shellcheck -S warning "${RSH[@]}"; then
      echo "ANSIBLE_FAIL 렌더된 셸이 shellcheck 위반 — 노드에서 도는 수집 스크립트다"
      fail=1
    else
      echo "렌더 셸 shellcheck OK (${#RSH[@]}개)"
    fi
  else
    echo "SKIP(env: shellcheck) — 렌더된 셸 미검사" >&2
    fail=2
  fi
fi

if [[ ${#RYML[@]} -gt 0 ]]; then
  if command -v yamllint >/dev/null 2>&1; then
    if ! yamllint -c "$ROOT/.yamllint.yml" "${RYML[@]}"; then
      echo "ANSIBLE_FAIL 렌더된 YAML이 yamllint 위반 — 들여쓰기 하나가 로그 인입을 멈춘다"
      fail=1
    else
      echo "렌더 YAML yamllint OK (${#RYML[@]}개)"
    fi
  else
    echo "SKIP(env: yamllint) — 렌더된 YAML 미검사" >&2
    fail=2
  fi
fi

if [[ $fail -eq 0 ]]; then
  echo "ANSIBLE_OK lint+syntax+render"
fi
exit "$fail"

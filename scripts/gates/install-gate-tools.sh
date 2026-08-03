#!/usr/bin/env bash
# T5-26 — 게이트 도구 설치 (W0 선행)
#
# 왜 이 스크립트가 레포에 있나:
#   설치는 호스트 상태 변경이라 사람이 실행한다(§11). 그러나 "무엇을 어떻게 설치하는가"는
#   재현 가능해야 하므로 절차를 코드로 남긴다. 다른 사람의 새 클론에서도 같은 결과가 나와야 한다.
#
# 설계 제약 (spec §0.2.1 · T5-26):
#   - **sudo를 쓰지 않는다.** data05는 `sudo -n`이 실패하고(마지막 sudoers 규칙이 이김),
#     W0을 hardware-ops T0-6(sudoers 교정)에 묶을 이유가 없다.
#   - **관제 스택에 손대지 않는다**(§12). 컨테이너·서비스·포트 무접촉. 사용자 레벨만.
#   - **~/.local/bin** 에만 쓴다. 이 호스트 PATH에 이미 있다.
#   - promtool은 sha256을 릴리스 `sha256sums.txt`와 대조한다(공급망 표면 최소화).
#
# 멱등: 이미 있으면 건너뛴다. --force 로 재설치.

set -uo pipefail

BIN="$HOME/.local/bin"
VENV="$HOME/.local/keiwi-gates"
PROM_VERSION="${PROM_VERSION:-3.11.3}"
SHELLCHECK_VERSION="${SHELLCHECK_VERSION:-0.10.0}"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

mkdir -p "$BIN"
rc=0
note() { printf '  %s\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*" >&2; rc=1; }

have() { command -v "$1" >/dev/null 2>&1; }
skip_if_present() {
  local tool=$1
  if [[ $FORCE -eq 0 ]] && have "$tool"; then ok "$tool 이미 있음 ($(command -v "$tool"))"; return 0; fi
  return 1
}

# ── 1. yamllint · ansible-lint (파이썬) ────────────────────────────────────────
# 이 호스트의 파이썬 경로는 sudo 없이는 전부 막혀 있다 [실측 2026-08-03]:
#   - `python3 -m venv` → ensurepip 없음 (`python3.12-venv` 미설치, apt = sudo 필요)
#   - `python3 -m pip`  → No module named pip
#   - /usr/lib/python3.12/EXTERNALLY-MANAGED (PEP 668) → --user 설치도 거부
# apt로 풀면 W0이 sudo(=hardware-ops T0-6)에 묶이는데, T5-26은 그러지 않기로 한 태스크다.
#
# 그래서 uv(단일 정적 바이너리)를 파이썬 부트스트랩으로 쓴다. uv는 자체 venv를 만들고
# 시스템 pip·ensurepip에 의존하지 않으며, 필요하면 파이썬 런타임까지 사용자 영역에 받는다.
# 시스템 site-packages는 여전히 무오염이다.
install_python_tools() {
  if [[ $FORCE -eq 0 ]] && have yamllint && have ansible-lint; then
    ok "yamllint·ansible-lint 이미 있음"; return 0
  fi

  if ! have uv; then
    note "uv 설치 (파이썬 부트스트랩 — 시스템 pip 없이 동작)"
    if ! curl -fsSL --max-time 180 https://astral.sh/uv/install.sh \
         | env UV_INSTALL_DIR="$BIN" INSTALLER_NO_MODIFY_PATH=1 sh >/dev/null 2>&1; then
      fail "uv 설치 실패 — 파이썬 도구를 건너뛴다"; return 1
    fi
    have uv || { fail "uv 설치했으나 PATH에서 안 보임"; return 1; }
    ok "uv → $(command -v uv)"
  fi

  # uv tool install 은 도구마다 격리 venv를 만들고 실행 파일을 ~/.local/bin 에 링크한다.
  for t in yamllint ansible-lint; do
    if [[ $FORCE -eq 0 ]] && have "$t"; then ok "$t 이미 있음"; continue; fi
    if uv tool install --quiet "$t" >/dev/null 2>&1; then
      have "$t" && ok "$t → $(command -v "$t")" || fail "$t 설치했으나 PATH에서 안 보임"
    else
      fail "$t 설치 실패 (uv tool install)"
    fi
  done
}

# ── 2. shellcheck (정적 바이너리) ─────────────────────────────────────────────
# apt 경로는 data05에서 sudo 비번을 요구한다. 공식 정적 바이너리를 쓴다.
install_shellcheck() {
  skip_if_present shellcheck && return 0
  local url tmp
  url="https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.linux.x86_64.tar.xz"
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' RETURN
  note "shellcheck v${SHELLCHECK_VERSION} 내려받는 중"
  if curl -fsSL --max-time 120 "$url" -o "$tmp/sc.tar.xz"; then
    tar -xJf "$tmp/sc.tar.xz" -C "$tmp" 2>/dev/null
    local found; found=$(find "$tmp" -name shellcheck -type f | head -1)
    if [[ -n "$found" ]]; then
      install -m 0755 "$found" "$BIN/shellcheck" && ok "shellcheck → $BIN/shellcheck"
    else fail "shellcheck 바이너리를 tarball에서 못 찾음"; fi
  else fail "shellcheck 다운로드 실패"; fi
}

# ── 3. promtool (Prometheus 릴리스, sha256 대조) ──────────────────────────────
# check-rules.sh --test(PromQL 평가)와 check-prometheus.sh에는 폴백이 원리적으로 없다(§0.2.2).
install_promtool() {
  skip_if_present promtool && return 0
  local base tar tmp
  base="https://github.com/prometheus/prometheus/releases/download/v${PROM_VERSION}"
  tar="prometheus-${PROM_VERSION}.linux-amd64.tar.gz"
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' RETURN
  note "promtool v${PROM_VERSION} 내려받는 중"
  curl -fsSL --max-time 300 "$base/$tar" -o "$tmp/$tar" || { fail "promtool tarball 다운로드 실패"; return 1; }

  # sha256 대조 — 릴리스가 sha256sums.txt를 제공한다.
  if curl -fsSL --max-time 60 "$base/sha256sums.txt" -o "$tmp/sums.txt"; then
    local want got
    want=$(grep " $tar\$" "$tmp/sums.txt" | awk '{print $1}')
    got=$(sha256sum "$tmp/$tar" | awk '{print $1}')
    if [[ -z "$want" ]]; then
      fail "sha256sums.txt에 $tar 항목 없음 — 설치 중단"; return 1
    elif [[ "$want" != "$got" ]]; then
      fail "sha256 불일치! want=$want got=$got — 설치 중단"; return 1
    fi
    ok "sha256 대조 통과"
  else
    fail "sha256sums.txt를 못 받음 — 검증 없는 설치는 하지 않는다"; return 1
  fi

  tar -xzf "$tmp/$tar" -C "$tmp" || { fail "tarball 해제 실패"; return 1; }
  local found; found=$(find "$tmp" -name promtool -type f | head -1)
  if [[ -n "$found" ]]; then
    install -m 0755 "$found" "$BIN/promtool" && ok "promtool → $BIN/promtool"
  else fail "promtool 바이너리를 tarball에서 못 찾음"; fi
}

echo "── T5-26 게이트 도구 설치 (사용자 레벨, sudo 불필요) ──"
install_python_tools
install_shellcheck
install_promtool

echo
echo "── 결과 ──"
for t in yamllint shellcheck ansible-lint promtool; do
  if have "$t"; then
    printf '  ✓ %-13s %s\n' "$t" "$("$t" --version 2>&1 | head -1 | cut -c1-60)"
  else
    printf '  ✗ %-13s 없음\n' "$t"; rc=1
  fi
done

echo
if [[ $rc -eq 0 ]]; then
  echo "  전부 설치됨. 되돌리려면: rm -rf $VENV $BIN/{yamllint,ansible-lint,shellcheck,promtool}"
else
  echo "  일부 실패 — 위 ✗ 확인. 관제 스택에는 아무 영향도 주지 않았다."
fi
exit $rc

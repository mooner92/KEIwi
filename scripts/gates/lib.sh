#!/usr/bin/env bash
# 게이트 실행 공통 헬퍼 (spec fleet-hardening §0.2 · D5-2 / T5-6)
#
# **헬퍼이지 게이트가 아니다** — 파일명이 `check-`로 시작하지 않으므로 verify-all.sh의
# 글롭 대상이 아니고, 반드시 누군가(verify-all.sh)가 source 해서 쓴다.
#
# 하는 일: 게이트 하나를 돌리고 (라벨, rc, 엔진) 을 기록했다가 요약표로 찍는다.
#
# 종료코드 규약(§0.2):
#   0 통과(WARN 포함) / 1 정책 위반 / 2 환경 부족(SKIP)
#   2를 분리하는 이유는 **"파서가 없어서 안 돌았는데 초록"**을 만들지 않기 위해서다.
#   그래서 요약표에 SKIP이 1건이라도 있으면 실행기 전체가 rc=2로 끝난다.
#
# 엔진 표기: 게이트 출력에 `engine=structural`이 있으면 축소 강도로 돈 것이다.
#   그것을 아무도 보지 않으면 SKIP과 실질적으로 같아지므로 요약표에 함께 찍는다.
# shellcheck shell=bash

GATE_LABELS=()
GATE_RCS=()
GATE_ENGINES=()

# gate_run <라벨> <명령...>
gate_run() {
  local label="$1"; shift
  local out rc engine="-"
  echo "── $label"
  set +e
  out="$("$@" 2>&1)"
  rc=$?
  set -e
  [[ -n "$out" ]] && printf '%s\n' "$out" | sed 's/^/   /'
  # 게이트가 스스로 밝힌 엔진을 그대로 옮긴다(추측하지 않는다).
  if grep -q 'engine=structural' <<<"$out"; then
    engine=structural
  elif grep -q 'engine=promtool' <<<"$out"; then
    engine=promtool
  fi
  GATE_LABELS+=("$label")
  GATE_RCS+=("$rc")
  GATE_ENGINES+=("$engine")
  return 0
}

# gate_summary — 요약표 출력 후 전체 rc를 반환한다(FAIL이 SKIP보다 강하다).
gate_summary() {
  local i fail=0 skip=0 structural=0 status
  echo
  echo "── 요약 ────────────────────────────────────────────────"
  printf '%-42s %-12s %s\n' "GATE" "RESULT" "ENGINE"
  for i in "${!GATE_LABELS[@]}"; do
    case "${GATE_RCS[$i]}" in
      0) status="PASS" ;;
      2) status="SKIP(env)"; skip=$((skip + 1)) ;;
      *) status="FAIL(rc=${GATE_RCS[$i]})"; fail=$((fail + 1)) ;;
    esac
    [[ "${GATE_ENGINES[$i]}" == "structural" ]] && structural=$((structural + 1))
    printf '%-42s %-12s %s\n' "${GATE_LABELS[$i]}" "$status" "${GATE_ENGINES[$i]}"
  done
  echo "gates=${#GATE_LABELS[@]} fail=$fail skip=$skip"
  if [[ $structural -gt 0 ]]; then
    echo "NOTE: ${structural}개 게이트가 축소 강도로 실행됨(promtool 부재) — CI가 정본 판정"
  fi
  if [[ $fail -gt 0 ]]; then return 1; fi
  if [[ $skip -gt 0 ]]; then
    echo "SKIP이 있으므로 rc=2 — '안 돌았는데 초록'을 만들지 않는다(§0.2)"
    return 2
  fi
  return 0
}

#!/usr/bin/env bash
# T1-12 ② — Prometheus 규칙 게이트 (promtool + 구조 폴백)
#
# 두 엔진을 가진다:
#   promtool   : PromQL 파서·평가기까지 쓰는 전강도 검사
#   structural : promtool이 없을 때 순수 python(PyYAML)으로 하는 최소 검사
#
# 왜 폴백이 필요한가:
#   이 호스트에는 promtool도 docker 접근권도 없었다(§0.2.1). 새로 클론한 사람도 같다.
#   폴백이 없으면 게이트가 exit 2로 스킵되고, "검사한다고 써놓고 아무것도 안 하는" 상태가 된다.
#   그건 이 스펙이 고치려는 실패모드와 같은 종류다.
#
# 폴백이 못 하는 것(정직하게):
#   - PromQL 의미 검증. 함수명 오타, 라벨 매처 타입 오류, 집계 차원 오류는 못 잡는다.
#   - 규칙 단위 테스트(--test) 평가. 이건 원리적으로 평가 엔진이 필요하다.
#   폴백이 잡는 것: YAML 파싱, groups/rules 스키마, record|alert 배타, expr 존재,
#   괄호·대괄호·중괄호 균형, 따옴표 균형, 빈 expr.
#
# usage:
#   check-rules.sh                       인자 없음 → --check 전체 + --test 자동강등
#   check-rules.sh --check [FILE...]     구조/문법 검사 (기본: infra/monitoring/rules/*.yml)
#   check-rules.sh --test [FILE...]      규칙 단위 테스트 (promtool 필수, 없으면 exit 2)
#   check-rules.sh --test --schema-only  테스트 파일의 스키마만 (폴백 가능)
#
# exit: 0 통과 / 1 실패 / 2 환경 부족(SKIP)

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RULES_DIR="$ROOT/infra/monitoring/rules"

MODE=""
SCHEMA_ONLY=0
FILES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE="check" ;;
    --test)  MODE="test" ;;   # 따옴표: SC2209(명령 치환 오인) 회피
    --schema-only) SCHEMA_ONLY=1 ;;
    -h|--help) sed -n '/^# usage:/,/^# exit:/p' "$0" >&2; exit 64 ;;
    *) FILES+=("$1") ;;
  esac
  shift
done

# promtool.sh --which 는 **해석 경로**(path|docker|cache|none)를 돌려준다.
# 게이트가 찍는 **엔진 이름**은 spec §0.2.2 계약상 promtool|structural 두 가지뿐이다 —
# path/docker/cache는 셋 다 "진짜 promtool이 돌았다"는 같은 뜻이고, 그 강도를 소비자가
# 구분할 이유가 없다. 해석 경로를 그대로 찍으면 `engine=path`가 나와
# T1-7("engine=promtool 확인")·AC-4-5의 문자열 계약이 깨진다.
RESOLVER=$(bash "$HERE/promtool.sh" --which 2>/dev/null)
if [[ "$RESOLVER" == "none" ]]; then ENGINE=structural; else ENGINE=promtool; fi

# 인자 없음 → check 전체 + test 자동강등(D4-4). SKIP을 만들지 않는다.
AUTO=0
if [[ -z "$MODE" ]]; then MODE=check; AUTO=1; fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  mapfile -t FILES < <(find "$RULES_DIR" -maxdepth 1 -name '*.yml' -o -maxdepth 1 -name '*.yaml' 2>/dev/null | sort)
fi
if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "RULES_OK engine=$ENGINE (검사 대상 0개)"; exit 0
fi

# ── 구조 폴백 엔진 ────────────────────────────────────────────────────────────
# 로직은 tools/promtool_fallback.py 가 정본이다(T1-12 산출물).
# 여기 인라인으로 복제하면 축2의 `check-metrics` 폴백과 규칙이 갈라진다 —
# AC-2-6이 그 파일을 직접 호출하므로 한 곳에만 둔다.
FALLBACK="$ROOT/tools/promtool_fallback.py"
structural_check() {
  if [[ ! -f "$FALLBACK" ]]; then
    echo "  FAIL 폴백 엔진 없음: $FALLBACK" >&2
    return 1
  fi
  python3 "$FALLBACK" check-rules "$@"
}

case "$MODE" in
  check)
    if [[ "$ENGINE" == "structural" ]]; then
      structural_check "${FILES[@]}" || { echo "RULES_FAIL engine=structural"; exit 1; }
      echo "RULES_OK engine=structural"
      echo "  NOTE: PromQL 의미 검증은 생략됐다(promtool 부재). 구조·문법만 검사." >&2
    else
      out=$(bash "$HERE/promtool.sh" --run check rules "${FILES[@]}" 2>&1)
      st=$?
      if [[ $st -ne 0 ]]; then echo "$out" >&2; echo "RULES_FAIL engine=$ENGINE"; exit 1; fi
      echo "RULES_OK engine=$ENGINE"
    fi
    # 인자 없음 호출은 여기서 test를 자동 강등해 이어 붙인다(D4-4) — SKIP 대신 NOTE.
    if [[ $AUTO -eq 1 && "$ENGINE" == "structural" ]]; then
      echo "  NOTE: --test는 평가 엔진이 필요해 --schema-only로 강등됨." >&2
    fi
    exit 0 ;;

  test)
    # --schema-only 는 **엔진과 무관하게** 스키마 전용 경로다.
    # 이 조건을 엔진 분기 뒤에 두면 promtool이 있을 때 `promtool test rules`가 규칙 파일을
    # 단위테스트 파일로 오인해 `field groups not found in type main.unitTestFile`로 죽는다
    # [실측 2026-08-03]. 강등 요청을 엔진 존재가 무시하면 안 된다.
    if [[ $SCHEMA_ONLY -eq 1 ]]; then
      structural_check "${FILES[@]}" || exit 1
      echo "RULES_TEST_SCHEMA_OK engine=structural"; exit 0
    fi
    if [[ "$ENGINE" == "structural" ]]; then
      echo "SKIP(env: promtool) — 규칙 단위 테스트는 평가 엔진이 필요하다" >&2
      exit 2
    fi
    out=$(bash "$HERE/promtool.sh" --run test rules "${FILES[@]}" 2>&1)
    st=$?
    [[ $st -ne 0 ]] && { echo "$out" >&2; echo "RULES_TEST_FAIL engine=$ENGINE"; exit 1; }
    echo "RULES_TEST_OK engine=$ENGINE"; exit 0 ;;
esac

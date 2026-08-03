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

ENGINE=$(bash "$HERE/promtool.sh" --which 2>/dev/null)

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
structural_check() {
  python3 - "$@" <<'PY'
import sys, yaml
bad = 0
for path in sys.argv[1:]:
    try:
        with open(path) as f:
            doc = yaml.safe_load(f)
    except Exception as e:
        print(f"  FAIL {path}: YAML 파싱 실패 — {e}"); bad += 1; continue
    if not isinstance(doc, dict) or "groups" not in doc:
        print(f"  FAIL {path}: 최상위 'groups' 키 없음"); bad += 1; continue
    groups = doc.get("groups")
    if not isinstance(groups, list):
        print(f"  FAIL {path}: 'groups'가 리스트가 아님"); bad += 1; continue
    for gi, g in enumerate(groups):
        if not isinstance(g, dict) or "name" not in g:
            print(f"  FAIL {path}: groups[{gi}]에 name 없음"); bad += 1; continue
        for ri, r in enumerate(g.get("rules") or []):
            where = f"{path}:{g['name']}[{ri}]"
            if not isinstance(r, dict):
                print(f"  FAIL {where}: 규칙이 매핑이 아님"); bad += 1; continue
            has_rec, has_alert = "record" in r, "alert" in r
            if has_rec == has_alert:
                print(f"  FAIL {where}: record/alert 중 정확히 하나여야 함"); bad += 1
            expr = r.get("expr")
            if expr is None or (isinstance(expr, str) and not expr.strip()):
                print(f"  FAIL {where}: expr 없음/빈 값"); bad += 1; continue
            e = str(expr)
            for open_c, close_c, label in (("(", ")", "괄호"), ("[", "]", "대괄호"), ("{", "}", "중괄호")):
                if e.count(open_c) != e.count(close_c):
                    print(f"  FAIL {where}: {label} 불균형 — {e[:70]}"); bad += 1
            if e.count('"') % 2 or e.count("'") % 2:
                print(f"  FAIL {where}: 따옴표 불균형 — {e[:70]}"); bad += 1
sys.exit(1 if bad else 0)
PY
}

case "$MODE" in
  check)
    if [[ "$ENGINE" == "none" ]]; then
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
    if [[ $AUTO -eq 1 && "$ENGINE" == "none" ]]; then
      echo "  NOTE: --test는 평가 엔진이 필요해 --schema-only로 강등됨." >&2
    fi
    exit 0 ;;

  test)
    if [[ "$ENGINE" == "none" ]]; then
      if [[ $SCHEMA_ONLY -eq 1 ]]; then
        structural_check "${FILES[@]}" || exit 1
        echo "RULES_TEST_SCHEMA_OK engine=structural"; exit 0
      fi
      echo "SKIP(env: promtool) — 규칙 단위 테스트는 평가 엔진이 필요하다" >&2
      exit 2
    fi
    out=$(bash "$HERE/promtool.sh" --run test rules "${FILES[@]}" 2>&1)
    st=$?
    [[ $st -ne 0 ]] && { echo "$out" >&2; echo "RULES_TEST_FAIL engine=$ENGINE"; exit 1; }
    echo "RULES_TEST_OK engine=$ENGINE"; exit 0 ;;
esac

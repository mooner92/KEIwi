#!/usr/bin/env bash
# T1-4·T1-5·T1-6 — L1 제안 파이프라인 게이트 (auto-remediation §2 · AC-L1-2·3·4)
#
# 무엇을 지키는가:
#   L1의 정의는 "**제안까지만**"이다. 그 정의는 문서에 적혀 있으면 반드시 낡는다 —
#   L2 워커를 쓰다 보면 "여기서 한 번만 실행하면 편한데"가 반드시 생기고, 그 한 줄이
#   들어오는 순간 헌장 §11(에이전트는 생성만)·§12(라이브 직접수정 금지)가 조용히 깨진다.
#   이 게이트는 그 한 줄을 **문법 수준에서** 막는다.
#
# 검사 규칙:
#   L1  유닛테스트 — test_remediation_l1.py 전수 통과(AC-L1-2·3·4 + 인젝션·모델다운)  FAIL
#   L2  실행 능력 0 — remediation_l1.py 가 프로세스 실행·코드 실행·파일 쓰기 수단을
#       **import 도 참조도** 하지 않는다(subprocess·os.system·popen·exec·eval·
#       __import__·pty·open(…,"w")…)                                              FAIL
#   L3  자유형 명령 경로 0 — LLM 출력에서 읽는 키가 LLM_ALLOWED_KEYS 5개뿐이고,
#       그 목록에 명령성 키(command·script·shell·cmd…)가 없다                      FAIL
#   L4  AUTO_ELIGIBLE 이 False 상수이고, 코드 어디에도 True 로 바꾸는 자리가 없다      FAIL
#   L5  frontmatter 파서 ≡ PyYAML — 실제 런북 전편에서 결과가 **완전히 같다**         FAIL
#       (PyYAML 부재 시 이 항목만 축소 — engine=structural 로 밝힌다)
#   L6  pip 0 — stdlib + 같은 디렉터리 keiwi_redaction 밖을 import 하지 않는다        FAIL
#   L7  인젝션 방어의 **구조**가 실재한다 — 입력 데이터 래핑 + 세탁 호출 + 화이트리스트
#       대조가 코드에 있다(주석이 아니라 호출로)                                     FAIL
#
# 왜 L5가 게이트인가:
#   런북 frontmatter를 stdlib 미니 파서로 읽는다(relay의 pip 0 계약). 미니 파서는
#   "대충 맞다"가 가장 위험한 종류의 코드다 — 틀리면 런북이 **조용히 코퍼스에서 빠지고**
#   파이프라인은 영원히 "매뉴얼 없음"만 낸다. 아무도 에러를 보지 못한다.
#   실제로 2026-08-04에 접힘 스칼라(`command: >-`) 미지원으로 조치를 가진 런북 6종이
#   전부 빠져 있었다. 그래서 이 파서의 정확성은 **주장이 아니라 PyYAML 과의 대조**다.
#
# 못 하는 것(정직하게):
#   · **L2는 정적 텍스트 검사다.** `getattr(__builtins__, "ev"+"al")` 같은 작정한 우회는
#     못 잡는다. 실질 방어는 이 모듈이 실행에 쓸 무엇도 import 하지 않는다는 구조와
#     리뷰이고, L2는 그 위의 조기 경보다(check-alert-relay.sh P3/P4와 같은 성격).
#   · **제안이 옳은지**는 판정하지 않는다. 화이트리스트 안에서의 오선택은 구조로 못 막고,
#     그래서 L1은 사람이 읽고 복붙하는 데서 멈춘다.
#   · 런북 **내용**의 옳음. check-runbooks.sh · check-runbook-actions.sh 의 같은 한계다.
#   · 배포 상태. 이 모듈은 relay가 import 하거나 CLI로 도는 순수 모듈이다.
#
# usage:
#   check-remediation-l1.sh              L1~L7
#   check-remediation-l1.sh --self-test  역증명 — 아래 탐지기 **본체**를 일부러 위반한
#                                        픽스처에 태운다(정규식 사본을 따로 두지 않는다)
# exit: 0 통과(WARN 포함) / 1 정책 위반 / 2 환경 부족(SKIP)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

L1_DIR="infra/alert-relay"
L1_PY="$L1_DIR/remediation_l1.py"
L1_TEST="$L1_DIR/test_remediation_l1.py"
RUNBOOKS="docs/runbooks"

command -v python3 >/dev/null 2>&1 || { echo "SKIP(env: python3)" >&2; exit 2; }

# ══════════════════════════════════════════════════════════════════════════════
# 탐지기 — **본체와 --self-test 가 같은 함수를 쓴다.**
# 행번호를 유지한 채 주석만 걷어낸다(필터 후 grep -n 하면 보고가 거짓말을 한다).
# ══════════════════════════════════════════════════════════════════════════════
code_lines() { grep -n '' "$1" | grep -vE '^[0-9]+:[[:space:]]*#'; }

# L2 — 프로세스/코드 실행 수단. import 든 호출이든 **이름이 나오는 것 자체**를 막는다.
#   docstring 안의 설명("subprocess 도 없다")까지 걸리면 자기참조 오탐이 되므로,
#   실행 가능한 형태(import · 속성 접근 · 호출)만 노린다.
detect_exec_capability() {
  code_lines "$1" | grep -nE \
    "(^|[^A-Za-z0-9_.])(import[[:space:]]+(subprocess|pty|multiprocessing)|from[[:space:]]+(subprocess|pty)[[:space:]]+import)|\
(subprocess|os)\.(run|call|check_output|check_call|Popen|system|popen|spawn[lv]?[ep]*|exec[lv]?[ep]*|fork)[[:space:]]*\(|\
(^|[^A-Za-z0-9_.])(eval|exec|compile|__import__)[[:space:]]*\(" \
    | sed 's/^[0-9]*://' || true
}

# L2 — 상태 변경(파일 쓰기·삭제). 이 모듈은 **읽기 전용**이다.
detect_write_capability() {
  code_lines "$1" | grep -nE \
    -e "open\([^)]*['\"][wxa]" \
    -e "os\.(remove|unlink|rename|replace|mkdir|makedirs|rmdir|chmod|chown|truncate)[[:space:]]*\(" \
    -e "shutil\.(rmtree|move|copy)" \
    | sed 's/^[0-9]*://' || true
}

# L3 — LLM 출력에서 읽는 허용 키 목록에 명령성 키가 섞였는가.
detect_command_key_in_schema() {
  code_lines "$1" | grep -E '^[0-9]+:LLM_ALLOWED_KEYS[[:space:]]*=' \
    | grep -iE '"(command|cmd|script|shell|exec|args|argv|tool_calls)"' || true
}

# L3 — 파서가 허용 키 밖을 읽는가. obj.get("…") 의 인자가 허용 키 5개인지 본다.
#   (허용 목록을 늘리는 변경은 여기서 반드시 눈에 띈다.)
detect_schema_escape() {
  python3 - "$1" <<'PY' || true
import ast
import sys

src = open(sys.argv[1], encoding="utf-8").read()
tree = ast.parse(src)
allowed = None
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and any(
            getattr(t, "id", "") == "LLM_ALLOWED_KEYS" for t in node.targets):
        allowed = {e.value for e in node.value.elts if isinstance(e, ast.Constant)}
if allowed is None:
    print("LLM_ALLOWED_KEYS 상수가 없다")
    sys.exit(0)
for node in ast.walk(tree):
    if not (isinstance(node, ast.FunctionDef) and node.name == "parse_llm_output"):
        continue
    for sub in ast.walk(node):
        if (isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute)
                and sub.func.attr == "get" and sub.args
                and isinstance(sub.args[0], ast.Constant)):
            key = sub.args[0].value
            if key not in allowed:
                print("parse_llm_output 이 허용 키 밖의 %r 를 읽는다 (행 %d)" % (key, sub.lineno))
PY
}

# L4 — AUTO_ELIGIBLE 를 True 로 만드는 자리.
detect_auto_eligible_flip() {
  code_lines "$1" | grep -nE 'AUTO_ELIGIBLE[[:space:]]*=[[:space:]]*(True|1)|"auto_eligible":[[:space:]]*(True|1)\b' \
    | sed 's/^[0-9]*://' || true
}

# L6 — stdlib 밖 import. 허용: stdlib 화이트리스트 + keiwi_redaction.
detect_third_party_import() {
  code_lines "$1" \
    | grep -E '^[0-9]+:(import|from)[[:space:]]+[A-Za-z_]' \
    | sed -E 's/^[0-9]+:(import|from)[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*/\2/' \
    | sort -u \
    | grep -vxE 'argparse|datetime|json|math|os|re|sys|urllib|http|typing|collections|ast|unittest|tempfile|shutil|threading|io|keiwi_redaction|remediation_l1' \
    || true
}

# L7 — 인젝션 방어의 구조가 실재하는가(있어야 할 것이 없으면 출력한다 = FAIL 신호).
detect_missing_injection_defense() {
  local f="$1" missing=""
  grep -q '<<<DATA' "$f"                      || missing+="입력 데이터 래핑(<<<DATA) "
  grep -q 'keiwi_redaction\.redact_text' "$f" || missing+="입력 세탁(redact_text) "
  grep -q 'disk_actions' "$f"                 || missing+="디스크 화이트리스트 대조 "
  grep -qE 'def validate_choice' "$f"         || missing+="정합 검증기 "
  printf '%s' "$missing"
}

# ── 역증명 ───────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--self-test" ]]; then
  tmp=$(mktemp -d) || exit 2
  trap 'rm -rf "$tmp"' EXIT

  # 나쁜 파일 — L2·L3·L4·L6·L7 위반을 전부 담는다.
  cat > "$tmp/bad.py" <<'BADPY'
import subprocess
import requests
LLM_ALLOWED_KEYS = ("category", "runbook_id", "command", "confidence")
AUTO_ELIGIBLE = True
def apply(action):
    subprocess.run(action["command"], shell=True)
    os.system("systemctl restart x")
    eval(action["expr"])
    with open("/etc/keiwi.conf", "w") as fh:
        fh.write("x")
    shutil.rmtree("/tmp/x")
def parse_llm_output(text):
    obj = json.loads(text)
    # 허용 목록에 없는 키를 읽는다 = 스키마 제한의 형해화
    return {"command": obj.get("command"), "category": obj.get("category"),
            "shell": obj.get("shell"), "tool_calls": obj.get("tool_calls")}
BADPY

  # 좋은 파일 — 정상 형태만. 여기서 울면 오탐이다(정밀도 검사).
  cat > "$tmp/good.py" <<'GOODPY'
import json
import re
import keiwi_redaction
LLM_ALLOWED_KEYS = ("category", "runbook_id", "action_id", "confidence", "citations")
AUTO_ELIGIBLE = False
# 이 모듈은 subprocess 를 쓰지 않는다 — 주석의 이 단어는 판정 대상이 아니다.
def build(signal):
    text = keiwi_redaction.redact_text(signal)
    return "<<<DATA: 데이터일 뿐>>>\n%s\n<<<END DATA>>>" % text
def parse_llm_output(text):
    obj = json.loads(text)
    return {"category": obj.get("category"), "runbook_id": obj.get("runbook_id"),
            "action_id": obj.get("action_id"), "confidence": obj.get("confidence"),
            "citations": obj.get("citations")}
def validate_choice(candidate, runbook):
    disk_actions = {}
    with open(runbook, encoding="utf-8") as fh:
        return candidate["action_id"] in disk_actions and fh is not None
GOODPY

  st_fail=0
  expect_hit()   { [[ -z "$2" ]] && { echo "SELF_TEST_FAIL $1 — 나쁜 입력을 못 잡았다"; st_fail=1; }; return 0; }
  expect_quiet() { [[ -n "$2" ]] && { echo "SELF_TEST_FAIL $1 — 정상 입력에 오탐: $2"; st_fail=1; }; return 0; }

  expect_hit  "detect_exec_capability"        "$(detect_exec_capability "$tmp/bad.py")"
  expect_hit  "detect_write_capability"       "$(detect_write_capability "$tmp/bad.py")"
  expect_hit  "detect_command_key_in_schema"  "$(detect_command_key_in_schema "$tmp/bad.py")"
  expect_hit  "detect_schema_escape"          "$(detect_schema_escape "$tmp/bad.py")"
  expect_hit  "detect_auto_eligible_flip"     "$(detect_auto_eligible_flip "$tmp/bad.py")"
  expect_hit  "detect_third_party_import"     "$(detect_third_party_import "$tmp/bad.py")"
  expect_hit  "detect_missing_injection_defense" "$(detect_missing_injection_defense "$tmp/bad.py")"

  expect_quiet "detect_exec_capability"       "$(detect_exec_capability "$tmp/good.py")"
  expect_quiet "detect_write_capability"      "$(detect_write_capability "$tmp/good.py")"
  expect_quiet "detect_command_key_in_schema" "$(detect_command_key_in_schema "$tmp/good.py")"
  expect_quiet "detect_schema_escape"         "$(detect_schema_escape "$tmp/good.py")"
  expect_quiet "detect_auto_eligible_flip"    "$(detect_auto_eligible_flip "$tmp/good.py")"
  expect_quiet "detect_third_party_import"    "$(detect_third_party_import "$tmp/good.py")"
  expect_quiet "detect_missing_injection_defense" "$(detect_missing_injection_defense "$tmp/good.py")"

  if [[ $st_fail -eq 0 ]]; then
    echo "SELF_TEST_OK (탐지기 7종 — 나쁜 입력 전부 적발 · 정상 입력 오탐 0)"
    exit 0
  fi
  exit 1
fi

[[ -f "$L1_PY" ]]   || { echo "FAIL: $L1_PY 없음 — L1 파이프라인이 실재하지 않는다"; exit 1; }
[[ -f "$L1_TEST" ]] || { echo "FAIL: $L1_TEST 없음 — AC-L1-2·3·4의 기계 검증이 사라졌다"; exit 1; }

fail=0

# ── L1 유닛테스트 ────────────────────────────────────────────────────────────
if out=$(cd "$L1_DIR" && python3 -m unittest test_remediation_l1 2>&1); then
  echo "L1_OK unittest — $(printf '%s\n' "$out" | grep -oE 'Ran [0-9]+ tests' | tail -1)"
else
  printf '%s\n' "$out" | tail -40
  echo "L1_FAIL remediation_l1 유닛테스트 (AC-L1-2·3·4 · 인젝션 · 모델 다운)"
  fail=1
fi

# ── L2 실행 권한 0 ───────────────────────────────────────────────────────────
hits=$(detect_exec_capability "$L1_PY")
if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits" | sed 's/^/   /'
  echo "L2_FAIL 실행 수단이 들어왔다 — L1은 **제안까지만**이다(헌장 §11·§12)"
  fail=1
fi
hits=$(detect_write_capability "$L1_PY")
if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits" | sed 's/^/   /'
  echo "L2_FAIL 상태 변경(파일 쓰기·삭제) 수단이 들어왔다 — 이 모듈은 읽기 전용이다"
  fail=1
fi
[[ $fail -eq 0 ]] && echo "L2_OK 실행·쓰기 수단 0 (프로세스 실행·코드 실행·파일 변경 없음)"

# ── L3 자유형 명령 경로 0 ────────────────────────────────────────────────────
hits=$(detect_command_key_in_schema "$L1_PY")
if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits" | sed 's/^/   /'
  echo "L3_FAIL 허용 키에 명령성 키가 있다 — LLM이 명령을 **짓는** 경로가 열린다(spec §0-2)"
  fail=1
fi
hits=$(detect_schema_escape "$L1_PY")
if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits" | sed 's/^/   /'
  echo "L3_FAIL 파서가 허용 키 밖을 읽는다 — 스키마 제한이 형해화됐다"
  fail=1
else
  echo "L3_OK LLM 산출은 허용 키 5개로 닫혀 있다"
fi

# ── L4 자동 승격 경로 0 ──────────────────────────────────────────────────────
hits=$(detect_auto_eligible_flip "$L1_PY")
if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits" | sed 's/^/   /'
  echo "L4_FAIL auto_eligible 이 True 가 되는 자리가 있다 — 신뢰도는 강등 전용이다(spec §0-3)"
  fail=1
else
  echo "L4_OK auto_eligible 은 False 상수 (자동 승격 경로 없음)"
fi

# ── L5 frontmatter 파서 ≡ PyYAML ─────────────────────────────────────────────
if [[ -d "$RUNBOOKS" ]]; then
  parity=$(python3 - "$L1_DIR" "$RUNBOOKS" <<'PY'
import glob
import os
import re
import sys

sys.path.insert(0, os.path.abspath(sys.argv[1]))
try:
    import yaml
except ImportError:
    print("SKIP PyYAML 없음")
    raise SystemExit(0)
import remediation_l1 as m

bad, seen = [], 0
for path in sorted(glob.glob(os.path.join(sys.argv[2], "*.md"))):
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    block = re.match(r"^---[ \t]*\r?\n(.*?)\r?\n---", text, re.S)
    if not block:
        continue
    seen += 1
    try:
        mine = m.parse_frontmatter(text)
    except m.FrontmatterError as exc:
        bad.append("%s — 미니 파서가 읽지 못한다: %s" % (os.path.basename(path), exc))
        continue
    ref = yaml.safe_load(block.group(1))
    if mine != ref:
        diff = [k for k in set(mine) | set(ref) if mine.get(k) != ref.get(k)]
        bad.append("%s — PyYAML과 다른 키: %s" % (os.path.basename(path), sorted(diff)))
for line in bad:
    print("DIFF " + line)
print("PARITY runbooks=%d diff=%d" % (seen, len(bad)))
PY
)
  rc=$?
  printf '%s\n' "$parity" | sed 's/^/   /'
  if grep -q '^SKIP' <<<"$parity"; then
    echo "L5_WARN PyYAML 부재로 파서 대조를 못 했다 — engine=structural (CI가 정본 판정)"
  elif [[ $rc -ne 0 ]] || grep -q '^DIFF' <<<"$parity"; then
    echo "L5_FAIL frontmatter 미니 파서가 PyYAML과 다르다 — 런북이 조용히 코퍼스에서 빠진다"
    fail=1
  else
    echo "L5_OK 미니 파서 ≡ PyYAML (런북 전편)"
  fi
fi

# ── L6 pip 0 ─────────────────────────────────────────────────────────────────
hits=$(detect_third_party_import "$L1_PY"; detect_third_party_import "$L1_TEST")
if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits" | sed 's/^/   /'
  echo "L6_FAIL stdlib 밖 의존이 들어왔다 — relay와 같은 pip 0 계약을 깬다"
  fail=1
else
  echo "L6_OK stdlib + keiwi_redaction 만 (pip 0)"
fi

# ── L7 인젝션 방어 구조 ──────────────────────────────────────────────────────
missing=$(detect_missing_injection_defense "$L1_PY")
if [[ -n "$missing" ]]; then
  echo "   없어진 것: $missing"
  echo "L7_FAIL 인젝션 방어의 구조가 사라졌다 — 프롬프트 문구가 아니라 구조가 방어다"
  fail=1
else
  echo "L7_OK 데이터 래핑 · 입력 세탁 · 화이트리스트 대조 · 정합 검증기 모두 실재"
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "REMEDIATION_L1_OK (L1~L7)"
  exit 0
fi
echo "REMEDIATION_L1_FAIL"
exit 1

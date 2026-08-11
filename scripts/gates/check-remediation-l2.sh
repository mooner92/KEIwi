#!/usr/bin/env bash
# T2-1·T2-3·T2-5·T2-6·T2-7 — L2 승인 후 실행 게이트 (auto-remediation §3 · ADR-0026)
#
# 무엇을 지키는가:
#   `infra/alert-relay/remediation_l2.py` 는 **이 레포에서 프로덕션 상태를 바꿀 수 있는
#   유일한 파일**이다. 사다리(L0~L4)의 모든 안전 논증이 이 파일의 성질 몇 가지에 얹혀 있고,
#   그 성질은 문서에 적혀 있으면 반드시 낡는다. 이 게이트가 그것을 문법 수준에서 붙든다.
#
#   특히 **유닛테스트와 겹치는 항목이 일부러 있다**(M2·M5·M6). 테스트는 지우면 사라지지만
#   게이트는 CI 잡에서 이름으로 불린다(check-ci-coverage.sh가 미배선을 잡는다). 이 파일의
#   불변식은 "테스트가 지워져도 남아야" 하는 종류다.
#
# 검사 규칙:
#   M1  유닛테스트 — test_remediation_l2.py 전수 통과(AC-L2-1·2·4·5 · 드리프트 · dry-run) FAIL
#   M2  **명령은 인자가 아니다** — CLI에 --command/--cmd/--exec/--shell/--script 가 없고,
#       실행 함수 시그니처에도 command류 파라미터가 없다. 있으면 이 파일은 실행기가
#       아니라 원격 셸이다(spec §0-2)                                                FAIL
#   M3  **dry-run이 기본** — `--apply` 는 store_true 옵트인이고, 실행 함수의 apply
#       기본값이 False 다                                                            FAIL
#   M4  거부 조건 실재 — MIN_TIER≥2 · ALLOWED_RISKS에 high 없음 · reversible/idempotent
#       false 거부 분기가 코드에 있다(주석이 아니라 분기로)                            FAIL
#   M5  **실행 지점 1곳** — subprocess 호출이 파일 전체에 정확히 1회, 그리고 그 1회는
#       `_run_one` 안에 있다. 깔때기가 둘이 되는 순간 감사 경로가 갈라진다             FAIL
#   M6  자동 트리거 0 — 데몬·리스너·타이머·무한루프·스케줄러가 없다. 사람이 치지 않으면
#       실행을 기다리는 프로세스가 없다는 것이 §11 논증의 근거다(ADR-0026 §C1)         FAIL
#   M7  원장 append-only — O_APPEND 로만 쓰고, 원장을 자르거나 지우는 자리가 없다      FAIL
#   M8  파괴 어휘 드리프트 — check-runbook-actions.sh A6이 아는 동사를 L2 런타임도
#       전부 안다(작성 시점 방어와 실행 시점 방어가 갈라지지 않게)                     FAIL
#   M9  pip 0 — stdlib + 같은 디렉터리 remediation_l1/keiwi_redaction 밖을 import 안 한다 FAIL
#
# 못 하는 것(정직하게):
#   · **조치가 옳은지**는 판정하지 않는다. 화이트리스트 안에서의 오선택은 구조로 못 막는다 —
#     그래서 승인 카드가 있고, 사람이 읽는다.
#   · **작정한 우회.** M2·M5·M6은 정적 텍스트/AST 검사다. `getattr(os, "sys"+"tem")` 같은
#     조립은 못 잡는다. 실질 방어는 리뷰이고 이건 그 위의 조기 경보다.
#   · **런타임 권한.** 이 파일이 sudo로 무엇을 할 수 있는지는 노드의 sudoers가 정한다.
#     그 설치는 `[server]` 작업이고 사람 몫이다(§11 · README 참조).
#   · **셸 자체의 위험.** 런북 명령은 파이프·`&&` 를 담으므로 shell=True 다. 그 위험은
#     "명령이 런북 파일에서만 오고 어떤 런타임 값도 보간되지 않는다"로 좁힌 것이지
#     없앤 것이 아니다(remediation_l2.py 상단 고백 참조).
#
# usage:
#   check-remediation-l2.sh              M1~M9
#   check-remediation-l2.sh --self-test  역증명 — 아래 탐지기 **본체**를 일부러 위반한
#                                        픽스처에 태운다(정규식 사본을 따로 두지 않는다)
# exit: 0 통과(WARN 포함) / 1 정책 위반 / 2 환경 부족(SKIP)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

L2_DIR="infra/alert-relay"
L2_PY="$L2_DIR/remediation_l2.py"
L2_TEST="$L2_DIR/test_remediation_l2.py"
A6_GATE="scripts/gates/check-runbook-actions.sh"

command -v python3 >/dev/null 2>&1 || { echo "SKIP(env: python3)" >&2; exit 2; }

# ══════════════════════════════════════════════════════════════════════════════
# 탐지기 — **본체와 --self-test 가 같은 함수를 쓴다.**
# 행번호를 유지한 채 주석만 걷어낸다(필터 후 grep -n 하면 보고가 거짓말을 한다).
# ══════════════════════════════════════════════════════════════════════════════
code_lines() { grep -n '' "$1" | grep -vE '^[0-9]+:[[:space:]]*#'; }

# M2 — 명령을 밖에서 받는 통로. CLI 옵션 · 함수 파라미터 둘 다 본다.
detect_command_intake() {
  python3 - "$1" <<'PY' || true
import ast
import sys

BANNED_OPTS = ("--command", "--cmd", "--exec", "--shell", "--script", "--run")
BANNED_PARAMS = ("command", "cmd", "script", "shell", "argv", "cmdline")
EXEC_FUNCS = ("execute_approved", "approve", "reject", "main")
# `main(argv=None)` 의 argv 는 sys.argv 관례다(remediation_l1.main 과 같은 꼴).
# 여기만 예외로 두지 않으면 게이트가 정상 CLI를 계속 오탐한다.
ALLOWED = {"main": {"argv"}}

src = open(sys.argv[1], encoding="utf-8").read()
tree = ast.parse(src)

for node in ast.walk(tree):
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr == "add_argument"):
        for arg in node.args:
            if isinstance(arg, ast.Constant) and str(arg.value) in BANNED_OPTS:
                print("CLI 옵션 %r 가 있다 (행 %d) — 명령은 인자가 아니다"
                      % (arg.value, node.lineno))
    if isinstance(node, ast.FunctionDef) and node.name in EXEC_FUNCS:
        args = node.args
        names = [a.arg for a in list(args.args) + list(args.kwonlyargs)]
        for bad in BANNED_PARAMS:
            if bad in ALLOWED.get(node.name, ()):
                continue
            if bad in names:
                print("%s() 가 %r 파라미터를 받는다 (행 %d)"
                      % (node.name, bad, node.lineno))
PY
}

# M3 — dry-run 기본. --apply 가 store_true 옵트인이고 apply 기본값이 False 인가.
#   (없어야 할 것이 아니라 **있어야 할 것**을 본다 — 출력이 있으면 FAIL 신호다.)
detect_dryrun_default_broken() {
  python3 - "$1" <<'PY' || true
import ast
import sys

src = open(sys.argv[1], encoding="utf-8").read()
tree = ast.parse(src)

apply_optin = False
for node in ast.walk(tree):
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr == "add_argument"
            and any(isinstance(a, ast.Constant) and a.value == "--apply"
                    for a in node.args)):
        action = None
        default = "absent"
        for kw in node.keywords:
            if kw.arg == "action" and isinstance(kw.value, ast.Constant):
                action = kw.value.value
            if kw.arg == "default" and isinstance(kw.value, ast.Constant):
                default = kw.value.value
        if action == "store_true" and default in ("absent", False, None):
            apply_optin = True
        else:
            print("--apply 가 옵트인이 아니다 (action=%r default=%r)" % (action, default))
if not apply_optin:
    print("--apply 옵트인 플래그가 없다 — dry-run 기본을 보장할 수 없다")

for node in ast.walk(tree):
    if isinstance(node, ast.FunctionDef) and node.name == "execute_approved":
        names = [a.arg for a in node.args.args]
        if "apply" not in names:
            print("execute_approved 에 apply 파라미터가 없다")
            break
        idx = names.index("apply") - (len(names) - len(node.args.defaults))
        if idx < 0:
            print("apply 에 기본값이 없다 — 기본이 dry-run이 아니다")
            break
        default = node.args.defaults[idx]
        if not (isinstance(default, ast.Constant) and default.value is False):
            print("execute_approved(apply=...) 기본값이 False 가 아니다")
        break
PY
}

# M4 — 거부 조건이 **분기로** 실재하는가(없으면 출력 = FAIL 신호).
detect_missing_refusals() {
  local f="$1" missing=""
  grep -qE '^MIN_TIER[[:space:]]*=[[:space:]]*[2-9]' "$f"        || missing+="MIN_TIER≥2 "
  grep -qE '^ALLOWED_RISKS[[:space:]]*=' "$f"                    || missing+="ALLOWED_RISKS "
  grep -qE '^ALLOWED_RISKS[^\n]*"high"' "$f"                     && missing+="ALLOWED_RISKS에_high가_있다 "
  grep -q 'reversible is not True' "$f"                          || missing+="reversible거부분기 "
  grep -q 'idempotent is not True' "$f"                          || missing+="idempotent거부분기 "
  grep -q '"not_approved"' "$f"                                  || missing+="승인없음거부 "
  grep -q '"runbook_drift"' "$f"                                 || missing+="드리프트거부 "
  grep -q '"already_executed"' "$f"                              || missing+="재실행거부 "
  printf '%s' "$missing"
}

# M5 — 실행 지점. 호출 횟수와 위치(어느 함수 안인가)를 함께 본다.
detect_execution_sites() {
  python3 - "$1" <<'PY' || true
import ast
import sys

FUNNEL = "_run_one"
EXEC_ATTRS = ("run", "Popen", "call", "check_call", "check_output")
src = open(sys.argv[1], encoding="utf-8").read()
tree = ast.parse(src)

owner = {}
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        for sub in ast.walk(node):
            owner[id(sub)] = node.name

sites = []
for node in ast.walk(tree):
    if not isinstance(node, ast.Call):
        continue
    func = node.func
    name = None
    if isinstance(func, ast.Attribute):
        base = getattr(func.value, "id", None)
        if base == "subprocess" and func.attr in EXEC_ATTRS:
            name = "subprocess.%s" % func.attr
        elif base == "os" and func.attr in ("system", "popen", "execv", "execve",
                                            "spawnv", "fork", "posix_spawn"):
            name = "os.%s" % func.attr
    elif isinstance(func, ast.Name) and func.id in ("eval", "exec", "compile"):
        name = func.id
    if name:
        sites.append((name, node.lineno, owner.get(id(node), "<module>")))

if len(sites) != 1:
    print("실행 지점이 %d곳이다(1곳이어야 한다): %s"
          % (len(sites), ", ".join("%s@%s:%d" % (n, f, l) for n, l, f in sites)))
elif sites[0][2] != FUNNEL:
    print("유일한 실행 지점이 %s() 밖에 있다: %s@%s:%d"
          % (FUNNEL, sites[0][0], sites[0][2], sites[0][1]))
PY
}

# M6 — 자동 트리거(데몬·리스너·타이머·무한루프). 사람이 개시하지 않는 실행 경로.
detect_auto_trigger() {
  code_lines "$1" | grep -nE \
    -e '(HTTPServer|socketserver|BaseHTTPRequestHandler|serve_forever|\.bind\(|\.listen\()' \
    -e '(threading\.(Thread|Timer)|sched\.scheduler|signal\.setitimer)' \
    -e '(while[[:space:]]+True|while[[:space:]]+1)[[:space:]]*:' \
    -e '(@app\.route|Flask|FastAPI|wsgiref)' \
    | sed 's/^[0-9]*://' || true
}

# M7 — 원장 append-only. 추가 아닌 쓰기·자르기·삭제가 들어왔는가.
detect_ledger_mutation() {
  code_lines "$1" | grep -nE \
    -e 'open\([^)]*,[[:space:]]*["'"'"'](w|x)' \
    -e 'os\.(remove|unlink|truncate|ftruncate|rename|replace)[[:space:]]*\(' \
    -e 'shutil\.(rmtree|move)' \
    -e 'O_TRUNC' \
    | sed 's/^[0-9]*://' || true
}

# M7 — 반대로, **있어야 할** append 보장.
detect_missing_append_guarantee() {
  local f="$1" missing=""
  grep -q 'O_APPEND' "$f" || missing+="O_APPEND "
  grep -q 'os\.fsync' "$f" || missing+="fsync "
  printf '%s' "$missing"
}

# M9 — stdlib 밖 import.
#   fcntl은 stdlib(POSIX 전용)이다. L2가 실행 잠금(flock)에 쓴다 — 같은 proposal_id를
#   동시에 실행하는 TOCTOU를 막는 유일한 수단이고, 이 스택은 Linux 전용이라 이식성 손실이 없다.
detect_third_party_import() {
  code_lines "$1" \
    | grep -E '^[0-9]+:(import|from)[[:space:]]+[A-Za-z_]' \
    | sed -E 's/^[0-9]+:(import|from)[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*/\2/' \
    | sort -u \
    | grep -vxE 'argparse|contextlib|datetime|fcntl|getpass|hashlib|io|json|math|os|re|shutil|socket|subprocess|sys|tempfile|time|unittest|uuid|inspect|typing|collections|ast|threading|http|urllib|remediation_l1|remediation_l2|keiwi_redaction|test_remediation_l1' \
    || true
}

# ── 역증명 ───────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--self-test" ]]; then
  tmp=$(mktemp -d) || exit 2
  trap 'rm -rf "$tmp"' EXIT

  # 나쁜 파일 — M2·M3·M4·M5·M6·M7·M9 위반을 전부 담는다.
  cat > "$tmp/bad.py" <<'BADPY'
import subprocess
import requests
from http.server import HTTPServer
MIN_TIER = 0
ALLOWED_RISKS = ("low", "medium", "high")
def execute_approved(proposal_id, command=None, apply=True):
    subprocess.run(command, shell=True)
    os.system(command)
    with open("/var/log/keiwi/remediation.jsonl", "w") as fh:
        fh.write("원장을 덮어쓴다")
    os.remove("/var/log/keiwi/remediation.jsonl")
def serve():
    while True:
        HTTPServer(("0.0.0.0", 9999), None).serve_forever()
def _build_parser():
    p = argparse.ArgumentParser()
    p.add_argument("--command", default="")
    p.add_argument("--apply", default=True)
    return p
BADPY

  # 좋은 파일 — 정상 형태만. 여기서 울면 오탐이다(정밀도 검사).
  cat > "$tmp/good.py" <<'GOODPY'
import argparse
import os
import subprocess
MIN_TIER = 2
ALLOWED_RISKS = ("low", "medium")
def _run_one(command, timeout):
    return subprocess.run(command, shell=True, timeout=timeout)
def execute_approved(proposal_id, ledger=None, apply=False):
    if not apply:
        return {"mode": "dry-run"}
    return _run_one("echo from-the-runbook", 10)
def check(action):
    if action.reversible is not True:
        return "not_reversible"
    if action.idempotent is not True:
        return "not_idempotent"
    return ("not_approved", "runbook_drift", "already_executed")
def append(line):
    fd = os.open("/tmp/x.jsonl", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.write(fd, line)
    os.fsync(fd)
    os.close(fd)
def _build_parser():
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true")
    return p
GOODPY

  st_fail=0
  expect_hit()   { [[ -z "$2" ]] && { echo "SELF_TEST_FAIL $1 — 나쁜 입력을 못 잡았다"; st_fail=1; }; return 0; }
  expect_quiet() { [[ -n "$2" ]] && { echo "SELF_TEST_FAIL $1 — 정상 입력에 오탐: $2"; st_fail=1; }; return 0; }

  expect_hit  "detect_command_intake"          "$(detect_command_intake "$tmp/bad.py")"
  expect_hit  "detect_dryrun_default_broken"   "$(detect_dryrun_default_broken "$tmp/bad.py")"
  expect_hit  "detect_missing_refusals"        "$(detect_missing_refusals "$tmp/bad.py")"
  expect_hit  "detect_execution_sites"         "$(detect_execution_sites "$tmp/bad.py")"
  expect_hit  "detect_auto_trigger"            "$(detect_auto_trigger "$tmp/bad.py")"
  expect_hit  "detect_ledger_mutation"         "$(detect_ledger_mutation "$tmp/bad.py")"
  expect_hit  "detect_missing_append_guarantee" "$(detect_missing_append_guarantee "$tmp/bad.py")"
  expect_hit  "detect_third_party_import"      "$(detect_third_party_import "$tmp/bad.py")"

  expect_quiet "detect_command_intake"          "$(detect_command_intake "$tmp/good.py")"
  expect_quiet "detect_dryrun_default_broken"   "$(detect_dryrun_default_broken "$tmp/good.py")"
  expect_quiet "detect_missing_refusals"        "$(detect_missing_refusals "$tmp/good.py")"
  expect_quiet "detect_execution_sites"         "$(detect_execution_sites "$tmp/good.py")"
  expect_quiet "detect_auto_trigger"            "$(detect_auto_trigger "$tmp/good.py")"
  expect_quiet "detect_ledger_mutation"         "$(detect_ledger_mutation "$tmp/good.py")"
  expect_quiet "detect_missing_append_guarantee" "$(detect_missing_append_guarantee "$tmp/good.py")"
  expect_quiet "detect_third_party_import"      "$(detect_third_party_import "$tmp/good.py")"

  if [[ $st_fail -eq 0 ]]; then
    echo "SELF_TEST_OK (탐지기 8종 — 나쁜 입력 전부 적발 · 정상 입력 오탐 0)"
    exit 0
  fi
  exit 1
fi

[[ -f "$L2_PY" ]]   || { echo "FAIL: $L2_PY 없음 — L2 실행기가 실재하지 않는다"; exit 1; }
[[ -f "$L2_TEST" ]] || { echo "FAIL: $L2_TEST 없음 — AC-L2-1·2·4·5의 기계 검증이 사라졌다"; exit 1; }

fail=0

# ── M1 유닛테스트 ────────────────────────────────────────────────────────────
if out=$(cd "$L2_DIR" && python3 -m unittest test_remediation_l2 2>&1); then
  echo "M1_OK unittest — $(printf '%s\n' "$out" | grep -oE 'Ran [0-9]+ tests' | tail -1)"
else
  printf '%s\n' "$out" | tail -40
  echo "M1_FAIL remediation_l2 유닛테스트 (승인·드리프트·dry-run·원장·반출)"
  fail=1
fi

# ── M2 명령은 인자가 아니다 ──────────────────────────────────────────────────
hits=$(detect_command_intake "$L2_PY")
if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits" | sed 's/^/   /'
  echo "M2_FAIL 명령을 밖에서 받는 통로가 생겼다 — 실행기가 원격 셸이 된다(spec §0-2)"
  fail=1
else
  echo "M2_OK 명령의 유일한 출처는 런북 파일이다(CLI·시그니처 모두 깨끗)"
fi

# ── M3 dry-run 기본 ──────────────────────────────────────────────────────────
hits=$(detect_dryrun_default_broken "$L2_PY")
if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits" | sed 's/^/   /'
  echo "M3_FAIL 기본 경로가 dry-run이 아니다 — 실수 한 번이 라이브 변경이 된다"
  fail=1
else
  echo "M3_OK --apply 는 명시적 옵트인, 기본은 dry-run"
fi

# ── M4 거부 조건 ─────────────────────────────────────────────────────────────
missing=$(detect_missing_refusals "$L2_PY")
if [[ -n "$missing" ]]; then
  echo "   없어진 것: $missing"
  echo "M4_FAIL 거부 조건이 사라졌다 — tier·risk·가역·멱등·승인·드리프트는 fail-closed다"
  fail=1
else
  echo "M4_OK 거부 조건 실재(tier≥2 · risk high 제외 · 가역 · 멱등 · 승인 · 드리프트 · 재실행)"
fi

# ── M5 실행 지점 1곳 ─────────────────────────────────────────────────────────
hits=$(detect_execution_sites "$L2_PY")
if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits" | sed 's/^/   /'
  echo "M5_FAIL 실행 깔때기가 하나가 아니다 — 감사 경로가 갈라진다"
  fail=1
else
  echo "M5_OK 실행 지점은 _run_one() 안의 subprocess.run 하나뿐"
fi

# ── M6 자동 트리거 0 ─────────────────────────────────────────────────────────
hits=$(detect_auto_trigger "$L2_PY")
if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits" | sed 's/^/   /'
  echo "M6_FAIL 자동 트리거(데몬·리스너·타이머·무한루프)가 들어왔다 — 그건 L3다(ADR-0027)"
  fail=1
else
  echo "M6_OK 데몬 0 · 리스너 0 · 타이머 0 (사람이 치지 않으면 아무것도 기다리지 않는다)"
fi

# ── M7 원장 append-only ──────────────────────────────────────────────────────
hits=$(detect_ledger_mutation "$L2_PY")
missing=$(detect_missing_append_guarantee "$L2_PY")
if [[ -n "$hits" || -n "$missing" ]]; then
  [[ -n "$hits" ]] && printf '%s\n' "$hits" | sed 's/^/   /'
  [[ -n "$missing" ]] && echo "   없어진 것: $missing"
  echo "M7_FAIL 감사 원장이 append-only가 아니다 — 고쳐 쓸 수 있는 원장은 원장이 아니다"
  fail=1
else
  echo "M7_OK 원장은 O_APPEND + fsync 로만 자란다(자르기·삭제 수단 없음)"
fi

# ── M8 파괴 어휘 드리프트 ────────────────────────────────────────────────────
if [[ -f "$A6_GATE" ]]; then
  drift=$(python3 - "$A6_GATE" "$L2_PY" <<'PY'
import re
import sys

gate = open(sys.argv[1], encoding="utf-8").read()
l2 = open(sys.argv[2], encoding="utf-8").read()

m = re.search(r'r"\(\?:\^\|\[\\s;\|&/\]\)\(\?:([^)]+)\)', gate)
if not m:
    print("A6 어휘를 못 읽었다 — check-runbook-actions.sh 형식이 바뀌었다")
    raise SystemExit(0)
# 파이썬 인접 문자열 이어쓰기(`"` 개행 `r"`)를 지운 뒤에야 어휘 목록이 된다.
vocab = [v for v in re.sub(r'"\s*r"', "", m.group(1)).split("|") if v]

m2 = re.search(r"DESTRUCTIVE_VERBS\s*=\s*\((.*?)\)", l2, re.S)
if not m2:
    print("remediation_l2.DESTRUCTIVE_VERBS 를 못 읽었다")
    raise SystemExit(0)
known = set(re.findall(r'"([a-z_]+)"', m2.group(1)))
gap = [v for v in vocab if v not in known]
if gap:
    print("A6이 아는 파괴 동사를 L2 런타임이 모른다: %s" % ", ".join(gap))
else:
    print("VOCAB a6=%d l2=%d gap=0" % (len(vocab), len(known)))
PY
)
  printf '%s\n' "$drift" | sed 's/^/   /'
  if grep -q '^VOCAB' <<<"$drift"; then
    echo "M8_OK 파괴 어휘 A6 ⊆ L2 (작성 시점 방어와 실행 시점 방어가 같은 것을 안다)"
  else
    echo "M8_FAIL 파괴 어휘가 갈라졌다 — 한쪽만 고쳐진 미래가 시작됐다"
    fail=1
  fi
fi

# ── M9 pip 0 ─────────────────────────────────────────────────────────────────
hits=$(detect_third_party_import "$L2_PY"; detect_third_party_import "$L2_TEST")
if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits" | sed 's/^/   /'
  echo "M9_FAIL stdlib 밖 의존이 들어왔다 — relay와 같은 pip 0 계약을 깬다"
  fail=1
else
  echo "M9_OK stdlib + remediation_l1 만 (pip 0)"
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "REMEDIATION_L2_OK (M1~M9)"
  exit 0
fi
echo "REMEDIATION_L2_FAIL"
exit 1

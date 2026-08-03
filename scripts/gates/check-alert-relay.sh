#!/usr/bin/env bash
# T-E3-1·T-E3-4 — alert-relay 게이트 (specs/alert-enrichment §3)
#
# 무엇을 잡나 (6가지, 전부 우리가 실제로 겪을 수 있는 실패다):
#   P1 유닛테스트   infra/alert-relay/test_alert_relay.py 전수 통과.
#                   AC-E3-1(웹훅→게시 1회+200) · AC-E3-3(스레드 연속성) ·
#                   AC-E3-4(직렬화·유실 0·429 재시도) · AC-E3-7(근거번호·원문 미포함) +
#                   2026-08-04 재현 테스트(저장 실패 도배 · redaction 구멍 4종)가 전부 여기 있다.
#                   mock Slack·mock 어시스턴트는 로컬 http.server라 **외부 통신 0**이다.
#   P2 프리셋 정합   콘솔 alert-presets.ts와 relay PRESET_QUESTIONS의 **키 집합 동일**.
#                   딥링크로 도착한 사람(E2)과 스레드 답글(E3)이 다른 질문을 받으면
#                   같은 사건에 두 개의 답이 생긴다. 문서 규약으로는 못 막는다.
#   P3 반출 단일경로 Slack API 호출 지점이 1곳이고, `slack.post` 라는 토큰이 나오는 자리는
#                   **전부** `slack.post(build_slack_payload(` 형태다. 호출이든 별칭이든.
#   P4 raw 미참조    수집기 JSON의 로컬 전용 필드 `raw` 를 코드가 **읽지 않는다**.
#                   문자열 리터럴 `"raw"` 자체도 LOCAL_ONLY_FIELDS 정의 밖에서는 금지한다
#                   (변수 키 우회 `_k = "raw"` 를 막는다).
#   P5 pip 0         relay가 stdlib + 같은 레포의 keiwi_redaction 밖을 import 하지 않는다.
#   P6 방어 공유     relay가 E4와 **같은** redaction 객체를 쓴다(사본 금지) + 실증 4종 +
#                    변이 검사(문지기를 빼면 실제로 새는가).
#
# 이 게이트가 **못** 잡는 것 (정직하게 — 과장하지 않는다):
#   · 실제 Slack API 계약 변경. mock은 우리가 아는 계약만 흉내낸다.
#   · Grafana webhook payload 스키마 변경. 픽스처는 2026-08 시점의 형태다.
#   · HMAC 서명 대상 문자열([검증 필요] — verify_signature 주석 참조). 섀도에서 실측한다.
#   · 배포 상태(systemd·env·방화벽). `[server]` 태스크(T-E3-6)가 판정한다.
#   · **P3/P4는 정적 텍스트 검사다.** 다음은 여전히 통과한다 —
#       - 계산된 이름: `getattr(self.app, "sl"+"ack").post(...)` · `key = "r"+"aw"`
#       - urllib 로 chat.postMessage 를 **직접** 부르는 완전 우회(엔드포인트 문자열을 조립)
#       - 다른 모듈 파일을 새로 만들어 거기서 게시(이 게이트는 alert_relay.py 만 본다)
#     즉 P3/P4는 "실수"를 막지 "작정한 우회"를 막지 못한다. 작정한 우회에 대한 실질 방어는
#     ① 게시 직전 하드 거부(P6·keiwi_redaction.assert_no_leak) ② drop_local_only_fields 가
#     경계에서 raw 를 지운 **사본**만 넘긴다는 구조 ③ 유닛테스트의 런타임 실증 —
#     즉 **정적 검사가 아니라 런타임 불변**이다. P3/P4는 그 위에 얹은 조기 경보다.
#
# usage:
#   check-alert-relay.sh              P1~P6
#   check-alert-relay.sh --self-test  역증명 — **아래 탐지기 함수 본체를** 일부러 깨진
#                                     입력에 태운다(정규식 사본을 따로 두지 않는다).
# exit: 0 통과 / 1 위반 / 2 환경 부족(python3 부재)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

RELAY_DIR="infra/alert-relay"
RELAY_PY="$RELAY_DIR/alert_relay.py"
SHARED_PY="$RELAY_DIR/keiwi_redaction.py"
EXPORT_PY="scripts/collectors/attribution_export.py"
PRESETS_TS="apps/console/src/lib/alert-presets.ts"

command -v python3 >/dev/null 2>&1 || { echo "SKIP(env: python3)" >&2; exit 2; }

# ══════════════════════════════════════════════════════════════════════════════
# 탐지기 — **본체와 --self-test 가 같은 함수를 쓴다.**
#
# ⚠️ 이전 판(2026-08-03)의 --self-test 는 게이트 본문과 **별개의 정규식 사본**을 돌렸다.
#    본체의 정규식을 망가뜨려도 self-test 는 초록으로 남는 자기참조 결함이었다
#    [2026-08-04 적대적 검증에서 실증]. 지금은 판정하는 코드가 아래 함수들뿐이다.
#
# 주석 제외는 `grep -n '' file` 로 **실제 행번호를 유지한 채** 한다 — 필터 후 grep -n 을
# 하면 행번호가 어긋나 보고가 거짓말을 한다.
# ══════════════════════════════════════════════════════════════════════════════
code_lines() { grep -n '' "$1" | grep -vE '^[0-9]+:[[:space:]]*#'; }

# Slack API 엔드포인트 **리터럴**의 등장 횟수. 따옴표+슬래시를 함께 요구해 산문의
# `chat.postMessage` 언급과 구별한다(설명 문장 자신이 히트가 되는 자기참조를 피한다).
detect_api_endpoint_hits() { code_lines "$1" | grep -cE '"/chat\.postMessage"'; }

# `slack.post` 토큰이 나오는데 `slack.post(build_slack_payload(` 가 아닌 자리.
# 직접 호출뿐 아니라 **별칭 생성**(`_post = slack.post`)도 여기 걸린다 — 별칭 한 줄로
# 뚫리던 구멍이 이것이다.
detect_unwrapped_post() {
  code_lines "$1" | grep -E '\bslack\.post\b' | grep -vE '\bslack\.post\(build_slack_payload\(' || true
}

# 이름을 문자열로 우회하는 간접 접근.
detect_post_indirection() {
  code_lines "$1" | grep -nE "getattr\([^)]*['\"]post['\"]" | sed 's/^[0-9]*://' || true
}

# 로컬 전용 필드 `raw` 의 역참조.
detect_raw_deref() {
  code_lines "$1" | grep -E "(\[|\.get\()['\"]raw['\"]|\.raw\b" || true
}

# `"raw"` 리터럴은 LOCAL_ONLY_FIELDS 정의 한 줄에만 허용한다.
# (`_k = "raw"` → `entry[_k]` 로 P4를 우회하던 경로를 막는다.)
detect_raw_literal() {
  code_lines "$1" | grep -E "['\"]raw['\"]" \
    | grep -vE '^[0-9]+:LOCAL_ONLY_FIELDS[[:space:]]*=' || true
}

# relay 가 세탁 규칙 **사본**을 다시 들이지 않았는가(공유가 깨졌다는 첫 신호).
detect_redaction_copy() {
  code_lines "$1" | grep -E '^[0-9]+:[[:space:]]*(HARD_DENY|ALLOWED_URL_HOSTS)[[:space:]]*=' || true
}

# ── 역증명 ───────────────────────────────────────────────────────────────────
# 위 함수들을 **그대로** 태운다. 하나라도 침묵하면 게이트가 죽은 것이다.
if [[ "${1:-}" == "--self-test" ]]; then
  tmp=$(mktemp -d) || exit 2
  trap 'rm -rf "$tmp"' EXIT

  # 나쁜 파일 — 알려진 우회 4종을 전부 담는다.
  cat > "$tmp/bad.py" <<'BADPY'
HARD_DENY = (("copy", "사본을 다시 들였다"),)
_post = slack.post                      # 별칭 우회 (이전 판이 못 잡던 것)
_k = "raw"                              # 변수 키 우회 (이전 판이 못 잡던 것)
_g = getattr(client, "post")            # 문자열 간접 접근
API = "/chat.postMessage"
API2 = "/chat.postMessage"              # 엔드포인트가 두 곳
def leak(entry, slack, channel):
    slack.post({"channel": channel, "text": entry["raw"]})
    return entry[_k]
BADPY

  # 좋은 파일 — 정상 형태만. 탐지기가 여기서 울면 오탐이다(정밀도 검사).
  cat > "$tmp/good.py" <<'GOODPY'
LOCAL_ONLY_FIELDS = ("raw",)
API = "/chat.postMessage"
def ok(text, slack, channel):
    # slack.post 를 설명하는 주석과 "raw" 문자열 — 주석은 판정 대상이 아니다
    slack.post(build_slack_payload(channel, text))
GOODPY

  st_fail=0
  expect_hit() {  # 이름 / 출력
    if [[ -z "$2" ]]; then echo "SELF_TEST_FAIL $1 — 나쁜 입력을 못 잡았다"; st_fail=1; fi
  }
  expect_quiet() {
    if [[ -n "$2" ]]; then echo "SELF_TEST_FAIL $1 — 정상 입력에 오탐: $2"; st_fail=1; fi
  }

  expect_hit  "detect_unwrapped_post(별칭)"   "$(detect_unwrapped_post "$tmp/bad.py")"
  expect_hit  "detect_post_indirection"        "$(detect_post_indirection "$tmp/bad.py")"
  expect_hit  "detect_raw_deref"               "$(detect_raw_deref "$tmp/bad.py")"
  expect_hit  "detect_raw_literal(변수 키)"    "$(detect_raw_literal "$tmp/bad.py")"
  expect_hit  "detect_redaction_copy"          "$(detect_redaction_copy "$tmp/bad.py")"
  expect_quiet "detect_unwrapped_post"         "$(detect_unwrapped_post "$tmp/good.py")"
  expect_quiet "detect_post_indirection"       "$(detect_post_indirection "$tmp/good.py")"
  expect_quiet "detect_raw_deref"              "$(detect_raw_deref "$tmp/good.py")"
  expect_quiet "detect_raw_literal"            "$(detect_raw_literal "$tmp/good.py")"
  expect_quiet "detect_redaction_copy"         "$(detect_redaction_copy "$tmp/good.py")"

  bad_api=$(detect_api_endpoint_hits "$tmp/bad.py")
  good_api=$(detect_api_endpoint_hits "$tmp/good.py")
  if [[ "$bad_api" -ne 2 || "$good_api" -ne 1 ]]; then
    echo "SELF_TEST_FAIL detect_api_endpoint_hits — bad=$bad_api(기대 2) good=$good_api(기대 1)"
    st_fail=1
  fi

  if [[ $st_fail -eq 0 ]]; then
    echo "SELF_TEST_OK (탐지기 6종 — 나쁜 입력 전부 적발 · 정상 입력 오탐 0)"
    exit 0
  fi
  exit 1
fi

[[ -f "$RELAY_PY" ]] || { echo "FAIL: $RELAY_PY 없음"; exit 1; }
[[ -f "$SHARED_PY" ]] || { echo "FAIL: $SHARED_PY 없음 — 공유 redaction 모듈이 사라졌다"; exit 1; }

fail=0

# ── P1 유닛테스트 ────────────────────────────────────────────────────────────
if out=$(cd "$RELAY_DIR" && python3 -m unittest test_alert_relay 2>&1); then
  echo "P1_OK unittest — $(printf '%s\n' "$out" | grep -oE 'Ran [0-9]+ tests' | tail -1)"
else
  printf '%s\n' "$out" | tail -40
  echo "P1_FAIL alert-relay 유닛테스트 (AC-E3-1·3·4·7 + 2026-08-04 재현분)"
  fail=1
fi

# ── P2 프리셋 질문 키 정합 (콘솔 ↔ relay) ────────────────────────────────────
if [[ -f "$PRESETS_TS" ]]; then
  if ! python3 - "$PRESETS_TS" "$RELAY_PY" <<'PY'
import re
import sys

ts_path, py_path = sys.argv[1], sys.argv[2]
ts = open(ts_path, encoding="utf-8").read()
py = open(py_path, encoding="utf-8").read()

ts_block = re.search(r"const PRESET_QUESTIONS[^=]*=\s*\{(.*?)\n\};", ts, re.S)
py_block = re.search(r"\nPRESET_QUESTIONS = \{(.*?)\n\}", py, re.S)
if not ts_block or not py_block:
    print("P2_FAIL 프리셋 테이블 블록을 찾지 못했다(구조가 바뀌었으면 게이트도 고쳐라)")
    sys.exit(1)

ts_keys = set(re.findall(r"^  ([A-Za-z][A-Za-z0-9_]*):", ts_block.group(1), re.M))
py_keys = set(re.findall(r'^    "([A-Za-z][A-Za-z0-9_]*)":', py_block.group(1), re.M))
only_ts = sorted(ts_keys - py_keys)
only_py = sorted(py_keys - ts_keys)
if only_ts or only_py:
    print("P2_FAIL 프리셋 키 불일치 — 콘솔에만: %s / relay에만: %s" % (only_ts, only_py))
    sys.exit(1)
print("P2_OK 프리셋 %d종 일치 (콘솔 ↔ relay)" % len(ts_keys))
PY
  then
    fail=1
  fi
else
  echo "P2_SKIP $PRESETS_TS 없음(콘솔 미체크아웃)"
fi

# ── P3 Slack 반출 단일 경로 ──────────────────────────────────────────────────
api_hits=$(detect_api_endpoint_hits "$RELAY_PY")
unwrapped=$(detect_unwrapped_post "$RELAY_PY")
indirect=$(detect_post_indirection "$RELAY_PY")
if [[ "$api_hits" -ne 1 ]]; then
  echo "P3_FAIL chat.postMessage 리터럴이 ${api_hits}곳 — 반출은 SlackClient.post 한 곳이어야 한다"
  fail=1
elif [[ -n "$unwrapped" || -n "$indirect" ]]; then
  printf '%s\n' "$unwrapped" "$indirect" | grep -v '^$' | sed 's/^/  /'
  echo "P3_FAIL slack.post 가 build_slack_payload( 를 거치지 않는 자리가 있다 — redaction 우회 경로"
  fail=1
else
  echo "P3_OK 반출 단일 경로 (엔드포인트 1곳 · slack.post 는 전부 build_slack_payload 경유 · 별칭 0)"
fi

# ── P4 raw 미참조 ────────────────────────────────────────────────────────────
raw_refs=$(detect_raw_deref "$RELAY_PY")
raw_lits=$(detect_raw_literal "$RELAY_PY")
if [[ -n "$raw_refs" || -n "$raw_lits" ]]; then
  printf '%s\n' "$raw_refs" "$raw_lits" | grep -v '^$' | sed 's/^/  /'
  echo "P4_FAIL 로컬 전용 필드 raw 를 코드가 읽거나 이름을 들고 있다 (spec §4.1-2 · AC-E4-6)"
  fail=1
else
  echo "P4_OK raw 미참조 (drop_local_only_fields 가 경계에서 제거 · 리터럴은 정의 1줄뿐)"
fi

# ── P5 stdlib(+공유 모듈) 전용 ───────────────────────────────────────────────
if ! python3 - "$RELAY_PY" <<'PY'
import re
import sys
import sysconfig

# 같은 레포에서 함께 배포되는 자체 모듈. pip 의존성이 아니다(spec §3.3 계약 유지).
LOCAL_MODULES = {"alert_relay", "keiwi_redaction"}

path = sys.argv[1]
src = open(path, encoding="utf-8").read()
mods = set()
for line in src.split("\n"):
    m = re.match(r"^(?:import|from)\s+([A-Za-z_][A-Za-z0-9_.]*)", line.strip())
    if m:
        mods.add(m.group(1).split(".")[0])
stdlib = set(getattr(sys, "stdlib_module_names", ()))
if not stdlib:  # python3.9 이하 폴백 — 표준 라이브러리 디렉터리로 판정
    _ = sysconfig.get_paths()["stdlib"]
    print("P5_SKIP sys.stdlib_module_names 없음(python<3.10)")
    sys.exit(0)
outside = sorted(m for m in mods if m not in stdlib and m not in LOCAL_MODULES)
if outside:
    print("P5_FAIL stdlib 밖 import: %s — relay는 pip 의존성 0개다(spec §3.3)" % outside)
    sys.exit(1)
print("P5_OK stdlib + 자체 모듈 전용 (%d개)" % len(mods))
PY
then
  fail=1
fi

# ── P6 방어 공유 + 런타임 실증 + 변이 검사 ───────────────────────────────────
# E4(attribution_export)와 E3(relay)가 **같은 위협**을 막는다. 방어가 두 벌이면 한쪽만
# 고쳐지고 그 비대칭이 사고다 — 그래서 "같은 객체를 쓰는가"를 기계로 본다.
copies=$(detect_redaction_copy "$RELAY_PY")
if [[ -n "$copies" ]]; then
  printf '%s\n' "$copies" | sed 's/^/  /'
  echo "P6_FAIL relay 가 세탁 규칙 사본을 들고 있다 — 공유(keiwi_redaction)로 되돌려라"
  fail=1
fi
if ! python3 - "$RELAY_DIR" "$EXPORT_PY" <<'PY'
import importlib.util
import os
import shutil
import sys
import tempfile

relay_dir, export_py = sys.argv[1], sys.argv[2]
sys.path.insert(0, relay_dir)
sys.path.insert(0, os.path.dirname(export_py))
import alert_relay as ar
import keiwi_redaction as kr

problems = []

# ① 같은 객체인가 — relay·E4·공유 모듈 3자가 하나여야 한다.
if ar.keiwi_redaction is not kr:
    problems.append("relay 가 다른 keiwi_redaction 을 본다")
if os.path.isfile(export_py):
    import attribution_export as export
    for name in ("HARD_DENY", "redact_text", "assert_no_leak"):
        if getattr(export, name) is not getattr(kr, name):
            problems.append("E4 export.%s 가 공유 객체가 아니다(사본 부활)" % name)
else:
    print("  P6 note: %s 없음 — E4 쪽 공유 검사는 건너뛴다" % export_py)

# ② 런타임 실증 — 2026-08-04 에 relay 를 통과했던 4종이 이제 막히는가.
PROBES = [
    ("URL stash 우회",
     "http://attacker.invalid/exfil?p=/home/user2/patient-data/x.csv",
     ("attacker.invalid", "/home/user2", "patient-data")),
    ("URL 안 COMMAND",
     "https://evil.test/?q=COMMAND=/usr/bin/pip%20install",
     ("evil.test", "COMMAND=")),
    ("~/ 홈 경로", "~/patient-data/2026/x.csv", ("patient-data",)),
    ("허용목록 밖 절대경로", "/var/log/private/user2/session.log", ("/var/log/private",)),
    ("허용목록 밖 절대경로2", "/scratch/user2/tmp/x.bin", ("/scratch/user2",)),
    ("허용목록 밖 절대경로3", "/nfs/home/user2/secret/x", ("/nfs/home",)),
]
for label, probe, forbidden in PROBES:
    out = ar.redact(probe)
    for token in forbidden:
        if token in out:
            problems.append("%s — %r 가 그대로 통과: %r" % (label, token, out))

# ③ 반출 상한 **안**은 살아 있어야 한다(과잉 차단도 결함이다).
if "/home" not in ar.redact("/home 303G"):
    problems.append("마운트 표기(/home)가 사라졌다 — 답글이 쓸모없어진다")
keep = "http://192.168.1.105:3106/incidents?alert=DiskUsageHigh&mount=/&from=now-6h"
if keep not in ar.redact("상세 → <%s|콘솔>" % keep):
    problems.append("허용 딥링크가 삭제됐다 — 보강의 핵심이 사라진다")

# ④ 하드 거부가 게시를 실제로 멈추는가.
try:
    ar.build_slack_payload("#c", "잔여 /root/ 경로")
    problems.append("하드 거부가 게시를 멈추지 않았다")
except kr.RedactionError:
    pass
# 1차 전달은 삼키지 않는다(폴백).
if ar.build_slack_payload("#c", "잔여 /root/ 경로",
                          allow_fallback=True)["text"] != ar.LEAK_FALLBACK_TEXT:
    problems.append("1차 전달 폴백이 동작하지 않는다 — 알림을 잃는다")

# ⑤ 변이 검사 — redact() 를 무력화한 사본에서는 **실제로** 새야 한다.
#    (안 새면 위 ②는 "원래 안 새는 입력"을 넣은 무의미한 검사일 수 있다.)
tmp = tempfile.mkdtemp(prefix="keiwi-relay-mutate-")
try:
    shutil.copy(os.path.join(relay_dir, "keiwi_redaction.py"), tmp)
    src = open(os.path.join(relay_dir, "alert_relay.py"), encoding="utf-8").read()
    needle = "return keiwi_redaction.redact_text(text, on_link_drop=_warn_link_dropped)"
    if needle not in src:
        problems.append("변이 검사 실패 — redact() 의 위임 지점을 찾지 못했다(게이트가 헛돈다)")
    mutated = src.replace(needle, "return str(text)")
    open(os.path.join(tmp, "alert_relay.py"), "w", encoding="utf-8").write(mutated)
    spec = importlib.util.spec_from_file_location(
        "alert_relay_mutant", os.path.join(tmp, "alert_relay.py"))
    mut = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mut)
    leaked = mut.redact("http://attacker.invalid/exfil?p=/home/user2/patient-data/x.csv")
    if "attacker.invalid" not in leaked or "/home/user2" not in leaked:
        problems.append("변이본이 누출되지 않았다 — 실증 ②가 헛돌고 있을 수 있다")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

if problems:
    for p in problems:
        print("  P6_FAIL %s" % p)
    sys.exit(1)
print("  P6_OK 방어 공유(relay ≡ E4 ≡ keiwi_redaction) · 실증 6종 차단 · 상한 보존 · 변이 검사")
PY
then
  fail=1
fi

if [[ $fail -eq 0 ]]; then
  echo "ALERT_RELAY_OK"
else
  echo "ALERT_RELAY_FAIL — specs/alert-enrichment §3 계약 위반"
fi
exit "$fail"

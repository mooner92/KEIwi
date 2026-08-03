#!/usr/bin/env bash
# AC-E4-3 · AC-E4-6 — 귀속 반출 redaction 게이트 (specs/alert-enrichment §4.1)
#
# 지키려는 불변(§4.1-1·2):
#   "원문 명령어·전체 파일 경로는 Slack에 나가지 않는다. 원문은 data05 로컬에만."
#   나가도 되는 것: 계정명 · 시각 · 크기 델타 · 카테고리 · 로컬 LLM의 '~로 보인다' 요약.
#
# 어떻게 지키나 — 검사 5종:
#   R1 반출 경로 단일성   : attribution_export.build_slack_text 밖에 Slack 문자열 조립이 없다.
#                           export 모듈은 attribution_lib 를 import 하지 않는다(단방향).
#   R2 raw 미참조         : 반출 모듈에 `raw` 역참조(["raw"]·.get("raw")·.raw)가 0건.
#   R3 마지막 문지기      : build_slack_text 가 assert_no_leak() 를 통과한 값만 반환한다.
#                           lib 의 slack 분기는 public_view() 를 거쳐서만 export 를 부른다.
#   R4 런타임 실증        : 원문(전체 경로 + COMMAND=)이 든 **실제 사건 픽스처**를 빌더에
#                           통과시켜 하드 규칙 위반 0건. LLM 출력 경로 포함(이중 게이트).
#   R5 역증명 + 변이 검사 : ① 하드 규칙이 정말 잡는가 ② assert_no_leak 을 제거한 사본에서는
#                           **실제로 누출이 발생**하는가. ②가 없으면 R4는 "원래 안 새는 입력을
#                           넣고 초록"인 무의미한 검사일 수 있다.
#
# 이 게이트가 **못** 잡는 것(정직하게):
#   · 계정명 반출 자체. 그건 이 기능의 존재 이유라 §4.1이 상한으로 허용한 것이다.
#   · 카테고리+용량 조합으로 하는 역추론. 경로를 안 주므로 확정은 못 하지만 0은 아니다.
#   · 아직 없는 alert-relay(E3)가 나중에 자기 문자열을 직접 조립하는 경우 —
#     R1의 화이트리스트에 relay 파일이 추가되는 순간 이 게이트를 함께 고쳐야 한다.
#   · Slack 채널의 접근 통제. 운영자 전용 채널이라는 전제 위에 있다.
#
# exit: 0 통과 / 1 위반 / 2 환경 부족(python3 부재)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

command -v python3 >/dev/null 2>&1 || { echo "SKIP(env: python3)" >&2; exit 2; }

DIR="scripts/collectors"
EXPORT="$DIR/attribution_export.py"
LIB="$DIR/attribution_lib.py"
FIXTURE="$DIR/fixtures/incident-2026-08-03-data04.raw"
rc=0
fail() { echo "  FAIL $*" >&2; rc=1; }

for f in "$EXPORT" "$LIB" "$FIXTURE"; do
  [[ -f "$f" ]] || { fail "$f 없음 — 검사 대상이 실재하지 않는다"; }
done
[[ $rc -eq 0 ]] || { echo "ATTRIBUTION_REDACTION_FAIL"; exit 1; }

# ── R1 반출 경로 단일성 ───────────────────────────────────────────────────────
callers="$(grep -rln 'build_slack_text' --include='*.py' --include='*.sh' . \
  | grep -v '/node_modules/' | sort)"
# 이 게이트 자신도 함수명을 문자열로 담는다 — 자기참조로 red 가 되면 자기모순이다
# (check-alerting-escapes.sh 의 주석 제외와 같은 이유).
allowed=$'./scripts/collectors/attribution_export.py\n./scripts/collectors/attribution_lib.py\n./scripts/collectors/test_attribution.py\n./scripts/gates/check-attribution-redaction.sh'
unexpected="$(comm -23 <(printf '%s\n' "$callers") <(printf '%s\n' "$allowed"))"
if [[ -n "$unexpected" ]]; then
  fail "build_slack_text 호출자가 화이트리스트 밖에 있다 — 반출 경로가 갈라졌다:"
  printf '%s\n' "$unexpected" | sed 's/^/    /' >&2
fi
if grep -nE '^[[:space:]]*(import|from)[[:space:]]+attribution_lib' "$EXPORT"; then
  fail "$EXPORT 가 attribution_lib 를 import 한다 — 의존은 lib→export 단방향이어야 한다"
fi

# ── R2 raw 미참조 ────────────────────────────────────────────────────────────
raw_deref="$(grep -nE '\["raw"\]|\['"'"'raw'"'"'\]|\.get\((["'"'"'])raw\1|\.raw\b' "$EXPORT" || true)"
if [[ -n "$raw_deref" ]]; then
  fail "$EXPORT 가 로컬 전용 필드 raw 를 역참조한다:"
  printf '%s\n' "$raw_deref" | sed 's/^/    /' >&2
fi

# ── R3 마지막 문지기 ─────────────────────────────────────────────────────────
grep -q 'return assert_no_leak(' "$EXPORT" \
  || fail "$EXPORT — build_slack_text 가 assert_no_leak() 를 통과시키지 않는다"
grep -q 'build_slack_text(public_view(report)' "$LIB" \
  || fail "$LIB — slack 분기가 public_view() 를 거치지 않는다"
grep -q 'redact_text(intent_summary)' "$EXPORT" \
  || fail "$EXPORT — LLM 요약에 redaction 이 재적용되지 않는다(이중 게이트 파손)"

# ── R4 런타임 실증 (유닛 테스트 = 실제 사건 원문 통과) ──────────────────────
if ! out="$(python3 "$DIR/test_attribution.py" 2>&1)"; then
  fail "유닛 테스트 실패 — 원문 픽스처가 빌더를 통과하지 못한다:"
  printf '%s\n' "$out" | tail -25 | sed 's/^/    /' >&2
fi

# ── R5 역증명 + 변이 검사 ────────────────────────────────────────────────────
python3 - "$DIR" "$FIXTURE" <<'PY'
import os, re, shutil, sys, tempfile
d, fixture = sys.argv[1], sys.argv[2]
sys.path.insert(0, d)
import attribution_lib as lib, attribution_export as export

env = lib.parse_envelope(open(fixture, encoding="utf-8").read())
report = lib.build_report(env, want_snapshot=False, want_journal=False)
report["sudo_commands"] = [{
    "ts": "2026-08-03T08:45:00Z", "user": "user6", "cwd_category": "사용자 홈",
    "raw": "  user6 : PWD=/home/user6 ; USER=root ; "
           "COMMAND=/usr/bin/pip install tensorflow -t /home/user6/venv3"}]

problems = []

# ① 입력에 원문이 실제로 있는가(없으면 이 검사 전체가 무의미하다)
blob = repr(report)
if "COMMAND=" not in blob or "/home/user6/venv3" not in blob:
    problems.append("픽스처에 원문이 없다 — 역증명이 성립하지 않는다")

# ② 하드 규칙이 정말 잡는가
try:
    export.assert_no_leak("파일 /home/user6/venv3/x.so 와 COMMAND=/usr/bin/pip")
    problems.append("assert_no_leak 이 명백한 누출을 통과시켰다")
except export.RedactionError:
    pass

# ③ 정상 경로: 누출 0
text = export.build_slack_text(lib.public_view(report),
                               intent_summary="user6이 /home/user6/venv3 에 "
                                              "COMMAND=/usr/bin/pip install 을 돌린 것으로 보인다")
for pat, label in export.HARD_DENY:
    if pat.search(text):
        problems.append("정상 경로에서 %s 누출: %r" % (label, pat.search(text).group(0)))

# ④ 변이 검사 — 마지막 문지기를 제거한 사본에서는 **실제로** 새야 한다.
tmp = tempfile.mkdtemp(prefix="keiwi-redact-mutate-")
try:
    src = open(os.path.join(d, "attribution_export.py"), encoding="utf-8").read()
    mutated = src.replace("return assert_no_leak(text)", "return text")
    mutated = mutated.replace('lines.append("추정: " + redact_text(intent_summary))',
                              'lines.append("추정: " + intent_summary)')
    if mutated == src:
        problems.append("변이 검사 실패 — 문지기 코드를 찾지 못했다(게이트가 헛돈다)")
    open(os.path.join(tmp, "attribution_export.py"), "w", encoding="utf-8").write(mutated)
    sys.path.insert(0, tmp)
    for m in ("attribution_export",):
        sys.modules.pop(m, None)
    import attribution_export as mut
    leaked = mut.build_slack_text(lib.public_view(report),
                                  intent_summary="user6이 /home/user6/venv3 에 "
                                                 "COMMAND=/usr/bin/pip install 을 돌린 것으로 보인다")
    if "/home/user6/venv3" not in leaked or "COMMAND=" not in leaked:
        problems.append("변이본이 누출되지 않았다 — R4가 무의미한 검사일 수 있다")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

if problems:
    for p in problems:
        print("  FAIL %s" % p, file=sys.stderr)
    sys.exit(1)
print("  R5 역증명·변이 검사 통과(문지기를 빼면 실제로 샌다 → R4는 헛돌지 않는다)")
PY
[[ $? -eq 0 ]] || rc=1

# ── R6 경계 검사 — E3 relay 가 있으면 **그쪽 렌더러로도** 새지 않는지 확인 ────────
# relay(infra/alert-relay)는 자기 답글 #1을 스스로 조립한다(render_attribution_reply).
# 즉 반출 경로가 실질적으로 둘이다. relay 쪽 계약은 check-alert-relay.sh 소관이지만,
# **우리 수집기 출력이 그 문을 통과했을 때** 새는지는 여기서 봐야 한다 — 경계 사고는
# 양쪽 다 자기 몫만 검사할 때 생긴다. relay 가 없으면(E4 단독 배포) 이 검사는 건너뛴다.
if [[ -f infra/alert-relay/alert_relay.py ]]; then
  python3 - "$DIR" "$FIXTURE" <<'PY' || rc=1
import sys
d, fixture = sys.argv[1], sys.argv[2]
sys.path.insert(0, d)
sys.path.insert(0, "infra/alert-relay")
import attribution_lib as lib, attribution_export as export
try:
    import alert_relay as ar
except Exception as exc:                    # relay 가 아직 미완성이어도 우리 게이트는 안 죽는다
    print("  R6 SKIP — relay import 실패(%s)" % exc.__class__.__name__)
    sys.exit(0)

env = lib.parse_envelope(open(fixture, encoding="utf-8").read())
report = lib.build_report(env, want_snapshot=False, want_journal=False)
report["sudo_commands"] = [{
    "ts": "2026-08-03T08:45:00Z", "user": "user6", "cwd_category": "사용자 홈",
    "raw": "  user6 : PWD=/home/user6 ; USER=root ; "
           "COMMAND=/usr/bin/pip install tensorflow -t /home/user6/venv3"}]

clean = ar.drop_local_only_fields(report)
if "raw" in repr(clean):
    print("  FAIL R6 — relay 의 drop_local_only_fields 가 raw 를 남겼다", file=sys.stderr)
    sys.exit(1)
text = ar.render_attribution_reply(clean, {"node": "data04", "mount": "/"}) or ""
bad = [label for pat, label in export.HARD_DENY if pat.search(text)]
if bad:
    print("  FAIL R6 — relay 렌더러 출력에 누출: %s" % ", ".join(bad), file=sys.stderr)
    sys.exit(1)
if "user6" not in text:
    print("  FAIL R6 — relay 렌더러가 우리 스키마를 못 읽는다(계약 파손)", file=sys.stderr)
    sys.exit(1)
print("  R6 relay 렌더러 경계 통과(우리 출력 → relay 답글 #1, 누출 0)")
PY
else
  echo "  R6 SKIP — infra/alert-relay 없음(E4 단독 배포 상태)"
fi

if [[ $rc -eq 0 ]]; then
  echo "ATTRIBUTION_REDACTION_OK (반출 단일 경로 · raw 미참조 · 이중 redaction · 변이 검사 · relay 경계)"
else
  echo "ATTRIBUTION_REDACTION_FAIL — spec: specs/alert-enrichment §4.1 / AC-E4-3·E4-6"
fi
exit $rc

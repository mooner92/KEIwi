#!/usr/bin/env bash
# T3-5 — runbook_url 무결성 게이트 (알림 ↔ 런북 왕복 검증)
#
# 무엇을 막는가:
#   알림 본문의 "런북:" 링크가 200을 준다고 런북인 것이 아니다. 이 게이트는
#   "그 알림을 받은 사람이 무엇을 해야 하는지 적힌 문서인가"를 기계적으로 근사한다 —
#   경로(R4)·담당 선언(R5)·frontmatter 계약(R6/R6b)·문구 드리프트(R7)·복붙 가능성(R10).
#
# 검사 규칙:
#   R1  모든 규칙에 annotations.summary·runbook_url 존재                      FAIL
#   R2  URL이 https://github.com/mooner92/KEIwi/blob/main/<path> 형식          FAIL
#   R3  캡처된 <path>가 워킹트리에 실존                                        FAIL
#   R4  <path>가 docs/runbooks/*.md (README·spec 금지)                        FAIL
#   R5  그 런북 frontmatter alerts:에 alertname 포함 (없으면 kebab 폴백)       FAIL
#   R6  공통 계약: id(=파일 stem)·kind∈{alert,procedure,incident}·category     FAIL
#   R6b kind: alert(부재 시 기본값) 문서는 alerts·severity 추가 요구            FAIL
#   R7  summary의 NN°C/NN% 토큰 ⊆ 그 규칙 evaluator params                    FAIL
#   R8  alerts:가 비었거나 미존재 alertname을 가리킴                           WARN
#   R9  모든 docs/runbooks/*.md가 docs/README.md에서 링크됨                    FAIL
#   R10 런북의 ```bash 블록이 **블록마다 개별** bash -n 통과                    FAIL
#   R11 last_verified가 180일 초과                                            WARN
#
# 못 하는 것(정직하게):
#   - 런북 **내용**이 옳은지는 판정하지 않는다. 담당 선언과 형식만 본다.
#     "alerts에 선언했지만 본문이 딴소리"는 이 게이트로 안 잡힌다(사람 리뷰 몫).
#   - R7은 단위(°C/%)가 붙은 숫자만 대조한다. "정상 ≈17,600건" 같은 무단위 수치는 무시한다.
#   - R3은 워킹트리만 본다. main 브랜치 존재는 --check-main(post-merge 잡)이 따로 본다.
#   - 링크가 실제로 200인지는 보지 않는다(네트워크 의존 금지) — AC-3-14가 사람/CI에서 확인.
#
# 알림 개수를 하드코딩하지 않는다 — 축1·축2가 같은 파일에 규칙을 계속 더한다.
#
# usage:
#   check-runbooks.sh                 레포 전체 검사
#   check-runbooks.sh --quiet         PASS 라인 생략(요약과 위반만)
#   check-runbooks.sh --check-main    runbook_url 경로가 origin/main에도 있는지(post-merge용)
#   check-runbooks.sh --self-test     런타임 픽스처로 R1~R7 위반을 재현(게이트가 실패할 수 있음을 증명)
#   check-runbooks.sh --root DIR      검사 루트 지정(자기검사·픽스처용)
#
# exit: 0 통과(WARN 포함) / 1 정책 위반 / 2 환경 부족(SKIP)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

QUIET=0
CHECK_MAIN=0
SELF_TEST=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quiet)      QUIET=1 ;;
    --check-main) CHECK_MAIN=1 ;;
    --self-test)  SELF_TEST=1 ;;
    --root)       shift; ROOT="$(cd "$1" && pwd)" ;;
    -h|--help)    sed -n '/^# usage:/,/^# exit:/p' "$0" >&2; exit 64 ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
  shift
done

# ── 환경 확인 (없으면 조용히 통과시키지 않고 exit 2) ──────────────────────────
if ! command -v python3 >/dev/null 2>&1; then
  echo "SKIP(env: python3) — 이 게이트는 python3가 필요하다" >&2; exit 2
fi
if ! python3 -c 'import yaml' >/dev/null 2>&1; then
  echo "SKIP(env: PyYAML) — pip install pyyaml 후 다시 실행하라" >&2; exit 2
fi

run_check() {  # $1=root  $2=quiet  $3=check_main
  ROOT="$1" QUIET="$2" CHECK_MAIN="$3" python3 - <<'PY'
import glob, os, re, subprocess, sys, tempfile, datetime
import yaml

ROOT   = os.environ["ROOT"]
QUIET  = os.environ["QUIET"] == "1"
CMAIN  = os.environ["CHECK_MAIN"] == "1"
KINDS  = {"alert", "procedure", "incident"}
URL_RE = re.compile(r"^https://github\.com/mooner92/KEIwi/blob/main/(.+)$")
# 단위가 붙은 숫자만 — 무단위 수치(건수 등)는 오탐이 되므로 보지 않는다.
UNIT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(°C|%)")

fails, warns = [], []
def fail(rule, msg): fails.append(f"{rule} FAIL: {msg}")
# AC-3-10이 `WARN: <stem>` 문자열을 본다 — 규칙 id 뒤에 콜론, 그 다음이 대상이다.
def warn(rule, msg): warns.append(f"{rule} WARN: {msg}")
def p(path): return os.path.join(ROOT, path)

# ── 입력 수집: 있는 것만 자동 인식 ────────────────────────────────────────────
rules = []   # (alertname, annotations, params, source)
def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None

for f in sorted(glob.glob(p("infra/monitoring/grafana/provisioning/alerting/*.yaml"))):
    try: doc = yaml.safe_load(open(f)) or {}
    except yaml.YAMLError as e:
        fail("R1", f"{os.path.relpath(f, ROOT)} YAML 파싱 실패: {e}"); continue
    if not isinstance(doc, dict) or "groups" not in doc:
        continue                      # contact-points·notification-policies 등
    for g in doc.get("groups") or []:
        for r in g.get("rules") or []:
            params = []
            for d in r.get("data") or []:
                for c in (d.get("model") or {}).get("conditions") or []:
                    for v in (c.get("evaluator") or {}).get("params") or []:
                        if num(v) is not None: params.append(num(v))
            rules.append((r.get("title"), r.get("annotations") or {}, params,
                          os.path.relpath(f, ROOT)))

for f in sorted(glob.glob(p("infra/monitoring/alerts/*.yml")) +
                glob.glob(p("infra/monitoring/alerts/*.yaml"))):
    try: doc = yaml.safe_load(open(f)) or {}
    except yaml.YAMLError as e:
        fail("R1", f"{os.path.relpath(f, ROOT)} YAML 파싱 실패: {e}"); continue
    for g in (doc.get("groups") or []):
        for r in g.get("rules") or []:
            if "alert" not in r:      # recording rule
                continue
            # Prometheus 포맷엔 evaluator가 없다 → expr의 숫자 리터럴을 허용집합으로.
            lits = [float(x) for x in re.findall(r"(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])",
                                                 str(r.get("expr", "")))]
            params = lits + [x * 100 for x in lits] + [x / 100 for x in lits]
            rules.append((r.get("alert"), r.get("annotations") or {}, params,
                          os.path.relpath(f, ROOT)))

# ── 런북 frontmatter 로드 ────────────────────────────────────────────────────
runbooks = {}   # rel path -> frontmatter dict or None
for f in sorted(glob.glob(p("docs/runbooks/*.md"))):
    rel = os.path.relpath(f, ROOT)
    m = re.match(r"^---\r?\n(.*?)\r?\n---", open(f, encoding="utf-8").read(), re.S)
    try: runbooks[rel] = yaml.safe_load(m.group(1)) if m else None
    except yaml.YAMLError: runbooks[rel] = None

declared = set()                       # 런북이 담당한다고 선언한 alertname
for rel, fm in runbooks.items():
    if isinstance(fm, dict):
        for a in (fm.get("alerts") or []): declared.add(a)
known_alerts = {t for t, _a, _p, _s in rules if t}

def kebab(name):
    return re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()

# ── R1~R5 · R7 : 규칙 쪽 ─────────────────────────────────────────────────────
for title, ann, params, src in rules:
    tag = f"{title or '<no-title>'} ({src})"
    url = ann.get("runbook_url")
    if not title or not ann.get("summary") or not url:
        miss = [k for k in ("title", "summary", "runbook_url")
                if not (title if k == "title" else ann.get(k))]
        fail("R1", f"{tag} 누락: {miss}"); continue
    m = URL_RE.match(str(url))
    if not m:
        fail("R2", f"{tag} runbook_url 형식 위반: {url}"); continue
    path = m.group(1)
    if not os.path.isfile(p(path)):
        fail("R3", f"{tag} 워킹트리에 없음: {path}"); continue
    if not re.fullmatch(r"docs/runbooks/[^/]+\.md", path):
        fail("R4", f"{tag} 전용 런북이 아님(README·spec 금지): {path}"); continue
    fm = runbooks.get(path)
    alerts = (fm or {}).get("alerts")
    if alerts is None:                                  # kebab 폴백
        if os.path.basename(path) != kebab(title) + ".md":
            fail("R5", f"{tag} 런북이 이 알림을 선언하지 않음(alerts 없음, kebab도 불일치): {path}")
    elif title not in alerts:
        fail("R5", f"{tag} 런북 alerts:에 없음 {path} → {alerts}")
    # R7 — 단위 붙은 숫자만 대조
    for val, unit in UNIT_RE.findall(str(ann.get("summary", ""))):
        if params and not any(abs(float(val) - q) < 1e-9 for q in params):
            fail("R7", f"{tag} summary의 {val}{unit} 가 임계 {params} 와 불일치")

# ── R6 · R6b · R8 · R11 : 런북 쪽 ────────────────────────────────────────────
today = datetime.date.today()
for rel, fm in sorted(runbooks.items()):
    stem = os.path.basename(rel)[:-3]
    if not isinstance(fm, dict):
        fail("R6", f"{rel} frontmatter 없음/파싱 실패"); continue
    if fm.get("id") != stem:
        fail("R6", f"{rel} id({fm.get('id')!r}) != 파일 stem({stem!r})"); continue
    kind = fm.get("kind", "alert")
    if kind not in KINDS:
        fail("R6", f"{rel} kind={kind!r} (허용: {sorted(KINDS)})"); continue
    if "category" not in fm:
        fail("R6", f"{rel} category 없음"); continue
    if kind == "alert":
        miss = [k for k in ("alerts", "severity") if k not in fm]
        if miss:
            fail("R6b", f"{rel} kind:alert인데 {miss} 없음"); continue
        a = fm.get("alerts") or []
        if not a:
            warn("R8", f"{stem} 담당 알림 없음(alerts: []) — 런북 먼저·알림 나중은 허용")
        else:
            ghost = [x for x in a if x not in known_alerts]
            if ghost:
                warn("R8", f"{stem} 아직 없는 alertname 선언: {ghost}")
    lv = fm.get("last_verified")
    if lv is not None:
        d = lv if isinstance(lv, datetime.date) else None
        if d is None:
            try: d = datetime.date.fromisoformat(str(lv))
            except ValueError: d = None
        if d and (today - d).days > 180:
            warn("R11", f"{stem} last_verified {d} — {(today - d).days}일 경과(180 초과)")

# ── R9 : docs/README.md 링크 ─────────────────────────────────────────────────
readme = p("docs/README.md")
if not os.path.isfile(readme):
    fail("R9", "docs/README.md 없음 — 런북 인덱스를 검증할 수 없다")
else:
    txt = open(readme, encoding="utf-8").read()
    for rel in sorted(runbooks):
        if f"runbooks/{os.path.basename(rel)}" not in txt:
            fail("R9", f"{rel} 이 docs/README.md에서 링크되지 않음(고아 런북)")

# ── R10 : ```bash 블록마다 개별 bash -n ──────────────────────────────────────
for rel in sorted(runbooks):
    lines = open(p(rel), encoding="utf-8").read().split("\n")
    buf, start = None, 0
    for i, line in enumerate(lines, 1):
        if buf is None and re.match(r"^```bash\s*$", line):
            buf, start = [], i; continue
        if buf is not None and line.startswith("```"):
            with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False) as t:
                t.write("\n".join(buf)); tmp = t.name
            r = subprocess.run(["bash", "-n", tmp], capture_output=True, text=True)
            os.unlink(tmp)
            if r.returncode:
                fail("R10", f"{rel}:{start} (블록 시작 행) bash -n 실패 — {r.stderr.strip()}")
            buf = None; continue
        if buf is not None: buf.append(line)

# ── --check-main : origin/main 존재 확인 (post-merge 잡 전용) ────────────────
if CMAIN:
    ok = subprocess.run(["git", "-C", ROOT, "rev-parse", "--verify", "-q", "origin/main"],
                        capture_output=True, text=True).returncode == 0
    if not ok:
        print("SKIP(env: origin/main) — origin/main 참조가 없다(git fetch 필요)", file=sys.stderr)
        sys.exit(2)
    for _t, ann, _p, _s in rules:
        m = URL_RE.match(str(ann.get("runbook_url", "")))
        if not m: continue
        path = m.group(1)
        r = subprocess.run(["git", "-C", ROOT, "cat-file", "-e", f"origin/main:{path}"],
                           capture_output=True, text=True)
        if r.returncode:
            fail("R3", f"origin/main에 없음(머지 후 404가 된다): {path}")

# ── 보고 ─────────────────────────────────────────────────────────────────────
for line in fails: print(line)
for line in warns: print(line)
n_alert_rb = sum(1 for fm in runbooks.values()
                 if isinstance(fm, dict) and fm.get("kind", "alert") == "alert")
if fails:
    print(f"FAIL: runbooks check — 위반 {len(fails)}건 "
          f"(rules={len(rules)}, runbooks={len(runbooks)}, warn={len(warns)}, engine=pyyaml)")
    sys.exit(1)
if not QUIET:
    print(f"  rules={len(rules)} runbooks={len(runbooks)}(alert {n_alert_rb}) "
          f"warn={len(warns)} engine=pyyaml root={os.path.relpath(ROOT, ROOT) or '.'}")
print("OK: runbooks check passed")
sys.exit(0)
PY
}

# ── --self-test : 런타임 픽스처로 "이 게이트는 실패할 수 있다"를 증명 ────────
# 픽스처는 커밋하지 않는다(mktemp -d, 종료 시 삭제) — 위반 샘플이 레포에 남으면
# 다른 게이트·검색의 오탐원이 된다.
if [[ $SELF_TEST -eq 1 ]]; then
  FIX="$(mktemp -d)"
  trap 'rm -rf "$FIX"' EXIT
  mkdir -p "$FIX/infra/monitoring/grafana/provisioning/alerting" "$FIX/docs/runbooks"
  B=https://github.com/mooner92/KEIwi/blob/main

  cat > "$FIX/README.md" <<'EOF'
fixture — R4용 (docs/runbooks 밖이지만 실존하는 경로)
EOF

  cat > "$FIX/infra/monitoring/grafana/provisioning/alerting/fixture.yaml" <<EOF
apiVersion: 1
groups:
  - name: fixture
    rules:
      - title: R1Missing            # runbook_url·summary 없음 → R1
        annotations: {}
      - title: R2Bad                # URL 형식 위반 → R2
        annotations:
          summary: 'x'
          runbook_url: https://example.com/not-github
      - title: R3Missing            # 실존하지 않는 경로 → R3
        annotations:
          summary: 'x'
          runbook_url: $B/docs/runbooks/does-not-exist.md
      - title: R4Outside            # 실존하지만 런북 디렉터리 밖 → R4
        annotations:
          summary: 'x'
          runbook_url: $B/README.md
      - title: R5Undeclared         # 런북이 이 알림을 선언하지 않음 → R5
        annotations:
          summary: 'x'
          runbook_url: $B/docs/runbooks/r5-target.md
      - title: R7Drift              # summary 85°C vs 임계 92 → R7
        data:
          - refId: A
            model:
              conditions:
                - evaluator: { type: gt, params: [92] }
        annotations:
          summary: '과열 — 85°C 초과 10분'
          runbook_url: $B/docs/runbooks/r7-target.md
EOF

  fm() { printf -- '---\nid: %s\nkind: alert\ncategory: infra\nseverity: warning\nalerts: [%s]\n---\n\n# %s\n' "$1" "$2" "$1"; }
  fm r5-target OtherAlert > "$FIX/docs/runbooks/r5-target.md"
  fm r7-target R7Drift    > "$FIX/docs/runbooks/r7-target.md"
  # R6 — id가 파일 stem과 불일치
  printf -- '---\nid: wrong-id\nkind: alert\ncategory: infra\nseverity: warning\nalerts: []\n---\n\n# r6-bad\n' \
    > "$FIX/docs/runbooks/r6-bad.md"
  # R6b — kind:alert인데 alerts·severity 없음
  printf -- '---\nid: r6b-bad\nkind: alert\ncategory: infra\n---\n\n# r6b-bad\n' \
    > "$FIX/docs/runbooks/r6b-bad.md"

  {
    echo "# fixture docs index"
    for f in r5-target r7-target r6-bad r6b-bad; do echo "- [$f](./runbooks/$f.md)"; done
  } > "$FIX/docs/README.md"

  out="$(run_check "$FIX" 0 0)"; rc=$?
  echo "$out"
  bad=0
  for r in R1 R2 R3 R4 R5 R6 R6b R7; do
    n=$(printf '%s\n' "$out" | grep -c "^$r FAIL: ")   # "R6 FAIL "는 "R6b FAIL "와 안 겹친다(공백)
    if [[ "$n" != "1" ]]; then echo "SELF-TEST 실패: $r 위반 보고 ${n}건 (기대 1건)"; bad=1; fi
  done
  if [[ $rc -ne 1 ]]; then echo "SELF-TEST 실패: 픽스처 exit=$rc (기대 1)"; bad=1; fi
  if [[ $bad -ne 0 ]]; then echo "FAIL: self-test — 게이트가 위반을 정확히 잡지 못한다"; exit 1; fi
  echo "OK: self-test passed — R1~R7 각 1건 검출, exit=1 확인"
  exit 1   # 픽스처는 위반 상태다. 이 모드의 정상 종료코드는 1이다(AC-3-2).
fi

run_check "$ROOT" "$QUIET" "$CHECK_MAIN"
exit $?

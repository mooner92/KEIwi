#!/usr/bin/env bash
# T1-1 — 런북 `actions` 계약 게이트 (auto-remediation §2.3 · AC-L1-1)
#
# 무엇을 막는가:
#   `actions:` 는 **LLM이 고를 수 있는 조치 화이트리스트**다(spec §0-2 "LLM은 명령을 짓지 않고
#   고른다"). 화이트리스트가 거짓이면 L1 제안 전체가 거짓이 된다. 이 게이트는 그 거짓을
#   세 방향에서 막는다:
#     ① **거짓 라벨** — `rm -rf`를 `risk: low`로 적는 것(A6). 사람이 승인 카드를 훑을 때
#        위험도만 보고 넘긴다. 라벨이 곧 방어선이라 라벨이 거짓이면 방어선이 없다.
#     ② **거짓 상한** — 비가역·고위험 조치를 `tier: 3`(자동 후보)으로 올리는 것(A5).
#        spec §4.1의 4조건(정답형·저blast·멱등·롤백가능)을 **문장이 아니라 코드로** 강제한다.
#     ③ **거짓 근거** — 런북 본문에 없는 명령을 frontmatter에만 적는 것(A7). 그러면 사람이
#        읽는 문서와 기계가 고르는 목록이 갈라지고, 갈라진 순간 한쪽은 반드시 낡는다.
#
# 역할 분담 — check-runbooks.sh 와 **겹치지 않는다**:
#   check-runbooks.sh (축3)  = 알림 ↔ 런북 **왕복 링크**와 공통 frontmatter(id·kind·category·
#                              alerts·severity)의 존재. "그 알림의 담당 문서가 있는가".
#   check-runbook-actions.sh = 그 문서 안의 **조치 계약**. "그 문서가 약속한 조치가
#                              실행 가능하고, 위험도가 정직하고, 상한이 근거를 가지는가".
#   같은 키를 두 게이트가 보는 곳은 셋뿐이고 전부 **다른 질문**이다:
#     · `alerts`      — R8은 "선언한 alertname이 실재하는가"를 **전 런북에 WARN**으로 본다.
#                       A9는 "**tier≥2(자동경로 후보)** 런북이 실재 트리거를 갖는가"를 FAIL로 본다.
#                       유령 alertname만 가진 자동 후보는 영원히 도달 불가한 죽은 정책이다.
#     · `last_verified` — R11은 존재할 때만 180일을 WARN. A10은 **actions가 있으면 존재 자체를
#                       필수**로 만든다(검증일 없는 명령 화이트리스트는 감사 불가).
#     · frontmatter 파싱 — 둘 다 하지만 A쪽은 tier·actions만 본다.
#
# 검사 규칙:
#   A1  tier 존재 · 정수 0~3                                                    FAIL
#   A2  actions 존재 · 리스트(빈 리스트 허용)                                    FAIL
#   A3  action 필수 6키(id·title·risk·reversible·idempotent·command) + 타입/열거  FAIL
#   A4  action id 유일 + kebab-case                                             FAIL
#   A5  안전 4조건 강제: risk=high⇒tier≤1 · reversible=false⇒tier≤1 ·
#       idempotent=false⇒tier≤2                                                FAIL
#   A6  파괴 동사(reboot·kill·rm·purge·mkfs·dd·_delete_by_query…)인데 risk≠high  FAIL
#   A7  근거성 — command가 그 런북의 ```펜스 코드블록``` 안에 실존                FAIL
#   A8  actions가 비었으면 tier는 0이어야 한다                                    FAIL
#   A9  tier≥2인데 alerts에 실재 alertname이 하나도 없음                          FAIL
#   A10 actions 비어있지 않은데 last_verified 없음 FAIL / 180일 초과 WARN
#
# 못 하는 것(정직하게):
#   · **조치가 옳은지**는 판정하지 않는다. `sudo docker restart X`가 이 장애의 올바른 처방인지는
#     사람 리뷰 몫이다. 이 게이트는 "적힌 대로 실행 가능하고 위험 라벨이 거짓이 아닌가"만 본다.
#   · **A6은 하한이지 상한이 아니다.** 목록에 없는 동사(`systemctl disable`·`ufw delete`·
#     `_delete_by_query` 밖의 OpenSearch 파괴 API 등)는 못 잡는다 — risk 표기는 여전히 사람이
#     정직하게 적어야 하고, 이 규칙은 **명백한 거짓말만** 막는다.
#   · **A7은 문자열 포함 검사다.** 코드블록에 우연히 포함되는 짧은 명령은 통과한다.
#     "본문에 문서화됐는가"의 근사이지 의미 검증이 아니다.
#   · **멱등·가역 표기의 진위**는 검증 불가. `idempotent: true`가 실제로 참인지는 실행해 봐야
#     안다 — 그래서 L3 승격에 earned-autonomy(무사고 N회)가 따로 필요하다(spec §4).
#   · 런북 **본문**의 위험 절차는 대상이 아니다. actions에 올리지 않은 파괴적 명령은 이
#     게이트가 보지 않는다(= 자동경로 밖이라는 뜻이고, 그것이 설계 의도다).
#
# usage:
#   check-runbook-actions.sh              레포 전체 검사
#   check-runbook-actions.sh --quiet      PASS 요약 생략(위반만)
#   check-runbook-actions.sh --root DIR   검사 루트 지정(픽스처·자기검사용)
#   check-runbook-actions.sh --self-test  A1~A10 각각을 일부러 위반한 픽스처로 역증명
#
# exit: 0 통과(WARN 포함) / 1 정책 위반 / 2 환경 부족(SKIP)
#   --self-test 는 **탐지에 성공하면 0**이다(check-alert-relay.sh 관례). 픽스처의 rc가
#   아니라 "게이트가 심어둔 위반을 전부 잡았는가"가 이 모드의 판정 대상이기 때문이다.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

QUIET=0
SELF_TEST=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quiet)     QUIET=1 ;;
    --self-test) SELF_TEST=1 ;;
    --root)      shift; ROOT="$(cd "$1" && pwd)" ;;
    -h|--help)   sed -n '/^# usage:/,/^# exit:/p' "$0" >&2; exit 64 ;;
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

run_check() {  # $1=root  $2=quiet
  ROOT="$1" QUIET="$2" python3 - <<'PY'
import datetime
import glob
import os
import re
import sys

import yaml

ROOT  = os.environ["ROOT"]
QUIET = os.environ["QUIET"] == "1"

RISKS = ("low", "medium", "high")
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
# 파괴 동사 — "명백한 거짓 라벨"만 잡는 하한 목록(주석의 '못 하는 것' 참조).
# 단어 경계를 쓴다: `docker restart`의 `restart`나 `--vacuum-size`는 대상이 아니다.
DESTRUCTIVE = re.compile(
    # 검증이 실증한 우회(2026-08-04): find -delete·chown -R·mv·리다이렉트 절단이 통과했다.
    # systemctl stop은 넣지 않는다 — start로 즉시 가역이라 high 강제가 오히려 거짓 라벨이 된다.
    # --vacuum-*·prune도 제외 — 재생성 캐시 정리는 L3 원형(spec §1)이고 별도 화이트리스트(A6b, T2)로 다룬다.
    r"(?:^|[\s;|&/])(?:rm|rmdir|kill|pkill|killall|reboot|shutdown|halt|poweroff|"
    r"mkfs|fdisk|dd|shred|userdel|truncate)(?:\s|$)"
    r"|--purge|--force-remove|_delete_by_query|DROP\s+TABLE"
    r"|(?:^|\s)-delete\b"
    r"|chown\s+-R\b"
    r"|(?:^|[;&|]\s*)mv\s"
    r"|>\s*/(?:var|etc|usr|data)/"
)
# 들여쓰기된 펜스(번호 목록·인용 안의 코드블록)도 본문이다. `^```` 로만 잡으면
# "목록 항목 안에 적힌 명령"이 통째로 근거 없음으로 오판된다 [실측 2026-08-04: 4건].
FENCE_RE = re.compile(r"^\s*```")

fails, warns = [], []
def fail(rule, msg): fails.append(f"{rule} FAIL: {msg}")
def warn(rule, msg): warns.append(f"{rule} WARN: {msg}")
def p(path): return os.path.join(ROOT, path)


def norm(text):
    """줄바꿈 이어쓰기(\\)를 없애고 공백을 1칸으로 눌러 비교 가능한 형태로."""
    text = re.sub(r"\\\s*\n", " ", text)
    return re.sub(r"\s+", " ", text).strip()


# ── 알림 이름 수집 (A9용) — check-runbooks.sh 와 같은 두 소스를 본다 ─────────
known_alerts = set()
for f in sorted(glob.glob(p("infra/monitoring/grafana/provisioning/alerting/*.yaml"))):
    try:
        doc = yaml.safe_load(open(f, encoding="utf-8")) or {}
    except yaml.YAMLError:
        continue
    if not isinstance(doc, dict):
        continue
    for g in doc.get("groups") or []:
        for r in g.get("rules") or []:
            if r.get("title"):
                known_alerts.add(r["title"])
for f in sorted(glob.glob(p("infra/monitoring/alerts/*.yml")) +
                glob.glob(p("infra/monitoring/alerts/*.yaml"))):
    try:
        doc = yaml.safe_load(open(f, encoding="utf-8")) or {}
    except yaml.YAMLError:
        continue
    for g in (doc or {}).get("groups") or []:
        for r in g.get("rules") or []:
            if r.get("alert"):
                known_alerts.add(r["alert"])

# ── 런북 로드: frontmatter + 펜스 코드블록 본문 ──────────────────────────────
books = []      # (rel, frontmatter dict, [정규화된 코드블록])
for f in sorted(glob.glob(p("docs/runbooks/*.md"))):
    rel = os.path.relpath(f, ROOT)
    raw = open(f, encoding="utf-8").read()
    m = re.match(r"^---\r?\n(.*?)\r?\n---", raw, re.S)
    if not m:
        fail("A1", f"{rel} frontmatter 없음 — actions 계약을 확인할 수 없다")
        continue
    try:
        fm = yaml.safe_load(m.group(1))
    except yaml.YAMLError as e:
        fail("A1", f"{rel} frontmatter YAML 파싱 실패: {e}")
        continue
    if not isinstance(fm, dict):
        fail("A1", f"{rel} frontmatter가 매핑이 아니다")
        continue
    blocks, buf = [], None
    for line in raw[m.end():].split("\n"):
        if FENCE_RE.match(line):
            if buf is None:
                buf = []
            else:
                blocks.append(norm("\n".join(buf)))
                buf = None
            continue
        if buf is not None:
            buf.append(line)
    if buf is not None:                       # 닫히지 않은 펜스도 내용은 살린다
        blocks.append(norm("\n".join(buf)))
    books.append((rel, fm, blocks))

today = datetime.date.today()
n_actions = 0

for rel, fm, blocks in books:
    stem = os.path.basename(rel)[:-3]

    # ── A1 tier ──────────────────────────────────────────────────────────
    tier = fm.get("tier")
    if tier is None:
        fail("A1", f"{stem} tier 없음 — 도달 가능 최대 자율 레벨(0~3)을 선언해야 한다")
        continue
    if not isinstance(tier, int) or isinstance(tier, bool) or not 0 <= tier <= 3:
        fail("A1", f"{stem} tier={tier!r} — 0~3 정수여야 한다")
        continue

    # ── A2 actions ───────────────────────────────────────────────────────
    if "actions" not in fm:
        fail("A2", f"{stem} actions 없음 — 조치가 없으면 `actions: []`로 명시하라")
        continue
    actions = fm.get("actions")
    if actions is None:
        actions = []
    if not isinstance(actions, list):
        fail("A2", f"{stem} actions가 리스트가 아니다: {type(actions).__name__}")
        continue

    # ── A8 빈 화이트리스트는 tier 0 ──────────────────────────────────────
    if not actions and tier != 0:
        fail("A8", f"{stem} actions가 비었는데 tier={tier} — 고를 조치가 없으면 상한은 0이다")
        continue

    # ── A3~A7 : action 하나씩 ────────────────────────────────────────────
    seen, bad = set(), False
    for i, a in enumerate(actions):
        tag = f"{stem}#{i}"
        if not isinstance(a, dict):
            fail("A3", f"{tag} action이 매핑이 아니다"); bad = True; break
        miss = [k for k in ("id", "title", "risk", "reversible", "idempotent", "command")
                if k not in a]
        if miss:
            fail("A3", f"{tag} 필수 키 누락: {miss}"); bad = True; break
        if a["risk"] not in RISKS:
            fail("A3", f"{tag} risk={a['risk']!r} (허용: {list(RISKS)})"); bad = True; break
        if not isinstance(a["reversible"], bool) or not isinstance(a["idempotent"], bool):
            fail("A3", f"{tag} reversible/idempotent는 불리언이어야 한다"); bad = True; break
        cmds = a["command"] if isinstance(a["command"], list) else [a["command"]]
        if not cmds or any(not isinstance(c, str) or not c.strip() for c in cmds):
            fail("A3", f"{tag} command가 비었거나 문자열이 아니다"); bad = True; break

        aid = a["id"]
        if not isinstance(aid, str) or not ID_RE.match(aid):
            fail("A4", f"{tag} id={aid!r} — kebab-case여야 한다"); bad = True; break
        if aid in seen:
            fail("A4", f"{stem} action id 중복: {aid!r}"); bad = True; break
        seen.add(aid)

        # A5 — spec §4.1 4조건의 기계적 강제
        why = []
        if a["risk"] == "high" and tier >= 2:
            why.append("risk:high는 tier≤1")
        if a["reversible"] is False and tier >= 2:
            why.append("reversible:false는 tier≤1(§0-4 롤백 불가는 자동경로 밖)")
        if a["idempotent"] is False and tier >= 3:
            why.append("idempotent:false는 tier≤2(§4.1 조건3)")
        if why:
            fail("A5", f"{stem}/{aid} tier={tier}인데 {' · '.join(why)}")
            bad = True; break

        # A6 — 거짓 저위험 라벨
        for c in cmds:
            if DESTRUCTIVE.search(c) and a["risk"] != "high":
                fail("A6", f"{stem}/{aid} 파괴 동사를 담았는데 risk={a['risk']!r} — "
                           f"risk: high 로 정직하게 적어라")
                bad = True; break
        if bad:
            break

        # A7 — 근거성: 본문 코드블록에 실존해야 한다
        for c in cmds:
            needle = norm(c)
            if not any(needle in b for b in blocks):
                fail("A7", f"{stem}/{aid} command가 본문 코드블록에 없다 — "
                           f"런북에 없는 명령을 화이트리스트에 올렸다")
                bad = True; break
        if bad:
            break
        n_actions += 1
    if bad:
        continue

    # ── A9 tier≥2는 실재 트리거가 있어야 한다 ────────────────────────────
    if tier >= 2:
        declared = fm.get("alerts") or []
        live = [x for x in declared if x in known_alerts]
        if not live:
            fail("A9", f"{stem} tier={tier}(자동경로 후보)인데 실재 alertname이 없다: "
                       f"{declared!r} — 도달 불가한 죽은 정책이다")
            continue

    # ── A10 화이트리스트의 검증일 ────────────────────────────────────────
    if actions:
        lv = fm.get("last_verified")
        if lv is None:
            fail("A10", f"{stem} actions가 있는데 last_verified 없음 — "
                        f"검증일 없는 명령 화이트리스트는 감사할 수 없다")
            continue
        d = lv if isinstance(lv, datetime.date) else None
        if d is None:
            try:
                d = datetime.date.fromisoformat(str(lv))
            except ValueError:
                fail("A10", f"{stem} last_verified={lv!r} — ISO 날짜(YYYY-MM-DD)여야 한다")
                continue
        age = (today - d).days
        if age > 180:
            extra = " · tier≥2 자동경로 강등 대상(§2.3)" if tier >= 2 else ""
            warns.append(f"A10 WARN: {stem} actions 검증 {age}일 경과(180 초과){extra}")

# ── 보고 ─────────────────────────────────────────────────────────────────────
for line in fails:
    print(line)
for line in warns:
    print(line)
by_tier = {}
for _rel, fm, _b in books:
    t = fm.get("tier")
    if isinstance(t, int) and not isinstance(t, bool):
        by_tier[t] = by_tier.get(t, 0) + 1
# ── A11 — alertname 소유권 유일성(전역): 같은 alertname을 두 런북이 선언하면 L1이
#    ambiguous_runbook으로 제안 0이 된다[실증: DiskUsageHigh가 2런북에 선언돼 실알림
#    2종이 도달 불가였다]. alertname → 런북은 1:1이어야 한다.
_owner = {}
for _f in sorted(glob.glob(p("docs/runbooks/*.md"))):
    _txt = open(_f, encoding="utf-8").read()
    _stem = _f.rsplit("/", 1)[-1][:-3]
    _m = re.search(r"^alerts:\s*\[([^\]]*)\]", _txt, re.M)
    if not _m:
        continue
    for _a in [x.strip() for x in _m.group(1).split(",") if x.strip()]:
        if _a in _owner:
            fail("A11", f"alertname {_a!r}를 {_owner[_a]}와 {_stem}가 중복 선언 — 소유권은 1런북")
        else:
            _owner[_a] = _stem

if fails:
    print(f"FAIL: runbook actions — 위반 {len(fails)}건 "
          f"(runbooks={len(books)}, actions={n_actions}, warn={len(warns)}, engine=pyyaml)")
    sys.exit(1)
if not QUIET:
    dist = " ".join(f"t{k}={by_tier[k]}" for k in sorted(by_tier))
    print(f"  runbooks={len(books)} actions={n_actions} [{dist}] "
          f"warn={len(warns)} engine=pyyaml")
print("OK: runbook actions contract passed")
sys.exit(0)
PY
}

# ── --self-test : 규칙마다 픽스처 1개로 "이 게이트는 실패할 수 있다"를 증명 ──
# 픽스처는 커밋하지 않는다(mktemp -d, 종료 시 삭제) — 위반 샘플이 레포에 남으면 다른
# 게이트·검색의 오탐원이 된다(check-runbooks.sh 와 같은 관례).
if [[ $SELF_TEST -eq 1 ]]; then
  FIX="$(mktemp -d)"
  trap 'rm -rf "$FIX"' EXIT
  mkdir -p "$FIX/infra/monitoring/grafana/provisioning/alerting" "$FIX/docs/runbooks"

  # A9가 대조할 "실재 alertname" 한 개
  cat > "$FIX/infra/monitoring/grafana/provisioning/alerting/fixture.yaml" <<'EOF'
apiVersion: 1
groups:
  - name: fixture
    rules:
      - title: FixtureAlert
        annotations: { summary: 'x' }
EOF

  # 픽스처 생성기: $1=stem, $2=frontmatter 본문, $3=코드블록에 넣을 명령
  mk() {
    { printf -- '---\n%s\n---\n\n# %s\n\n```bash\n%s\n```\n' "$2" "$1" "$3"; } \
      > "$FIX/docs/runbooks/$1.md"
  }
  OK_ACT='  - id: safe-probe
    title: 안전 조회
    risk: low
    reversible: true
    idempotent: true
    command: echo probe'

  # A1 — tier가 범위 밖
  mk a1-bad "id: a1-bad
kind: procedure
category: infra
last_verified: $(date +%F)
tier: 9
actions: []" 'echo probe'

  # A2 — actions 키 자체가 없다
  mk a2-bad "id: a2-bad
kind: procedure
category: infra
last_verified: $(date +%F)
tier: 0" 'echo probe'

  # A3 — 필수 키(idempotent) 누락
  mk a3-bad "id: a3-bad
kind: procedure
category: infra
last_verified: $(date +%F)
tier: 1
actions:
  - id: no-idem
    title: 키 누락
    risk: low
    reversible: true
    command: echo probe" 'echo probe'

  # A4 — id가 kebab-case가 아니다
  mk a4-bad "id: a4-bad
kind: procedure
category: infra
last_verified: $(date +%F)
tier: 1
actions:
  - id: Not_Kebab
    title: 잘못된 id
    risk: low
    reversible: true
    idempotent: true
    command: echo probe" 'echo probe'

  # A5 — 비가역인데 tier 3 (4조건 위반)
  mk a5-bad "id: a5-bad
kind: alert
alerts: [FixtureAlert]
severity: warning
category: infra
last_verified: $(date +%F)
tier: 3
actions:
  - id: one-way
    title: 되돌릴 수 없는 조치
    risk: medium
    reversible: false
    idempotent: true
    command: echo probe" 'echo probe'

  # A6 — 파괴 동사인데 risk: low (거짓 라벨)
  mk a6-bad "id: a6-bad
kind: procedure
category: infra
last_verified: $(date +%F)
tier: 0
actions:
  - id: liar
    title: 거짓 저위험
    risk: low
    reversible: false
    idempotent: true
    command: sudo rm -rf /tmp/keiwi-fixture" 'sudo rm -rf /tmp/keiwi-fixture'

  # A7 — 본문에 없는 명령
  mk a7-bad "id: a7-bad
kind: procedure
category: infra
last_verified: $(date +%F)
tier: 1
actions:
  - id: ungrounded
    title: 근거 없는 명령
    risk: low
    reversible: true
    idempotent: true
    command: echo this-command-is-not-in-the-body" 'echo probe'

  # A8 — 빈 actions인데 tier 2
  mk a8-bad "id: a8-bad
kind: alert
alerts: [FixtureAlert]
severity: warning
category: infra
last_verified: $(date +%F)
tier: 2
actions: []" 'echo probe'

  # A9 — tier 2인데 alertname이 유령
  mk a9-bad "id: a9-bad
kind: alert
alerts: [GhostAlertDoesNotExist]
severity: warning
category: infra
last_verified: $(date +%F)
tier: 2
actions:
$OK_ACT" 'echo probe'

  # A10 — actions가 있는데 last_verified 없음
  mk a10-bad "id: a10-bad
kind: procedure
category: infra
tier: 1
actions:
$OK_ACT" 'echo probe'

  # 오탐 확인용 — 전 규칙을 만족하는 정상 런북(여기서 FAIL이 나오면 게이트가 과잉이다)
  mk a0-good "id: a0-good
kind: alert
alerts: [FixtureAlert]
severity: warning
category: infra
last_verified: $(date +%F)
tier: 3
actions:
$OK_ACT" 'echo probe'

  out="$(run_check "$FIX" 0)"; rc=$?
  echo "$out"
  bad=0
  for r in A1 A2 A3 A4 A5 A6 A7 A8 A9 A10; do
    # "A1 FAIL: "은 "A10 FAIL: "과 겹치지 않는다(규칙 id 뒤에 공백).
    n=$(printf '%s\n' "$out" | grep -c "^$r FAIL: ")
    if [[ "$n" != "1" ]]; then
      echo "SELF-TEST 실패: $r 위반 보고 ${n}건 (기대 1건)"; bad=1
    fi
  done
  if printf '%s\n' "$out" | grep -q 'a0-good'; then
    echo "SELF-TEST 실패: 정상 런북(a0-good)에 오탐이 났다"; bad=1
  fi
  if [[ $rc -ne 1 ]]; then
    echo "SELF-TEST 실패: 픽스처 rc=$rc (기대 1)"; bad=1
  fi
  if [[ $bad -ne 0 ]]; then
    echo "FAIL: self-test — 게이트가 위반을 정확히 잡지 못한다"; exit 1
  fi
  echo "SELF_TEST_OK (A1~A10 각 1건 적발 · 정상 런북 오탐 0 · 픽스처 rc=1)"
  exit 0
fi

run_check "$ROOT" "$QUIET"
exit $?

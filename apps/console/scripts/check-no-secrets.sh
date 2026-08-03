#!/usr/bin/env bash
# 콘솔 스코프 시크릿 게이트 (spec fleet-hardening §5 D5-1 / T5-1·T5-5)
#
# 규칙 4개. 목적이 다르므로 스코프도 다르고, 그래서 예외 목록이 하나도 없다.
#
#   S1 자격증명 리터럴 금지   — 코퍼스: 레포 전체(추적 + 미추적·비무시). 테스트도 포함. 예외 0
#   S2 배포 결합 리터럴 금지  — 코퍼스: 런타임 소스만(apps/console/src 빼기 테스트, + next.config.ts)
#                               **사설 IP만** 본다. 자체 도메인은 scripts/gates/check-public-safety.sh
#                               P1 소관(레포 전역 · SHA-256 대조 — 근거는 아래 스코프 상수 주석).
#   S3 서버 전용 env의 클라이언트 번들 노출 금지 — .next/static. 부재 시 **skip이 아니라 실패**
#   S4 .env 실파일 git 추적 금지 — 레포 전체
#
# 왜 규칙을 쪼갰나:
#   이전 구현의 규칙 1은 이름은 secrets인데 실제 의미가 "src 안의 모든 외부 URL 금지"였다.
#   그 잘못된 추상화 하나가 오탐 14건(xmlns·테스트 픽스처·JSDoc·템플릿 리터럴·공개 링크)과
#   탐지 실패(개인키·토큰·웹훅·DSN은 전부 통과)를 **동시에** 만들었다. 게이트는 red인 채로
#   두 번의 릴리스 태그를 통과했다 — red가 일상이 되면 게이트는 없는 것과 같다.
#   오탐은 허용리스트가 아니라 **규칙 재정의**로 없앤다(ADR-0023).
#
# 정규식 엔진을 python3 re로 못 박는 이유:
#   S1 패턴은 (?i) 인라인 플래그·\s·{10,} 를 쓰는 PCRE 문법이다. `grep -E`에서는 (?i)가
#   리터럴로 취급되고 \s 가 매칭되지 않아 **조용히 아무것도 안 잡는다**. `grep -P`는 GNU grep
#   전제라 러너·노드마다 갈린다. 그래서 bash 래퍼 + python3 히어독 한 가지로 고정한다.
#
# 이 게이트가 **못** 잡는 것(정직하게):
#   · 형식이 우리 8패턴과 다른 자격증명(사내 전용 토큰 꼴, base64 덩어리, 짧은 API 키).
#   · 값이 ${...} 보간이나 <자리표시자>로 시작하는 하드코딩 — 의도적으로 통과시킨다(오탐 원천).
#   · 커밋 **이력**에 남은 시크릿. 이 게이트는 작업 트리만 본다(이력은 git-filter-repo 영역).
#   · .gitignore된 파일 안의 시크릿(로컬 .env.local 등) — 애초에 커밋 대상이 아니다.
#   · S2: 주석인지 실행 코드인지 구분하지 않는다. 주석의 예시 도메인·IP도 걸린다 —
#     예시는 RFC 2606(example.com)·RFC 5737(192.0.2.0/24)을 쓰라는 뜻이다.
#   · S3: 번들에 **키 이름**이 남았는지만 본다. 값이 다른 이름으로 새는 것은 못 본다.
#
# usage:
#   check-no-secrets.sh                 S1~S4 전부 (기본)
#   check-no-secrets.sh --self-test     각 규칙이 자기 패턴을 실제로 잡는지 역검증
#   check-no-secrets.sh --rules S1,S2   일부 규칙만 (디버깅용)
#
# env:
#   KEIWI_SKIP_BUNDLE_CHECK=1   S3를 명시적으로 건너뛴다 → rc=2(SKIP). CI에서는 금지.
#
# exit: 0 통과 / 1 정책 위반 / 2 환경 부족(SKIP)
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
CONSOLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

exec python3 - --root "$ROOT" --console "$CONSOLE_DIR" "$@" <<'PYEOF'
import contextlib
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

# ── 스코프 상수 (한 곳에서만 정의한다) ──────────────────────────────────────
# ⚠️ 자체 보유 도메인 목록은 **여기 없다.** 이 레포는 PUBLIC이고, 목록을 여기 두면
#    "외부 진입 경로를 알리지 않는다"는 결정을 게이트 자신이 무효화한다 —
#    숨기려는 값을 정규식으로 적어 두는 것이 곧 광고다. 스코프 제외로는 못 푼다:
#    제외해도 파일 안에 값은 그대로 남기 때문이다.
#    자체 도메인 탐지는 scripts/gates/check-public-safety.sh 의 **P1**이 맡는다
#    (SHA-256 대조 + 스택 서비스명 일반 패턴, 스코프는 **레포 전역** = S2의 상위집합).
#    여기 S2는 사설 IP만 본다.

# S3가 클라이언트 번들에서 금지하는 서버 전용 env 키.
SERVER_ONLY_ENV_KEYS = [
    "PROMETHEUS_URL", "OPENSEARCH_URL", "VLLM_URL",
    "VLLM_MODEL", "GLITCHTIP_DSN", "INVENTORY_PATH",
]

# S1 — 자격증명 "형식"만 매칭한다. 형식이 엄격할수록 허용리스트가 필요 없어진다.
# 예: hardware-ops 문서의 웹훅 자리표시자는 세 번째 세그먼트가 없어 자연 통과한다.
S1_PATTERNS = [
    ("private_key",   r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    ("slack_token",   r"xox[baprs]-[0-9A-Za-z-]{10,}"),
    ("slack_webhook", r"hooks\.slack\.com/services/T[A-Z0-9]{6,}/B[A-Z0-9]{6,}/[A-Za-z0-9]{16,}"),
    ("github_token",  r"ghp_[A-Za-z0-9]{36}"),
    ("github_pat",    r"github_pat_[A-Za-z0-9_]{22,}"),
    ("sentry_dsn",    r"https?://[0-9a-f]{32}@"),
    ("tunnel_jwt",    r"eyJ[A-Za-z0-9_-]{100,}"),
    # 값이 ${(보간)·<(자리표시자)로 시작하면 하드코딩이 아니다 → 첫 글자를 제외한다.
    # ⚠️ 값 부분에서 개행을 뺀 이유(실측 오탐): python `re` 의 부정 문자 클래스는 `\n` 도
    #    매칭하므로 `[^'\"]{7,}` 은 **여러 줄을 건너뛰어** 다음 따옴표까지 삼킨다. 실제로
    #    문서에서 `password:"` 로 끝나는 문장과 40줄 뒤의 따옴표가 한 건으로 잡혔다.
    #    하드코딩된 값은 정의상 한 줄 안에 있다 — 값 부분을 한 줄로 제한한다.
    ("generic_assign",
     r"(?i)(password|passwd|secret|token|api[-_]?key)\s*[:=][^\S\n]*"
     r"['\"][^'\"${<\n][^'\"\n]{7,}['\"]"),
]

# S2 — "배포마다 달라지는 값"만 본다. localhost·127.0.0.1·github.com·www.w3.org 가
# 통과하는 것은 예외 목록이 아니라 **규칙의 정의** 때문이다(어느 배포에서도 같은 값).
# 자체 도메인은 위 주석대로 check-public-safety.sh P1 소관이다(중복 구현 금지).
S2_PATTERNS = [
    ("private_ip",
     r"\b(?:10\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3})\.\d{1,3}\b"),
]

S1_RE = [(n, re.compile(p)) for n, p in S1_PATTERNS]
S2_RE = [(n, re.compile(p)) for n, p in S2_PATTERNS]


# ── 코퍼스 ────────────────────────────────────────────────────────────────
def corpus(root):
    """추적 파일 + 미추적·비무시 파일.

    spec은 `git ls-files`(추적본)를 코퍼스로 규정하지만 여기서는 미추적·비무시 파일까지
    포함하는 **상위집합**을 쓴다 — 추적본만 보면 "새 파일에 시크릿을 넣고 add 하기 전"에는
    게이트가 침묵하고, 커밋된 다음에야 잡힌다. 커밋 자체가 유출인 규칙에서 그 순서는 늦다.
    무시된 파일(.env.local 등)은 애초에 커밋 대상이 아니므로 제외한다.
    """
    out = []
    for args in (["ls-files", "-z"], ["ls-files", "-o", "--exclude-standard", "-z"]):
        r = subprocess.run(["git", "-C", root] + args, capture_output=True)
        out += [p for p in r.stdout.decode("utf-8", "surrogateescape").split("\0") if p]
    return sorted(set(out))


def read_text(path):
    """바이너리(NUL 포함)는 건너뛴다. 텍스트는 손실 없이 최대한 읽는다."""
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        return None
    if b"\0" in data:
        return None
    return data.decode("utf-8", "replace")


def scan(paths, patterns, root="."):
    """(파일, 행, 패턴명) 히트 목록. 매칭된 **값은 절대 출력하지 않는다** —
    공개 레포의 CI 로그에 시크릿 원문을 다시 찍는 것은 유출의 반복이다."""
    hits = []
    for rel in paths:
        text = read_text(os.path.join(root, rel))
        if text is None:
            continue
        for name, rx in patterns:
            for m in rx.finditer(text):
                hits.append((rel, text[:m.start()].count("\n") + 1, name))
    return hits


def in_s2_scope(rel):
    """런타임 소스만. 테스트는 배포되지 않으므로 제외한다 — 면제가 아니라 스코프 정의다.
    (스크러버 테스트는 사설 IP 마스킹을 검증하므로 픽스처를 빼면 테스트가 무의미해진다.)"""
    if rel == "apps/console/next.config.ts":
        return True
    if not rel.startswith("apps/console/src/"):
        return False
    if re.search(r"\.test\.tsx?$", rel) or "/__tests__/" in rel:
        return False
    return True


# ── 규칙 ──────────────────────────────────────────────────────────────────
def rule_s1(ctx):
    hits = scan(ctx["files"], S1_RE, ctx["root"])
    for rel, ln, name in hits:
        print(f"FAIL(S1) {rel}:{ln} — 자격증명 리터럴 형식 [{name}]")
    if hits:
        print("  → 값을 지우고 env/시크릿 저장소로 옮겨라. 문서·픽스처면 런타임 조립으로 바꾼다.")
    return 1 if hits else 0


def rule_s2(ctx):
    files = [f for f in ctx["files"] if in_s2_scope(f)]
    hits = scan(files, S2_RE, ctx["root"])
    for rel, ln, name in hits:
        print(f"FAIL(S2) {rel}:{ln} — 배포 결합 리터럴 [{name}]")
    if hits:
        print("  → env 경유로 바꾸거나(런타임 값), 예시라면 RFC 2606 example.com ·"
              " RFC 5737 192.0.2.0/24 로 쓴다.")
    return 1 if hits else 0


def s3_scan_dir(static_dir):
    """번들 산출물에서 서버 전용 키 이름을 찾는다. (파일, 키) 목록."""
    found = []
    for dirpath, _dirs, names in os.walk(static_dir):
        for n in names:
            p = os.path.join(dirpath, n)
            text = read_text(p)
            if text is None:
                continue
            for key in SERVER_ONLY_ENV_KEYS:
                if key in text:
                    found.append((os.path.relpath(p, static_dir), key))
    return found


def rule_s3(ctx):
    static_dir = os.path.join(ctx["console"], ".next", "static")
    if os.environ.get("KEIWI_SKIP_BUNDLE_CHECK") == "1":
        # 우회는 가능하되 조용하지 않다. rc=2 라서 실행기 요약표에 SKIP으로 남는다.
        print("SKIP(S3, env: KEIWI_SKIP_BUNDLE_CHECK=1) — 번들 노출 검사가 실행되지 않았다")
        return 2
    if not os.path.isdir(static_dir):
        # fail-loud. 이전 구현은 여기서 조용히 skip했고, 그래서 CI에서 순서만 바뀌면
        # "검사가 안 돌았는데 초록"이 됐다 — 게이트 존재 자체가 거짓 안심을 준다.
        print(f"FAIL(S3) 빌드 산출물 없음: {os.path.relpath(static_dir, ctx['root'])}")
        print("  → 번들 노출 검사는 build 뒤에 돌아야 한다(CI console 잡의 스텝 순서 고정).")
        print("  → 의도적으로 건너뛰려면 KEIWI_SKIP_BUNDLE_CHECK=1 (CI에서는 금지).")
        return 1
    found = s3_scan_dir(static_dir)
    for rel, key in found:
        print(f"FAIL(S3) .next/static/{rel} — 서버 전용 키 {key} 노출")
    return 1 if found else 0


def rule_s4(ctx, tracked=None):
    if tracked is None:
        r = subprocess.run(["git", "-C", ctx["root"], "ls-files", "-z"], capture_output=True)
        tracked = [p for p in r.stdout.decode("utf-8", "surrogateescape").split("\0") if p]
    bad = [f for f in tracked
           if re.search(r"(^|/)\.env($|\.)", f) and not f.endswith(".env.example")]
    for f in bad:
        print(f"FAIL(S4) {f} — .env 실파일이 git에 추적됨")
    return 1 if bad else 0


# ── 자기 검증 ─────────────────────────────────────────────────────────────
# 픽스처를 **파일로 커밋하지 않는다**: 이 레포는 PUBLIC이고 GitHub push protection /
# secret scanning은 값의 유효성과 무관하게 **패턴만 보고** push를 차단한다. 픽스처를
# 커밋하면 게이트를 도입하는 그 PR 자체가 push 불가가 된다 — 게이트를 세우려다 게이트에
# 막히는 자기모순이다. 그래서 접두사를 분할 결합해 소스에 완전한 패턴이 존재하지 않게 하고,
# 실행 시 mktemp -d 에 써서 검사한 뒤 지운다. 커밋되는 것은 생성 로직뿐이다(ADR-0023).
def build_s1_fixtures():
    return {
        "private_key":    "-----BEGIN" + " RSA PRIVATE KEY-----",
        "slack_token":    "xox" + "b-" + "1" * 12 + "-abcdef",
        "slack_webhook":  "https://hooks.slack." + "com/services/T" + "0" * 8
                          + "/B" + "0" * 8 + "/" + "x" * 24,
        "github_token":   "ghp" + "_" + "A" * 36,
        "github_pat":     "github" + "_pat_" + "B" * 30,
        "sentry_dsn":     "https://" + "0" * 32 + "@" + "glitchtip.invalid/1",
        "tunnel_jwt":     "ey" + "J" + "Z" * 120,
        "generic_assign": "api" + "_key = " + '"' + "s3cr3t-value-long" + '"',
    }


def build_s2_fixtures():
    return {
        "private_ip":   "const h = " + '"' + "192." + "168.1.42" + '"' + ";",
    }


def self_test(ctx):
    tmp = tempfile.mkdtemp(prefix="keiwi-selftest-")
    rc = 0
    try:
        # S1 — 8패턴을 **개별로** 검증한다. 한 패턴이 죽어도 다른 패턴이 가려주면
        #      "게이트가 조용해진 것"과 "게이트가 죽은 것"을 구분할 수 없다.
        ok = 0
        for name, body in build_s1_fixtures().items():
            rel = f"s1-{name}.txt"
            with open(os.path.join(tmp, rel), "w", encoding="utf-8") as fh:
                fh.write(f"line one\n{body}\nline three\n")
            names = {n for _f, _l, n in scan([rel], S1_RE, tmp)}
            if name in names:
                ok += 1
            else:
                print(f"SELFTEST FAIL: S1 패턴 {name} 이 자기 픽스처를 못 잡았다")
        total = len(S1_PATTERNS)
        print(f"S1 detect ok ({ok}/{total} patterns)" if ok == total
              else f"S1 detect FAIL ({ok}/{total} patterns)")
        rc |= 0 if ok == total else 1

        # S2 — 스코프 판정까지 함께 검증한다(테스트 파일은 제외돼야 한다).
        s2ok = True
        for name, body in build_s2_fixtures().items():
            rel = f"s2-{name}.ts"
            with open(os.path.join(tmp, rel), "w", encoding="utf-8") as fh:
                fh.write(body + "\n")
            if name not in {n for _f, _l, n in scan([rel], S2_RE, tmp)}:
                print(f"SELFTEST FAIL: S2 패턴 {name} 이 자기 픽스처를 못 잡았다")
                s2ok = False
        if in_s2_scope("apps/console/src/lib/x.test.ts") or \
           in_s2_scope("apps/console/src/__tests__/x.ts") or \
           not in_s2_scope("apps/console/next.config.ts") or \
           not in_s2_scope("apps/console/src/app/layout.tsx"):
            print("SELFTEST FAIL: S2 스코프 판정이 계약과 다르다")
            s2ok = False
        print("S2 detect ok" if s2ok else "S2 detect FAIL")
        rc |= 0 if s2ok else 1

        # S3 — ① 키가 번들에 있으면 잡는가 ② 산출물이 없을 때 조용히 통과하지 않는가
        static_dir = os.path.join(tmp, "static")
        os.makedirs(static_dir, exist_ok=True)
        with open(os.path.join(static_dir, "chunk.js"), "w", encoding="utf-8") as fh:
            fh.write('const a="' + SERVER_ONLY_ENV_KEYS[0] + '";\n')
        detected = bool(s3_scan_dir(static_dir))
        missing_ctx = {"console": os.path.join(tmp, "no-such-app"), "root": tmp}
        env_backup = os.environ.pop("KEIWI_SKIP_BUNDLE_CHECK", None)
        # 역증명이 내는 FAIL 출력은 삼킨다 — 통과한 self-test 로그에 FAIL 문자열이 섞이면
        # 사람이 게이트가 실패했다고 오독한다. 판정은 반환값으로만 한다.
        with contextlib.redirect_stdout(io.StringIO()):
            loud = rule_s3(missing_ctx) == 1
        if env_backup is not None:
            os.environ["KEIWI_SKIP_BUNDLE_CHECK"] = env_backup
        s3ok = detected and loud
        if not detected:
            print("SELFTEST FAIL: S3 가 번들의 서버 전용 키를 못 잡았다")
        if not loud:
            print("SELFTEST FAIL: S3 가 산출물 부재를 조용히 통과시켰다")
        print("S3 detect ok" if s3ok else "S3 detect FAIL")
        rc |= 0 if s3ok else 1

        # S4 — 추적 목록을 주입해 판정 로직 자체를 검증한다(실제 레포는 green이라
        #      레포 상태만으로는 이 규칙이 살아있는지 알 수 없다).
        fake = ["apps/console/.env.example", "apps/console/.env.local", "infra/x/.env"]
        with contextlib.redirect_stdout(io.StringIO()):
            s4ok = rule_s4(ctx, tracked=fake) == 1 and rule_s4(ctx, tracked=fake[:1]) == 0
        print("S4 detect ok" if s4ok else "S4 detect FAIL")
        rc |= 0 if s4ok else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 1 if rc else 0


# ── 진입점 ────────────────────────────────────────────────────────────────
def main(argv):
    root, console, only, selftest = ".", ".", None, False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--root":
            i += 1
            root = argv[i]
        elif a == "--console":
            i += 1
            console = argv[i]
        elif a == "--rules":
            i += 1
            only = {s.strip().upper() for s in argv[i].split(",") if s.strip()}
        elif a == "--self-test":
            selftest = True
        elif a in ("-h", "--help"):
            print("usage: check-no-secrets.sh [--self-test] [--rules S1,S2,S3,S4]")
            return 64
        else:
            print(f"unknown arg: {a}", file=sys.stderr)
            return 64
        i += 1

    ctx = {"root": root, "console": console, "files": corpus(root)}
    if selftest:
        return self_test(ctx)

    rules = [("S1", rule_s1), ("S2", rule_s2), ("S3", rule_s3), ("S4", rule_s4)]
    worst = 0
    for name, fn in rules:
        if only and name not in only:
            continue
        rc = fn(ctx)
        # 1(위반)이 2(환경 부족)보다 강하다 — 위반을 SKIP으로 덮지 않는다.
        worst = 1 if (worst == 1 or rc == 1) else max(worst, rc)
    if worst == 0:
        print(f"OK: secrets check passed (S1 corpus {len(ctx['files'])} files)")
    return worst


sys.exit(main(sys.argv[1:]))
PYEOF

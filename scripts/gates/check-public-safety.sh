#!/usr/bin/env bash
# PUBLIC 레포 안전 게이트 — 공개돼선 안 되는 "운영 상세"를 기계가 막는다
#
# 왜 따로 있는가:
#   LICENSE가 "KEI 내부 전용"이어도 **코드 공개**와 **운영 상세 공개**는 다른 문제다.
#   이 레포는 포트폴리오로 PUBLIC을 유지한다는 결정이 있고(2026-08-04), 그 결정은
#   "외부 진입 경로는 존재 자체를 알리지 않는다 · 동료의 실계정을 공개하지 않는다"를
#   함께 요구한다. 사람의 주의력으로는 14개 파일에 흩어진 문자열을 못 지킨다 —
#   한 번 정화하고 끝내면 다음 PR이 그대로 되돌린다. 그래서 게이트다.
#
# 규칙 4개(P4는 위임):
#   P1 외부 진입 도메인
#      ① 자체 보유 도메인 — **SHA-256 대조**. 평문 목록을 레포에 두면 게이트 자신이
#         "숨기려던 것"을 광고한다(자기모순). 그래서 이 파일에도 도메인은 없다.
#      ② 일반 패턴 — 우리 스택의 서비스명(`grafana.`·`keiwi.`·`glitchtip.` …)이 왼쪽
#         라벨인 3라벨 이상 호스트. **새로 산 도메인**도 이쪽에서 잡힌다(해시 목록은
#         과거만 안다). RFC 2606/6761 문서용 도메인(example.com·.invalid·.test)은
#         **정의상 통과** — 허용리스트가 아니라 규칙의 일부다(ADR-0023의 교훈).
#   P2 연구자 실계정 — **SHA-256 대조**. 목록 자체가 개인정보라 평문을 두지 않는다.
#      익명화 대체본(user1~user6)은 통과한다. 5~6명 규모라 SHA-256 목록으로 충분하고,
#      HMAC·솔트는 키를 어딘가에 또 둬야 해서 이 규모에서는 순수 비용이다.
#   P3 개인 홈 하위 상세 경로 — `/home/<계정>/<무엇>` 2단계 이상에서 <계정>이 허용
#      계정이 아닌 것. P2를 **보완**한다: 목록에 없는 **처음 보는 사람**의 홈 경로는
#      해시 대조로는 못 잡지만 이 규칙에는 걸린다.
#   P4 실제 자격증명 꼴(키·토큰·웹훅·DSN·.env) — **여기서 구현하지 않는다.**
#      `apps/console/scripts/check-no-secrets.sh`(S1·S4)가 정본이다. 같은 검사를 두
#      곳에 두면 두 곳이 서로 다르게 늙는다 — 한쪽만 고친 날 조용히 커버리지가 준다.
#
# 이 게이트가 **못** 잡는 것(정직하게):
#   · **해시 목록의 오타.** 잘못 적은 해시는 영원히 아무것도 안 잡고 조용히 초록이다.
#     완화 둘: ① 자기검증이 카나리아(평문이 공개인 가짜 항목)로 **대조 기구 자체**를
#     검증한다 ② `--covers <값>` 으로 특정 값이 목록에 실제로 덮이는지 물어볼 수 있다.
#     완화일 뿐 해결이 아니다 — 목록 추가는 `--hash <값>` 출력으로 하고 손으로 적지 않는다.
#   · **철자를 바꾼 회피.** 목록의 계정이 `a_bcd`·`a.bcd` 처럼 구분자로 쪼개져 적히면
#     토큰이 갈라져 못 잡는다(숫자 접미 `abcd2` 만 한 겹 흡수한다). base64·URL 인코딩,
#     소스에서의 문자열 분할 조립도 마찬가지다 — 해시 대조는 정확 일치가 전부다.
#   · **커밋 이력.** 작업 트리만 본다. 이미 push된 이력의 정화는 git-filter-repo 영역이고
#     그건 사람이 판단한다(§11).
#   · **사설 IP·포트·노드명.** RFC1918은 외부에서 라우팅 불가라 공개돼도 무해하다는 것이
#     이 레포의 결정이다. 여기서 막지 않는다.
#   · **의미의 유출.** "data04 /home 272G를 연구자 4명이 쓴다" 같은 서술은 계정명이
#     없어도 조직 정보다. 그건 사람이 판단할 몫이지 정규식의 몫이 아니다.
#
# 값 출력 정책: 매칭된 **값은 절대 찍지 않는다**. PUBLIC 레포의 CI 로그에 그대로 남으면
#   레포에서 지워도 로그가 대신 광고한다. 파일:행과 규칙만 알려주고 나머지는 사람이 연다.
#
# usage:
#   check-public-safety.sh                 P1~P3 전부 (기본)
#   check-public-safety.sh --self-test     각 규칙 역증명(잡아야 할 것/놓쳐야 할 것)
#   check-public-safety.sh --rules P1,P3   일부 규칙만 (디버깅용)
#   check-public-safety.sh --hash <값>     목록에 넣을 SHA-256 한 줄을 만든다
#   check-public-safety.sh --covers <값>   그 값이 목록에 실제로 덮이는지 확인(평문 미저장)
#
# exit: 0 통과 / 1 정책 위반 / 2 환경 부족(SKIP)
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

command -v python3 >/dev/null 2>&1 || { echo "SKIP(env: python3)" >&2; exit 2; }

exec python3 - --root "$ROOT" "$@" <<'PYEOF'
import hashlib
import os
import re
import subprocess
import sys
import tempfile

# 이 게이트 자신은 스코프 밖이다 — 규칙을 담은 파일이 자기 규칙에 걸리면 자기모순이고,
# red를 없애려고 규칙을 지우게 된다. 레포의 기존 관례와 같다
# (check-attribution-redaction.sh 의 화이트리스트 자기참조 · check-alerting-escapes.sh 의 주석 제외).
SELF = "scripts/gates/check-public-safety.sh"

# ── 부인 목록(평문 없음) ──────────────────────────────────────────────────
# 추가: check-public-safety.sh --hash <값>  → 출력 줄을 그대로 붙여넣는다.
# 도메인은 **등록가능 도메인**(마지막 2·3 라벨)을 소문자로 해시한다.
DENY_DOMAIN_SHA256 = {
    "62fd4329e05bcafdcf0b4db2a4cf577c755089b003b8c09a0bdd4314266512fd",
}
# 계정은 소문자 토큰 그대로 해시한다.
DENY_ACCOUNT_SHA256 = {
    "1825445071d7253c5a8e2f6ea5f32ceb37f40b0434ae9adb108fbafae6c4f403",
    "94db49e0128a863ee7b59f6c3edbe9047a1795ce48c185eb31f2995eb5a863c4",
    "1571ce6aef5fb5ba7d97983b58d1af39213b2a2b837d3af9f993e5c425e774d2",
    "d7a7b4bcc75069d536997a0192c8be3a7b5ed82376769c29e454b4e4fdf208d4",
    "fb2f71d93cc9503c8c10140d8f5dc77c47d5dde6430b5fbb2c7eab8130672288",
    "818e71caae8e88b015d7748871c5323258a5a832174bc8e3d5c4a7b3d1cb2da0",
}
# 카나리아 — 평문이 **공개**인 가짜 항목. 자기검증이 "대조 기구가 살아 있는가"를 이것으로
# 본다. 진짜 항목으로는 그 검증을 할 수 없다(평문이 없으니 픽스처를 못 만든다).
CANARY_DOMAIN = "keiwi-gate-canary.example-owned"
CANARY_ACCOUNT = "keiwigatecanaryaccount"
CANARY_DOMAIN_SHA256 = "b332c6be48683a50f9fa04fb55351f7d601cf22ab34b341c6015303f884d8df0"
CANARY_ACCOUNT_SHA256 = "1791c85fe94a8d43fe733b92716d59f96b662861ed10ba94ff8d33d68c9b6ec2"

# ── P1② 일반 패턴 ────────────────────────────────────────────────────────
# 우리 관제 스택의 서비스명. `api`·`www` 같은 **일반어는 넣지 않는다** — 넣는 순간
# api.slack.com·www.w3.org 가 걸려 벤더 허용리스트를 만들어야 하고, 그 허용리스트가
# 곧 오탐의 원천이 된다(ADR-0023: 오탐은 허용리스트가 아니라 규칙 재정의로 없앤다).
STACK_SERVICE_LABELS = (
    "keiwi", "grafana", "glitchtip", "prometheus", "alertmanager", "opensearch",
    "kibana", "logstash", "filebeat", "vllm", "jupyter", "console", "logs",
    "tunnel", "vpn", "sshd",
)
# RFC 2606 / RFC 6761 — 문서·테스트 전용으로 **예약된** 이름. 소유될 수 없으므로
# 우리 진입점일 수 없다. 허용리스트가 아니라 규칙의 정의다.
DOC_DOMAINS = {"example.com", "example.net", "example.org"}
DOC_TLDS = {"invalid", "test", "localhost", "example"}

# 마지막 라벨이 **실제 TLD 꼴**일 때만 호스트로 본다. 이 표가 없으면 `logs.import.json`·
# `keiwi.system.v3` 같은 **파일명·식별자**가 전부 걸린다[실측: 도입 시 오탐 9건].
# 이것은 프로젝트 허용리스트가 아니라 **세상의 사실**이라 우리 레포와 함께 자라지 않는다
# — ADR-0023이 금지한 "오탐을 덮는 허용리스트"와 성질이 다르다.
TLD_LIKE = {
    "com", "net", "org", "io", "co", "uk", "kr", "jp", "cn", "de", "fr", "eu", "us",
    "ai", "dev", "app", "cloud", "xyz", "info", "me", "sh", "site", "online", "tech",
    "link", "cc", "page", "live", "space", "host", "pro", "biz", "work", "run", "gg",
    "tv", "fyi", "id", "in", "it", "to", "ly", "so", "team", "systems", "tools",
}
_SVC = "|".join(STACK_SERVICE_LABELS)
# ① 스킴이 붙어 있으면 TLD 표와 무관하게 호스트다(`https://grafana.<새 도메인>/…`).
P1B_URL_RE = re.compile(
    r"(?:https?://|mailto:|ssh://)(?:" + _SVC + r")\.([a-z0-9][a-z0-9-]*)\.([a-z][a-z]+)(?![A-Za-z0-9-])"
)
# ② 스킴 없이 적힌 호스트(`ALLOWED_HOSTS: grafana.<도메인>,…`)는 TLD 꼴일 때만.
P1B_BARE_RE = re.compile(
    r"(?<![A-Za-z0-9._-])(?:" + _SVC + r")"
    r"\.([a-z0-9][a-z0-9-]*)\.([a-z][a-z]+)(?![A-Za-z0-9-])"
)

# 호스트 후보(P1①). 3라벨 제한 없이 2라벨(=등록가능 도메인 그 자체)도 본다.
HOST_RE = re.compile(
    r"(?<![A-Za-z0-9._-])([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)(?![A-Za-z0-9-])"
)

# ── P2 계정 토큰 ─────────────────────────────────────────────────────────
# 비영숫자로 쪼갠다: `/home/<계정>/x`·`<계정>@host`·`user=<계정>` 이 전부 한 토큰이 된다.
TOKEN_RE = re.compile(r"[a-z][a-z0-9]{2,31}")

# ── P3 개인 홈 경로 ──────────────────────────────────────────────────────
# 2단계 이상(`/home/<계정>/<무엇>`)만 본다. `/home` 단독·`/home/<계정>` 까지는
# 마운트/용량 서술에 필요하고 그 자체로는 프로젝트를 드러내지 않는다.
# 소유자 3자 미만(`/home/a/b`)은 픽스처의 자리표시자다 — 실계정 꼴이 아니다.
HOME_RE = re.compile(r"/home/([a-z][a-z0-9._-]{2,31})/[A-Za-z0-9._-]")
# 허용 계정: 레포 소유자 본인(공개 GitHub 계정 = 이미 공개 신원)과 익명 대체본.
HOME_OWNER_ALLOW = {"mooner92", "user1", "user2", "user3", "user4", "user5", "user6"}


def sha(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def corpus(root):
    """추적 파일 + 미추적·비무시 파일. check-no-secrets.sh 와 같은 코퍼스 정의다 —
    커밋 자체가 유출인 규칙에서 "add 한 뒤에야 잡힌다"는 순서는 늦다."""
    out = []
    for args in (["ls-files", "-z"], ["ls-files", "-o", "--exclude-standard", "-z"]):
        r = subprocess.run(["git", "-C", root] + args, capture_output=True)
        out += [p for p in r.stdout.decode("utf-8", "surrogateescape").split("\0") if p]
    return sorted(set(out) - {SELF})


def read_text(path):
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        return None
    if b"\0" in data:
        return None
    return data.decode("utf-8", "replace")


def line_of(text, pos):
    return text.count("\n", 0, pos) + 1


def registrables(host):
    """`a.b.example.co.kr` → 마지막 2·3 라벨. 다단 TLD를 별도 표 없이 흡수한다."""
    parts = host.split(".")
    out = []
    if len(parts) >= 2:
        out.append(".".join(parts[-2:]))
    if len(parts) >= 3:
        out.append(".".join(parts[-3:]))
    return out


def rule_p1(files, root, deny_domains):
    hits = []
    memo = {}
    for rel in files:
        text = read_text(os.path.join(root, rel))
        if text is None:
            continue
        low = text.lower()
        # ① 해시 대조
        for m in HOST_RE.finditer(low):
            for cand in registrables(m.group(1)):
                d = memo.get(cand)
                if d is None:
                    d = memo[cand] = sha(cand)
                if d in deny_domains:
                    hits.append((rel, line_of(low, m.start()), "P1a 자체 보유 도메인"))
                    break
        # ② 일반 패턴 — 같은 지점을 두 규칙이 잡을 수 있으므로 위치로 중복 제거한다.
        seen = set()
        for rx, need_tld in ((P1B_URL_RE, False), (P1B_BARE_RE, True)):
            for m in rx.finditer(low):
                reg = "%s.%s" % (m.group(1), m.group(2))
                if reg in DOC_DOMAINS or m.group(2) in DOC_TLDS:
                    continue
                if need_tld and m.group(2) not in TLD_LIKE:
                    continue
                ln = line_of(low, m.start())
                if (ln, reg) in seen:
                    continue
                seen.add((ln, reg))
                hits.append((rel, ln, "P1b 스택 서비스 서브도메인"))
    return hits


def rule_p2(files, root, deny_accounts):
    hits = []
    memo = {}
    for rel in files:
        text = read_text(os.path.join(root, rel))
        if text is None:
            continue
        low = text.lower()
        for m in TOKEN_RE.finditer(low):
            tok = m.group(0)
            # 숫자 접미(`<계정>2`)를 한 겹 흡수한다. 그 이상의 변형은 못 잡는다(헤더 참고).
            for cand in (tok, tok.rstrip("0123456789")):
                if len(cand) < 3:
                    continue
                d = memo.get(cand)
                if d is None:
                    d = memo[cand] = sha(cand)
                if d in deny_accounts:
                    hits.append((rel, line_of(low, m.start()), "P2 연구자 실계정"))
                    break
    return hits


def rule_p3(files, root):
    hits = []
    for rel in files:
        text = read_text(os.path.join(root, rel))
        if text is None:
            continue
        for m in HOME_RE.finditer(text):
            if m.group(1).lower() in HOME_OWNER_ALLOW:
                continue
            hits.append((rel, line_of(text, m.start()), "P3 개인 홈 하위 상세 경로"))
    return hits


HINTS = {
    "P1a": "외부 진입 주소는 레포에 적지 않는다 — 내부 IP(192.168.1.105:3106·:3000) 또는 env 참조로.",
    "P1b": "우리 스택 서비스의 외부 호스트다 — 지우거나 RFC 2606 example.com 으로 쓴다.",
    "P2":  "실계정 대신 익명 대체본(user1~user6)을 쓴다. 운영에 실제 계정이 필요하면 env 주입(§13).",
    "P3":  "개인 홈 하위 경로는 프로젝트명까지 드러낸다 — 카테고리(`사용자 홈`)나 마운트까지만 적는다.",
}


def report(hits):
    for rel, ln, rule in hits:
        # 값은 찍지 않는다 — CI 로그가 레포 대신 광고하게 두지 않는다.
        print("FAIL(%s) %s:%d — %s" % (rule.split()[0], rel, ln, rule))
    shown = set()
    for _rel, _ln, rule in hits:
        key = rule.split()[0]
        if key not in shown:
            shown.add(key)
            print("  → " + HINTS[key])
    return 1 if hits else 0


# ── 자기검증 ─────────────────────────────────────────────────────────────
def self_test(root):
    tmp = tempfile.mkdtemp(prefix="keiwi-pubsafe-")
    rc = 0

    def w(name, body):
        with open(os.path.join(tmp, name), "w", encoding="utf-8") as fh:
            fh.write(body)
        return name

    def hit_rules(names, fn):
        return {h[2].split()[0] for h in fn(names)}

    # P1a — 카나리아로 **해시 대조 기구**를 검증한다(진짜 항목은 평문이 없어 픽스처 불가).
    catch = w("p1a-catch.txt", "url https://svc.%s/x\n" % CANARY_DOMAIN)
    miss = w("p1a-miss.txt", "url https://svc.not-a-canary.example-owned/x\n")
    canary_set = {CANARY_DOMAIN_SHA256}
    got = hit_rules([catch], lambda n: rule_p1(n, tmp, canary_set))
    quiet = hit_rules([miss], lambda n: rule_p1(n, tmp, canary_set))
    p1a_ok = ("P1a" in got) and ("P1a" not in quiet)
    print("P1a detect ok" if p1a_ok else "P1a detect FAIL (해시 대조 기구가 죽었다)")
    rc |= 0 if p1a_ok else 1

    # 목록 위생 — 64자 hex인가, 카나리아가 진짜 목록에 섞여 있지 않은가.
    hexok = all(re.fullmatch(r"[0-9a-f]{64}", h)
                for h in list(DENY_DOMAIN_SHA256) + list(DENY_ACCOUNT_SHA256))
    sane = (hexok and DENY_DOMAIN_SHA256 and DENY_ACCOUNT_SHA256
            and CANARY_DOMAIN_SHA256 not in DENY_DOMAIN_SHA256
            and CANARY_ACCOUNT_SHA256 not in DENY_ACCOUNT_SHA256
            and sha(CANARY_DOMAIN) == CANARY_DOMAIN_SHA256
            and sha(CANARY_ACCOUNT) == CANARY_ACCOUNT_SHA256)
    print("목록 위생 ok" if sane else "목록 위생 FAIL (해시 형식·카나리아 정합성)")
    rc |= 0 if sane else 1

    # P1b — 스택 서비스명 + 실도메인은 잡고, 문서용 도메인과 벤더 URL은 놓쳐야 한다.
    b_catch = w("p1b-catch.md",
                "https://grafana.acme-corp.com/d/x\n"          # 스킴 있음
                "ALLOWED_HOSTS: glitchtip.acme-corp.io,localhost\n"   # 스킴 없음 + TLD 꼴
                "https://logs.acme-corp.zzunknowntld/x\n")     # 낯선 TLD도 스킴이 있으면 잡는다
    b_miss = w("p1b-miss.md",
               "https://grafana.example.com/d/x\nhttps://api.slack.com/x\n"
               "https://www.w3.org/2000/svg\nhttps://grafana.com/docs\n"
               "https://svc.thing.invalid/x\n"
               # 파일명·식별자는 호스트가 아니다 — 도입 시 오탐 9건의 정체다.
               "logs.import.json 과 logs.json 이 둘 다 uid=keiwi-logs\n"
               "console.log.debug(a.gpus.sort())\n")
    p1b_ok = ("P1b" in hit_rules([b_catch], lambda n: rule_p1(n, tmp, set()))
              and not hit_rules([b_miss], lambda n: rule_p1(n, tmp, set())))
    print("P1b detect ok" if p1b_ok else "P1b detect FAIL")
    rc |= 0 if p1b_ok else 1

    # P2 — 카나리아 계정. 접미 숫자 흡수와 "다른 이름은 안 잡는다"를 함께 본다.
    a_catch = w("p2-catch.txt", "ssh %s@10.0.0.1\nuser=%s7\n" % (CANARY_ACCOUNT, CANARY_ACCOUNT))
    a_miss = w("p2-miss.txt", "user1 user6 jdoe %sx\n" % CANARY_ACCOUNT)
    canary_acc = {CANARY_ACCOUNT_SHA256}
    p2_ok = ("P2" in hit_rules([a_catch], lambda n: rule_p2(n, tmp, canary_acc))
             and not hit_rules([a_miss], lambda n: rule_p2(n, tmp, canary_acc)))
    print("P2 detect ok" if p2_ok else "P2 detect FAIL")
    rc |= 0 if p2_ok else 1

    # P3 — 모르는 사람의 홈 경로는 잡고, 허용 계정·자리표시자·1단계는 놓쳐야 한다.
    h_catch = w("p3-catch.md", "/home/zzzstranger/thesis-2026/train.py\n")
    h_miss = w("p3-miss.md",
               "/home/mooner92/keiwi-design/apps\n/home/user6/venv3\n"
               "/home/<user>/x\n/home/$USER/x\n/home/a/b\n/home 303G\n")
    p3_ok = ("P3" in hit_rules([h_catch], lambda n: rule_p3(n, tmp))
             and not hit_rules([h_miss], lambda n: rule_p3(n, tmp)))
    print("P3 detect ok" if p3_ok else "P3 detect FAIL")
    rc |= 0 if p3_ok else 1

    # P4 위임이 실재하는가 — 참조만 하고 구현하지 않기로 했으므로, 그 참조 대상이
    # 사라지면 커버리지에 구멍이 뚫린 채 이 게이트는 계속 초록이다.
    delegate = os.path.join(root, "apps/console/scripts/check-no-secrets.sh")
    p4_ok = os.path.isfile(delegate)
    print("P4 위임 대상 존재 ok" if p4_ok
          else "P4 위임 FAIL: apps/console/scripts/check-no-secrets.sh 가 없다 — 자격증명 검사가 사라졌다")
    rc |= 0 if p4_ok else 1

    for n in os.listdir(tmp):
        os.remove(os.path.join(tmp, n))
    os.rmdir(tmp)
    return 1 if rc else 0


def main(argv):
    root, only = ".", None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--root":
            i += 1
            root = argv[i]
        elif a == "--rules":
            i += 1
            only = {s.strip().upper() for s in argv[i].split(",") if s.strip()}
        elif a == "--self-test":
            return self_test(root)
        elif a == "--hash":
            i += 1
            v = argv[i].strip().lower()
            print('    "%s",   # len=%d' % (sha(v), len(v)))
            return 0
        elif a == "--covers":
            i += 1
            v = argv[i].strip().lower()
            d = sha(v)
            where = []
            if d in DENY_DOMAIN_SHA256:
                where.append("DENY_DOMAIN_SHA256")
            if d in DENY_ACCOUNT_SHA256:
                where.append("DENY_ACCOUNT_SHA256")
            for reg in registrables(v):
                if sha(reg) in DENY_DOMAIN_SHA256:
                    where.append("DENY_DOMAIN_SHA256(등록가능 도메인)")
                    break
            print("COVERED by %s" % ", ".join(sorted(set(where))) if where
                  else "NOT COVERED — 목록에 없다(--hash 로 줄을 만들어 추가하라)")
            return 0
        elif a in ("-h", "--help"):
            print("usage: check-public-safety.sh [--self-test] [--rules P1,P2,P3] "
                  "[--hash <값>] [--covers <값>]")
            return 64
        else:
            print("unknown arg: %s" % a, file=sys.stderr)
            return 64
        i += 1

    files = corpus(root)
    hits = []
    if not only or "P1" in only:
        hits += rule_p1(files, root, DENY_DOMAIN_SHA256)
    if not only or "P2" in only:
        hits += rule_p2(files, root, DENY_ACCOUNT_SHA256)
    if not only or "P3" in only:
        hits += rule_p3(files, root)
    rc = report(hits)
    if rc == 0:
        print("PUBLIC_SAFETY_OK (P1 도메인 · P2 실계정 · P3 홈 경로 — corpus %d files)"
              % len(files))
        print("  P4(자격증명 꼴)는 apps/console/scripts/check-no-secrets.sh 소관 — 여기서 중복 구현하지 않는다.")
    else:
        print("PUBLIC_SAFETY_FAIL — 이 레포는 PUBLIC이다. 값은 로그에 찍지 않았다(파일을 열어라).")
    return rc


sys.exit(main(sys.argv[1:]))
PYEOF

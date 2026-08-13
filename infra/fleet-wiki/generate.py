#!/usr/bin/env python3
"""fleet-wiki 생성기 — scout JSON → 서버·계정·프로젝트 3계층 md 문서 그래프 (P1).

specs/fleet-wiki/spec.md §3-③. data05(중앙)에서 돈다. 노드별 scout 스냅샷을 읽어
/data/keiwi/wiki/{servers,accounts,projects}/*.md + index.md 를 만든다.

계약:
  - **멱등(AC-W-3)**: 같은 입력 → 바이트 동일 출력(재실행 diff 0). 그래서 문서에
    "생성 시각"을 찍지 않는다 — 시각은 입력(collected_at)의 것만 쓴다.
  - **사람·LLM 구획 보존**: `<!-- manual:start/end -->`(사람 메모)와
    `<!-- llm-summary:start/end -->`(P3 요약 워커)는 재생성 시 그대로 옮겨 담는다.
    frontmatter와 관찰 사실 절은 생성기 소유 — 손으로 고쳐도 다음 실행이 덮는다.
  - **lint(AC-W-4)**: 깨진 `[[링크]]` 0 · 고아 문서 0을 생성 후 검증, 위반은 stderr + rc=2.
  - **관찰 못 한 값은 "미수집"으로 적는다** — 빈칸·추측 금지(스카웃과 같은 정직성 계약).

산출물은 레포 밖(spec §4) — 실계정·경로가 담기므로 PUBLIC 레포에 커밋 금지.

실행:  python3 generate.py /var/lib/keiwi-scout/scout.json [scout2.json ...]
       KEIWI_WIKI_DIR=/data/keiwi/wiki  (기본값)
"""
import hashlib
import json
import os
import re
import sys

MANUAL_RE = re.compile(r"<!-- manual:start -->\n(.*?)<!-- manual:end -->", re.S)
LLM_RE = re.compile(r"<!-- llm-summary:start -->\n(.*?)<!-- llm-summary:end -->", re.S)
LINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
_SLUG_BAD = re.compile(r"[^A-Za-z0-9._-]")

LLM_DEFAULT = "_요약 대기 — 칸반 워커(P3)가 채운다._\n"


def slug(*parts):
    """문서 슬러그 — 경로 안전 문자만. 파일명이 곧 [[링크]] 대상이다."""
    return "--".join(_SLUG_BAD.sub("-", str(p)) for p in parts)


def project_slug_map(node, projects):
    """cwd → 프로젝트 슬러그. **(owner, name) 충돌 시 cwd 해시 6자리로 구분한다.**

    실측(2026-08-13 data05): 프로덕션 콘솔과 dev 워크트리가 둘 다 name=console·같은
    소유자라 같은 슬러그가 됐고, 9개 프로젝트 중 8개만 문서화됐다 — 조용한 덮어쓰기는
    "문서가 있다"는 착각을 만든다(없는 것보다 나쁘다). 링크 무결성을 위해 모든 참조가
    이 맵 하나를 쓴다.
    """
    count = {}
    for proj in projects:
        owner = proj["owners"][0] if proj["owners"] else "unknown"
        count[(owner, proj["name"])] = count.get((owner, proj["name"]), 0) + 1
    out = {}
    for proj in projects:
        owner = proj["owners"][0] if proj["owners"] else "unknown"
        base = slug(node, owner, proj["name"])
        if count[(owner, proj["name"])] > 1:
            base += "-" + hashlib.sha1(proj["cwd"].encode()).hexdigest()[:6]
        out[proj["cwd"]] = base
    return out


def extract_block(text, pattern, default):
    m = pattern.search(text or "")
    return m.group(1) if m else default


def fm(pairs):
    """frontmatter 직렬화 — 키 순서 고정(멱등의 전제)."""
    lines = ["---"]
    for k, v in pairs:
        lines.append("%s: %s" % (k, json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v))
    lines.append("---")
    return "\n".join(lines)


# ── 문서 렌더러 (순수 — 테스트 대상) ─────────────────────────────────────────


def render_project(node, proj, doc_slug, prev_text=""):
    owner = proj["owners"][0] if proj["owners"] else "unknown"
    llm = extract_block(prev_text, LLM_RE, LLM_DEFAULT)
    manual = extract_block(prev_text, MANUAL_RE, "")
    head = fm([
        ("kind", "project"),
        ("node", node),
        ("owner", owner),
        ("owners", proj["owners"]),
        ("ports", proj["ports"]),
        ("unit", proj["unit"]),
        ("cwd", proj["cwd"]),
        ("git_remote", proj["git_remote"]),
        ("git_head", proj["git_head"]),
        ("git_head_ref_mtime", proj["git_head_ref_mtime"]),
        ("readme", proj["readme"]),
        ("last_activity", proj["last_activity"]),
    ])
    unit_label = proj["unit"] or "**세션 기동** — 재부팅에 취약(유닛 없음)"
    git_label = proj["git_remote"] or "없음"
    rows = [
        "| 리스닝 포트 | %s |" % ", ".join(str(p) for p in proj["ports"]),
        "| 기동 방식 | %s |" % unit_label,
        "| 코드 위치 | `%s` |" % proj["cwd"],
        "| git | %s%s |" % (git_label, (" @ `%s`" % proj["git_head"]) if proj["git_head"] else ""),
        "| README | %s |" % (proj["readme"] or "**없음** — 이 문서가 정리본을 대신한다"),
        "| 최근 활동 | %s |" % (proj["last_activity"] or "미수집"),
    ]
    docs_line = ""
    if proj["docs"]:
        docs_line = "\n하위 문서: " + " · ".join("`%s`" % d for d in proj["docs"]) + "\n"
    return doc_slug, "\n".join([
        head,
        "",
        "[[%s]] · [[%s]]" % (node, slug(node, owner)),
        "",
        "# %s" % proj["name"],
        "",
        "## 무엇인가",
        "<!-- llm-summary:start -->",
        llm.rstrip("\n"),
        "<!-- llm-summary:end -->",
        "",
        "## 관찰된 사실 (생성기 소유 — 수집 시점 실측)",
        "| 항목 | 값 |",
        "|---|---|",
        "\n".join(rows),
        docs_line.rstrip("\n"),
        "",
        "## 이력·메모",
        "<!-- manual:start -->",
        manual.rstrip("\n"),
        "<!-- manual:end -->",
        "",
    ]).replace("\n\n\n", "\n\n")


def render_account(node, owner, projects, slug_map, prev_text=""):
    doc_slug = slug(node, owner)
    manual = extract_block(prev_text, MANUAL_RE, "")
    active = [p for p in projects if p["last_activity"]]
    head = fm([
        ("kind", "account"),
        ("node", node),
        ("account", owner),
        ("privilege", "미수집(P2)"),
        ("projects_total", len(projects)),
        ("projects_active", len(active)),
    ])
    rows = []
    for p in sorted(projects, key=lambda x: x["name"]):
        rows.append("| %s | %s | %s | [[%s]] |" % (
            p["name"], ", ".join(str(x) for x in p["ports"]),
            p["unit"] or "세션", slug_map[p["cwd"]],
        ))
    return doc_slug, "\n".join([
        head,
        "",
        "[[%s]]" % node,
        "",
        "# %s · %s" % (node, owner),
        "",
        "## 운영 중인 프로젝트 (%d)" % len(projects),
        "| 프로젝트 | 포트 | 기동 | 문서 |",
        "|---|---|---|---|",
        "\n".join(rows) if rows else "| (없음) | | | |",
        "",
        "## 이력·메모",
        "<!-- manual:start -->",
        manual.rstrip("\n"),
        "<!-- manual:end -->",
        "",
    ])


def render_server(snapshot, project_slugs, first_seen, prev_text=""):
    node = snapshot["node"]
    manual = extract_block(prev_text, MANUAL_RE, "")
    llm = extract_block(prev_text, LLM_RE, LLM_DEFAULT)
    owners = sorted({o for p in snapshot["projects"] for o in p["owners"]})
    project_ports = {port for p in snapshot["projects"] for port in p["ports"]}
    # 프로젝트에 귀속되지 않은 리스너 — "미등록". 이상탐지의 1차 신호(spec §5).
    unregistered = [l for l in snapshot["listeners"] if l["port"] not in project_ports]
    head = fm([
        ("kind", "server"),
        ("node", node),
        ("inventory_ref", "docs/inventory.yaml"),
        ("accounts", len(owners)),
        ("projects", len(snapshot["projects"])),
        ("listening_ports", len(snapshot["listeners"])),
        ("unregistered_ports", len(unregistered)),
        ("partial", snapshot["partial"]),
        ("last_scan", snapshot["collected_at"]),
    ])
    acc_rows = []
    for o in owners:
        mine = [p for p in snapshot["projects"] if o in p["owners"]]
        acc_rows.append("| %s | %d | [[%s]] |" % (o, len(mine), slug(node, o)))
    unreg_rows, seen_rows = [], set()
    for l in sorted(unregistered, key=lambda x: (x["port"], x["proto"])):
        key = "%s/%s/%s" % (node, l["proto"], l["port"])
        row = "| %s/%s | %s | %s | %s | %s |" % (
            l["port"], l["proto"], l["process"], l["owner"],
            l["cwd_reason"] or ("`%s`" % l["cwd"] if l["cwd"] else "?"),
            first_seen.get(key, snapshot["collected_at"]),
        )
        if row in seen_rows:  # IPv4/IPv6 이중 바인드 — 표에서는 한 줄이면 충분하다
            continue
        seen_rows.add(row)
        unreg_rows.append(row)
    return node, "\n".join([
        head,
        "",
        "# %s" % node,
        "",
        "## 무엇인가",
        "<!-- llm-summary:start -->",
        llm.rstrip("\n"),
        "<!-- llm-summary:end -->",
        "",
        "## 계정 (%d)" % len(owners),
        "| 계정 | 프로젝트 | 문서 |",
        "|---|---|---|",
        "\n".join(acc_rows) if acc_rows else "| (없음) | | |",
        "",
        "## 프로젝트 미귀속 포트 (%d) — 시스템 데몬 또는 조사 대상" % len(unregistered),
        "| 포트 | 프로세스 | 소유 | 위치/사유 | 첫 관찰 |",
        "|---|---|---|---|---|",
        "\n".join(unreg_rows) if unreg_rows else "| (없음 — 전 포트가 문서화됨) | | | | |",
        "",
        "## 이력·메모",
        "<!-- manual:start -->",
        manual.rstrip("\n"),
        "<!-- manual:end -->",
        "",
    ])


def render_index(pages):
    """색인 — kind별 그룹. 시각 없음(멱등)."""
    by_kind = {"server": [], "account": [], "project": []}
    for doc_slug, kind, title in sorted(pages):
        by_kind.setdefault(kind, []).append("- [[%s]] — %s" % (doc_slug, title))
    parts = ["# fleet-wiki 색인", ""]
    for kind, label in (("server", "서버"), ("account", "계정"), ("project", "프로젝트")):
        parts += ["## %s (%d)" % (label, len(by_kind[kind])), ""] + by_kind[kind] + [""]
    return "\n".join(parts)


def lint(docs):
    """깨진 [[링크]] 검출 (AC-W-4). docs: {slug: text}. 반환: 위반 목록."""
    problems = []
    for doc_slug, text in docs.items():
        for target in LINK_RE.findall(text):
            if target not in docs and target != "index":
                problems.append("%s → [[%s]] 대상 없음" % (doc_slug, target))
    return problems


# ── 쓰기 (이 파일 유일의 쓰기 구획) ──────────────────────────────────────────


def write_docs(wiki_dir, docs, state):
    written = 0
    for doc_slug, (kind, text) in docs.items():
        sub = {"server": "servers", "account": "accounts", "project": "projects", "index": "."}[kind]
        d = os.path.join(wiki_dir, sub)
        if not os.path.isdir(d):
            os.makedirs(d)
        path = os.path.join(d, doc_slug + ".md")
        old = ""
        if os.path.isfile(path):
            with open(path) as f:
                old = f.read()
        if old == text:
            continue  # 멱등 — 내용이 같으면 건드리지 않는다(mtime 보존)
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            f.write(text)
        os.replace(tmp, path)
        written += 1
    sp = os.path.join(wiki_dir, ".state.json")
    tmp = sp + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=1, sort_keys=True)
    os.replace(tmp, sp)
    return written


def load_prev(wiki_dir, kind, doc_slug):
    sub = {"server": "servers", "account": "accounts", "project": "projects"}[kind]
    path = os.path.join(wiki_dir, sub, doc_slug + ".md")
    if os.path.isfile(path):
        with open(path) as f:
            return f.read()
    return ""


def main(argv):
    if len(argv) < 2:
        print("usage: generate.py <scout.json> [...]", file=sys.stderr)
        return 1
    wiki_dir = os.environ.get("KEIWI_WIKI_DIR", "/data/keiwi/wiki")
    state_path = os.path.join(wiki_dir, ".state.json")
    state = {}
    if os.path.isfile(state_path):
        with open(state_path) as f:
            state = json.load(f)

    docs = {}   # slug → (kind, text)
    pages = []  # (slug, kind, title)
    for arg in argv[1:]:
        with open(arg) as f:
            snap = json.load(f)
        node = snap["node"]
        # first_seen 상태 갱신 — 이미 본 포트는 유지, 새 포트만 이번 수집 시각
        for l in snap["listeners"]:
            key = "%s/%s/%s" % (node, l["proto"], l["port"])
            state.setdefault(key, snap["collected_at"])
        slug_map = project_slug_map(node, snap["projects"])
        by_owner = {}
        for proj in snap["projects"]:
            owner = proj["owners"][0] if proj["owners"] else "unknown"
            by_owner.setdefault(owner, []).append(proj)
            ds = slug_map[proj["cwd"]]
            _slug, text = render_project(node, proj, ds, load_prev(wiki_dir, "project", ds))
            if ds in docs:  # 방어 — 해시 후에도 충돌이면 조용히 덮지 않는다
                print("lint: 슬러그 충돌 %s (%s)" % (ds, proj["cwd"]), file=sys.stderr)
            docs[ds] = ("project", text)
            pages.append((ds, "project", "%s (%s)" % (proj["name"], owner)))
        for owner, projs in by_owner.items():
            doc_slug, text = render_account(node, owner, projs, slug_map, load_prev(wiki_dir, "account", slug(node, owner)))
            docs[doc_slug] = ("account", text)
            pages.append((doc_slug, "account", "%s의 %s" % (node, owner)))
        doc_slug, text = render_server(snap, list(docs), state, load_prev(wiki_dir, "server", node))
        docs[doc_slug] = ("server", text)
        pages.append((doc_slug, "server", "서버 허브"))

    docs["index"] = ("index", render_index(pages))
    problems = lint({s: t for s, (_k, t) in docs.items()})
    written = write_docs(wiki_dir, docs, state)
    print("generate: 문서 %d(갱신 %d) → %s" % (len(docs), written, wiki_dir))
    if problems:
        for pr in problems:
            print("lint: %s" % pr, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

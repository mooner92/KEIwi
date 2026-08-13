#!/usr/bin/env python3
"""fleet-wiki scout — 열린 포트에서 거꾸로 프로젝트를 찾는 노드 수집기 (P0).

specs/fleet-wiki/spec.md §3-①. 파이프라인: ss(리스닝 소켓) → /proc/<pid>/{cwd,exe,cgroup}
→ uid→계정 → .git 직접 읽기(remote·HEAD) → README·docs 목록 → JSON 한 파일.

원칙(수집기 read-only 규율 — check-collector-readonly.sh와 같은 계약):
  - **노드에서는 읽기만 한다.** 파괴 명령 0, 리다이렉션 0. 쓰기는 write_snapshot() 단 한
    함수 안의 원자적 tmp+rename뿐이다.
  - **git을 subprocess로 실행하지 않는다** — root가 사용자 repo에서 git을 돌리면
    dubious-ownership 등 부작용 경계가 생긴다. .git/config·HEAD·refs를 **파일로만** 읽는다.
    (그래서 head_date는 커밋 날짜가 아니라 ref 파일 mtime이다 — 근사값임을 스키마에 명시)
  - **모르면 null + reason.** 권한 부족으로 cwd를 못 읽으면 침묵이 아니라 사유를 적는다
    (AC-W-1 — "측정 못 함"이 "없음"으로 보이면 안 된다는 이 레포의 원칙 그대로).

stdlib only · py3.6 호환(data01 대비, port-exporter와 동일 제약) · root 권장(root가 아니면
타 계정 프로세스의 cwd가 permission-denied로 남는다 — 그것도 정직하게 기록된다).

실행:  KEIWI_SCOUT_NODE=data05 python3 scout.py          # /var/lib/keiwi-scout/scout.json
       KEIWI_SCOUT_OUT=/tmp/scout.json python3 scout.py  # 출력 경로 변경(PoC)
"""
import json
import os
import pwd
import re
import socket
import subprocess
import sys
import time

SCHEMA_VERSION = 1
_PROC_RE = re.compile(r'\(\("([^"]+)",pid=(\d+)')
# README 후보 — 대소문자 변형은 listdir에서 소문자 비교로 흡수한다.
_README_NAMES = ("readme.md", "readme.rst", "readme.txt", "readme")
_DOCS_DIRS = ("docs", "doc")
# 프로젝트로 보지 않는 cwd — 데몬의 관습적 작업 디렉터리(정보가 없다).
_NON_PROJECT_CWD = ("/", "/root", "/tmp", "/var", "/run", "/usr", "/etc")


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def user_for_pid(pid):
    """PID 소유 계정명 — port-exporter와 같은 폴백 계약(unknown / uid:<n>)."""
    try:
        with open("/proc/%s/status" % pid) as f:
            for line in f:
                if line.startswith("Uid:"):
                    uid = int(line.split()[1])
                    try:
                        return pwd.getpwuid(uid).pw_name
                    except KeyError:
                        return "uid:%d" % uid
    except Exception:
        pass
    return "unknown"


def parse_ss_output(text):
    """`ss -tulnp` 출력 → [(proto, port, process, pid)] (순수 — 테스트 대상)."""
    rows = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0] not in ("tcp", "udp"):
            continue
        local = parts[4]
        port = local.rsplit(":", 1)[-1]
        if not port.isdigit():
            continue
        m = _PROC_RE.search(line)
        proc, pid = (m.group(1), m.group(2)) if m else ("unknown", None)
        rows.append((parts[0], port, proc, pid))
    return rows


def read_cwd(pid):
    """/proc/<pid>/cwd → (경로|None, 사유|None). 실패 사유를 삼키지 않는다(AC-W-1)."""
    try:
        return os.readlink("/proc/%s/cwd" % pid), None
    except PermissionError:
        return None, "권한 없음(root 아님)"
    except FileNotFoundError:
        return None, "프로세스 소멸"
    except OSError as exc:
        return None, "읽기 실패: %s" % exc.__class__.__name__


def read_unit(pid):
    """systemd 유닛명 — /proc/<pid>/cgroup에서. 세션 기동(사용자 슬라이스)이면 None."""
    try:
        with open("/proc/%s/cgroup" % pid) as f:
            for line in f:
                m = re.search(r"/([^/]+\.service)\s*$", line.strip())
                if m and not m.group(1).startswith("user@"):
                    return m.group(1)
    except Exception:
        pass
    return None


def redact_remote_url(url):
    """remote URL에서 자격증명 제거 (순수 — 테스트 대상).

    실측(2026-08-13 data05 PoC): 한 프로젝트의 .git/config remote가
    https://<user>:ghp_...@github.com/... 꼴 — **PAT 평문**이었다. 수집기가 이것을
    그대로 실으면 위키 파이프라인 전체(JSON→md→콘솔→RAG)가 자격증명 유통 경로가 된다.
    http(s) URL의 userinfo(user 또는 user:token)는 **무조건 버린다** — 위키에 필요한
    것은 "어느 repo인가"이지 "어떻게 인증하는가"가 아니다. scp/ssh 꼴(git@host:path)의
    사용자명은 표준 관례라 유지한다(비밀 아님).
    """
    if not url:
        return url
    m = re.match(r"^(https?://)[^/@]+@(.+)$", url)
    if m:
        return m.group(1) + m.group(2)
    return url


def parse_git_config(text):
    """`.git/config` 원문 → origin url|None (순수 — 테스트 대상). 첫 remote 폴백."""
    url, in_origin, in_remote, first = None, False, False, None
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("["):
            in_remote = line.startswith('[remote "')
            in_origin = line == '[remote "origin"]'
            continue
        if in_remote and line.startswith("url"):
            value = line.split("=", 1)[1].strip() if "=" in line else None
            if in_origin:
                return value
            if first is None:
                first = value
    return url or first


def read_git(cwd):
    """`.git`을 파일로만 읽어 (remote, head_sha, head_ref_mtime_iso). 없으면 (None,)*3.

    git 워크트리(`gitdir: <path>` 파일)도 따라간다. head_date는 **ref 파일 mtime 근사**다
    — 커밋 날짜가 필요해지면 P1 생성기(data05, 자기 소유 파일)에서 보강한다.
    """
    try:
        git_dir = os.path.join(cwd, ".git")
        if os.path.isfile(git_dir):  # worktree/submodule: "gitdir: <실제 경로>"
            with open(git_dir) as f:
                first = f.readline().strip()
            if first.startswith("gitdir:"):
                git_dir = os.path.join(cwd, first.split(":", 1)[1].strip())
        if not os.path.isdir(git_dir):
            return None, None, None
        remote = None
        cfg = os.path.join(git_dir, "config")
        if os.path.isfile(cfg):
            with open(cfg) as f:
                remote = redact_remote_url(parse_git_config(f.read()))
        sha, mtime = None, None
        head_path = os.path.join(git_dir, "HEAD")
        with open(head_path) as f:
            head = f.read().strip()
        if head.startswith("ref:"):
            ref = head.split(":", 1)[1].strip()
            ref_path = os.path.join(git_dir, ref)
            if os.path.isfile(ref_path):
                with open(ref_path) as f:
                    sha = f.read().strip()[:12]
                mtime = os.path.getmtime(ref_path)
            else:  # packed-refs
                packed = os.path.join(git_dir, "packed-refs")
                if os.path.isfile(packed):
                    with open(packed) as f:
                        for line in f:
                            if line.strip().endswith(ref):
                                sha = line.split()[0][:12]
                                break
                    mtime = os.path.getmtime(packed)
        else:  # detached HEAD
            sha, mtime = head[:12], os.path.getmtime(head_path)
        mtime_iso = (
            time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(mtime)) if mtime else None
        )
        return remote, sha, mtime_iso
    except Exception:
        # git 내부 구조가 예상과 다르면 "git 아님"이 아니라 "판독 실패"지만, P0에서는
        # 둘 다 null로 접는다 — AC-W-2의 계약은 "추측 금지"이고 null은 추측이 아니다.
        return None, None, None


def scan_project_docs(cwd):
    """(readme경로|None, docs 목록[상위 20], 최근활동 iso|None) — 얕은 스캔(깊이 1)."""
    readme, docs, last = None, [], None
    try:
        entries = os.listdir(cwd)
    except Exception:
        return None, [], None
    for name in entries:
        low = name.lower()
        full = os.path.join(cwd, name)
        if readme is None and low in _README_NAMES and os.path.isfile(full):
            readme = name
        if low in _DOCS_DIRS and os.path.isdir(full):
            try:
                docs = sorted(
                    os.path.join(name, d) for d in os.listdir(full) if d.lower().endswith(".md")
                )[:20]
            except Exception:
                pass
        try:  # 최근 활동 근사 — 상위 엔트리 mtime 최댓값(깊은 walk는 사건 노드에 부담)
            mt = os.path.getmtime(full)
            if last is None or mt > last:
                last = mt
        except Exception:
            pass
    last_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(last)) if last else None
    return readme, docs, last_iso


def build_snapshot(rows, node):
    """ss 행들 → 스냅샷 dict (순수 조립 — pid 조회 함수들은 주입 없이 직접 호출)."""
    listeners, projects = [], {}
    seen = set()
    for proto, port, proc, pid in rows:
        key = (proto, port, pid)
        if key in seen:
            continue
        seen.add(key)
        owner = user_for_pid(pid) if pid else "unknown"
        cwd, reason = read_cwd(pid) if pid else (None, "pid 미상(ss -p 권한 없음)")
        listeners.append(
            {
                "proto": proto,
                "port": int(port),
                "process": proc,
                "pid": int(pid) if pid else None,
                "owner": owner,
                "cwd": cwd,
                "cwd_reason": reason,
            }
        )
        if not cwd or cwd in _NON_PROJECT_CWD:
            continue
        slot = projects.setdefault(
            cwd, {"cwd": cwd, "owners": set(), "ports": set(), "units": set(), "pids": set()}
        )
        slot["owners"].add(owner)
        slot["ports"].add(int(port))
        slot["pids"].add(int(pid))
        unit = read_unit(pid)
        if unit:
            slot["units"].add(unit)

    out_projects = []
    for cwd, slot in sorted(projects.items()):
        remote, sha, sha_date = read_git(cwd)
        readme, docs, last_activity = scan_project_docs(cwd)
        out_projects.append(
            {
                "cwd": cwd,
                "name": os.path.basename(cwd.rstrip("/")) or cwd,
                "owners": sorted(slot["owners"]),
                "ports": sorted(slot["ports"]),
                "unit": sorted(slot["units"])[0] if slot["units"] else None,
                "git_remote": remote,
                "git_head": sha,
                "git_head_ref_mtime": sha_date,  # 커밋 날짜 아님 — ref 파일 mtime 근사
                "readme": readme,
                "docs": docs,
                "last_activity": last_activity,
            }
        )
    unresolved = sum(1 for entry in listeners if entry["cwd"] is None)
    return {
        "schema": SCHEMA_VERSION,
        "node": node,
        "collected_at": now_iso(),
        "collector_uid": os.getuid(),
        # partial: root가 아니어서(또는 소멸 경합으로) cwd를 못 푼 리스너가 있다 —
        # 소비자(생성기)가 "전수"와 "부분"을 구분할 수 있어야 한다(AC-W-1).
        "partial": unresolved > 0,
        "unresolved_listeners": unresolved,
        "listeners": listeners,
        "projects": out_projects,
    }


def write_snapshot(snapshot, out_path):
    """이 파일 유일의 쓰기 지점 — 같은 디렉터리 tmp에 쓰고 원자적 rename."""
    out_dir = os.path.dirname(out_path) or "."
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    tmp = out_path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, out_path)


def main():
    node = os.environ.get("KEIWI_SCOUT_NODE") or socket.gethostname().split(".")[0]
    out_path = os.environ.get("KEIWI_SCOUT_OUT", "/var/lib/keiwi-scout/scout.json")
    try:
        run = subprocess.run(
            ["ss", "-tulnp"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            timeout=20,
        )
        text = run.stdout
    except Exception as exc:
        print("scout: ss 실행 실패 — %s" % exc, file=sys.stderr)
        return 1
    snapshot = build_snapshot(parse_ss_output(text), node)
    write_snapshot(snapshot, out_path)
    print(
        "scout: %s 리스너 %d(미해결 %d) · 프로젝트 %d → %s"
        % (
            node,
            len(snapshot["listeners"]),
            snapshot["unresolved_listeners"],
            len(snapshot["projects"]),
            out_path,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

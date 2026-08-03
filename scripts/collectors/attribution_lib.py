#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T-E4-1·T-E4-2·T-E4-3 — 디스크 귀속 수집기의 파서·상관·요약 (specs/alert-enrichment §4.2).

역할 분리(이 파일이 존재하는 이유):
    disk-attribution.sh  = 노드에서 **읽기만** 한다(df·du·find). 상태를 남기지 않는다.
    attribution_lib.py   = 그 원문을 해석하고, data05 로컬에 스냅샷을 남기고,
                           OpenSearch·로컬 vLLM과 상관시킨다. **원문(raw)을 다루는 곳.**
    attribution_export.py= Slack 반출본을 만드는 **유일한** 경로. raw 를 절대 모른다.

프라이버시(§4.1 불변):
    이 모듈의 `--out json` 출력에는 전체 경로·sudo COMMAND 원문이 들어 있다.
    **data05 로컬 전용**이다. 반출은 `--out slack`(= attribution_export)만 한다.
    `raw` 라는 이름의 키는 어디에 있든 로컬 전용이며 public_view() 가 재귀적으로 벗긴다.
    로컬 vLLM이 원문을 보는 것은 허용된다(egress 0) — 제약은 **반출**이지 로컬 처리가 아니다.

이 모듈이 **못** 하는 것(출력의 limits[] 로도 나간다):
    · 비sudo 활동의 명령 이력. journald 에는 sudo 경유만 남는다(0단계 한계, §4.2).
      2026-08-03 사건이 정확히 이 경우다 — 귀속의 근거는 100% 파일시스템 증거였다.
    · mtime 조작·과거 파일 이동 구분. 그래서 결론이 아니라 **후보**만 제시한다(§4.5).
    · 파일을 남기지 않는 원인(로그 폭주·삭제된 열린 파일 등). 그건 OpenSearch 로그 검색이 보완재다.

usage:
    disk-attribution.sh 가 파이프로 원문 봉투를 먹인다. 단독으로도 쓸 수 있다:
      cat fixtures/incident-2026-08-03-data04.raw | python3 attribution_lib.py --out public
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

SCHEMA = "keiwi.disk-attribution/0"

# ── 카테고리 (spec §4.2 D4-2 결정적 카테고리화 — LLM 이전) ───────────────────────
CAT_MODEL = "모델 가중치"
CAT_PYENV = "Python 환경"
CAT_DATA = "데이터/아카이브"
CAT_OTHER = "대형 파일"
CAT_HOME = "사용자 홈"

# 스펙 목록(.ckpt·.safetensors·.pt·.pth) + 실측 확장(.gguf·.onnx·.h5·.joblib —
# data04 /home 에 실제로 있는 형식들. 없으면 "대형 파일"로 뭉개져 신호가 준다).
_MODEL_EXT = (
    ".ckpt", ".safetensors", ".pt", ".pth",
    ".gguf", ".onnx", ".h5", ".hdf5", ".joblib", ".pb",
)
_DATA_EXT = (
    ".tar", ".tar.gz", ".tgz", ".zip", ".gz", ".bz2", ".xz", ".zst", ".7z", ".rar",
    ".csv", ".tsv", ".parquet", ".npy", ".npz", ".nc", ".arrow", ".feather",
    ".jsonl", ".ndjson", ".sqlite", ".db", ".iso", ".img", ".qcow2", ".mat",
)
# 스펙의 `*/venv*|*/site-packages/*` + conda 계열(같은 "Python 환경"이다).
# 확장자 없이 가중치를 쌓는 캐시 디렉터리들(ollama blob·HF hub blob 은 확장자가 없다).
# data04 실측: /home/user2/.ollama 129G · /home/user5/.ollama-test 37G — /home 최대 소비처다.
# 이걸 "대형 파일"로 뭉개면 가장 큰 신호를 잃는다.
_MODELDIR_RE = re.compile(
    r"/\.ollama[^/]*(?:/|$)|/\.cache/huggingface(?:/|$)|/hub/models--"
    r"|/\.cache/torch(?:/|$)|/\.keras(?:/|$)"
)
_PYENV_RE = re.compile(
    r"/(?:site-packages|dist-packages)/"
    r"|/\.?venv[^/]*(?:/|$)"
    r"|/(?:mini)?conda3?(?:/|$)|/mambaforge(?:/|$)|/anaconda3?(?:/|$)"
    r"|/\.?virtualenvs?(?:/|$)"
)
# venv 루트 추출: /a/b/venv3/lib/python3.10/site-packages/... → /a/b/venv3
_ENVROOT_LIB_RE = re.compile(r"^(.*?)/lib(?:64)?/python[0-9.]+/(?:site|dist)-packages/")
_ENVROOT_NAME_RE = re.compile(
    r"^(.*?/(?:\.?venv[^/]*|(?:mini)?conda3?|mambaforge|anaconda3?))(?:/|$)"
)


def categorize(path: str) -> str:
    """경로 → 카테고리. 판정 순서를 명시적으로 둔다.

    확장자(모델 가중치)를 경로 패턴(Python 환경)보다 **먼저** 본다. venv 안의
    체크포인트는 "가상환경 설치"가 아니라 "모델 파일"이라고 부르는 편이 신호가 크다.
    반대로 venv 안의 .so 는 확장자에 안 걸리므로 그대로 "Python 환경"이 된다 —
    2026-08-03 사건의 libtensorflow_cc.so.2 가 정확히 그 경로다.
    """
    low = path.lower()
    if low.endswith(_MODEL_EXT) or _MODELDIR_RE.search(low):
        return CAT_MODEL
    if _PYENV_RE.search(low):
        return CAT_PYENV
    if low.endswith(_DATA_EXT):
        return CAT_DATA
    return CAT_OTHER


def env_root(path: str):
    """Python 환경의 루트 디렉터리(로컬 전용 값). 없으면 None."""
    m = _ENVROOT_LIB_RE.match(path)
    if m and m.group(1):
        return m.group(1)
    m = _ENVROOT_NAME_RE.match(path)
    if m and m.group(1):
        return m.group(1)
    return None


def group_key(path: str) -> str:
    """"같은 작업"으로 묶을 단위(로컬 전용 값 — 반출은 개수만).

    Python 환경이면 환경 루트, 아니면 3단계 디렉터리(/home/<user>/<프로젝트>).
    """
    root = env_root(path)
    if root:
        return root
    parts = path.split("/")
    if len(parts) > 4:
        return "/".join(parts[:4])
    return "/".join(parts[:-1]) or "/"


def humanize(nbytes) -> str:
    """1024 기반 사람 표기. 반출 문자열에도 쓰이므로 경로를 절대 포함하지 않는다."""
    try:
        n = float(nbytes)
    except (TypeError, ValueError):
        return "?"
    for unit in ("B", "K", "M", "G", "T"):
        if abs(n) < 1024.0 or unit == "T":
            if unit == "B":
                return "%dB" % int(n)
            return "%.1f%s" % (n, unit)
        n /= 1024.0
    return "%.1fT" % n


# ── 원문 봉투 파싱 ─────────────────────────────────────────────────────────────
def parse_envelope(text: str) -> dict:
    """disk-attribution.sh 가 만든 `#META`/`#SECTION` 봉투를 섹션 딕셔너리로."""
    meta = {}
    transport = ""
    sections = {}
    cur = None
    for line in text.splitlines():
        if line.startswith("#META "):
            for tok in line[6:].split():
                if "=" in tok:
                    k, v = tok.split("=", 1)
                    meta[k] = v
            continue
        if line.startswith("#TRANSPORT "):
            transport = line[11:].strip()
            continue
        if line.startswith("#SECTION "):
            cur = line[9:].strip()
            sections[cur] = []
            continue
        if cur is not None:
            sections[cur].append(line)
    return {"meta": meta, "transport": transport, "sections": sections}


def _parse_df(lines):
    """df -B1 --output=target,size,used,avail,pcent 의 1행."""
    for ln in lines:
        parts = ln.split()
        if len(parts) >= 5 and parts[-1].endswith("%"):
            try:
                return {
                    "target": parts[0],
                    "size": int(parts[1]),
                    "used": int(parts[2]),
                    "avail": int(parts[3]),
                    "usage_pct": float(parts[-1].rstrip("%")),
                }
            except ValueError:
                continue
    return None


def _parse_du(lines):
    out = []
    for ln in lines:
        if not ln.strip():
            continue
        parts = ln.split("\t", 1)
        if len(parts) != 2:
            parts = ln.split(None, 1)
        if len(parts) != 2:
            continue
        try:
            out.append((int(parts[0]), parts[1].strip()))
        except ValueError:
            continue
    return out


def _parse_find(lines):
    out = []
    for ln in lines:
        if not ln.strip():
            continue
        parts = ln.split("|", 3)
        if len(parts) != 4:
            continue
        try:
            size = int(parts[0])
        except ValueError:
            continue
        out.append({"bytes": size, "mtime": parts[1], "owner": parts[2], "path": parts[3]})
    return out


# ── 스냅샷 · 베이스라인 diff (§4.2 D4-1) ───────────────────────────────────────
DEFAULT_SNAPSHOT_ROOT = os.environ.get(
    "KEIWI_ATTR_SNAPSHOT_DIR", "/data/alert-relay/snapshots"
)


def snapshot_dir_for(node: str, root: str) -> str:
    return os.path.join(root, node)


def write_snapshot(node: str, du_rows, root: str, stamp: str):
    """du 결과를 `<root>/<node>/<ts>.tsv` 로 남긴다.

    **이 모듈에서 파일을 쓰는 유일한 함수다**(게이트 check-collector-readonly.sh 가
    이 사실을 검사한다). 상위 디렉터리가 없고 만들 수도 없으면 조용히 건너뛰지 않고
    사유를 돌려준다 — 스냅샷 부재는 delta_bytes 부재로 이어지므로 알려야 한다.
    """
    parent = os.path.dirname(root.rstrip("/")) or "/"
    if not os.path.isdir(root) and not os.path.isdir(parent):
        return None, "스냅샷 루트 부재(%s) — 베이스라인 diff 생략" % root
    d = snapshot_dir_for(node, root)
    try:
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, "%s.tsv" % stamp)
        with open(path, "w", encoding="utf-8") as fh:
            for size, p in du_rows:
                fh.write("%d\t%s\n" % (size, p))
        return path, None
    except OSError as exc:
        return None, "스냅샷 기록 실패(%s) — 베이스라인 diff 생략" % exc.__class__.__name__


def load_baseline(node: str, root: str, exclude: str = ""):
    """가장 최근(현재 실행분 제외) 스냅샷을 베이스라인으로."""
    d = snapshot_dir_for(node, root)
    if not os.path.isdir(d):
        return None, {}
    try:
        cands = sorted(
            p for p in os.listdir(d)
            if p.endswith(".tsv") and os.path.join(d, p) != exclude
        )
    except OSError:
        return None, {}
    if not cands:
        return None, {}
    path = os.path.join(d, cands[-1])
    table = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for ln in fh:
                parts = ln.rstrip("\n").split("\t", 1)
                if len(parts) == 2:
                    try:
                        table[parts[1]] = int(parts[0])
                    except ValueError:
                        pass
    except OSError:
        return None, {}
    return path, table


# ── OpenSearch: sudo COMMAND 검색 (T-E4-2) ────────────────────────────────────
OPENSEARCH_URL = os.environ.get("KEIWI_OPENSEARCH_URL", "http://localhost:9200")
_SUDO_RE = re.compile(
    r"^\s*(?P<user>[A-Za-z0-9._-]+)\s*:\s*(?P<rest>.*?COMMAND=(?P<cmd>.*))$"
)
_PWD_RE = re.compile(r"PWD=(?P<pwd>\S+)")


def search_sudo_commands(node: str, start: datetime, end: datetime, limit: int = 30,
                         url: str = None, timeout: float = 8.0):
    """`keiwi-logs-*` 에서 노드·시간창의 `COMMAND=` 라인을 읽는다(read-only).

    콘솔 어시스턴트의 answerError 는 level error/warn 고정이라 sudo COMMAND(info)를
    놓친다 — 그래서 여기서 OpenSearch 를 직접 읽는다(spec §3.3 실측 제약의 우회).
    반환 원소의 `raw` 는 **로컬 전용**이다.
    """
    base = (url or OPENSEARCH_URL).rstrip("/")
    body = {
        "size": limit,
        "sort": [{"@timestamp": "asc"}],
        "_source": ["@timestamp", "message", "fleet_node"],
        "query": {"bool": {"filter": [
            {"term": {"fleet_node": node}},
            {"match_phrase": {"message": "COMMAND="}},
            {"range": {"@timestamp": {
                "gte": start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "lte": end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }}},
        ]}},
    }
    req = urllib.request.Request(
        base + "/keiwi-logs-*/_search",
        data=json.dumps(body).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    out = []
    for hit in payload.get("hits", {}).get("hits", []):
        src = hit.get("_source", {})
        msg = src.get("message", "")
        m = _SUDO_RE.match(msg)
        if not m:
            continue
        pwd = _PWD_RE.search(m.group("rest"))
        pwd_path = pwd.group("pwd") if pwd else ""
        out.append({
            "ts": src.get("@timestamp", ""),
            "user": m.group("user"),
            "cwd_category": cwd_category(pwd_path),
            "raw": msg.strip(),           # 로컬 전용 — public_view() 가 벗긴다
        })
    return out


def cwd_category(pwd: str) -> str:
    """PWD 전체 경로 → 카테고리. 사용자 홈 하위 상세는 경로를 버린다(§4.1-1)."""
    if not pwd:
        return "알 수 없음"
    if re.match(r"^/home/[^/]+/?$", pwd):
        return CAT_HOME
    if pwd.startswith("/home/"):
        return categorize(pwd) if categorize(pwd) != CAT_OTHER else "사용자 홈 하위"
    parts = [p for p in pwd.split("/") if p]
    return "/" + parts[0] if parts else "/"


# ── 리포트 조립 ───────────────────────────────────────────────────────────────
def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse_ts(text: str, fallback: datetime) -> datetime:
    if not text or text == "-":
        return fallback
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return fallback


def _rfc3339_mtime(mtime: str, node_tz) -> str:
    """find 의 `YYYY-mm-ddTHH:MM`(노드 로컬, tz 없음) → RFC3339(오프셋 포함).

    두 가지를 동시에 해결한다:
      ① 플릿 TZ 불균일(data04=KST · data03/05=UTC)에서 시각이 모호해지는 것.
      ② E3 relay 의 `kst_label()` 이 오프셋 있는 문자열을 기대하는 것(호출 계약).
    """
    try:
        dt = datetime.strptime(mtime, "%Y-%m-%dT%H:%M").replace(tzinfo=node_tz)
    except ValueError:
        return mtime
    return dt.isoformat()


def _clip_to_window(files, win_from: datetime, anchor: datetime, node_tz):
    """find 결과를 [win_from, anchor] 로 다시 자른다.

    ⚠️ 플릿의 타임존이 균일하지 않다 [실측 2026-08-03]: data04 는 KST(+09:00),
    data03·data05 는 UTC(+00:00). find 의 `%TH:%TM` 은 **노드 로컬 벽시계**라 tz 가 없고,
    fired_at 은 Grafana 가 준 tz-aware 시각이다. 그래서 창을 **노드의 오프셋으로 옮긴 뒤**
    naive 로 낮춰 비교한다. 이 변환을 빼면 UTC 노드에서 창이 9시간 어긋난다.
    """
    lo = win_from.astimezone(node_tz).replace(tzinfo=None)
    hi = anchor.astimezone(node_tz).replace(tzinfo=None)
    kept, dropped = [], 0
    for f in files:
        try:
            mt = datetime.strptime(f["mtime"], "%Y-%m-%dT%H:%M")
        except ValueError:
            kept.append(f)
            continue
        if lo <= mt <= hi:
            kept.append(f)
        else:
            dropped += 1
    return kept, dropped


def build_report(env: dict, *, force_no_sudo=False, snapshot_root=None,
                 want_snapshot=True, want_journal=True) -> dict:
    """봉투 → 리포트(로컬본, raw 포함). spec §4.2 D4-1 스키마."""
    meta = env["meta"]
    sec = env["sections"]
    node = meta.get("node", "unknown")
    mount = meta.get("mount", "/")
    minutes = int(meta.get("minutes", "360") or 360)

    partial_reasons = []
    limits = [
        "sudo 경유 + 파일 증거 기반 — 비sudo 활동은 미포함(0단계 한계)",
        "mtime 기준이라 파일 이동·mtime 조작에 속을 수 있다 — 결론이 아니라 후보다",
    ]

    sudo_ok = "sudo=1" in "\n".join(sec.get("sudo_probe", []))
    if force_no_sudo:
        sudo_ok = False
    if not sudo_ok:
        partial_reasons.append(
            "sudo -n 불가 — du/find 를 비특권으로 축소 수집(읽을 수 있는 범위만)")

    host = (sec.get("host") or [""])[0].strip()
    df = _parse_df(sec.get("df", []))
    if df is None:
        partial_reasons.append("df 파싱 실패 — 사용률 미상")

    now = datetime.now().astimezone()
    collected_at = _parse_ts((sec.get("collected") or [""])[0].strip(), now)
    anchor = _parse_ts(meta.get("fired_at", ""), collected_at)
    win_from = anchor - timedelta(minutes=minutes)

    du_rows = _parse_du(sec.get("du_home", []))
    if not du_rows:
        partial_reasons.append("du 결과 없음(권한 또는 timeout)")

    # 스냅샷 기록 + 베이스라인 diff
    root = snapshot_root or DEFAULT_SNAPSHOT_ROOT
    stamp = collected_at.strftime("%Y%m%dT%H%M%S")
    snap_path, snap_note = (None, None)
    if want_snapshot and du_rows:
        snap_path, snap_note = write_snapshot(node, du_rows, root, stamp)
        if snap_note:
            partial_reasons.append(snap_note)
    base_path, base_table = load_baseline(node, root, exclude=snap_path or "")
    if not base_table:
        limits.append(
            "일일 베이스라인 없음 — 합계는 '시간창 안에 mtime 이 갱신된 파일의 총 크기'이지 "
            "증가량이 아니다(베이스라인이 쌓이면 delta 로 대체된다)")

    top_dirs = []
    for size, path in du_rows[:40]:
        parts = [p for p in path.split("/") if p]
        owner = None
        if len(parts) >= 2 and parts[0] == "home":
            owner = parts[1]
        if path.rstrip("/") == "/home":
            pcat = "/home"
        elif owner and len(parts) == 2:
            pcat = CAT_HOME
        else:
            pcat = categorize(path)
        entry = {"path_category": pcat, "owner": owner, "bytes": size,
                 "raw": {"path": path}}
        if path in base_table:
            entry["delta_bytes"] = size - base_table[path]
        top_dirs.append(entry)
    # 정렬 계약: ① /home 합계 ② 사용자 홈(용량 desc) ③ 홈 하위 상세(용량 desc).
    # du 출력 순서(순수 용량순)를 그대로 쓰면 `/home/user2` 과 `/home/user2/.ollama` 가
    # 나란히 와서 "상위 N"을 찍는 소비처(E3 relay 답글 #1)에 같은 계정이 두 번 나온다 [실측].
    _rank = {"/home": 0, CAT_HOME: 1}
    top_dirs.sort(key=lambda e: (_rank.get(e["path_category"], 2), -e["bytes"]))

    files = _parse_find(sec.get("recent_files", []))
    # find 의 -mmin 은 **수집 시점** 기준이다. 알림 발화 시각(fired_at)이 주어지면
    # 창을 그쪽으로 옮겨 다시 자른다 — 안 그러면 "발화 이후에 생긴 파일"이 원인 후보로
    # 섞인다(리플레이가 사건 당시의 결론과 달라지는 원인).
    node_tz = collected_at.tzinfo or timezone.utc
    files, dropped = _clip_to_window(files, win_from, anchor, node_tz)
    if dropped:
        limits.append("발화 시각 기준으로 창 밖 파일 %d건 제외(수집은 %s 기준으로 돌았다)"
                      % (dropped, collected_at.strftime("%H:%M")))
    scan_from = collected_at - timedelta(minutes=minutes)
    if win_from < scan_from:
        # 발화가 한참 전이면 find 의 -mmin 이 훑은 구간이 창의 앞쪽을 덮지 못한다.
        limits.append(
            "창 앞부분(%s 이전)은 find -mmin 범위 밖 — 더 이르게 보려면 --minutes 를 키워라"
            % scan_from.strftime("%H:%M"))
    recent_files = []
    groups = {}
    for f in files:
        cat = categorize(f["path"])
        f["mtime"] = _rfc3339_mtime(f["mtime"], node_tz)
        recent_files.append({
            "bytes": f["bytes"], "mtime": f["mtime"], "owner": f["owner"],
            "category": cat, "raw": {"path": f["path"]},
        })
        gk = (f["owner"], cat)
        g = groups.setdefault(gk, {"owner": f["owner"], "category": cat, "count": 0,
                                   "files": 0, "bytes": 0, "first_mtime": None,
                                   "last_mtime": None, "raw": {"group_keys": []}})
        key = group_key(f["path"])
        if key not in g["raw"]["group_keys"]:
            g["raw"]["group_keys"].append(key)
        g["count"] = len(g["raw"]["group_keys"])
        g["files"] += 1
        g["bytes"] += f["bytes"]
        mt = f["mtime"]
        g["first_mtime"] = mt if g["first_mtime"] is None else min(g["first_mtime"], mt)
        g["last_mtime"] = mt if g["last_mtime"] is None else max(g["last_mtime"], mt)
    recent_groups = sorted(groups.values(), key=lambda g: -g["bytes"])

    sudo_commands = []
    if want_journal:
        try:
            sudo_commands = search_sudo_commands(node, win_from, anchor)
        except (urllib.error.URLError, OSError, ValueError, TimeoutError) as exc:
            partial_reasons.append(
                "OpenSearch COMMAND 검색 실패(%s) — 파일 증거만으로 판정"
                % exc.__class__.__name__)
    else:
        limits.append("이번 실행은 journald COMMAND 검색을 건너뛰었다(--no-journal)")

    if not sudo_commands and want_journal and not any(
            r.startswith("OpenSearch") for r in partial_reasons):
        limits.append(
            "이 시간창에 sudo 이력 0건 — 귀속 근거는 전적으로 파일시스템 증거다")

    report = {
        "schema": SCHEMA,
        "node": node,
        "host": host,
        "mount": mount,
        "usage_pct": df["usage_pct"] if df else None,
        "df": df,
        "collected_at": _iso(collected_at),
        # tz_offset 은 mtime 표기의 기준이다 — 플릿 TZ가 균일하지 않아서 반드시 함께 나가야 한다.
        "window": {"from": _iso(win_from), "to": _iso(anchor), "minutes": minutes,
                   "anchor": "fired_at" if meta.get("fired_at", "-") != "-" else "collected_at",
                   "tz_offset": collected_at.strftime("%z") or "+0000"},
        "top_dirs": top_dirs,
        "recent_files": recent_files,
        "recent_groups": recent_groups,
        "sudo_commands": sudo_commands,
        "baseline": {"available": bool(base_table),
                     "raw": {"snapshot": snap_path, "baseline": base_path}},
        "limits": limits,
        "partial": bool(partial_reasons),
        "partial_reasons": partial_reasons,
        "transport": env.get("transport", ""),
    }
    return report


LOCAL_ONLY_KEY = "raw"


def public_view(obj):
    """`raw` 라는 이름의 키를 **재귀적으로** 제거한 사본.

    반출 경로(attribution_export)는 이 함수를 통과한 값만 받는다.
    "빌더에 절대 전달 금지"(§4.2 D4-1)를 사람의 주의력이 아니라 자료구조로 강제한다.
    """
    if isinstance(obj, dict):
        return {k: public_view(v) for k, v in obj.items() if k != LOCAL_ONLY_KEY}
    if isinstance(obj, list):
        return [public_view(v) for v in obj]
    return obj


# ── 로컬 vLLM 의도 요약 (T-E4-3) ──────────────────────────────────────────────
VLLM_URL = os.environ.get("KEIWI_VLLM_URL", "http://localhost:8003")

INTENT_SYSTEM = (
    "너는 리눅스 서버 운영 보조다. 아래 디스크 사용 증가 수집 결과를 보고 "
    "**누가 언제 무슨 의도의 작업을 한 것으로 보이는지** 한국어 한 문장으로만 답한다.\n"
    "규칙(반드시 지킨다):\n"
    "1. 원문 명령어와 파일 경로를 **인용하지 마라**. 디렉터리 이름·경로 조각·파일명도 쓰지 마라.\n"
    "2. 계정명과 대략의 시각(HH:MM)·합계 용량은 **반드시** 포함한다.\n"
    "3. 단정하지 말고 '~로 보인다' 형태로 서술한다. 불확실하면 불확실하다고 말한다.\n"
    "4. 한 문장. 사족·머리말·목록·따옴표 금지.\n"
    "예시 형식: \"어떤계정이 17:45경 대용량 파이썬 가상환경을 설치한 것으로 보인다(합 2.2G).\""
)


def _vllm_model(base: str, timeout: float) -> str:
    req = urllib.request.Request(base + "/v1/models")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["data"][0]["id"]


def summarize_intent(report_local: dict, *, url: str = None, timeout: float = 25.0):
    """로컬 vLLM에 의도 한 줄을 물어본다. 실패하면 **조용히 None**.

    입력에 원문이 포함되는 것은 허용된다(로컬 처리, egress 0 — §4.1-3).
    출력은 반드시 attribution_export.redact_text() 를 한 번 더 통과해야 한다(이중 게이트).
    이 함수는 답글 #1(결정적)의 **부가물**이다 — None 이어도 보고서는 성립한다(AC-E4-4).
    """
    base = (url or VLLM_URL).rstrip("/")
    try:
        model = _vllm_model(base, timeout=min(timeout, 8.0))
        digest = _intent_digest(report_local)
        body = {
            "model": model,
            "temperature": 0.1,
            "max_tokens": 200,
            "messages": [
                {"role": "system", "content": INTENT_SYSTEM},
                {"role": "user", "content": digest},
            ],
        }
        req = urllib.request.Request(
            base + "/v1/chat/completions",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = data["choices"][0]["message"]["content"].strip()
    except Exception:                      # noqa: BLE001 — 어떤 실패든 요약은 생략한다
        return None
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    text = " ".join(text.split())
    if not text:
        return None
    return _enforce_hedge(text[:400])


_HEDGE = ("보인다", "추정", "가능성", "듯", "불확실", "같다", "로 판단")


def _enforce_hedge(text: str) -> str:
    """어조 계약(§4.5): 단정 금지. 모델이 안 지키면 우리가 붙인다."""
    if any(h in text for h in _HEDGE):
        return text
    return text.rstrip(".。 ") + " (추정 — 단정 아님)"


def _intent_digest(report: dict) -> str:
    """LLM 입력. 로컬 전용이므로 원문을 포함한다(허용 — §4.1-3)."""
    lines = ["노드=%s 마운트=%s 사용률=%s%%" % (
        report.get("node"), report.get("mount"), report.get("usage_pct"))]
    lines.append("시간창=%s ~ %s" % (report["window"]["from"], report["window"]["to"]))
    lines.append("최근 대형 파일(상위 12):")
    for f in report.get("recent_files", [])[:12]:
        lines.append("  %s %s %s %s" % (
            humanize(f["bytes"]), f["mtime"], f["owner"],
            f.get("raw", {}).get("path", "")))
    if report.get("sudo_commands"):
        lines.append("sudo 이력(상위 10):")
        for c in report["sudo_commands"][:10]:
            lines.append("  %s %s" % (c["ts"], c.get("raw", "")))
    else:
        lines.append("sudo 이력: 이 시간창에 없음")
    return "\n".join(lines)


CONSOLE_BASE = os.environ.get("KEIWI_CONSOLE_URL", "http://192.168.1.105:3106")


def console_link(alert: str, report: dict) -> str:
    """E2(D2-1)의 console_url 과 같은 모양의 딥링크 — 상세 열람은 콘솔(Zero Trust 뒤)에서만.

    한국어 질문은 URL에 싣지 않는다(E2 판단 그대로) — `alert=` 를 콘솔의 프리셋
    테이블(apps/console/src/lib/alert-presets.ts)이 받아 질문을 만든다.
    """
    from urllib.parse import urlencode
    minutes = int((report.get("window") or {}).get("minutes", 360) or 360)
    q = {"alert": alert, "node": report.get("node", ""),
         "mount": report.get("mount", "/"), "from": "now-%dm" % minutes}
    return "%s/incidents?%s" % (CONSOLE_BASE.rstrip("/"), urlencode(q))


# ── 스키마 검증 (AC-E4-1) ─────────────────────────────────────────────────────
_REQUIRED_TOP = ("schema", "node", "mount", "usage_pct", "collected_at",
                 "top_dirs", "recent_files", "sudo_commands", "partial")


def validate(report: dict):
    """spec §4.2 D4-1 필수 키 검사. 문제 목록을 돌려준다(빈 리스트 = 통과)."""
    problems = []
    for k in _REQUIRED_TOP:
        if k not in report:
            problems.append("필수 키 누락: %s" % k)
    if report.get("schema") != SCHEMA:
        problems.append("schema 불일치: %r" % report.get("schema"))
    for i, d in enumerate(report.get("top_dirs", [])):
        for k in ("path_category", "owner", "bytes"):
            if k not in d:
                problems.append("top_dirs[%d].%s 누락" % (i, k))
    for i, f in enumerate(report.get("recent_files", [])):
        for k in ("bytes", "mtime", "owner", "category"):
            if k not in f:
                problems.append("recent_files[%d].%s 누락" % (i, k))
    for i, c in enumerate(report.get("sudo_commands", [])):
        for k in ("ts", "user", "cwd_category"):
            if k not in c:
                problems.append("sudo_commands[%d].%s 누락" % (i, k))
    if not isinstance(report.get("partial"), bool):
        problems.append("partial 이 bool 이 아니다")
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser(description="디스크 귀속 파서 (specs/alert-enrichment §4.2)")
    ap.add_argument("--out", default="json", choices=("json", "public", "slack", "validate"))
    ap.add_argument("--snapshot-dir", default=None)
    ap.add_argument("--no-snapshot", action="store_true")
    ap.add_argument("--no-journal", action="store_true")
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--force-no-sudo", action="store_true")
    ap.add_argument("--alert", default="DiskUsageHigh",
                    help="콘솔 딥링크의 alert 파라미터(E2 D2-2 프리셋 테이블 키)")
    ap.add_argument("--console-url", default=None,
                    help="비우면 CONSOLE_BASE 로 자동 생성. 허용 호스트가 아니면 링크는 생략된다")
    ap.add_argument("--input", default="-")
    args = ap.parse_args(argv)

    text = sys.stdin.read() if args.input == "-" else open(args.input, encoding="utf-8").read()
    env = parse_envelope(text)
    report = build_report(
        env,
        force_no_sudo=args.force_no_sudo,
        snapshot_root=args.snapshot_dir,
        want_snapshot=not args.no_snapshot,
        want_journal=not args.no_journal,
    )

    problems = validate(report)
    if args.out == "validate":
        if problems:
            for p in problems:
                print("SCHEMA_FAIL %s" % p)
            return 1
        print("SCHEMA_OK %s node=%s recent_files=%d partial=%s"
              % (SCHEMA, report["node"], len(report["recent_files"]), report["partial"]))
        return 0
    if problems:
        print(json.dumps({"error": "schema", "problems": problems},
                         ensure_ascii=False), file=sys.stderr)
        return 1

    if args.out == "json":
        # 로컬본 — 원문 포함. **절대 반출 금지**(§4.1-2).
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if args.out == "public":
        print(json.dumps(public_view(report), ensure_ascii=False, indent=2))
        return 0

    # slack — 반출본. 요약은 로컬 원문을 보고 만들지만, 게시 전에 redaction 을 한 번 더 탄다.
    import attribution_export as export     # 지연 import: 반출 경로를 명시적으로 분리
    intent = None if args.no_llm else summarize_intent(report)
    console = args.console_url or console_link(args.alert, report)
    print(export.build_slack_text(public_view(report), intent_summary=intent,
                                  console_url=console))
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(main())

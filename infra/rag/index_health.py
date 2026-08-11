"""색인 건강 상태의 **정본** — doc_status를 읽어 사실만 돌려준다.

왜 별도 모듈인가:
    2026-08-05 이전 ingest.py는 `kv_store_full_docs`의 **길이**(= 투입 문서 수)를
    'documents'로 찍었다. 그 값은 색인이 78% 실패한 상태에서도 64를 보고했다 —
    **거짓 초록**이다. 성공/실패 판정은 '무엇을 넣었나'가 아니라 LightRAG가
    문서별로 남긴 doc_status(processed/failed/pending/processing)로만 한다.

    같은 사실을 ingest.py(배치)·게이트·서비스 /healthz가 각자 다시 계산하면
    반드시 갈라진다. 그래서 계산은 여기 한 곳뿐이고 나머지는 이걸 부른다.

계약:
    · 스토리지가 없거나 doc_status가 비면 ready=False다. "색인이 비었는데
      ready=true"를 만들지 않는 것이 이 모듈의 존재 이유의 절반이다.
    · failed가 1건이라도 있으면 ready=False다. 부분 성공을 초록으로 부르지 않는다.
    · 이 모듈은 **읽기 전용**이다. 스토리지를 고치거나 지우지 않는다.

pip 0: stdlib만 쓴다(게이트가 venv 없이도 돌 수 있어야 한다).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

DEFAULT_RAG_DIR = "~/.local/share/keiwi-rag"


def storage_dir(rag_dir: str | os.PathLike | None = None) -> Path:
    base = Path(
        rag_dir or os.environ.get("KEIWI_RAG_DIR", DEFAULT_RAG_DIR)
    ).expanduser()
    return base / "storage"


def index_health(rag_dir: str | os.PathLike | None = None) -> dict:
    """색인 상태 요약. 서비스 /healthz와 게이트가 공유하는 단일 판정.

    반환 키:
        ready          bool  — 검색에 쓸 수 있는 색인인가(아래 조건 전부)
        indexed_files  int   — status=processed 문서 수(= 검색 가능 문서)
        failed_docs    int   — status=failed 문서 수
        pending_docs   int   — processed도 failed도 아닌 문서 수
        total_docs     int   — doc_status에 등재된 문서 수
        failures       list  — [{file_path, error}] (최대 50건)
        reason         str|None — ready=False 인 이유(사람이 읽는 한 줄)
    """
    sdir = storage_dir(rag_dir)
    status_path = sdir / "kv_store_doc_status.json"

    out: dict = {
        "ready": False,
        "indexed_files": 0,
        "failed_docs": 0,
        "pending_docs": 0,
        "total_docs": 0,
        "failures": [],
        "reason": None,
        "storage_dir": str(sdir),
    }

    if not status_path.exists():
        out["reason"] = f"doc_status 없음: {status_path}"
        return out
    try:
        raw = json.loads(status_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        out["reason"] = f"doc_status 읽기 실패: {exc}"
        return out
    if not isinstance(raw, dict):
        out["reason"] = "doc_status 형식이 dict가 아님"
        return out

    processed = failed = pending = 0
    failures: list[dict] = []
    for doc_id, rec in raw.items():
        rec = rec if isinstance(rec, dict) else {}
        status = rec.get("status")
        if status == "processed":
            processed += 1
        elif status == "failed":
            failed += 1
            if len(failures) < 50:
                failures.append(
                    {
                        "file_path": rec.get("file_path") or doc_id,
                        "error": (rec.get("error_msg") or rec.get("error") or "")[
                            :300
                        ],
                    }
                )
        else:
            pending += 1

    out.update(
        indexed_files=processed,
        failed_docs=failed,
        pending_docs=pending,
        total_docs=len(raw),
        failures=failures,
    )

    if not raw:
        out["reason"] = "색인이 비어 있음(doc_status 0건)"
    elif processed == 0:
        out["reason"] = "검색 가능 문서 0건"
    elif failed:
        out["reason"] = f"실패 문서 {failed}건 — 부분 색인은 ready가 아니다"
    elif pending:
        out["reason"] = f"미완 문서 {pending}건(pending/processing)"
    else:
        out["ready"] = True
    return out


def format_report(health: dict) -> str:
    """사람이 읽는 한 문단. ingest.py와 게이트가 같은 문구를 쓰게 한다."""
    lines = [
        f"ready={health['ready']} "
        f"indexed_files={health['indexed_files']} "
        f"failed_docs={health['failed_docs']} "
        f"pending_docs={health['pending_docs']} "
        f"total_docs={health['total_docs']}"
    ]
    if health.get("reason"):
        lines.append(f"사유: {health['reason']}")
    if health["failures"]:
        lines.append("실패 문서:")
        for f in health["failures"]:
            lines.append(f"  - {f['file_path']}: {f['error']}")
    return "\n".join(lines)


if __name__ == "__main__":  # 게이트·운영자용 CLI. 실패가 있으면 rc=1.
    import sys

    h = index_health()
    print(format_report(h))
    sys.exit(0 if h["ready"] else 1)

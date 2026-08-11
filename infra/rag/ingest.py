#!/usr/bin/env python3
"""KEIwi 문서 코퍼스를 LightRAG로 색인한다.

코퍼스: docs/runbooks/ · docs/decisions/ · specs/*/README.md·spec.md ·
        README.md · infra/*/README.md (한국어 마크다운, frontmatter 포함)

frontmatter는 사람이 읽는 '문서 메타데이터' 블록으로 변환해 본문 앞에
보존한다 — 그래프 추출 LLM이 alerts/tags 같은 메타를 엔티티·관계로
승격할 수 있게 하기 위함이다.

사용:
    infra/rag/.venv/bin/python infra/rag/ingest.py [--dry-run]

주의: 색인은 LLM 호출이 많다. LLM_MAX_ASYNC=1(기본)로 라이브 vLLM에
저부하 직렬 접근한다. enable_llm_cache 기본 on이라 재실행은 캐시를
재사용한다(실패 시 그냥 다시 실행).
"""

import asyncio
import json
import sys
import time
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    EMBED_HEALTH,
    RAG_HOME,
    REPO_ROOT,
    WORKING_DIR,
    initialize_rag,
)
from index_health import format_report, index_health  # noqa: E402

CORPUS_GLOBS = [
    "docs/runbooks/*.md",
    "docs/decisions/*.md",
    "specs/*/README.md",
    "specs/*/spec.md",
    "README.md",
    "infra/*/README.md",
]


def collect_corpus() -> list[Path]:
    seen: dict[Path, None] = {}
    for pattern in CORPUS_GLOBS:
        for p in sorted(REPO_ROOT.glob(pattern)):
            if p.is_file():
                seen[p] = None
    return list(seen)


def split_frontmatter(text: str) -> tuple[dict, str]:
    """YAML frontmatter를 (meta, body)로 분리. 없으면 ({}, 원문)."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)  # frontmatter 종료 구분선
    if end == -1:
        return {}, text
    raw = text[3:end].strip("\n")
    body = text[end + 4 :].lstrip("-").lstrip("\n")
    try:
        meta = yaml.safe_load(raw) or {}
        if not isinstance(meta, dict):
            meta = {"frontmatter": meta}
    except yaml.YAMLError:
        meta = {"frontmatter_raw": raw}
    return meta, body


def render_doc(path: Path) -> str:
    rel = path.relative_to(REPO_ROOT)
    meta, body = split_frontmatter(path.read_text(encoding="utf-8"))
    lines = ["## 문서 메타데이터", f"- 문서 경로: {rel}"]
    for key, value in meta.items():
        if isinstance(value, (list, tuple)):
            value = ", ".join(str(v) for v in value)
        lines.append(f"- {key}: {value}")
    return "\n".join(lines) + "\n\n" + body


def graph_stats() -> dict:
    stats: dict = {}
    chunks = WORKING_DIR / "kv_store_text_chunks.json"
    # 'documents'는 여기서 세지 않는다. kv_store_full_docs는 **투입** 문서라
    # 색인이 실패해도 줄지 않는다 — 2026-08-04에 이 값이 64를 찍는 동안 실제
    # 검색 가능 문서는 14개였다(거짓 초록). 성공 수는 doc_status가 정본이다.
    if chunks.exists():
        stats["chunks"] = len(json.loads(chunks.read_text()))
    graphml = WORKING_DIR / "graph_chunk_entity_relation.graphml"
    if graphml.exists():
        import networkx as nx

        g = nx.read_graphml(graphml)
        stats["entities"] = g.number_of_nodes()
        stats["relations"] = g.number_of_edges()
    return stats


async def main() -> None:
    paths = collect_corpus()
    print(f"[ingest] 코퍼스 {len(paths)}개 문서")
    if "--dry-run" in sys.argv:
        for p in paths:
            print(" -", p.relative_to(REPO_ROOT))
        return

    texts = [render_doc(p) for p in paths]
    # LightRAG 1.5.5는 file_path를 basename으로 정규화해 중복 판정한다
    # (normalize_document_file_path). spec.md·README.md가 다수라 경로를
    # '__'로 평탄화해 고유 이름을 만든다 — 실경로는 본문 '문서 경로' 메타에 보존.
    file_paths = [
        str(p.relative_to(REPO_ROOT)).replace("/", "__") for p in paths
    ]

    rag = await initialize_rag()
    start = time.monotonic()
    insert_error: Exception | None = None
    try:
        await rag.ainsert(texts, file_paths=file_paths)
    except Exception as exc:  # noqa: BLE001 — 기록해 보고한 뒤 rc=1로 끝낸다.
        # KeyboardInterrupt·CancelledError는 잡지 않는다(그대로 전파 = non-zero).
        # 여기서 삼키면 '중단됐는데 초록'이 만들어진다.
        insert_error = exc
    finally:
        await rag.finalize_storages()
    elapsed = time.monotonic() - start

    # ── 완료 검증 ───────────────────────────────────────────────────────────
    # 투입 수가 아니라 doc_status를 읽는다. 부분 성공을 초록으로 부르지 않는다.
    health = index_health()
    stats = {
        "elapsed_sec": round(elapsed, 1),
        "corpus_files": len(paths),
        "documents": health["indexed_files"],  # = processed. 투입 수가 아니다.
        "failed": health["failed_docs"],
        "pending": health["pending_docs"],
        "ready": health["ready"],
        "embed_health": {
            k: v for k, v in EMBED_HEALTH.items() if k != "samples"
        },
        **graph_stats(),
    }
    stats_path = RAG_HOME / "ingest_stats.json"
    stats_path.write_text(json.dumps(stats, ensure_ascii=False, indent=2))
    print(f"[ingest] 소요 {elapsed:.0f}s — {stats}")
    print(f"[ingest] 통계 기록: {stats_path}")
    print("[ingest] " + format_report(health).replace("\n", "\n[ingest] "))

    if EMBED_HEALTH["mitigated"]:
        print(
            f"[ingest] 주의: 임베딩 완화 {EMBED_HEALTH['mitigated']}건 적용됨 "
            f"({EMBED_HEALTH['mitigations_used']}) — ollama bge-m3 NaN 회피. "
            "해당 벡터는 변형된 텍스트로 임베딩됐다(common.py 주석 참조)."
        )

    if insert_error is not None:
        print(f"[ingest] 삽입 중 예외: {type(insert_error).__name__}: {insert_error}")

    # 실패가 1건이라도 있으면 non-zero. '거짓 초록' 원천 차단.
    if not health["ready"] or insert_error is not None:
        print(
            f"[ingest] 실패 — 색인 가능 {health['indexed_files']}/{len(paths)}, "
            f"실패 {health['failed_docs']}, 미완 {health['pending_docs']}",
            file=sys.stderr,
        )
        raise SystemExit(1)
    print(f"[ingest] 성공 — {health['indexed_files']}/{len(paths)} 문서 색인")


if __name__ == "__main__":
    asyncio.run(main())

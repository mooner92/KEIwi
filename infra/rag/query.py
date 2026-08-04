#!/usr/bin/env python3
"""LightRAG 질의 CLI — 근거(References)와 함께 응답한다.

사용:
    infra/rag/.venv/bin/python infra/rag/query.py "질문" [--mode hybrid]
    모드: naive(벡터) | local(엔티티) | global(관계·테마) | hybrid | mix

주의(아키텍처 제약): 이 출력은 진단 컨텍스트·근거 후보 전용이다.
조치 선택은 remediation_l1.py의 결정론 경로(frontmatter alerts 매칭 +
actions 화이트리스트)가 담당한다 — 이 응답을 실행 대상으로 쓰지 마라.
"""

import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import initialize_rag  # noqa: E402

MODES = ["naive", "local", "global", "hybrid", "mix"]


async def main() -> None:
    parser = argparse.ArgumentParser(description="KEIwi LightRAG 질의")
    parser.add_argument("question", help="질문(한국어)")
    parser.add_argument("--mode", choices=MODES, default="hybrid")
    parser.add_argument("--top-k", type=int, default=40)
    parser.add_argument(
        "--context-only", action="store_true",
        help="LLM 응답 생성 없이 검색 컨텍스트만 출력",
    )
    args = parser.parse_args()

    from lightrag import QueryParam

    rag = await initialize_rag()
    start = time.monotonic()
    try:
        result = await rag.aquery(
            args.question,
            param=QueryParam(
                mode=args.mode,
                top_k=args.top_k,
                enable_rerank=False,  # rerank 모델 미배치
                only_need_context=args.context_only,
            ),
        )
    finally:
        await rag.finalize_storages()

    elapsed = time.monotonic() - start
    print(f"\n===== 응답 (mode={args.mode}, {elapsed:.1f}s) =====\n")
    print(result)


if __name__ == "__main__":
    asyncio.run(main())

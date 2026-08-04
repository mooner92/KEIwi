"""KEIwi LightRAG 공통 배선 — vLLM(OpenAI 호환) + ollama bge-m3.

아키텍처 제약(절대 위반 금지):
  LightRAG는 진단·검색 계층이다. 런북/ADR/스펙을 그래프로 색인해
  원인 탐색·매뉴얼 참조를 강화한다. 조치 선택은 여전히 결정론
  (remediation_l1.py: frontmatter alerts 매칭 + actions 화이트리스트).
  LightRAG 산출은 컨텍스트·근거 후보이지 실행 대상이 아니다.

엔드포인트는 infra/rag/.env(비커밋)로 주입한다 — PUBLIC 레포 규칙.
"""

import os
from functools import partial
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent


def _load_env() -> None:
    """infra/rag/.env를 읽어 미설정 환경변수만 채운다(기존 env 우선)."""
    env_path = HERE / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_env()

# 산출물은 레포 밖에 둔다(색인 결과는 커밋하지 않음 — 재현은 ingest.py 담당).
RAG_HOME = Path(
    os.environ.get("KEIWI_RAG_DIR", "~/.local/share/keiwi-rag")
).expanduser()
WORKING_DIR = RAG_HOME / "storage"
GRAPHML_PATH = WORKING_DIR / "graph_chunk_entity_relation.graphml"

# tiktoken 오프라인 캐시(egress 0 대비 — 캐시는 최초 1회 온라인에서 확보).
os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(RAG_HOME / "tiktoken_cache"))

LLM_BINDING_HOST = os.environ.get("LLM_BINDING_HOST", "http://127.0.0.1:8003/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "")
EMBED_HOST = os.environ.get("EMBED_HOST", "http://127.0.0.1:11434")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "bge-m3:latest")
# 어시스턴트 직렬 1 관례 — 라이브 vLLM에 저부하로 접근(§12).
LLM_MAX_ASYNC = int(os.environ.get("LLM_MAX_ASYNC", "1"))


def _require_model() -> None:
    if not LLM_MODEL:
        raise SystemExit(
            "LLM_MODEL이 비어 있습니다. infra/rag/.env.example을 복사해 "
            "infra/rag/.env를 만들고 vLLM 모델 id를 넣으세요."
        )


async def llm_model_func(
    prompt, system_prompt=None, history_messages=[], **kwargs
) -> str:
    from lightrag.llm.openai import openai_complete_if_cache

    return await openai_complete_if_cache(
        model=LLM_MODEL,
        prompt=prompt,
        system_prompt=system_prompt,
        history_messages=history_messages,
        base_url=LLM_BINDING_HOST,
        api_key=os.environ.get("LLM_BINDING_API_KEY", "not_needed"),
        timeout=600,
        **kwargs,
    )


def build_embedding_func():
    from lightrag.llm.ollama import ollama_embed
    from lightrag.utils import EmbeddingFunc

    # ollama_embed는 이미 EmbeddingFunc로 래핑돼 있어 .func로 원함수를 꺼내
    # 이중 래핑을 회피한다(v1.5.5 ollama 데모 주석 원문).
    return EmbeddingFunc(
        embedding_dim=1024,  # bge-m3
        max_token_size=8192,
        func=partial(
            ollama_embed.func,
            embed_model=EMBED_MODEL,
            host=EMBED_HOST,
        ),
    )


async def initialize_rag():
    """LightRAG 인스턴스 생성 + 스토리지 초기화. 종료 시 finalize_storages() 필수."""
    _require_model()
    from lightrag import LightRAG

    WORKING_DIR.mkdir(parents=True, exist_ok=True)
    rag = LightRAG(
        working_dir=str(WORKING_DIR),
        llm_model_func=llm_model_func,
        llm_model_name=LLM_MODEL,
        llm_model_max_async=LLM_MAX_ASYNC,
        embedding_func=build_embedding_func(),
        addon_params={"language": "Korean"},
    )
    await rag.initialize_storages()  # v1.5.5: pipeline_status 자동 초기화
    return rag

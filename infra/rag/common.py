"""KEIwi LightRAG 공통 배선 — vLLM(OpenAI 호환) + ollama bge-m3.

아키텍처 제약(절대 위반 금지):
  LightRAG는 진단·검색 계층이다. 런북/ADR/스펙을 그래프로 색인해
  원인 탐색·매뉴얼 참조를 강화한다. 조치 선택은 여전히 결정론
  (remediation_l1.py: frontmatter alerts 매칭 + actions 화이트리스트).
  LightRAG 산출은 컨텍스트·근거 후보이지 실행 대상이 아니다.

엔드포인트는 infra/rag/.env(비커밋)로 주입한다 — PUBLIC 레포 규칙.
"""

import os
import re
import unicodedata
from collections.abc import Callable
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
# 라이브 vLLM 저부하 접근(§12). 기본 1(어시스턴트 직렬 관례) —
# 색인처럼 호출이 많은 배치는 .env에서 4(LightRAG 기본)까지만 올린다.
LLM_MAX_ASYNC = int(os.environ.get("LLM_MAX_ASYNC", "1"))
# 색인 규모 조절 노브: 청크가 클수록·gleaning이 적을수록 LLM 호출이 줄어든다.
CHUNK_TOKENS = int(os.environ.get("RAG_CHUNK_TOKENS", "1200"))
CHUNK_OVERLAP = int(os.environ.get("RAG_CHUNK_OVERLAP", "100"))
MAX_GLEANING = int(os.environ.get("RAG_MAX_GLEANING", "1"))


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

    # 추출 프롬프트에서 생성이 폭주(반복 루프)하면 호출이 수 분씩 걸린다 —
    # 상한과 낮은 temperature로 억제(실측: 무제한일 때 480s 워커 타임아웃 발생).
    kwargs.setdefault("max_tokens", int(os.environ.get("LLM_MAX_TOKENS", "8192")))
    kwargs.setdefault(
        "temperature", float(os.environ.get("LLM_TEMPERATURE", "0.3"))
    )
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


# ── 임베딩 NaN 방어 ──────────────────────────────────────────────────────────
# 왜 필요한가(2026-08-05 실측):
#   ollama 0.23.1 + bge-m3(F16, CLS 풀링)은 **특정 토큰열**에서 NaN 임베딩을
#   내고, ollama의 Go json 인코더가 그 응답을 직렬화하지 못해 HTTP 500
#   `failed to encode response: json: unsupported value: NaN` 을 돌려준다.
#   LightRAG는 이걸 IndexFlushError로 승격해 **파이프라인 전체를 중단**한다 —
#   1건의 불량 벡터가 남은 문서 48개를 전부 죽였다(processed 14 / failed 50).
#
# 실측으로 배제한 가설:
#   · 빈 문자열·공백·짧은 텍스트 → NaN 아님(단건·배치 모두 정상).
#   · 초장문(26만 자) → NaN 아님.
#   · 동시성 → 아님. 순차 재현에서도 **같은 배치만** 결정적으로 실패.
#   · 요청 옵션(truncate·num_ctx) → 어떤 값으로도 회피 불가.
#   불량 텍스트는 길이 65~85자의 **평범한 한국어 문장**이었다. 즉 입력 위생
#   문제가 아니라 런타임의 수치 불안정이며, 우리 쪽에서 고칠 수 없다.
#
# 왜 '전역 변환'이 아니라 '사다리'인가(실측):
#   809개 관계 텍스트 기준 — 원본은 배치 33·79·80 실패. 'passage: ' 접두를
#   **전부에** 붙이면 그 3개는 살지만 **배치 16이 새로 죽는다**. 개행→'. '
#   치환은 배치 78을 새로 죽인다. 즉 만능 변환은 없다. 그래서 원본을 먼저
#   쓰고, 실패한 텍스트에만 변환을 차례로 시도한다(대부분 1단에서 해결).
_EMBED_MITIGATIONS: list[tuple[str, Callable[[str], str]]] = [
    ("original", lambda t: t),
    ("prefix-passage", lambda t: "passage: " + t),
    ("newline-to-period", lambda t: t.replace("\n", ". ")),
    ("collapse-ws-prefix", lambda t: "passage: " + re.sub(r"\s+", " ", t)),
    ("nfkc-period", lambda t: unicodedata.normalize("NFKC", t) + " ."),
    ("reverse-lines", lambda t: "\n".join(reversed(t.split("\n")))),
]

# 완화가 실제로 몇 번 쓰였는지 — ingest.py가 읽어 통계에 싣는다.
# '조용히 고쳤다'를 만들지 않기 위한 계수기다.
EMBED_HEALTH: dict = {
    "batch_retries": 0,      # 배치가 깨져 단건 격리로 내려간 횟수
    "mitigated": 0,          # 완화 변환으로 살린 텍스트 수
    "unrecoverable": 0,      # 사다리 전단이 실패한 텍스트 수
    "mitigations_used": {},  # 변환명 -> 사용 횟수
    "samples": [],           # 완화된 텍스트 앞부분(최대 20건) — 사후 점검용
}


def _has_nonfinite(arr) -> bool:
    import numpy as np

    return not bool(np.all(np.isfinite(arr)))


def build_embedding_func():
    import numpy as np
    from lightrag.llm.ollama import ollama_embed
    from lightrag.utils import EmbeddingFunc

    # ollama_embed는 이미 EmbeddingFunc로 래핑돼 있어 .func로 원함수를 꺼내
    # 이중 래핑을 회피한다(v1.5.5 ollama 데모 주석 원문).
    raw = partial(ollama_embed.func, embed_model=EMBED_MODEL, host=EMBED_HOST)

    async def _embed_one(text: str, **kwargs):
        """텍스트 1건을 사다리로 임베딩한다. 전단 실패 시 None."""
        for name, transform in _EMBED_MITIGATIONS:
            candidate = transform(text)
            # 빈 문자열은 ollama가 임베딩을 0개 돌려줘 1:1 대응이 깨진다
            # (실측: input="" → embeddings=[]). 공백 1칸은 정상 처리된다.
            if not candidate:
                candidate = " "
            try:
                out = np.asarray(await raw([candidate], **kwargs))
            except Exception:
                continue
            if out.shape[0] != 1 or _has_nonfinite(out):
                continue
            if name != "original":
                EMBED_HEALTH["mitigated"] += 1
                used = EMBED_HEALTH["mitigations_used"]
                used[name] = used.get(name, 0) + 1
                if len(EMBED_HEALTH["samples"]) < 20:
                    EMBED_HEALTH["samples"].append(
                        {"mitigation": name, "text": text[:120]}
                    )
            return out[0]
        return None

    async def resilient_embed(texts, **kwargs):
        """배치를 그대로 시도하고, 깨지면 단건으로 격리해 살린다.

        LightRAG는 입력 N개에 벡터 N개를 **순서대로** 요구한다
        (nano_vector_db_impl._flush_pending_locked의 1:1 검사). 따라서
        어떤 텍스트도 '건너뛸' 수 없다 — 반드시 유한한 벡터를 채워 넣거나
        예외를 올려야 한다. 여기서는 사다리로 채운다.
        """
        texts = list(texts)
        if not texts:
            return np.zeros((0, 1024), dtype=np.float32)
        try:
            out = np.asarray(await raw(texts, **kwargs))
            if out.shape[0] == len(texts) and not _has_nonfinite(out):
                return out
        except Exception:
            pass

        # 여기 왔다는 건 배치 안에 불량이 있다는 뜻 — 단건으로 범인을 격리한다.
        EMBED_HEALTH["batch_retries"] += 1
        vectors = []
        failed: list[str] = []
        for text in texts:
            vec = await _embed_one(text, **kwargs)
            if vec is None:
                # 사다리 전단 실패. 여기서 0벡터를 넣으면 코사인 정규화가
                # 다시 NaN을 만들어 스토리지를 오염시킨다 — 그래서 채우지
                # 않고 올린다. 이 문서 1건만 failed로 기록되고 나머지는 계속된다.
                EMBED_HEALTH["unrecoverable"] += 1
                failed.append(text[:120])
                continue
            vectors.append(vec)
        if failed:
            raise RuntimeError(
                "임베딩 사다리 전단 실패 — 완화 불가 텍스트 "
                f"{len(failed)}건: {failed[:3]}"
            )
        return np.vstack(vectors)

    return EmbeddingFunc(
        embedding_dim=1024,  # bge-m3
        max_token_size=8192,
        func=resilient_embed,
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
        chunk_token_size=CHUNK_TOKENS,
        chunk_overlap_token_size=CHUNK_OVERLAP,
        entity_extract_max_gleaning=MAX_GLEANING,
        addon_params={"language": "Korean"},
    )
    await rag.initialize_storages()  # v1.5.5: pipeline_status 자동 초기화
    return rag

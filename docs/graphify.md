# graphify — 코드·문서 지식 그래프 (도입 기록)

> 레포를 지식 그래프로 변환해 "무엇이 무엇과 연결되나"를 탐색한다.
> [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0, PyPI `graphifyy` — y 2개가 공식).
> 2026-07-31 도입, P0 게이트(PyPI 실체·vLLM 호환) 실측 통과.

## KEIwi에서의 역할 — 문서 그래프가 본체

| 영역 | 담당 | 이유 |
| --- | --- | --- |
| 코드 탐색 | **codebase-memory-mcp** (기존, MCP+훅 설치됨) | 이미 배선됨. 중복 훅 금지 |
| **문서 지식 그래프** (ADR↔스펙↔런북) | **graphify** (CLI) | KEIwi는 문서가 본체(코드 5.2k vs 문서 6k+ LOC). cbm은 문서를 못 다룸 |

⚠️ `graphify claude install`(PreToolUse 훅)은 **설치하지 않는다** — cbm 훅과 이중 리마인더가 된다.

## 사용법

```bash
# 코드 그래프 (100% 로컬, LLM 0회 — 2.8초/419노드 실측)
graphify extract . --code-only

# 문서 그래프 — 반드시 로컬 vLLM 백엔드로 (§egress)
OPENAI_BASE_URL=http://127.0.0.1:8003/v1 \
OPENAI_API_KEY=local-vllm \
OPENAI_MODEL=/data/vllm/models/Qwen3-Coder-30B-A3B-Instruct-AWQ \
graphify extract docs/decisions --backend openai

# 쿼리
graphify explain resolveFleetCapacity   # 노드의 모든 연결 + EXTRACTED/INFERRED 태그
graphify path NodeCard queryCapacity    # 최단 경로
```

> [!CAUTION] egress — ANTHROPIC/GEMINI 백엔드 금지
> 문서 의미 추출은 파일 내용을 백엔드로 보낸다. 외부 API(`--backend claude` 등)를 쓰면
> **KEI 내부 문서가 반출**된다. 반드시 `OPENAI_BASE_URL`을 사내 vLLM으로.
> 실측: ADR 18개 = 27.9k in/3.7k out 토큰, 외부 전송 0.

## 산출물
`**/graphify-out/`(gitignore) — 재생성 가능한 로컬 인덱스. 커밋 금지.
vLLM은 어시스턴트와 GPU를 공유(단일 인플라이트)하므로 대량 추출은 유휴 시간대에.

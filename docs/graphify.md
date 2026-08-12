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

## 콘솔 화면 — `/graph` (코드 그래프)

`extract --code-only` 산출물을 콘솔이 읽어 **파일 단위 의존 그래프**로 그린다(사이드바 푸터 → 코드 그래프).

```bash
cd apps/console && npm run graph:extract   # = graphify extract ../.. --code-only
```

- **LLM 호출 0 · egress 0.** AST 추출만 쓰므로 위 CAUTION(문서 의미 추출)과 무관하다. 실측 161파일 → 1,419노드·2,482엣지, 수 초.
- 콘솔은 심볼 1,400여 노드를 **파일 단위로 접어서** 보여준다(실측 136파일·128의존). 판별 기준은 `contains` 간선의 출발점이고, 심볼 간 호출은 소유 파일로 승격한다 — 확장자로 판별하지 않는다(확장자 없는 스크립트가 실제로 있다).
- 배치는 **해바라기(phyllotaxis)** — 연결 많은 파일이 중심. 커뮤니티 원형 배치는 버렸다: 이 레포 규모에서 커뮤니티가 80개로 쪼개져(대부분 1~2개) 그림이 "큰 고리"로 뭉개졌다.
- 고립 파일(의존 0)은 **그리지 않고 개수만** 알린다 — 간선이 없어 정보를 더하지 않는다.
- **서버 렌더 SVG**다. 신규 npm 의존성 0(그래프 라이브러리 미도입, §I-6)이고 JS 없이도 보인다 — 이 콘솔은 하이드레이션이 죽어 클라이언트 위젯이 무반응이 된 사고를 겪었다(docs/testing.md).
- 산출물이 없으면 화면이 **"미생성"으로 정직하게** 표기하고 생성 명령을 안내한다(빈 그래프를 그리지 않는다). `built_at_commit`이 현재 HEAD와 다르면 "재생성 필요"를 함께 띄운다.
- 경로는 `CODE_GRAPH_PATH`로 바꿀 수 있다(기본 `../../graphify-out/graph.json`).

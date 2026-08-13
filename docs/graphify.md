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

graphify가 생성한 **인터랙티브 시각화(graph.html, vis-network)를 콘솔이 액자로 임베드**한다
(사이드바 푸터 → 코드 그래프). Grafana 임베드와 같은 "외부 화면 액자화" 패턴이다.

```bash
cd apps/console && npm run graph:extract        # AST 추출 (LLM 0 · 수 초)
graphify cluster-only . --no-label              # graph.html + GRAPH_REPORT.md 재생성
```

- 그래프 화면은 graphify 소유다 — 드래그·줌·노드 검색·커뮤니티 토글(110개)·노드 인스펙터.
  실측 1,419노드·2,482엣지. **수제 SVG 재구현은 하지 않는다** — 한 번 해봤고 ① 정적 점구름은
  읽히지 않았고 ② graphify의 exact-dedup이 병합한 심볼을 잘못 귀속해 가짜 의존까지 그렸다.
  재구현 금지 원칙(§I-2)을 콘솔 자신에게도 적용한다.
- 콘솔이 얹는 것은 **판정**뿐이다: 파일 수·파일 간 의존·고립 수·허브 목록·신선도
  (`built_at_commit` ≠ HEAD면 "재생성 필요"). 이 요약은 심볼 그래프를 파일 단위로 접어
  계산하며, 복수 파일이 소유한(병합된) 심볼의 간선은 **버린다** — 없는 의존을 그리는 것보다
  빠뜨리는 쪽이 낫다(`lib/code-graph.ts`).
- 산출물 부재는 "미생성"으로 정직하게 표기하고 생성 명령을 안내한다.
- ⚠️ graph.html은 vis-network를 unpkg CDN에서 로드한다(브라우저 측 — 반출 데이터 0).
  오프라인 브라우저에서는 그래프가 비어 보인다 — 그때 로컬 vendoring을 ADR로 검토한다(§8).
- 경로: `CODE_GRAPH_PATH`(graph.json) · `CODE_GRAPH_HTML`(graph.html).
- `--no-label`을 쓰는 이유: 커뮤니티 명명은 LLM 호출이 필요하고, 현재 로컬 LLM(qwen3.5)은
  OpenAI 호환 경로에서 thinking을 못 꺼 산출이 깨진다(lib/vllm.ts 주석). 이름 없는
  "Community N"으로도 시각 탐색에는 지장이 없다.

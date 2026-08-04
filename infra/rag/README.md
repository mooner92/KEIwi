# infra/rag — LightRAG 기반 문서 지식 그래프 (진단·검색 계층)

런북·ADR·스펙 코퍼스를 [LightRAG](https://github.com/HKUDS/LightRAG)(HKU, `lightrag-hku==1.5.5`)로
색인해 **엔티티·관계 지식 그래프 + 벡터 검색**을 만든다. 장애 원인 탐색과 매뉴얼 참조를
그래프 질의로 강화하는 것이 목적이다.

## 왜 LightRAG인가

- 순수 벡터 RAG는 "청크 유사도"만 본다. 우리 코퍼스는 **문서 간 관계가 본질**이다 —
  알림 → 런북 → 조치 → 노드 → ADR 근거가 서로 얽혀 있다. LightRAG는 색인 시 LLM으로
  엔티티·관계를 추출해 그래프를 만들고, 질의 시 로컬(엔티티)·글로벌(관계·테마) 듀얼
  레벨 검색을 결합한다(`hybrid`).
- 저장 백엔드가 전부 파일 기반(JsonKV / NanoVectorDB / NetworkX) — 외부 DB·외부 API
  **불필요, egress 0**. LLM은 로컬 vLLM, 임베딩은 로컬 ollama bge-m3만 쓴다.
- 색인이 GraphML을 자동 산출 → 오프라인 HTML 시각화가 공짜로 나온다.

## 아키텍처 내 위치 — 절대 규칙

```
알림 발생 ──▶ remediation_l1.py (결정론: frontmatter alerts 매칭 + actions 화이트리스트) ──▶ 조치
                    │
                    └─ 진단 컨텍스트·근거 후보 ◀── LightRAG (이 디렉터리)
```

**LightRAG는 진단·검색 계층이다.** 조치 선택은 여전히 결정론 경로(적대검증 99회 주입으로
환각 차단이 증명됨)가 담당한다. LightRAG 산출은 사람/어시스턴트가 읽는 컨텍스트·근거
후보이지 **실행 대상이 아니다**. 이 경계를 흐리는 변경 금지.

## 구성

| 파일 | 역할 |
| --- | --- |
| `common.py` | vLLM(OpenAI 호환)·ollama bge-m3 배선, `.env` 로드, LightRAG 팩토리 |
| `ingest.py` | 코퍼스 수집 → frontmatter를 메타 블록으로 보존 → 색인 → 통계 기록 |
| `query.py` | 질의 CLI — 모드(naive/local/global/hybrid/mix) 노출, References 포함 응답 |
| `visualize.py` | GraphML → 오프라인 단일 HTML(pyvis, CDN 인라인) |
| `requirements.lock` | `uv pip freeze` 잠금(재현용) |
| `.env.example` | 엔드포인트 주형 — 실값은 `.env`(비커밋)에만 |

코퍼스: `docs/runbooks/` · `docs/decisions/` · `specs/*/README.md`·`spec.md` ·
`README.md` · `infra/*/README.md` (63개, 한국어 마크다운).

색인 산출물은 레포 밖 `~/.local/share/keiwi-rag/`(기본, `KEIWI_RAG_DIR`)에 둔다 —
**커밋하지 않는다.** 재현은 아래 절차가 담당한다.

## 재현 절차

```bash
cd <repo-root>

# 1) 격리 venv + 의존성 (uv)
uv venv infra/rag/.venv --python 3.11
uv pip install --python infra/rag/.venv -r infra/rag/requirements.lock

# 2) 엔드포인트 주입 (비커밋)
cp infra/rag/.env.example infra/rag/.env   # LLM_MODEL 등 실값 기입

# 3) tiktoken 오프라인 캐시 (최초 1회, 네트워크 필요)
TIKTOKEN_CACHE_DIR=~/.local/share/keiwi-rag/tiktoken_cache \
  infra/rag/.venv/bin/python -c "import tiktoken; [tiktoken.get_encoding(e) for e in ('cl100k_base','o200k_base')]"

# 4) 색인 (LLM 다량 호출 — LLM_MAX_ASYNC=1 직렬, 저부하 시간대 권장 §12)
infra/rag/.venv/bin/python infra/rag/ingest.py            # --dry-run: 대상만 출력

# 5) 질의
infra/rag/.venv/bin/python infra/rag/query.py "로그 인입이 멈췄을 때 진단 순서는?" --mode hybrid

# 6) 시각화 (오프라인 단일 HTML)
infra/rag/.venv/bin/python infra/rag/visualize.py         # ~/.local/share/keiwi-rag/knowledge_graph.html
```

## 운영 주의

- **색인 = LLM 다량 호출**: 청크당 추출 + gleaning + 요약. 코퍼스 ~30만 토큰 기준
  직렬 1로는 수 시간이 걸려, 색인 배치에 한해 `.env`에서 `LLM_MAX_ASYNC=4`(LightRAG
  기본값 상한)·`RAG_CHUNK_TOKENS=1800`·`RAG_MAX_GLEANING=0`으로 조정한다 — vLLM은
  continuous batching이라 동시 4에서도 대기열 없이 소화한다(실측 waiting=0).
  질의·평시 기본은 직렬 1. LLM 캐시가 기본 on이라 실패·중단 시 재실행하면
  캐시부터 재사용된다.
- **서비스 불변(§12)**: vLLM·ollama를 재시작·변경하지 않는다 — 호출만.
- rerank 모델이 없으므로 질의는 항상 `enable_rerank=False`.
- 한국어: `addon_params={"language": "Korean"}` — 엔티티·관계·요약이 한국어로 산출된다.
- PUBLIC 레포: 실 엔드포인트·모델 경로는 `.env`(비커밋)로만. venv·색인 산출물 커밋 금지.

## 시각화

`visualize.py`가 pyvis로 CDN 없는 단일 HTML을 만든다(`cdn_resources="in_line"`).
노드 색 = entity_type, 크기 = 연결 차수, 툴팁 = LLM이 생성한 한국어 설명.
상시 서비스가 필요해지면 `lightrag-hku[api]`의 `lightrag-server` WebUI(:9621, 내장
그래프 뷰어)로 승격 가능 — 현재는 일회성 산출물이라 pyvis가 적합.

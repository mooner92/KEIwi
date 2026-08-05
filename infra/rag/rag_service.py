#!/usr/bin/env python3
"""KEIwi RAG 검색 서비스 — 문서 지식그래프의 **검색 전용** HTTP 어댑터.

콘솔(Node/Next.js)이 파이썬 LightRAG를 쓰기 위한 최소 표면이다.
``GET /healthz`` 와 ``POST /retrieve`` 두 개뿐이고, 127.0.0.1에만 바인딩한다.

────────────────────────────────────────────────────────────────────────────
왜 이 서비스인가 (기각한 대안과 실측 — ADR-0026)
────────────────────────────────────────────────────────────────────────────
  · child_process로 query.py 실행: 요청마다 **콜드 1.49s**(import 0.55s +
    스토리지 로드 0.57~0.72s)가 고정 과세된다. 색인이 커지면 선형으로 는다.
    Next 서버가 타임아웃·좀비·동시성을 직접 떠안고, 프로세스 내 LLM 키워드
    캐시(warm 0.31s)도 못 쓴다.
  · ``lightrag-server``(lightrag-hku[api]): 바이너리는 venv에 있으나
    fastapi·uvicorn·gunicorn 미설치라 **실행 불가**(실측 ModuleNotFoundError).
    설치하면 egress + 의존성 30여 개 + WebUI/인증 + **문서 업로드·삭제 쓰기
    엔드포인트**가 딸려온다. 읽기전용 콘솔 옆에 쓰기 관리면을 여는 것은
    헌장 §12·§14 위반이다.

────────────────────────────────────────────────────────────────────────────
핵심 계약 — 생성하지 않는다
────────────────────────────────────────────────────────────────────────────
``aquery``(프로즈 생성)를 **노출하지 않는다**. ``aquery_data``(구조화 검색)만
쓴다. 이유는 둘이다:

  ① 지연. 같은 질의가 생성 포함 17.72s vs 검색만 1.93~3.14s(실측).
  ② **근거번호 계약**. 답변 문장과 근거 번호는 콘솔이 소유한다 —
     "서버가 검증한 번호만 렌더한다"(ADR-0014). 이 서비스가 프로즈를 만들면
     검증되지 않은 인용이 콘솔을 우회해 화면에 오른다.

이 서비스는 ``ainsert``·``adelete``·``aclear`` 등 **쓰기 API를 절대 호출하지
않는다**. 색인 갱신은 사람이 ``ingest.py``를 돌리고 ``systemctl restart``
한다(§11 — 에이전트 생성, 사람 적용). 재색인 트리거 엔드포인트를 추가하지 마라.

────────────────────────────────────────────────────────────────────────────
API
────────────────────────────────────────────────────────────────────────────
``GET /healthz`` → ``{"status":"ok","ready":true,"mode":"retrieval-only",...}``

``POST /retrieve``  요청 본문(JSON):
    {
      "query":      str,              # 필수, 1~2000자
      "mode":       "hybrid"|"naive"|"local"|"global"|"mix",   # 기본 hybrid
      "top_k":      int,              # 1~60, 기본 20
      "chunk_top_k":int,              # 1~20, 기본 6
      "ll_keywords":[str],            # 있으면 LightRAG 자체 키워드추출 생략
      "hl_keywords":[str],            #   (실측 3.14s → 1.93s)
      "timeout_sec":float             # 0.5~20, 기본 8
    }
  응답:
    {"status":"ok","chunks":[{"file_path":str,"content":str,"chunk_id":str}],
     "mode":str,"elapsed_ms":int,"truncated":bool}
    실패도 **HTTP 200 + status!="ok"** 가 아니라 4xx/5xx + {"status":"error"}로
    돌려준다 — 호출부가 성공/실패를 상태코드로 먼저 가를 수 있어야 한다.

엔티티·관계는 반환하지 않는다. 실측에서 ``entity.file_path``가 실제 출처가
아닌 문서를 가리키는 사례가 있었다(색인 시 동명 엔티티 병합의 부작용).
근거 번호로 승격할 수 있는 것은 출처가 1:1로 붙는 ``chunks`` 뿐이다.

실행(개발): infra/rag/.venv/bin/python infra/rag/rag_service.py
운영: systemd — infra/rag/keiwi-rag.service, 설치 절차는 infra/rag/README.md.
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

LOG = logging.getLogger("keiwi-rag")

# ── 상수 (요청 파라미터 상한 — 콘솔이 뭘 보내든 여기서 잘린다) ──────────────
DEFAULT_HOST = os.environ.get("RAG_SERVICE_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("RAG_SERVICE_PORT", "8131"))

VALID_MODES = ("naive", "local", "global", "hybrid", "mix")
DEFAULT_MODE = "hybrid"

MAX_QUERY_CHARS = 2000
MAX_KEYWORDS = 12
MAX_KEYWORD_CHARS = 60

TOP_K_DEFAULT, TOP_K_MAX = 20, 60
CHUNK_TOP_K_DEFAULT, CHUNK_TOP_K_MAX = 6, 20
# 청크 본문 상한. only_need_context blob이 63KB까지 나오는 것을 실측했다 —
# 그대로 프롬프트에 넣을 수 없다. 여기서 자르고 콘솔이 한 번 더 자른다.
CHUNK_CHARS_MAX = 1200

TIMEOUT_DEFAULT, TIMEOUT_MIN, TIMEOUT_MAX = 8.0, 0.5, 20.0
MAX_BODY_BYTES = 64 * 1024

# 콘솔 MAX_CONCURRENT=1이 상류 게이트다. 2는 이중 안전 — 라이브 vLLM(§12)에
# 이 서비스가 부하를 얹는 주체가 되지 않게 한다(실측 3건 동시 벽시계 2.28s).
MAX_INFLIGHT = int(os.environ.get("RAG_SERVICE_MAX_INFLIGHT", "2"))
# 포화 시 큐잉 대기. 이보다 오래 기다릴 바엔 503으로 빨리 실패하는 편이
# 낫다 — 콘솔은 실패하면 BM25만으로 답한다(실패 격리).
ACQUIRE_TIMEOUT = 2.0


# ══════════════════════════════════════════════════════════════════════════
# 순수 함수 — test_rag_service.py 대상 (GPU·네트워크·LightRAG 불필요)
# ══════════════════════════════════════════════════════════════════════════


class BadRequest(ValueError):
    """요청 본문이 계약을 어겼다 → 400."""


def _clamp_int(value, lo, hi, default):
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BadRequest("정수가 아님")
    return max(lo, min(hi, int(value)))


def _clean_keywords(value):
    """키워드 배열 정제. 문자열 아님·빈값·과장 토큰은 조용히 버린다."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise BadRequest("keywords는 배열이어야 한다")
    out = []
    for item in value:
        if not isinstance(item, str):
            continue
        token = item.strip()[:MAX_KEYWORD_CHARS]
        if token:
            out.append(token)
        if len(out) >= MAX_KEYWORDS:
            break
    return out


def parse_retrieve_request(raw):
    """요청 바이트 → 정규화된 파라미터 dict. 위반은 BadRequest.

    상한을 **거부가 아니라 클램프**로 처리하는 이유: 이 서비스의 실패는
    콘솔의 문서 근거 0건이 되고, 그건 조용한 품질 저하다. 파라미터가 좀
    크다고 400을 내는 것보다 잘라서 답하는 편이 운영상 낫다. 다만
    ``query``만은 없으면 검색 자체가 성립하지 않으므로 거부한다.
    """
    if len(raw) > MAX_BODY_BYTES:
        raise BadRequest("본문이 너무 크다(%d bytes)" % len(raw))
    try:
        body = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise BadRequest("JSON 파싱 실패: %s" % exc)
    if not isinstance(body, dict):
        raise BadRequest("JSON 객체가 아님")

    query = body.get("query")
    if not isinstance(query, str) or not query.strip():
        raise BadRequest("query 누락")
    query = query.strip()[:MAX_QUERY_CHARS]

    mode = body.get("mode", DEFAULT_MODE)
    if mode is None:
        mode = DEFAULT_MODE
    if mode not in VALID_MODES:
        raise BadRequest("mode는 %s 중 하나" % ", ".join(VALID_MODES))

    timeout = body.get("timeout_sec")
    if timeout is None:
        timeout = TIMEOUT_DEFAULT
    elif isinstance(timeout, bool) or not isinstance(timeout, (int, float)):
        raise BadRequest("timeout_sec는 숫자여야 한다")
    timeout = max(TIMEOUT_MIN, min(TIMEOUT_MAX, float(timeout)))

    return {
        "query": query,
        "mode": mode,
        "top_k": _clamp_int(body.get("top_k"), 1, TOP_K_MAX, TOP_K_DEFAULT),
        "chunk_top_k": _clamp_int(
            body.get("chunk_top_k"), 1, CHUNK_TOP_K_MAX, CHUNK_TOP_K_DEFAULT
        ),
        "ll_keywords": _clean_keywords(body.get("ll_keywords")),
        "hl_keywords": _clean_keywords(body.get("hl_keywords")),
        "timeout_sec": timeout,
    }


def normalize_chunks(data, limit, char_cap=CHUNK_CHARS_MAX):
    """``aquery_data`` 산출 → 콘솔이 쓰는 최소 청크 목록.

    · ``status != "success"``(결과 없음 포함)면 빈 목록. 예외를 던지지 않는다 —
      "문서 히트 0건"은 정상 상태이지 오류가 아니다.
    · ``file_path``가 없거나 ``unknown_source``면 **버린다**. 출처를 못 붙이는
      청크는 근거 번호를 받을 수 없고, 근거 없는 텍스트를 프롬프트에 넣는 것은
      환각의 연료다.
    · 같은 ``chunk_id``는 1건만(중복 근거 번호 방지).
    """
    if not isinstance(data, dict):
        return [], False
    if data.get("status") != "success":
        return [], False
    section = data.get("data")
    if not isinstance(section, dict):
        return [], False
    raw_chunks = section.get("chunks")
    if not isinstance(raw_chunks, list):
        return [], False

    out, seen = [], set()
    truncated = False
    for chunk in raw_chunks:
        if not isinstance(chunk, dict):
            continue
        file_path = chunk.get("file_path")
        content = chunk.get("content")
        if not isinstance(file_path, str) or not file_path.strip():
            continue
        if file_path.strip() == "unknown_source":
            continue
        if not isinstance(content, str) or not content.strip():
            continue
        chunk_id = chunk.get("chunk_id")
        chunk_id = chunk_id if isinstance(chunk_id, str) else ""
        if chunk_id and chunk_id in seen:
            continue
        if chunk_id:
            seen.add(chunk_id)
        body = content.strip()
        if len(body) > char_cap:
            body = body[:char_cap]
            truncated = True
        out.append(
            {
                "file_path": file_path.strip(),
                "content": body,
                "chunk_id": chunk_id,
            }
        )
        if len(out) >= limit:
            if len(raw_chunks) > limit:
                truncated = True
            break
    return out, truncated


# ══════════════════════════════════════════════════════════════════════════
# 런타임 — 싱글턴 LightRAG를 전용 asyncio 루프 스레드에 붙든다
# ══════════════════════════════════════════════════════════════════════════


class RagRuntime:
    """부팅 시 1회 초기화하고 요청마다 재사용한다(요청당 초기화 0).

    ``query_data``는 주입 가능하다 — 테스트는 가짜를 넣어 LightRAG·GPU·
    네트워크 없이 HTTP 계약 전체를 돌린다.
    """

    def __init__(self, query_data=None, initializer=None, param_factory=None):
        self._loop = None
        self._thread = None
        self._rag = None
        self._query_data = query_data
        self._initializer = initializer
        # QueryParam 생성도 주입 가능해야 한다 — 요청 경로에서 lightrag를 import하면
        # 테스트가 색인·모델 없이는 못 돌고, 그 순간 CI에서 조용히 스킵된다.
        self._param_factory = param_factory or build_query_param
        self._ready = threading.Event()
        self._sem = threading.BoundedSemaphore(MAX_INFLIGHT)
        self.started_at = time.time()

    # ── 수명주기 ──────────────────────────────────────────────────────────
    def start(self):
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._run_loop, name="rag-loop", daemon=True
        )
        self._thread.start()
        if self._query_data is not None:
            self._ready.set()
            return
        init = self._initializer or _default_initializer
        future = asyncio.run_coroutine_threadsafe(init(), self._loop)
        self._rag = future.result()  # 부팅 실패는 여기서 크게 터진다(systemd 재기동)
        self._query_data = self._rag.aquery_data
        self._ready.set()

    def _run_loop(self):
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def stop(self):
        if self._loop is None:
            return
        rag, self._rag = self._rag, None
        if rag is not None:
            try:
                asyncio.run_coroutine_threadsafe(
                    rag.finalize_storages(), self._loop
                ).result(timeout=10)
            except Exception as exc:  # noqa: BLE001 — 종료 경로는 삼키고 계속
                LOG.warning("finalize_storages 실패(무시): %s", exc)
        self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread is not None:
            self._thread.join(timeout=5)
        # 루프가 멈춘 뒤에만 닫는다(루프 스레드 밖에서). 안 닫으면 재기동·테스트
        # 반복에서 fd와 ResourceWarning이 쌓인다.
        if not self._loop.is_closed():
            self._loop.close()

    @property
    def ready(self):
        return self._ready.is_set()

    # ── 질의 ──────────────────────────────────────────────────────────────
    def retrieve(self, params):
        """검색 1회. 반환 ``(chunks, truncated, elapsed_ms)``.

        타임아웃은 **루프 안에서** ``wait_for``로 건다. 바깥에서
        ``Future.result(timeout)``만 걸면 호출부는 풀려나도 코루틴은 계속
        돌아 좀비 부하가 된다 — child_process 안을 기각한 이유와 같은 종류의
        문제를 여기서 되풀이하지 않는다.
        """
        if not self._sem.acquire(timeout=ACQUIRE_TIMEOUT):
            raise RuntimeError("busy")
        started = time.monotonic()
        try:
            future = asyncio.run_coroutine_threadsafe(
                self._retrieve_async(params), self._loop
            )
            # 루프 쪽 wait_for가 먼저 끊는다. +2s는 취소 처리 여유.
            data = future.result(timeout=params["timeout_sec"] + 2.0)
        finally:
            self._sem.release()
        chunks, truncated = normalize_chunks(data, params["chunk_top_k"])
        return chunks, truncated, int((time.monotonic() - started) * 1000)

    async def _retrieve_async(self, params):
        param = self._param_factory(params)
        return await asyncio.wait_for(
            self._query_data(params["query"], param), params["timeout_sec"]
        )


def build_query_param(params):
    """정규화된 파라미터 → LightRAG ``QueryParam``(운영 경로)."""
    from lightrag import QueryParam

    return QueryParam(
        mode=params["mode"],
        top_k=params["top_k"],
        chunk_top_k=params["chunk_top_k"],
        # rerank 모델 미배치 — 켜면 경고만 나고 이득이 없다.
        enable_rerank=False,
        ll_keywords=params["ll_keywords"],
        hl_keywords=params["hl_keywords"],
    )


async def _default_initializer():
    from common import initialize_rag

    return await initialize_rag()


# ══════════════════════════════════════════════════════════════════════════
# HTTP
# ══════════════════════════════════════════════════════════════════════════


class Handler(BaseHTTPRequestHandler):
    server_version = "keiwi-rag/1.0"
    protocol_version = "HTTP/1.1"
    runtime = None  # 서버 생성 시 주입

    def log_message(self, fmt, *args):  # noqa: A003 — stdlib 시그니처
        LOG.info("%s %s", self.address_string(), fmt % args)

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # 내부 전용 서비스지만 브라우저가 실수로 닿아도 아무것도 못 하게.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 — stdlib 시그니처
        if self.path.split("?")[0] != "/healthz":
            self._send(404, {"status": "error", "message": "not found"})
            return
        rt = self.runtime
        self._send(
            200,
            {
                "status": "ok",
                "ready": bool(rt and rt.ready),
                # 이 값이 계약이다 — 검색만 하고 생성·쓰기는 하지 않는다.
                "mode": "retrieval-only",
                "uptime_sec": int(time.time() - rt.started_at) if rt else 0,
            },
        )

    def do_POST(self):  # noqa: N802 — stdlib 시그니처
        if self.path.split("?")[0] != "/retrieve":
            self._send(404, {"status": "error", "message": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send(400, {"status": "error", "message": "Content-Length 불량"})
            return
        if length > MAX_BODY_BYTES:
            self._send(413, {"status": "error", "message": "본문이 너무 크다"})
            return
        raw = self.rfile.read(length) if length > 0 else b""

        try:
            params = parse_retrieve_request(raw)
        except BadRequest as exc:
            self._send(400, {"status": "error", "message": str(exc)})
            return

        rt = self.runtime
        if rt is None or not rt.ready:
            self._send(503, {"status": "error", "message": "not ready"})
            return

        try:
            chunks, truncated, elapsed = rt.retrieve(params)
        except RuntimeError as exc:
            if str(exc) == "busy":
                self._send(503, {"status": "error", "message": "busy"})
                return
            LOG.exception("retrieve 실패")
            self._send(500, {"status": "error", "message": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001 — 어떤 실패도 프로세스를 죽이지 않는다
            # 타임아웃(concurrent.futures.TimeoutError / asyncio.TimeoutError) 포함.
            LOG.warning("retrieve 오류: %s: %s", type(exc).__name__, exc)
            self._send(
                504 if "Timeout" in type(exc).__name__ else 500,
                {"status": "error", "message": type(exc).__name__},
            )
            return

        self._send(
            200,
            {
                "status": "ok",
                "mode": params["mode"],
                "chunks": chunks,
                "truncated": truncated,
                "elapsed_ms": elapsed,
            },
        )


def make_server(host, port, runtime):
    handler = type("BoundHandler", (Handler,), {"runtime": runtime})
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description="KEIwi RAG 검색 서비스")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )

    runtime = RagRuntime()
    boot = time.monotonic()
    runtime.start()
    LOG.info("LightRAG 준비 완료 (%.2fs) — 검색 전용", time.monotonic() - boot)

    server = make_server(args.host, args.port, runtime)
    LOG.info("listen http://%s:%d (/healthz, /retrieve)", args.host, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()
        runtime.stop()


if __name__ == "__main__":
    main()

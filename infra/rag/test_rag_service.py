#!/usr/bin/env python3
"""rag_service 유닛 테스트 — stdlib ``unittest`` 전용, **GPU·네트워크 0**.

LightRAG를 import하지 않는다. ``RagRuntime(query_data=...)``에 가짜 검색
함수를 주입해 HTTP 계약 전체(파싱·상한·타임아웃·동시성·오류코드)를 실제
소켓 위에서 돌린다. 러너에 venv·모델·색인이 없어도 통과해야 한다 —
이 테스트가 색인 산출물을 요구하는 순간 CI에서 조용히 스킵된다.

판정 대상:
  · R1 검색 전용 — 쓰기·생성 엔드포인트가 없다(라우팅 표면 자체가 2개)
  · R2 파싱·상한 — 상한 초과는 거부가 아니라 클램프, query 누락만 400
  · R3 청크 정규화 — 출처 없는 청크 폐기·중복 제거·문자 상한
  · R4 실패 격리 — 타임아웃 504, 포화 503, 예외가 프로세스를 죽이지 않음
  · R5 동시성 — 동시 실행이 MAX_INFLIGHT를 넘지 않는다
"""

import asyncio
import json
import os
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import rag_service as rs  # noqa: E402  (경로 주입 후 import)


def ok_data(chunks):
    return {"status": "success", "message": "ok", "data": {"chunks": chunks}}


def chunk(path, content="본문", cid=None):
    return {
        "file_path": path,
        "content": content,
        "chunk_id": cid if cid is not None else "c-" + path,
        "reference_id": "1",
    }


class FakeParam:
    """QueryParam 대역 — 필드 이름은 실물과 같게 유지한다(R6가 실물을 따로 판정)."""

    def __init__(self, params):
        self.mode = params["mode"]
        self.top_k = params["top_k"]
        self.chunk_top_k = params["chunk_top_k"]
        self.enable_rerank = False
        self.ll_keywords = list(params["ll_keywords"])
        self.hl_keywords = list(params["hl_keywords"])


class Harness:
    """가짜 검색 함수를 문 RagRuntime + 실제 HTTP 서버."""

    def __init__(self, query_data):
        self.runtime = rs.RagRuntime(query_data=query_data, param_factory=FakeParam)
        self.runtime.start()
        self.server = rs.make_server("127.0.0.1", 0, self.runtime)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.runtime.stop()

    def post(self, body, path="/retrieve"):
        req = urllib.request.Request(
            "http://127.0.0.1:%d%s" % (self.port, path),
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def get(self, path="/healthz"):
        try:
            with urllib.request.urlopen(
                "http://127.0.0.1:%d%s" % (self.port, path), timeout=10
            ) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))


# ══════════════════════════════════════════════════════════════════════════
# R2 — 요청 파싱 (순수)
# ══════════════════════════════════════════════════════════════════════════


class TestParse(unittest.TestCase):
    def test_minimal(self):
        p = rs.parse_retrieve_request(b'{"query":"XID 43"}')
        self.assertEqual(p["query"], "XID 43")
        self.assertEqual(p["mode"], "hybrid")
        self.assertEqual(p["top_k"], rs.TOP_K_DEFAULT)
        self.assertEqual(p["ll_keywords"], [])

    def test_query_required(self):
        for raw in (b"{}", b'{"query":""}', b'{"query":"   "}', b'{"query":123}'):
            with self.assertRaises(rs.BadRequest, msg=raw):
                rs.parse_retrieve_request(raw)

    def test_not_json_or_not_object(self):
        with self.assertRaises(rs.BadRequest):
            rs.parse_retrieve_request(b"not json")
        with self.assertRaises(rs.BadRequest):
            rs.parse_retrieve_request(b"[1,2]")

    def test_invalid_mode_rejected(self):
        with self.assertRaises(rs.BadRequest):
            rs.parse_retrieve_request(b'{"query":"q","mode":"bypass"}')

    def test_limits_are_clamped_not_rejected(self):
        """상한 초과는 400이 아니라 클램프 — 조용한 품질 저하보다 잘린 답이 낫다."""
        p = rs.parse_retrieve_request(
            json.dumps(
                {
                    "query": "q" * (rs.MAX_QUERY_CHARS + 500),
                    "top_k": 9999,
                    "chunk_top_k": 9999,
                    "timeout_sec": 9999,
                    "ll_keywords": ["k%d" % i for i in range(50)],
                }
            ).encode("utf-8")
        )
        self.assertEqual(len(p["query"]), rs.MAX_QUERY_CHARS)
        self.assertEqual(p["top_k"], rs.TOP_K_MAX)
        self.assertEqual(p["chunk_top_k"], rs.CHUNK_TOP_K_MAX)
        self.assertEqual(p["timeout_sec"], rs.TIMEOUT_MAX)
        self.assertEqual(len(p["ll_keywords"]), rs.MAX_KEYWORDS)

    def test_keywords_drop_non_strings(self):
        p = rs.parse_retrieve_request(
            b'{"query":"q","ll_keywords":["a",1,null,"  ","b"]}'
        )
        self.assertEqual(p["ll_keywords"], ["a", "b"])

    def test_oversized_body(self):
        with self.assertRaises(rs.BadRequest):
            rs.parse_retrieve_request(b"x" * (rs.MAX_BODY_BYTES + 1))


# ══════════════════════════════════════════════════════════════════════════
# R3 — 청크 정규화 (순수)
# ══════════════════════════════════════════════════════════════════════════


class TestNormalize(unittest.TestCase):
    def test_failure_status_is_empty_not_error(self):
        """'문서 히트 0건'은 정상 상태다 — 예외가 아니라 빈 목록."""
        out, trunc = rs.normalize_chunks(
            {"status": "failure", "message": "no results", "data": {}}, 6
        )
        self.assertEqual(out, [])
        self.assertFalse(trunc)

    def test_garbage_shapes(self):
        for bad in (None, [], {"data": {}}, {"status": "success"},
                    {"status": "success", "data": {"chunks": "x"}}):
            out, _ = rs.normalize_chunks(bad, 6)
            self.assertEqual(out, [], msg=repr(bad))

    def test_drops_sourceless_chunks(self):
        """출처 없는 청크는 근거 번호를 받을 수 없다 → 폐기."""
        data = ok_data(
            [
                chunk("docs__runbooks__a.md"),
                chunk("unknown_source", cid="c2"),
                {"content": "출처없음", "chunk_id": "c3"},
                {"file_path": "docs__b.md", "chunk_id": "c4"},  # 본문 없음
            ]
        )
        out, _ = rs.normalize_chunks(data, 6)
        self.assertEqual([c["file_path"] for c in out], ["docs__runbooks__a.md"])

    def test_dedupes_by_chunk_id(self):
        data = ok_data([chunk("a.md", cid="same"), chunk("b.md", cid="same")])
        out, _ = rs.normalize_chunks(data, 6)
        self.assertEqual(len(out), 1)

    def test_char_cap_and_limit(self):
        data = ok_data(
            [chunk("d%d.md" % i, content="가" * 5000, cid="c%d" % i) for i in range(10)]
        )
        out, trunc = rs.normalize_chunks(data, 3, char_cap=100)
        self.assertEqual(len(out), 3)
        self.assertTrue(all(len(c["content"]) <= 100 for c in out))
        self.assertTrue(trunc)


# ══════════════════════════════════════════════════════════════════════════
# R1·R4·R5 — HTTP 계약 (실제 소켓, 가짜 RAG)
# ══════════════════════════════════════════════════════════════════════════


class TestHttp(unittest.TestCase):
    def test_r1_only_two_endpoints_exist(self):
        """검색 전용 — 쓰기·생성 표면이 없다는 것을 라우팅으로 증명한다."""

        async def q(_query, _param):
            return ok_data([chunk("docs__runbooks__a.md")])

        h = Harness(q)
        self.addCleanup(h.close)

        self.assertEqual(h.get("/healthz")[0], 200)
        self.assertEqual(h.post({"query": "q"}, "/retrieve")[0], 200)
        # 쓰기로 쓰일 만한 이름은 전부 404다.
        for path in ("/insert", "/ingest", "/documents", "/reload", "/query", "/"):
            self.assertEqual(h.post({"query": "q"}, path)[0], 404, path)
            self.assertEqual(h.get(path)[0], 404, path)

    def test_healthz_declares_retrieval_only(self):
        async def q(_query, _param):
            return ok_data([])

        h = Harness(q)
        self.addCleanup(h.close)
        status, body = h.get("/healthz")
        self.assertEqual(status, 200)
        self.assertTrue(body["ready"])
        self.assertEqual(body["mode"], "retrieval-only")

    def test_retrieve_returns_chunks_only(self):
        """엔티티·관계는 반환하지 않는다(색인 병합으로 file_path가 어긋난 실측)."""

        async def q(_query, _param):
            return {
                "status": "success",
                "data": {
                    "chunks": [chunk("docs__runbooks__gpu-xid.md", "XID 43 …")],
                    "entities": [{"entity_name": "XID", "file_path": "무관.md"}],
                    "relationships": [{"src_id": "a", "tgt_id": "b"}],
                },
            }

        h = Harness(q)
        self.addCleanup(h.close)
        status, body = h.post({"query": "XID 43"})
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertNotIn("entities", body)
        self.assertNotIn("relationships", body)
        self.assertEqual(body["chunks"][0]["file_path"], "docs__runbooks__gpu-xid.md")

    def test_explicit_keywords_are_passed_through(self):
        """ll_keywords를 넘기면 LightRAG 자체 키워드추출을 생략한다(3.14s→1.93s)."""
        seen = {}

        async def q(_query, param):
            seen["ll"] = list(param.ll_keywords)
            seen["mode"] = param.mode
            seen["rerank"] = param.enable_rerank
            return ok_data([])

        h = Harness(q)
        self.addCleanup(h.close)
        h.post({"query": "q", "mode": "naive", "ll_keywords": ["xid", "43"]})
        self.assertEqual(seen["ll"], ["xid", "43"])
        self.assertEqual(seen["mode"], "naive")
        self.assertFalse(seen["rerank"], "rerank 모델 미배치 — 항상 꺼져야 한다")

    def test_bad_request_returns_400(self):
        async def q(_query, _param):
            return ok_data([])

        h = Harness(q)
        self.addCleanup(h.close)
        self.assertEqual(h.post({})[0], 400)

    def test_r4_timeout_returns_504_and_survives(self):
        async def slow(_query, _param):
            await asyncio.sleep(30)
            return ok_data([])

        h = Harness(slow)
        self.addCleanup(h.close)
        status, body = h.post({"query": "q", "timeout_sec": 0.5})
        self.assertEqual(status, 504)
        self.assertEqual(body["status"], "error")
        # 프로세스가 살아 있다 — 다음 요청이 정상 처리된다.
        self.assertEqual(h.get("/healthz")[0], 200)

    def test_r4_exception_returns_500_and_survives(self):
        async def boom(_query, _param):
            raise ValueError("색인 손상")

        h = Harness(boom)
        self.addCleanup(h.close)
        status, body = h.post({"query": "q"})
        self.assertEqual(status, 500)
        self.assertEqual(body["status"], "error")
        self.assertEqual(h.get("/healthz")[0], 200)

    def test_r5_concurrency_capped(self):
        state = {"now": 0, "max": 0}
        lock = threading.Lock()

        async def q(_query, _param):
            with lock:
                state["now"] += 1
                state["max"] = max(state["max"], state["now"])
            await asyncio.sleep(0.25)
            with lock:
                state["now"] -= 1
            return ok_data([chunk("a.md")])

        h = Harness(q)
        self.addCleanup(h.close)

        results = []
        threads = [
            threading.Thread(target=lambda: results.append(h.post({"query": "q"})[0]))
            for _ in range(5)
        ]
        started = time.monotonic()
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        elapsed = time.monotonic() - started

        self.assertLessEqual(
            state["max"], rs.MAX_INFLIGHT, "동시 실행이 상한을 넘었다"
        )
        # 포화분은 대기 후 처리되거나 503으로 빨리 실패한다 — 어느 쪽도 유실은 아니다.
        self.assertTrue(all(code in (200, 503) for code in results), results)
        self.assertLess(elapsed, 25, "포화가 무한 대기로 번지면 안 된다")


def _lightrag_available():
    try:
        import lightrag  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


# ══════════════════════════════════════════════════════════════════════════
# R6 — 실물 QueryParam 계약 (venv가 있을 때만; CI 러너에서는 스킵)
# ══════════════════════════════════════════════════════════════════════════


class TestRealQueryParam(unittest.TestCase):
    """FakeParam이 실물과 어긋나는 것을 잡는 유일한 지점.

    러너에는 lightrag venv가 없으므로 스킵된다. **스킵이 통과로 보이는
    구멍**을 알고 남긴다 — 대안은 CI에 GPU·색인을 요구하는 것이고 그건
    이 레포의 CI 원칙(러너에 시크릿·모델 0)과 맞바꿀 수 없다.
    """

    @unittest.skipUnless(_lightrag_available(), "lightrag 미설치(venv 밖) — 스킵")
    def test_build_query_param_accepts_our_fields(self):
        param = rs.build_query_param(
            {
                "mode": "hybrid",
                "top_k": 20,
                "chunk_top_k": 6,
                "ll_keywords": ["xid"],
                "hl_keywords": [],
            }
        )
        self.assertEqual(param.mode, "hybrid")
        self.assertEqual(param.chunk_top_k, 6)
        self.assertFalse(param.enable_rerank)
        self.assertEqual(param.ll_keywords, ["xid"])
        for field in ("mode", "top_k", "chunk_top_k", "enable_rerank",
                      "ll_keywords", "hl_keywords"):
            self.assertTrue(hasattr(param, field), field)


if __name__ == "__main__":
    unittest.main(verbosity=2)

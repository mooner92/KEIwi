#!/usr/bin/env python3
"""alert-relay 유닛 테스트 — stdlib ``unittest`` 전용, **외부 통신 0**.

정본 AC: ``specs/alert-enrichment/spec.md`` §3.6.
  · AC-E3-1  webhook 픽스처 POST → mock Slack postMessage 1회 + 200, LLM 미개입 p95 < 2s
  · AC-E3-3  firing→resolved 가 같은 fingerprint → 같은 thread_ts (유닛분)
  · AC-E3-4  동시 2건 → 어시스턴트 호출 **직렬화**, 2차 답글 2건 모두 게시(유실 0), 429 재시도 로그
  · AC-E3-7  2차 답글 payload에 근거 번호 ``[n]`` ≥1 + **원문 로그 라인 미포함**(정규식)
  · AC-E3-2(유닛분) 어시스턴트 불능이어도 기본 메시지는 정상 도착 — 실패 격리

mock Slack·mock 어시스턴트를 **``http.server``로 로컬에 띄운다**. 네트워크 스텁이 아니라
실제 소켓을 쓰는 이유는, urllib 헤더·타임아웃·재시도 같은 진짜 실패 지점이 스텁에서는
드러나지 않기 때문이다. 그러면서도 egress는 0이다(127.0.0.1 only).
"""

import json
import os
import re
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import alert_relay as ar  # noqa: E402  (경로 주입 후 import — 레포 체크아웃 어디서든 돌게)

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def load_fixture(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as fh:
        return json.load(fh)


# ── mock Slack ───────────────────────────────────────────────────────────────
class MockSlack(object):
    """``chat.postMessage`` 만 흉내낸다. 호출 payload를 전부 보관한다."""

    def __init__(self):
        self.posts = []
        self.lock = threading.Lock()
        self.seq = 0
        self.fail_times = 0  # 앞의 N회는 rate limit으로 답한다(백오프 검증용)

        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                with outer.lock:
                    if outer.fail_times > 0:
                        outer.fail_times -= 1
                        body = json.dumps({"ok": False, "error": "ratelimited"}).encode()
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        self.wfile.write(body)
                        return
                    outer.seq += 1
                    ts = "17543%05d.000100" % outer.seq
                    outer.posts.append(payload)
                body = json.dumps({"ok": True, "ts": ts, "channel": payload.get("channel")}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base(self):
        return "http://127.0.0.1:%d/api" % self.httpd.server_address[1]

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def top_level(self):
        return [p for p in self.posts if "thread_ts" not in p]

    def replies(self):
        return [p for p in self.posts if "thread_ts" in p]


# ── mock 어시스턴트 ──────────────────────────────────────────────────────────
class MockAssistant(object):
    """콘솔 ``POST /api/assistant`` 계약을 흉내낸다 — **동시 1, 초과 429**.

    동시 실행 최대치를 기록한다. relay가 직렬화하지 못하면 max_inflight가 2가 되어
    AC-E3-4가 실패한다. 즉 이 카운터가 직렬화의 증거다.
    """

    def __init__(self, answer=None, delay=0.05, fail_first=0, hard_fail=False):
        self.requests = []
        self.lock = threading.Lock()
        self.inflight = 0
        self.max_inflight = 0
        self.fail_first = fail_first
        self.hard_fail = hard_fail
        self.answer = answer or {
            "answer": "user6이 17:45경 Python 가상환경 2개를 설치한 것으로 보인다 [1][2].",
            "evidence": [
                {
                    "id": "d1",
                    "timestamp": "2026-08-03T08:45:12Z",
                    "fleetNode": "data04",
                    "service": "sudo",
                    "level": "info",
                    "message": "sudo: user6 : PWD=/home/user6/work ; COMMAND=/usr/bin/pip install tensorflow",
                },
                {
                    "id": "d2",
                    "timestamp": "2026-08-03T08:48:03Z",
                    "fleetNode": "data04",
                    "service": "kernel",
                    "level": "warn",
                    "message": "EXT4-fs (sda2): /home/user6/work/tf-venv write throttled",
                },
            ],
            "runbook": {"id": "disk-pressure", "path": "docs/runbooks/disk-pressure.md"},
        }
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                with outer.lock:
                    outer.requests.append(body)
                    if outer.hard_fail:
                        self.send_error(502, "vLLM down")
                        return
                    if outer.fail_first > 0:
                        outer.fail_first -= 1
                        self.send_error(429, "busy")
                        return
                    outer.inflight += 1
                    outer.max_inflight = max(outer.max_inflight, outer.inflight)
                try:
                    time.sleep(delay)
                    payload = json.dumps(outer.answer, ensure_ascii=False).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                finally:
                    with outer.lock:
                        outer.inflight -= 1

            def log_message(self, *_args):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self):
        return "http://127.0.0.1:%d/api/assistant" % self.httpd.server_address[1]

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


# 유닛테스트 전용 자격 문자열. **자격증명 형식을 흉내내지 않는다** —
# 게이트(check-no-secrets.sh S1)가 형식으로 판정하므로, 진짜처럼 생긴 테스트 값은
# 그 게이트를 무의미하게 만들거나(허용리스트) 영구 red를 만든다. 실제 값은 env(§13).
RELAY_CRED = "unit-test-credential"


class RelayHarness(object):
    """relay를 실제 소켓 위에 띄우고 mock 2대를 붙인다."""

    def __init__(self, assistant=None, collector=None, enrich=True,
                 store=None, dedup_window=None, db_path=None, cooldown_sec=None):
        self.slack = MockSlack()
        self.assistant = assistant if assistant is not None else MockAssistant()
        self.tmp = tempfile.TemporaryDirectory()
        env = {
            "RELAY_LISTEN_ADDR": "127.0.0.1",
            "RELAY_PORT": "0",
            "RELAY_SHARED_SECRET": RELAY_CRED,
            "SLACK_BOT_TOKEN": "unit-test-bot-credential",
            "RELAY_SLACK_CHANNEL": "#keiwi-relay-test",
            "RELAY_SLACK_API": self.slack.base,
            "RELAY_DB": db_path or os.path.join(self.tmp.name, "threads.db"),
            "RELAY_ASSISTANT_URL": self.assistant.url,
            "RELAY_ASSISTANT_TIMEOUT": "5",
            "RELAY_SLACK_TIMEOUT": "5",
            "RELAY_BACKOFF_BASE": "0.01",
            "RELAY_COLLECTOR": collector or os.path.join(self.tmp.name, "no-such-collector.sh"),
            "RELAY_ENRICH": "1" if enrich else "0",
        }
        if dedup_window is not None:
            env["RELAY_DEDUP_WINDOW_SEC"] = str(dedup_window)
        if cooldown_sec is not None:
            env["RELAY_COOLDOWN_SEC"] = str(cooldown_sec)
        self.cfg = ar.Config(env)
        self.app = ar.App(self.cfg, store=store)
        self.app.enricher.start()
        self.httpd = ar.make_server(self.app)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self):
        return "http://127.0.0.1:%d" % self.httpd.server_address[1]

    def post(self, payload, token=RELAY_CRED, headers=None):
        data = json.dumps(payload).encode("utf-8")
        hdrs = {"Content-Type": "application/json"}
        if token:
            hdrs["Authorization"] = "Bearer " + token
        hdrs.update(headers or {})
        req = urllib.request.Request(self.url + "/webhook", data=data, headers=hdrs, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    def drain(self, timeout=15):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.app.enricher.q.unfinished_tasks == 0:
                return True
            time.sleep(0.02)
        return False

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.app.enricher.stop()
        self.slack.close()
        self.assistant.close()
        self.tmp.cleanup()


# ══════════════════════════════════════════════════════════════════════════════
# 순수 함수
# ══════════════════════════════════════════════════════════════════════════════




def split_form_replies(replies):
    """통보 폼(#1b)과 그 외 답글을 분리 — 폼은 결정적이라 디스크 알림에 항상 붙는다."""
    forms = [r for r in replies if "통보 폼" in r["text"]]
    others = [r for r in replies if "통보 폼" not in r["text"]]
    return forms, others


class TestPureHelpers(unittest.TestCase):
    def test_normalize_node(self):
        self.assertEqual(ar.normalize_node("192.168.1.104:9100"), "data04")
        self.assertEqual(ar.normalize_node("192.168.1.104"), "data04")
        self.assertEqual(ar.normalize_node("data04"), "data04")
        self.assertIsNone(ar.normalize_node("10.0.0.1"))
        self.assertIsNone(ar.normalize_node(""))
        self.assertIsNone(ar.normalize_node(None))

    def test_redact_removes_command_and_paths(self):
        line = (
            "sudo: user6 : TTY=pts/3 ; PWD=/home/user6/work ; USER=root ; "
            "COMMAND=/usr/bin/pip install tensorflow"
        )
        out = ar.redact(line)
        self.assertNotIn("COMMAND=", out)
        self.assertNotIn("/home/user6/work", out)
        self.assertIn("user6", out, "계정명은 반출 상한 안이다(§4.1)")

    def test_redact_keeps_urls_and_mountpoints(self):
        text = "상세 → <http://192.168.1.105:3106/incidents?alert=DiskUsageHigh&mount=/&from=now-6h|콘솔>"
        self.assertEqual(ar.redact(text), text)
        self.assertIn("/home 303G", ar.redact("/home 303G"))

    def test_drop_local_only_fields_is_recursive(self):
        def keys(obj):
            """중첩 구조의 **키 이름만** 모은다 — 산문에 'raw'가 섞여도 오판하지 않게."""
            found = set()
            if isinstance(obj, dict):
                for k, v in obj.items():
                    found.add(k)
                    found |= keys(v)
            elif isinstance(obj, list):
                for v in obj:
                    found |= keys(v)
            return found

        data = load_fixture("collector-disk-attribution.json")
        self.assertIn("raw", keys(data), "픽스처 전제: raw가 원본에는 있다")
        self.assertNotIn("raw", keys(ar.drop_local_only_fields(data)))

    def test_build_slack_payload_is_the_only_export_path(self):
        payload = ar.build_slack_payload("#c", "PWD=/home/a/b COMMAND=rm -rf /tmp/x", thread_ts="1.2")
        self.assertEqual(payload["thread_ts"], "1.2")
        self.assertNotIn("COMMAND=", payload["text"])
        self.assertNotIn("/home/a/b", payload["text"])
        self.assertLessEqual(len(payload["text"]), ar.MAX_TEXT)

    def test_absolutize_window(self):
        url = "http://192.168.1.105:3000/d/keiwi-system-v3?orgId=1&var-instance=x&from=now-6h&to=now"
        out = ar.absolutize_window(url, "2026-08-03T08:59:00Z", "2026-08-03T09:41:00Z")
        self.assertNotIn("now-6h", out)
        self.assertIn("var-instance=x", out)
        # 2026-08-03T08:59:00Z = 1785747540 → lead 60m → 1785743940(초) → ms
        self.assertIn("from=1785743940000", out)
        # 2026-08-03T09:41:00Z = 1785750060 → tail 30m → 1785751860(초) → ms
        self.assertIn("to=1785751860000", out)

    def test_preset_question_matches_console_contract(self):
        q = ar.preset_question("DiskUsageHigh", "data04", "/")
        self.assertEqual(q, "최근 6시간 data04 / 디스크 사용 급증의 원인 후보를 로그에서 찾아줘")
        # 미지 알림도 링크가 깨지지 않게 일반형으로 폴백한다.
        self.assertIn("SomethingNew", ar.preset_question("SomethingNew", "data03"))

    def test_render_top_level_uses_rendered_payload(self):
        payload = load_fixture("webhook-diskusagehigh-firing.json")
        text = ar.render_top_level(payload)
        self.assertTrue(text.startswith(payload["title"]), "E1 템플릿 렌더 결과가 정본이다")
        self.assertIn("95.2%", text)

    def test_render_top_level_fallback_without_template(self):
        payload = load_fixture("webhook-diskusagehigh-firing.json")
        payload.pop("title")
        payload.pop("message")
        text = ar.render_top_level(payload)
        self.assertIn("DiskUsageHigh", text)
        self.assertIn("WARNING", text)

    def test_render_attribution_reply_from_collector_contract(self):
        clean = ar.drop_local_only_fields(load_fixture("collector-disk-attribution.json"))
        ctx = {"node": "data04", "mount": "/", "console_url": "http://192.168.1.105:3106/incidents?alert=x"}
        text = ar.render_attribution_reply(clean, ctx)
        self.assertIn("data04", text)
        self.assertIn("Python 환경", text)
        self.assertIn("user6", text)
        self.assertIn("비sudo 활동은 포함되지 않는다", text, "한계를 답글에 명시한다(spec §4.2)")
        self.assertNotIn("COMMAND=", text)
        self.assertNotIn("/home/user6", text)

    def _junk_payload(self):
        """2026-08-12 실채널 사고 재현 — stripPort 파싱 실패로 원문이 그대로 온 payload."""
        return {
            "status": "firing",
            "commonLabels": {"alertname": "DiskUsageHigh", "severity": "warning"},
            "title": "🔴 [WARNING] DiskUsageHigh · 192.168.1.104:9100",
            "message": '{{ $$labels.instance | stripPort }} 사용률 {{ printf "%.1f" $$values.A.Value }}%',
            "alerts": [{
                "labels": {"alertname": "DiskUsageHigh", "instance": "192.168.1.104:9100",
                           "severity": "warning", "mountpoint": "/"},
                "annotations": {
                    "summary": '{{ $$labels.instance | stripPort }} 사용률 {{ printf "%.1f" $$values.A.Value }}%',
                    "drilldown_url": "http://192.168.1.105:3000/d/x?var-instance={{ $$labels.instance }}",
                    "runbook_url": "https://github.com/mooner92/KEIwi/blob/main/docs/runbooks/disk-pressure.md",
                },
                "values": {"A": 95.2, "C": 1},
                "silenceURL": "http://192.168.1.105:3000/alerting/silence/new?x=1",
                "startsAt": "2026-08-03T10:38:00Z",
                "fingerprint": "f1",
            }],
        }

    def test_render_top_level_rebuilds_when_template_junk_leaks(self):
        """렌더 실패 흔적({{)이 있으면 원문을 버리고 결정적으로 재조립한다."""
        text = ar.render_top_level(self._junk_payload())
        self.assertNotIn("{{", text, "템플릿 원문이 Slack에 새면 안 된다: %r" % text)
        self.assertIn("data04", text, "노드는 ip:port가 아니라 이름으로")
        self.assertIn("95.2", text, "발화 시점 확정값(values)으로 사실을 말한다")
        self.assertIn("침묵", text)
        self.assertIn("런북", text)
        self.assertNotIn("드릴다운", text, "깨진 URL 링크는 그 링크만 뺀다")
        # 단일 알림 — 제목이 말한 alertname을 본문이 반복하지 않는다(실채널 중복 실측).
        self.assertEqual(text.count("DiskUsageHigh"), 1)

    def test_render_top_level_passthrough_when_clean(self):
        """정본 템플릿이 멀쩡하면 그대로 중계한다 — 재조립은 사고 시에만."""
        payload = self._junk_payload()
        payload["title"] = "🔴 [WARNING] DiskUsageHigh · data04"
        payload["message"] = "data04 / 사용률 95.2% (임계 90%)\n시작 08-03 19:38 KST"
        text = ar.render_top_level(payload)
        self.assertEqual(text, payload["title"] + "\n" + payload["message"])

    def test_render_notice_form_from_collector(self):
        """통보 폼 — 수집기 값(노드·사용률·상위 사용자)이 채워진 복붙 블록."""
        data = json.load(open(os.path.join(FIXTURES, "collector-disk-attribution.json")))
        data = ar.drop_local_only_fields(data)
        ctx = {"alertname": "DiskUsageHigh", "node": "data04", "mount": "/",
               "runbook_url": "https://github.com/mooner92/KEIwi/blob/main/docs/runbooks/disk-pressure.md"}
        text = ar.render_notice_form(data, ctx)
        self.assertIn("[디스크 정리 요청] data04 / 95%", text)
        self.assertIn("체크포인트", text)
        self.assertIn("user2", text)          # E4가 허용한 owner 필드 재사용
        self.assertIn("자동 발송하지 않습니다", text)
        self.assertNotIn("raw", text)          # 로컬 전용 필드는 폼에도 없다

    def test_render_notice_form_without_collector_still_renders(self):
        """수집 실패여도 폼은 낸다 — 알림 발화가 이미 임계 초과를 증언한다."""
        ctx = {"alertname": "DiskFillPredicted", "node": "data05", "mount": "/"}
        text = ar.render_notice_form(None, ctx)
        self.assertIn("data05", text)
        self.assertIn("임계 초과", text)

    def test_render_notice_form_only_for_disk_alerts(self):
        """디스크 외 알림에는 폼을 만들지 않는다 — 90% 게이트의 존재 이유."""
        self.assertIsNone(ar.render_notice_form({}, {"alertname": "GpuTempHigh"}))

    def test_render_attribution_reply_skips_when_empty(self):
        self.assertIsNone(ar.render_attribution_reply(None, {}))
        self.assertIsNone(ar.render_attribution_reply({}, {"node": "data04"}))

    def test_render_assistant_reply_requires_evidence(self):
        self.assertIsNone(ar.render_assistant_reply({"answer": "근거 부족", "evidence": []}, {}))


# ══════════════════════════════════════════════════════════════════════════════
# AC-E3-1 · 인증 · AC-E3-2(유닛분)
# ══════════════════════════════════════════════════════════════════════════════


class TestWebhookSyncPath(unittest.TestCase):
    def setUp(self):
        self.h = RelayHarness()
        self.addCleanup(self.h.close)

    def test_ac_e3_1_single_post_and_200_under_2s(self):
        payload = load_fixture("webhook-diskusagehigh-firing.json")
        started = time.time()
        status, body = self.h.post(payload)
        elapsed = time.time() - started
        self.assertEqual(status, 200)
        self.assertEqual(body["posted"], 1)
        self.assertTrue(body["ts"])
        # 동기 경로에 LLM이 없다 — 게시 1회로 끝나야 한다.
        self.assertEqual(len(self.h.slack.top_level()), 1)
        self.assertLess(elapsed, 2.0, "LLM 미개입 경로 p95 < 2s (AC-E3-1)")
        posted = self.h.slack.top_level()[0]
        self.assertEqual(posted["channel"], "#keiwi-relay-test", "섀도 기본값은 테스트 채널")
        self.assertNotIn("thread_ts", posted)
        self.assertIn("95.2%", posted["text"])

    def test_unauthorized_is_rejected_before_slack(self):
        payload = load_fixture("webhook-diskusagehigh-firing.json")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.h.post(payload, token="wrong")
        self.assertEqual(caught.exception.code, 401)
        self.assertEqual(self.h.slack.posts, [], "인증 전에 Slack을 건드리지 않는다")

    def test_no_token_is_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.h.post(load_fixture("webhook-diskusagehigh-firing.json"), token=None)
        self.assertEqual(caught.exception.code, 401)

    def test_healthz_reports_db_and_last_seen(self):
        with urllib.request.urlopen(self.h.url + "/healthz", timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            health = json.loads(resp.read().decode("utf-8"))
        self.assertEqual(health["status"], "ok")
        self.assertTrue(health["db_ok"])
        self.assertIsNone(health["last_webhook_at"])
        self.h.post(load_fixture("webhook-diskusagehigh-firing.json"))
        with urllib.request.urlopen(self.h.url + "/healthz", timeout=5) as resp:
            health = json.loads(resp.read().decode("utf-8"))
        self.assertIsNotNone(health["last_webhook_at"])
        self.assertEqual(health["threads"], 1)


class TestAssistantFailureIsolation(unittest.TestCase):
    """AC-E3-2(유닛분) — vLLM(어시스턴트)이 죽어도 1차 전달은 무손실."""

    def test_basic_message_survives_assistant_outage(self):
        harness = RelayHarness(assistant=MockAssistant(hard_fail=True))
        self.addCleanup(harness.close)
        status, body = harness.post(load_fixture("webhook-diskusagehigh-firing.json"))
        self.assertEqual(status, 200)
        self.assertEqual(body["posted"], 1)
        self.assertTrue(harness.drain())
        self.assertEqual(len(harness.slack.top_level()), 1)
        forms, others = split_form_replies(harness.slack.replies())
        self.assertEqual(others, [], "실패는 Slack에 도배하지 않는다(로그에만)")
        # 통보 폼(#1b)은 결정적이라 어시스턴트가 죽어도 게시된다 — 디스크 알림의 핵심 산출물.
        self.assertEqual(len(forms), 1)
        self.assertIn("복붙용", forms[0]["text"])


# ══════════════════════════════════════════════════════════════════════════════
# AC-E3-3 (유닛분) — 스레드 연속성
# ══════════════════════════════════════════════════════════════════════════════


class TestThreading(unittest.TestCase):
    def setUp(self):
        self.h = RelayHarness()
        self.addCleanup(self.h.close)

    def test_ac_e3_3_resolved_replies_in_same_thread(self):
        firing = load_fixture("webhook-diskusagehigh-firing.json")
        _, body = self.h.post(firing)
        ts = body["ts"]
        self.assertTrue(self.h.drain())

        _, resolved_body = self.h.post(load_fixture("webhook-diskusagehigh-resolved.json"))
        self.assertEqual(resolved_body["replies"], 1)
        self.assertEqual(resolved_body["posted"], 0, "해결은 새 메시지가 아니라 스레드 답글이다")
        resolved_posts = [p for p in self.h.slack.replies() if p["text"].startswith("✅ 해결")]
        self.assertEqual(len(resolved_posts), 1)
        self.assertEqual(resolved_posts[0]["thread_ts"], ts)

        row = self.h.app.store.lookup("a1b2c3d4e5f60001")
        self.assertEqual(row["ts"], ts)
        self.assertEqual(row["alertname"], "DiskUsageHigh")

    def test_resolved_without_thread_falls_back_to_top_level(self):
        """relay 도입 전 발화·TTL 만료·DB 유실 — 해결을 조용히 삼키지 않는다."""
        _, body = self.h.post(load_fixture("webhook-diskusagehigh-resolved.json"))
        self.assertEqual(body["posted"], 1)
        self.assertEqual(len(self.h.slack.top_level()), 1)

    def test_repeat_notification_does_not_re_enrich(self):
        """재통지(startsAt 동일)에 LLM을 다시 태우지 않는다 — GPU·도배 양쪽 절약.

        ⚠️ 멱등 원장을 **끄고** 돌린다(`dedup_window=0`). 안 그러면 두 번째 POST가
        원장에서 잘려 `repeats` 판정 코드에 도달조차 하지 않고, 이 테스트는 "재통지 억제"가
        아니라 "중복 배달 억제"를 검사하게 된다 — 같은 초록인데 지키는 것이 다르다.
        재통지는 4~12시간 뒤에 오므로 실제로도 원장 창(300초) 밖이다.
        """
        harness = RelayHarness(dedup_window=0)
        self.addCleanup(harness.close)
        payload = load_fixture("webhook-diskusagehigh-firing.json")
        harness.post(payload)
        self.assertTrue(harness.drain())
        first_requests = len(harness.assistant.requests)
        _, body = harness.post(payload)
        self.assertEqual(body["enriched"], 0)
        # ✏️교정[2026-08-16 · spec alert-correlation C1]: 종전 계약은 "재통지도 최상위 게시는
        # 한다"였다. 재발화 강등이 들어오면서 **의도적으로** 바뀐다 — 같은 사건의 재통지는
        # 새 메시지가 아니라 원 스레드 답글이다. 이 테스트의 원래 취지(재보강 안 함)는 그대로다.
        self.assertEqual(body["posted"], 0, "재통지는 최상위에 다시 뜨지 않는다(강등)")
        self.assertEqual(body["demoted"], 1)
        self.assertEqual(len(harness.slack.top_level()), 1, "최상위는 최초 1건뿐")
        self.assertTrue(harness.drain())
        self.assertEqual(len(harness.assistant.requests), first_requests)

    def test_ttl_purge_removes_old_rows(self):
        store = self.h.app.store
        store.remember("old-fp", "#c", "1.0", "DiskUsageHigh", "2026-01-01T00:00:00Z")
        with store._connect() as conn:  # noqa: SLF001 — TTL 경로를 검증하려면 과거 시각을 심어야 한다
            conn.execute("UPDATE threads SET last_seen='2026-01-01T00:00:00Z' WHERE fingerprint='old-fp'")
        self.assertEqual(store.purge(30), 1)
        self.assertIsNone(store.lookup("old-fp"))


# ══════════════════════════════════════════════════════════════════════════════
# AC-E3-4 · AC-E3-7 — 비동기 보강
# ══════════════════════════════════════════════════════════════════════════════


class TestRepeatDemotion(unittest.TestCase):
    """재발화 강등 — spec alert-correlation C1 · AC-1·4·5.

    모든 케이스가 ``dedup_window=0`` 으로 돈다. 멱등 원장(배달 중복)이 켜져 있으면 두 번째
    POST가 거기서 잘려 **강등 코드에 도달조차 하지 않는다** — 그러면 이 테스트는 강등이
    아니라 배달 중복 억제를 검사하게 된다(둘은 다른 것이다, spec §1).
    """

    def _fire(self, harness, times):
        payload = load_fixture("webhook-diskusagehigh-firing.json")
        bodies = []
        for _ in range(times):
            _, body = harness.post(payload)
            bodies.append(body)
            self.assertTrue(harness.drain())
        return bodies

    def test_ac1_repeats_collapse_into_one_thread(self):
        """5회 발화 → 최상위 1건 + 답글 4건, 'N회째' 표기."""
        h = RelayHarness(dedup_window=0, cooldown_sec=1800)
        self.addCleanup(h.close)
        bodies = self._fire(h, 5)

        self.assertEqual(len(h.slack.top_level()), 1, "채널에 새 메시지는 최초 1건뿐")
        replies = [p for p in h.slack.replies() if "재발화" in p["text"]]
        self.assertEqual(len(replies), 4)
        self.assertEqual([b.get("demoted", 0) for b in bodies], [0, 1, 1, 1, 1])
        # 몇 번째인지가 답글의 존재 이유다 — 5회째와 1회째는 다른 정보다.
        self.assertIn("2회째", replies[0]["text"])
        self.assertIn("5회째", replies[-1]["text"])
        # 답글은 전부 최초 스레드에 붙는다.
        first_ts = bodies[0]["ts"]
        self.assertTrue(all(r["thread_ts"] == first_ts for r in replies))

    def test_ac4_critical_never_demoted(self):
        """치명 알림은 억제창을 무시하고 항상 최상위(spec C4-4)."""
        h = RelayHarness(dedup_window=0, cooldown_sec=1800)
        self.addCleanup(h.close)
        payload = load_fixture("webhook-diskusagehigh-firing.json")
        for alert in payload["alerts"]:
            alert.setdefault("labels", {})["severity"] = "critical"
        payload.setdefault("commonLabels", {})["severity"] = "critical"
        for _ in range(3):
            _, body = h.post(payload)
            self.assertEqual(body.get("demoted", 0), 0)
            self.assertTrue(h.drain())
        self.assertEqual(len(h.slack.top_level()), 3, "치명은 접지 않는다")

    def test_cooldown_expiry_resurfaces_to_top_level(self):
        """억제창 밖 재발화는 다시 최상위로 — 장기 사건이 스레드에 묻히지 않는다."""
        h = RelayHarness(dedup_window=0, cooldown_sec=1800)
        self.addCleanup(h.close)
        self._fire(h, 1)
        with h.app.store._connect() as conn:  # noqa: SLF001 — 창 밖을 만들려면 과거 시각이 필요하다
            conn.execute("UPDATE threads SET last_seen='2026-01-01T00:00:00Z'")
        self._fire(h, 1)
        self.assertEqual(len(h.slack.top_level()), 2)

    def test_disabled_when_cooldown_zero(self):
        """RELAY_COOLDOWN_SEC=0 → 종전 동작(항상 최상위). 되돌릴 스위치가 있어야 한다."""
        h = RelayHarness(dedup_window=0, cooldown_sec=0)
        self.addCleanup(h.close)
        self._fire(h, 3)
        self.assertEqual(len(h.slack.top_level()), 3)

    def test_ac5_store_failure_still_delivers(self):
        """DB가 죽어도 알림은 나간다 — 강등은 **못 해도** 유실은 없다(유실 0 불변식)."""
        h = RelayHarness(dedup_window=0, cooldown_sec=1800, store=ExplodingStore())
        self.addCleanup(h.close)
        self._fire(h, 2)
        self.assertEqual(len(h.slack.top_level()), 2, "판정 불가 → 최상위 게시(fail-open)")

    def test_mixed_group_is_not_collapsed(self):
        """새 알림이 섞인 그룹은 접지 않는다 — 접으면 새 문제가 은폐된다(spec C4)."""
        h = RelayHarness(dedup_window=0, cooldown_sec=1800)
        self.addCleanup(h.close)
        self._fire(h, 1)
        mixed = load_fixture("webhook-diskusagehigh-firing.json")
        extra = json.loads(json.dumps(mixed["alerts"][0]))
        extra["fingerprint"] = "ffffffffffff9999"
        extra["startsAt"] = "2026-08-16T09:00:00Z"
        mixed["alerts"].append(extra)
        _, body = h.post(mixed)
        self.assertEqual(body.get("demoted", 0), 0)
        self.assertEqual(len(h.slack.top_level()), 2)


class TestEnrichment(unittest.TestCase):
    def test_ac_e3_4_concurrent_alerts_are_serialized_without_loss(self):
        # 첫 호출은 429로 되돌려 백오프·재시도 경로까지 함께 판정한다.
        harness = RelayHarness(assistant=MockAssistant(delay=0.15, fail_first=1))
        self.addCleanup(harness.close)

        results = {}
        errors = []

        def fire(name, fixture):
            try:
                results[name] = harness.post(load_fixture(fixture))
            except Exception as exc:  # noqa: BLE001 — 스레드 예외를 삼키면 테스트가 거짓 통과한다
                errors.append(exc)

        threads = [
            threading.Thread(target=fire, args=("disk", "webhook-diskusagehigh-firing.json")),
            threading.Thread(target=fire, args=("gpu", "webhook-gputemphigh-firing.json")),
        ]
        with self.assertLogs("alert-relay", level="WARNING") as logs:
            for t in threads:
                t.start()
            for t in threads:
                t.join(20)
            self.assertTrue(harness.drain(30), "큐가 시간 내에 비지 않았다")

        # ① 유실 0 — 동시 2건이 모두 게시되고 200을 받았다.
        self.assertEqual(len(results), 2, errors)
        for status, body in results.values():
            self.assertEqual(status, 200)
            self.assertEqual(body["posted"], 1)
        self.assertEqual(len(harness.slack.top_level()), 2)

        # ② 2차 답글 2건 모두 게시 — 각자 자기 스레드에.
        forms, replies = split_form_replies(harness.slack.replies())
        self.assertEqual(len(replies), 2)
        self.assertEqual(len({r["thread_ts"] for r in replies}), 2, "답글이 서로 다른 스레드에 붙는다")
        self.assertEqual(len(forms), 1, "통보 폼은 디스크 알림에만 붙는다(GPU 알림엔 없음)")

        # ③ 직렬화 — 어시스턴트 동시 실행이 1을 넘지 않았다(콘솔 동시 1 계약과 정합).
        self.assertEqual(harness.assistant.max_inflight, 1)

        # ④ 429 재시도가 로그에 남았다.
        self.assertTrue(
            any("429" in line for line in logs.output),
            "429 백오프 재시도 로그가 없다: %s" % logs.output,
        )

    def test_ac_e3_7_reply_has_citation_numbers_and_no_raw_log_lines(self):
        harness = RelayHarness()
        self.addCleanup(harness.close)
        harness.post(load_fixture("webhook-diskusagehigh-firing.json"))
        self.assertTrue(harness.drain())

        _forms, replies = split_form_replies(harness.slack.replies())
        self.assertEqual(len(replies), 1)
        text = replies[0]["text"]

        # ① 근거 번호 [n] ≥1
        self.assertTrue(re.search(r"\[\d+\]", text), "근거 번호가 없다: %r" % text)

        # ② 원문 로그 라인 미포함 (정규식 게이트 — spec §4.1 반출 상한)
        self.assertNotRegex(text, r"COMMAND=")
        self.assertNotRegex(text, r"/home/[A-Za-z0-9._-]+/")
        self.assertNotRegex(text, r"EXT4-fs")
        self.assertNotRegex(text, r"PWD=")

        # ③ 근거는 메타(시각·노드·서비스·레벨)까지만 나간다.
        self.assertIn("data04", text)
        self.assertIn("sudo", text)
        self.assertIn("17:45", text, "KST 표기")

        # ④ relay만이 할 수 있는 보강 — 절대 시간창 드릴다운.
        self.assertIn("from=17", text)
        self.assertNotIn("from=now-6h", text)

    def test_collector_missing_skips_reply_one(self):
        """E4 수집기 미배포 = 답글 #1 생략. E3는 E4 없이도 성립한다."""
        harness = RelayHarness()
        self.addCleanup(harness.close)
        harness.post(load_fixture("webhook-diskusagehigh-firing.json"))
        self.assertTrue(harness.drain())
        self.assertFalse(
            any(p["text"].startswith("📎") for p in harness.slack.replies()),
            "수집기가 없는데 귀속 답글이 나갔다",
        )

    def test_collector_contract_produces_attribution_reply(self):
        """수집기가 있으면 답글 #1(결정적) → #2(LLM) 순서로 두 건."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        script = os.path.join(tmp.name, "disk-attribution.sh")
        fixture = os.path.join(FIXTURES, "collector-disk-attribution.json")
        with open(script, "w", encoding="utf-8") as fh:
            fh.write("#!/bin/sh\ncat %s\n" % fixture)
        os.chmod(script, 0o755)

        harness = RelayHarness(collector=script)
        self.addCleanup(harness.close)
        harness.post(load_fixture("webhook-diskusagehigh-firing.json"))
        self.assertTrue(harness.drain())

        forms, replies = split_form_replies(harness.slack.replies())
        self.assertEqual(len(replies), 2)
        self.assertTrue(replies[0]["text"].startswith("📎"), "결정적 답글이 먼저다")
        self.assertEqual(len(forms), 1)
        self.assertIn("[디스크 정리 요청]", forms[0]["text"])
        joined = "\n".join(r["text"] for r in replies)
        self.assertNotIn("COMMAND=", joined)
        self.assertNotIn("/home/user6", joined)
        self.assertIn("user6", joined)


# ══════════════════════════════════════════════════════════════════════════════
# 서명(HMAC) — 선택 경로
# ══════════════════════════════════════════════════════════════════════════════


class TestSignature(unittest.TestCase):
    def test_hmac_accepts_known_variants_and_rejects_forgery(self):
        import hashlib
        import hmac as hmac_mod

        body = b'{"status":"firing"}'
        sig_cred = "hmac-unit-test"
        digest = hmac_mod.new(sig_cred.encode(), body, hashlib.sha256).hexdigest()
        ok, _ = ar.verify_signature(sig_cred, body, {"X-Grafana-Alerting-Signature": digest})
        self.assertTrue(ok)

        stamped = hmac_mod.new(sig_cred.encode(), b"1754211540:" + body, hashlib.sha256).hexdigest()
        ok, _ = ar.verify_signature(
            sig_cred,
            body,
            {"X-Grafana-Alerting-Signature": stamped, "X-Grafana-Alerting-Timestamp": "1754211540"},
        )
        self.assertTrue(ok)

        ok, reason = ar.verify_signature(sig_cred, body, {"X-Grafana-Alerting-Signature": "deadbeef"})
        self.assertFalse(ok)
        self.assertIn("불일치", reason)

        ok, reason = ar.verify_signature(sig_cred, body, {})
        self.assertFalse(ok)


# ══════════════════════════════════════════════════════════════════════════════
# [재현] 결함 1 — sqlite 쓰기 실패가 Slack 도배가 되던 경로
#
# 실증(2026-08-04, 수정 전): DB를 읽기전용으로 만들고 같은 웹훅을 3회 보내면
#   · HTTP 응답이 **아예 오지 않는다**(RemoteDisconnected ×3)
#     → `store.remember` 가 게시 뒤에 던지고 `do_POST` 가 안 잡아 소켓이 그냥 닫힌다.
#   · Grafana는 응답이 없으니 재시도하고, 재시도마다 **Slack 최상위 게시가 하나씩 는다**
#     → 알림 1건에 게시 3건.
# 하필 이 실패의 대표 원인이 디스크 풀이고, 이 relay의 주 용도가 DiskUsageHigh다.
#
# 고친 뒤의 계약(아래 테스트가 그것을 고정한다):
#   ① 저장이 어떻게 실패해도 **응답은 나간다**(200).
#   ② 같은 배달은 **한 번만 게시된다**(DeliveryLedger — 디스크와 무관한 메모리 원장).
#   ③ 저장 실패는 침묵하지 않는다(`degraded` 플래그 + /healthz).
# ══════════════════════════════════════════════════════════════════════════════


class ExplodingStore(object):
    """모든 쓰기가 던지는 저장소. `ThreadStore` 의 흡수를 **건너뛰고** 상위 계층을 시험한다.

    ThreadStore 안에서만 막으면 "저장소가 완벽하다"는 전제가 되살아난다. 저장소를 갈아끼운
    다음 사람이 던지는 구현을 넣어도 relay가 응답을 잃지 않아야 한다.
    """

    degraded = True
    degraded_reason = "테스트: 강제 실패"

    def __init__(self):
        self.calls = 0

    def _boom(self, *_a, **_k):
        self.calls += 1
        raise sqlite3.OperationalError("attempt to write a readonly database")

    remember = _boom
    touch = _boom
    purge = _boom

    def lookup(self, _fingerprint):
        return None

    def count(self):
        return 0


class TestStoreFailureDoesNotFlood(unittest.TestCase):
    def test_store_write_failure_still_answers_200_and_posts_once(self):
        """[재현] 저장이 던져도 ① 응답은 나가고 ② 게시는 1회다."""
        store = ExplodingStore()
        harness = RelayHarness(store=store)
        self.addCleanup(harness.close)
        payload = load_fixture("webhook-diskusagehigh-firing.json")

        statuses = []
        for _ in range(3):
            # 수정 전에는 여기서 RemoteDisconnected 가 났다(응답 없음).
            statuses.append(harness.post(payload)[0])

        self.assertEqual(statuses, [200, 200, 200], "저장 실패가 응답 부재가 되면 안 된다")
        self.assertEqual(
            len(harness.slack.top_level()), 1,
            "같은 배달이 여러 번 게시됐다 — 도배 경로가 살아 있다",
        )
        self.assertGreater(store.calls, 0, "저장소가 실제로 호출되긴 했다(테스트가 헛돌지 않는다)")

    def test_store_failure_is_reported_not_swallowed(self):
        """실패를 흡수하는 것과 숨기는 것은 다르다 — degraded 로 드러난다."""
        harness = RelayHarness(store=ExplodingStore())
        self.addCleanup(harness.close)
        _, body = harness.post(load_fixture("webhook-diskusagehigh-firing.json"))
        self.assertTrue(body.get("degraded"), "저장 실패가 응답에 드러나지 않는다")

    @unittest.skipIf(os.name != "posix", "파일 권한 기반 재현은 posix 전용")
    @unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0,
                     "root는 파일 권한을 무시한다 — 읽기전용 재현이 성립하지 않는다")
    def test_readonly_database_file_end_to_end(self):
        """[재현] 실제로 DB 파일을 읽기전용으로 만든 그 시나리오 그대로."""
        harness = RelayHarness()
        self.addCleanup(harness.close)
        payload = load_fixture("webhook-diskusagehigh-firing.json")
        db = harness.cfg.db_path
        parent = os.path.dirname(db)
        os.chmod(db, 0o444)
        os.chmod(parent, 0o555)   # 저널 파일 생성까지 막아야 진짜 "쓰기 불가"가 된다
        self.addCleanup(lambda: os.chmod(db, 0o644))
        self.addCleanup(lambda: os.chmod(parent, 0o755))

        statuses = [harness.post(payload)[0] for _ in range(3)]
        self.assertEqual(statuses, [200, 200, 200])
        self.assertEqual(len(harness.slack.top_level()), 1)

        # /healthz 는 degraded 를 503으로 알린다 — 흡수했다고 침묵하지 않는다.
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(harness.url + "/healthz", timeout=5)
        self.assertEqual(caught.exception.code, 503)
        health = json.loads(caught.exception.read().decode("utf-8"))
        self.assertFalse(health["db_ok"])
        self.assertTrue(health["db_error"])

    def test_thread_continuity_survives_disk_failure(self):
        """디스크가 죽어도 발생→해결이 한 스레드다(메모리 티어). 하필 디스크 풀이 그 사건이다."""
        harness = RelayHarness()
        self.addCleanup(harness.close)
        store = harness.app.store
        firing = load_fixture("webhook-diskusagehigh-firing.json")
        _, body = harness.post(firing)
        ts = body["ts"]
        self.assertTrue(harness.drain())

        # 이제 디스크가 죽는다 — 이후의 lookup/remember 는 전부 실패한다.
        real_connect = store._connect                      # noqa: SLF001

        def dead_disk():
            raise sqlite3.OperationalError("disk I/O error")

        store._connect = dead_disk                         # noqa: SLF001
        self.addCleanup(lambda: setattr(store, "_connect", real_connect))

        _, resolved = harness.post(load_fixture("webhook-diskusagehigh-resolved.json"))
        self.assertEqual(resolved["replies"], 1, "디스크가 죽자 해결이 최상위로 튀었다")
        self.assertEqual(resolved["posted"], 0)
        reply = [p for p in harness.slack.replies() if p["text"].startswith("✅ 해결")][0]
        self.assertEqual(reply["thread_ts"], ts)

    def test_slack_failure_still_answers_and_stays_retryable(self):
        """게시가 0건이면 502 — 그리고 원장이 그 배달을 **붙잡지 않아야** 재시도가 산다."""
        harness = RelayHarness()
        self.addCleanup(harness.close)
        harness.slack.fail_times = 99                      # 모든 게시가 ratelimited
        payload = load_fixture("webhook-diskusagehigh-firing.json")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            harness.post(payload)
        self.assertEqual(caught.exception.code, 502)
        self.assertEqual(harness.app.ledger.size(), 0, "실패한 배달이 원장에 남으면 재시도가 죽는다")

        harness.slack.fail_times = 0
        status, body = harness.post(payload)               # Grafana 재시도
        self.assertEqual(status, 200)
        self.assertEqual(body["posted"], 1, "재시도가 원장에 막혀 유실됐다")

    def test_resolved_reply_failure_is_retryable_too(self):
        """해결 답글도 게시 0건이면 502 — 발생 경로와 같은 규칙(유실보다 중복)."""
        harness = RelayHarness()
        self.addCleanup(harness.close)
        _, body = harness.post(load_fixture("webhook-diskusagehigh-firing.json"))
        ts = body["ts"]
        self.assertTrue(harness.drain())

        harness.slack.fail_times = 99
        with self.assertRaises(urllib.error.HTTPError) as caught:
            harness.post(load_fixture("webhook-diskusagehigh-resolved.json"))
        self.assertEqual(caught.exception.code, 502)

        harness.slack.fail_times = 0
        _, resolved = harness.post(load_fixture("webhook-diskusagehigh-resolved.json"))
        self.assertEqual(resolved["replies"], 1, "재시도가 막혀 해결 답글이 유실됐다")
        self.assertEqual(resolved["ts"], ts)


class TestDeliveryLedger(unittest.TestCase):
    """멱등 원장 단위 — 재시도(수십 초)는 삼키고 재통지(수 시간)는 통과시킨다."""

    def test_same_payload_yields_same_key(self):
        firing = load_fixture("webhook-diskusagehigh-firing.json")
        other = load_fixture("webhook-diskusagehigh-firing.json")
        other["truncatedAlerts"] = 7        # 부수 필드가 달라도 같은 배달이다
        self.assertEqual(ar.delivery_key(firing), ar.delivery_key(other))
        self.assertNotEqual(
            ar.delivery_key(firing),
            ar.delivery_key(load_fixture("webhook-diskusagehigh-resolved.json")),
            "발생과 해결은 다른 배달이다",
        )
        self.assertNotEqual(
            ar.delivery_key(firing),
            ar.delivery_key(load_fixture("webhook-gputemphigh-firing.json")),
        )

    def test_window_expiry_lets_repeat_notification_through(self):
        clock = {"t": 1000.0}
        ledger = ar.DeliveryLedger(window_sec=300, clock=lambda: clock["t"])
        self.assertEqual(ledger.begin("k")[0], "new")
        ledger.finish("k", {"posted": 1, "ts": "1.0"})
        self.assertEqual(ledger.begin("k")[0], "duplicate", "재시도는 삼킨다")
        clock["t"] += 301
        self.assertEqual(ledger.begin("k")[0], "new", "재통지는 통과시킨다")

    def test_abandon_restores_retryability(self):
        ledger = ar.DeliveryLedger(window_sec=300)
        ledger.begin("k")
        ledger.abandon("k")
        self.assertEqual(ledger.begin("k")[0], "new")

    def test_zero_window_disables(self):
        ledger = ar.DeliveryLedger(window_sec=0)
        ledger.begin("k")
        ledger.finish("k", {"posted": 1})
        self.assertEqual(ledger.begin("k")[0], "new")

    def test_capacity_is_bounded(self):
        ledger = ar.DeliveryLedger(window_sec=300, capacity=8)
        for i in range(50):
            ledger.begin("k%d" % i)
        self.assertLessEqual(ledger.size(), 9)


# ══════════════════════════════════════════════════════════════════════════════
# [재현] 결함 2 — relay redaction 이 E4보다 약했다 (같은 위협, 다른 방어)
#
# 실증(2026-08-04, 수정 전) — 아래 4종이 **그대로 통과**했다:
#   ① URL stash 우회 : http://attacker.invalid/exfil?p=/home/user2/patient-data/x.csv
#   ② `~/` 미처리    : ~/patient-data/2026/x.csv
#   ③ 허용목록 밖 절대경로 : /var/log/private/… · /scratch/… · /nfs/home/…
#   ④ 하드 거부 부재 : 놓치면 조용히 나갔다(E4는 예외로 멈춘다)
# 도달 가능성은 이론이 아니다 — render_assistant_reply 가 LLM 원출력을 본문에 그대로 넣고,
# 그 프롬프트 근거에는 전체 경로가 들어간다.
# ══════════════════════════════════════════════════════════════════════════════


class TestRedactionParityWithE4(unittest.TestCase):
    def test_defense_is_shared_not_copied(self):
        """복제 금지 — relay와 E4가 **같은 객체**를 본다. 아니면 한쪽만 고쳐진다."""
        sys.path.insert(0, os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            "scripts", "collectors"))
        import attribution_export as export      # noqa: E402 — 경로 주입 후

        self.assertIs(export.HARD_DENY, ar.keiwi_redaction.HARD_DENY)
        self.assertIs(export.redact_text, ar.keiwi_redaction.redact_text)
        self.assertIs(export.assert_no_leak, ar.keiwi_redaction.assert_no_leak)
        # relay 안에 경로/명령 정규식 사본이 다시 생기지 않았는지(게이트 P6의 유닛 짝).
        source = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "alert_relay.py"), encoding="utf-8").read()
        self.assertNotIn("HARD_DENY = (", source, "relay가 하드 규칙 사본을 들고 있다")

    def test_url_stash_bypass_is_closed(self):
        """① 허용 호스트가 아닌 URL은 통째로 사라진다 — URL이 우회로가 되지 않는다."""
        out = ar.redact("http://attacker.invalid/exfil?p=/home/user2/patient-data/x.csv")
        self.assertNotIn("attacker.invalid", out)
        self.assertNotIn("/home/user2", out)
        self.assertNotIn("patient-data", out)

    def test_command_inside_allowed_looking_url_is_closed(self):
        out = ar.redact("https://evil.test/?q=COMMAND=/usr/bin/pip%20install")
        self.assertNotIn("COMMAND=", out)
        self.assertNotIn("evil.test", out)

    def test_tilde_home_path_is_redacted(self):
        """② LLM이 홈 경로를 `~/` 로 줄여 쓰는 것은 매우 흔하다."""
        out = ar.redact("~/patient-data/2026/x.csv 를 지웠다")
        self.assertNotIn("patient-data", out)
        self.assertIn("[경로 삭제]", out)

    def test_absolute_paths_outside_old_allowlist_are_redacted(self):
        """③ home|root|data|… 만 보던 허용목록이 사라졌다 — 2단계 이상이면 전부 지운다."""
        for probe in ("/var/log/private/user2/session.log",
                      "/scratch/user2/tmp/hugefile.bin",
                      "/nfs/home/user2/secret/x",
                      "/srv/그룹/문서/자료.csv"):
            out = ar.redact("증거: %s 참고" % probe)
            self.assertIn("[경로 삭제]", out, probe)
            self.assertNotIn(probe, out)

    def test_mount_level_paths_still_survive(self):
        """반출 상한 **안**은 계속 나가야 한다 — 마운트를 못 말하면 답글이 쓸모없다."""
        self.assertIn("/home", ar.redact("/home 303G"))
        self.assertIn("/data", ar.redact("/data 마운트"))
        self.assertIn("data04 /", ar.redact("data04 / 사용률 95.2%"))

    def test_allowed_deeplinks_survive(self):
        """딥링크가 살아 있어야 보강이 의미가 있다(허용목록 회귀 방지)."""
        text = "상세 → <http://192.168.1.105:3106/incidents?alert=DiskUsageHigh&mount=/&from=now-6h|콘솔>"
        self.assertEqual(ar.redact(text), text)
        drill = "http://192.168.1.105:3000/d/keiwi-system-v3?var-instance=192.168.1.104:9100"
        self.assertIn(drill, ar.redact(drill))

    def test_allowed_host_with_wrong_port_is_dropped(self):
        """허용은 **호스트:포트** 단위다 — 같은 IP의 다른 포트가 덤으로 열리지 않는다."""
        self.assertNotIn("9200", ar.redact("http://192.168.1.105:9200/keiwi-logs-*/_search"))

    def test_build_slack_payload_blocks_on_hard_deny(self):
        """④ 하드 거부 — 세탁을 뚫고 남으면 **게시하지 않는다**(조용한 통과 없음)."""
        with self.assertRaises(ar.keiwi_redaction.RedactionError):
            ar.build_slack_payload("#c", "잔여 /root/ 경로")

    def test_first_delivery_falls_back_instead_of_losing_the_alert(self):
        """단, **1차 전달**은 삼키지 않는다 — 본문을 대체하고 알림은 보낸다."""
        payload = ar.build_slack_payload("#c", "잔여 /root/ 경로", allow_fallback=True)
        self.assertEqual(payload["text"], ar.LEAK_FALLBACK_TEXT)
        self.assertNotIn("/root/", payload["text"])


class TestAssistantReplyRedaction(unittest.TestCase):
    """LLM 원출력이 답글 본문에 그대로 들어가는 경로(render_assistant_reply)의 실증."""

    ROGUE = {
        "answer": (
            "user2 가 ~/patient-data 에서 /var/log/private/user2/session.log 를 만들고 "
            "COMMAND=/usr/bin/pip install tensorflow 를 돌린 것으로 보인다. "
            "http://attacker.invalid/x?p=/home/user2/patient-data [1]"
        ),
        "evidence": [{
            "id": "d1", "timestamp": "2026-08-03T08:45:12Z", "fleetNode": "data04",
            "service": "sudo", "level": "info",
            "message": "sudo: user2 : PWD=/home/user2 ; COMMAND=/usr/bin/pip install",
        }],
    }

    def test_rogue_llm_output_cannot_leak_through_the_reply(self):
        harness = RelayHarness(assistant=MockAssistant(answer=self.ROGUE))
        self.addCleanup(harness.close)
        harness.post(load_fixture("webhook-diskusagehigh-firing.json"))
        self.assertTrue(harness.drain())

        forms, replies = split_form_replies(harness.slack.replies())
        self.assertEqual(len(replies), 1, "답글이 통째로 사라지면 안 된다(세탁이지 차단이 아니다)")
        text = replies[0]["text"] + "".join(f["text"] for f in forms)
        for forbidden in ("patient-data", "/home/user2", "COMMAND=",
                          "attacker.invalid", "/var/log/private"):
            self.assertNotIn(forbidden, text, "누출: %r" % forbidden)
        self.assertTrue(re.search(r"\[\d+\]", text), "근거 번호는 살아 있어야 한다(AC-E3-7)")
        self.assertIn("192.168.1.105:3000", text, "허용 딥링크는 살아 있어야 한다")


if __name__ == "__main__":
    unittest.main(verbosity=2)

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T-E4-5 — 디스크 귀속 수집기 유닛/리플레이 테스트 (AC-E4-2·3·4).

stdlib unittest 만 쓴다(pip 0 — relay 와 같은 규약). 네트워크를 타지 않는다:
OpenSearch·vLLM 은 전부 끄거나 목으로 대체한다. 그래야 CI(외부망 없음)에서도 돈다.

실행:
    python3 scripts/collectors/test_attribution.py            # 사람용
    python3 -m unittest discover -s scripts/collectors -p 'test_*.py'
게이트에서는 check-attribution-redaction.sh 가 이 파일을 호출한다.
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import attribution_export as export      # noqa: E402
import attribution_lib as lib            # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "incident-2026-08-03-data04.raw")


def load_incident():
    with open(FIXTURE, encoding="utf-8") as fh:
        env = lib.parse_envelope(fh.read())
    return lib.build_report(env, want_snapshot=False, want_journal=False)


class TestCategorize(unittest.TestCase):
    """결정적 카테고리화 — LLM 이전 단계(§4.2 D4-2-1)."""

    def test_pyenv(self):
        for p in ("/home/user6/venv3/lib/python3.10/site-packages/tensorflow/libtensorflow_cc.so.2",
                  "/home/x/.venv/lib/python3.11/site-packages/torch/lib/libtorch.so",
                  "/opt/miniconda3/pkgs/blah.so"):
            self.assertEqual(lib.categorize(p), lib.CAT_PYENV, p)

    def test_weights(self):
        for p in ("/data/models/foo.safetensors", "/home/x/a.ckpt", "/home/x/b.pt",
                  "/home/user2/.ollama/models/blobs/sha256-abc"):
            self.assertEqual(lib.categorize(p), lib.CAT_MODEL, p)

    def test_data(self):
        for p in ("/home/x/data/a.csv", "/srv/dump.tar.gz", "/home/x/y.parquet"):
            self.assertEqual(lib.categorize(p), lib.CAT_DATA, p)

    def test_other(self):
        self.assertEqual(lib.categorize("/var/log/huge.log"), lib.CAT_OTHER)

    def test_env_root_groups_two_venvs_separately(self):
        a = lib.group_key("/home/user6/venv2/lib/python3.10/site-packages/tensorflow/x.so")
        b = lib.group_key("/home/user6/venv3/lib/python3.10/site-packages/tensorflow/x.so")
        self.assertNotEqual(a, b)
        self.assertTrue(a.endswith("venv2"))


class TestIncidentReplay(unittest.TestCase):
    """AC-E4-2 — 2026-08-03 사건 리플레이. 수동 30분 추적과 같은 결론이 나와야 한다.

    사람이 얻은 결론: **user6 · 17:45~17:48 · tensorflow venv 2개(각 1.1G)**
    """

    @classmethod
    def setUpClass(cls):
        cls.report = load_incident()

    def test_schema_valid(self):
        self.assertEqual(lib.validate(self.report), [])

    def test_owner_and_category_of_top_files(self):
        top = self.report["recent_files"][:2]
        self.assertEqual([f["owner"] for f in top], ["user6", "user6"])
        self.assertEqual([f["category"] for f in top], [lib.CAT_PYENV, lib.CAT_PYENV])

    def test_two_files_of_about_1_1_gib_at_1745_and_1748(self):
        """'각 1.1G' 와 '17:45~17:48' 이 그대로 재현되는가."""
        top = self.report["recent_files"][:2]
        for f in top:
            self.assertAlmostEqual(f["bytes"] / (1024 ** 3), 1.1, places=1)
        # mtime 은 RFC3339(노드 오프셋 포함) — data04 는 KST 다.
        stamps = sorted(f["mtime"] for f in top)
        self.assertEqual([s[11:16] for s in stamps], ["17:45", "17:48"])
        self.assertTrue(all(s.endswith("+09:00") for s in stamps), stamps)

    def test_two_distinct_python_environments(self):
        """서로 다른 venv 2개(venv2·venv3)로 갈라지는가 — 개수만 반출된다."""
        roots = {lib.group_key(f["raw"]["path"]) for f in self.report["recent_files"][:2]}
        self.assertEqual(len(roots), 2)

    def test_python_env_group_is_the_largest_signal(self):
        g = self.report["recent_groups"][0]
        self.assertEqual(g["owner"], "user6")
        self.assertEqual(g["category"], lib.CAT_PYENV)

    def test_home_breakdown_matches_manual_trace(self):
        owners = {d["owner"]: d["bytes"] for d in self.report["top_dirs"]
                  if d["path_category"] == lib.CAT_HOME}
        for who in ("user2", "user5", "user6"):
            self.assertIn(who, owners)
        self.assertGreater(owners["user2"], owners["user5"])
        self.assertGreater(owners["user5"], owners["user6"])

    def test_limits_declare_the_non_sudo_blind_spot(self):
        joined = " ".join(self.report["limits"])
        self.assertIn("비sudo", joined)


class TestRedaction(unittest.TestCase):
    """AC-E4-3 — 원문 경로·COMMAND 가 포함된 입력을 Slack 빌더에 통과시킨다."""

    @classmethod
    def setUpClass(cls):
        cls.report = load_incident()
        # 실제 사건 원문 그대로: sudo 로그 라인을 로컬 리포트에 주입한다.
        cls.report["sudo_commands"] = [{
            "ts": "2026-08-03T08:45:00Z", "user": "user6",
            "cwd_category": "사용자 홈",
            "raw": "  user6 : PWD=/home/user6 ; USER=root ; "
                   "COMMAND=/usr/bin/pip install tensorflow -t /home/user6/venv3",
        }]

    def test_local_report_really_contains_the_secrets(self):
        """역증명 — 입력에 원문이 실제로 들어 있어야 검사가 의미를 갖는다."""
        blob = repr(self.report)
        self.assertIn("COMMAND=", blob)
        self.assertIn("/home/user6/venv3", blob)

    def test_public_view_strips_raw_recursively(self):
        pub = lib.public_view(self.report)
        blob = repr(pub)
        self.assertNotIn("raw", blob)
        self.assertNotIn("COMMAND=", blob)
        self.assertNotIn("/home/user6/venv3", blob)

    def test_slack_payload_has_no_paths_or_commands(self):
        text = export.build_slack_text(lib.public_view(self.report))
        for pattern, label in export.HARD_DENY:
            self.assertIsNone(pattern.search(text), "%s 누출: %r" % (label, text))
        self.assertIn("user6", text)          # 계정명은 반출 상한 안이다

    def test_llm_output_is_redacted_too(self):
        """이중 게이트 — 모델이 지시를 어기고 경로·명령을 인용해도 지운다."""
        rogue = ("user6이 /home/user6/venv3 에 "
                 "COMMAND=/usr/bin/pip install tensorflow 를 실행한 것으로 보인다")
        text = export.build_slack_text(lib.public_view(self.report), intent_summary=rogue)
        self.assertNotIn("/home/user6", text)
        self.assertNotIn("COMMAND=", text)
        self.assertIn("[경로 삭제]", text)

    def test_assert_no_leak_actually_raises(self):
        with self.assertRaises(export.RedactionError):
            export.assert_no_leak("파일 /home/user6/venv3/x.so 가 늘었다")
        with self.assertRaises(export.RedactionError):
            export.assert_no_leak("COMMAND=/usr/bin/pip install")

    def test_redact_keeps_allowed_urls_and_kills_others(self):
        keep = "링크 http://192.168.1.105:3106/incidents?alert=DiskUsageHigh&node=data04 참고"
        self.assertIn("192.168.1.105:3106", export.redact_text(keep))
        drop = "링크 https://evil.example.com/home/x/y 참고"
        self.assertNotIn("evil.example.com", export.redact_text(drop))

    def test_redact_keeps_mount_level_paths(self):
        """`/`·`/home` 은 남아야 한다 — 마운트를 말 못 하면 답글이 쓸모없다."""
        self.assertIn("/home", export.redact_text("/home 이 303G 로 늘었다"))
        self.assertIn("/data", export.redact_text("/data 마운트"))

    def test_hedge_is_enforced(self):
        self.assertIn("추정", lib._enforce_hedge("user6이 텐서플로를 설치했다"))
        self.assertNotIn("추정 — 단정 아님",
                         lib._enforce_hedge("설치한 것으로 보인다"))


class TestLlmFailureIsolation(unittest.TestCase):
    """AC-E4-4 — vLLM 실패 시 답글 #1(결정적)만으로 성립한다."""

    def test_summarize_returns_none_on_unreachable_vllm(self):
        # 닫힌 포트. 어떤 예외든 None 이어야 한다(조용히 생략).
        self.assertIsNone(lib.summarize_intent(load_incident(),
                                               url="http://127.0.0.1:1", timeout=1.0))

    def test_deterministic_reply_stands_alone(self):
        text = export.build_slack_text(lib.public_view(load_incident()), intent_summary=None)
        self.assertIn("디스크 귀속", text)
        self.assertIn("user6", text)
        self.assertIn(lib.CAT_PYENV, text)
        self.assertNotIn("추정:", text)          # LLM 줄만 빠진다


class TestPartialFallback(unittest.TestCase):
    """AC-E4-5 — sudo 없는 노드(data05)에서 죽지 않고 partial 을 명시한다."""

    def test_force_no_sudo_marks_partial(self):
        with open(FIXTURE, encoding="utf-8") as fh:
            env = lib.parse_envelope(fh.read())
        r = lib.build_report(env, force_no_sudo=True, want_snapshot=False, want_journal=False)
        self.assertTrue(r["partial"])
        self.assertTrue(any("sudo" in x for x in r["partial_reasons"]))
        text = export.build_slack_text(lib.public_view(r))
        self.assertIn("부분 수집", text)

    def test_empty_envelope_does_not_crash(self):
        env = lib.parse_envelope("#META node=data05 mount=/ minutes=360\n#SECTION end\n")
        r = lib.build_report(env, want_snapshot=False, want_journal=False)
        self.assertTrue(r["partial"])
        self.assertEqual(lib.validate(r), [])
        self.assertIn("디스크 귀속", export.build_slack_text(lib.public_view(r)))


class TestSnapshotDiff(unittest.TestCase):
    """스냅샷 → 베이스라인 diff(§4.2 D4-1). 쓰기는 스냅샷 디렉터리 안으로만."""

    def test_second_run_produces_delta(self):
        import shutil
        import tempfile
        tmp = tempfile.mkdtemp(prefix="keiwi-attr-test-")
        try:
            with open(FIXTURE, encoding="utf-8") as fh:
                raw = fh.read()
            env = lib.parse_envelope(raw)
            r1 = lib.build_report(env, snapshot_root=tmp, want_journal=False)
            self.assertFalse(r1["baseline"]["available"])
            # 두 번째 실행: 같은 봉투를 다른 타임스탬프로 → delta 0 이 잡혀야 한다.
            env2 = lib.parse_envelope(raw.replace("#SECTION collected\n", "#SECTION collected\n"))
            env2["sections"]["collected"] = ["2026-08-03T21:00:00+09:00"]
            r2 = lib.build_report(env2, snapshot_root=tmp, want_journal=False)
            self.assertTrue(r2["baseline"]["available"])
            self.assertTrue(any("delta_bytes" in d for d in r2["top_dirs"]))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)

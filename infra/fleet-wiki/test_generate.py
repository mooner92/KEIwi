"""generate 순수 함수 테스트 — AC-W-3(멱등·구획 보존)·AC-W-4(lint)·슬러그 충돌 회귀."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate  # noqa: E402


def snap(projects=None, listeners=None):
    return {
        "schema": 1, "node": "test01", "collected_at": "2026-08-13T00:00:00Z",
        "partial": False, "unresolved_listeners": 0,
        "listeners": listeners or [], "projects": projects or [],
    }


def proj(cwd, name, owner="user1", ports=(8000,)):
    return {
        "cwd": cwd, "name": name, "owners": [owner], "ports": list(ports),
        "unit": None, "git_remote": None, "git_head": None,
        "git_head_ref_mtime": None, "readme": None, "docs": [], "last_activity": None,
    }


class TestSlugCollision(unittest.TestCase):
    def test_same_owner_name_gets_distinct_slugs(self):
        """실측 회귀 — 프로덕션/워크트리가 같은 name=console로 서로를 덮어쓰던 버그."""
        m = generate.project_slug_map("test01", [proj("/a/console", "console"), proj("/b/console", "console")])
        self.assertEqual(len(set(m.values())), 2, "충돌이 해시로 구분되어야 한다: %s" % m)

    def test_no_collision_keeps_clean_slug(self):
        m = generate.project_slug_map("test01", [proj("/a/x", "x")])
        self.assertEqual(list(m.values()), ["test01--user1--x"])


class TestBlocksPreserved(unittest.TestCase):
    def test_manual_and_llm_survive_regeneration(self):
        p = proj("/a/x", "x")
        _s, first = generate.render_project("test01", p, "test01--user1--x")
        edited = first.replace(
            "<!-- llm-summary:start -->\n" + generate.LLM_DEFAULT.rstrip("\n"),
            "<!-- llm-summary:start -->\nLLM이 쓴 요약",
        ).replace("<!-- manual:start -->\n", "<!-- manual:start -->\n사람 메모\n")
        _s, second = generate.render_project("test01", p, "test01--user1--x", prev_text=edited)
        self.assertIn("LLM이 쓴 요약", second)
        self.assertIn("사람 메모", second)

    def test_render_is_deterministic(self):
        p = proj("/a/x", "x")
        a = generate.render_project("test01", p, "s")[1]
        b = generate.render_project("test01", p, "s")[1]
        self.assertEqual(a, b)


class TestLint(unittest.TestCase):
    def test_broken_link_detected(self):
        problems = generate.lint({"a": "본문 [[없는문서]] 링크", "b": "[[a]]"})
        self.assertEqual(len(problems), 1)
        self.assertIn("없는문서", problems[0])

    def test_clean_graph_passes(self):
        self.assertEqual(generate.lint({"a": "[[b]]", "b": "[[a]]"}), [])


class TestEndToEnd(unittest.TestCase):
    def test_idempotent_and_first_seen_sticky(self):
        with tempfile.TemporaryDirectory() as tmp:
            sfile = os.path.join(tmp, "s.json")
            s = snap(
                projects=[proj("/a/x", "x")],
                listeners=[{"proto": "tcp", "port": 22, "process": "sshd", "pid": 1,
                            "owner": "root", "cwd": "/", "cwd_reason": None}],
            )
            with open(sfile, "w") as f:
                json.dump(s, f)
            os.environ["KEIWI_WIKI_DIR"] = os.path.join(tmp, "wiki")
            self.assertEqual(generate.main(["generate.py", sfile]), 0)
            state1 = json.load(open(os.path.join(tmp, "wiki", ".state.json")))
            # 2회차: 다른 수집 시각 — first_seen은 처음 값을 유지해야 한다
            s["collected_at"] = "2026-08-14T00:00:00Z"
            with open(sfile, "w") as f:
                json.dump(s, f)
            self.assertEqual(generate.main(["generate.py", sfile]), 0)
            state2 = json.load(open(os.path.join(tmp, "wiki", ".state.json")))
            self.assertEqual(state1["test01/tcp/22"], state2["test01/tcp/22"])


if __name__ == "__main__":
    unittest.main()

"""scout 순수 함수 테스트 — spec AC-W-1(사유 보존)·AC-W-2(추측 금지) 경계를 고정한다."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scout  # noqa: E402


SS_SAMPLE = """\
Netid State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process
tcp   LISTEN 0      511          0.0.0.0:3105      0.0.0.0:*    users:(("next-server",pid=2519,fd=21))
tcp   LISTEN 0      511                *:8188            *:*    users:(("python",pid=3517051,fd=9))
udp   UNCONN 0      0            0.0.0.0:51820     0.0.0.0:*
tcp   LISTEN 0      128            [::1]:6010         [::]:*    users:(("sshd",pid=99,fd=10))
garbage line without fields
"""


class TestParseSs(unittest.TestCase):
    def test_parses_tcp_udp_and_extracts_pid(self):
        rows = scout.parse_ss_output(SS_SAMPLE)
        self.assertIn(("tcp", "3105", "next-server", "2519"), rows)
        self.assertIn(("tcp", "8188", "python", "3517051"), rows)
        self.assertIn(("tcp", "6010", "sshd", "99"), rows)  # IPv6 로컬 주소도 포트 추출

    def test_udp_without_process_kept_with_unknown(self):
        """프로세스를 못 본 소켓도 버리지 않는다 — '있는데 모름'을 기록(AC-W-1)."""
        rows = scout.parse_ss_output(SS_SAMPLE)
        self.assertIn(("udp", "51820", "unknown", None), rows)

    def test_header_and_garbage_skipped(self):
        rows = scout.parse_ss_output(SS_SAMPLE)
        self.assertEqual(len(rows), 4)


class TestParseGitConfig(unittest.TestCase):
    def test_origin_url(self):
        cfg = '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:org/repo.git\n'
        self.assertEqual(scout.parse_git_config(cfg), "git@github.com:org/repo.git")

    def test_first_remote_fallback_when_no_origin(self):
        cfg = '[remote "upstream"]\n\turl = https://example.com/a.git\n'
        self.assertEqual(scout.parse_git_config(cfg), "https://example.com/a.git")

    def test_no_remote_returns_none(self):
        """리모트가 없으면 None — 추측 금지(AC-W-2)."""
        self.assertIsNone(scout.parse_git_config("[core]\n\tbare = false\n"))


class TestRedactRemoteUrl(unittest.TestCase):
    """PoC 실측 회귀 — remote URL의 평문 토큰이 파이프라인에 실리면 안 된다."""

    def test_https_userinfo_with_token_is_stripped(self):
        self.assertEqual(
            scout.redact_remote_url("https://user:ghp_secret123@github.com/o/r.git"),
            "https://github.com/o/r.git",
        )

    def test_https_bare_user_is_stripped_too(self):
        self.assertEqual(
            scout.redact_remote_url("https://tokenonly@github.com/o/r.git"),
            "https://github.com/o/r.git",
        )

    def test_ssh_scp_form_kept(self):
        self.assertEqual(
            scout.redact_remote_url("git@github.com:o/r.git"), "git@github.com:o/r.git"
        )

    def test_none_passthrough(self):
        self.assertIsNone(scout.redact_remote_url(None))


class TestReadGit(unittest.TestCase):
    def _fake_repo(self, tmp):
        gd = os.path.join(tmp, ".git")
        os.makedirs(os.path.join(gd, "refs", "heads"))
        with open(os.path.join(gd, "config"), "w") as f:
            f.write('[remote "origin"]\n\turl = https://u:ghp_fake@example.com/p.git\n')
        with open(os.path.join(gd, "HEAD"), "w") as f:
            f.write("ref: refs/heads/main\n")
        with open(os.path.join(gd, "refs", "heads", "main"), "w") as f:
            f.write("abcdef0123456789abcdef0123456789abcdef01\n")

    def test_reads_remote_and_sha_from_files_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._fake_repo(tmp)
            remote, sha, mtime_iso = scout.read_git(tmp)
            self.assertEqual(remote, "https://example.com/p.git")
            self.assertEqual(sha, "abcdef012345")
            self.assertRegex(mtime_iso, r"^\d{4}-\d{2}-\d{2}T")

    def test_non_git_dir_is_explicit_nulls(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(scout.read_git(tmp), (None, None, None))


class TestSnapshotAndWrite(unittest.TestCase):
    def test_build_marks_partial_when_cwd_unresolved(self):
        """pid 미상 리스너가 있으면 partial=true — '전수'와 '부분'을 구분(AC-W-1)."""
        snap = scout.build_snapshot([("udp", "51820", "unknown", None)], "test-node")
        self.assertTrue(snap["partial"])
        self.assertEqual(snap["unresolved_listeners"], 1)
        self.assertEqual(snap["listeners"][0]["cwd_reason"], "pid 미상(ss -p 권한 없음)")

    def test_write_snapshot_is_atomic_and_idempotent_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "wiki", "scout.json")
            snap = scout.build_snapshot([], "test-node")
            scout.write_snapshot(snap, out)
            with open(out) as f:
                loaded = json.load(f)
            self.assertEqual(loaded["node"], "test-node")
            self.assertEqual(loaded["schema"], scout.SCHEMA_VERSION)
            self.assertFalse(os.path.exists(out + ".tmp"), "임시파일이 남으면 안 된다")


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""remediation_l2 유닛테스트 — L2 승인 후 실행 (spec §3 · AC-L2-1·2·3·4·5 · ADR-0026).

실행: ``cd infra/alert-relay && python3 -m unittest test_remediation_l2``
게이트: ``scripts/gates/check-remediation-l2.sh`` M1이 이 파일을 돌린다.

**실행 경로를 실제로 탄다.** L2의 위험은 전부 "실제로 프로세스를 띄우는 그 한 줄"에
있으므로, ``subprocess.run`` 을 모킹해서 검사하면 정작 검사해야 할 것을 안 보게 된다.
그래서 이 테스트는 **진짜로 명령을 실행한다** — 다만 명령이 ``echo``·``touch``·``sleep``·
``false`` 뿐이고, 대상 경로는 테스트가 만든 tempdir이다. 외부 통신 0 · 라이브 영향 0 ·
레포의 살아있는 런북에 의존 0(픽스처를 직접 쓴다).

무엇을 증명하는가:
  A  화이트리스트 밖 거부   tier≤1 · risk high · reversible/idempotent false ·
                            파괴 동사 · 명령 치환 · 본문 미근거 → 실행 0
  B  드리프트 감지          제안 이후 런북이 바뀌면 실행 거부(해시·조치 지문·명령)
  C  dry-run 무해           기본 경로는 **부작용 0** (마커 파일이 생기지 않는다)
  D  감사 원장              제안·승인자·승인시각·실행·rc·롤백이 append-only로 남는다
  E  승인 없이는 실행 0     승인 이벤트 없는 --apply 는 거부(AC-L2-1)
  F  승인 카드 5필드        하나라도 비면 카드 생성 실패 = 승인 불가(AC-L2-2)
  G  유출 필드 화이트리스트  slack_fields에 user/pid/cmdline/instance 없음(AC-L2-5)
  H  경계                   L1 모듈은 L2를 모른다 · 실행 지점은 한 곳뿐 ·
                            실행기는 명령 문자열을 인자로 받지 않는다
"""

import contextlib
import datetime
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import remediation_l1 as l1  # noqa: E402
import remediation_l2 as m  # noqa: E402
from test_remediation_l1 import MockVllm  # noqa: E402 — mock vLLM 하네스 재사용

HERE = os.path.dirname(os.path.abspath(__file__))
TODAY = datetime.date.today()
FRESH = TODAY.isoformat()          # 픽스처는 항상 신선하다(시간이 지나도 테스트가 안 썩는다)


# ══════════════════════════════════════════════════════════════════════════════
# 픽스처 런북 — tier·risk·명령을 바꿔 가며 정책 경계를 찌른다
# ══════════════════════════════════════════════════════════════════════════════

RUNBOOK = """---
id: fx-l2
kind: alert
alerts: [FxL2Alert]
category: infra
severity: warning
last_verified: %(fresh)s
tier: %(tier)d
actions:
  - id: fx-touch-marker
    title: 마커를 만든다(무해)
    risk: %(risk)s
    reversible: %(reversible)s
    idempotent: %(idempotent)s
    command: %(command)s
---

# 런북 · fx L2 픽스처

## 1. 복구

```bash
%(command)s
```
"""


def runbook_text(command, tier=3, risk="low", reversible="true", idempotent="true"):
    return RUNBOOK % {"fresh": FRESH, "tier": tier, "risk": risk,
                      "reversible": reversible, "idempotent": idempotent,
                      "command": command}


def reply(action_id, runbook_id="fx-l2", citations=(1,), confidence=0.9):
    return json.dumps({
        "category": "FxL2Alert", "runbook_id": runbook_id, "action_id": action_id,
        "confidence": confidence, "citations": list(citations),
    }, ensure_ascii=False)


class Base(unittest.TestCase):
    """픽스처 런북 1편 + 원장 1개를 tempdir에 두고, L1 제안을 원장에 등록해 준다."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="keiwi-l2-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.books = os.path.join(self.tmp, "runbooks")
        os.makedirs(self.books)
        self.marker = os.path.join(self.tmp, "marker")
        self.ledger = m.Ledger(os.path.join(self.tmp, "ledger.jsonl"))

    # ── 픽스처 조작 ─────────────────────────────────────────────────────────
    def write_runbook(self, command=None, **kw):
        command = command or ("touch %s" % self.marker)
        path = os.path.join(self.books, "fx-l2.md")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(runbook_text(command, **kw))
        return path

    def propose(self, action_id="fx-touch-marker", node="data03"):
        """진짜 L1 파이프라인(mock vLLM)을 태워 제안을 만들고 원장에 등록한다."""
        corpus = l1.load_corpus(self.books)
        runbook = corpus.get("fx-l2")
        cites = [e["n"] for e in l1.build_evidence(runbook)][:2]
        with MockVllm([reply(action_id, citations=cites)]) as mock:
            result = l1.propose({"alertname": "FxL2Alert", "node": node},
                                corpus=corpus, llm=mock.client())
        self.assertEqual(result["status"], l1.STATUS_PROPOSAL, result)
        return m.register_proposal(result, signal={"alertname": "FxL2Alert",
                                                   "node": node, "severity": "warning"},
                                   ledger=self.ledger, runbooks_root=self.books)

    def approve_and_apply(self, proposal_id, **kw):
        decision = m.approve(proposal_id, ledger=self.ledger, approver="user1")
        self.assertTrue(decision["ok"], decision)
        return m.execute_approved(proposal_id, ledger=self.ledger, apply=True,
                                  runbooks_root=self.books, **kw)


# ══════════════════════════════════════════════════════════════════════════════
# A. 화이트리스트 밖은 실행되지 않는다
# ══════════════════════════════════════════════════════════════════════════════


class TestPolicyRefusal(Base):
    def _refusal_for(self, **kw):
        self.write_runbook(**kw)
        proposal = self.propose()
        return proposal, m.execute_approved(
            proposal["proposal_id"], ledger=self.ledger, apply=True,
            runbooks_root=self.books)

    def test_tier_one_runbook_is_never_executed(self):
        """tier 1 = 제안까지. L2가 손대면 사다리 의미론이 무너진다."""
        proposal, result = self._refusal_for(tier=1)
        self.assertFalse(proposal["eligible"])
        self.assertEqual(proposal["refusal"], "tier_below_l2")
        self.assertEqual(result["reason"], "tier_below_l2")
        self.assertFalse(os.path.exists(self.marker))

    def test_high_risk_is_refused_even_at_tier_two(self):
        # risk:high는 게이트 A5가 tier≤1로 강제하지만, L2는 tier와 라벨을 **둘 다** 본다.
        self.write_runbook(tier=2, risk="high")
        proposal = self.propose()
        self.assertFalse(proposal["eligible"])
        self.assertEqual(proposal["refusal"], "risk_blocked")

    def test_irreversible_action_is_refused(self):
        self.write_runbook(tier=2, reversible="false")
        self.assertEqual(self.propose()["refusal"], "not_reversible")

    def test_non_idempotent_action_is_refused(self):
        self.write_runbook(tier=2, idempotent="false")
        self.assertEqual(self.propose()["refusal"], "not_idempotent")

    def test_destructive_verb_is_refused_regardless_of_label(self):
        """`risk: low` 라고 적혀 있어도 파괴 동사면 거부한다 — 라벨을 믿지 않는다."""
        self.write_runbook(command="rm -rf %s" % self.marker, tier=3, risk="low")
        proposal = self.propose()
        self.assertEqual(proposal["refusal"], "destructive_command")

    def test_command_substitution_is_refused(self):
        self.write_runbook(command="touch %s.$(id -u)" % self.marker)
        self.assertEqual(self.propose()["refusal"], "unsafe_command")

    def test_backtick_is_refused(self):
        self.write_runbook(command="touch %s.`id -u`" % self.marker)
        self.assertEqual(self.propose()["refusal"], "unsafe_command")

    def test_command_not_grounded_in_body_is_refused(self):
        """frontmatter에만 있고 본문 코드블록에 없는 명령 — A7을 실행 시점에 다시 본다."""
        path = self.write_runbook()
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        head, _, _ = text.partition("```bash")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(head + "\n(코드블록이 사라졌다)\n")
        self.assertEqual(self.propose()["refusal"], "ungrounded_command")

    def test_stale_runbook_is_refused(self):
        path = self.write_runbook(tier=3)
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        old = (TODAY - datetime.timedelta(days=l1.STALE_DAYS + 30)).isoformat()
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text.replace("last_verified: %s" % FRESH, "last_verified: %s" % old))
        proposal = self.propose()
        self.assertEqual(proposal["refusal"], "stale_runbook")
        self.assertFalse(proposal["eligible"])

    def test_refused_proposal_is_still_recorded(self):
        """부적격도 원장에 남는다 — 남지 않으면 '거부됐다'는 사실을 감사할 수 없다."""
        self._refusal_for(tier=1)
        kinds = [e["event"] for e in self.ledger.events()]
        self.assertIn("proposal", kinds)
        self.assertIn("execution", kinds)
        refusals = [e for e in self.ledger.events()
                    if e["event"] == "execution" and e["outcome"] == "refused"]
        self.assertTrue(refusals)
        self.assertEqual(refusals[0]["refusal"], "tier_below_l2")


# ══════════════════════════════════════════════════════════════════════════════
# B. 드리프트 — 제안 시점과 실행 시점 사이에 문서가 바뀌면 실행하지 않는다
# ══════════════════════════════════════════════════════════════════════════════


class TestDrift(Base):
    def test_body_edit_between_proposal_and_apply_blocks_execution(self):
        self.write_runbook()
        proposal = self.propose()
        with open(os.path.join(self.books, "fx-l2.md"), "a", encoding="utf-8") as fh:
            fh.write("\n> 누군가 본문에 한 줄 덧붙였다.\n")
        result = self.approve_and_apply(proposal["proposal_id"])
        self.assertEqual(result["reason"], "runbook_drift")
        self.assertFalse(os.path.exists(self.marker))

    def test_command_swap_between_proposal_and_apply_blocks_execution(self):
        """가장 위험한 형태 — 제안 때 본 명령과 다른 명령이 실행되는 것."""
        self.write_runbook()
        proposal = self.propose()
        self.write_runbook(command="touch %s.swapped" % self.marker)
        result = self.approve_and_apply(proposal["proposal_id"])
        self.assertIn(result["reason"], ("runbook_drift", "action_drift", "command_drift"))
        self.assertFalse(os.path.exists(self.marker + ".swapped"))

    def test_deleted_runbook_blocks_execution(self):
        self.write_runbook()
        proposal = self.propose()
        os.remove(os.path.join(self.books, "fx-l2.md"))
        result = self.approve_and_apply(proposal["proposal_id"])
        self.assertEqual(result["reason"], "runbook_missing")

    def test_digest_notices_a_label_flip_without_body_change(self):
        """본문은 그대로인데 risk 라벨만 바뀐 경우도 조치 지문이 잡는다."""
        self.write_runbook(tier=3, risk="low")
        raw = m.raw_action(l1.load_corpus(self.books).get("fx-l2"), "fx-touch-marker")
        before = m.action_digest(raw)
        self.write_runbook(tier=3, risk="medium")
        raw2 = m.raw_action(l1.load_corpus(self.books).get("fx-l2"), "fx-touch-marker")
        self.assertNotEqual(before, m.action_digest(raw2))


# ══════════════════════════════════════════════════════════════════════════════
# C. dry-run 이 기본이고, dry-run 은 **아무것도 실행하지 않는다**
# ══════════════════════════════════════════════════════════════════════════════


class TestDryRun(Base):
    def test_dry_run_leaves_no_side_effect(self):
        self.write_runbook()
        proposal = self.propose()
        result = m.execute_approved(proposal["proposal_id"], ledger=self.ledger,
                                    runbooks_root=self.books)      # apply 미지정 = dry-run
        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], m.MODE_DRYRUN)
        self.assertEqual(result["would_run"], ["touch %s" % self.marker])
        self.assertFalse(os.path.exists(self.marker),
                         "dry-run이 실제로 파일을 만들었다 — 기본 경로가 안전하지 않다")

    def test_apply_actually_executes_the_command(self):
        """반증 — 같은 제안이 --apply 에서는 진짜로 돈다(그래야 위 테스트가 의미를 가진다)."""
        self.write_runbook()
        proposal = self.propose()
        result = self.approve_and_apply(proposal["proposal_id"])
        self.assertTrue(result["ok"], result)
        self.assertTrue(os.path.exists(self.marker))
        self.assertEqual(result["results"][0]["rc"], 0)

    def test_dry_run_is_recorded_so_rubber_stamping_is_visible(self):
        self.write_runbook()
        proposal = self.propose()
        m.execute_approved(proposal["proposal_id"], ledger=self.ledger,
                           runbooks_root=self.books)
        state = self.ledger.state(proposal["proposal_id"])
        self.assertEqual(state["dry_runs"], 1)
        self.assertIsNone(state["applied"])

    def cli(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = m.main(["--ledger", self.ledger.path, "--runbooks", self.books]
                          + list(argv))
        return code, buf.getvalue()

    def test_cli_default_is_dry_run(self):
        """CLI 계약: ``approve <id>`` 만으로는 실행되지 않는다."""
        self.write_runbook()
        proposal = self.propose()
        code, out = self.cli("approve", proposal["proposal_id"])
        self.assertEqual(code, 0)
        self.assertIn("DRY-RUN", out)
        self.assertFalse(os.path.exists(self.marker))

    def test_cli_apply_flag_executes(self):
        self.write_runbook()
        proposal = self.propose()
        code, _ = self.cli("approve", proposal["proposal_id"], "--apply")
        self.assertEqual(code, 0)
        self.assertTrue(os.path.exists(self.marker))


# ══════════════════════════════════════════════════════════════════════════════
# D. 승인 없이는 실행 0 (AC-L2-1)
# ══════════════════════════════════════════════════════════════════════════════


class TestApprovalGate(Base):
    def test_apply_without_approval_is_refused(self):
        self.write_runbook()
        proposal = self.propose()
        result = m.execute_approved(proposal["proposal_id"], ledger=self.ledger,
                                    apply=True, runbooks_root=self.books)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "not_approved")
        self.assertFalse(os.path.exists(self.marker))

    def test_rejected_proposal_cannot_be_approved_later(self):
        self.write_runbook()
        proposal = self.propose()
        m.reject(proposal["proposal_id"], ledger=self.ledger, approver="user1",
                 reason="지금 말고")
        decision = m.approve(proposal["proposal_id"], ledger=self.ledger, approver="user1")
        self.assertFalse(decision["ok"])
        self.assertEqual(decision["reason"], "rejected")

    def test_unknown_proposal_id_executes_nothing(self):
        result = m.execute_approved("p-19700101-deadbeef", ledger=self.ledger,
                                    apply=True, runbooks_root=self.books)
        self.assertEqual(result["reason"], "unknown_proposal")

    def test_second_apply_is_refused_idempotently(self):
        self.write_runbook()
        proposal = self.propose()
        self.approve_and_apply(proposal["proposal_id"])
        again = m.execute_approved(proposal["proposal_id"], ledger=self.ledger,
                                   apply=True, runbooks_root=self.books)
        self.assertEqual(again["reason"], "already_executed")

    def test_expired_proposal_is_refused(self):
        self.write_runbook()
        proposal = self.propose()
        later = m._utcnow() + datetime.timedelta(seconds=m.PROPOSAL_TTL_SEC + 60)
        decision = m.approve(proposal["proposal_id"], ledger=self.ledger,
                             approver="user1", when=later)
        self.assertEqual(decision["reason"], "expired")

    def test_ineligible_proposal_cannot_be_approved(self):
        self.write_runbook(tier=1)
        proposal = self.propose()
        decision = m.approve(proposal["proposal_id"], ledger=self.ledger, approver="user1")
        self.assertFalse(decision["ok"])
        self.assertEqual(decision["reason"], "tier_below_l2")


# ══════════════════════════════════════════════════════════════════════════════
# E. 감사 원장 (AC-L2-4)
# ══════════════════════════════════════════════════════════════════════════════


class TestLedger(Base):
    def test_full_lifecycle_is_recorded(self):
        self.write_runbook()
        proposal = self.propose()
        pid = proposal["proposal_id"]
        m.execute_approved(pid, ledger=self.ledger, runbooks_root=self.books)   # dry-run
        self.approve_and_apply(pid)

        events = self.ledger.for_proposal(pid)
        kinds = [e["event"] for e in events]
        self.assertEqual(kinds.count("proposal"), 1)
        self.assertEqual(kinds.count("approval"), 1)
        self.assertEqual(kinds.count("execution"), 2)

        # event 종류로 고른다 — mode만 보면 실행 **직전**에 남는 execution_intent
        # (fail-closed 기록)가 먼저 걸린다. 감사 완결성을 보는 대상은 결과 기록이다.
        self.assertEqual(kinds.count("execution_intent"), 1,
                         "실행 전 의도 기록이 없다 — 무기록 실행 방어가 빠졌다")
        run = [e for e in events
               if e["event"] == "execution" and e.get("mode") == m.MODE_APPLY][0]
        for field in ("proposal_id", "approver", "approved_by", "approved_at",
                      "runbook_id", "action_id", "runbook_sha256", "results",
                      "rollback", "outcome"):
            self.assertIn(field, run, "감사 필드 누락: %s" % field)
        self.assertEqual(run["approved_by"], "user1")
        self.assertEqual(run["results"][0]["rc"], 0)

    def test_ledger_is_append_only_on_disk(self):
        self.ledger.append({"event": "probe", "proposal_id": "p-x", "n": 1})
        with open(self.ledger.path, encoding="utf-8") as fh:
            first = fh.read()
        self.ledger.append({"event": "probe", "proposal_id": "p-x", "n": 2})
        with open(self.ledger.path, encoding="utf-8") as fh:
            second = fh.read()
        self.assertTrue(second.startswith(first), "기존 줄이 덮였다 — append-only가 아니다")
        self.assertEqual(len(second.strip().split("\n")), 2)

    def test_ledger_has_no_mutation_api(self):
        for name in ("delete", "remove", "update", "truncate", "rewrite", "clear"):
            self.assertFalse(hasattr(m.Ledger, name),
                             "원장에 수정 수단 %r 이 생겼다" % name)

    def test_corrupt_line_is_surfaced_not_swallowed(self):
        self.ledger.append({"event": "probe", "proposal_id": "p-x"})
        with open(self.ledger.path, "a", encoding="utf-8") as fh:
            fh.write("{쓰레기\n")
        events = self.ledger.events()
        self.assertEqual(events[-1]["event"], "corrupt")

    def test_ledger_file_is_owner_only(self):
        self.ledger.append({"event": "probe"})
        mode = os.stat(self.ledger.path).st_mode & 0o777
        self.assertEqual(mode, 0o600, "원장에 명령 전문이 들어간다 — 0600이어야 한다")

    def test_every_line_is_valid_json(self):
        self.write_runbook()
        proposal = self.propose()
        self.approve_and_apply(proposal["proposal_id"])
        with open(self.ledger.path, encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    json.loads(line)


# ══════════════════════════════════════════════════════════════════════════════
# F. 승인 카드 5필드 (AC-L2-2)
# ══════════════════════════════════════════════════════════════════════════════


class TestApprovalCard(Base):
    def base_proposal(self):
        self.write_runbook()
        return self.propose()

    def test_card_has_all_five_fields(self):
        card = m.build_card(self.base_proposal())
        self.assertEqual(sorted(card), sorted(m.CARD_FIELDS))
        for key, value in card.items():
            self.assertTrue(str(value).strip(), "빈 필드: %s" % key)

    def test_card_without_citations_is_refused(self):
        proposal = dict(self.base_proposal(), citations=[])
        with self.assertRaises(m.CardError):
            m.build_card(proposal)

    def test_card_without_a_target_is_refused(self):
        proposal = dict(self.base_proposal(), node=None, service=None)
        with self.assertRaises(m.CardError):
            m.build_card(proposal)

    def test_card_without_commands_is_refused(self):
        proposal = dict(self.base_proposal(), commands=[])
        with self.assertRaises(m.CardError):
            m.build_card(proposal)

    def test_rendered_card_shows_the_exact_command(self):
        proposal = self.base_proposal()
        text = m.render_approval_card(proposal)
        self.assertIn("touch %s" % self.marker, text)
        self.assertIn("--apply", text)

    def test_undeclared_rollback_is_admitted_not_hidden(self):
        proposal = self.base_proposal()
        self.assertFalse(proposal["rollback_declared"])
        self.assertIn("롤백 명령 미선언", m.render_approval_card(proposal))

    def test_declared_rollback_is_used(self):
        proposal = dict(self.base_proposal(), rollback="echo undo", rollback_declared=True)
        self.assertEqual(m.build_card(proposal)["rollback"], "echo undo")


# ══════════════════════════════════════════════════════════════════════════════
# G. 유출 필드 화이트리스트 (AC-L2-5)
# ══════════════════════════════════════════════════════════════════════════════


class TestEgressFields(Base):
    FORBIDDEN = ("user", "pid", "cmdline", "instance", "commands", "runbook_path",
                 "approver", "stdout_tail", "stderr_tail")

    def test_slack_fields_are_a_whitelist(self):
        self.write_runbook()
        proposal = dict(self.propose(), user="user1", pid=4242,
                        cmdline="python train.py", instance="node:9100")
        fields = m.slack_fields(proposal)
        for key in self.FORBIDDEN:
            self.assertNotIn(key, fields, "반출 화이트리스트가 새고 있다: %s" % key)
        self.assertIn("runbook_id", fields)
        self.assertIn("proposal_id", fields)

    def test_new_fields_do_not_leak_automatically(self):
        self.write_runbook()
        proposal = dict(self.propose(), some_future_field="비밀")
        self.assertNotIn("some_future_field", m.slack_fields(proposal))


# ══════════════════════════════════════════════════════════════════════════════
# H. 실행 결과 기록 — rc · 타임아웃 · 부분 실패
# ══════════════════════════════════════════════════════════════════════════════


class TestExecutionResults(Base):
    def test_nonzero_rc_is_a_failure_with_rollback_guidance(self):
        # `/bin/false` — 그냥 `false` 로 쓰면 YAML이 **불리언**으로 읽는다(픽스처 함정).
        self.write_runbook(command="/bin/false")
        proposal = self.propose()
        result = self.approve_and_apply(proposal["proposal_id"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], m.OUTCOME_FAILURE)
        self.assertNotEqual(result["results"][0]["rc"], 0)
        self.assertIn("롤백", m.render_execution(result))

    def test_timeout_is_recorded_not_raised(self):
        self.write_runbook(command="sleep 5")
        proposal = self.propose()
        result = self.approve_and_apply(proposal["proposal_id"], timeout=1)
        self.assertTrue(result["results"][0]["timed_out"])
        self.assertIsNone(result["results"][0]["rc"])
        self.assertEqual(result["reason"], m.OUTCOME_FAILURE)

    def test_stdout_is_captured_into_the_ledger(self):
        self.write_runbook(command="echo keiwi-l2-ran")
        proposal = self.propose()
        result = self.approve_and_apply(proposal["proposal_id"])
        self.assertIn("keiwi-l2-ran", result["results"][0]["stdout_tail"])

    def test_execution_environment_is_built_not_inherited(self):
        os.environ["KEIWI_L2_LEAK"] = "leaked"
        self.addCleanup(os.environ.pop, "KEIWI_L2_LEAK", None)
        self.write_runbook(command="echo env=${KEIWI_L2_LEAK:-none}")
        # 위 명령은 `${` 를 담고 있어 정책이 거부한다 — 그 자체가 이 계약의 일부다.
        self.assertEqual(self.propose()["refusal"], "unsafe_command")
        # 환경 자체는 상수 화이트리스트다.
        self.assertNotIn("KEIWI_L2_LEAK", m.EXEC_ENV)
        self.assertEqual(sorted(m.EXEC_ENV), ["LANG", "LC_ALL", "PATH", "TERM"])


# ══════════════════════════════════════════════════════════════════════════════
# I. 경계 — L1은 실행을 모른다 · 실행 지점은 하나 · 명령은 인자가 아니다
# ══════════════════════════════════════════════════════════════════════════════


class TestBoundary(unittest.TestCase):
    def source(self, name):
        with open(os.path.join(HERE, name), encoding="utf-8") as fh:
            return fh.read()

    def test_l1_module_does_not_know_about_l2(self):
        """L1이 L2를 import 하면 '실행 능력 0'이 대리 실행으로 우회된다."""
        self.assertNotIn("remediation_l2", self.source("remediation_l1.py"))

    def test_exactly_one_execution_site(self):
        hits = re.findall(r"subprocess\.(run|Popen|call|check_output|check_call)\s*\(",
                          self.source("remediation_l2.py"))
        self.assertEqual(len(hits), 1, "실행 지점이 %d곳이다 — 깔때기는 하나여야 한다" % len(hits))

    def test_executor_does_not_accept_a_command_argument(self):
        import inspect
        params = inspect.signature(m.execute_approved).parameters
        for banned in ("command", "cmd", "script", "shell", "argv"):
            self.assertNotIn(banned, params)

    def test_cli_has_no_command_option(self):
        parser = m._build_parser()
        options = {o for a in parser._actions for o in a.option_strings}
        for banned in ("--command", "--cmd", "--exec", "--shell", "--script"):
            self.assertNotIn(banned, options)

    def test_no_daemon_affordance(self):
        """데몬·타이머·리스너가 없어야 §11 논증(사람이 개시한다)이 성립한다."""
        src = self.source("remediation_l2.py")
        for banned in ("HTTPServer", "socketserver", "serve_forever",
                       "while True", "threading.Timer", "schedule"):
            self.assertNotIn(banned, src, "자동 트리거 수단이 들어왔다: %s" % banned)

    def test_destructive_vocabulary_covers_the_gate_vocabulary(self):
        """게이트 A6이 아는 파괴 동사를 런타임도 전부 알아야 한다(두 목록의 드리프트 방지)."""
        gate = os.path.join(HERE, "..", "..", "scripts", "gates",
                            "check-runbook-actions.sh")
        if not os.path.exists(gate):
            self.skipTest("게이트 파일 없음")
        with open(gate, encoding="utf-8") as fh:
            text = fh.read()
        match = re.search(r'r"\(\?:\^\|\[\\s;\|&/\]\)\(\?:([^)]+)\)', text)
        self.assertIsNotNone(match, "A6 어휘를 못 읽었다 — 게이트 형식이 바뀌었다")
        # 게이트의 정규식은 파이썬 인접 문자열 이어쓰기로 두 줄에 걸쳐 있다.
        # 이음매(`"` 개행 `r"`)를 지운 뒤에야 어휘 목록이 된다.
        vocabulary = re.sub(r'"\s*r"', "", match.group(1))
        for verb in [v for v in vocabulary.split("|") if v]:
            self.assertIn(verb, m.DESTRUCTIVE_VERBS,
                          "A6이 아는 파괴 동사 %r 을 L2 런타임이 모른다" % verb)


T_BASE = TestLedger


class TestFailOpenRegressions(T_BASE):
    """2026-08-05 적대검증이 뚫은 fail-open 3종의 회귀 고정.

    셋 다 "실행은 됐는데 기록·방어가 없다"는 같은 부류다 — 감사 원장이 상태 판정의
    유일한 근거이므로, 원장이 못 미더우면 **실행할 자격이 없다**(fail-closed).
    """

    def test_unwritable_ledger_refuses_before_running(self):
        # 실행 뒤에 기록하면 원장 쓰기 실패 시 부작용만 남는다. 의도를 먼저 적고,
        # 그 append가 실패하면 실행 자체를 포기해야 한다.
        self.write_runbook()
        pid = self.propose()["proposal_id"]
        m.approve(pid, ledger=self.ledger, approver="user1")
        os.chmod(self.ledger.path, 0o400)
        try:
            r = m.execute_approved(pid, ledger=self.ledger, apply=True,
                                   runbooks_root=self.books)
            self.assertEqual(r["reason"], "ledger_unwritable")
            self.assertFalse(os.path.exists(self.marker), "무기록 실행이 일어났다")
        finally:
            os.chmod(self.ledger.path, 0o600)

    def test_corrupt_ledger_refuses_apply(self):
        # 깨진 줄은 for_proposal()이 걸러내 state()가 거부·실행 이력을 못 본다.
        # 그 상태에서 실행하면 거부된 제안이 실행되거나 재실행 방어가 풀린다.
        self.write_runbook()
        pid = self.propose()["proposal_id"]
        m.approve(pid, ledger=self.ledger, approver="user1")
        lines = open(self.ledger.path, encoding="utf-8").read().splitlines()
        lines.insert(1, "{깨진 JSON")
        with open(self.ledger.path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        r = m.execute_approved(pid, ledger=self.ledger, apply=True,
                               runbooks_root=self.books)
        self.assertTrue(str(r["reason"]).startswith("ledger_corrupt"), r)
        self.assertFalse(os.path.exists(self.marker), "손상 원장에서 실행됐다")

    def test_dry_run_still_works_with_corrupt_ledger(self):
        # 거부는 apply 경로에만 — 조회·dry-run까지 막으면 사고 중 상태 파악이 불가능해진다.
        self.write_runbook()
        pid = self.propose()["proposal_id"]
        lines = open(self.ledger.path, encoding="utf-8").read().splitlines()
        lines.insert(1, "{깨진 JSON")
        with open(self.ledger.path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        r = m.execute_approved(pid, ledger=self.ledger, apply=False,
                               runbooks_root=self.books)
        self.assertNotEqual(r["reason"], "ledger_corrupt")


if __name__ == "__main__":
    unittest.main()

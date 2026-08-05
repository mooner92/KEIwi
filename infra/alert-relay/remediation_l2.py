#!/usr/bin/env python3
"""remediation_l2 — L2 **승인 후 실행** (제안 등록 → 사람 승인 → 결정론 실행 → 감사 원장).

정본: ``specs/auto-remediation/spec.md`` §3 · [ADR-0026](../../docs/decisions/0026-auto-remediation-ladder.md) ·
tasks T2-1·T2-3·T2-5·T2-6·T2-7. 게이트: ``scripts/gates/check-remediation-l2.sh``.

⚠️ 이 파일은 **이 레포에서 프로덕션 상태를 바꿀 수 있는 유일한 지점**이다.
   ``subprocess.run`` 은 이 파일에 **정확히 한 번** 나오고(게이트 M5), 그 한 줄이 사다리
   L1(제안)과 L2(승인 실행)의 경계다. L1(:mod:`remediation_l1`)은 실행 수단을 import 도
   참조도 하지 않으며(게이트 check-remediation-l1.sh L2), 그 순수성은 이 파일이 분리되어
   있는 한에서만 유지된다 — **여기 있는 것을 저기로 옮기지 마라.**

왜 파일을 나눴나
----------------
"한 파일에 다 넣고 플래그로 가른다"가 자연스러워 보이지만, 그러면 L1의 불변식("실행 수단이
코드에 없다")이 **주석으로 격하된다.** 지금은 게이트가 L1 파일을 문법 수준에서 훑어 실행
수단의 **이름이 나오는 것 자체**를 막는다. 사다리를 한 칸 올라가는 일은 곧 **파일을 하나 더
만드는 일**이어야 하고, 그래야 "어느새 올라가 있었다"가 구조적으로 불가능해진다.

이 모듈이 하는 일 / 하지 않는 일
--------------------------------
한다:
  * L1이 낸 제안을 **감사 원장(append-only JSONL)** 에 등록한다.
  * 사람이 CLI로 승인/거부한다. 승인은 원장에 남는다.
  * 승인된 제안을 **런북 파일에서 다시 읽어** 실행한다. 기본은 ``--dry-run``.
  * 실행 전 재검증 — 런북 SHA-256 · action 지문 · tier/risk/가역/멱등 · 명령 근거성.
  * rc·소요시간·출력 꼬리·타임아웃 여부를 원장에 남긴다. 실패 시 롤백 **안내**(실행 아님).

하지 않는다 (이것이 L2의 정의다):
  * **명령 문자열을 인자로 받지 않는다.** 실행기가 받는 것은 ``proposal_id`` 뿐이고,
    실행할 명령은 그때그때 런북 파일에서 읽는다. ``--command`` 같은 옵션은 없고, 있으면
    이 파일은 실행기가 아니라 **원격 셸**이 된다(게이트 M2).
  * **자동으로 깨어나지 않는다.** 데몬·타이머·리스너·큐·워커 루프가 없다. 사람이 셸에
    명령을 치지 않으면 실행을 기다리는 프로세스 자체가 **존재하지 않는다**(게이트 M6).
    이것이 헌장 §11 "적용은 사람"에 대한 이 설계의 답이다(ADR-0026 §C1).
  * **롤백을 자동으로 하지 않는다.** 실패하면 롤백 명령을 *보여주고* 멈춘다. 자동 롤백은
    L3 소관이고 ADR-0027 뒤다.
  * **tier ≤ 1 · risk high · reversible false · idempotent false 를 실행하지 않는다.**
    거부는 fail-closed다 — 판단이 안 서면 막는 쪽이다.

드리프트를 잡는 이유 (이 모듈의 존재 이유 절반)
-----------------------------------------------
제안 시각과 실행 시각 사이에 런북이 바뀔 수 있다. 사람이 고쳤을 수도, 브랜치가 바뀌었을
수도 있다(``log-ingestion-stopped`` 런북이 경고하는 바로 그 사고 — git 작업이 곧 라이브
변경이다). 제안에 실린 명령을 그대로 들고 실행하면 **문서와 다른 것을 실행하면서 문서를
근거로 댄다.** 그래서 실행기는 명령을 들고 다니지 않고 **파일을 다시 읽고**, 제안 시점에
찍어 둔 SHA-256과 다르면 실행하지 않는다. 다시 제안받으라고 말한다.

셸에 관한 정직한 고백
---------------------
런북의 명령은 **셸 명령이다** — 파이프(``| grep``)·``&&``·따옴표가 들어 있다. 그래서
``shell=True`` 로 돈다. 이 파일에서 가장 위험한 줄이고, 그 위험을 다음으로 좁힌다:

  1. 명령 문자열은 **사람이 PR로 리뷰하고 게이트 A1~A10이 검사한 런북 파일**에서만 온다.
     LLM 출력에서 오는 것은 ``action_id`` 라는 이름뿐이다(L1과 같은 규약).
  2. **어떤 런타임 값도 명령에 끼워 넣지 않는다.** 포맷 문자열도, 노드명 치환도 없다.
     보간 지점이 없으면 셸 인젝션의 주입 지점도 없다.
  3. 명령 치환(``$(``·백틱·``${``)이 들어 있으면 **실행을 거부**한다. 우리 명령은 상수라
     동적 치환이 필요할 이유가 없고, 필요해지는 날은 설계를 다시 볼 날이다.
  4. 파괴 동사 목록을 **라벨과 독립적으로** 다시 본다(``risk`` 표기를 믿지 않는 두 번째 선).

못 하는 것: ``timeout`` 은 셸 프로세스를 죽이지만 셸이 낳은 **손자 프로세스까지 보장하지
않는다.** 그래서 대상을 짧고 멱등한 조치로 좁히고, ``timed_out`` 을 원장에 남긴다.

감사 원장을 로컬 파일에 두는 이유
---------------------------------
스펙 §0-5는 OpenSearch ``keiwi-remediation-*`` 라고 썼다. 쓰기 경로는 **로컬 append-only
JSONL**로 둔다(ADR-0026): L2의 1호 후보가 하필 ``LogIngestStalled``(로그 인입 중단)이라,
로그 파이프라인을 고치는 조치의 감사 기록을 **그 파이프라인으로** 보내는 것은 자기모순이다.
OpenSearch에는 filebeat가 이 파일을 tail 해서 채운다 — **쓰기는 로컬(강한 보장), 조회는
OpenSearch(편의)**. 배선 절차는 ``infra/alert-relay/README.md``(§11 사람이 적용).

의존성: Python 3 stdlib **전용** + 같은 디렉터리의 :mod:`remediation_l1`(그리고 그것이 쓰는
:mod:`keiwi_redaction`). pip 0 — relay와 같은 계약이다.

사용:
    python3 remediation_l2.py propose --alert LogIngestStalled --node data03
    python3 remediation_l2.py list
    python3 remediation_l2.py show  p-20260805-1a2b3c4d
    python3 remediation_l2.py approve p-20260805-1a2b3c4d            # dry-run (기본)
    python3 remediation_l2.py approve p-20260805-1a2b3c4d --apply    # 실제 실행
    python3 remediation_l2.py reject  p-20260805-1a2b3c4d --reason "지금 말고"
"""

import argparse
import datetime
import getpass
import hashlib
import json
import os
import re
import socket
import fcntl
import subprocess
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import remediation_l1 as l1  # noqa: E402 — 경로 확정 후 import (relay와 같은 배치 규약)

VERSION = "1.0.0"

# ── 정책 상수 ────────────────────────────────────────────────────────────────
# L2가 손댈 수 있는 최소 tier. tier는 런북이 선언한 **도달 가능 최대 자율 레벨**이고
# (spec §2.3), 1 이하는 "제안까지"라는 뜻이다. stale 강등으로 실효 tier가 1로 내려간
# 런북도 여기서 걸린다 — 낡은 문서를 근거로 라이브를 바꾸지 않는다.
MIN_TIER = 2

# 실행 가능한 위험 라벨. `high` 는 tier 규칙(A5)이 이미 막지만, 라벨과 tier가 **둘 다**
# 검사되어야 한 쪽의 실수가 통과하지 않는다.
ALLOWED_RISKS = ("low", "medium")

# 제안의 유효기간. 3일 전 제안을 오늘 승인하는 것은 승인이 아니라 추측이다 —
# 그 사이 세상이 바뀌었고, 제안이 인용한 증거는 더 이상 지금의 증거가 아니다.
PROPOSAL_TTL_SEC = int(os.environ.get("KEIWI_REMEDIATION_TTL", "3600"))

DEFAULT_TIMEOUT_SEC = 120
MAX_CAPTURE_CHARS = 4000                 # 원장에 남기는 stdout/stderr 꼬리 상한

LEDGER_ENV = "KEIWI_REMEDIATION_LEDGER"
DEFAULT_LEDGER = "/var/log/keiwi/remediation.jsonl"

SHELL = "/bin/bash"
# 실행 환경은 **물려받지 않고 만든다.** 승인자의 셸 환경(별칭 없는 PATH 오염·LD_PRELOAD·
# 로캘에 따른 출력 변형)이 조치의 동작을 바꾸면 "같은 명령이 같은 결과"라는 전제가 깨진다.
EXEC_ENV = {
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
    "TERM": "dumb",
}

# 파괴 동사 — `check-runbook-actions.sh` A6과 **같은 어휘**를 런타임에 다시 본다.
# 중복인가? 그렇다. 그런데 A6은 **작성 시점**(CI에서 파일을 검사)이고 이것은 **실행 시점**이다.
# 서버에서 런북을 직접 고치면 CI를 안 거친다 — 그때 남는 방어선이 이것뿐이다.
# 두 목록이 갈라지는 것을 막기 위해 게이트 M8이 "A6 어휘 ⊆ 이 목록"을 기계로 대조한다.
DESTRUCTIVE_VERBS = (
    "rm", "rmdir", "kill", "pkill", "killall", "reboot", "shutdown", "halt",
    "poweroff", "mkfs", "fdisk", "dd", "shred", "userdel", "truncate", "mv",
)
_DESTRUCTIVE_RE = re.compile(
    r"(?:^|[\s;|&/])(?:%s)(?:\s|$)" % "|".join(DESTRUCTIVE_VERBS)
    + r"|--purge|--force-remove|_delete_by_query|DROP\s+TABLE"
    + r"|(?:^|\s)-delete\b"
    + r"|chown\s+-R\b"
    + r"|>\s*/(?:var|etc|usr|data)/"
)

# 명령 치환·변수 확장 — 상수 명령에는 있을 이유가 없다(위 docstring 3번).
_SUBSTITUTION_RE = re.compile(r"\$\(|`|\$\{")

# 승인 카드 필수 5필드 (spec §3.2 · AC-L2-2). 하나라도 비면 카드를 만들 수 없고,
# 카드를 만들 수 없으면 승인도 없다 — 승인 피로(rubber-stamp)에 대한 구조적 방어다.
CARD_FIELDS = ("what", "why", "impact", "rollback", "dry_run")

# Slack으로 나갈 수 있는 필드의 **전부**(AC-L2-5). 이 함수 밖으로 나가는 경로는 없다.
SLACK_FIELDS = ("proposal_id", "alertname", "severity", "node",
                "runbook_id", "action_id", "risk", "eligible")

STATUS_OK = "ok"
OUTCOME_PLANNED = "planned"
OUTCOME_SUCCESS = "success"
OUTCOME_FAILURE = "failure"
OUTCOME_REFUSED = "refused"

MODE_DRYRUN = "dry-run"
MODE_APPLY = "apply"

# 거부 사유 → 사람이 읽는 한 줄. 사유는 **닫힌 집합**이다(모델 문자열이 섞이지 않는다).
# 실행은 됐으나 원장 기록에 실패한 경우의 전용 종료코드 — rc=1(실패)과 구분해야
# 운영자가 "실행 안 됐구나"로 오독하고 재시도하지 않는다.
EXIT_UNRECORDED = 5

REFUSAL_TEXT = {
    "unknown_proposal": "그런 제안이 원장에 없다 — 실행기는 제안 없이 아무것도 하지 않는다",
    "not_approved": "승인 이벤트가 없다 — 승인 없이는 실행 0(AC-L2-1)",
    "ledger_unwritable": "원장에 쓸 수 없다 — 기록할 수 없으면 실행할 자격도 없다(fail-closed)",
    "ledger_corrupt": "원장이 손상됐다 — 상태를 신뢰할 수 없다. 사람이 먼저 복구하라",
    "execution_in_progress": "같은 제안을 다른 프로세스가 실행 중이다",
    "rejected": "거부된 제안이다",
    "already_executed": "이미 실행된 제안이다 — 같은 제안을 두 번 실행하지 않는다(§16)",
    "expired": "제안이 만료됐다 — 다시 제안받아라",
    "not_eligible": "제안 등록 시점에 이미 L2 부적격으로 판정됐다",
    "runbook_missing": "런북 파일이 없다 — 근거가 사라진 조치는 실행하지 않는다",
    "action_missing": "런북에 그 action_id가 없다 — 화이트리스트 밖이다",
    "runbook_drift": "런북 파일이 제안 이후 바뀌었다(SHA-256 불일치) — 다시 제안받아라",
    "action_drift": "조치 선언이 제안 이후 바뀌었다 — 다시 제안받아라",
    "command_drift": "실행할 명령이 제안에 실린 명령과 다르다",
    "tier_below_l2": "tier가 L2 미만이다 — 이 런북은 제안까지다",
    "stale_runbook": "stale 런북(last_verified 초과) — 실효 tier가 1로 강등됐다",
    "risk_blocked": "risk가 허용 밖이다(high/unknown) — 사람이 직접 하라",
    "not_reversible": "reversible: false — 되돌릴 수 없는 조치는 L2에서도 거부한다",
    "not_idempotent": "idempotent: false — 재실행이 안전하지 않은 조치는 거부한다(§16)",
    "no_command": "실행할 명령이 없다",
    "destructive_command": "파괴 동사를 담은 명령이다 — 라벨과 무관하게 거부한다",
    "unsafe_command": "명령 치환·개행이 있는 명령이다 — 상수 명령만 실행한다",
    "ungrounded_command": "명령이 런북 본문 코드블록에서 확인되지 않는다(근거 없음)",
    "no_target": "영향범위(노드/서비스)를 알 수 없다 — 승인 카드를 만들 수 없다",
    "card_incomplete": "승인 카드 5필드를 채울 수 없다(AC-L2-2)",
}


class CardError(ValueError):
    """승인 카드 필수 필드가 비었다 — 카드를 게시하지 않는다(AC-L2-2)."""


# ══════════════════════════════════════════════════════════════════════════════
# 1. 시각·신원
# ══════════════════════════════════════════════════════════════════════════════


def _utcnow():
    # naive UTC. tz-aware와 섞으면 뺄셈이 예외를 던지므로 **한 종류만** 쓴다.
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


def _stamp(when=None):
    return (when or _utcnow()).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_stamp(text):
    try:
        return datetime.datetime.strptime(str(text), "%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, TypeError):
        return None


def current_approver():
    """승인자 = **셸에 로그인한 사람**. 서비스 계정도 상주 토큰도 없다(ADR-0026 §C4).

    ``sudo`` 로 들어온 경우 원래 계정을 남긴다 — 원장에 ``root`` 만 줄줄이 남으면
    "누가 승인했는가"를 못 말한다.
    """
    for env in ("SUDO_USER", "KEIWI_APPROVER"):
        value = os.environ.get(env)
        if value:
            return str(value)
    try:
        return getpass.getuser()
    except (KeyError, OSError):
        return "unknown"


def _hostname():
    try:
        return socket.gethostname()
    except OSError:
        return "unknown"


def new_proposal_id(when=None):
    return "p-%s-%s" % ((when or _utcnow()).strftime("%Y%m%d"), uuid.uuid4().hex[:8])


# ══════════════════════════════════════════════════════════════════════════════
# 2. 감사 원장 — append-only JSONL (T2-6 · AC-L2-4)
# ══════════════════════════════════════════════════════════════════════════════


class Ledger(object):
    """추가만 되는 사건 기록. **1인 운영의 유일한 사후검증 근거**(spec §0-5).

    보장:
      * ``O_APPEND`` + ``fsync`` — 쓰기는 원자적으로 끝에 붙고 디스크에 닿는다.
      * 이 클래스에 **수정·삭제 메서드가 없다.** 파일을 ``"w"`` 로 여는 자리도 없다
        (게이트 M7이 문법 수준에서 확인한다).
      * 한 줄 = 한 사건 = 유효한 JSON. ``cat`` 으로 읽힌다 — 도구 없이 감사 가능해야 한다.

    파일 권한은 0600이다. 원장에는 명령 전문과 출력 꼬리가 들어가고, 그것은 이 플릿의
    운영 상세다(PUBLIC 레포에 나가는 물건이 아니다).
    """

    def __init__(self, path=None):
        self.path = os.path.abspath(
            path or os.environ.get(LEDGER_ENV) or DEFAULT_LEDGER)

    # ── 쓰기 ────────────────────────────────────────────────────────────────
    def append(self, event):
        record = dict(event)
        record.setdefault("ts", _stamp())
        record.setdefault("host", _hostname())
        record.setdefault("ledger_version", VERSION)
        line = json.dumps(record, ensure_ascii=False, sort_keys=True, default=str) + "\n"
        parent = os.path.dirname(self.path)
        if parent and not os.path.isdir(parent):
            os.makedirs(parent, 0o700)
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(fd, line.encode("utf-8"))
            os.fsync(fd)
        finally:
            os.close(fd)
        return record

    # ── 읽기 ────────────────────────────────────────────────────────────────
    def events(self):
        """전 사건. 깨진 줄은 **버리지 않고** ``event=corrupt`` 로 남긴다.

        조용히 건너뛰면 원장이 "완전하다"고 거짓말한다 — 감사 기록에서 그건 치명적이다.
        """
        if not os.path.exists(self.path):
            return []
        out = []
        with open(self.path, encoding="utf-8") as fh:
            for n, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except ValueError:
                    out.append({"event": "corrupt", "line_no": n})
        return out

    def for_proposal(self, proposal_id):
        return [e for e in self.events() if e.get("proposal_id") == proposal_id]

    def state(self, proposal_id):
        """제안 하나의 현재 상태를 사건들로 **접어서** 만든다(파생 상태를 저장하지 않는다)."""
        st = {
            "proposal": None, "approved": None, "rejected": None,
            "applied": None, "dry_runs": 0, "events": [],
        }
        for e in self.for_proposal(proposal_id):
            st["events"].append(e)
            kind = e.get("event")
            if kind == "proposal" and st["proposal"] is None:
                st["proposal"] = e
            elif kind == "approval" and st["approved"] is None:
                st["approved"] = e
            elif kind == "rejection" and st["rejected"] is None:
                st["rejected"] = e
            elif kind == "execution":
                if e.get("mode") == MODE_APPLY and e.get("outcome") in (
                        OUTCOME_SUCCESS, OUTCOME_FAILURE):
                    st["applied"] = e
                elif e.get("mode") == MODE_DRYRUN:
                    st["dry_runs"] += 1
        return st

    def proposals(self):
        return [e for e in self.events() if e.get("event") == "proposal"]


# ══════════════════════════════════════════════════════════════════════════════
# 3. 지문 — 제안 시점과 실행 시점 사이의 드리프트를 잡는다
# ══════════════════════════════════════════════════════════════════════════════


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_action(raw):
    """조치 선언에서 **계약 키만** 뽑아 정규화한다(게이트 A3가 강제하는 6키 + 롤백)."""
    if not isinstance(raw, dict):
        return {}
    out = {
        "id": str(raw.get("id") or ""),
        "title": str(raw.get("title") or ""),
        "risk": raw.get("risk"),
        "reversible": raw.get("reversible"),
        "idempotent": raw.get("idempotent"),
        "command": l1.Action._as_commands(raw.get("command")),
    }
    for optional in ("rollback", "rollback_ref", "command_ref", "section"):
        if raw.get(optional):
            out[optional] = raw.get(optional)
    return out


def action_digest(raw):
    blob = json.dumps(canonical_action(raw), ensure_ascii=False,
                      sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def raw_action(runbook, action_id):
    """런북 frontmatter의 **원본 dict**(파싱된 Action 객체가 아니라)를 꺼낸다."""
    for item in runbook.fm.get("actions") or []:
        if isinstance(item, dict) and str(item.get("id") or "") == action_id:
            return item
    return None


def load_from_disk(runbook_id, action_id, runbooks_root=None):
    """실행 직전 **디스크에서 다시** 읽는다. 인메모리 상태를 신뢰하지 않는다.

    돌려주는 값: ``(runbook|None, action|None, raw|None, reason)``.
    """
    corpus = l1.load_corpus(runbooks_root)
    runbook = corpus.get(runbook_id)
    if runbook is None:
        return None, None, None, "runbook_missing"
    action = runbook.action(action_id)
    raw = raw_action(runbook, action_id)
    if action is None or raw is None:
        return runbook, None, None, "action_missing"
    return runbook, action, raw, STATUS_OK


# ══════════════════════════════════════════════════════════════════════════════
# 4. 정책 — 무엇을 실행해도 되는가 (전부 fail-closed)
# ══════════════════════════════════════════════════════════════════════════════


def command_objections(commands):
    """명령 문자열 자체에 대한 거부 사유. 라벨(risk)과 **독립적으로** 본다."""
    for text in commands:
        if not text or "\n" in text or "\r" in text:
            return "unsafe_command"
        if _SUBSTITUTION_RE.search(text):
            return "unsafe_command"
        if _DESTRUCTIVE_RE.search(text):
            return "destructive_command"
    return None


def check_policy(runbook, action, raw, today=None, stale_days=l1.STALE_DAYS):
    """이 조치가 L2에서 실행 가능한가. ``(ok, reason, detail)``.

    검사 순서는 **더 원초적인 거부가 먼저**다 — tier(문서 단위 상한) → 신선도 →
    라벨(조치 단위) → 명령 자체 → 근거성. 사람이 사유를 읽었을 때 "무엇을 고쳐야
    하는가"가 바로 보이게 하는 순서다.
    """
    today = today or datetime.date.today()
    days = runbook.stale_days(today)
    stale = days is not None and days > stale_days
    # L1과 **같은 강등 규칙**을 쓴다: 강등은 상한을 낮출 뿐 절대 올리지 않는다.
    effective_tier = min(1, runbook.tier) if stale else runbook.tier
    detail = {
        "tier": runbook.tier, "effective_tier": effective_tier,
        "stale": stale, "stale_days": days,
        "risk": action.risk, "reversible": action.reversible,
        "idempotent": action.idempotent,
    }

    if runbook.tier < MIN_TIER:
        return False, "tier_below_l2", detail
    if stale:
        return False, "stale_runbook", detail
    if effective_tier < MIN_TIER:                     # 방어적 이중화(강등 규칙이 바뀌어도)
        return False, "tier_below_l2", detail
    if action.risk not in ALLOWED_RISKS:
        return False, "risk_blocked", detail
    if action.reversible is not True:
        return False, "not_reversible", detail
    if action.idempotent is not True:
        return False, "not_idempotent", detail

    extracted = l1.extract_commands(runbook, action)
    commands = [c["text"] for c in extracted]
    detail["commands"] = extracted
    if not commands:
        return False, "no_command", detail
    objection = command_objections(commands)
    if objection:
        return False, objection, detail
    if any(not c.get("grounded") for c in extracted):
        # A7(본문 코드블록 실존)을 **실행 시점에** 다시 본다. 게이트는 CI에서 보지만,
        # 서버에서 직접 고친 런북은 CI를 안 거친다.
        return False, "ungrounded_command", detail
    return True, STATUS_OK, detail


# ══════════════════════════════════════════════════════════════════════════════
# 5. 제안 등록 (L1 결과 → 원장)
# ══════════════════════════════════════════════════════════════════════════════


def register_proposal(result, signal=None, ledger=None, runbooks_root=None,
                      today=None, when=None):
    """L1 :func:`remediation_l1.propose` 결과를 원장에 등록한다.

    **부적격이어도 등록한다.** "제안은 났지만 L2에서 거부됐다"는 사실 자체가 감사
    대상이고, 등록하지 않으면 그 사실이 어디에도 안 남는다. 대신 ``eligible=False`` 와
    사유를 함께 박아 두고, 승인 단계가 그걸 보고 막는다.
    """
    if not result or result.get("status") != l1.STATUS_PROPOSAL:
        raise ValueError("L2는 L1 제안만 등록한다(status=proposal 아님)")
    ledger = ledger or Ledger()
    signal = signal or {}
    when = when or _utcnow()

    runbook_id = result["runbook_id"]
    action_id = (result.get("action") or {}).get("id")
    runbook, action, raw, reason = load_from_disk(runbook_id, action_id, runbooks_root)
    if reason != STATUS_OK:
        event = _proposal_event(result, signal, when, eligible=False, refusal=reason)
        return ledger.append(event)

    ok, reason, detail = check_policy(runbook, action, raw, today=today)
    event = _proposal_event(result, signal, when, eligible=ok,
                            refusal=None if ok else reason)
    event.update({
        "runbook_path": runbook.path,
        "runbook_sha256": sha256_file(runbook.path),
        "action_sha256": action_digest(raw),
        "tier": detail.get("tier"),
        "effective_tier": detail.get("effective_tier"),
        "risk": action.risk,
        "reversible": action.reversible,
        "idempotent": action.idempotent,
        "action_title": action.title,
        "commands": [c["text"] for c in (detail.get("commands") or [])],
        "command_lines": [c["line"] for c in (detail.get("commands") or [])],
        "rollback": raw.get("rollback") or raw.get("rollback_ref"),
        "rollback_declared": bool(raw.get("rollback") or raw.get("rollback_ref")),
        "stale": detail.get("stale"),
    })
    return ledger.append(event)


def _proposal_event(result, signal, when, eligible, refusal):
    action = result.get("action") or {}
    return {
        "event": "proposal",
        "proposal_id": new_proposal_id(when),
        "ts": _stamp(when),
        "source": "l1",
        "l1_version": result.get("version"),
        "alertname": signal.get("alertname") or result.get("category"),
        "severity": signal.get("severity"),
        "node": signal.get("node"),
        "service": signal.get("service"),
        "runbook_id": result.get("runbook_id"),
        "action_id": action.get("id"),
        "action_title": action.get("title"),
        "risk": action.get("risk"),
        "confidence": result.get("confidence"),
        "citations": [
            {"n": c.get("n"), "path": c.get("path"), "line": c.get("line")}
            for c in (result.get("citations") or [])
        ],
        "eligible": bool(eligible),
        "refusal": refusal,
        "commands": [c.get("text") for c in (result.get("commands") or [])],
    }


# ══════════════════════════════════════════════════════════════════════════════
# 6. 승인 카드 — 5필드 강제 (T2-3 · AC-L2-2)
# ══════════════════════════════════════════════════════════════════════════════


def build_card(proposal):
    """제안 → 승인 카드 5필드. 하나라도 비면 :class:`CardError`.

    왜 강제인가: 승인 피로(rubber-stamp)가 human-in-the-loop을 무너뜨리는 방식은
    "카드가 부실해서 읽을 게 없는" 것이다(spec §8). **무엇을·왜·영향·롤백·dry-run**이
    없으면 승인은 형식이 되고, 형식이 된 승인은 없는 것과 같다.

    ``rollback`` 에 관한 정직한 약화(ADR-0026): 우리 tier≥2 조치에는 대칭 역명령이
    없다 — "재시작"의 역명령은 존재하지 않는다. 그래서 이 필드는 선언된 롤백 명령이
    있으면 그것을, 없으면 **"실패 시 사람이 무엇을 볼 것인가"(런북 경로)** 를 담는다.
    빈 값은 허용하지 않지만, 선언 여부는 ``rollback_declared`` 로 원장에 남는다.
    """
    what = _card_what(proposal)
    why = _card_why(proposal)
    impact = _card_impact(proposal)
    rollback = _card_rollback(proposal)
    dry_run = _card_dry_run(proposal)
    card = {"what": what, "why": why, "impact": impact,
            "rollback": rollback, "dry_run": dry_run}
    missing = [k for k in CARD_FIELDS if not str(card.get(k) or "").strip()]
    if missing:
        raise CardError("승인 카드 필수 필드 누락: %s" % ", ".join(sorted(missing)))
    return card


def _card_what(proposal):
    runbook_id = proposal.get("runbook_id")
    action_id = proposal.get("action_id")
    if not runbook_id or not action_id:
        return ""
    return "%s / %s — %s" % (runbook_id, action_id,
                             proposal.get("action_title") or action_id)


def _card_why(proposal):
    cites = proposal.get("citations") or []
    if not cites:
        return ""                                   # 근거 없으면 카드 없음(§0-3)
    return " ".join("[%s] %s:%s" % (c.get("n"), c.get("path"), c.get("line"))
                    for c in cites)


def _card_impact(proposal):
    target = proposal.get("node") or proposal.get("service")
    if not target:
        return ""                                   # 영향범위를 못 쓰면 승인도 없다
    bits = ["대상 %s" % target,
            "risk %s" % (proposal.get("risk") or "?"),
            "tier %s" % (proposal.get("tier") if proposal.get("tier") is not None else "?")]
    if proposal.get("alertname"):
        bits.append("알림 %s" % proposal["alertname"])
    bits.append("명령 %d개" % len(proposal.get("commands") or []))
    return " · ".join(bits)


def _card_rollback(proposal):
    declared = proposal.get("rollback")
    if declared:
        items = declared if isinstance(declared, list) else [declared]
        return " ; ".join(str(i) for i in items)
    path = proposal.get("runbook_path") or proposal.get("runbook_id")
    if not path:
        return ""
    return ("롤백 명령 미선언 — 실패 시 자동 복구 없음. 런북 %s 를 열고 사람이 판단한다."
            % os.path.basename(str(path)))


def _card_dry_run(proposal):
    commands = proposal.get("commands") or []
    if not commands:
        return ""
    return "\n".join(commands)


def render_approval_card(proposal):
    """사람이 터미널에서 읽는 카드. 실행되는 것은 **여기 적힌 그대로**다."""
    card = build_card(proposal)
    lines = [
        "── 승인 카드 ──────────────────────────────────────────────",
        "제안 id   : %s" % proposal.get("proposal_id"),
        "무엇을     : %s" % card["what"],
        "왜        : %s" % card["why"],
        "영향범위   : %s" % card["impact"],
        "롤백      : %s" % card["rollback"],
        "실행될 명령 (dry-run):",
    ]
    for text in card["dry_run"].split("\n"):
        lines.append("    $ %s" % text)
    if proposal.get("stale"):
        lines.append("⚠️ stale 런북 — L2에서 거부된다.")
    if not proposal.get("eligible"):
        lines.append("⛔ L2 부적격: %s" % REFUSAL_TEXT.get(
            proposal.get("refusal"), proposal.get("refusal")))
    if not proposal.get("rollback_declared"):
        lines.append("⚠️ 롤백 명령이 선언돼 있지 않다 — 실패는 사람이 수습한다.")
    lines.append("승인:  remediation_l2.py approve %s --apply" % proposal.get("proposal_id"))
    lines.append("───────────────────────────────────────────────────────────")
    return "\n".join(lines)


def slack_fields(proposal):
    """Slack으로 나갈 수 있는 필드의 **전부**(AC-L2-5).

    ``user``·``pid``·``cmdline``·``instance``·``commands``·``runbook_path`` 는 여기서
    구조적으로 빠진다 — 화이트리스트이지 블랙리스트가 아니라, 새 필드가 생겨도
    자동으로 나가지 않는다. (Slack은 이 설계에서 **단방향 통지 전용**이다 — 승인
    버튼은 채택하지 않았다. ADR-0026)
    """
    return {k: proposal.get(k) for k in SLACK_FIELDS if proposal.get(k) is not None}


# ══════════════════════════════════════════════════════════════════════════════
# 7. 승인 / 거부
# ══════════════════════════════════════════════════════════════════════════════


def _refusal(proposal_id, reason, **kw):
    out = {"ok": False, "reason": reason,
           "text": REFUSAL_TEXT.get(reason, reason),
           "proposal_id": proposal_id}
    out.update(kw)
    return out


def approve(proposal_id, ledger=None, approver=None, note=None, when=None):
    """사람이 승인한다. 승인은 **실행이 아니다** — 실행은 ``--apply`` 가 따로 요구한다."""
    ledger = ledger or Ledger()
    st = ledger.state(proposal_id)
    proposal = st["proposal"]
    if proposal is None:
        return _refusal(proposal_id, "unknown_proposal")
    if st["rejected"]:
        return _refusal(proposal_id, "rejected")
    if st["applied"]:
        return _refusal(proposal_id, "already_executed")
    if _expired(proposal, when):
        return _refusal(proposal_id, "expired")
    if not proposal.get("eligible"):
        return _refusal(proposal_id, proposal.get("refusal") or "not_eligible")
    try:
        build_card(proposal)                       # 카드를 못 만들면 승인도 없다
    except CardError as exc:
        return _refusal(proposal_id, "card_incomplete", detail=str(exc))
    if st["approved"]:
        return {"ok": True, "reason": "already_approved", "proposal_id": proposal_id,
                "event": st["approved"]}
    event = ledger.append({
        "event": "approval", "proposal_id": proposal_id,
        "approver": approver or current_approver(),
        "note": note, "runbook_id": proposal.get("runbook_id"),
        "action_id": proposal.get("action_id"),
        "ts": _stamp(when),
    })
    return {"ok": True, "reason": STATUS_OK, "proposal_id": proposal_id, "event": event}


def reject(proposal_id, ledger=None, approver=None, reason=None, when=None):
    ledger = ledger or Ledger()
    st = ledger.state(proposal_id)
    if st["proposal"] is None:
        return _refusal(proposal_id, "unknown_proposal")
    if st["applied"]:
        return _refusal(proposal_id, "already_executed")
    event = ledger.append({
        "event": "rejection", "proposal_id": proposal_id,
        "approver": approver or current_approver(),
        "reason": reason, "ts": _stamp(when),
    })
    return {"ok": True, "reason": STATUS_OK, "proposal_id": proposal_id, "event": event}


def _expired(proposal, when=None):
    made = _parse_stamp(proposal.get("ts"))
    if made is None:
        return True                                # 시각을 못 읽으면 만료로 본다(fail-closed)
    return ((when or _utcnow()) - made).total_seconds() > PROPOSAL_TTL_SEC


# ══════════════════════════════════════════════════════════════════════════════
# 8. 실행 — **이 레포에서 상태를 바꾸는 유일한 지점**
# ══════════════════════════════════════════════════════════════════════════════


def _run_one(command, timeout):
    """명령 하나를 돌리고 결과를 기록 가능한 dict로 만든다.

    ⚠️ 이 함수의 ``subprocess.run`` 이 **이 레포 전체에서 프로덕션을 바꿀 수 있는 유일한
    호출**이다(게이트 M5가 "정확히 1회"를 강제한다). 호출자는 :func:`execute_approved`
    하나뿐이고, 거기 도달하려면 원장에 제안과 승인이 있어야 한다.

    ``command`` 는 **런북 파일에서 읽은 상수 문자열**이다. 이 함수는 문자열을 조립하지도
    보간하지도 않는다 — 인자로 받은 것을 그대로 셸에 넘긴다.
    """
    started = time.time()
    stdout, stderr, rc, timed_out = b"", b"", None, False
    try:
        completed = subprocess.run(                # noqa: S602 — 위 docstring 참조
            command, shell=True, executable=SHELL, cwd="/", env=dict(EXEC_ENV),
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout,
        )
        rc, stdout, stderr = completed.returncode, completed.stdout, completed.stderr
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        stdout, stderr = exc.stdout or b"", exc.stderr or b""
    except OSError as exc:
        stderr = ("실행 실패: %s" % exc).encode("utf-8")
    return {
        "command": command,
        "rc": rc,
        "timed_out": timed_out,
        "duration_ms": int((time.time() - started) * 1000),
        "stdout_tail": _tail(stdout),
        "stderr_tail": _tail(stderr),
    }


def _tail(blob):
    if not blob:
        return ""
    text = blob.decode("utf-8", "replace") if isinstance(blob, bytes) else str(blob)
    return text[-MAX_CAPTURE_CHARS:]


def execute_approved(proposal_id, ledger=None, apply=False, runbooks_root=None,
                     timeout=DEFAULT_TIMEOUT_SEC, when=None, today=None):
    """승인된 제안을 실행한다. **기본은 dry-run** — ``apply=True`` 가 명시적 의사표시다.

    실행 전에 하는 일(전부 fail-closed, 하나라도 어긋나면 실행 0):
      1. 원장에 그 제안이 있는가 · 거부/실행 이력은 없는가 · 만료되지 않았는가
      2. (apply일 때) **승인 이벤트가 있는가** — 없으면 거부(AC-L2-1)
      3. 런북·조치가 **지금도 디스크에 있는가**
      4. 런북 SHA-256 · 조치 지문이 **제안 시점과 같은가**(드리프트)
      5. tier·risk·가역·멱등·명령 안전성·본문 근거성 **재검증**
      6. 실행할 명령이 제안에 실린 명령과 **같은가**

    어떤 결과든 원장에 남는다. 거부도 사건이다 — "누가 실행하려 했는가"가 안 남으면
    감사 원장이 아니다.
    """
    ledger = ledger or Ledger()
    mode = MODE_APPLY if apply else MODE_DRYRUN

    # ── 배타 잠금(apply 전용) ────────────────────────────────────────────────
    # state() 읽기와 실행 사이에 잠금이 없으면 TOCTOU다 — 같은 proposal_id로 CLI 3개를
    # 동시에 띄우면 셋 다 applied=None을 보고 **3회 실행**한다[실증 2026-08-05].
    # 조치가 멱등이라 피해는 작지만 "두 번 실행하지 않는다"(§16)는 진술이 거짓이 된다.
    # dry-run·list·show는 잠그지 않는다 — 조회는 병행 가능해야 한다.
    _lock = None
    if apply:
        try:
            _lock = open(str(ledger.path) + ".lock", "a+")
            fcntl.flock(_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            if _lock:
                _lock.close()
            ledger.append({
                "event": "execution", "proposal_id": proposal_id, "mode": mode,
                "outcome": OUTCOME_REFUSED, "refusal": "execution_in_progress",
                "refusal_text": REFUSAL_TEXT["execution_in_progress"],
                "approver": current_approver(), "results": [], "ts": _stamp(when),
            })
            return {"ok": False, "reason": "execution_in_progress",
                    "proposal_id": proposal_id, "mode": mode, "results": []}

    try:
        return _execute_locked(proposal_id, ledger, apply, runbooks_root,
                               timeout, when, today, mode)
    finally:
        if _lock:
            fcntl.flock(_lock, fcntl.LOCK_UN)
            _lock.close()


def _execute_locked(proposal_id, ledger, apply, runbooks_root, timeout, when, today, mode):
    """execute_approved 의 본문 — 잠금 안에서 돈다(위 주석 참조)."""
    st = ledger.state(proposal_id)
    proposal = st["proposal"]

    def refuse(reason, **kw):
        event = ledger.append({
            "event": "execution", "proposal_id": proposal_id, "mode": mode,
            "outcome": OUTCOME_REFUSED, "refusal": reason,
            "refusal_text": REFUSAL_TEXT.get(reason, reason),
            "approver": current_approver(), "results": [],
            "ts": _stamp(when),
        })
        out = _refusal(proposal_id, reason, mode=mode, event=event)
        out.update(kw)
        return out

    if proposal is None:
        return refuse("unknown_proposal")
    if st["rejected"]:
        return refuse("rejected")
    if st["applied"]:
        return refuse("already_executed")
    if _expired(proposal, when):
        return refuse("expired")
    if not proposal.get("eligible"):
        return refuse(proposal.get("refusal") or "not_eligible")
    if apply and not st["approved"]:
        # 승인 없이는 실행 0. dry-run은 승인 전에도 볼 수 있어야 한다 — 승인하려면
        # 무엇을 승인하는지 먼저 봐야 하기 때문이다.
        return refuse("not_approved")

    runbook, action, raw, reason = load_from_disk(
        proposal.get("runbook_id"), proposal.get("action_id"), runbooks_root)
    if reason != STATUS_OK:
        return refuse(reason)

    if sha256_file(runbook.path) != proposal.get("runbook_sha256"):
        return refuse("runbook_drift")
    if action_digest(raw) != proposal.get("action_sha256"):
        return refuse("action_drift")

    ok, reason, detail = check_policy(runbook, action, raw, today=today)
    if not ok:
        return refuse(reason)

    commands = [c["text"] for c in detail["commands"]]
    if commands != list(proposal.get("commands") or []):
        return refuse("command_drift")

    # 원장이 한 줄이라도 손상됐으면 apply를 거부한다.
    # events()는 깨진 줄을 event=corrupt로 남기지만 그 항목엔 proposal_id가 없어
    # for_proposal()이 걸러내고, state()는 그 사실을 모른 채 상태를 접는다 →
    # **거부된 제안이 실행되고**, 실행 기록이 깨지면 already_executed 방어도 풀린다.
    # [실증 2026-08-05: rejection 줄 손상 시 reason=success로 실행됨] fail-open이었다.
    if apply:
        corrupt = [e.get("line_no") for e in ledger.events() if e.get("event") == "corrupt"]
        if corrupt:
            return refuse("ledger_corrupt: 손상된 줄 %s" % corrupt)

    rollback = _card_rollback(proposal)
    if not apply:
        event = ledger.append({
            "event": "execution", "proposal_id": proposal_id, "mode": MODE_DRYRUN,
            "outcome": OUTCOME_PLANNED, "approver": current_approver(),
            "runbook_id": runbook.id, "action_id": action.id,
            "runbook_sha256": proposal.get("runbook_sha256"),
            "would_run": commands, "results": [], "rollback": rollback,
            "ts": _stamp(when),
        })
        return {"ok": True, "reason": "dry_run", "proposal_id": proposal_id,
                "mode": MODE_DRYRUN, "would_run": commands, "rollback": rollback,
                "event": event}

    # ── 실행 의도를 **먼저** 기록한다(fail-closed) ────────────────────────────
    # 예전에는 명령 루프가 끝난 뒤에야 원장에 썼다. 그 append가 실패하면(디스크 가득·
    # 읽기전용·권한 회수) **부작용은 남고 기록은 0**이며, 예외가 CLI를 rc=1로 끝내
    # 운영자에게 "실행 안 됨"이라는 역신호를 준다 → 재시도 → 무기록 재실행.
    # [실증 2026-08-05: 원장 chmod 400 후 --apply → 카나리 생성됨·원장 2줄 그대로·rc=1]
    # 하필 원장을 로컬 파일로 둔 근거가 "사고 한복판에서 쓰인다"인데, 그 상황(디스크 가득)이
    # 정확히 이 구멍의 트리거다. **기록할 수 없으면 실행할 자격도 없다.**
    try:
        ledger.append({
            "event": "execution_intent", "proposal_id": proposal_id, "mode": MODE_APPLY,
            "approver": current_approver(), "runbook_id": runbook.id,
            "action_id": action.id, "commands": commands, "ts": _stamp(when),
        })
    except Exception as exc:                                  # noqa: BLE001
        # refuse()도 원장에 쓴다 — 여기서 부르면 같은 이유로 다시 죽어 **크래시**가 된다.
        # 기록할 수 없는 상황이므로 기록 없이, 그러나 **실행 없이** 조용히 거부한다.
        print("원장에 쓸 수 없다(%s) — 실행하지 않는다(fail-closed)." % exc, file=sys.stderr)
        return {"ok": False, "reason": "ledger_unwritable",
                "refusal_text": REFUSAL_TEXT["ledger_unwritable"],
                "proposal_id": proposal_id, "mode": MODE_APPLY, "results": []}

    results = []
    outcome = OUTCOME_SUCCESS
    for command in commands:
        result = _run_one(command, timeout)
        results.append(result)
        if result["rc"] != 0:
            # 부분 실패에서 멈춘다. 뒤 명령을 계속 돌리면 "앞이 실패한 상태에서 뒤를
            # 실행한" 결과가 남고, 그건 런북이 기술한 절차가 아니다.
            outcome = OUTCOME_FAILURE
            break

    # 결과 기록이 실패해도 **실행은 이미 일어났다** — 예외를 그대로 올리면 rc=1이 되어
    # "실행 실패"로 오독된다. 완성된 이벤트를 stderr에 뱉고 전용 종료코드로 구분한다.
    _payload = {
        "event": "execution", "proposal_id": proposal_id, "mode": MODE_APPLY,
        "outcome": outcome, "approver": current_approver(),
        "approved_by": (st["approved"] or {}).get("approver"),
        "approved_at": (st["approved"] or {}).get("ts"),
        "runbook_id": runbook.id, "action_id": action.id,
        "runbook_sha256": proposal.get("runbook_sha256"),
        "action_sha256": proposal.get("action_sha256"),
        "risk": action.risk, "tier": runbook.tier,
        "results": results, "timeout_sec": timeout,
        "rollback": rollback,
        "rollback_declared": bool(proposal.get("rollback_declared")),
        "ts": _stamp(when),
    }
    try:
        event = ledger.append(_payload)
    except Exception as exc:                                  # noqa: BLE001
        print("실행됐으나 원장 기록 실패(%s) — 아래 줄을 원장에 수동 추가하라:" % exc,
              file=sys.stderr)
        print(json.dumps(_payload, ensure_ascii=False), file=sys.stderr)
        return {"ok": False, "reason": "executed_unrecorded", "proposal_id": proposal_id,
                "mode": MODE_APPLY, "results": results, "event": _payload,
                "exit_code": EXIT_UNRECORDED}
    return {"ok": outcome == OUTCOME_SUCCESS, "reason": outcome,
            "proposal_id": proposal_id, "mode": MODE_APPLY, "results": results,
            "rollback": rollback, "event": event}


# ══════════════════════════════════════════════════════════════════════════════
# 9. 렌더링
# ══════════════════════════════════════════════════════════════════════════════


def render_execution(result):
    lines = []
    if result.get("mode") == MODE_DRYRUN and result.get("ok"):
        lines.append("DRY-RUN — 아무것도 실행하지 않았다. 실행하려면 --apply 를 붙여라.")
        for command in result.get("would_run") or []:
            lines.append("    $ %s" % command)
        lines.append("롤백: %s" % result.get("rollback"))
        return "\n".join(lines)
    if not result.get("ok") and result.get("reason") in REFUSAL_TEXT:
        return "거부 — %s (%s)" % (REFUSAL_TEXT[result["reason"]], result["reason"])
    for item in result.get("results") or []:
        lines.append("$ %s" % item["command"])
        lines.append("  rc=%s  %dms%s" % (
            item["rc"], item["duration_ms"], "  ⏱ TIMEOUT" if item["timed_out"] else ""))
        for stream in ("stdout_tail", "stderr_tail"):
            if item.get(stream):
                lines.append("  %s: %s" % (stream[:6], item[stream].strip()[:400]))
    if result.get("reason") == OUTCOME_FAILURE:
        lines.append("실패 — 자동 롤백은 하지 않는다(L3 소관). 롤백 안내: %s"
                     % result.get("rollback"))
    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# 10. CLI — 승인 경로는 **서버 셸**이다(ADR-0026: Slack 버튼 미채택)
# ══════════════════════════════════════════════════════════════════════════════


def _build_parser():
    p = argparse.ArgumentParser(
        prog="remediation_l2",
        description="L2 승인 후 실행 — 제안 등록·승인·결정론 실행·감사 원장",
        epilog="명령 문자열을 인자로 받는 옵션은 **없다**. 실행할 명령은 런북 파일에서만 온다.",
    )
    p.add_argument("--ledger", default=None, help="감사 원장 경로(기본: %s)" % DEFAULT_LEDGER)
    p.add_argument("--runbooks", default=None, help="런북 디렉터리(기본: 레포 docs/runbooks)")
    p.add_argument("--json", action="store_true", help="결과 JSON 출력")
    sub = p.add_subparsers(dest="cmd")

    sp = sub.add_parser("propose", help="L1 제안을 만들어 원장에 등록한다")
    sp.add_argument("--alert", default="", help="alertname")
    sp.add_argument("--node", default="", help="노드")
    sp.add_argument("--service", default="", help="서비스")
    sp.add_argument("--severity", default="", help="심각도")
    sp.add_argument("--summary", default="", help="요약")
    sp.add_argument("--no-llm", action="store_true", help="모델 미사용(결정론 경로만)")
    sp.add_argument("--vllm-url", default=None)
    sp.add_argument("--vllm-model", default=None)

    sub.add_parser("list", help="제안 목록").add_argument(
        "--all", action="store_true", help="부적격·만료 포함")
    sub.add_parser("show", help="제안 상세 + 승인 카드").add_argument("proposal_id")

    ap = sub.add_parser("approve", help="승인(기본 dry-run) — --apply 로 실제 실행")
    ap.add_argument("proposal_id")
    ap.add_argument("--apply", action="store_true",
                    help="실제로 실행한다(기본은 dry-run)")
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SEC)
    ap.add_argument("--note", default=None, help="승인 메모(원장에 남는다)")

    rp = sub.add_parser("reject", help="거부")
    rp.add_argument("proposal_id")
    rp.add_argument("--reason", default=None)

    sub.add_parser("ledger", help="원장 원문").add_argument(
        "--tail", type=int, default=20)
    return p


def _cmd_propose(args, ledger):
    corpus = l1.load_corpus(args.runbooks)
    for name, why in corpus.skipped:
        sys.stderr.write("WARN 런북 제외: %s — %s\n" % (name, why))
    llm = False if args.no_llm else l1.VllmClient(url=args.vllm_url, model=args.vllm_model)
    signal = {"alertname": args.alert, "node": args.node, "service": args.service,
              "severity": args.severity, "summary": args.summary}
    result = l1.propose(signal, corpus=corpus, llm=llm)
    if result["status"] != l1.STATUS_PROPOSAL:
        print(l1.render_reply(result))
        return None, 3
    event = register_proposal(result, signal=signal, ledger=ledger,
                              runbooks_root=args.runbooks)
    print(render_approval_card(event))
    return event, 0 if event.get("eligible") else 3


def _cmd_list(args, ledger):
    rows = []
    for proposal in ledger.proposals():
        st = ledger.state(proposal["proposal_id"])
        status = ("실행됨" if st["applied"] else
                  "거부됨" if st["rejected"] else
                  "승인됨" if st["approved"] else
                  "만료" if _expired(proposal) else "대기")
        if not args.all and (status in ("실행됨", "거부됨", "만료")
                             or not proposal.get("eligible")):
            continue
        rows.append({"proposal_id": proposal["proposal_id"], "status": status,
                     "runbook_id": proposal.get("runbook_id"),
                     "action_id": proposal.get("action_id"),
                     "risk": proposal.get("risk"), "node": proposal.get("node"),
                     "eligible": proposal.get("eligible"), "ts": proposal.get("ts")})
    if not args.json:
        for r in rows:
            print("%(proposal_id)s  %(status)-6s  %(runbook_id)s/%(action_id)s  "
                  "risk=%(risk)s node=%(node)s  %(ts)s" % r)
        if not rows:
            print("대기 중인 제안 없음")
    return rows, 0


def _cmd_show(args, ledger):
    st = ledger.state(args.proposal_id)
    if st["proposal"] is None:
        print("그런 제안이 없다: %s" % args.proposal_id, file=sys.stderr)
        return None, 3
    if not args.json:
        print(render_approval_card(st["proposal"]))
        for event in st["events"]:
            print("  · %s %s %s" % (event.get("ts"), event.get("event"),
                                    event.get("outcome") or event.get("approver") or ""))
    return st, 0


def main(argv=None):
    args = _build_parser().parse_args(argv)
    if not getattr(args, "cmd", None):
        _build_parser().print_help()
        return 1
    ledger = Ledger(args.ledger)
    payload, code = None, 0

    if args.cmd == "propose":
        payload, code = _cmd_propose(args, ledger)
    elif args.cmd == "list":
        payload, code = _cmd_list(args, ledger)
    elif args.cmd == "show":
        payload, code = _cmd_show(args, ledger)
    elif args.cmd == "reject":
        payload = reject(args.proposal_id, ledger=ledger, reason=args.reason)
        code = 0 if payload["ok"] else 3
        if not args.json:
            print("거부 기록됨" if payload["ok"] else "거부 실패 — %s" % payload["text"])
    elif args.cmd == "approve":
        decision = approve(args.proposal_id, ledger=ledger, note=args.note)
        if not decision["ok"]:
            if not args.json:
                print("승인 거부 — %s" % decision["text"], file=sys.stderr)
            payload, code = decision, 3
        else:
            payload = execute_approved(args.proposal_id, ledger=ledger,
                                       apply=args.apply, runbooks_root=args.runbooks,
                                       timeout=args.timeout)
            if not args.json:
                print(render_execution(payload))
            code = 0 if payload["ok"] else (
                4 if payload.get("reason") == OUTCOME_FAILURE else 3)
    elif args.cmd == "ledger":
        events = ledger.events()[-args.tail:]
        payload = events
        if not args.json:
            for event in events:
                print(json.dumps(event, ensure_ascii=False, sort_keys=True))

    if args.json and payload is not None:
        print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
    return code


if __name__ == "__main__":
    sys.exit(main())

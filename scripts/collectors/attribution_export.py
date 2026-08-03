#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T-E4-3 — Slack 반출본을 만드는 **유일한** 경로 (specs/alert-enrichment §4.1·§4.2 D4-2).

왜 파일이 따로인가:
    §4.1은 "원문 명령어·전체 파일 경로는 Slack에 나가지 않는다"를 불변으로 둔다.
    그 불변을 사람의 주의력에 맡기지 않으려면 **반출이 지나가는 문이 하나**여야 하고,
    그 문을 게이트가 통째로 검사할 수 있어야 한다(AC-E4-3·AC-E4-6).
    이 모듈이 그 문이다. 여기에는 원문을 담는 `raw` 키를 읽는 코드가 **없다** —
    입력은 attribution_lib.public_view() 를 통과한 값뿐이라고 가정하고,
    그 가정이 깨져도 마지막에 정규식이 다시 막는다(이중 방어).

반출 상한(§4.1-1): 계정명 · 시각 · 크기 델타 · 카테고리 · 로컬 LLM의 "~로 보인다" 요약.
반출 금지: 전체 파일 경로 · sudo COMMAND 원문 · 홈 하위 디렉터리 이름.

이 모듈이 **못** 막는 것(정직하게):
    · 계정명 자체. 그건 이 기능의 존재 이유라 상한으로 명문화한 것이다(§4.5).
    · 카테고리·용량 조합으로 하는 역추론("1.1G Python 환경 2개" → 어떤 패키지인지 짐작).
      경로를 안 주므로 확정은 못 하지만 0은 아니다.
    · Slack 채널 자체의 접근 통제. 운영자 전용 채널이라는 전제 위에 서 있다.

세탁 규칙은 **여기에 없다** [2026-08-04 적대적 검증]:
    같은 위협을 E3 relay 도 막아야 하는데 방어가 두 벌이면 한쪽만 고쳐지고 그 비대칭이
    곧 사고다. 그래서 정규식·허용목록·하드 거부는 `infra/alert-relay/keiwi_redaction.py`
    **한 곳**에 있고 relay 와 이 모듈이 **같은 객체**를 쓴다(복제 금지).
    아래 이름들은 그 모듈의 재수출이다 — 게이트·테스트가 `export.HARD_DENY` 로 참조한다.
"""

from __future__ import annotations

import os
import sys


def _load_shared_redaction():
    """공유 세탁 모듈을 찾아 import 한다 — 레포 배치와 배포 배치가 다르기 때문이다.

    · 레포:  scripts/collectors/ → <root>/infra/alert-relay/keiwi_redaction.py
    · 배포:  /opt/keiwi/alert-relay/collectors/ → /opt/keiwi/alert-relay/keiwi_redaction.py
             (README 설치 절차가 두 파일을 그 배치로 깐다)
    찾지 못하면 **조용히 약한 폴백을 쓰지 않고 죽는다** — 세탁이 없는 반출 경로가
    존재하는 것보다 수집기가 안 뜨는 편이 안전하다(fail-closed).
    """
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(os.path.dirname(here))
    candidates = [
        here,                                       # 같은 디렉터리에 깐 경우
        os.path.dirname(here),                      # 배포: collectors/ 의 부모
        os.path.join(root, "infra", "alert-relay"),  # 레포
    ]
    for path in candidates:
        if os.path.isfile(os.path.join(path, "keiwi_redaction.py")):
            if path not in sys.path:
                sys.path.insert(0, path)
            break
    import keiwi_redaction  # noqa: E402 — 경로 확정 후 import
    return keiwi_redaction


_R = _load_shared_redaction()

# 공유 방어의 재수출(= 이 모듈에 **사본이 없다**는 사실의 코드적 표현).
# 허용 호스트 목록은 일부러 재수출하지 않는다 — env·set_allowed_url_hosts() 로 바뀌므로
# 여기서 스냅샷을 뜨면 "표시된 값"과 "판정에 쓰이는 값"이 갈린다. 판정은 항상 _R 이 한다.
HARD_DENY = _R.HARD_DENY
RedactionError = _R.RedactionError
redact_text = _R.redact_text
assert_no_leak = _R.assert_no_leak
_url_allowed = _R.url_allowed


# ── 표시 헬퍼 ─────────────────────────────────────────────────────────────────
def _h(nbytes) -> str:
    try:
        n = float(nbytes)
    except (TypeError, ValueError):
        return "?"
    for unit in ("B", "K", "M", "G", "T"):
        if abs(n) < 1024.0 or unit == "T":
            return "%dB" % int(n) if unit == "B" else "%.1f%s" % (n, unit)
        n /= 1024.0
    return "%.1fT" % n


def _hhmm(mtime: str) -> str:
    """`2026-08-03T17:45` → `17:45`. 형식이 다르면 원문 그대로(경로가 아니라 안전)."""
    if not mtime:
        return "?"
    if "T" in mtime:
        return mtime.split("T", 1)[1][:5]
    return mtime[:16]


def _mount_label(mount: str) -> str:
    """마운트 표기는 1단계까지만 허용한다(`/`·`/home`·`/data`)."""
    if not mount:
        return "?"
    parts = [p for p in mount.split("/") if p]
    return "/" if not parts else "/" + parts[0]


# ── 반출본 조립 (spec §4.2 D4-2 스레드 답글 #1) ───────────────────────────────
def build_slack_text(public_report: dict, intent_summary: str = None,
                     console_url: str = None) -> str:
    """공개 리포트(+선택적 LLM 요약) → Slack 메시지 문자열.

    **Slack 으로 나가는 모든 문자열은 이 함수를 통과한다.** 다른 경로는 없다.
    intent_summary 가 None 이어도(vLLM 정지·타임아웃) 결정적 본문만으로 성립한다 —
    그게 AC-E4-4 의 계약이고, 알림 품질이 LLM 가용성에 의존하지 않게 하는 장치다.
    """
    node = str(public_report.get("node", "?"))
    mount = _mount_label(str(public_report.get("mount", "/")))
    usage = public_report.get("usage_pct")
    minutes = int((public_report.get("window") or {}).get("minutes", 360) or 360)
    hours = minutes / 60.0
    win = ("%dh" % hours) if hours == int(hours) else ("%dm" % minutes)

    lines = ["📎 디스크 귀속(자동 수집, read-only) — %s %s" % (node, mount)]

    head = "현재 %s" % ("%.1f%%" % usage if isinstance(usage, (int, float)) else "사용률 미상")
    home_line = _home_breakdown(public_report)
    if home_line:
        head += " · " + home_line
    lines.append(head)

    # 시각 표기는 **노드 로컬**이다. data04=KST·data03/05=UTC 로 플릿이 균일하지 않으므로
    # 오프셋을 함께 적지 않으면 사람이 9시간을 잘못 읽는다 [실측 2026-08-03].
    tzoff = str((public_report.get("window") or {}).get("tz_offset", "") or "")
    tzlab = (" UTC%s%s" % (tzoff[0], tzoff[1:3].lstrip("0") or "0")) if len(tzoff) >= 3 else ""

    groups = public_report.get("recent_groups") or []
    if groups:
        lines.append("최근 %s 변경된 대형 파일(소유·카테고리별, 시각은 노드 로컬%s):" % (win, tzlab))
        for g in groups[:3]:
            lines.append("  · %s ×%d, 합 %s (소유 %s, %s~%s)" % (
                g.get("category", "?"), int(g.get("count", 0) or 0),
                _h(g.get("bytes")), g.get("owner", "?"),
                _hhmm(g.get("first_mtime", "")), _hhmm(g.get("last_mtime", ""))))
    else:
        lines.append("최근 %s 변경된 대형 파일: 없음 — 급증 원인이 최근 파일 생성이 아닐 수 있다"
                     % win)

    sudo_n = len(public_report.get("sudo_commands") or [])
    lines.append("sudo 이력 %d건(시간창 내) · 근거: 파일 증거 + sudo 로그" % sudo_n)

    if intent_summary:
        # 이중 게이트 — 모델이 지시를 어겨도 여기서 지운다.
        lines.append("추정: " + redact_text(intent_summary))

    if public_report.get("partial"):
        reasons = [redact_text(str(r)) for r in (public_report.get("partial_reasons") or [])]
        lines.append("⚠️ 부분 수집(partial): " + " · ".join(reasons[:3]))

    limits = [redact_text(str(x)) for x in (public_report.get("limits") or [])]
    if limits:
        lines.append("한계: " + " · ".join(limits[:2]))

    if console_url and _url_allowed(console_url):
        lines.append("상세(원문은 data05·콘솔에만) → <%s|콘솔 분석>" % console_url)
    else:
        lines.append("상세(원문은 data05·콘솔에만) — Slack에는 카테고리까지만 나간다")

    text = "\n".join(lines)
    return assert_no_leak(text)


def _home_breakdown(public_report: dict) -> str:
    """`/home 303G (user2 134G · user5 76G · user6 30G)` — 계정명+용량만."""
    dirs = public_report.get("top_dirs") or []
    total = None
    users = []
    for d in dirs:
        if d.get("path_category") == "/home" and total is None:
            total = d.get("bytes")
        elif d.get("path_category") == "사용자 홈" and d.get("owner"):
            users.append((d["owner"], d.get("bytes", 0), d.get("delta_bytes")))
    if total is None and not users:
        return ""
    users.sort(key=lambda t: -(t[1] or 0))
    frag = []
    for owner, size, delta in users[:4]:
        piece = "%s %s" % (owner, _h(size))
        if isinstance(delta, (int, float)) and delta:
            piece += " (%s%s)" % ("+" if delta > 0 else "", _h(delta))
        frag.append(piece)
    out = "/home %s" % _h(total) if total is not None else "/home"
    if frag:
        out += " (" + " · ".join(frag) + ")"
    return out

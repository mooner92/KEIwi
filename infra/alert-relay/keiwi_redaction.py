#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""반출 세탁 — **E3 relay 와 E4 수집기가 공유하는 단 하나의 방어** (spec §4.1).

왜 이 파일이 생겼나 [2026-08-04 적대적 검증]
-------------------------------------------
같은 위협(원문 경로·명령이 Slack으로 새는 것)에 대해 방어가 **두 벌**이었다:

* E4 ``scripts/collectors/attribution_export.py`` — URL 호스트 허용목록 + ``~/`` 처리 +
  허용목록 없는 절대경로 전면 삭제 + ``assert_no_leak`` 하드 거부(게시 중단).
* E3 ``infra/alert-relay/alert_relay.py`` — 정규식 치환만. 실증된 구멍 4종:

  1. **URL stash 우회** — URL을 통째로 빼돌린 뒤 호스트 검사 없이 원문 복원.
     ``http://attacker.invalid/exfil?p=/home/user2/patient-data/x.csv`` 가 그대로 통과했다.
  2. **``~/`` 미처리** — 부정 lookbehind ``(?<![\\w~])`` 가 오히려 ``~/…`` 를 제외했다.
     LLM이 홈 경로를 ``~/`` 로 줄여 쓰는 것은 매우 흔하다.
  3. **허용목록 밖 절대경로** — ``home|root|data|mnt|srv|export|opt`` 만 봐서
     ``/var/log/private/…`` · ``/scratch/…`` · ``/nfs/home/…`` 가 통과했다.
  4. **하드 거부 부재** — 놓치면 조용히 나갔다(E4는 예외로 게시를 멈춘다).

위협 모델이 같으면 방어도 같아야 한다. 그래서 **복제가 아니라 공유**로 합쳤다 —
두 곳이 각자 정규식을 들고 있으면 다음 사람이 한쪽만 고치고, 그 비대칭이 곧 사고다.

도달 가능성은 이론이 아니다: relay의 ``render_assistant_reply`` 는 LLM 원출력을 가공 없이
본문에 넣고, 그 프롬프트 근거에는 전체 경로가 들어간다.

방어 4층 (순서가 곧 설계다)
--------------------------
1. ``public_view``/``drop_local_only_fields`` — ``raw`` 키를 경계에서 제거(구조).
2. :func:`redact_text` — 자유 텍스트(특히 LLM 출력) 세탁(결정적 정규식).
3. :func:`url_allowed` — 링크는 **허용 호스트**만. 그 외는 통째로 삭제.
4. :func:`assert_no_leak` — 게시 **직전** 하드 규칙. 위반이면 :class:`RedactionError` 로
   멈춘다. 조용히 통과시키지 않는 것이 요점이다.

이 모듈이 **못** 막는 것 (정직하게)
----------------------------------
* 경로를 풀어 쓴 자연어("사용자 홈 아래 텐서플로 디렉터리"). 프롬프트 계약 몫이다.
* 상대 경로(``./venv/lib/…``·``venv/lib``). 수집기가 절대 경로만 낸다는 계약에 기댄다.
* 계정명 자체 — 이 기능의 존재 이유라 §4.1이 상한으로 허용한 것이다.
* 카테고리+용량 조합의 역추론. 경로를 안 주므로 확정은 못 하지만 0은 아니다.
* IPv6 리터럴 호스트(``http://[::1]/``). 허용목록에 없으면 어차피 삭제되므로
  실패 방향은 안전(fail-closed)하지만, **허용**하려면 이 파서를 고쳐야 한다.

의존성: Python 3 stdlib **전용**(relay의 pip 0개 계약 — spec §3.3).
"""

from __future__ import annotations

import os
import re

# ── 링크 허용 호스트 ──────────────────────────────────────────────────────────
# 여기 없는 URL은 통째로 지운다 — LLM이 지어낸 링크나 원문 경로가 URL 모양으로
# 새는 것을 막는 유일한 수단이다(구멍 ①의 정본 방어).
#
# 기본값은 **내부 엔드포인트**다. RFC1918 사설 IP는 외부에서 라우팅되지 않으므로
# 레포가 공개돼도 공격 표면이 되지 않는다. 외부 도메인은 기본값에 두지 않는다.
#   :3106 = 콘솔 · :3000 = Grafana · github.com = 런북(공개 레포 문서)
# 배포에서 바꾸려면 env `KEIWI_ALLOWED_URL_HOSTS`(쉼표 구분) 또는
# relay의 `RELAY_ALLOWED_URL_HOSTS`(Config가 :func:`set_allowed_url_hosts` 로 주입).
DEFAULT_ALLOWED_URL_HOSTS = ("192.168.1.105:3106", "192.168.1.105:3000", "github.com")


def _parse_hosts(value):
    return tuple(h.strip().lower() for h in str(value or "").split(",") if h.strip())


ALLOWED_URL_HOSTS = _parse_hosts(
    os.environ.get("KEIWI_ALLOWED_URL_HOSTS")
) or DEFAULT_ALLOWED_URL_HOSTS


def set_allowed_url_hosts(value):
    """허용 호스트를 프로세스 전역으로 교체한다(빈 값이면 기본값 유지).

    전역인 것은 **의도**다 — 반출 정책이 호출부마다 다르면 그 자체가 구멍이다.
    설정은 기동 시 1회(relay ``Config``) 또는 테스트에서만 만진다.
    """
    global ALLOWED_URL_HOSTS
    hosts = _parse_hosts(value)
    if hosts:
        ALLOWED_URL_HOSTS = hosts
    return ALLOWED_URL_HOSTS


# ── 하드 거부 (AC-E4-3) ───────────────────────────────────────────────────────
# 최종 문자열에 하나라도 걸리면 **게시하지 않는다**. 정규식 치환을 뚫고 살아남은
# 무언가가 있다는 뜻이고, 그때 필요한 것은 "조용한 통과"가 아니라 "멈춤"이다.
HARD_DENY = (
    (re.compile(r"/home/[^/\s]+/"), "사용자 홈 하위 전체 경로"),
    (re.compile(r"/root/"), "root 홈 경로"),
    (re.compile(r"/data/alert-relay/"), "수집기 로컬 저장소 경로"),
    (re.compile(r"COMMAND="), "sudo COMMAND 원문"),
    (re.compile(r"\bPWD=|\bCWD=|\bTTY=pts|\bUSER=root\b"), "sudo 로그 원문 조각"),
    (re.compile(r"(?:~[A-Za-z0-9._-]*|\$\{?HOME\}?|%HOME%)/\S"), "홈 상대 경로(~/ · $HOME/ · ~user/)"),
)

# ── 세탁 규칙 ─────────────────────────────────────────────────────────────────
# URL은 먼저 떼어내고 **호스트를 검사한 뒤** 되돌린다. 떼어내기만 하고 검사를 안 하면
# URL이 곧 우회로가 된다(구멍 ①). Slack mrkdwn `<url|라벨>` 때문에 `|`·`<`·`>` 제외.
_URL_RE = re.compile(r"https?://[^\s<>|]+")
_URL_HOST_RE = re.compile(r"https?://([^/?#\s]+)")

# `COMMAND=` 는 **줄 끝까지** 지운다. 토큰만 지우면 인자(= 경로와 패키지명)가 남는다.
_SUDO_COMMAND_RE = re.compile(r"\bCOMMAND=[^\n]*")
_SUDO_FRAGMENT_RE = re.compile(r"\b(?:PWD|CWD|TTY|USER|LOGNAME)=\S*")

# `~/…` — 공백까지 통째로. 문자 클래스를 좁게 잡으면 비ASCII 홈 경로(`~/자료/…`)가
# 반쯤 남아 하드 거부에 걸린다. 넓게 잡는 편이 실패 방향이 안전하다.
_TILDE_PATH_RE = re.compile(r"(?:~[A-Za-z0-9._-]*|\$\{?HOME\}?|%HOME%)/\S*")
# ~/ 만 막으면 $HOME/ · ~user2/ · %HOME%/ 가 그대로 나간다 — LLM 출력에서 셋 다 흔하다.
# 실증 2026-08-04: 셋 다 원문 통과했고 HARD_DENY도 몰라 fail-open이었다.

# 2단계 이상 절대경로는 **허용목록 없이 전부** 지운다(구멍 ③).
# 1단계(`/`·`/home`·`/data`)는 남긴다 — 스레드 답글이 "어느 마운트인가"를 말하지
# 못하면 쓸모가 없기 때문이다(§4.1의 반출 상한 안).
# 세그먼트 문자 클래스는 "구분자가 아닌 모든 것" — 비ASCII 경로도 잡는다.
_PATH_SEG = r"[^\s/<>|,;)\]\"'`]+"
_DEEP_PATH_RE = re.compile(r"(?<![\w/~])(?:/%s){2,}/?" % _PATH_SEG)

LINK_REMOVED = "[링크 삭제]"
PATH_REMOVED = "[경로 삭제]"
COMMAND_REMOVED = "[원문 삭제]"


class RedactionError(RuntimeError):
    """반출 직전 하드 규칙 위반 — 게시하지 않는다(조용히 흘려보내지 않는다)."""


def url_allowed(url):
    """허용 호스트인가 + 링크 자체가 하드 규칙을 어기지 않는가.

    호스트는 **포트까지 포함해** 비교한다. 허용목록에 포트가 있으면 그 포트만 통과한다 —
    같은 IP의 다른 포트가 자동으로 열리지 않게 하는 것이 요점이다.
    """
    match = _URL_HOST_RE.match(url or "")
    if not match:
        return False
    netloc = match.group(1).lower().split("@")[-1]   # userinfo 제거
    bare = netloc
    if netloc.count(":") == 1 and netloc.rsplit(":", 1)[1].isdigit():
        bare = netloc.rsplit(":", 1)[0]
    allowed = ALLOWED_URL_HOSTS
    if netloc not in allowed and bare not in allowed:
        return False
    # 허용 호스트라도 쿼리·경로에 원문이 실려 나가면 안 된다(딥링크가 반출로 둔갑).
    for pattern, _label in HARD_DENY:
        if pattern.search(url):
            return False
    return True


def redact_text(text, on_link_drop=None):
    """자유 텍스트에서 경로·명령 원문을 지운다. 링크는 허용 호스트만 보존한다.

    LLM 출력에 다시 적용하는 것이 이중 게이트의 두 번째 문이다(§4.2 D4-2-3):
    프롬프트가 "경로를 인용하지 마라"라고 해도 모델은 지시를 어길 수 있고,
    그 실패가 프라이버시 사고가 되게 두지 않는다.

    ``on_link_drop(url)`` 은 링크가 삭제될 때 호출된다 — 배선 실수로 딥링크가 통째로
    사라지는 것을 **조용히** 넘기지 않기 위한 훅이다(relay가 WARNING 로그로 쓴다).
    """
    if not text:
        return ""
    text = str(text)

    chunks = []
    last = 0
    for match in _URL_RE.finditer(text):
        chunks.append(("text", text[last:match.start()]))
        chunks.append(("url", match.group(0)))
        last = match.end()
    chunks.append(("text", text[last:]))

    out = []
    for kind, chunk in chunks:
        if kind == "url":
            if url_allowed(chunk):
                out.append(chunk)
            else:
                if on_link_drop is not None:
                    on_link_drop(chunk)
                out.append(LINK_REMOVED)
            continue
        chunk = _SUDO_COMMAND_RE.sub(COMMAND_REMOVED, chunk)
        chunk = _SUDO_FRAGMENT_RE.sub(COMMAND_REMOVED, chunk)
        chunk = _TILDE_PATH_RE.sub(PATH_REMOVED, chunk)
        chunk = _DEEP_PATH_RE.sub(PATH_REMOVED, chunk)
        out.append(chunk)
    return "".join(out)


def assert_no_leak(text):
    """게시 직전 마지막 문지기. 위반이면 :class:`RedactionError` — 게시하지 않는다."""
    for pattern, label in HARD_DENY:
        found = pattern.search(text or "")
        if found:
            raise RedactionError("반출 차단: %s 가 payload 에 있다 (%r)" % (label, found.group(0)))
    return text

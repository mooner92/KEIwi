#!/usr/bin/env python3
"""alert-relay — Grafana webhook → Slack 스레드 게시 + 비동기 보강 답글.

정본: ``specs/alert-enrichment/spec.md`` §3 (E3) · ``tasks.md`` T-E3-1·T-E3-2·T-E3-4.

왜 중계인가
-----------
Grafana 13 Slack 알림기에 ``thread_ts``가 없다(실측 ``/api/alert-notifiers``).
그런데 **중계가 원 메시지를 직접 게시하면 응답으로 ``ts``를 쥔다** — 같은 bot token으로
``chat.postMessage``에 ``thread_ts``만 넘기면 스레드 답글이 되고 추가 스코프도 필요 없다.
이 구조 하나로 ① 스레딩 ② LLM 분석 답글 ③ 귀속 답글 ④ 발생→해결 한 스레드가 풀린다.

불변 제약 (헌장 · spec §3.2)
---------------------------
1. **동기 경로에 LLM이 없다.** 서명 검증 → 즉시 ``chat.postMessage`` → sqlite 저장 →
   Grafana에 200. vLLM이 죽어 있어도 1차 전달은 무손실이다(AC-E3-2).
2. **메시지 포맷의 정본은 E1 템플릿 한 곳**이다. 기본 게시는 webhook payload의
   렌더된 ``title``/``message``를 **그대로** 쓴다 — 여기서 다시 조립하지 않는다.
3. **조치를 자동 적용하지 않는다.** 수집은 read-only, LLM은 단발 해석, 출력은 링크와
   근거 번호까지다. 자율 ReAct 루프를 만들지 않는다(spec §3.7).
4. **반출 상한**(spec §4.1): 계정명·시각·크기·카테고리·요약까지. 원문 명령·전체 경로는
   나가지 않는다. Slack으로 나가는 **유일한 경로가 :func:`build_slack_payload`** 이고,
   수집기 JSON의 로컬 전용 필드(``raw``)는 :func:`drop_local_only_fields` 가 경계에서
   제거해 렌더러에 **도달조차 하지 않는다**(AC-E4-6).
   세탁 규칙 자체는 E4와 **공유**한다(``keiwi_redaction``) — 같은 위협에 방어가 두 벌이면
   한쪽만 고쳐지고 그 비대칭이 곧 사고다 [2026-08-04 적대적 검증].
5. **저장 실패가 전달 실패도 도배도 되지 않는다.** sqlite가 죽어도(디스크 풀 —
   하필 이 relay의 주 용도가 DiskUsageHigh다) 게시는 되고, Grafana는 200을 받고,
   같은 배달은 :class:`DeliveryLedger` 가 두 번 게시하지 않는다(§"멱등" 주석 참조).

의존성
------
Python 3 stdlib **전용** + 같은 레포의 ``keiwi_redaction``(역시 stdlib 전용).
pip 0개 — egress 최소·감사 용이·1인 유지보수(spec §3.3).

이 모듈이 **하지 않는** 것 (정직하게)
-----------------------------------
* 수집기(``scripts/collectors/disk-attribution.sh``)를 만들지 않는다. E4 소관이다.
  없으면 답글 #1을 **우아하게 생략**한다(경로·스키마만 계약으로 잡는다).
* 알림 규칙·라우팅을 바꾸지 않는다. 프로비저닝은 사람이 복사한다(§11·§12).
* 실패한 어시스턴트를 Slack에 보고하지 않는다 — 도배 금지, relay 로그에만 남긴다.
"""

import collections
import hashlib
import hmac
import json
import logging
import os
import queue
import re
import sqlite3
import subprocess  # nosec B404 — 수집기(E4) 실행 전용. shell=False·인자 배열·타임아웃.
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# 같은 디렉터리의 공유 세탁 모듈. 배포도 이 배치를 그대로 깐다
# (`/opt/keiwi/alert-relay/{alert_relay,keiwi_redaction}.py` — README 설치 절차).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import keiwi_redaction  # noqa: E402 — 경로 확정 후 import

VERSION = "1.1.0"
LOG = logging.getLogger("alert-relay")

KST = timezone(timedelta(hours=9))

# Slack ``text``의 상한은 40000자지만, 그만큼 긴 알림은 읽히지 않는다.
# 스레드 답글은 "요약"이라는 계약이므로 짧게 자른다(§4.1 반출 상한과 같은 방향).
MAX_TEXT = 2800

# 요청 본문 상한 — Grafana webhook payload는 수십 KB다. 1MB면 넉넉하고,
# 상한이 없으면 메모리 고갈이 곧 알림 경로 장애가 된다.
MAX_BODY = 1024 * 1024

# 귀속 수집(E4)을 붙일 알림. 다른 알림은 답글 #1 없이 어시스턴트 답글만 간다.
DISK_ALERTS = ("DiskUsageHigh", "DiskFillPredicted")

# 수집기 JSON에서 **Slack 반출 금지**인 로컬 전용 필드(spec §4.2 D4-1).
# 이름으로 재귀 제거한다 — 렌더러가 실수로 참조할 수조차 없게 만드는 것이 요점이다.
LOCAL_ONLY_FIELDS = ("raw",)

# 노드 정적 맵 — docs/inventory.yaml(플릿 단일 기준)의 5노드.
# hardware-ops T2-2(스크레이프 라벨 `node: dataNN`)가 적용되면 이 맵은 사라질 수 있다.
# 그때 단순화한다 — 재정의하지 않고 관찰만 한다(spec §5 열린 질문 4).
NODE_BY_IP = {
    "192.168.1.101": "data01",
    "192.168.1.102": "data02",
    "192.168.1.103": "data03",
    "192.168.1.104": "data04",
    "192.168.1.105": "data05",
}
_NODE_ID_RE = re.compile(r"^data\d{2}$")

# 알림별 어시스턴트 프리셋 질문.
# ⚠️ **콘솔 `apps/console/src/lib/alert-presets.ts`와 키 집합이 같아야 한다** —
#    딥링크(E2)로 도착한 사람과 스레드 답글(E3)이 같은 질문을 받아야 답이 갈리지 않는다.
#    이 정합은 게이트가 기계로 판정한다(scripts/gates/check-alert-relay.sh · P2).
PRESET_QUESTIONS = {
    "NodeDown": "{node} 응답 중단(node-exporter 다운) 직전의 로그에서 원인 후보를 찾아줘",
    "LogIngestStalled": (
        "통합 로그 인입이 중단됐다. 로그 파이프라인(filebeat·logstash·opensearch) 관련 "
        "최근 에러를 찾아줘"
    ),
    "DiskUsageHigh": "최근 6시간 {node} {mount} 디스크 사용 급증의 원인 후보를 로그에서 찾아줘",
    "GpuTempHigh": "{node} GPU 과열 시점 전후의 GPU 관련 로그를 분석해줘",
    "MemoryLow": "{node} 가용 메모리 급감 시점 전후의 로그에서 원인 프로세스 후보를 찾아줘",
    "GpuXidErrorNew": "{node} GPU 하드웨어 에러(XID) 발생 전후의 GPU·커널 로그를 분석해줘",
    "OomKillOccurred": "{node} OOM kill 발생 전후의 로그에서 어떤 프로세스가 죽었는지 찾아줘",
    "SmartHealthFailed": "{node} 디스크 SMART 헬스 실패와 관련된 디스크 I/O·커널 로그를 찾아줘",
    "DiskFillPredicted": (
        "{node} {mount} 디스크가 현재 추세로 곧 가득 찬다. 최근 사용 급증의 원인 후보를 "
        "로그에서 찾아줘"
    ),
    "NodeHygieneCoverageGap": (
        "위생 수집기가 없는 노드가 있다. 수집기(node-hygiene) 배포·실행 관련 로그를 찾아줘"
    ),
    "NodeHygieneStale": "{node} 위생 수집기가 90분 이상 미실행이다. 타이머·수집기 실행 관련 로그를 찾아줘",
    "DiskGrownDefectsGrowing": "{node} 디스크 불량섹터가 늘고 있다. smartd·디스크 I/O 에러 로그를 찾아줘",
    "DiskUncorrectedErrorsGrowing": "{node} 디스크 미교정 I/O 오류 증가 전후의 커널·smartd 로그를 찾아줘",
    "PhysicalDiskDisappeared": "{node} 물리 디스크 인식 소실 전후의 커널·스토리지 컨트롤러 로그를 찾아줘",
}


# ══════════════════════════════════════════════════════════════════════════════
# 1. 순수 함수 — 테스트 대상의 대부분. I/O 없음.
# ══════════════════════════════════════════════════════════════════════════════

# 하드 거부에 걸렸을 때 **1차 전달 경로**가 쓰는 대체 본문. 알림 자체를 잃는 것보다
# "본문은 콘솔에서"가 낫다 — 전달 무손실(§3.2-1)과 반출 상한(§4.1)을 동시에 지키는 자리다.
LEAK_FALLBACK_TEXT = (
    "⚠️ 알림 본문이 반출 규칙을 위반해 **검열됐다**. 원인은 relay 로그에 있고, "
    "내용은 콘솔(Zero Trust 뒤)에서 확인하라. 알림 자체를 삼키지 않기 위해 이 줄만 게시한다."
)


def redact(text):
    """Slack으로 나가는 모든 문자열의 최종 관문 (spec §4.1 · AC-E4-3).

    **구현은 :mod:`keiwi_redaction` 에 있다** — E4 수집기(`attribution_export`)와 같은
    객체를 쓴다. 이 함수는 로깅만 얹은 얇은 위임이고, 여기에 정규식 사본을 다시 들이면
    그 순간 방어가 두 벌이 된다(그래서 이 파일에는 경로·명령 정규식이 없다).

    막는 것: URL 호스트 허용목록 · ``COMMAND=`` 줄 전체 · ``PWD/CWD/TTY/USER=`` ·
    ``~/…`` · **허용목록 없는** 2단계 이상 절대경로.
    못 막는 것(정직하게): 경로를 풀어 쓴 자연어 · 상대 경로. 모듈 docstring 참조.
    """
    if not text:
        return ""
    return keiwi_redaction.redact_text(text, on_link_drop=_warn_link_dropped)


def _warn_link_dropped(url):
    """허용 호스트가 아니어서 링크를 지웠다 — **조용히** 넘기지 않는다.

    딥링크가 통째로 사라지는 가장 흔한 원인은 공격이 아니라 배선 실수(콘솔 호스트 변경 후
    ``RELAY_ALLOWED_URL_HOSTS`` 미갱신)다. 로그가 없으면 그 실수를 몇 주 뒤에 안다.
    """
    LOG.warning(
        "링크 삭제(허용 호스트 아님): %s… — 허용목록=%s (env RELAY_ALLOWED_URL_HOSTS)",
        str(url)[:60], ",".join(keiwi_redaction.ALLOWED_URL_HOSTS),
    )


def build_slack_payload(channel, text, thread_ts=None, allow_fallback=False):
    """Slack **반출의 유일한 경로**. 여기 오지 않는 문자열은 Slack에 나가지 않는다.

    계약(spec §3.3 프라이버시 · AC-E4-3·AC-E4-6):
      · 모든 ``text``는 :func:`redact` 를 통과한다. 호출부가 잊을 수 있는 일을
        **구조적으로 통과시키지 않는다**.
      · 세탁 뒤에도 하드 규칙(``keiwi_redaction.HARD_DENY``)에 걸리면 **게시하지 않는다** —
        ``RedactionError`` 를 올린다. E4가 하는 것과 같은 처리다(정규식이 놓친 무언가가
        있다는 뜻이고, 그때 필요한 것은 조용한 통과가 아니라 멈춤이다).
      · 수집기 JSON의 ``raw``는 이 함수에 도달할 수 없다 —
        :func:`drop_local_only_fields` 가 경계에서 제거한다.
      · E4의 redaction 게이트가 검사하는 함수가 이것이다. 이름을 바꾸면 게이트도 함께 고친다.

    ``allow_fallback``: **1차 전달(최상위 게시·해결 답글) 전용**. 하드 거부가 걸려도
    알림을 삼키지 않고 :data:`LEAK_FALLBACK_TEXT` 로 대체한다. 보강 답글(#1·#2)은
    기본값(예외)을 쓴다 — 답글은 없어도 되지만 알림은 없으면 안 되기 때문이다.
    """
    safe = redact(text)[:MAX_TEXT]
    try:
        keiwi_redaction.assert_no_leak(safe)
    except keiwi_redaction.RedactionError as exc:
        if not allow_fallback:
            LOG.error("반출 차단 — 게시하지 않는다: %s", exc)
            raise
        LOG.error("반출 차단 — 본문을 대체하고 알림은 전달한다: %s", exc)
        safe = LEAK_FALLBACK_TEXT
    payload = {
        "channel": channel,
        "text": safe,
        # 링크 프리뷰를 끈다. Grafana·콘솔은 Zero Trust 뒤라 프리뷰가 뜨지도 않고,
        # unfurl 요청 자체가 불필요한 왕복이다.
        "unfurl_links": False,
        "unfurl_media": False,
    }
    if thread_ts:
        payload["thread_ts"] = thread_ts
    return payload


def drop_local_only_fields(obj):
    """수집기 JSON에서 로컬 전용 필드(``raw``)를 **재귀 제거**한 사본을 만든다.

    "렌더러가 raw를 참조하지 않는다"는 규율이 아니라 **구조**로 보장한다.
    규율은 다음 사람이 깨뜨리고, 구조는 안 깨진다(spec §4.1-2 · AC-E4-6).
    """
    if isinstance(obj, dict):
        return {
            k: drop_local_only_fields(v)
            for k, v in obj.items()
            if k not in LOCAL_ONLY_FIELDS
        }
    if isinstance(obj, list):
        return [drop_local_only_fields(v) for v in obj]
    return obj


def normalize_node(value):
    """``data04`` | ``192.168.1.104`` | ``192.168.1.104:9100`` → ``data04``.

    콘솔 ``fleet-node.ts``의 파이썬 짝. 미지 입력은 None — 판단은 호출부가 한다.
    """
    raw = (value or "").strip()
    if not raw:
        return None
    host = raw.split(":", 1)[0] if ":" in raw else raw
    if host in NODE_BY_IP:
        return NODE_BY_IP[host]
    if _NODE_ID_RE.match(host):
        return host
    return None


def preset_question(alertname, node=None, mount=None):
    """alertname → 어시스턴트 초기 질문. 콘솔 ``buildAlertQuestion``과 같은 계약."""
    template = PRESET_QUESTIONS.get(
        alertname, "{node} %s 알림 발생 시점 전후의 관련 로그에서 원인 후보를 찾아줘" % alertname
    )
    filled = template.replace("{node}", node or "").replace("{mount}", mount or "")
    return re.sub(r"\s+", " ", filled).strip()


def parse_rfc3339(value):
    """Grafana webhook의 ``startsAt``/``endsAt`` 파싱. 실패하면 None(추측하지 않는다)."""
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    # 나노초(9자리)를 파이썬이 못 읽는다 — 마이크로초로 자른다.
    text = re.sub(r"(\.\d{6})\d+", r"\1", text)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def kst_label(value, fmt="%m-%d %H:%M"):
    """ISO 시각 → KST 표기. 파싱 실패 시 원문 그대로(정보 손실보다 낫다)."""
    parsed = parse_rfc3339(value)
    if parsed is None:
        return str(value or "")
    return parsed.astimezone(KST).strftime(fmt)


def absolutize_window(url, starts_at, ends_at=None, lead_minutes=60, tail_minutes=30):
    """드릴다운 URL의 상대 시간창(``from=now-6h&to=now``)을 **절대 epoch ms**로 교체한다.

    이것이 relay만 할 수 있는 보강이다 — annotation은 발화 시점 1회 평가라 절대 창을
    만들 수 없다(spec §2.2 D2-1). 링크 구조(var-* 후보 3종)는 E2 annotation이 정본이고
    여기서는 시간창만 바꾼다. **URL을 새로 조립하지 않는 것**이 요점이다.
    """
    if not url:
        return None
    start = parse_rfc3339(starts_at)
    if start is None:
        return url
    end = parse_rfc3339(ends_at) or datetime.now(timezone.utc)
    if end < start:
        end = start
    frm = int((start - timedelta(minutes=lead_minutes)).timestamp() * 1000)
    to = int((end + timedelta(minutes=tail_minutes)).timestamp() * 1000)
    parts = urllib.parse.urlsplit(url)
    params = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    kept = [(k, v) for k, v in params if k not in ("from", "to")]
    kept.extend([("from", str(frm)), ("to", str(to))])
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(kept), parts.fragment)
    )


def absolute_from(starts_at, lead_minutes=60):
    """콘솔 ``ErrorContext.from``용 절대 시각(ISO8601 UTC).

    콘솔은 이 값을 OpenSearch ``range.gte``에 그대로 넣는다(``opensearch.ts``) —
    ``now-6h`` 같은 date math도, ISO8601도 받는다. 발화 1시간 전부터 보게 만든다.
    """
    start = parse_rfc3339(starts_at)
    if start is None:
        return None
    return (start - timedelta(minutes=lead_minutes)).astimezone(timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def relative_from(starts_at, default="now-6h"):
    """어시스턴트 검색 창(상대형). 발화 후 시간이 흘렀으면 그만큼 넓힌다(최대 24h)."""
    start = parse_rfc3339(starts_at)
    if start is None:
        return default
    elapsed_h = (datetime.now(timezone.utc) - start).total_seconds() / 3600.0
    hours = max(6, min(24, int(elapsed_h) + 6))
    return "now-%dh" % hours


def alert_context(payload, alert):
    """webhook payload + 알림 1건 → 보강에 필요한 최소 컨텍스트(순수).

    payload 전체를 큐에 싣지 않는다 — 필요한 필드만 뽑아 두면 워커가 무엇을 볼 수
    있는지가 코드에서 눈으로 확인된다(반출 상한을 코드 구조로 좁힌다).
    """
    labels = alert.get("labels") or {}
    annotations = alert.get("annotations") or {}
    instance = labels.get("instance") or ""
    node = normalize_node(labels.get("node")) or normalize_node(instance)
    return {
        "alertname": labels.get("alertname") or (payload.get("commonLabels") or {}).get("alertname") or "",
        "node": node,
        "instance": instance,
        "mount": labels.get("mountpoint") or labels.get("mount") or "",
        "severity": labels.get("severity") or "",
        "fingerprint": alert.get("fingerprint") or "",
        "starts_at": alert.get("startsAt") or "",
        "ends_at": alert.get("endsAt") or "",
        "summary": annotations.get("summary") or "",
        "console_url": annotations.get("console_url") or "",
        "drilldown_url": annotations.get("drilldown_url") or "",
        "runbook_url": annotations.get("runbook_url") or "",
    }


def render_top_level(payload):
    """기본 게시 문구 — **payload의 렌더된 title/message를 그대로 쓴다**.

    포맷의 정본은 E1 템플릿(``templates.yaml``) 한 곳이다(spec §3.2). 여기서 다시
    조립하면 정본이 둘이 되고, 다음 사람은 둘 중 어느 쪽을 고쳐야 하는지 모른다.
    payload에 title/message가 없을 때만(웹훅 contact point에 템플릿을 안 붙인 경우)
    라벨로 최소 조립한다 — 조용히 빈 메시지를 보내지 않기 위한 폴백이다.
    """
    title = (payload.get("title") or "").strip()
    message = (payload.get("message") or "").strip()
    if title or message:
        return (title + "\n" + message).strip()
    common = payload.get("commonLabels") or {}
    status = payload.get("status") or "firing"
    head = "%s [%s] %s" % (
        "🔴" if status == "firing" else "✅",
        (common.get("severity") or "unknown").upper(),
        common.get("alertname") or "(alertname 없음)",
    )
    if common.get("node"):
        head += " · " + common["node"]
    body = []
    for alert in payload.get("alerts") or []:
        ctx = alert_context(payload, alert)
        line = "*%s*" % (ctx["alertname"] or "?")
        if ctx["node"]:
            line += " · " + ctx["node"]
        if ctx["summary"]:
            line += " — " + ctx["summary"]
        body.append(line)
    return (head + "\n" + "\n".join(body)).strip()


def render_resolved(contexts):
    """해결 답글 — 같은 fingerprint의 원 스레드에 붙는다(spec §3.2-4)."""
    lines = ["✅ 해결"]
    for ctx in contexts:
        label = ctx["alertname"] or "(알림)"
        if ctx["node"]:
            label += " · " + ctx["node"]
        ended = kst_label(ctx["ends_at"], "%m-%d %H:%M") if ctx["ends_at"] else ""
        started = kst_label(ctx["starts_at"], "%m-%d %H:%M") if ctx["starts_at"] else ""
        span = ""
        if started and ended:
            span = " (%s → %s KST)" % (started, ended)
        elif ended:
            span = " (%s KST)" % ended
        lines.append("· %s%s" % (label, span))
    return "\n".join(lines)


def _human_bytes(value):
    """바이트 → 사람이 읽는 크기. 수집기가 숫자를 주면 여기서만 포맷한다."""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    sign = "-" if num < 0 else ""
    num = abs(num)
    for unit in ("B", "K", "M", "G", "T"):
        if num < 1024 or unit == "T":
            if unit == "B":
                return "%s%d%s" % (sign, int(num), unit)
            return "%s%.1f%s" % (sign, num, unit)
        num /= 1024.0
    return None


def render_attribution_reply(data, ctx):
    """답글 #1 — **결정적**(LLM 무관). 수집기 JSON(spec §4.2 D4-1) → 사람 문장.

    입력은 :func:`drop_local_only_fields` 를 통과한 사본이다. ``raw``는 여기 없다.
    수집기가 아직 없거나 스키마가 비면 None을 돌려 **답글을 생략**한다 —
    "수집 중"·"데이터 없음" 같은 빈 답글은 도배일 뿐이다(spec §4.5).
    """
    if not isinstance(data, dict):
        return None
    node = data.get("node") or ctx.get("node") or ctx.get("instance") or "?"
    mount = data.get("mount") or ctx.get("mount") or ""
    head = "📎 디스크 귀속(자동 수집, read-only) — %s %s" % (node, mount)

    lines = []
    usage = data.get("usage_pct")
    top_dirs = [d for d in (data.get("top_dirs") or []) if isinstance(d, dict)][:4]
    if usage is not None or top_dirs:
        parts = []
        if usage is not None:
            try:
                parts.append("현재 %.1f%%" % float(usage))
            except (TypeError, ValueError):
                parts.append("현재 %s" % usage)
        owners = []
        for entry in top_dirs:
            size = _human_bytes(entry.get("bytes"))
            owner = entry.get("owner") or entry.get("path_category") or "?"
            delta = _human_bytes(entry.get("delta_bytes"))
            label = "%s %s" % (owner, size) if size else str(owner)
            if delta:
                label += " (+%s/24h)" % delta
            owners.append(label)
        if owners:
            parts.append("상위 " + " · ".join(owners))
        lines.append(" · ".join(parts))

    recent = [f for f in (data.get("recent_files") or []) if isinstance(f, dict)]
    if recent:
        by_category = {}
        for entry in recent[:50]:
            key = (entry.get("category") or "대형 파일", entry.get("owner") or "?")
            slot = by_category.setdefault(key, {"count": 0, "bytes": 0, "mtimes": []})
            slot["count"] += 1
            try:
                slot["bytes"] += int(entry.get("bytes") or 0)
            except (TypeError, ValueError):
                pass
            if entry.get("mtime"):
                slot["mtimes"].append(str(entry["mtime"]))
        chunks = []
        for (category, owner), slot in sorted(
            by_category.items(), key=lambda kv: -kv[1]["bytes"]
        )[:3]:
            chunk = "%s ×%d" % (category, slot["count"])
            total = _human_bytes(slot["bytes"])
            if total:
                chunk += ", 합 %s" % total
            chunk += " (소유 %s" % owner
            if slot["mtimes"]:
                stamps = sorted(slot["mtimes"])
                first = kst_label(stamps[0], "%H:%M")
                last = kst_label(stamps[-1], "%H:%M")
                chunk += ", %s" % (first if first == last else "%s~%s" % (first, last))
            chunk += ")"
            chunks.append(chunk)
        if chunks:
            lines.append("최근 신규 대형: " + " · ".join(chunks))

    sudo_count = len([s for s in (data.get("sudo_commands") or []) if isinstance(s, dict)])
    if sudo_count:
        users = sorted({s.get("user") for s in data["sudo_commands"] if s.get("user")})
        lines.append("같은 창의 sudo 이력 %d건 (%s) — 명령 원문은 콘솔에서만" % (sudo_count, ", ".join(users) or "?"))

    if not lines:
        return None

    footnote = "근거: 파일 증거 + sudo 이력 기반 — **비sudo 활동은 포함되지 않는다**. 단정이 아니라 후보다."
    if data.get("partial"):
        footnote += " ⚠️ partial: 이 노드는 축소 수집(sudo 불가 — spec §4.2 D4-3)."
    lines.append(footnote)
    if ctx.get("console_url"):
        lines.append("상세 → <%s|콘솔 분석>" % ctx["console_url"])
    return head + "\n" + "\n".join(lines)


def render_assistant_reply(answer, ctx):
    """답글 #2 — 어시스턴트(로컬 vLLM) 해석. **근거 번호 ``[n]`` 필수**(AC-E3-7).

    설계 판단 2가지:
      ① 근거 목록은 **relay가 결정적으로** 붙인다(시각·노드·서비스·레벨만).
         LLM이 ``[n]``을 안 붙일 수 있고, 그때 근거 없는 단정만 남는 것이 최악이다.
         원문 로그 라인은 넣지 않는다 — 반출 상한(§4.1)이자 AC-E3-7의 정규식 대상이다.
      ② ``evidence``가 0건이면 **답글 자체를 생략**한다. 근거 없는 LLM 문장은
         "근거 번호와 함께 출발점만 제공한다"는 헌장 계약을 만족하지 못한다.
    """
    if not isinstance(answer, dict):
        return None
    evidence = [e for e in (answer.get("evidence") or []) if isinstance(e, dict)]
    if not evidence:
        return None
    body = (answer.get("answer") or "").strip()
    if not body:
        return None

    lines = ["🤖 로그 어시스턴트 분석 (로컬 vLLM · 읽기 전용 — 조치는 사람이 한다)", body, ""]
    for i, doc in enumerate(evidence[:5], start=1):
        lines.append(
            "[%d] %s KST · %s · %s · %s"
            % (
                i,
                kst_label(doc.get("timestamp")),
                doc.get("fleetNode") or "?",
                doc.get("service") or "?",
                doc.get("level") or "?",
            )
        )
    if len(evidence) > 5:
        lines.append("… 외 %d건 (원문은 콘솔에서)" % (len(evidence) - 5))

    runbook = answer.get("runbook") or {}
    links = []
    console_url = ctx.get("console_url")
    if console_url:
        abs_from = absolute_from(ctx.get("starts_at"))
        if abs_from:
            console_url = _replace_query(console_url, "from", abs_from)
        links.append("<%s|콘솔에서 이어보기>" % console_url)
    drill = absolutize_window(ctx.get("drilldown_url"), ctx.get("starts_at"), ctx.get("ends_at"))
    if drill:
        links.append("<%s|드릴다운(발화 시간창)>" % drill)
    if isinstance(runbook, dict) and runbook.get("id"):
        links.append("런북 %s" % runbook["id"])
    elif ctx.get("runbook_url"):
        links.append("<%s|런북>" % ctx["runbook_url"])
    if links:
        lines.append("")
        lines.append(" · ".join(links))
    return "\n".join(lines)


def _replace_query(url, key, value):
    parts = urllib.parse.urlsplit(url)
    params = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True) if k != key]
    params.append((key, value))
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(params), parts.fragment)
    )


def verify_signature(secret, body, headers, scheme="auto"):
    """Grafana webhook HMAC 검증 (선택 — 공유 시크릿 헤더가 1차 방어).

    ⚠️ **[검증 필요]** Grafana의 서명 대상 문자열(body 단독 / ``timestamp:body`` /
    ``timestamp+body``)을 실기에서 확정하지 못했다. 그래서 세 형태를 모두 허용한다 —
    셋 다 **같은 시크릿을 알아야** 만들 수 있으므로 인증 강도는 떨어지지 않고,
    형태 오추정으로 알림이 통째로 막히는 실패 모드를 피한다.
    섀도 기간(T-E3-6)에 실제 헤더를 로깅해 하나로 좁힌다.
    """
    signature = (headers.get("X-Grafana-Alerting-Signature") or "").strip().lower()
    if not signature:
        return False, "서명 헤더 없음"
    timestamp = (headers.get("X-Grafana-Alerting-Timestamp") or "").strip()
    candidates = [body]
    if timestamp:
        candidates.append(timestamp.encode("utf-8") + b":" + body)
        candidates.append(timestamp.encode("utf-8") + body)
    for candidate in candidates:
        expected = hmac.new(secret.encode("utf-8"), candidate, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, signature):
            return True, "ok"
    _ = scheme
    return False, "서명 불일치"


def verify_shared_secret(secret, headers):
    """공유 시크릿 헤더 검증. 상수 시간 비교(타이밍 누출 방지).

    Grafana webhook contact point의 ``authorization_scheme: Bearer`` +
    ``authorization_credentials: $__env{RELAY_SHARED_SECRET}`` 배선을 받는다.
    """
    provided = ""
    auth = (headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        provided = auth[7:].strip()
    if not provided:
        provided = (headers.get("X-KEIwi-Relay-Token") or "").strip()
    if not provided:
        return False, "토큰 없음"
    if hmac.compare_digest(provided, secret):
        return True, "ok"
    return False, "토큰 불일치"


# ══════════════════════════════════════════════════════════════════════════════
# 2. 설정
# ══════════════════════════════════════════════════════════════════════════════


class Config(object):
    """env에서만 읽는다 — 시크릿은 레포에 없다(§13).

    실제 값은 ``/data/alert-relay/env``(root:root 0600)에 있고 systemd
    ``EnvironmentFile=``이 주입한다. 레포에는 ``env.example``만 있다.
    """

    def __init__(self, environ=None):
        env = environ if environ is not None else os.environ
        self.listen_addr = env.get("RELAY_LISTEN_ADDR", "127.0.0.1")
        self.port = int(env.get("RELAY_PORT", "8130"))
        self.shared_secret = env.get("RELAY_SHARED_SECRET", "")
        self.hmac_secret = env.get("RELAY_HMAC_SECRET", "")
        self.slack_token = env.get("SLACK_BOT_TOKEN", "")
        # 섀도 우선 — 기본값이 테스트 채널이다. 컷오버(T-E3-7)는 env 한 줄 변경이고,
        # 기본값이 실채널이면 배포 실수 한 번이 곧 실채널 도배다.
        self.channel = env.get("RELAY_SLACK_CHANNEL", "#keiwi-relay-test")
        # ⚠️ api.slack.com 고정 — 이 망은 slack.com이 SNI 필터로 차단돼 있다(2026-07-30 실측).
        self.slack_api = env.get("RELAY_SLACK_API", "https://api.slack.com/api").rstrip("/")
        self.db_path = env.get("RELAY_DB", "/data/alert-relay/threads.db")
        self.assistant_url = env.get("RELAY_ASSISTANT_URL", "http://localhost:3105/api/assistant")
        self.assistant_timeout = float(env.get("RELAY_ASSISTANT_TIMEOUT", "120"))
        self.slack_timeout = float(env.get("RELAY_SLACK_TIMEOUT", "10"))
        self.retries = int(env.get("RELAY_RETRIES", "3"))
        self.backoff_base = float(env.get("RELAY_BACKOFF_BASE", "2"))
        # E4 수집기(spec §4.2 D4-1). 없으면 답글 #1을 생략한다 — E3는 E4 없이도 성립한다.
        self.collector = env.get("RELAY_COLLECTOR", "/opt/keiwi/alert-relay/collectors/disk-attribution.sh")
        self.collector_timeout = float(env.get("RELAY_COLLECTOR_TIMEOUT", "90"))
        self.ttl_days = int(env.get("RELAY_TTL_DAYS", "30"))
        self.log_level = env.get("RELAY_LOG_LEVEL", "INFO").upper()
        self.enrich = env.get("RELAY_ENRICH", "1") not in ("0", "false", "no")
        # 같은 배달을 두 번 게시하지 않는 창(초). Grafana의 **재시도**(수십 초)는 삼키고
        # **재통지**(repeat_interval 4h/12h)는 통과시키는 값이어야 한다 — 그 사이면 아무 값이나
        # 맞지만, 기본 300초는 group_interval(5m) 하한과 같아 "한 그룹의 재전송"까지 덮는다.
        self.dedup_window = float(env.get("RELAY_DEDUP_WINDOW_SEC", "300"))
        # 링크로 내보낼 수 있는 호스트(쉼표 구분). 비우면 keiwi_redaction 기본값(내부 엔드포인트).
        # ⚠️ 여기 없는 호스트의 링크는 **삭제**된다 — 콘솔·Grafana 주소를 바꾸면 여기도 바꿔라
        #    (지워질 때마다 WARNING 로그가 남는다).
        self.allowed_url_hosts = env.get("RELAY_ALLOWED_URL_HOSTS", "")
        keiwi_redaction.set_allowed_url_hosts(self.allowed_url_hosts)

    def missing(self):
        """기동을 막아야 하는 결핍만 센다 — 조용히 반쪽으로 뜨지 않게."""
        gaps = []
        if not self.shared_secret:
            gaps.append("RELAY_SHARED_SECRET")
        if not self.slack_token:
            gaps.append("SLACK_BOT_TOKEN")
        return gaps


# ══════════════════════════════════════════════════════════════════════════════
# 3. I/O — sqlite · Slack · 어시스턴트 · 수집기
# ══════════════════════════════════════════════════════════════════════════════


class ThreadStore(object):
    """fingerprint → thread_ts. 발생과 해결을 한 스레드로 묶는 유일한 상태다.

    연결을 호출마다 연다 — 스레드 간 공유 커넥션의 ``check_same_thread`` 함정을
    피하고, 이 규모(초당 1건 미만)에서 연결 비용은 무의미하다.

    **어떤 메서드도 예외를 올리지 않는다** [2026-08-04 적대적 검증].
    ------------------------------------------------------------
    실증된 사고: DB가 쓰기 불가일 때 ``remember`` 가 게시 **뒤에** 던졌고, ``do_POST`` 가
    그걸 안 잡아 Grafana에 **응답이 아예 가지 않았다**(``RemoteDisconnected``). Grafana는
    응답이 없으니 재시도했고, 재시도마다 Slack 최상위 게시가 하나씩 늘었다 — 알림 1건에
    게시 3건. 하필 이 실패의 대표 원인이 **디스크 풀**이고 이 relay의 주 용도가
    **DiskUsageHigh** 다. 즉 "디스크가 찼다"는 알림이 도배로 변한다.

    그래서 sqlite 실패는 **흡수**하고, 같은 데이터를 프로세스 메모리 티어에도 쓴다:
      · 디스크가 죽어도 발생→해결 스레드 연속성이 유지된다(재시작 전까지).
      · ``degraded`` 가 ``/healthz`` 로 나가므로 침묵하지 않는다(감시자가 본다).
    메모리 티어는 재시작하면 사라진다 — 그건 받아들인 손실이다(그때 잃는 것은 스레드
    연속성뿐이고, 잃지 않는 것은 알림 전달이다).
    """

    #: 메모리 티어 상한. 5노드 규모에서 동시 미해결 알림이 이 수를 넘을 일이 없고,
    #: 상한이 없으면 장애가 길어질수록 메모리가 는다(장애 중 OOM = 2차 사고).
    MEMORY_MAX = 512

    def __init__(self, path):
        self.path = path
        self.degraded_reason = None
        self._memory = collections.OrderedDict()
        # sqlite가 **받아주지 않은** fingerprint 만 담는다. 메모리 티어를 "두 번째 진실"로
        # 쓰지 않기 위한 표식이다 — 디스크가 멀쩡한데 없다고 하면 그건 없는 것이고
        # (TTL 정리·수동 삭제), 그 답을 메모리가 뒤집으면 지운 행이 되살아난다.
        self._unpersisted = set()
        self._lock = threading.RLock()
        try:
            parent = os.path.dirname(os.path.abspath(path))
            if parent and not os.path.isdir(parent):
                os.makedirs(parent, exist_ok=True)
            with self._connect() as conn:
                conn.execute(
                    "CREATE TABLE IF NOT EXISTS threads ("
                    " fingerprint TEXT PRIMARY KEY,"
                    " channel TEXT NOT NULL,"
                    " ts TEXT NOT NULL,"
                    " alertname TEXT,"
                    " started_at TEXT,"
                    " last_seen TEXT NOT NULL)"
                )
        except (sqlite3.Error, OSError) as exc:
            self._degrade("초기화", exc)

    @property
    def degraded(self):
        return self.degraded_reason is not None

    def _degrade(self, op, exc):
        reason = "%s: %s" % (op, exc.__class__.__name__)
        if self.degraded_reason != reason:
            LOG.error(
                "sqlite %s 실패(%s) — 메모리 티어로 계속한다. 전달은 멈추지 않지만"
                " 재시작하면 스레드 연속성이 끊긴다. 디스크를 먼저 봐라: %s",
                op, exc, self.path,
            )
        self.degraded_reason = reason

    def _recover(self):
        if self.degraded_reason is not None:
            LOG.info("sqlite 회복 — 디스크 티어 재개")
            self.degraded_reason = None

    def _connect(self):
        return sqlite3.connect(self.path, timeout=10)

    def _remember_memory(self, row):
        with self._lock:
            self._memory.pop(row["fingerprint"], None)
            self._memory[row["fingerprint"]] = row
            while len(self._memory) > self.MEMORY_MAX:
                evicted, _ = self._memory.popitem(last=False)
                self._unpersisted.discard(evicted)

    def _forget_memory(self, fingerprint):
        with self._lock:
            self._memory.pop(fingerprint, None)
            self._unpersisted.discard(fingerprint)

    def remember(self, fingerprint, channel, ts, alertname, started_at):
        """저장한다. **성공 여부를 bool로 돌려주고 던지지 않는다.**"""
        now = datetime.now(timezone.utc).isoformat()
        self._remember_memory({
            "fingerprint": fingerprint, "channel": channel, "ts": ts,
            "alertname": alertname, "started_at": started_at, "last_seen": now,
        })
        try:
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO threads(fingerprint, channel, ts, alertname, started_at, last_seen)"
                    " VALUES(?,?,?,?,?,?)"
                    " ON CONFLICT(fingerprint) DO UPDATE SET"
                    " channel=excluded.channel, ts=excluded.ts, alertname=excluded.alertname,"
                    " started_at=excluded.started_at, last_seen=excluded.last_seen",
                    (fingerprint, channel, ts, alertname, started_at, now),
                )
        except (sqlite3.Error, OSError) as exc:
            with self._lock:
                self._unpersisted.add(fingerprint)
            self._degrade("remember", exc)
            return False
        with self._lock:
            self._unpersisted.discard(fingerprint)
        self._recover()
        return True

    def lookup(self, fingerprint):
        """디스크가 정본이다. 메모리는 **디스크가 답하지 못한 것**만 대신 답한다.

        구체적으로 둘 뿐이다: ① 읽기 자체가 실패했을 때 ② 그 행을 디스크가 애초에
        받아주지 않았을 때(``_unpersisted``). 그 밖에는 "없다"가 정답이다 —
        아니면 TTL 정리로 지운 행이 메모리에서 되살아난다.
        """
        try:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT fingerprint, channel, ts, alertname, started_at, last_seen"
                    " FROM threads WHERE fingerprint=?",
                    (fingerprint,),
                ).fetchone()
        except (sqlite3.Error, OSError) as exc:
            self._degrade("lookup", exc)
            row, disk_answered = None, False
        else:
            self._recover()
            disk_answered = True
        if row:
            return {
                "fingerprint": row[0],
                "channel": row[1],
                "ts": row[2],
                "alertname": row[3],
                "started_at": row[4],
                "last_seen": row[5],
            }
        with self._lock:
            if disk_answered and fingerprint not in self._unpersisted:
                return None
            cached = self._memory.get(fingerprint)
        return dict(cached) if cached else None

    def touch(self, fingerprint):
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            if fingerprint in self._memory:
                self._memory[fingerprint]["last_seen"] = now
        try:
            with self._connect() as conn:
                conn.execute(
                    "UPDATE threads SET last_seen=? WHERE fingerprint=?",
                    (now, fingerprint),
                )
        except (sqlite3.Error, OSError) as exc:
            self._degrade("touch", exc)
            return False
        return True

    def purge(self, days):
        """TTL 정리(spec §3.3). 오래된 알림의 해결 답글은 어차피 아무도 안 읽는다."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        with self._lock:
            stale = [k for k, v in self._memory.items() if v.get("last_seen", "") < cutoff]
        for fp in stale:
            self._forget_memory(fp)
        try:
            with self._connect() as conn:
                cur = conn.execute("DELETE FROM threads WHERE last_seen < ?", (cutoff,))
                return cur.rowcount
        except (sqlite3.Error, OSError) as exc:
            self._degrade("purge", exc)
            return 0

    def count(self):
        """행 수. 디스크를 못 읽으면 메모리 티어의 크기를 돌려준다(-1을 쓰지 않는다)."""
        try:
            with self._connect() as conn:
                return conn.execute("SELECT COUNT(*) FROM threads").fetchone()[0]
        except (sqlite3.Error, OSError) as exc:
            self._degrade("count", exc)
            with self._lock:
                return len(self._memory)


def delivery_key(payload):
    """웹훅 **배달 1건**의 멱등키 — 같은 배달을 두 번 게시하지 않기 위한 유일한 식별자.

    Grafana의 재시도는 **완전히 같은 payload**를 다시 보낸다. 그래서 알림 인스턴스의
    불변 식별자(fingerprint · status · startsAt · endsAt)만 뽑아 해시한다.
    payload 전체를 해시하지 않는 이유: ``truncatedAlerts`` 같은 부수 필드나 키 순서가
    달라도 같은 배달이면 같은 키여야 하기 때문이다.

    재통지(``repeat_interval`` 4h/12h)는 fingerprint·startsAt이 같아 키도 같지만,
    :class:`DeliveryLedger` 의 창(기본 300초)을 훨씬 넘으므로 **정상적으로 다시 게시된다** —
    "재시도(수십 초)"와 "재통지(수 시간)"를 시간으로 가르는 것이 이 설계의 요점이다.
    """
    alerts = [a for a in (payload.get("alerts") or []) if isinstance(a, dict)]
    parts = sorted(
        "%s|%s|%s|%s" % (
            a.get("fingerprint") or "",
            a.get("status") or "",
            a.get("startsAt") or "",
            a.get("endsAt") or "",
        )
        for a in alerts
    )
    if not parts:
        # fingerprint가 없는 payload(스키마 변경·수동 테스트)는 본문 자체로 식별한다.
        parts = [json.dumps(payload, sort_keys=True, ensure_ascii=False)]
    seed = (payload.get("status") or "") + "\n" + "\n".join(parts)
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


class DeliveryLedger(object):
    """멱등 원장 — **프로세스 메모리에만** 산다. 그래서 디스크가 죽어도 동작한다.

    왜 sqlite 예약(게시 전 멱등키 INSERT)이 아닌가 [설계 판단]:
      게시 전에 디스크에 예약하면, 디스크가 찬 순간 **알림이 통째로 사라진다**.
      이 relay의 주 용도가 DiskUsageHigh다 — 디스크가 찼다고 알려야 할 바로 그때
      알림이 죽는 설계는 자기모순이다. 전달 무손실이 상위 계약이므로(§3.2-1),
      예약은 절대 실패하지 않는 매체(메모리)에 하고, 디스크 저장은 실패해도 흡수한다.

    받아들인 손실: 재시작 직후의 재시도는 중복 게시가 될 수 있다. 그 창은 수 초이고,
    반대편(디스크 장애 시 알림 소실)보다 훨씬 가볍다.
    """

    def __init__(self, window_sec=300.0, capacity=256, clock=time.time):
        self.window = float(window_sec)
        self.capacity = capacity
        self._clock = clock
        self._lock = threading.Lock()
        self._entries = collections.OrderedDict()   # key → {"at":ts, "result":dict|None}

    def _prune(self, now):
        for key in [k for k, v in self._entries.items() if now - v["at"] > self.window]:
            self._entries.pop(key, None)
        while len(self._entries) > self.capacity:
            self._entries.popitem(last=False)

    def begin(self, key):
        """``("new", None)`` 이면 처리해라. 아니면 이미 처리했거나 처리 중이다."""
        if self.window <= 0:
            # 비활성(``RELAY_DEDUP_WINDOW_SEC=0``) — 원래 동작(배달마다 게시)으로 돌아간다.
            # 탈출구를 남기는 이유: 멱등이 오히려 방해가 되는 상황(수동 반복 테스트)이 있고,
            # 그때 코드를 고치게 만들면 아무도 안 고치고 서비스를 끈다.
            return ("new", None)
        now = self._clock()
        with self._lock:
            self._prune(now)
            entry = self._entries.get(key)
            if entry is not None:
                return ("duplicate", entry["result"])
            self._entries[key] = {"at": now, "result": None}
            return ("new", None)

    def finish(self, key, result):
        """게시가 **실제로 일어난** 시점에 부른다 — 이후 같은 배달은 재게시되지 않는다."""
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                entry = self._entries[key] = {"at": self._clock(), "result": None}
            entry["result"] = dict(result) if isinstance(result, dict) else None

    def abandon(self, key):
        """게시가 **한 건도 없이** 실패했다 — 원장에서 지워 Grafana 재시도를 살린다."""
        with self._lock:
            self._entries.pop(key, None)

    def size(self):
        with self._lock:
            return len(self._entries)


class SlackClient(object):
    """``chat.postMessage`` 한 메서드. **여기가 유일한 Slack egress다.**"""

    def __init__(self, cfg, opener=None):
        self.cfg = cfg
        self._opener = opener or urllib.request.urlopen

    def post(self, payload):
        """성공하면 ``ts``, 실패하면 None. 실패를 Slack에 다시 보고하지 않는다."""
        url = self.cfg.slack_api + "/chat.postMessage"
        data = json.dumps(payload).encode("utf-8")
        last = None
        for attempt in range(self.cfg.retries):
            req = urllib.request.Request(
                url,
                data=data,
                method="POST",
                headers={
                    "Content-Type": "application/json; charset=utf-8",
                    "Authorization": "Bearer " + self.cfg.slack_token,
                },
            )
            try:
                with self._opener(req, timeout=self.cfg.slack_timeout) as resp:
                    body = json.loads(resp.read().decode("utf-8") or "{}")
                if body.get("ok"):
                    return body.get("ts")
                last = body.get("error") or "unknown"
                # rate limit·일시 오류만 재시도한다. invalid_auth를 3번 반복해도 결과는 같다.
                if last not in ("ratelimited", "internal_error", "service_unavailable"):
                    LOG.error("slack chat.postMessage 실패(재시도 안 함): %s", last)
                    return None
            except urllib.error.HTTPError as exc:
                last = "HTTP %s" % exc.code
                if exc.code not in (429, 500, 502, 503, 504):
                    LOG.error("slack HTTP %s (재시도 안 함)", exc.code)
                    return None
                LOG.warning("slack HTTP %s — 백오프 재시도 %d/%d", exc.code, attempt + 1, self.cfg.retries)
            except (urllib.error.URLError, OSError, ValueError) as exc:
                last = str(exc)
                LOG.warning("slack 전송 오류(%s) — 백오프 재시도 %d/%d", exc, attempt + 1, self.cfg.retries)
            if attempt + 1 < self.cfg.retries:
                time.sleep(self.cfg.backoff_base * (2 ** attempt))
        LOG.error("slack 게시 최종 실패: %s", last)
        return None


class AssistantClient(object):
    """콘솔 ``POST /api/assistant`` 호출. 429(동시 1)·502를 백오프로 흡수한다.

    콘솔 계약(``route.ts:10-11``): 동시 1요청, 초과 시 429. relay가 **직렬 큐**로
    호출하므로 정상 경로에서는 429가 나지 않는다 — 429는 사람이 콘솔에서 동시에
    분석을 누른 경우다. 그래서 재시도가 맞다(포기하면 그 순간의 사람 클릭에 진다).
    """

    def __init__(self, cfg, opener=None):
        self.cfg = cfg
        self._opener = opener or urllib.request.urlopen

    def ask(self, ctx):
        body = {
            "fleetNode": ctx.get("node") or None,
            "message": ctx.get("summary") or ctx.get("alertname") or "",
            "question": preset_question(ctx.get("alertname"), ctx.get("node"), ctx.get("mount")),
            "from": relative_from(ctx.get("starts_at")),
        }
        data = json.dumps({k: v for k, v in body.items() if v}).encode("utf-8")
        for attempt in range(self.cfg.retries):
            req = urllib.request.Request(
                self.cfg.assistant_url,
                data=data,
                method="POST",
                headers={"Content-Type": "application/json; charset=utf-8"},
            )
            try:
                with self._opener(req, timeout=self.cfg.assistant_timeout) as resp:
                    return json.loads(resp.read().decode("utf-8") or "{}")
            except urllib.error.HTTPError as exc:
                if exc.code in (429, 502, 503, 504):
                    LOG.warning(
                        "assistant HTTP %s — 백오프 재시도 %d/%d", exc.code, attempt + 1, self.cfg.retries
                    )
                else:
                    LOG.warning("assistant HTTP %s — 재시도 안 함(답글 #2 생략)", exc.code)
                    return None
            except (urllib.error.URLError, OSError, ValueError) as exc:
                LOG.warning("assistant 오류(%s) — 재시도 %d/%d", exc, attempt + 1, self.cfg.retries)
            if attempt + 1 < self.cfg.retries:
                time.sleep(self.cfg.backoff_base * (2 ** attempt))
        # 최종 실패는 **조용히** 생략한다. Slack에 "분석 실패"를 도배하면 알림 신뢰가 죽는다.
        LOG.error("assistant 최종 실패 — 답글 #2 생략 (alert=%s node=%s)", ctx.get("alertname"), ctx.get("node"))
        return None


def run_collector(cfg, ctx):
    """E4 수집기 호출 — **경로·스키마만 계약**이다(이 파일은 수집기를 만들지 않는다).

    계약(spec §4.2 D4-1, T-E4-1과 합의된 인터페이스):
      ``<collector> --node <dataNN> --mount <path> --since <RFC3339> --json`` → stdout JSON
      ``{node, mount, usage_pct, collected_at, top_dirs[], recent_files[], sudo_commands[], partial}``

    미배포·실패·타임아웃·스키마 불일치는 **전부 None**이다(답글 #1 생략).
    수집기가 없다고 알림이 지연되거나 실패하면 안 된다 — E3는 E4 없이도 성립한다.
    """
    path = cfg.collector
    if not path or not os.path.isfile(path) or not os.access(path, os.X_OK):
        LOG.info("수집기 미배포(%s) — 답글 #1 생략", path)
        return None
    cmd = [path, "--node", ctx.get("node") or "", "--mount", ctx.get("mount") or "/", "--json"]
    if ctx.get("starts_at"):
        cmd.extend(["--since", ctx["starts_at"]])
    try:
        proc = subprocess.run(  # nosec B603 — shell=False·고정 인자 배열·타임아웃
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=cfg.collector_timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        LOG.warning("수집기 실행 실패(%s) — 답글 #1 생략", exc)
        return None
    if proc.returncode != 0:
        LOG.warning("수집기 rc=%s — 답글 #1 생략 (stderr 앞 200자: %s)",
                    proc.returncode, (proc.stderr or b"")[:200].decode("utf-8", "replace"))
        return None
    try:
        parsed = json.loads((proc.stdout or b"").decode("utf-8") or "{}")
    except ValueError as exc:
        LOG.warning("수집기 JSON 파싱 실패(%s) — 답글 #1 생략", exc)
        return None
    # 경계에서 로컬 전용 필드를 제거한다. 이 아래로는 `raw`가 존재하지 않는다.
    return drop_local_only_fields(parsed)


# ══════════════════════════════════════════════════════════════════════════════
# 4. 비동기 보강 — 직렬 큐(동시 1)
# ══════════════════════════════════════════════════════════════════════════════


class Enricher(object):
    """워커 **1개**. 어시스턴트 동시 1 계약(콘솔 route.ts)과 정합한다.

    큐가 밀리면 답글이 늦어질 뿐 1차 전달은 영향이 없다 — 그것이 이 구조의 요점이다.
    """

    def __init__(self, app):
        self.app = app
        self.q = queue.Queue()
        self.processed = 0
        self._thread = threading.Thread(target=self._loop, name="enricher", daemon=True)

    def start(self):
        self._thread.start()

    def submit(self, ctx):
        self.q.put(ctx)

    def stop(self, timeout=5):
        self.q.put(None)
        self._thread.join(timeout)

    def depth(self):
        return self.q.qsize()

    def _loop(self):
        while True:
            ctx = self.q.get()
            if ctx is None:
                self.q.task_done()
                return
            try:
                self.process(ctx)
            except Exception:  # noqa: BLE001 — 워커는 어떤 예외로도 죽으면 안 된다
                LOG.exception("보강 실패(무시하고 계속) alert=%s", ctx.get("alertname"))
            finally:
                self.processed += 1
                self.q.task_done()

    def process(self, ctx):
        """답글 #1(결정적) → 답글 #2(LLM). 앞이 실패해도 뒤는 시도한다."""
        channel = ctx.get("channel") or self.app.cfg.channel
        thread_ts = ctx.get("thread_ts")
        if ctx.get("alertname") in DISK_ALERTS:
            data = run_collector(self.app.cfg, ctx)
            text = render_attribution_reply(data, ctx) if data else None
            if text:
                self._post_reply(channel, text, thread_ts, "#1 귀속")
        answer = self.app.assistant.ask(ctx)
        text = render_assistant_reply(answer, ctx) if answer else None
        if text:
            self._post_reply(channel, text, thread_ts, "#2 어시스턴트")
        elif answer:
            LOG.info("근거 0건 — 답글 #2 생략(근거 없는 단정을 게시하지 않는다)")

    def _post_reply(self, channel, text, thread_ts, label):
        """보강 답글 1건. **하드 거부는 그 답글만 죽인다** — 다음 답글은 계속 시도한다.

        답글은 없어도 되지만 알림은 없으면 안 된다(§3.2-1). 그래서 여기서는 폴백 본문을
        쓰지 않는다 — 새는 답글보다 없는 답글이 낫고, 사유는 relay 로그에 남는다.
        """
        try:
            self.app.slack.post(build_slack_payload(channel, text, thread_ts=thread_ts))
        except keiwi_redaction.RedactionError as exc:
            LOG.error("답글 %s 게시 취소(반출 규칙 위반) — %s", label, exc)


# ══════════════════════════════════════════════════════════════════════════════
# 5. 애플리케이션
# ══════════════════════════════════════════════════════════════════════════════


class App(object):
    def __init__(self, cfg, store=None, slack=None, assistant=None):
        self.cfg = cfg
        self.store = store or ThreadStore(cfg.db_path)
        self.slack = slack or SlackClient(cfg)
        self.assistant = assistant or AssistantClient(cfg)
        self.enricher = Enricher(self)
        self.ledger = DeliveryLedger(window_sec=cfg.dedup_window)
        self.started_at = datetime.now(timezone.utc)
        self.last_webhook_at = None
        self.last_post_at = None
        self.webhooks = 0
        self.rejected = 0
        self.duplicates = 0
        self.errors = 0
        self._purged_day = None

    # ── 인증 ────────────────────────────────────────────────────────────────
    def authorize(self, headers, body):
        ok, reason = verify_shared_secret(self.cfg.shared_secret, headers)
        if ok:
            return True, "shared-secret"
        # HMAC이 설정돼 있으면 두 번째 경로를 허용한다(Grafana 서명 옵션).
        if self.cfg.hmac_secret:
            ok, hmac_reason = verify_signature(self.cfg.hmac_secret, body, headers)
            if ok:
                return True, "hmac"
            return False, "%s / %s" % (reason, hmac_reason)
        return False, reason

    # ── 동기 경로: 여기에 LLM이 없다 ────────────────────────────────────────
    def handle_webhook(self, payload):
        """웹훅 1건 처리 — **멱등**. 같은 배달을 두 번 게시하지 않는다.

        반환 계약(``do_POST`` 가 이걸로 응답 코드를 고른다):
          · dict  → 200. ``duplicate``/``degraded`` 플래그가 붙을 수 있다.
          · None  → 502. 게시가 **한 건도** 안 됐다 → Grafana 재시도가 유일한 복구다.
          · 예외  → 게시가 있었으면 삼키고 dict, 없었으면 그대로 올린다(do_POST가 500).

        핵심은 "게시가 실제로 일어난 순간"을 원장에 박는 것이다(:func:`mark`).
        그 뒤에 무엇이 터지든 재시도는 재게시하지 않는다 — 이것이 도배를 막는 장치다.
        """
        self.webhooks += 1
        self.last_webhook_at = datetime.now(timezone.utc)
        key = delivery_key(payload)
        state, cached = self.ledger.begin(key)
        if state != "new":
            self.duplicates += 1
            LOG.info(
                "중복 배달(멱등키 %s… · 창 %.0fs) — 재게시하지 않고 200을 돌려준다",
                key[:12], self.cfg.dedup_window,
            )
            # 이 배달이 **한 일**을 그대로 보고한다: 아무것도 안 했다. 원 스레드 ts만 돌려준다.
            # (앞선 배달의 카운터를 되돌려 주면 호출자가 "또 게시됐다"고 오해한다.)
            return {
                "posted": 0, "replies": 0, "enriched": 0,
                "ts": (cached or {}).get("ts"), "duplicate": True,
            }

        posted_marker = {}

        def mark(result):
            posted_marker.update(result)
            self.ledger.finish(key, result)

        try:
            result = self._handle_webhook(payload, mark)
        except Exception:  # noqa: BLE001 — 게시 여부에 따라 응답을 가르는 것이 요점이다
            LOG.exception("웹훅 처리 중 예외 (posted=%s)", bool(posted_marker))
            if posted_marker:
                # 게시는 됐다. 여기서 5xx를 주면 Grafana가 재시도하고 그게 곧 도배다.
                out = dict(posted_marker)
                out["degraded"] = True
                return out
            self.ledger.abandon(key)
            raise
        if result is None:
            self.ledger.abandon(key)
            return None
        if not posted_marker:
            self.ledger.finish(key, result)
        if self.store.degraded:
            result["degraded"] = True
        return result

    def _handle_webhook(self, payload, mark):
        """게시·저장 본체. ``mark(result)`` 는 **게시가 성공한 직후**에 부른다."""
        self._maybe_purge()

        alerts = [a for a in (payload.get("alerts") or []) if isinstance(a, dict)]
        contexts = [alert_context(payload, a) for a in alerts]
        statuses = [(a.get("status") or payload.get("status") or "firing") for a in alerts]
        channel = self.cfg.channel

        resolved = [c for c, s in zip(contexts, statuses) if s == "resolved"]
        firing = [c for c, s in zip(contexts, statuses) if s != "resolved"]

        result = {"posted": 0, "replies": 0, "enriched": 0, "ts": None}

        # ① 해결 — 같은 fingerprint의 원 스레드에 답글(spec §3.2-4).
        if resolved and not firing:
            by_ts = {}
            for ctx in resolved:
                row = self.store.lookup(ctx["fingerprint"]) if ctx["fingerprint"] else None
                if row:
                    by_ts.setdefault(row["ts"], []).append(ctx)
                    self.store.touch(ctx["fingerprint"])
            for ts, group in by_ts.items():
                # 해결 답글도 **1차 전달**이다 — 하드 거부에 걸려도 삼키지 않는다(allow_fallback).
                if self.slack.post(build_slack_payload(
                        channel, render_resolved(group), thread_ts=ts, allow_fallback=True)):
                    self.last_post_at = datetime.now(timezone.utc)
                    result["replies"] += 1
                    result["ts"] = ts
                    mark(result)
            if by_ts:
                # 붙일 스레드는 찾았는데 **한 건도 못 올렸다** → 게시 0건이므로 5xx로 재시도를
                # 유도한다(위 ②와 같은 규칙: 유실보다 중복이 낫다). 일부만 성공한 경우는
                # 200으로 끝낸다 — 재시도가 성공분을 두 번 올리는 편이 더 나쁘다.
                return result if result["replies"] else None
            # 스레드를 못 찾았다(relay 도입 전 발화·TTL 만료·DB 유실).
            # **해결을 조용히 삼키지 않는다** — 최상위로라도 알린다.
            LOG.info("해결 웹훅이지만 스레드 없음 — 최상위 게시로 폴백")

        # ② 발화(또는 스레드 없는 해결) — 렌더된 title/message 그대로 게시.
        ts = self.slack.post(build_slack_payload(
            channel, render_top_level(payload), allow_fallback=True))
        if not ts:
            # 게시 실패. Grafana에는 5xx를 돌려 **재시도를 유도**한다(유실 방지).
            return None
        self.last_post_at = datetime.now(timezone.utc)
        result["posted"] = 1
        result["ts"] = ts
        # 게시가 일어났다 — 이 지점 뒤로는 무엇이 실패해도 **재게시하지 않는다**.
        # (sqlite 저장 실패가 Slack 도배가 되던 경로가 정확히 여기 아래였다.)
        mark(result)

        repeats = 0
        for ctx in firing or resolved:
            if not ctx["fingerprint"]:
                continue
            row = self.store.lookup(ctx["fingerprint"])
            if row and row.get("started_at") and row["started_at"] == ctx["starts_at"]:
                repeats += 1
            self.store.remember(
                ctx["fingerprint"], channel, ts, ctx["alertname"], ctx["starts_at"]
            )

        # ③ 비동기 보강. 재통지(repeat_interval)는 보강하지 않는다 —
        #    같은 사건에 대해 4시간마다 GPU를 태우고 같은 답을 스레드에 쌓을 이유가 없다.
        if self.cfg.enrich and firing and repeats < len(firing):
            primary = dict(firing[0])
            primary["channel"] = channel
            primary["thread_ts"] = ts
            self.enricher.submit(primary)
            result["enriched"] = 1
        elif repeats:
            LOG.info("재통지(startsAt 동일) — 보강 생략 alert=%s", firing[0]["alertname"] if firing else "?")
        return result

    def _maybe_purge(self):
        today = datetime.now(timezone.utc).date()
        if self._purged_day == today:
            return
        self._purged_day = today
        try:
            removed = self.store.purge(self.cfg.ttl_days)
            if removed:
                LOG.info("스레드 TTL 정리 %d행(>%d일)", removed, self.cfg.ttl_days)
        except sqlite3.Error as exc:
            LOG.warning("TTL 정리 실패: %s", exc)

    def health(self):
        """watchdog가 읽는다(spec §3.4-2). sqlite 접근성 + 마지막 처리 시각을 포함한다 —
        프로세스가 살아 있는 것과 일이 되고 있는 것은 다르다.

        ⚠️ ``db_ok=false`` 여도 **알림 전달은 계속된다**(메모리 티어). 그래서 이 필드는
        "죽었다"가 아니라 "디스크를 보라"는 신호다 — 503으로 알려 사람이 오게 만든다.
        """
        rows = self.store.count()
        db_ok = not self.store.degraded
        return {
            "status": "ok" if db_ok else "degraded",
            "version": VERSION,
            "channel": self.cfg.channel,
            "db_ok": db_ok,
            "db_error": self.store.degraded_reason,
            "threads": rows,
            "queue_depth": self.enricher.depth(),
            "webhooks": self.webhooks,
            "rejected": self.rejected,
            "duplicates": self.duplicates,
            "errors": self.errors,
            "ledger": self.ledger.size(),
            "started_at": self.started_at.isoformat(),
            "last_webhook_at": self.last_webhook_at.isoformat() if self.last_webhook_at else None,
            "last_post_at": self.last_post_at.isoformat() if self.last_post_at else None,
        }


class RelayHandler(BaseHTTPRequestHandler):
    server_version = "keiwi-alert-relay/" + VERSION
    protocol_version = "HTTP/1.1"

    @property
    def app(self):
        return self.server.app

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler 규약
        if self.path.split("?", 1)[0] == "/healthz":
            health = self.app.health()
            self._send(200 if health["status"] == "ok" else 503, health)
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path.split("?", 1)[0] != "/webhook":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.app.rejected += 1
            self._send(413, {"error": "본문 길이 위반"})
            return
        body = self.rfile.read(length)

        ok, how = self.app.authorize(self.headers, body)
        if not ok:
            self.app.rejected += 1
            # 401을 돌려도 Grafana는 재시도한다. 로그에 이유를 남겨 배선 실수를 빨리 찾는다.
            LOG.warning("인증 거부(%s) from %s", how, self.client_address[0])
            self._send(401, {"error": "unauthorized"})
            return

        try:
            payload = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            self.app.rejected += 1
            self._send(400, {"error": "JSON 아님: %s" % exc})
            return
        if not isinstance(payload, dict):
            self.app.rejected += 1
            self._send(400, {"error": "JSON 객체가 아님"})
            return

        # ⚠️ 여기서 예외가 새어 나가면 socketserver가 **응답 없이 연결을 끊는다**
        #    (`RemoteDisconnected`). Grafana는 응답이 없으니 재시도하고, 재시도마다
        #    Slack 게시가 하나씩 는다 — 실증된 도배 경로가 정확히 이것이었다
        #    [2026-08-04]. 어떤 예외든 **응답은 반드시 나간다**.
        try:
            result = self.app.handle_webhook(payload)
        except Exception:  # noqa: BLE001 — 응답 없는 종료가 최악이다
            self.app.errors += 1
            LOG.exception("webhook 처리 실패 — 500으로 응답한다(연결을 끊지 않는다)")
            self._send(500, {"error": "internal"})
            return
        if result is None:
            # 게시 실패 → 5xx로 Grafana 재시도를 유도한다(유실보다 중복이 낫다).
            self._send(502, {"error": "slack 게시 실패"})
            return
        self._send(200, result)

    def log_message(self, fmt, *args):  # noqa: A003 — 표준 훅 이름
        LOG.debug("%s %s", self.address_string(), fmt % args)


def make_server(app):
    httpd = ThreadingHTTPServer((app.cfg.listen_addr, app.cfg.port), RelayHandler)
    httpd.daemon_threads = True
    httpd.app = app
    return httpd


def main(argv=None):
    argv = list(argv if argv is not None else sys.argv[1:])
    cfg = Config()
    logging.basicConfig(
        level=getattr(logging, cfg.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    if "--check-config" in argv:
        gaps = cfg.missing()
        print("channel=%s port=%s db=%s collector=%s" % (cfg.channel, cfg.port, cfg.db_path, cfg.collector))
        if gaps:
            print("FAIL 누락 env: %s" % ", ".join(gaps))
            return 1
        print("CONFIG_OK")
        return 0

    gaps = cfg.missing()
    if gaps:
        LOG.error("기동 거부 — 누락 env: %s (EnvironmentFile=/data/alert-relay/env 확인)", ", ".join(gaps))
        return 1

    app = App(cfg)
    app.enricher.start()
    httpd = make_server(app)
    LOG.info(
        "alert-relay %s listen=%s:%s channel=%s db=%s",
        VERSION, cfg.listen_addr, cfg.port, cfg.channel, cfg.db_path,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        LOG.info("종료 신호 — 큐 %d건 남기고 정지", app.enricher.depth())
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

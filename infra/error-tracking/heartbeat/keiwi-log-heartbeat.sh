#!/usr/bin/env bash
# KEIwi 로그 인입 하트비트 — dead man's switch (specs/error-tracking E4)
#
# ── 왜 "정상일 때만 보내는가" ────────────────────────────────────────────
# GlitchTip 하트비트에는 status 파라미터가 없다[정본 확인]. 실패를 "보고"할 수단이
# 없고, **신호의 부재 자체가 장애 신호**다. 그래서 판정을 여기서 하고 정상일 때만 POST한다.
#
#   정상  → POST → GlitchTip "살아있음"
#   비정상 → 아무것도 안 함 → interval(600s) 경과 후 GlitchTip이 Down 판정 → Slack
#
# ── 왜 Grafana의 LogIngestStalled와 중복이 아닌가 ─────────────────────────
# 같은 것을 **다른 실패 도메인에서** 본다. Grafana 규칙은 Grafana가 살아있어야 동작하고,
# 이 하트비트는 Grafana·Prometheus가 통째로 죽어도 동작한다. 이중화가 목적이다.
# (다만 data05가 통째로 죽으면 GlitchTip도 함께 죽는다 — 그건 T4-12 크로스노드
#  watchdog의 몫이고, 이 스크립트의 범위가 아니다.)
#
# ── 실패도 안전하게 ──────────────────────────────────────────────────────
# 이 스크립트 자체가 죽거나(curl 부재·권한 오류) 타이머가 멈춰도 결과는 같다:
# POST가 안 가고 → 알림이 뜬다. 안전한 방향으로 실패한다(fail-safe).
#
# 설정: /data/glitchtip/heartbeat.env (root 0600, §13)
#   GLITCHTIP_HEARTBEAT_URL=http://127.0.0.1:8090/api/0/organizations/<org>/heartbeat_check/<uuid>/
#   ※ 반드시 로컬 주소. UI가 알려주는 glitchtip.excusa.uk는 터널(E1-7) 완료 전엔 도달 불가.
#   ※ 반드시 POST. GET은 405를 준다[실측].
set -uo pipefail

ENV_FILE="${ENV_FILE:-/data/glitchtip/heartbeat.env}"
[ -r "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }

OS_URL="${OPENSEARCH_URL:-http://127.0.0.1:9200}"
HB_URL="${GLITCHTIP_HEARTBEAT_URL:-}"
WINDOW="${HEARTBEAT_WINDOW:-30m}"
# 정상 유입은 30분에 ≈27,500건(실측 2026-07-30). 100은 "사실상 정지"의 하한이며
# Grafana LogIngestStalled 규칙과 같은 값이다 — 두 경로의 판정이 갈리면 안 된다.
MIN_DOCS="${HEARTBEAT_MIN_DOCS:-100}"

log() { echo "[$(date -Is)] $*"; }

if [ -z "$HB_URL" ]; then
  log "FATAL: GLITCHTIP_HEARTBEAT_URL 미설정 ($ENV_FILE) — ping 없음 → 곧 알림이 뜬다(의도된 동작)"
  exit 1
fi

# 최근 WINDOW 동안의 로그 문서 수. OpenSearch가 죽어 있으면 조회가 실패하고,
# 그것도 "인입 정상 아님"이므로 ping하지 않는 것이 맞다.
count="$(
  curl -sS --max-time 10 "$OS_URL/keiwi-logs-*/_count" \
    -H 'Content-Type: application/json' \
    -d "{\"query\":{\"range\":{\"@timestamp\":{\"gte\":\"now-${WINDOW}\"}}}}" 2>/dev/null \
  | python3 -c 'import sys,json
try: print(int(json.load(sys.stdin).get("count", -1)))
except Exception: print(-1)' 2>/dev/null
)"
count="${count:--1}"

if [ "$count" -lt 0 ]; then
  log "OpenSearch 조회 실패 — ping 보류(인입 상태를 확인할 수 없으면 정상으로 간주하지 않는다)"
  exit 0
fi

if [ "$count" -lt "$MIN_DOCS" ]; then
  log "인입 정지 의심: 최근 ${WINDOW} ${count}건 < ${MIN_DOCS} — ping 보류 → GlitchTip이 Down 판정할 것"
  exit 0
fi

# 정상 — 하트비트 전송
code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$HB_URL" 2>/dev/null)"
if [ "$code" = "200" ]; then
  log "OK: 최근 ${WINDOW} ${count}건 — 하트비트 전송(200)"
else
  # 전송 실패도 결국 부재로 이어져 알림이 뜬다. 원인 파악용으로 남긴다.
  log "WARN: 인입은 정상(${count}건)이나 하트비트 전송 실패(HTTP ${code}) — GlitchTip 상태 확인 필요"
fi
exit 0

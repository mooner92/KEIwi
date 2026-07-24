#!/usr/bin/env bash
# 컴포넌트에 raw 상태 hex 금지 — 상태색은 시맨틱 토큰으로만 (헌장 §17, spec §8).
# 토큰 정의는 globals.css(app/)에만. GNU grep(-P) 전제. 실행: npm run check:no-raw-hex
set -euo pipefail
cd "$(dirname "$0")/.."

if grep -rnP '#[0-9a-fA-F]{3,8}\b' src/components 2>/dev/null; then
  echo "FAIL: src/components에 raw hex 발견 — 시맨틱 토큰(success/danger/neutral …)으로 바꿀 것"
  exit 1
fi

echo "OK: no raw hex in components"

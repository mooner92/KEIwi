#!/usr/bin/env bash
# 하드코딩 URL/시크릿 + .env 실파일 추적 + 클라이언트 번들 PROMETHEUS_URL 노출 검사.
# GNU grep(-P) 전제 (.105 = Ubuntu). 실행: npm run check:secrets
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# 1) src에 하드코딩된 외부 http(s) URL 금지 (env 경유만 허용)
if grep -rnP 'https?://(?!localhost|127\.0\.0\.1)' src 2>/dev/null \
   | grep -vP '(process\.env|config/env|@/config/env)'; then
  echo "FAIL: 하드코딩된 외부 URL 발견 — env(config/env) 경유로 바꿀 것"
  fail=1
fi

# 2) .env 실파일이 git 추적되면 실패 (.env.example만 허용)
root="$(git rev-parse --show-toplevel)"
if git -C "$root" ls-files | grep -E 'apps/console/\.env(\.[a-z]+)?$' | grep -vE '\.env\.example$'; then
  echo "FAIL: .env 실파일이 git에 추적됨"
  fail=1
fi

# 3) PROMETHEUS_URL(서버 전용)이 클라이언트 빌드 산출물에 노출 금지 (spec §보강 검증)
if [ -d .next/static ]; then
  if grep -rl 'PROMETHEUS_URL' .next/static 2>/dev/null; then
    echo "FAIL: PROMETHEUS_URL이 클라이언트 번들(.next/static)에 노출됨"
    fail=1
  fi
fi

if [ "$fail" = 0 ]; then echo "OK: secrets check passed"; fi
exit "$fail"

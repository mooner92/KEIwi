#!/usr/bin/env bash
# GlitchTip 배포 전 env 게이트 (AC-E-2, spec §7 F5)
#
# 왜 있는가: 빈/깨진 시크릿은 서비스가 뜬 뒤에야 이상하게 실패한다 — 실측 사례로
# 빈 SLACK_BOT_TOKEN 하나가 Grafana 전체를 기동 불가로 만들었다(2026-07-30).
# "설정했으니 됐다"를 금지하고, 배포 명령 앞에서 기계적으로 거른다.
#
# 사용: sudo bash check-env.sh /data/glitchtip/.env   (통과 시 exit 0)
set -u
ENV_FILE="${1:-/data/glitchtip/.env}"
fail=0
err() { echo "  ✗ $*"; fail=1; }
ok()  { echo "  ✓ $*"; }

[ -r "$ENV_FILE" ] || { echo "✗ $ENV_FILE 읽기 불가(root로 실행했나?)"; exit 1; }

# 파일 위생: CRLF·BOM은 값 끝에 보이지 않는 문자를 남겨 인증을 조용히 깨뜨린다
if grep -q $'\r' "$ENV_FILE"; then err "CRLF 개행 발견 — dos2unix 필요"; else ok "개행 LF"; fi

get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

# SECRET_KEY: 존재 + 길이 ≥64 + 따옴표/공백 없음
SK="$(get SECRET_KEY)"
if [ -z "$SK" ]; then err "SECRET_KEY 비어 있음"
elif [ "${#SK}" -lt 64 ]; then err "SECRET_KEY 길이 ${#SK} < 64 (openssl rand -hex 32)"
elif printf '%s' "$SK" | grep -qE "[\"' ]"; then err "SECRET_KEY에 따옴표/공백"
else ok "SECRET_KEY (${#SK}자)"; fi

# POSTGRES_PASSWORD: 존재 + 따옴표/공백/@·:/ 금지(DATABASE_URL에 삽입되므로 URL 예약문자 금지)
PP="$(get POSTGRES_PASSWORD)"
if [ -z "$PP" ]; then err "POSTGRES_PASSWORD 비어 있음"
elif printf '%s' "$PP" | grep -qE "[\"' @:/]"; then err "POSTGRES_PASSWORD에 URL 예약문자(@:/)·따옴표·공백 — DATABASE_URL이 깨진다"
else ok "POSTGRES_PASSWORD (${#PP}자)"; fi

echo
if [ "$fail" -eq 0 ]; then echo "PASS — 배포 가능"; else echo "FAIL — 위 항목 수정 전 배포 금지"; fi
exit "$fail"

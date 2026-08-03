#!/usr/bin/env bash
# compose 게이트 — 스택 3종의 compose 파일 스키마 검증 (§5 D5-2 / T5-17)
#
# 대상: infra/{monitoring,logging,error-tracking}/docker-compose.yml
#   (infra/error-tracking/upstream/compose.sample.yml 은 **상류 원본 사본**이라 제외한다 —
#    우리가 고치지 않는 파일을 게이트가 판정하면 상류 갱신 때마다 red가 된다.)
#
# 무엇이 실패인가: 문법·스키마 오류만. **미설정 변수 경고는 통과**시킨다 —
#   실값은 레포 밖 env로 주입하는 것이 정상이고(§13), 그것을 실패로 다루면
#   게이트를 통과시키려고 시크릿을 레포에 넣는 유인이 생긴다. 정확히 반대 방향이다.
#
# 이 게이트가 **못** 잡는 것:
#   · 이미지 태그가 실제로 존재하는지(레지스트리 조회는 하지 않는다 — 오프라인 원칙).
#   · 볼륨 경로가 그 호스트에 있는지. 라이브 배치는 §11의 사람 절차가 확인한다.
#
# exit: 0 통과 / 1 위반 / 2 compose 구현 부재(SKIP)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

# v2 플러그인이 정본(러너·최신 도커). v1 바이너리는 이 호스트처럼 플러그인이 없는 곳의 폴백.
# 둘 다 데몬 없이 파일만 파싱한다 — docker 소켓 권한이 없어도 이 게이트는 돈다(실측).
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "SKIP(env: docker compose) — v2 플러그인도 v1 바이너리도 없다" >&2
  exit 2
fi

FILES=(
  infra/monitoring/docker-compose.yml
  infra/logging/docker-compose.yml
  infra/error-tracking/docker-compose.yml
)

fail=0
for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "FAIL 없음: $f"
    fail=1
    continue
  fi
  out="$("${COMPOSE[@]}" -f "$f" config -q 2>&1)"
  rc=$?
  # 미설정 변수 경고는 stderr로 나오지만 rc=0이다 — 참고로만 남긴다.
  [[ -n "$out" && $rc -eq 0 ]] && printf '%s\n' "$out" | sed 's/^/  note: /'
  if [[ $rc -ne 0 ]]; then
    printf '%s\n' "$out"
    echo "FAIL compose: $f"
    fail=1
  fi
done

[[ $fail -eq 0 ]] && echo "COMPOSE_OK files=${#FILES[@]} (${COMPOSE[*]})"
exit "$fail"

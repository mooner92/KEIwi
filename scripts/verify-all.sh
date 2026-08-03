#!/usr/bin/env bash
# 로컬 = CI 동형 게이트 실행기 (spec fleet-hardening §0.2 · D5-2 / T5-6)
#
# 무엇을 도는가:
#   ① scripts/gates/check-*.{sh,py} 를 **글롭으로** 순회하며 **인자 없이** 부른다.
#      새 게이트는 이 디렉터리에 `check-` 접두사로 떨어뜨리면 배선 없이 자동 편입된다.
#      `check-`로 시작하지 않는 파일(lib.sh·promtool.sh·render-*)은 게이트가 아니라
#      헬퍼이므로 대상이 아니다 — 헬퍼는 반드시 어떤 게이트가 호출한다(§0.2).
#   ② 콘솔 스코프 게이트 2개를 **각 1회** 호출한다.
#      scripts/gates/ 안에 콘솔 스크립트 래퍼를 두지 않는 이유가 이것이다 — 두면 ①과 ②가
#      같은 검사를 두 번 돌린다(AC-5-20).
#
# 무엇을 **안** 도는가:
#   `next build`. 콘솔은 apps/console/.next 를 **라이브로 서빙**한다 — 같은 디렉터리에서
#   build를 돌리면 운영이 깨진다(§12). 그래서 기본 제외이고, build 게이트의 정본은 CI다.
#   CI 도입의 가장 큰 실익이 "자동화"가 아니라 **"라이브를 안 건드리고 빌드를 검증할 유일한
#   장소"**라는 것이 이 스크립트가 존재하는 이유의 절반이다.
#
# 종료코드: 0 전부 통과 / 1 하나라도 위반 / 2 위반은 없지만 SKIP(env)이 있음
#   rc=2를 초록으로 취급하지 않는 것이 핵심이다 — 도구가 없어 검사가 사라진 상태와
#   검사가 통과한 상태는 다르다.
#
# usage:
#   scripts/verify-all.sh                 게이트 전체 (build 제외)
#   scripts/verify-all.sh --with-build    + 콘솔 프로덕션 빌드 (§12 주의)
#   scripts/verify-all.sh --dry-run       실행 계획만 출력
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck source=scripts/gates/lib.sh
source "$HERE/gates/lib.sh"

WITH_BUILD=0
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-build) WITH_BUILD=1 ;;
    --dry-run)    DRY_RUN=1 ;;
    -h|--help)    sed -n '/^# usage:/,$p' "$0" | sed 's/^# \{0,1\}//'; exit 64 ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
  shift
done

# §12 가드 — 프로덕션 체크아웃에서는 빌드를 거부한다. 라이브가 서빙 중인 .next 를
# 덮어쓰는 순간 콘솔이 죽는다. 경로는 헌장이 정한 프로덕션 위치다.
if [[ $WITH_BUILD -eq 1 && "$ROOT" == "/KEIwi" ]]; then
  echo "REFUSE: /KEIwi 는 프로덕션이다 — 여기서 --with-build 를 돌리면 라이브 .next 가 깨진다(§12)." >&2
  echo "        격리 worktree에서 실행하라(docs/testing.md)." >&2
  exit 1
fi

cd "$ROOT"

mapfile -t GATES < <(find scripts/gates -maxdepth 1 \( -name 'check-*.sh' -o -name 'check-*.py' \) | sort)
CONSOLE_GATES=(
  apps/console/scripts/check-no-secrets.sh
  apps/console/scripts/check-no-raw-hex.sh
)

if [[ $DRY_RUN -eq 1 ]]; then
  # PLAN은 **실제 실행 순서와 같아야 한다.** 드라이런이 순서를 잘못 보여주면
  # 그 자체가 거짓 신호다(빌드↔S3 순서가 이 스크립트의 핵심 계약이다).
  echo "PLAN (root=$ROOT)"
  for g in "${GATES[@]}"; do echo "  $g"; done
  [[ $WITH_BUILD -eq 1 ]] && echo "  (cd apps/console && npx next build)   ← S3보다 먼저"
  for g in "${CONSOLE_GATES[@]}"; do
    if [[ $WITH_BUILD -eq 0 && "$g" == *check-no-secrets.sh ]]; then
      echo "  $g --rules S1,S2,S4   (S3는 빌드 뒤에만)"
    else
      echo "  $g"
    fi
  done
  exit 0
fi

echo "verify-all — root=$ROOT · gates=${#GATES[@]}+${#CONSOLE_GATES[@]}"
echo

for g in "${GATES[@]}"; do
  case "$g" in
    *.py) gate_run "$g" python3 "$g" ;;
    *)    gate_run "$g" bash "$g" ;;
  esac
done
# ⚠️ 빌드는 콘솔 게이트보다 **먼저**다. S3(번들 노출)는 산출물이 없으면 fail-loud(rc=1)라
#    순서가 반대면 `--with-build`가 **빌드 전에 S3를 돌려 구조적 영구 red**가 된다
#    — release.yml이 정확히 이 형태로 호출한다. [실증 2026-08-03]
if [[ $WITH_BUILD -eq 1 ]]; then
  gate_run "apps/console (next build)" bash -c 'cd apps/console && npx next build'
fi

# 빌드 없이 도는 기본 실행에서는 S3를 판정하지 않는다 — 번들이 있어야 성립하는 검사다.
# 새 클론(= docs/testing.md·AGENTS.md가 "PR 전 표준"으로 지정한 그 명령)에서 rc=1이면
# 게이트가 첫날부터 red다. 이 워크트리에서 rc=0이던 것은 레포의 성질이 아니라
# **묵은 .next 잔재**(2026-08-02 빌드)의 성질이었다. S3는 CI console 잡과 release가 판정한다.
for g in "${CONSOLE_GATES[@]}"; do
  if [[ $WITH_BUILD -eq 0 && "$g" == *check-no-secrets.sh ]]; then
    gate_run "$g (S1,S2,S4 — S3는 빌드 뒤)" bash "$g" --rules S1,S2,S4
  else
    gate_run "$g" bash "$g"
  fi
done

gate_summary
exit $?

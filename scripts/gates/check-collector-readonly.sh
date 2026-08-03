#!/usr/bin/env bash
# AC-E4-1 — 수집기 read-only 게이트 (specs/alert-enrichment §4.2 D4-1)
#
# 무엇을 잡나:
#   귀속 수집기는 **사건 중인 노드**에서 돈다. 디스크가 95%인 상황에서 실수로 무언가를
#   지우거나 옮기는 코드가 섞이면 그것이 2차 사고다. 그래서 노드에서 도는 코드
#   (scripts/collectors/disk-attribution.sh)에는 파괴적 명령도 리다이렉션도 **0건**이어야 한다.
#
#   AC의 원문 패턴은 `rm|mv|chmod|>` 다. 그대로 쓰면 "format"·"perform" 같은 단어가
#   걸려 무의미해지므로 **명령 위치의 단어 경계**로 정밀화했다(정밀화는 완화가 아니다 —
#   chown·dd·truncate·shred·tee·mkfs·`sed -i` 를 더 잡는다). `>` 는 원문대로 **전면 금지**다:
#   그래서 저 스크립트에는 `2>/dev/null` 조차 없고, 원격 stderr 를 숨기지 않는다.
#
#   파일 쓰기는 파서(attribution_lib.py)로 분리했고, 이 게이트는 그 쓰기가
#   write_snapshot() 한 함수 안에만 있는지도 본다 — "노드에서 읽기만"과
#   "data05에 상태 남기기"가 섞이지 않게 하는 경계다.
#
# 이 게이트가 **못** 잡는 것(정직하게):
#   · 런타임 동작. `find -delete` 같은 걸 변수로 조립해 넣으면 정적 검사로는 안 보인다.
#   · SSH 대상 노드에서 sudo 권한이 실제로 무엇을 허용하는지. 그건 sudoers 소관이다.
#   · 파이썬이 subprocess 로 무언가를 실행하는 경우 — 현재 수집기는 subprocess 를 쓰지
#     않으므로 아래 S3가 "subprocess import 0건"으로 그 전제를 고정한다.
#
# exit: 0 통과 / 1 위반
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

SH="scripts/collectors/disk-attribution.sh"
LIB="scripts/collectors/attribution_lib.py"
EXPORT="scripts/collectors/attribution_export.py"

# 명령 위치(줄 시작·파이프·세미콜론·&&·||·sudo·timeout 뒤)의 파괴적 명령.
DESTRUCTIVE='(^|[;&|]|&&|\|\||\bsudo -n |\bsudo |\btimeout [0-9]+ )[[:space:]]*(rm|mv|chmod|chown|dd|truncate|shred|mkfs[a-z.]*|tee|install|rsync)\b'
rc=0

fail() { echo "  FAIL $*" >&2; rc=1; }

check_shell() {
  local f="$1" body hits
  [[ -f "$f" ]] || { fail "$f 없음 — 수집기가 실재하지 않는다"; return; }
  # 주석 행은 제외한다(이 함정을 설명하는 주석이 게이트를 깨뜨리면 자기참조 결함이다).
  body="$(grep -vE '^[[:space:]]*#' "$f")"

  hits="$(printf '%s\n' "$body" | grep -nE "$DESTRUCTIVE" || true)"
  [[ -z "$hits" ]] || { fail "$f — 명령 위치에 파괴적 명령:"; printf '%s\n' "$hits" | sed 's/^/    /' >&2; }

  # 리다이렉션 전면 금지(AC 원문 그대로). `2>/dev/null` 도 금지 — 조용한 실패를 만들지 않는다.
  hits="$(printf '%s\n' "$body" | grep -n '>' || true)"
  [[ -z "$hits" ]] || { fail "$f — 리다이렉션 발견(AC-E4-1: 0건). 주석에는 → 를 써라:"; printf '%s\n' "$hits" | sed 's/^/    /' >&2; }

  # `sed -i` 는 위 패턴에 안 걸리므로 따로 본다.
  hits="$(printf '%s\n' "$body" | grep -nE '\bsed[[:space:]]+-[a-zA-Z]*i' || true)"
  [[ -z "$hits" ]] || { fail "$f — 제자리 편집(sed -i):"; printf '%s\n' "$hits" | sed 's/^/    /' >&2; }
}

check_shell "$SH"

# S2 — 원격에서 실행되는 명령 화이트리스트. remote_script() 힙독 안의 첫 낱말만 본다.
if [[ -f "$SH" ]]; then
  remote="$(sed -n '/^remote_script()/,/^EOS$/p' "$SH")"
  if [[ -z "$remote" ]]; then
    fail "$SH — remote_script() 힙독을 찾지 못했다(게이트가 헛돌고 있다)"
  else
    bad="$(printf '%s\n' "$remote" \
      | grep -oE '(^|\| *)[a-z][a-z0-9_.-]*' \
      | sed 's/^| *//' \
      | sort -u \
      | grep -vwE 'cat|printf|hostname|sudo|if|then|else|fi|timeout|df|du|find|sort|head|date|true|remote_script' || true)"
    if [[ -n "$bad" ]]; then
      fail "$SH — 원격 명령 화이트리스트 밖:"; printf '%s\n' "$bad" | sed 's/^/    /' >&2
    fi
  fi
fi

# S3 — 파이썬: 파일 쓰기는 write_snapshot() 안에만. subprocess 는 아예 없어야 한다.
for f in "$LIB" "$EXPORT"; do
  [[ -f "$f" ]] || { fail "$f 없음"; continue; }
  if grep -nE '^[[:space:]]*(import|from)[[:space:]]+(subprocess|os\.system|shutil)\b' "$f"; then
    fail "$f — 수집기 파서는 외부 명령을 실행하지 않는다(subprocess/shutil 금지)"
  fi
done
if [[ -f "$LIB" ]]; then
  writers="$(grep -nE 'open\([^)]*["'"'"'][wax]' "$LIB" || true)"
  if [[ -n "$writers" ]]; then
    fn="$(awk '/^def write_snapshot/{s=NR} /^def /{if(s&&NR>s){print s"-"NR; exit}} END{if(s&&!f)print s"-"NR}' "$LIB")"
    lo="${fn%%-*}"; hi="${fn##*-}"
    while IFS= read -r line; do
      n="${line%%:*}"
      if [[ -z "$lo" || "$n" -lt "$lo" || "$n" -gt "$hi" ]]; then
        fail "$LIB:$n — 파일 쓰기가 write_snapshot() 밖에 있다"
      fi
    done <<<"$writers"
  fi
  if ! grep -q 'os.makedirs' "$LIB"; then
    fail "$LIB — write_snapshot() 이 사라졌거나 스냅샷 기능이 없다"
  fi
fi

# 역증명 — 일부러 깨진 입력에 게이트가 정말 반응하는지 확인한다.
# (통과만 하는 게이트는 게이트가 아니다.)
tmp="$(mktemp -d)"
printf 'sudo -n rm -rf /tmp/x\nfoo > /tmp/y\n' > "$tmp/bad.sh"
printf 'printf %s "ok"\ntimeout 10 df -B1 /\n' "'%s\\n'" > "$tmp/good.sh"
bad_d=$(grep -cE "$DESTRUCTIVE" "$tmp/bad.sh" || true)
bad_r=$(grep -c '>' "$tmp/bad.sh" || true)
good_d=$(grep -cE "$DESTRUCTIVE" "$tmp/good.sh" || true)
good_r=$(grep -c '>' "$tmp/good.sh" || true)
rm -rf "$tmp"
if [[ "$bad_d" -lt 1 || "$bad_r" -lt 1 || "$good_d" -ne 0 || "$good_r" -ne 0 ]]; then
  echo "  FAIL 역증명 실패 (bad_d=$bad_d bad_r=$bad_r good_d=$good_d good_r=$good_r)" >&2
  rc=1
fi
# "format"·"perform" 같은 단어가 걸리지 않는지도 확인한다(정밀화가 실제로 정밀한가).
if printf 'FMT=json # format\n' | grep -qE "$DESTRUCTIVE"; then
  echo "  FAIL 역증명 실패 — 단어 경계가 무너져 'format' 이 걸린다" >&2
  rc=1
fi

if [[ $rc -eq 0 ]]; then
  echo "COLLECTOR_READONLY_OK (파괴적 명령 0 · 리다이렉션 0 · 원격 명령 화이트리스트 · 쓰기는 write_snapshot 한정)"
else
  echo "COLLECTOR_READONLY_FAIL — spec: specs/alert-enrichment §4.2 D4-1 / AC-E4-1"
fi
exit $rc

#!/usr/bin/env bash
# T-E4-1 — 디스크 귀속 수집기 0단계 (specs/alert-enrichment §4.2 D4-1)
#
# 무엇을 하나:
#   2026-08-03 사건에서 사람이 30분 걸려 손으로 한 추적(df → du → find → 소유자)을
#   한 번의 실행으로 재현한다. 트리거는 둘이다 —
#     ① alert-relay(E3)가 DiskUsageHigh·DiskFillPredicted 수신 시 호출
#     ② 사람이 CLI로 단독 실행 (E3가 없어도 유효해야 한다 — 독립 배포 요건)
#
# 이 파일의 불변 규약 — **읽기 전용**:
#   대상 노드에서 실행하는 것은 df·du·find 세 가지 **읽기 명령뿐**이다.
#   삭제·이동·권한변경 명령과 리다이렉션이 이 파일에 **한 글자도 없다**
#   (게이트: scripts/gates/check-collector-readonly.sh · AC-E4-1).
#   스냅샷 파일 저장은 파서(attribution_lib.py)의 책임으로 분리했고 그 쓰기도
#   스냅샷 디렉터리 한 곳으로 제한된다 — "노드에서 도는 코드"와 "data05에 상태를
#   남기는 코드"를 섞지 않기 위해서다.
#   부작용 하나를 정직하게 적는다: 리다이렉션을 아예 쓰지 않으므로 **인자 오류
#   메시지도 stdout으로 나간다.** 소비자는 stdout을 파싱하기 전에 **종료코드를 먼저**
#   봐야 한다(rc≠0이면 stdout은 JSON이 아니다). 원격 stderr(permission denied 등)는
#   숨기지 않고 그대로 흘려보낸다 — 조용한 실패보다 시끄러운 부분 실패가 낫다(§4.3).
#
# 프라이버시(§4.1 불변):
#   이 스크립트의 출력은 **원문**(전체 경로 포함)이다 — data05 로컬 전용.
#   Slack 반출본은 attribution_export.py 한 곳만 만든다. 이 stdout을 그대로
#   외부로 보내면 안 된다.
#
# usage:
#   disk-attribution.sh --node data04 [--mount /] [--minutes 360]
#                       [--fired-at 2026-08-03T17:59:00+09:00] [--min-size 100M]
#                       [--out json|public|slack|raw|validate] [--no-llm] [--no-sudo]
#                       [--snapshot-dir DIR] [--no-snapshot] [--no-journal]
#   disk-attribution.sh --replay scripts/collectors/fixtures/incident-2026-08-03-data04.raw
#
# exit: 0 성공(부분 수집 포함 — partial 필드가 알린다) / 1 수집 실패 / 64 인자 오류
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARSER="$HERE/attribution_lib.py"

NODE=""
MOUNT="/"
MINUTES=360
MIN_SIZE="100M"
FIRED_AT=""
OUT="json"
SINCE=""
REPLAY=""
PY_FLAGS=()
SSH_PORT="${KEIWI_ATTR_SSH_PORT:-764}"

# 리다이렉션 금지 규약 때문에 진단도 stdout으로 나간다(위 주석 참고).
die() { printf 'disk-attribution ERROR: %s\n' "$1"; exit "${2:-64}"; }

# 노드 → SSH 대상(계정@호스트). 호스트는 사설 IP라 공개돼도 무해하지만 **계정명은 적지
# 않는다** — 실재하는 사람의 OS 계정이고 이 레포는 PUBLIC이다(§13). 주입은 env 두 갈래:
#   KEIWI_ATTR_TARGET_data04=user@host   대상 전체 지정(우선 — 호스트까지 바꿀 때)
#   KEIWI_USER_DATA04 / KEIWI_NODE_USER  계정만 지정(호스트는 아래 표 · ansible과 같은 이름)
# 둘 다 없으면 **빈 문자열**을 돌려 호출부가 die 한다. 현재 사용자로 조용히 붙지 않는 것이
# 요점이다 — 잘못된 계정으로 붙으면 권한 오류가 "수집 실패"로 뭉개져 원인이 안 보인다.
node_target() {
  local override user
  override="$(printenv "KEIWI_ATTR_TARGET_$1" || true)"
  if [[ -n "$override" ]]; then printf '%s' "$override"; return 0; fi
  [[ "$1" == "data05" ]] && { printf 'local'; return 0; }   # 관제 호스트 자신 — SSH 불필요
  user="$(printenv "KEIWI_USER_${1^^}" || true)"
  [[ -n "$user" ]] || user="${KEIWI_NODE_USER:-}"
  [[ -n "$user" ]] || { printf ''; return 0; }
  case "$1" in
    data01) printf '%s@192.168.1.101' "$user" ;;
    data03) printf '%s@192.168.1.103' "$user" ;;
    data04) printf '%s@192.168.1.104' "$user" ;;
    *)      printf '' ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --node)         NODE="${2:-}"; shift 2 ;;
    --mount)        MOUNT="${2:-}"; shift 2 ;;
    --minutes)      MINUTES="${2:-}"; shift 2 ;;
    --min-size)     MIN_SIZE="${2:-}"; shift 2 ;;
    --fired-at)     FIRED_AT="${2:-}"; shift 2 ;;
    --out)          OUT="${2:-}"; shift 2 ;;
    # ── E3 relay 호출 계약(alert_relay.py run_collector) 별칭 ──
    # relay 는 `--node <dataNN> --mount <path> --since <RFC3339> --json` 로 부른다.
    # 호출자(relay)가 아니라 피호출자(여기)가 맞추는 것이 싸다 — 계약은 relay 쪽이 정본이다.
    --json)         OUT="json"; shift ;;
    --since)        SINCE="${2:-}"; shift 2 ;;
    --replay)       REPLAY="${2:-}"; shift 2 ;;
    --snapshot-dir) PY_FLAGS+=(--snapshot-dir "${2:-}"); shift 2 ;;
    --no-snapshot)  PY_FLAGS+=(--no-snapshot); shift ;;
    --no-journal)   PY_FLAGS+=(--no-journal); shift ;;
    --no-llm)       PY_FLAGS+=(--no-llm); shift ;;
    --no-sudo)      PY_FLAGS+=(--force-no-sudo); shift ;;
    -h|--help)      sed -n '/^# usage:/,/^# exit:/p' "$0" | sed 's/^# \{0,1\}//'; exit 64 ;;
    *)              die "unknown arg: $1" ;;
  esac
done

[[ -f "$PARSER" ]] || die "파서를 찾을 수 없다: $PARSER" 1
# validate = 스냅샷은 남기고 저널엔 한 줄만(일일 베이스라인 타이머가 쓰는 모드).
[[ "$OUT" =~ ^(json|public|slack|raw|validate)$ ]] \
  || die "--out 은 json|public|slack|raw|validate: $OUT"

# 원격에서 돌 스크립트. 읽기 명령 3종뿐이고 각각 timeout 상한을 둔다
# (§4.5 위험: du 가 대형 트리에서 느리다 → -d 2 + timeout).
# sudo 가능 여부를 먼저 찍고, 불가하면(data05 실측) 비sudo 로 축소 수집한다 — 죽지 않는다.
remote_script() {
  cat <<EOS
printf '#SECTION host\n'
hostname
printf '#SECTION sudo_probe\n'
if sudo -n true; then printf 'sudo=1\n'; else printf 'sudo=0\n'; fi
printf '#SECTION df\n'
timeout 20 df -B1 --output=target,size,used,avail,pcent '$MOUNT'
printf '#SECTION du_home\n'
if sudo -n true; then
  timeout 90 sudo -n du -x -B1 -d 2 /home | sort -rn | head -60
else
  timeout 90 du -x -B1 -d 2 /home | sort -rn | head -60
fi
printf '#SECTION recent_files\n'
if sudo -n true; then
  timeout 240 sudo -n find '$MOUNT' -xdev -type f -size +$MIN_SIZE -mmin -$MINUTES -printf '%s|%TY-%Tm-%TdT%TH:%TM|%u|%p\n' | sort -rn | head -80
else
  timeout 240 find '$MOUNT' -xdev -type f -size +$MIN_SIZE -mmin -$MINUTES -printf '%s|%TY-%Tm-%TdT%TH:%TM|%u|%p\n' | sort -rn | head -80
fi
printf '#SECTION collected\n'
date -Iseconds
printf '#SECTION end\n'
EOS
}

collect() {
  local target script
  target="$(node_target "$NODE")"
  [[ -n "$target" ]] || die "노드 대상 미확정: $NODE — KEIWI_USER_${NODE^^} 또는 KEIWI_NODE_USER(계정만), 혹은 KEIWI_ATTR_TARGET_$NODE(계정@호스트)를 설정하라"
  script="$(remote_script)"
  if [[ "$target" == "local" ]]; then
    printf '#TRANSPORT local\n'
    printf '%s\n' "$script" | bash -s
  else
    printf '#TRANSPORT ssh %s port=%s\n' "$target" "$SSH_PORT"
    printf '%s\n' "$script" | ssh -o BatchMode=yes -o ConnectTimeout=10 \
      -o StrictHostKeyChecking=accept-new -p "$SSH_PORT" "$target" 'bash -s'
  fi
}

envelope() {
  printf '#META node=%s mount=%s minutes=%s min_size=%s fired_at=%s launched_at=%s\n' \
    "$NODE" "$MOUNT" "$MINUTES" "$MIN_SIZE" "${FIRED_AT:--}" "$(date -Iseconds)"
  collect
}

if [[ -n "$REPLAY" ]]; then
  # 리플레이: 이미 수집된 원문 봉투를 그대로 파서에 먹인다(픽스처 회귀 · AC-E4-2).
  # --node 는 봉투의 #META 를 따르므로 생략 가능하다.
  [[ -f "$REPLAY" ]] || die "리플레이 파일 없음: $REPLAY" 1
  RAW="$(cat -- "$REPLAY")"
else
  [[ -n "$NODE" ]] || die "--node 는 필수다 (data01|data03|data04|data05)"
  # --since 는 relay 가 넘기는 **알림 발화 시각**(startsAt)이다. 그런데 원인은 발화보다
  # **앞서** 일어난다 — 2026-08-03 사건도 17:45~48 작업이 17:59 발화를 만들었다.
  # 그래서 창은 [since − MINUTES, now] 다: `--minutes`(기본 360)가 **발화 전 되짚기 폭**이고
  # (spec §4.2 "발화 전 6h"), 발화 이후 구간도 함께 본다(디스크는 계속 찼을 수 있다).
  if [[ -n "$SINCE" ]]; then
    since_s="$(date -d "$SINCE" +%s)" || die "--since 를 해석할 수 없다: $SINCE"
    if [[ "$since_s" =~ ^[0-9]+$ ]]; then
      MINUTES=$(( ( $(date +%s) - since_s + 59 ) / 60 + MINUTES ))
      [[ "$MINUTES" -lt 30 ]] && MINUTES=30           # 너무 좁으면 증거가 안 잡힌다
      [[ "$MINUTES" -gt 4320 ]] && MINUTES=4320       # 3일 상한 — find 가 노드를 갈지 않게
    else
      die "--since 를 해석할 수 없다: $SINCE"
    fi
  fi
  [[ "$MINUTES" =~ ^[0-9]+$ ]] || die "--minutes 는 정수여야 한다: $MINUTES"
  [[ "$MIN_SIZE" =~ ^[0-9]+[kMG]?$ ]] || die "--min-size 는 find -size 표기여야 한다: $MIN_SIZE"
  [[ "$MOUNT" =~ ^/[A-Za-z0-9._/-]*$ ]] || die "--mount 는 절대경로여야 한다: $MOUNT"
  RAW="$(envelope)"
fi

if [[ "$OUT" == "raw" ]]; then
  printf '%s\n' "$RAW"
  exit 0
fi

printf '%s\n' "$RAW" | python3 "$PARSER" --out "$OUT" ${PY_FLAGS[@]+"${PY_FLAGS[@]}"}
rc=$?
exit "$rc"

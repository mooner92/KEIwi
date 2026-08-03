#!/usr/bin/env bash
# T2-10 — 물리 디스크 SMART 메트릭 승인 목록 게이트 (spec §2.2 D2-3 ↔ 수집기 템플릿)
#
# 무엇을 막는가
#   "근거 없는 메트릭"이다. SMART JSON에는 벤더 상대값이 잔뜩 있고(eccdelayed 405 같은),
#   그중 고장 신호가 아닌 것을 방출하면 정상 디스크가 대시보드에서 빨개진다.
#   반대로 승인해 놓고 구현하지 않으면 패널이 영구 공백이 되는데, 빈 패널은
#   "문제가 없어서 비어 있다"와 구분되지 않는다 — 이 축이 고치려는 실패모드 그 자체다.
#   그래서 **양방향**으로 본다: 승인 목록 외 0건 AND 미구현 0건.
#
# 승인 목록의 정본은 spec §2.2 D2-3 표다(코드가 아니라 스펙이 계약을 소유한다).
# 구현 쪽은 roles/disk-smart-textfile/templates/keiwi-disk-smart.sh.j2 전체에서
#   `node_smart_*` 토큰을 훑는다 — HELP/TYPE 카탈로그든 python emit() 인자든
#   주석이든, 이 파일에 그 이름이 적혔다면 그것은 계약의 일부다.
#
# --render-check
#   render-smart-fixture.sh(헬퍼)로 고정 픽스처 4+1건을 **실제 수집기로** 렌더해
#   노출 형식을 검사한다. 엔진은 promtool.sh --which 가 정한다:
#     promtool 있음 → `promtool check metrics` / 없음 → `tools/promtool_fallback.py check-metrics`
#   ⚠️ 어느 쪽이든 `EXPOSITION_OK engine=…` + rc=0 이어야 한다. SKIP 을 만들지 않는다(AC-2-6).
#
# ⚠️ 이 게이트가 **못 잡는 것** (정직하게)
#   - 값이 옳은지. GDL 773 이 진짜 그 디스크의 결함 수인지는 라이브 대조(AC-2-2)의 몫이다.
#   - 라벨 스키마. 표의 라벨 목록과 실제 라벨이 어긋나도 이름만 같으면 통과한다.
#   - 폴백 엔진일 때의 히스토그램/서머리 의미 정합(§0.2.2 — 폴백은 형식 lint 까지다).
#   - 대시보드·규칙이 이 이름들을 실제로 쓰는지 → check-promql-metrics.sh 소관.
#
# usage:
#   check-smart-metric-allowlist.sh                 승인 목록 대조 + 렌더 검사 둘 다
#   check-smart-metric-allowlist.sh --render-check  렌더·노출 형식 검사만
#   check-smart-metric-allowlist.sh --allowlist     승인 목록 대조만
#   check-smart-metric-allowlist.sh --self-test     역증명(승인 외 이름을 심어 rc=1 을 확인)
#
# exit: 0 통과 / 1 위반 / 2 환경 부족(SKIP)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SPEC="$ROOT/specs/fleet-hardening/spec.md"
TEMPLATE="$ROOT/infra/ansible/roles/disk-smart-textfile/templates/keiwi-disk-smart.sh.j2"
FALLBACK="$ROOT/tools/promtool_fallback.py"

MODE="all"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --render-check) MODE="render" ;;
    --allowlist)    MODE="allowlist" ;;
    --self-test)    MODE="self-test" ;;
    -h|--help) sed -n '/^# usage:/,/^# exit:/p' "$0" >&2; exit 64 ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
  shift
done

command -v python3 >/dev/null 2>&1 || { echo "SKIP(env: python3)" >&2; exit 2; }

# ── 승인 목록 대조 ───────────────────────────────────────────────────────────
# $1 = 검사할 템플릿 경로(자기검사에서 변조본을 넘긴다)
allowlist_check() {
  SPEC="$SPEC" TEMPLATE="$1" python3 - <<'PY'
import os
import re
import sys

spec_path = os.environ["SPEC"]
tpl_path = os.environ["TEMPLATE"]
NAME_RE = re.compile(r"node_smart_[a-z0-9_]+")

for path in (spec_path, tpl_path):
    if not os.path.isfile(path):
        print("  FAIL 파일 없음: %s" % path)
        sys.exit(1)

spec = open(spec_path, encoding="utf-8").read()
# D2-3 절만 잘라낸다. 스펙 다른 곳(AC·위험표)이 같은 이름을 언급하지만 그건 승인 행위가 아니다.
start = spec.find("#### D2-3.")
end = spec.find("#### D2-4.", start + 1)
if start < 0 or end < 0:
    print("  FAIL spec §2.2 D2-3 절을 찾지 못했다 — 승인 목록의 정본이 사라졌다")
    sys.exit(1)
section = spec[start:end]

# 표 안의 백틱 코드 스팬만 본다. "만들지 않는다" 목록은 표 밖이라 자연히 제외된다.
approved = set()
for span in re.findall(r"`([^`]+)`", section):
    approved.update(NAME_RE.findall(span))

template = open(tpl_path, encoding="utf-8").read()
implemented = set(NAME_RE.findall(template))

extra = sorted(implemented - approved)
missing = sorted(approved - implemented)
for name in extra:
    print("  FAIL 승인 목록 외 메트릭: %s (spec §2.2 D2-3 표에 없다)" % name)
for name in missing:
    print("  FAIL 승인했는데 미구현: %s (표에 있으나 수집기가 내지 않는다)" % name)
if extra or missing:
    print("SMART_ALLOWLIST_FAIL — 승인 목록 외 %d건, 미구현 %d건" % (len(extra), len(missing)))
    sys.exit(1)
print("OK: 승인 목록 외 0건, 미구현 0건 (승인 %d종)" % len(approved))
sys.exit(0)
PY
}

# ── 렌더 + 노출 형식 검사 ────────────────────────────────────────────────────
render_check() {
  local prom engine out st
  prom="$(mktemp)"
  # shellcheck disable=SC2064  # 지금의 $prom 값을 고정해 지우는 것이 의도다
  trap "rm -f '$prom'" RETURN

  if ! bash "$HERE/render-smart-fixture.sh" --out "$prom"; then
    echo "SMART_RENDER_FAIL — 픽스처 렌더 실패" >&2
    return 1
  fi
  if [[ ! -s "$prom" ]]; then
    echo "SMART_RENDER_FAIL — 렌더 결과가 비었다" >&2
    return 1
  fi

  # promtool.sh --which 는 해석 경로(path|docker|cache|none)를 준다.
  # 게이트가 찍는 엔진 이름은 §0.2.2 계약상 promtool|structural 둘뿐이다(check-rules.sh 동형).
  if [[ "$(bash "$HERE/promtool.sh" --which 2>/dev/null)" == "none" ]]; then
    engine=structural
  else
    engine=promtool
  fi

  if [[ "$engine" == "promtool" ]]; then
    out="$(bash "$HERE/promtool.sh" --run check metrics < "$prom" 2>&1)"; st=$?
  else
    if [[ ! -f "$FALLBACK" ]]; then
      echo "  FAIL 폴백 엔진 없음: $FALLBACK" >&2
      return 1
    fi
    out="$(python3 "$FALLBACK" check-metrics "$prom" 2>&1)"; st=$?
  fi
  if [[ $st -ne 0 ]]; then
    echo "$out" >&2
    echo "SMART_EXPOSITION_FAIL engine=$engine"
    return 1
  fi
  [[ -n "$out" ]] && echo "$out" >&2

  # 렌더된 .prom 에 승인 목록 밖 이름이 섞이지 않았는지 한 번 더 본다.
  # 템플릿 스캔은 "적혀 있는 이름", 이건 "실제로 나온 이름"이라 층이 다르다.
  PROM="$prom" SPEC="$SPEC" python3 - <<'PY' || return 1
import os
import re
import sys

NAME_RE = re.compile(r"node_smart_[a-z0-9_]+")
spec = open(os.environ["SPEC"], encoding="utf-8").read()
start = spec.find("#### D2-3.")
end = spec.find("#### D2-4.", start + 1)
approved = set()
for span in re.findall(r"`([^`]+)`", spec[start:end]):
    approved.update(NAME_RE.findall(span))

observed = set()
samples = 0
for line in open(os.environ["PROM"], encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    if line.startswith("#"):
        continue
    samples += 1
    observed.add(line.split("{")[0].split(" ")[0])

extra = sorted(observed - approved)
for name in extra:
    print("  FAIL 렌더 결과에 승인 외 메트릭: %s" % name)
if extra:
    sys.exit(1)
if samples == 0:
    print("  FAIL 렌더 결과에 샘플이 0개 — 픽스처가 아무것도 만들지 못했다")
    sys.exit(1)
print("  렌더 샘플 %d행 · 계열 %d종 (승인 외 0건)" % (samples, len(observed)))
sys.exit(0)
PY

  echo "EXPOSITION_OK engine=$engine"
  return 0
}

# ── 역증명 — 승인 목록 밖 이름을 심으면 정말 rc=1 인가 ───────────────────────
self_test() {
  local work bad rc
  work="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$work'" RETURN
  bad="$work/keiwi-disk-smart.sh.j2"
  cp "$TEMPLATE" "$bad"
  # 승인 목록에 없는 이름 1건을 주석으로 심는다(렌더 동작은 그대로 두고 계약만 위반시킨다).
  printf '\n# 자기검사용 위반 심기: node_smart_disk_ssd_life_percent\n' >> "$bad"
  allowlist_check "$bad" >/dev/null 2>&1
  rc=$?
  if [[ $rc -ne 1 ]]; then
    echo "SELF-TEST 실패: 승인 외 이름을 심었는데 rc=$rc (기대 1) — 이 게이트는 아무것도 잡지 못한다"
    return 1
  fi
  # 반대 방향(미구현)도 잡는지: 구현에서 이름 하나를 지운다.
  cp "$TEMPLATE" "$bad"
  python3 - "$bad" <<'PY'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
text = text.replace("node_smart_disk_grown_defect_list", "node_smart_disk_gdl")
open(path, "w", encoding="utf-8").write(text)
PY
  allowlist_check "$bad" >/dev/null 2>&1
  rc=$?
  if [[ $rc -ne 1 ]]; then
    echo "SELF-TEST 실패: 승인 메트릭을 지웠는데 rc=$rc (기대 1)"
    return 1
  fi
  echo "OK: self-test passed — 승인 외·미구현 양방향 모두 rc=1 확인"
  return 0
}

case "$MODE" in
  self-test) self_test; exit $? ;;
  allowlist) allowlist_check "$TEMPLATE"; exit $? ;;
  render)    render_check; exit $? ;;
  all)
    allowlist_check "$TEMPLATE" || exit 1
    render_check || exit 1
    exit 0 ;;
esac

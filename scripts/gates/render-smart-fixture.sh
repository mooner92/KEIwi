#!/usr/bin/env bash
# T2-10 헬퍼 — 고정 JSON 픽스처로 물리 디스크 SMART 수집기를 실제로 돌려 .prom 을 만든다.
#
# ⚠️ 이 파일은 **게이트가 아니라 헬퍼**다. 이름이 `check-` 로 시작하지 않아
#    verify-all.sh 글롭에 잡히지 않는다(spec §0.2) — 반드시
#    scripts/gates/check-smart-metric-allowlist.sh 가 호출한다.
#
# 무엇을 하나
#   ① roles/disk-smart-textfile/defaults/main.yml 의 값으로 keiwi-disk-smart.sh.j2 를
#      **Ansible 과 같은 Jinja2 로** 렌더한다(치환기를 따로 만들면 두 벌이 갈라진다).
#   ② 가짜 sysfs(/sys/class/scsi_generic 모사)와 스텁 smartctl 을 만든다.
#      스텁은 `-d cciss,N` 의 N 으로 픽스처 파일을 골라 stdout 에 붓고 실제 종료코드를 흉내낸다.
#   ③ 렌더된 수집기를 **그대로** 실행한다 — 조립 로직을 재구현하지 않는다.
#   ④ 생성된 .prom 을 stdout(또는 --out PATH)으로 낸다.
#
# 픽스처(전부 2026-08-03 라이브 캡처. 손으로 지어낸 JSON 은 실제 스키마와 갈라진다):
#   0 = data03 SAS(정상, GDL 0)  1 = data04 SATA SSD  2 = data04 SAS(열화, GDL 773)
#   3 = HPE Smart Adapter(디스크 아님)  4+ = 부재(No such device or address)
#
# 이 헬퍼가 **증명하지 못하는 것**(정직하게)
#   · 실제 컨트롤러에서 `-d cciss,N` 이 동작하는지 — 그건 라이브 태스크(T2-13·T2-14)의 몫이다.
#   · sysfs type 12 탐색이 실기에서 맞는지 — 가짜 sysfs 는 우리가 만든 것이다.
#   · 값의 의미(773이 진짜 그 디스크의 결함 수인지) — AC-2-2 가 라이브에서 대조한다.
#
# exit: 0 성공 / 1 렌더·실행 실패 / 2 환경 부족(python3·jinja2·PyYAML 없음)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ROLE="$ROOT/infra/ansible/roles/disk-smart-textfile"
FIXTURES="$HERE/fixtures/disk-smart"

OUT=""
KEEP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)  shift; OUT="${1:-}" ;;
    --keep) KEEP=1 ;;   # 작업 디렉터리를 남긴다(디버깅용)
    -h|--help) sed -n '/^# usage/,$p;/^# exit:/q' "$0" >&2
               echo "usage: render-smart-fixture.sh [--out PATH] [--keep]" >&2; exit 64 ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
  shift
done

command -v python3 >/dev/null 2>&1 || { echo "SKIP(env: python3)" >&2; exit 2; }
python3 -c 'import yaml, jinja2' >/dev/null 2>&1 || {
  echo "SKIP(env: PyYAML·Jinja2) — Ansible 과 같은 렌더러가 필요하다" >&2; exit 2; }
[[ -d "$FIXTURES" ]] || { echo "픽스처 디렉터리 없음: $FIXTURES" >&2; exit 1; }

WORK="$(mktemp -d)"
if [[ $KEEP -eq 0 ]]; then trap 'rm -rf "$WORK"' EXIT; else echo "workdir: $WORK" >&2; fi

# ── ① 템플릿 렌더 (Ansible 과 동일한 Jinja2) ─────────────────────────────────
ROLE="$ROLE" WORK="$WORK" python3 - <<'PY' || exit 1
import os
import jinja2
import yaml

role = os.environ["ROLE"]
work = os.environ["WORK"]
with open(os.path.join(role, "defaults", "main.yml"), encoding="utf-8") as fh:
    defaults = yaml.safe_load(fh)
with open(os.path.join(role, "templates", "keiwi-disk-smart.sh.j2"), encoding="utf-8") as fh:
    src = fh.read()
env = jinja2.Environment(keep_trailing_newline=True, undefined=jinja2.StrictUndefined)
rendered = env.from_string(src).render(**defaults)
with open(os.path.join(work, "keiwi-disk-smart.sh"), "w", encoding="utf-8") as fh:
    fh.write(rendered)
PY
chmod 0755 "$WORK/keiwi-disk-smart.sh"

# ── ② 가짜 sysfs — 컨트롤러(type 12) 1개 + 논리 볼륨(type 0) + 인클로저(type 13) ──
# 논리 볼륨·인클로저를 일부러 섞는다. 탐색이 그것들을 잡으면 우리는 다시 LV 만 보게 되고,
# 그게 이 축이 고치려는 상태다.
mkfake() {  # $1=sg 이름  $2=type  $3=model
  mkdir -p "$WORK/sys/$1/device"
  printf '%s\n' "$2" > "$WORK/sys/$1/device/type"
  printf '%-16s\n' "$3" > "$WORK/sys/$1/device/model"
  printf 'HPE     \n' > "$WORK/sys/$1/device/vendor"
}
mkfake sg0 13 "Smart Adapter"
mkfake sg1 0  "LOGICAL VOLUME"
mkfake sg2 12 "P816i-a SR Gen10"

# ── ③ 스텁 smartctl — `-d cciss,N` 의 N 으로 픽스처를 고른다 ──────────────────
cat > "$WORK/smartctl" <<STUB
#!/usr/bin/env bash
# 픽스처 스텁. 실제 smartctl 의 계약 중 이 수집기가 의존하는 부분만 흉내낸다:
#   · --json 응답을 stdout 으로 낸다
#   · 종료코드는 비트마스크다(부재·어댑터 = 2). 0 이 아닌 값이 정상 응답일 수 있다.
idx=""
for arg in "\$@"; do
  case "\$arg" in
    cciss,*) idx="\${arg#cciss,}" ;;
    --version) echo "smartctl 7.4 2023-08-01 r5530 [fixture]"; exit 0 ;;
  esac
done
[ -n "\$idx" ] || exit 1
case "\$idx" in
  0) cat "$FIXTURES/00-sas-data03.json"; exit 0 ;;
  1) cat "$FIXTURES/01-sata-ssd-data04.json"; exit 0 ;;
  2) cat "$FIXTURES/02-sas-degraded-data04.json"; exit 0 ;;
  3) cat "$FIXTURES/03-adapter.json"; exit 2 ;;
  *) cat "$FIXTURES/04-absent.json"; exit 2 ;;
esac
STUB
chmod 0755 "$WORK/smartctl"

mkdir -p "$WORK/textfile"

# ── ④ 렌더된 수집기를 그대로 실행 ────────────────────────────────────────────
KEIWI_SMART_TEXTFILE_DIR="$WORK/textfile" \
KEIWI_SMART_SMARTCTL="$WORK/smartctl" \
KEIWI_SMART_SYSFS_DIR="$WORK/sys" \
  bash "$WORK/keiwi-disk-smart.sh"
rc=$?
if [[ $rc -ne 0 ]]; then
  echo "수집기 실행 실패 rc=$rc" >&2
  exit 1
fi

PROM="$WORK/textfile/keiwi_disk_smart.prom"
[[ -f "$PROM" ]] || { echo ".prom 이 생성되지 않았다: $PROM" >&2; exit 1; }

if [[ -n "$OUT" ]]; then
  cp "$PROM" "$OUT"
else
  cat "$PROM"
fi
exit 0

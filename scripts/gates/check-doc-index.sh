#!/usr/bin/env bash
# 문서 색인 무결성 — 새로 만든 문서가 색인에 연결됐는가
#
# 왜 이 게이트가 있나 (2026-08-04 실측):
#   런북 16종은 전부 docs/README.md에 등재돼 있었는데, specs 4종(alert-enrichment·
#   external-watchdog·fleet-hardening·auto-remediation)과 infra 4종(rag·alert-relay·bmc·
#   error-tracking)은 **색인 0/3**이었다. 차이는 하나 — 런북에는 게이트(check-runbooks R9)가
#   있었고 나머지엔 없었다. **게이트가 있는 곳만 지켜졌다.**
#   문서는 만든 사람만 알고 있으면 없는 것과 같다. 특히 이 레포는 1인 운영이라
#   "나중에 찾겠지"가 통하지 않는다 — 6개월 뒤의 나는 남이다.
#
#   같은 실측에서 ADR 번호 충돌도 나왔다: auto-remediation 스펙이 "ADR-0023/0024 신설"이라
#   썼는데 그 번호는 이미 다른 ADR(ci-pipeline·smart-collection)이 쓰고 있었다. 번호가
#   중복되면 "어느 결정인가"를 말할 수 없게 된다.
#
# 이 게이트가 **못** 잡는 것(정직하게):
#   - 색인 항목의 **내용이 맞는지**. 링크가 걸려 있고 파일이 있으면 통과한다.
#     "상태" 열이 낡은 것(🔄인데 완료됨)은 사람이 본다.
#   - 문서 자체의 품질·최신성. last_verified는 런북 게이트 소관이다.
#   - specs 하위의 개별 md(spec.md·tasks.md 등). 디렉터리 대표 문서만 본다.
#
# exit: 0 통과 / 1 위반
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 1

fails=0
fail() { echo "  FAIL($1) $2" >&2; fails=$((fails + 1)); }

# ── D1: specs/<name>/ 이 docs/README.md 스펙 표에 있는가 ────────────────────
for d in specs/*/; do
  name="$(basename "$d")"
  # 대표 문서가 없는 디렉터리(설계 산출물 모음 등)는 색인 대상에서 제외한다.
  [[ -f "$d/README.md" || -f "$d/spec.md" || -f "$d/backlog.md" ]] || continue
  grep -q "specs/$name/" docs/README.md || fail "D1" "specs/$name — docs/README.md 스펙 표에 없다"
done

# ── D2: infra/<area>/README.md 가 docs/README.md 인프라 표에 있는가 ─────────
#      깊이 2만 본다 — infra/monitoring/gpu-model-exporter 같은 **하위 컴포넌트**는
#      상위 영역 README가 덮는다. 색인의 단위는 컴포넌트가 아니라 영역이다.
while IFS= read -r f; do
  rel="${f#./}"; area="$(dirname "$rel")"
  grep -q "$area" docs/README.md || fail "D2" "$area — docs/README.md 인프라 표에 없다"
done < <(find ./infra -mindepth 2 -maxdepth 2 -name README.md)

# ── D3: ADR 번호 중복 ───────────────────────────────────────────────────────
dup="$(for f in docs/decisions/[0-9]*.md; do
  [[ -e "$f" ]] || continue
  b="$(basename "$f")"; echo "${b:0:4}"
done | sort | uniq -d)"
[[ -n "$dup" ]] && fail "D3" "ADR 번호 중복: $dup"

# ── D4: 문서가 참조하는 ADR 번호가 실존하거나, 미작성이면 그렇게 표시됐는가 ──
#      "ADR-0026"처럼 참조만 하고 파일이 없으면 — 신설 예정이면 문서에 '신설'·'예정'·
#      '대기' 같은 말이 같은 줄에 있어야 한다. 없으면 죽은 참조다.
while IFS=: read -r file line ref; do
  num="${ref#ADR-}"
  ls "docs/decisions/${num}-"*.md >/dev/null 2>&1 && continue
  ctx="$(sed -n "${line}p" "$file")"
  echo "$ctx" | grep -qE '신설|예정|대기|미작성|작성한다|채택 후' && continue
  fail "D4" "$file:$line — $ref 참조인데 파일이 없고 '신설/예정' 표시도 없다"
done < <(grep -rnoE 'ADR-[0-9]{4}' --include='*.md' specs docs README.md AGENTS.md 2>/dev/null \
         | awk -F: '{print $1":"$2":"$3}' | sort -u)

# ── D5: 색인이 가리키는 상대 링크가 실존하는가 ──────────────────────────────
while IFS= read -r l; do
  tgt="$(cd docs 2>/dev/null && realpath -m "$l" 2>/dev/null)"
  [[ -e "$tgt" ]] || fail "D5" "docs/README.md → $l 가 없다"
done < <(grep -oE '\]\(\.\./[^)#]+' docs/README.md | sed 's/](//' | sort -u)

if [[ "${1:-}" == "--self-test" ]]; then
  # 역증명 — 게이트가 실제로 무는지. 임시 스펙 디렉터리를 만들어 D1이 잡는지 본다.
  # ⚠️ 이름을 `.`로 시작하면 안 된다 — `for d in specs/*/` glob이 dotfile을 매칭하지 않아
  #    D1이 구조적으로 못 보고, self-test가 **항상 통과**하는 장식이 된다[2026-08-04 실측].
  tmp="specs/zz-gate-selftest-$$"
  mkdir -p "$tmp" && echo "# probe" > "$tmp/README.md"
  out="$(bash "$0" 2>&1)"; rc=$?
  rm -rf "$tmp"
  if [[ $rc -eq 1 ]] && echo "$out" | grep -q "gate-selftest"; then
    echo "SELF_TEST_OK (D1이 미색인 스펙을 잡는다)"; exit 0
  fi
  echo "SELF_TEST_FAIL (rc=$rc — 미색인 디렉터리를 못 잡았다)"; exit 1
fi

if [[ $fails -eq 0 ]]; then
  echo "DOC_INDEX_OK (D1 스펙 · D2 인프라 · D3 ADR중복 · D4 죽은참조 · D5 링크)"
  exit 0
fi
echo "DOC_INDEX_FAIL — 위반 $fails건. 문서는 색인에 없으면 없는 것과 같다." >&2
exit 1

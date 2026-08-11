#!/usr/bin/env bash
# RAG 색인 정직성 게이트 — "색인 통계가 실패를 숨기지 않는가"
#
# 무엇을 지키는가:
#   2026-08-04 색인은 64문서 중 50개가 실패했는데 ingest_stats.json은
#   `"documents": 64` 를 찍었다. ingest.py가 **투입** 문서 수(kv_store_full_docs의
#   길이)를 성공 수로 보고했기 때문이다. 아무도 실패를 보지 못했고, 그 위에
#   콘솔 어시스턴트 기능이 얹혔다. **거짓 초록**이다.
#
#   이 게이트는 그 회귀를 막는다. 색인이 실제로 성공했는지는 검사하지 않는다
#   (그건 ingest.py의 종료코드가 판정한다) — 검사하는 것은 **판정 로직이
#   실패를 실패라고 부르는가** 하나뿐이다.
#
# 검사 규칙:
#   R1  index_health가 doc_status의 failed를 세고 ready=False로 내린다        FAIL
#   R2  빈 색인·스토리지 부재를 ready=True로 부르지 않는다                     FAIL
#   R3  전부 processed일 때만 ready=True + rc=0                              FAIL
#   R4  ingest.py가 kv_store_full_docs 길이를 'documents'로 쓰지 않는다        FAIL
#       (거짓 초록의 원인 코드가 되살아나는 것을 문법 수준에서 막는다)
#   R5  ingest.py가 실패 시 non-zero로 끝나는 경로를 갖는다                    FAIL
#
# 못 하는 것(정직하게):
#   · 색인 **품질**(검색이 옳은 문서를 찾는가)은 판정하지 않는다.
#   · 실제 색인 실행은 하지 않는다 — LLM·임베딩 서비스가 필요하고 10분이 걸린다.
#     여기서는 픽스처 doc_status로 판정 로직만 검증한다.
#   · ollama bge-m3의 NaN 자체는 못 막는다(런타임 버그). 완화는 common.py에 있고
#     이 게이트의 범위가 아니다.
#
# 종료코드: 0 통과 / 1 위반 / 2 환경 부족(python3 없음)
# usage: scripts/gates/check-rag-index-honesty.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RAG_DIR="$ROOT/infra/rag"
FAIL=0

note() { printf '   %s\n' "$*"; }
violation() { printf 'FAIL: %s\n' "$*"; FAIL=1; }

command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 없음"; exit 2; }
[[ -f "$RAG_DIR/index_health.py" ]] || { violation "infra/rag/index_health.py 없음"; exit 1; }
[[ -f "$RAG_DIR/ingest.py" ]] || { violation "infra/rag/ingest.py 없음"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── R1~R3: 픽스처로 판정 로직을 행동 검증한다 ────────────────────────────────
mkfixture() {  # mkfixture <이름> <doc_status JSON>
  local name="$1" json="$2"
  mkdir -p "$TMP/$name/storage"
  printf '%s' "$json" > "$TMP/$name/storage/kv_store_doc_status.json"
}

mkfixture mixed '{"a":{"status":"processed","file_path":"ok.md"},
                  "b":{"status":"failed","file_path":"bad.md","error_msg":"NaN"}}'
mkfixture empty '{}'
mkfixture allok '{"a":{"status":"processed","file_path":"ok.md"},
                  "b":{"status":"processed","file_path":"ok2.md"}}'
mkfixture pend  '{"a":{"status":"processed","file_path":"ok.md"},
                  "b":{"status":"pending","file_path":"wip.md"}}'
mkdir -p "$TMP/missing"   # 스토리지 자체가 없는 경우

run_health() {  # run_health <픽스처> -> "rc|출력"
  local out rc
  out="$(KEIWI_RAG_DIR="$TMP/$1" python3 "$RAG_DIR/index_health.py" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

# R1 — 실패가 섞이면 ready=False + rc=1 + 실패 파일명 노출
res="$(run_health mixed)"; rc="${res%%|*}"; out="${res#*|}"
if [[ "$rc" == "0" ]]; then
  violation "R1 실패 문서가 있는데 rc=0 (거짓 초록)"
elif ! grep -q 'ready=False' <<<"$out"; then
  violation "R1 실패 문서가 있는데 ready=False 아님"
elif ! grep -q 'failed_docs=1' <<<"$out"; then
  violation "R1 failed_docs가 통계에 없음 — 실패가 숨겨진다"
elif ! grep -q 'bad.md' <<<"$out"; then
  violation "R1 실패 문서 목록을 출력하지 않음"
else
  note "R1 OK — 실패 1건 → ready=False, rc=$rc, 목록 노출"
fi

# R2 — 빈 색인/스토리지 부재를 ready로 부르지 않는다
for fx in empty missing; do
  res="$(run_health "$fx")"; rc="${res%%|*}"; out="${res#*|}"
  if [[ "$rc" == "0" ]] || grep -q 'ready=True' <<<"$out"; then
    violation "R2 픽스처 '$fx'(빈 색인/부재)를 ready로 판정"
  else
    note "R2 OK — '$fx' → rc=$rc, ready=False"
  fi
done

# R2b — pending도 ready가 아니다
res="$(run_health pend)"; rc="${res%%|*}"; out="${res#*|}"
if [[ "$rc" == "0" ]]; then
  violation "R2 미완(pending) 문서가 있는데 rc=0"
else
  note "R2 OK — pending 1건 → rc=$rc"
fi

# R3 — 전부 processed면 통과여야 한다(게이트가 무조건 빨강이면 쓸모없다)
res="$(run_health allok)"; rc="${res%%|*}"; out="${res#*|}"
if [[ "$rc" != "0" ]] || ! grep -q 'ready=True' <<<"$out"; then
  violation "R3 전부 processed인데 통과하지 않음 (rc=$rc) — 게이트가 상시 빨강"
else
  note "R3 OK — 전부 processed → ready=True, rc=0"
fi

# ── R4: 거짓 초록의 원인 코드가 되살아나지 않는다 ────────────────────────────
# kv_store_full_docs 는 **투입** 문서라 실패해도 줄지 않는다. 그 길이를
# 'documents'(성공 수)로 쓰는 순간 2026-08-04가 재현된다.
if python3 - "$RAG_DIR/ingest.py" <<'PY'
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
# 주석을 걷어낸 실제 코드에서만 찾는다
code = "\n".join(re.sub(r"#.*$", "", ln) for ln in src.splitlines())
# full_docs 를 documents 키에 대입하는 형태
bad = re.search(r'stats\[\s*["\']documents["\']\s*\]\s*=\s*len\(.*full_docs', code, re.S)
sys.exit(0 if bad else 1)
PY
then
  violation "R4 ingest.py가 kv_store_full_docs 길이를 'documents'로 보고 — 거짓 초록 회귀"
else
  note "R4 OK — 투입 문서 수를 성공 수로 쓰지 않음"
fi

# 'documents'는 doc_status 기반(indexed_files)에서 와야 한다
if ! grep -qE '"documents":\s*health\["indexed_files"\]' "$RAG_DIR/ingest.py"; then
  violation "R4 'documents'가 doc_status의 indexed_files에서 오지 않음"
else
  note "R4 OK — documents = doc_status.indexed_files"
fi

# 통계에 failed 필드가 별도로 실린다
if ! grep -qE '"failed":\s*health\["failed_docs"\]' "$RAG_DIR/ingest.py"; then
  violation "R4 ingest_stats에 failed 필드가 없음 — 실패가 통계에서 사라진다"
else
  note "R4 OK — 통계에 failed 별도 필드 존재"
fi

# ── R5: 실패 시 non-zero 종료 경로 ──────────────────────────────────────────
if ! grep -qE 'SystemExit\(1\)|sys\.exit\(1\)' "$RAG_DIR/ingest.py"; then
  violation "R5 ingest.py에 실패 시 non-zero 종료 경로가 없음"
else
  note "R5 OK — 실패 시 non-zero 종료 경로 존재"
fi

# ── R6: infra/rag의 /healthz는 index_health를 써야 한다 ─────────────────────
# 현재 이 브랜치에 RAG 서비스는 없다(rag_service.py는 적대검증 반려된
# feat/rag-assistant에만 있다). 그래서 이 규칙은 지금 **공허하게 통과**한다 —
# 서비스가 돌아오는 순간을 위해 미리 걸어둔 덫이다. 프로세스가 떠 있다는
# 이유로 ready=true를 내면 "색인이 비어도 정상"이 된다.
healthz_files=()
while IFS= read -r f; do healthz_files+=("$f"); done < <(
  # index_health.py 자신은 제외한다(주석에서 /healthz를 언급할 뿐 서버가 아니다).
  grep -rl '/healthz' "$RAG_DIR" --include='*.py' 2>/dev/null \
    | grep -v '/index_health\.py$' || true
)
if [[ ${#healthz_files[@]} -eq 0 ]]; then
  note "R6 공허 통과 — infra/rag에 /healthz 노출 서비스 없음(현재 브랜치)"
else
  for f in "${healthz_files[@]}"; do
    if grep -qE 'index_health' "$f"; then
      note "R6 OK — $(basename "$f")가 index_health를 사용"
    else
      violation "R6 $(basename "$f")가 /healthz를 노출하면서 index_health를 쓰지 않음 — '색인이 비어도 ready=true' 위험"
    fi
  done
fi

if [[ $FAIL -eq 0 ]]; then
  echo "PASS: RAG 색인 통계가 실패를 숨기지 않는다 (R1~R6)"
fi
exit $FAIL

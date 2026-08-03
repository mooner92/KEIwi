#!/usr/bin/env bash
# 파이썬 게이트 — 추적된 *.py 전수 컴파일 + exporter import 스모크 (§5 D5-2 / T5-10)
#
# 왜 import 스모크까지 하나:
#   `py_compile`은 문법만 본다. 모듈 최상위에서 죽는 코드(없는 모듈 import, 상수 계산
#   실패)는 컴파일을 통과하고 **노드에서 서비스가 안 뜨는 형태로** 드러난다. exporter가
#   안 뜨면 메트릭이 조용히 사라지고, 그 침묵은 대시보드에서 "정상"과 구분되지 않는다.
#   두 exporter 모두 `if __name__ == "__main__":` 뒤에서만 서버를 띄우므로
#   import 만으로는 포트를 열지 않는다(실측) — 게이트가 서비스를 시작하지 않는다.
#
# ⚠️ 문법 상한: 두 exporter는 **data01(Ubuntu 16.04 / python 3.6)** 에서도 돈다.
#    f-string 은 3.6부터 가능하지만 walrus(3.8)·match(3.10)·`X | None`(3.10) 는 쓰면 안 된다.
#    이 게이트는 로컬 python3(3.9+)로 컴파일하므로 **3.6 상한 위반을 못 잡는다** —
#    아래 3.6 금지 문법 grep이 그 구멍의 최소한의 방어다(완전하지 않다).
#
# exit: 0 통과 / 1 위반
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

fail=0

# 추적본 + 미추적·비무시(새 게이트 스크립트가 커밋 전에도 컴파일 검사를 받도록).
mapfile -t PYFILES < <(git ls-files -c -o --exclude-standard '*.py' | sort -u)
KEEP=()
for f in "${PYFILES[@]}"; do [[ -f "$f" ]] && KEEP+=("$f"); done

if [[ ${#KEEP[@]} -gt 0 ]]; then
  if ! python3 -m py_compile "${KEEP[@]}"; then
    echo "PY_FAIL py_compile"
    fail=1
  fi
fi

# 3.6 폴백 대상(노드에서 도는 exporter)만 문법 상한을 본다. tools/ 는 data05 전용이라 제외.
LEGACY=(infra/monitoring/gpu-model-exporter/gpu-model-exporter.py
        infra/monitoring/port-exporter/port-exporter.py)
for f in "${LEGACY[@]}"; do
  [[ -f "$f" ]] || continue
  if grep -nE ':=|^[[:space:]]*match .*:$|-> *[A-Za-z]+ *\| *None' "$f"; then
    echo "PY_FAIL $f — python3.6(data01)에 없는 문법. 상한을 지켜라"
    fail=1
  fi
done

# import 스모크 — -X dev 로 경고를 표면화한다. 서버는 __main__ 가드 뒤라 뜨지 않는다.
for f in "${LEGACY[@]}"; do
  [[ -f "$f" ]] || continue
  if ! python3 -X dev -c "
import importlib.util, sys
spec = importlib.util.spec_from_file_location('smoke', '$f')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
" 2>&1; then
    echo "PY_FAIL import 스모크: $f"
    fail=1
  fi
done

if [[ $fail -eq 0 ]]; then
  echo "PY_OK files=${#KEEP[@]} · import 스모크 ${#LEGACY[@]}개"
fi
exit "$fail"

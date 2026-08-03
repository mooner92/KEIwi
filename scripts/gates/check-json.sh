#!/usr/bin/env bash
# 대시보드 JSON 게이트 — 전수 파싱 + uid 유일성 + title 존재 (§5 D5-2 / T5-8)
#
# 왜:
#   Grafana 프로비저닝은 **uid로 대시보드를 식별**한다. 같은 uid를 가진 파일이 둘이면
#   나중에 로드된 것이 앞의 것을 덮어써서, 레포에는 두 개가 있는데 라이브에는 하나만
#   남는다. 그 상태로 §12의 "레포본을 복사한다" 절차를 따르면 절차 자체가 사고가 된다.
#   실제로 logs.json 과 logs.import.json 이 둘 다 uid=keiwi-logs 였다(T5-8이 해소).
#
# 이 게이트가 **못** 잡는 것:
#   · 패널 내용의 유효성(쿼리·데이터소스 참조). 메트릭명은 check-promql-metrics.sh,
#     데이터소스 참조는 check-grafana-provisioning.py 가 본다.
#   · **파일 개수**를 판정하지 않는다. `keiwi-*` vs `keiwi-*-v3` 정본 결정이 진행 중이라
#     개수를 하드코딩하면 그 결정이 이 게이트를 깨뜨린다. 개수는 참고 출력일 뿐이다.
#
# exit: 0 통과 / 1 위반
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

python3 - <<'PY'
import glob
import json
import sys
from collections import defaultdict

files = sorted(glob.glob("infra/monitoring/dashboards/*.json"))
bad = 0
uids = defaultdict(list)

for f in files:
    try:
        with open(f, encoding="utf-8") as fh:
            d = json.load(fh)
    except (OSError, ValueError) as e:
        print(f"FAIL parse {f}: {e}")
        bad += 1
        continue
    uid = d.get("uid")
    if not uid:
        print(f"FAIL uid 없음: {f}")
        bad += 1
    else:
        uids[uid].append(f)
    if not d.get("title"):
        print(f"FAIL title 없음: {f}")
        bad += 1

dups = {u: fs for u, fs in uids.items() if len(fs) > 1}
for u, fs in sorted(dups.items()):
    print(f"FAIL DUP uid {u}: {', '.join(fs)}")

print(f"dashboards: {len(files)} · uid dup: {len(dups)}")
sys.exit(1 if (bad or dups) else 0)
PY
rc=$?
[[ $rc -eq 0 ]] && echo "JSON_OK"
exit $rc

#!/usr/bin/env bash
# 축4 T4-4 — 메트릭명 존재 가드 (`_watt` → `_watts` 오타를 빌드 실패로)
#
# 무엇을 하나
#   infra/monitoring/rules/*.yml 의 expr + infra/monitoring/dashboards/*.json 의 패널 target
#   expr에서 **메트릭 이름으로 쓰인 식별자**를 뽑아, 라이브 `__name__` 스냅샷(918개) +
#   pending 목록 + 자체 record 이름의 합집합에 없으면 exit 1.
#   구현은 tools/promql_metric_guard.py 이고, PromQL 토크나이저는
#   tools/promtool_fallback.py 가 소유한다(두 벌 만들면 갈라진다 — spec §D4-4).
#
# 왜 promtool로는 안 되나
#   `promtool check rules`는 `node_hwmon_power_average_watts`(존재하지 않는 이름)를
#   **문법상 유효한 참조로 통과시킨다.** 오타는 배포 후 빈 패널로만 드러나고,
#   빈 패널은 "문제가 없어서 비어 있다"와 구분되지 않는다.
#
# ⚠️ 이 게이트가 못 잡는 것 (정직하게)
#   - 이름은 맞고 **라벨**이 틀린 경우. `count by (product)(…)` 처럼 존재하지 않는 라벨로
#     그룹핑하면 PromQL이 조용히 전부 한 그룹으로 뭉친다 → 단위 테스트(--test)의 몫이다.
#   - 이름은 존재하나 특정 인스턴스에만 있는 경우(DCGM 라벨이 data05에만 있는 것 등).
#   - 스냅샷 자체가 낡은 경우 → AC-4-6이 신선도를, T4-12가 배포 직후 재생성을 담당.
#   - `{__name__=~"…"}` 동적 참조 — 문자열 리터럴이라 건너뛴다.
#
# usage:
#   check-promql-metrics.sh                          rules + dashboards 기본 경로 전수
#   check-promql-metrics.sh --rules DIR --dashboards DIR
#   check-promql-metrics.sh --extra FILE [FILE...]   추가 파일(.yml|.json)까지 검사
#   check-promql-metrics.sh --self-test              토크나이저 픽스처만 검사
#
# exit: 0 통과 / 1 미확인 메트릭·pending 근거 누락 / 2 환경 부족

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
GUARD="$ROOT/tools/promql_metric_guard.py"

if [[ ! -f "$GUARD" ]]; then
  echo "SKIP(env: guard) — $GUARD 없음" >&2
  exit 2
fi

python3 "$GUARD" "$@"
rc=$?
if [[ $rc -eq 1 ]]; then
  echo "PROMQL_METRICS_FAIL" >&2
fi
exit $rc

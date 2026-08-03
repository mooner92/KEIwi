#!/usr/bin/env bash
# T-E1-6 — Grafana 알림 프로비저닝의 env 보간 함정 게이트 (alert-enrichment §0.2)
#
# 무엇을 잡나:
#   Grafana는 **모든 프로비저닝 YAML에서 `$VAR`을 환경변수로 치환**한다. 미정의 변수는
#   빈 문자열이 되므로 `{{ $labels.instance }}`는 `{{ .instance }}`로 깨져 리터럴로 흐른다.
#   2026-08-03 첫 실전 알림 제목에 `{{ .instance }}`가 그대로 노출된 사고의 근본 원인이다.
#   [출처: grafana.com/docs — file-provisioning의 $ 이스케이프 규정 · github.com/grafana/grafana#78118]
#
#   올바른 표기: `$$labels` / `$$values` (Grafana가 `$` 하나로 되돌린다)
#   허용 예외:   `$__env{...}` — Grafana 자신의 env 참조 문법(시크릿 배선에 필수)
#
# 이 게이트가 **못** 잡는 것(정직하게):
#   - 템플릿 문법 자체의 오류(존재하지 않는 함수·파이프 순서). 그건 Grafana UI 미리보기나
#     라이브 발화로만 확인된다.
#   - notification 템플릿(templates.yaml)에 값 포맷팅 함수를 잘못 넣는 것 — printf/humanize는
#     규칙 annotation 전용이다. 사람이 spec §1.2를 따라야 한다.
#
# exit: 0 통과 / 1 비이스케이프 발견
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DIR="$ROOT/infra/monitoring/grafana/provisioning/alerting"

if [[ "${1:-}" == "--self-test" ]]; then
  # 역증명 — 일부러 깨진 입력을 만들어 게이트가 정말 잡는지 확인한다.
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  printf 'summary: %s{{ $labels.instance }}%s\n' "'" "'" > "$tmp/bad.yaml"
  printf 'summary: %s{{ $$labels.instance }}%s\ntoken: $__env{TOKEN}\n' "'" "'" > "$tmp/good.yaml"
  bad_hits=$(grep -cE '\{\{[^}]*\$(labels|values)\b' "$tmp/bad.yaml")
  good_hits=$(grep -E '\{\{[^}]*\$(labels|values)\b' "$tmp/good.yaml" | grep -cv '\$\$' || true)
  if [[ "$bad_hits" -ge 1 && "$good_hits" -eq 0 ]]; then
    echo "SELF_TEST_OK (bad=$bad_hits good=$good_hits)"; exit 0
  fi
  echo "SELF_TEST_FAIL (bad=$bad_hits good=$good_hits)"; exit 1
fi

rc=0
for f in "$DIR"/*.yaml "$DIR"/*.yml; do
  [[ -f "$f" ]] || continue
  # `$labels`/`$values`가 `$$` 없이 나오는 행 — env 보간이 삼킬 대상이다.
  # 주석 행은 제외한다: YAML 파서가 걷어내 Grafana 보간에 도달하지 않으므로 무해하고,
  # 이 함정을 **설명하는 주석**이 게이트를 깨뜨리면 자기참조 결함이 된다(AC-4-13 교훈).
  hits=$(grep -nE '\{\{[^}]*\$(labels|values)\b' "$f" | grep -v '\$\$' | grep -vE '^[0-9]+:[[:space:]]*#' || true)
  if [[ -n "$hits" ]]; then
    echo "  FAIL $f — env 보간이 삼킬 비이스케이프 \$labels/\$values:" >&2
    printf '%s\n' "$hits" | head -10 | sed 's/^/    /' >&2
    rc=1
  fi
done
if [[ $rc -eq 0 ]]; then
  echo "ALERTING_ESCAPES_OK"
else
  echo "ALERTING_ESCAPES_FAIL — \$\$ 로 이스케이프하라 (spec: specs/alert-enrichment §0.2)"
fi
exit $rc

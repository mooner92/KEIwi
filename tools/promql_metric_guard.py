#!/usr/bin/env python3
"""메트릭명 존재 가드 — `_watt` vs `_watts` 오타를 빌드 실패로 바꾼다 (축4 T4-4).

왜 이 파일이 있나
-----------------
`promtool check rules`는 `node_hwmon_power_average_watts`(복수, 라이브에 **없는 이름**)를
**문법상 유효한 메트릭 참조로 통과시킨다.** 오타는 배포 후 "빈 패널"로만 드러나고,
빈 패널은 "지금 문제가 없어서 비어 있다"와 구분되지 않는다. 1인 운영이라 리뷰어가
작성자와 같은 사람이므로 사람 눈은 게이트가 아니다(spec §4.3).

무엇을 검사하나
--------------
`infra/monitoring/rules/*.yml`의 expr + `infra/monitoring/dashboards/*.json`의 패널 target
expr에서 **메트릭 이름으로 쓰인 식별자**를 뽑아, 아래 허용집합에 없으면 exit 1:

    허용집합 = metric-names.txt(라이브 스냅샷)
             ∪ metric-names.pending.txt(이 스펙이 배포 예정 — 근거 주석 필수)
             ∪ 검사 대상 rules가 스스로 정의하는 record 이름

이 가드가 **못 잡는 것** (정직하게)
----------------------------------
- 이름은 맞는데 **라벨**이 틀린 경우. 예: `count by (product)(…)`— `product`는 존재하지
  않는 라벨인데 PromQL은 조용히 전부 한 그룹으로 뭉친다. 그건 promtool도 못 잡고
  이 가드도 못 잡는다 → **단위 테스트(rules/tests/*.test.yml)의 몫**이다.
- 이름은 존재하지만 **그 인스턴스에는 없는** 경우(예: DCGM 라벨이 data05에만 존재).
- 스냅샷이 낡은 경우. 그래서 AC-4-6이 스냅샷 신선도를 따로 검사하고, T4-12가
  배포 직후 재생성한다.
- `{__name__=~"…"}` 형태의 동적 참조 — 문자열 리터럴이라 토크나이저가 건너뛴다.

exit: 0 통과 · 1 미확인 이름 발견/pending 근거 누락 · 2 환경 오류(PyYAML 부재 등)
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# 토크나이저 정본은 폴백 엔진이 소유한다(spec §D4-4) — 두 벌 만들면 갈라진다.
from promtool_fallback import extract_metric_names  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_RULES = os.path.join(REPO, "infra", "monitoring", "rules")
DEFAULT_DASH = os.path.join(REPO, "infra", "monitoring", "dashboards")
DEFAULT_SNAPSHOT = os.path.join(REPO, "infra", "monitoring", "metric-names.txt")
DEFAULT_PENDING = os.path.join(REPO, "infra", "monitoring", "metric-names.pending.txt")


def _load_snapshot(path):
    names = set()
    if not os.path.exists(path):
        return names, ["스냅샷 없음: %s" % path]
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            names.add(line)
    return names, []


def _load_pending(path):
    """pending 파일은 각 줄에 `<메트릭명>  # spec §N <근거>` 형식을 요구한다.

    근거 없는 줄은 위반이다 — "일단 넣고 보자"를 막는 것이 이 파일의 존재 이유다.
    """
    names, problems = set(), []
    if not os.path.exists(path):
        return names, problems
    with open(path) as f:
        for lineno, raw in enumerate(f, 1):
            line = raw.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            head, sep, comment = line.partition("#")
            name = head.strip()
            if not name:
                continue
            if not sep or "spec §" not in comment:
                problems.append(
                    "%s:%d: pending 항목에 근거 주석(`# spec §N …`)이 없다 — %s"
                    % (os.path.basename(path), lineno, name)
                )
            names.add(name)
    return names, problems


def _iter_rule_exprs(path):
    """rules yaml에서 (위치, expr) 와 정의된 record 이름을 뽑는다."""
    import yaml

    exprs, records = [], set()
    with open(path) as f:
        doc = yaml.safe_load(f)
    if not isinstance(doc, dict):
        return exprs, records
    for g in doc.get("groups") or []:
        if not isinstance(g, dict):
            continue
        gname = g.get("name", "?")
        for ri, r in enumerate(g.get("rules") or []):
            if not isinstance(r, dict):
                continue
            if r.get("record"):
                records.add(str(r["record"]))
            if r.get("expr"):
                exprs.append(("%s:%s[%d]" % (os.path.basename(path), gname, ri), str(r["expr"])))
    return exprs, records


def _iter_dashboard_exprs(path):
    """대시보드 JSON의 패널 target expr을 뽑는다(row 안 중첩 패널 포함).

    템플릿 변수 쿼리(`label_values(node_uname_info, instance)`)는 **의도적으로 제외**한다 —
    Grafana 전용 함수라 두 번째 인자가 라벨 이름인데, PromQL 문법으로는 메트릭과
    구분되지 않아 오탐이 확정적이다.
    """
    exprs = []
    with open(path) as f:
        doc = json.load(f)
    stack = list(doc.get("panels") or [])
    while stack:
        p = stack.pop()
        if not isinstance(p, dict):
            continue
        stack.extend(p.get("panels") or [])
        for t in p.get("targets") or []:
            if isinstance(t, dict) and t.get("expr"):
                exprs.append(
                    ("%s:panel %s 「%s」" % (os.path.basename(path), p.get("id"), p.get("title", "")),
                     str(t["expr"]))
                )
    return exprs


def collect(rules_dir, dash_dir, extra):
    exprs, records, errs = [], set(), []
    files = []
    if rules_dir:
        for fn in sorted(os.listdir(rules_dir)):
            if fn.endswith((".yml", ".yaml")):
                files.append(os.path.join(rules_dir, fn))
    files.extend(extra or [])
    for path in files:
        if path.endswith((".yml", ".yaml")):
            try:
                e, r = _iter_rule_exprs(path)
            except Exception as exc:  # noqa: BLE001
                errs.append("%s: 파싱 실패 — %s" % (path, exc))
                continue
            exprs.extend(e)
            records |= r
        elif path.endswith(".json"):
            try:
                exprs.extend(_iter_dashboard_exprs(path))
            except Exception as exc:  # noqa: BLE001
                errs.append("%s: 파싱 실패 — %s" % (path, exc))
    if dash_dir:
        for fn in sorted(os.listdir(dash_dir)):
            if not fn.endswith(".json"):
                continue
            path = os.path.join(dash_dir, fn)
            try:
                exprs.extend(_iter_dashboard_exprs(path))
            except Exception as exc:  # noqa: BLE001
                errs.append("%s: 파싱 실패 — %s" % (path, exc))
    return exprs, records, errs


SELF_TEST_CASES = [
    # (expr, 기대 추출 결과) — 실제 코퍼스에서 나온 오탐/정탐을 그대로 못 박는다.
    # ① 라벨 **값**은 메트릭이 아니다(실측 오탐 1건).
    (
        'smartctl_device_attribute{attribute_name="Reallocated_Sector_Ct", attribute_value_type="raw"}',
        ["smartctl_device_attribute"],
    ),
    # ② 부분 토큰을 만들지 않는다. `node_apt_upgrades_pending`에서 `apt_upgrades_pending`이
    #    떨어져 나오면 안 된다(`_`는 단어 문자라 단순 \b 정규식으로도 안 나오지만,
    #    구현을 바꾸다 실수로 분해하는 회귀를 막기 위해 고정한다).
    ("node_apt_upgrades_pending{instance=~\"$instance\"}", ["node_apt_upgrades_pending"]),
    # ③ 함수·집계·라벨 목록은 메트릭이 아니다.
    (
        'sum by (instance) (label_replace(DCGM_FI_DEV_POWER_USAGE, "instance", "$1:9100", "instance", "(.*):9400"))',
        ["DCGM_FI_DEV_POWER_USAGE"],
    ),
    # ④ record 이름(`:` 포함)도 정상 추출된다.
    ("count(instance:node_chassis_power:watts > 0) or vector(0)", ["instance:node_chassis_power:watts"]),
    # ⑤ 조인 수식어의 라벨 목록 제외 + range selector 기간은 숫자다.
    (
        "(instance:node_chassis_power:watts > 0) - on(instance) instance:gpu_power:watts",
        ["instance:node_chassis_power:watts", "instance:gpu_power:watts"],
    ),
    ("sum(rate(node_cpu_seconds_total{mode=\"idle\"}[5m]))", ["node_cpu_seconds_total"]),
    # ⑥ 오타는 그대로 나와야 한다 — 잡으라고 만든 가드다.
    ("sum(node_hwmon_power_average_watts)", ["node_hwmon_power_average_watts"]),
]


def self_test():
    fails = []
    for expr, want in SELF_TEST_CASES:
        got = extract_metric_names(expr)
        if got != want:
            fails.append("  expr: %s\n    기대: %s\n    실제: %s" % (expr, want, got))
    if fails:
        print("SELF_TEST_FAIL")
        print("\n".join(fails))
        return 1
    print("SELF_TEST_OK (%d 케이스)" % len(SELF_TEST_CASES))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--rules", default=DEFAULT_RULES)
    ap.add_argument("--dashboards", default=DEFAULT_DASH)
    ap.add_argument("--extra", nargs="*", default=[])
    ap.add_argument("--snapshot", default=DEFAULT_SNAPSHOT)
    ap.add_argument("--pending", default=DEFAULT_PENDING)
    ap.add_argument("--no-rules", action="store_true")
    ap.add_argument("--no-dashboards", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    try:
        import yaml  # noqa: F401
    except ImportError:
        print("SKIP(env: PyYAML) — pip install PyYAML", file=sys.stderr)
        return 2

    known, snap_err = _load_snapshot(args.snapshot)
    if snap_err:
        for e in snap_err:
            print("  FAIL %s" % e, file=sys.stderr)
        return 2
    pending, pending_problems = _load_pending(args.pending)

    rules_dir = None if args.no_rules else args.rules
    dash_dir = None if args.no_dashboards else args.dashboards
    exprs, records, errs = collect(rules_dir, dash_dir, args.extra)
    allowed = known | pending | records

    unknown = {}
    ident_count = 0
    for where, expr in exprs:
        for name in extract_metric_names(expr):
            ident_count += 1
            if name not in allowed:
                unknown.setdefault(name, []).append(where)

    if errs or pending_problems or unknown:
        print("FAIL — 미확인 메트릭 %d종 · 파싱오류 %d · pending 위반 %d"
              % (len(unknown), len(errs), len(pending_problems)))
        for e in errs:
            print("  FAIL %s" % e)
        for p in pending_problems:
            print("  FAIL %s" % p)
        for name in sorted(unknown):
            print("  FAIL 스냅샷에 없는 메트릭 `%s`" % name)
            for w in sorted(set(unknown[name]))[:6]:
                print("        ↳ %s" % w)
            print("        → 오타이면 고치고, 이 스펙이 배포할 예정이면 "
                  "metric-names.pending.txt에 근거 주석과 함께 등록한다.")
        return 1

    print("OK — expr %d · 식별자 %d · 미확인 0 (허용집합 %d = 스냅샷 %d + pending %d + 자체 record %d)"
          % (len(exprs), ident_count, len(allowed), len(known), len(pending), len(records)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

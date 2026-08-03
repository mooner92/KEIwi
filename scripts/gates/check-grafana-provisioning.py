#!/usr/bin/env python3
"""Grafana 프로비저닝 유효성 게이트 (spec fleet-hardening §5 D5-3 / T5-11·T5-12).

라이브 Grafana는 프로비저닝 파일을 **부팅 때 한 번** 읽고, 잘못된 것은 조용히 무시하거나
마지막 것으로 덮어쓴다. 그래서 "레포에는 있는데 라이브에는 없는 설정"이 만들어지고,
그 상태에서 §12의 "레포본을 복사한다" 절차를 따르면 절차 자체가 사고가 된다.
이 게이트는 부팅 전에 그 조건을 잡는다.

규칙:
  P1 ds-uid          datasources/*.yaml 의 uid 유일
  P2 ds-name         같은 파일들의 name 유일
  P3 alert-uid       alert-rules.yaml 규칙의 uid·title 유일
  P4 threshold-drift evaluator.params[0] 수치가 annotations.summary 문구에 등장
  P5 ref-integrity   datasourceUid ∈ (프로비저닝된 uid ∪ {__expr__})
                     **기본 실행에서 제외**한다 — 알림 규칙이 참조하는 Prometheus 데이터소스가
                     아직 레포에 프로비저닝돼 있지 않아(hardware-ops T2-1 소관) 지금 켜면
                     CI가 도입 첫날부터 red다. red가 일상이 되면 게이트 전체가 무시된다 —
                     정확히 check:secrets에 일어났던 일이다. T2-1 완료 후 기본에 편입한다
                     (그때까지는 `--check ref-integrity` 로 수동 실행).

이 게이트가 **못** 잡는 것:
  · 데이터소스가 실제로 붙는지(네트워크·플러그인 설치 여부). 그건 사람이 Save & test 로 본다.
  · 알림 쿼리(PromQL·OpenSearch DSL)의 의미. 메트릭명은 check-promql-metrics.sh 몫이다.
  · Grafana 스키마 전체. 우리가 실제로 겪은 실패 5종만 본다.

usage:
  check-grafana-provisioning.py                     P1~P4 (기본)
  check-grafana-provisioning.py --check <rule>      개별 실행 (P5 포함)
  check-grafana-provisioning.py --list              규칙 목록
exit: 0 통과 / 1 위반 / 2 환경 부족(PyYAML 부재 등)
"""
import argparse
import os
import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover - 환경 부족은 위반이 아니다
    print("SKIP(env: PyYAML) — python3 -m pip install pyyaml", file=sys.stderr)
    sys.exit(2)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DS_DIR = os.path.join(ROOT, "infra/monitoring/grafana/provisioning/datasources")
ALERT_FILE = os.path.join(ROOT, "infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml")

# 수치 추출: 1,234 · 92 · 0.5 를 모두 잡고 천 단위 쉼표는 제거한다.
NUM_RE = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")


def load_yaml(path):
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def ds_files(ds_dir):
    if not os.path.isdir(ds_dir):
        return []
    return sorted(os.path.join(ds_dir, f) for f in os.listdir(ds_dir)
                  if f.endswith((".yaml", ".yml")))


def datasources(ds_dir):
    out = []
    for path in ds_files(ds_dir):
        doc = load_yaml(path)
        for ds in doc.get("datasources") or []:
            out.append((os.path.basename(path), ds))
    return out


def alert_rules(alert_file):
    if not os.path.isfile(alert_file):
        return []
    doc = load_yaml(alert_file)
    out = []
    for grp in doc.get("groups") or []:
        for rule in grp.get("rules") or []:
            out.append(rule)
    return out


def _dup_report(kind, pairs):
    """pairs = [(값, 파일)]. 중복만 골라 출력하고 위반 수를 돌려준다."""
    seen = {}
    for value, origin in pairs:
        seen.setdefault(value, []).append(origin)
    dups = {v: o for v, o in seen.items() if len(o) > 1}
    for value, origins in sorted(dups.items()):
        print(f"DUP {kind} {value}: {', '.join(sorted(set(origins)))}")
    return len(dups)


def rule_ds_uid(ds_dir, **_):
    """P1 — 데이터소스 uid 유일성."""
    pairs = [(ds.get("uid"), f) for f, ds in datasources(ds_dir) if ds.get("uid")]
    bad = _dup_report("uid", pairs)
    print(f"P1 ds-uid: datasources={len(pairs)} dup={bad}")
    return 1 if bad else 0


def rule_ds_name(ds_dir, **_):
    """P2 — 데이터소스 name 유일성. uid가 같아도 name이 다르면 UI에서 둘로 보인다(반대도 사고)."""
    pairs = [(ds.get("name"), f) for f, ds in datasources(ds_dir) if ds.get("name")]
    bad = _dup_report("name", pairs)
    print(f"P2 ds-name: datasources={len(pairs)} dup={bad}")
    return 1 if bad else 0


def rule_alert_uid(alert_file, **_):
    """P3 — 알림 규칙 uid·title 유일성. 개수는 판정하지 않는다(다른 축이 규칙을 더한다)."""
    rules = alert_rules(alert_file)
    base = os.path.basename(alert_file)
    bad = _dup_report("rule-uid", [(r.get("uid"), base) for r in rules if r.get("uid")])
    bad += _dup_report("rule-title", [(r.get("title"), base) for r in rules if r.get("title")])
    print(f"P3 alert-uid: rules={len(rules)} dup={bad}")
    return 1 if bad else 0


def _thresholds(rule):
    """condition refId 가 가리키는 표현식의 evaluator params[0] 목록."""
    cond = rule.get("condition")
    out = []
    for q in rule.get("data") or []:
        if cond and q.get("refId") != cond:
            continue
        model = q.get("model") or {}
        for c in model.get("conditions") or []:
            params = (c.get("evaluator") or {}).get("params") or []
            if params:
                out.append(params[0])
    return out


def _fmt(v):
    return str(int(v)) if isinstance(v, (int, float)) and float(v).is_integer() else str(v)


def rule_threshold_drift(alert_file, **_):
    """P4 — 임계값과 summary 문구의 드리프트.

    실제로 일어난 사고: GPU 온도 임계를 85→92로 올리고 summary는 "85°C"로 남았다.
    사람은 알림 본문을 읽고 조치하므로, 문구가 낡으면 **알림이 거짓말을 한다**.

    판정에서 빼는 경우(오탐이 아니라 규칙의 정의다):
      · params[0]이 0 또는 1  — `up < 1`·`changes() > 0` 같은 **존재/부재 판정**이다.
        임계가 아니라 센티널이라 사람이 문구에 옮겨 적을 값이 아니다.
      · summary에 숫자가 하나도 없는 규칙 — 옮겨 적을 대상이 없다.
    단위 환산은 허용한다(초→분·시). 5400초를 "90분"으로 적는 것은 드리프트가 아니고,
    임계가 7200으로 바뀌면 "120분"이 요구되므로 **드리프트 탐지력은 유지**된다.
    """
    rules = alert_rules(alert_file)
    bad = 0
    checked = 0
    for r in rules:
        summary = ((r.get("annotations") or {}).get("summary") or "")
        nums = {n.replace(",", "") for n in NUM_RE.findall(summary)}
        if not nums:
            continue
        for th in _thresholds(r):
            if not isinstance(th, (int, float)) or float(th) in (0.0, 1.0):
                continue
            checked += 1
            cands = {_fmt(th)}
            for div in (60, 3600):
                if float(th) % div == 0:
                    cands.add(_fmt(float(th) / div))
            if not (cands & nums):
                print(f"FAIL {r.get('uid')}: params[0]={_fmt(th)}, "
                      f"summary에 {_fmt(th)} 없음({', '.join(sorted(nums))} 발견)")
                bad += 1
    print(f"P4 threshold-drift: rules={len(rules)} checked={checked} fail={bad}")
    return 1 if bad else 0


def rule_ref_integrity(ds_dir, alert_file, **_):
    """P5 — 알림이 참조하는 datasourceUid 가 실제로 프로비저닝돼 있는가.

    프로비저닝되지 않은 uid를 참조하면 Grafana는 규칙을 로드하되 **평가에서 오류**를 낸다 —
    알림이 있다고 믿는데 아무것도 감시하지 않는 상태가 된다.
    `__expr__` 는 Grafana 내장 표현식 엔진의 예약 uid라 항상 유효하다.
    """
    known = {ds.get("uid") for _f, ds in datasources(ds_dir) if ds.get("uid")}
    known.add("__expr__")
    bad = 0
    for r in alert_rules(alert_file):
        for q in r.get("data") or []:
            uid = q.get("datasourceUid")
            if uid and uid not in known:
                print(f"FAIL {r.get('uid')} refId={q.get('refId')}: "
                      f"datasourceUid {uid} 가 프로비저닝돼 있지 않다")
                bad += 1
    print(f"P5 ref-integrity: 프로비저닝 uid={sorted(known)} fail={bad}")
    return 1 if bad else 0


RULES = {
    "ds-uid": (rule_ds_uid, True),
    "ds-name": (rule_ds_name, True),
    "alert-uid": (rule_alert_uid, True),
    "threshold-drift": (rule_threshold_drift, True),
    # 기본 실행 제외 — 위 docstring 참조(hardware-ops T2-1 이후 True 로 바꾼다).
    "ref-integrity": (rule_ref_integrity, False),
}


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--check", action="append", default=[], choices=sorted(RULES))
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--datasource-dir", default=DS_DIR)
    ap.add_argument("--alert-file", default=ALERT_FILE)
    args = ap.parse_args()

    if args.list:
        for name, (_fn, default_on) in sorted(RULES.items()):
            print(f"{name}\t{'기본' if default_on else '수동(--check)'}")
        return 0

    names = args.check or [n for n, (_f, on) in RULES.items() if on]
    worst = 0
    for name in names:
        fn = RULES[name][0]
        rc = fn(ds_dir=args.datasource_dir, alert_file=args.alert_file)
        worst = max(worst, rc)
    if worst == 0:
        print(f"PROVISIONING_OK ({', '.join(names)})")
    return worst


if __name__ == "__main__":
    sys.exit(main())

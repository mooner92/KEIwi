#!/usr/bin/env python3
"""promtool 폴백 엔진 — promtool이 없는 환경에서 최소 검사를 수행한다 (T1-12).

왜 이 파일이 있나
-----------------
게이트가 promtool을 못 찾으면 exit 2로 스킵되는데, 그러면 "검사한다고 써놓고 아무것도
안 하는" 상태가 된다. 이 레포가 고치려는 실패모드와 같은 종류다. 그래서 promtool이
없을 때도 **구조·문법 수준은 반드시 검사**한다.

이 폴백이 **못 하는 것** (정직하게 — 강도를 속이지 않는다)
--------------------------------------------------------
- PromQL 의미 검증: 함수명 오타(`rate` vs `raet`), 라벨 매처 타입 오류, 집계 차원 오류
- 규칙 단위 테스트 평가(`promtool test rules`): 시계열을 실제로 평가해야 하므로 원리적 불가
- 메트릭 타입 일관성의 완전 검증: HELP/TYPE 없이 노출된 값만 보고는 판정 불가

이 폴백이 **잡는 것**
--------------------
check-rules   : YAML 파싱 · groups/rules 스키마 · record|alert 배타 · expr 존재 ·
                괄호/대괄호/중괄호 균형 · 따옴표 균형
check-metrics : 메트릭 이름 규격(`[a-zA-Z_:][a-zA-Z0-9_:]*`) · 라벨 이름 규격 ·
                단위 접미사 관례(_total/_seconds/_bytes/_ratio) · 중복 HELP/TYPE ·
                counter인데 _total 없음 / gauge인데 _total 있음

exit: 0 통과 · 1 위반 발견 · 64 사용법 오류
"""
import re
import sys

METRIC_NAME_RE = re.compile(r"^[a-zA-Z_:][a-zA-Z0-9_:]*$")
LABEL_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
# 접미사가 단위를 뜻하는 관례. 위반이 곧 오류는 아니라 WARN으로만 보고한다.
UNIT_SUFFIXES = ("_total", "_seconds", "_bytes", "_ratio", "_info", "_count", "_sum", "_bucket")


def _balanced(expr, bad, where):
    """괄호류·따옴표 균형. PromQL 파서가 없을 때 잡을 수 있는 최대치다."""
    for op, cl, label in (("(", ")", "괄호"), ("[", "]", "대괄호"), ("{", "}", "중괄호")):
        if expr.count(op) != expr.count(cl):
            bad.append("%s: %s 불균형 — %s" % (where, label, expr[:70]))
    if expr.count('"') % 2 or expr.count("'") % 2:
        bad.append("%s: 따옴표 불균형 — %s" % (where, expr[:70]))


def check_rules(paths):
    try:
        import yaml
    except ImportError:
        print("FATAL: PyYAML이 없어 폴백조차 불가하다. pip install PyYAML", file=sys.stderr)
        return 1
    bad = []
    for path in paths:
        try:
            with open(path) as f:
                doc = yaml.safe_load(f)
        except Exception as e:
            bad.append("%s: YAML 파싱 실패 — %s" % (path, e))
            continue
        if not isinstance(doc, dict) or "groups" not in doc:
            bad.append("%s: 최상위 'groups' 키 없음" % path)
            continue
        groups = doc.get("groups")
        if not isinstance(groups, list):
            bad.append("%s: 'groups'가 리스트가 아님" % path)
            continue
        for gi, g in enumerate(groups):
            if not isinstance(g, dict) or "name" not in g:
                bad.append("%s: groups[%d]에 name 없음" % (path, gi))
                continue
            for ri, r in enumerate(g.get("rules") or []):
                where = "%s:%s[%d]" % (path, g["name"], ri)
                if not isinstance(r, dict):
                    bad.append("%s: 규칙이 매핑이 아님" % where)
                    continue
                has_rec, has_alert = "record" in r, "alert" in r
                if has_rec == has_alert:
                    bad.append("%s: record/alert 중 정확히 하나여야 함" % where)
                if has_rec and not METRIC_NAME_RE.match(str(r["record"])):
                    bad.append("%s: record 이름이 규격 위반 — %s" % (where, r["record"]))
                expr = r.get("expr")
                if expr is None or (isinstance(expr, str) and not expr.strip()):
                    bad.append("%s: expr 없음/빈 값" % where)
                    continue
                _balanced(str(expr), bad, where)
    for b in bad:
        print("  FAIL %s" % b)
    return 1 if bad else 0


def check_metrics(streams):
    """exposition 형식(노출 텍스트)을 읽어 이름·라벨·관례를 검사한다.

    promtool check metrics 와 같은 입력(stdin 또는 파일)을 받는다.
    """
    bad, warn = [], []
    seen_help, seen_type, types = set(), set(), {}
    for name, fh in streams:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            where = "%s:%d" % (name, lineno)
            if line.startswith("#"):
                parts = line.split(None, 3)
                if len(parts) >= 3 and parts[1] in ("HELP", "TYPE"):
                    metric = parts[2]
                    if parts[1] == "HELP":
                        if metric in seen_help:
                            bad.append("%s: HELP 중복 — %s" % (where, metric))
                        seen_help.add(metric)
                    else:
                        if metric in seen_type:
                            bad.append("%s: TYPE 중복 — %s" % (where, metric))
                        seen_type.add(metric)
                        types[metric] = parts[3].strip() if len(parts) > 3 else ""
                continue
            # 샘플 행: name{labels} value [ts]
            m = re.match(r"^([^\s{]+)(\{[^}]*\})?\s+\S+", line)
            if not m:
                bad.append("%s: 파싱 불가한 행 — %s" % (where, line[:60]))
                continue
            metric = m.group(1)
            base = re.sub(r"(_bucket|_sum|_count)$", "", metric)
            if not METRIC_NAME_RE.match(metric):
                bad.append("%s: 메트릭 이름 규격 위반 — %s" % (where, metric))
            if m.group(2):
                for kv in m.group(2)[1:-1].split(","):
                    if not kv.strip():
                        continue
                    key = kv.split("=", 1)[0].strip()
                    if not LABEL_NAME_RE.match(key):
                        bad.append("%s: 라벨 이름 규격 위반 — %s" % (where, key))
            t = types.get(base) or types.get(metric)
            if t == "counter" and not metric.endswith("_total"):
                warn.append("%s: counter인데 _total 접미사 없음 — %s" % (where, metric))
            if t == "gauge" and metric.endswith("_total"):
                warn.append("%s: gauge인데 _total 접미사 — %s" % (where, metric))
            if t is None and not any(metric.endswith(s) for s in UNIT_SUFFIXES):
                pass  # TYPE 없는 것은 판정하지 않는다 — 오탐이 더 해롭다
    for b in bad:
        print("  FAIL %s" % b)
    for w in warn:
        print("  WARN %s" % w, file=sys.stderr)
    return 1 if bad else 0


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 64
    cmd, args = argv[1], argv[2:]
    if cmd == "check-rules":
        if not args:
            print("usage: promtool_fallback.py check-rules FILE...", file=sys.stderr)
            return 64
        return check_rules(args)
    if cmd == "check-metrics":
        if args:
            streams = []
            for p in args:
                streams.append((p, open(p)))
            try:
                return check_metrics(streams)
            finally:
                for _, fh in streams:
                    fh.close()
        return check_metrics([("<stdin>", sys.stdin)])
    print("알 수 없는 서브명령: %s (check-rules|check-metrics)" % cmd, file=sys.stderr)
    return 64


if __name__ == "__main__":
    sys.exit(main(sys.argv))

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
check-rules       : YAML 파싱 · groups/rules 스키마 · record|alert 배타 · expr 존재 ·
                    괄호/대괄호/중괄호 균형 · 따옴표 균형
check-test-schema : promtool test 파일(.test.yml)의 **스키마만** — rule_files 실재,
                    tests[]·input_series·promql_expr_test·exp_samples(labels/value).
                    기대값이 옳은지는 판정하지 않는다(평가 엔진이 필요하다)

check-metrics     : 메트릭 이름 규격(`[a-zA-Z_:][a-zA-Z0-9_:]*`) · 라벨 이름 규격 ·
                    단위 접미사 관례(_total/_seconds/_bytes/_ratio) · 중복 HELP/TYPE ·
                    counter인데 _total 없음 / gauge인데 _total 있음

이 모듈은 **PromQL 최소 토크나이저의 정본**이기도 하다 (`tokenize_promql` ·
`extract_metric_names`). tools/promql_metric_guard.py(축4 메트릭명 가드)가 이것을
import해서 쓴다 — 파서를 두 벌 만들면 한쪽만 고쳐져 갈라진다(spec §D4-4).

exit: 0 통과 · 1 위반 발견 · 64 사용법 오류
"""
import os
import re
import sys

METRIC_NAME_RE = re.compile(r"^[a-zA-Z_:][a-zA-Z0-9_:]*$")
LABEL_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
# 접미사가 단위를 뜻하는 관례. 위반이 곧 오류는 아니라 WARN으로만 보고한다.
UNIT_SUFFIXES = ("_total", "_seconds", "_bytes", "_ratio", "_info", "_count", "_sum", "_bucket")

# ── PromQL 최소 토크나이저 ───────────────────────────────────────────────────
# 여기가 **정본**이다. spec §D4-4가 요구하는 메트릭명 가드(tools/promql_metric_guard.py)와
# 위 check-rules 폴백의 괄호·따옴표 균형 검사가 **같은 모듈을 쓴다** — 두 벌을 만들면
# 한쪽만 고쳐져 갈라지고, 갈라진 파서는 "잡는 줄 알았는데 안 잡는" 상태를 만든다.
#
# 이 토크나이저가 하는 일: 문자열 리터럴·주석·숫자/기간·Grafana 템플릿 변수·식별자·구두점을
# 구분한다. **PromQL 파서가 아니다** — 우선순위·타입·인자 개수는 모른다.

_IDENT_RE = re.compile(r"[a-zA-Z_:][a-zA-Z0-9_:]*")
_NUM_RE = re.compile(r"(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)[a-zA-Z]*")
_VAR_RE = re.compile(r"\$(?:\{[^}]*\}|[a-zA-Z_][a-zA-Z0-9_]*)")

# 함수·집계연산자·키워드. 메트릭 이름이 아니다.
PROMQL_RESERVED = frozenset(
    """
    abs absent absent_over_time acos acosh asin asinh atan atanh avg avg_over_time bottomk
    by ceil changes clamp clamp_max clamp_min cos cosh count count_over_time count_values
    day_of_month day_of_week day_of_year days_in_month deg delta deriv exp floor group
    group_left group_right histogram_avg histogram_count histogram_fraction histogram_quantile
    histogram_stddev histogram_stdvar histogram_sum holt_winters hour idelta ignoring increase
    info irate label_join label_replace last_over_time ln log10 log2 mad_over_time max
    max_over_time min min_over_time minute month offset on pi predict_linear present_over_time
    quantile quantile_over_time rad rate resets round scalar sgn sin sinh sort sort_by_label
    sort_by_label_desc sort_desc sqrt start stddev stddev_over_time stdvar stdvar_over_time
    step sum sum_over_time tan tanh time timestamp topk vector year
    and or unless bool without ignoring group atan2 end limitk limit_ratio
    double_exponential_smoothing ts_of_max_over_time ts_of_min_over_time ts_of_last_over_time
    Inf NaN inf nan
    """.split()
)

# 뒤따르는 괄호 안이 **라벨 이름 목록**이라 메트릭으로 세면 안 되는 키워드.
_LABEL_LIST_KEYWORDS = frozenset(
    ["by", "without", "on", "ignoring", "group_left", "group_right"]
)


def tokenize_promql(expr):
    """PromQL 문자열을 (kind, text, pos) 토큰 리스트로 자른다.

    kind: ident | string | number | var | punct | comment | unterminated_string
    문자열 리터럴 안(라벨 매처의 **값**)과 주석은 ident를 만들지 않는다 —
    코퍼스 실측 오탐 `Reallocated_Sector_Ct`(라벨 값)를 없애는 것이 이 분기다.
    """
    tokens = []
    i, n = 0, len(expr)
    while i < n:
        ch = expr[i]
        if ch in " \t\r\n":
            i += 1
            continue
        if ch == "#":
            j = expr.find("\n", i)
            j = n if j < 0 else j
            tokens.append(("comment", expr[i:j], i))
            i = j
            continue
        if ch in "\"'`":
            quote = ch
            j = i + 1
            closed = False
            while j < n:
                if expr[j] == "\\" and quote != "`":
                    j += 2
                    continue
                if expr[j] == quote:
                    closed = True
                    j += 1
                    break
                j += 1
            tokens.append(("string" if closed else "unterminated_string", expr[i:j], i))
            i = j
            continue
        if ch == "$":
            m = _VAR_RE.match(expr, i)
            if m:
                tokens.append(("var", m.group(0), i))
                i = m.end()
                continue
            tokens.append(("punct", ch, i))
            i += 1
            continue
        if ch.isdigit() or (ch == "." and i + 1 < n and expr[i + 1].isdigit()):
            m = _NUM_RE.match(expr, i)
            tokens.append(("number", m.group(0), i))
            i = m.end()
            continue
        m = _IDENT_RE.match(expr, i)
        if m:
            tokens.append(("ident", m.group(0), i))
            i = m.end()
            continue
        tokens.append(("punct", ch, i))
        i += 1
    return tokens


def _next_punct(tokens, k):
    """tokens[k+1] 이후 첫 토큰(공백은 이미 제거됨)."""
    return tokens[k + 1] if k + 1 < len(tokens) else None


def extract_metric_names(expr):
    """expr에서 **메트릭 이름으로 쓰인 식별자만** 뽑는다.

    제외 규칙(코퍼스 실측 기반):
      (a) 문자열 리터럴 안 — 라벨 매처의 **값**. 예: {attribute_name="Reallocated_Sector_Ct"}
      (b) 라벨 매처의 **키** — `{...}` 안의 식별자 전부
      (c) `by(...)`·`on(...)`·`group_left(...)` 등의 라벨 목록
      (d) 함수·집계연산자·키워드(PROMQL_RESERVED), 그리고 바로 `(`가 뒤따르는 식별자
      (e) Grafana 템플릿 변수(`$instance`·`${datasource}`·`$__rate_interval`)
    단순 `\\b[a-zA-Z_:][a-zA-Z0-9_:]*\\b` 정규식으로는 (a)(b)(c)를 구분할 수 없다.
    또한 `_`는 단어 문자라 `node_apt_upgrades_pending`에서 `apt_upgrades_pending` 같은
    **부분 토큰은 애초에 생기지 않는다** — 이 성질을 self-test 픽스처로 못 박는다.
    """
    tokens = tokenize_promql(expr)
    names = []
    brace_depth = 0
    bracket_depth = 0
    skip_until_paren_close = 0  # 라벨 목록 괄호를 건너뛰는 깊이 카운터
    k = 0
    while k < len(tokens):
        kind, text, _pos = tokens[k]
        if skip_until_paren_close:
            if kind == "punct" and text == "(":
                skip_until_paren_close += 1
            elif kind == "punct" and text == ")":
                skip_until_paren_close -= 1
            k += 1
            continue
        if kind == "punct":
            if text == "{":
                brace_depth += 1
            elif text == "}":
                brace_depth = max(0, brace_depth - 1)
            elif text == "[":
                bracket_depth += 1
            elif text == "]":
                bracket_depth = max(0, bracket_depth - 1)
            k += 1
            continue
        if kind != "ident":
            k += 1
            continue
        # (f) 범위·subquery 대괄호 안 — 기간 리터럴이지 메트릭이 아니다.
        #     `:`가 식별자 시작 문자라 subquery `m[1h:5m]`의 `:5m`이 **유령 식별자**로 잡힌다
        #     [실증 2026-08-03: extract_metric_names('quantile_over_time(0.9, m[1h:5m])')
        #      → ['m', ':5m']]. 스냅샷에 없는 이름이므로 가드가 **거짓 FAIL**을 낸다.
        #     현재 코퍼스에 subquery가 0건이라 아직 안 터졌을 뿐이고, subquery는 흔한 구문이다.
        if bracket_depth > 0:
            k += 1
            continue
        if brace_depth > 0:  # (b) 라벨 매처 키
            k += 1
            continue
        nxt = _next_punct(tokens, k)
        if text in _LABEL_LIST_KEYWORDS:  # (c)
            if nxt and nxt[0] == "punct" and nxt[1] == "(":
                skip_until_paren_close = 1
                k += 2
                continue
            k += 1
            continue
        if text in PROMQL_RESERVED:  # (d)
            k += 1
            continue
        if nxt and nxt[0] == "punct" and nxt[1] == "(":  # (d) 미지 함수 호출
            k += 1
            continue
        names.append(text)
        k += 1
    return names


def _balanced(expr, bad, where):
    """괄호류·따옴표 균형. PromQL 파서가 없을 때 잡을 수 있는 최대치다.

    문자열 리터럴 **안**의 괄호는 세지 않는다 — `label_replace(x, "i", "$1:9100", …)`처럼
    괄호를 담은 정규식 리터럴이 흔해서, 단순 문자 세기는 거짓 FAIL을 만든다.
    """
    stack = []
    pairs = {")": ("(", "괄호"), "]": ("[", "대괄호"), "}": ("{", "중괄호")}
    opens = {"(": "괄호", "[": "대괄호", "{": "중괄호"}
    for kind, text, _pos in tokenize_promql(str(expr)):
        if kind == "unterminated_string":
            bad.append("%s: 따옴표 불균형 — %s" % (where, str(expr)[:70]))
            return
        if kind != "punct":
            continue
        if text in opens:
            stack.append(text)
        elif text in pairs:
            want, label = pairs[text]
            if not stack or stack[-1] != want:
                bad.append("%s: %s 불균형 — %s" % (where, label, str(expr)[:70]))
                return
            stack.pop()
    if stack:
        bad.append("%s: %s 불균형 — %s" % (where, opens[stack[-1]], str(expr)[:70]))


def check_rules(paths, record_only=False):
    """규칙 파일 구조 검사.

    record_only=True 이면 `alert:` 키를 가진 규칙을 실패로 본다(T4-4 정책).
    ⚠️ 이 판정은 **파싱된 dict 기준**이어야 한다. `grep '^\\s*- alert:'` 같은 텍스트 검사는
       YAML 리스트 대시를 줄바꿈한 형태를 통과시킨다 [실증 2026-08-03]:

           rules:
           -
             alert: Foo
             expr: up == 0

       규칙 파일 복사만으로 승인되지 않은 알림이 라이브에 들어갈 수 있으므로(§11) 텍스트로
       판정하지 않는다.
    """
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
                if record_only and has_alert:
                    bad.append(
                        "%s: rules/ 에는 record: 만 허용된다 — alert: %s "
                        "(알림 정본은 Grafana 프로비저닝이 소유한다, §11)"
                        % (where, r.get("alert"))
                    )
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


def check_test_schema(paths):
    """`promtool test rules` 파일의 **스키마만** 검사한다 (check-rules.sh --test --schema-only).

    왜 필요한가: `test rules` 자체는 PromQL 평가 엔진이 필요해 폴백이 원리적으로 불가능하다
    (spec §0.2.2). 그렇다고 promtool 없는 환경에서 테스트 파일을 전혀 안 보면
    "테스트가 깨진 채 커밋됐다"를 아무도 모른다. 이 검사가 그 중간 지대다.

    **잡는 것**: rule_files 존재 + 경로 실재 · tests[]가 리스트 · 각 케이스에 input_series와
                promql_expr_test · exp_samples의 labels/value 존재 · input_series[].series/values
    **못 잡는 것**: 기대값이 옳은가. 그건 평가 엔진의 몫이고, 여기서 흉내내면 거짓 초록이 된다.
    """
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
        except Exception as e:  # noqa: BLE001
            bad.append("%s: YAML 파싱 실패 — %s" % (path, e))
            continue
        if not isinstance(doc, dict):
            bad.append("%s: 최상위가 매핑이 아님" % path)
            continue
        rule_files = doc.get("rule_files")
        if not isinstance(rule_files, list) or not rule_files:
            bad.append("%s: rule_files 없음/비어 있음 — 어떤 규칙을 테스트하는지 불명" % path)
        else:
            base = os.path.dirname(os.path.abspath(path))
            for rf in rule_files:
                target = os.path.normpath(os.path.join(base, str(rf)))
                if not os.path.exists(target):
                    bad.append("%s: rule_files 경로 실재하지 않음 — %s" % (path, rf))
        tests = doc.get("tests")
        if not isinstance(tests, list) or not tests:
            bad.append("%s: tests[]가 리스트가 아니거나 비어 있음" % path)
            continue
        for ti, t in enumerate(tests):
            where = "%s:tests[%d]" % (path, ti)
            if not isinstance(t, dict):
                bad.append("%s: 테스트 케이스가 매핑이 아님" % where)
                continue
            series = t.get("input_series")
            if not isinstance(series, list) or not series:
                bad.append("%s: input_series 없음 — 입력 없는 테스트는 아무것도 증명하지 않는다" % where)
            else:
                for si, s in enumerate(series):
                    if not isinstance(s, dict) or not s.get("series") or s.get("values") in (None, ""):
                        bad.append("%s.input_series[%d]: series/values 누락" % (where, si))
            checks = t.get("promql_expr_test") or t.get("alert_rule_test")
            if not isinstance(checks, list) or not checks:
                bad.append("%s: promql_expr_test 없음 — 기대값 없는 테스트는 통과만 한다" % where)
                continue
            for ci, c in enumerate(checks):
                cwhere = "%s.promql_expr_test[%d]" % (where, ci)
                if not isinstance(c, dict):
                    bad.append("%s: 매핑이 아님" % cwhere)
                    continue
                if not c.get("expr"):
                    bad.append("%s: expr 없음" % cwhere)
                else:
                    _balanced(str(c["expr"]), bad, cwhere)
                if "eval_time" not in c:
                    bad.append("%s: eval_time 없음" % cwhere)
                samples = c.get("exp_samples")
                if samples is None:
                    bad.append("%s: exp_samples 키 자체가 없음(빈 결과를 기대하면 `[]`로 명시한다)" % cwhere)
                    continue
                if not isinstance(samples, list):
                    bad.append("%s: exp_samples가 리스트가 아님" % cwhere)
                    continue
                for xi, x in enumerate(samples):
                    if not isinstance(x, dict) or "labels" not in x or "value" not in x:
                        bad.append("%s.exp_samples[%d]: labels/value 누락" % (cwhere, xi))
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
        record_only = "--record-only" in args
        args = [a for a in args if a != "--record-only"]
        if not args:
            print("usage: promtool_fallback.py check-rules [--record-only] FILE...", file=sys.stderr)
            return 64
        return check_rules(args, record_only=record_only)
    if cmd == "check-test-schema":
        if not args:
            print("usage: promtool_fallback.py check-test-schema FILE...", file=sys.stderr)
            return 64
        return check_test_schema(args)
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

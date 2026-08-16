#!/usr/bin/env python3
"""Grafana 알림 provisioning의 `$` 이스케이프·Go 템플릿 게이트.

이 게이트는 T-E1-6 `check-alerting-escapes.sh` 를 **대체**한다. 그 게이트는 grep 기반이라
필드 문맥(labels냐 annotations냐)을 볼 수 없어 파일 전체에 `$$` 를 강제했고, 그 규칙이
아래 실측과 정면으로 어긋나 **11일간 알림 본문을 비운 채로 초록을 유지했다.**
문맥이 필요한 검사는 파서가 소유해야 한다는 것이 이 교체의 근거다.

■ 실측 (Grafana 13.0.1, 2026-08-14 · /api/v1/provisioning/alert-rules 로 저장값 확인)
  같은 규칙 안에서 필드별로 동작이 **다르다**:

    labels:      소스 `$$labels` → 저장 `$labels`   (이스케이프 먹음 · 정상)
    annotations: 소스 `$$labels` → 저장 `$$labels`  (이스케이프 안 먹음 · 파싱 실패)

  Go 템플릿 파서는 `$$` 를 `bad character U+0024` 로 거부하고, 그러면
  **그 규칙의 annotation 전체가 확장되지 않는다.** 실패는 조용하다 — 규칙은 정상 평가되고
  알림도 발송되지만 summary·drilldown_url·console_url이 빈 채로 나간다.
  = 알림은 오는데 내용이 없다. 14규칙 중 9규칙(keiwi-disk-high 포함)이 이 상태였고,
  Grafana 로그에 72시간 62만 건의 확장 실패가 쌓여 있었다.

  반대로 labels에서 `$` 를 하나만 쓰면 env 보간이 삼켜 `{{ .instance }}` 리터럴이 흐른다
  (2026-08-03 첫 실전 알림 사고의 원인 · grafana/grafana#78118).
  두 함정이 정반대 방향이라 **한쪽 규칙을 파일 전체에 적용하면 반드시 다른 쪽이 깨진다.**

검사 규칙:
  G1  annotations 안의 `{{ }}` 에 `$$` 없음        FAIL  (있으면 확장 실패 → 빈 알림)
  G2  labels 안의 `{{ }}` 는 `$$` 사용             FAIL  (아니면 env 보간이 삼킴)
  G3  `{{ }}` 짝이 맞음                            FAIL
  G4  달러 변수는 $labels·$values·$value 만        FAIL

못 하는 것(정직하게):
  - 템플릿의 **의미**는 보지 않는다. 존재하지 않는 라벨(`$labels.oops`)은 Go 템플릿에서
    빈 문자열로 조용히 렌더된다. 그건 실제 알림 1건을 눈으로 봐야 잡힌다.
  - Go 템플릿 문법 전반을 파싱하지 않는다(파서가 없다). 위 4가지만 본다.
  - **Grafana 버전이 바뀌면 이 비대칭도 바뀔 수 있다.** 위 실측은 13.0.1 기준이고,
    이미지는 `grafana/grafana:latest` 라 업그레이드가 조용히 온다. 업그레이드 후에는
    저장값을 다시 확인해야 한다(위 API 경로 — 익명 GET 가능).

exit: 0 통과 / 1 위반 / 2 환경 부족(PyYAML 없음)
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ALERT_DIR = os.path.join(ROOT, "infra", "monitoring", "grafana", "provisioning", "alerting")

EXPR = re.compile(r"\{\{.*?\}\}", re.S)
DOLLAR = re.compile(r"\$+([A-Za-z_]\w*)")
ALLOWED = {"labels", "values", "value"}
# 이스케이프가 필요한 필드 = Grafana가 env 보간을 적용하는 필드(실측). 그 외는 단일 `$`.
ESCAPED_FIELDS = ("labels",)


def walk(node, path=()):
    """중첩 구조에서 (경로 튜플, 문자열) 을 전부 뽑는다 — 스키마 변화에 안 깨지도록."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk(v, path + (str(k),))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk(v, path + ("[%d]" % i,))
    elif isinstance(node, str):
        yield path, node


def field_of(path):
    """이 문자열이 rule의 어느 필드 밑에 있나 — labels / annotations / 기타."""
    for seg in reversed(path):
        if seg in ("labels", "annotations"):
            return seg
    return "other"


def main():
    try:
        import yaml
    except ImportError:
        print("SKIP: PyYAML 없음 — 이 게이트는 YAML 파서가 필요하다", file=sys.stderr)
        return 2

    files = sorted(glob.glob(os.path.join(ALERT_DIR, "*.yaml")) + glob.glob(os.path.join(ALERT_DIR, "*.yml")))
    if not files:
        print("SKIP: %s 에 provisioning 파일이 없다" % ALERT_DIR, file=sys.stderr)
        return 2

    problems, checked = [], 0
    for f in files:
        rel = os.path.relpath(f, ROOT)
        try:
            with open(f) as fh:
                doc = yaml.safe_load(fh.read())
        except yaml.YAMLError as e:
            problems.append("%s: YAML 파싱 실패 — %s" % (rel, e))
            continue
        for path, text in walk(doc):
            if "{{" not in text and "}}" not in text:
                continue
            where = "%s:%s" % (rel, ".".join(path))
            if text.count("{{") != text.count("}}"):  # G3
                problems.append("G3 %s: {{ }} 짝 불일치" % where)
                continue
            field = field_of(path)
            for expr in EXPR.findall(text):
                checked += 1
                for m in DOLLAR.finditer(expr):
                    name, raw = m.group(1), m.group(0)
                    if name not in ALLOWED:  # G4
                        problems.append("G4 %s: 알 수 없는 변수 $%s" % (where, name))
                        continue
                    doubled = raw.startswith("$$")
                    want = field in ESCAPED_FIELDS
                    if doubled and not want:  # G1 — 확장 실패 → 빈 알림
                        problems.append(
                            "G1 %s: annotations에 $$%s — Go 템플릿이 거부한다(확장 실패 → 본문 없는 알림). $%s 로."
                            % (where, name, name)
                        )
                    elif not doubled and want:  # G2 — env 보간이 삼킴
                        problems.append(
                            "G2 %s: labels에 $%s — env 보간이 삼켜 `{{ .%s }}` 리터럴이 된다. $$%s 로."
                            % (where, name, name, name)
                        )

    if problems:
        for p in problems:
            print(p, file=sys.stderr)
        print("check-grafana-templates: 표현식 %d개 중 위반 %d건" % (checked, len(problems)), file=sys.stderr)
        return 1
    print("check-grafana-templates: 파일 %d · 표현식 %d개 통과" % (len(files), checked))
    return 0


if __name__ == "__main__":
    sys.exit(main())

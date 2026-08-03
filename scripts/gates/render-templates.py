#!/usr/bin/env python3
"""Jinja2 템플릿 오프라인 렌더 (헬퍼 — check-ansible.sh 가 호출한다, §5 D5-5 / T5-16).

**게이트가 아니다**: 파일명이 `check-`로 시작하지 않으므로 verify-all.sh 글롭 대상이 아니고,
반드시 check-ansible.sh 가 부른다. 아무도 부르지 않는 헬퍼는 죽은 코드다(§0.2).

무엇을 하나: 각 role 의 defaults/main.yml(+vars/main.yml)을 컨텍스트로 templates/*.j2 를
렌더해 --out 디렉터리에 떨어뜨린다. 그 결과물을 check-ansible.sh 가 확장자로 갈라
셸은 shellcheck, YAML은 yamllint에 넘긴다.

왜 molecule 대신 이것인가(ADR-0023):
  실제로 우리를 다치게 하는 실패는 "템플릿이 문법 오류라 렌더가 안 된다"와 "렌더 결과가
  깨진 셸/YAML이다" 두 가지다. 전자는 배포가 실패하고 후자는 **배포가 성공한 채 수집만
  조용히 죽는다** — 후자가 더 위험하고, 초 단위 오프라인 검사로 잡힌다.

미정의 변수는 실패로 다루지 않는다(ChainableUndefined):
  인벤토리 변수·ansible facts 는 렌더 시점에 없는 것이 정상이다. 그것을 실패로 보면
  게이트가 항상 red가 되고, red가 일상이 되면 게이트는 무시된다. 여기서 잡는 것은
  **문법 오류**뿐이라는 것을 정직하게 밝힌다.

이 헬퍼가 **못** 잡는 것:
  · 값이 옳은지(포트 번호·경로가 그 노드에 맞는지).
  · 조건 분기의 다른 가지. defaults 컨텍스트 하나로만 렌더하므로 when/if 반대편은 미검증이다.
  · 유닛 파일이 실제로 뜨는지(systemd-analyze 는 러너에서 의존성 경고 노이즈가 커 제외).

exit: 0 통과 / 1 템플릿 문법 오류 / 2 Jinja2·PyYAML 부재
"""
import argparse
import os
import sys

try:
    import yaml
    from jinja2 import ChainableUndefined, Environment, FileSystemLoader
    from jinja2.exceptions import TemplateError
except ImportError as e:  # pragma: no cover
    print(f"SKIP(env: {e.name}) — python3 -m pip install jinja2 pyyaml", file=sys.stderr)
    sys.exit(2)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ROLES_DIR = os.path.join(ROOT, "infra/ansible/roles")


def role_context(role_dir):
    ctx = {}
    for rel in ("defaults/main.yml", "vars/main.yml"):
        path = os.path.join(role_dir, rel)
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as fh:
                ctx.update(yaml.safe_load(fh) or {})
    # ansible 이 항상 주입하는 값 — 없으면 템플릿이 UndefinedError 대신 빈 문자열을 낸다.
    ctx.setdefault("ansible_managed", "Ansible managed")
    ctx.setdefault("inventory_hostname", "render-smoke")
    return ctx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="렌더 결과를 쓸 디렉터리")
    ap.add_argument("--roles-dir", default=ROLES_DIR)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    rendered, failed = [], 0

    for role in sorted(os.listdir(args.roles_dir)):
        tdir = os.path.join(args.roles_dir, role, "templates")
        if not os.path.isdir(tdir):
            continue
        ctx = role_context(os.path.join(args.roles_dir, role))
        env = Environment(
            loader=FileSystemLoader(tdir),
            undefined=ChainableUndefined,
            keep_trailing_newline=True,
            autoescape=False,  # 셸·systemd·YAML 을 낸다. HTML 이스케이프는 오히려 파괴적이다.
        )
        for name in sorted(os.listdir(tdir)):
            if not name.endswith(".j2"):
                continue
            out_name = name[:-3]
            try:
                text = env.get_template(name).render(**ctx)
            except TemplateError as e:
                print(f"FAIL render {role}/{name}: {type(e).__name__}: {e}")
                failed += 1
                continue
            dest = os.path.join(args.out, out_name)
            if os.path.exists(dest):
                # 이름이 겹치면 뒤엣것이 앞엣것을 덮어써 검사 대상이 조용히 사라진다.
                print(f"FAIL 렌더 결과 이름 충돌: {out_name} ({role})")
                failed += 1
                continue
            with open(dest, "w", encoding="utf-8") as fh:
                fh.write(text)
            rendered.append(f"{role}/{out_name}")

    for r in rendered:
        print(f"  rendered {r}")
    print(f"RENDER {'FAIL' if failed else 'OK'} templates={len(rendered)} fail={failed} out={args.out}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

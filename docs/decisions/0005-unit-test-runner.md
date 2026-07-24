# 0005. 단위 테스트 러너 — vitest

- 상태: 채택
- 날짜: 2026-06-22

## 맥락

[spec](../../specs/M1-console/spec.md) §검증 방법은 US4의 핵심 불변식 **no-data ≠ down**을 `lib/status.ts` 단위 테스트로 기계 검증하도록 명시한다(헌장 §9 — 수용 기준은 기계 검증 가능). 이를 `verify`로 강제하려면 테스트 러너가 필요하고, 러너는 의존성이므로 근거를 남긴다(헌장 §8).

## 결정

- **`vitest`(v3.x)**를 dev 의존성으로 추가. `lib/status.ts` 등 **순수 로직** 단위 테스트에 사용.
- 최소 테스트: 매칭 series 0개 → `no-data` / 하나라도 0 → `down` / 모두 1 → `up`, 그리고 "inventory 노드 중 일부 instance 누락 입력 시 해당 노드 `no-data`(≠ down)".
- `package.json`에 `test` 스크립트 추가하고 **`verify` 체인에 포함**한다(lint + typecheck + **test** + build + check:secrets).

## 고려한 대안

- **`node:test`(내장, 의존성 0 — §6에 가장 부합)** — TS 파일을 직접 실행하려면 `tsx`/loader가 필요해 결국 의존성이 추가되고 ergonomics가 낮다. → 기각(단 zero-dep를 최우선하면 합리적 대안).
- **`jest`** — ESM/Next/TS 설정 마찰이 크고 무겁다. vitest가 동일 API에 더 가볍다. → 기각.
- **테스트 생략, API 통합 검증으로 대체** — 순수 로직 불변식을 서버 기동 + Prometheus 모킹으로 확인하는 것은 과하고 간접적이다. → 기각.

## 결과

- 작은 dev 의존성 1개(`vitest`). **US4 불변식이 `verify`(CI)로 강제**된다.
- 프롬프트 §6.1 `verify` 체인 대비 **test 1단계 추가**(spec §검증 방법의 verify 구성에 반영) — 게이트 사인오프 항목.
- 후속: `types/fleet.ts`/`lib/status.ts`의 입력 타입을 [0003](0003-inventory-yaml-parser.md)·[0004](0004-config-validation-zod.md)의 zod 스키마와 일치시켜 테스트가 실제 형태를 검증하게 한다.

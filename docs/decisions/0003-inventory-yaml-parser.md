# 0003. inventory YAML 파서

- 상태: 채택
- 날짜: 2026-06-22

## 맥락

`lib/inventory.ts`가 [`docs/inventory.yaml`](../inventory.yaml)을 **서버에서** 읽어 노드 목록으로 파싱해야 한다(프롬프트 §4.4). inventory는 플릿 단일 기준(헌장 §0)이며 주석이 많은 사람이 읽는 YAML이다. 헌장 §6: 지루한(안정·보편) 기술 선호.

## 결정

- **`yaml` 패키지(eemeli/yaml, v2.x)**로 파싱한다. 서버 전용(`fs`로 파일 읽기 + `parse`), `'use client'` 금지.
- 파싱 결과는 [0004](0004-config-validation-zod.md)의 zod 스키마로 검증해, 형태가 깨진 inventory를 **fail-fast**로 잡는다(노드 `id`/`ip`/`os`/`role`/`exporters` 형태).

## 고려한 대안

- **`js-yaml`** — 가장 오래되고 보편적이라 헌장 §6의 "학습데이터에 잘 표현됨" 축에서는 **js-yaml이 우위**임을 인정한다. 그럼에도 `yaml`을 택한 이유: **TypeScript 네이티브 + 의존성 0**이라 [0004](0004-config-validation-zod.md)의 zod 파이프라인·`types/fleet.ts`와의 정합이 약간 더 매끄럽고 타입 드리프트(§7) 위험이 낮아 동률을 깬다. 단 이는 근소한 차이이며, **§6 보편성을 최우선한다면 `js-yaml`로 뒤집어도 정당**하다(교체해도 다른 결정에 영향 없음 — 한 줄 swap). → `yaml` 채택, `js-yaml`은 동급 fallback으로 기록.
- **직접 YAML 파서 작성** — 헌장 §6은 "기능이 작고 업스트림이 불투명하면 직접"을 허용하나, YAML 파싱은 비자명(앵커·멀티라인·타입 추론)하고 직접 구현은 버그·유지비 위험. → 기각.
- **inventory를 JSON으로 전환해 파서 제거** — 헌장 §0이 `inventory.(md|yaml)`을 명시하고, 현재 파일은 온보딩용 주석이 많아 YAML 가독성이 핵심. JSON은 주석 불가. → 기각.

## 결과

- 작은 안정 의존성 1개(`yaml`) 추가.
- 파싱→zod 검증 파이프라인으로 inventory 스키마 위반을 빌드/런타임에 즉시 노출.
- 서버 전용 보장: `lib/inventory.ts`는 클라이언트 번들에 들어가지 않는다(프롬프트 §4.4).
- 후속: `types/fleet.ts`의 `Node` 타입을 zod 스키마에서 파생(또는 일치)시켜 spec↔코드 드리프트 방지.

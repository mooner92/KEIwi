# 0007. 브랜드↔KRDS 색 전략 (표준형 — 정부 블루)

- 상태: 채택 (개정 2026-06-27 — 확장형→**표준형** 전환)
- 날짜: 2026-06-27

## 맥락

KRDS 채택([0006](0006-krds-adoption.md)) 시 브랜드 처리를 결정한다. **초기엔 확장형(KEIwi green을 Primary로 유지)을 채택**했으나, 구현 후 **원본 KRDS(krds.go.kr)와 직접 대조**한 결과 KRDS의 핵심 시각 시그니처 — **정부 블루 Primary·흰 헤더·정부 공식 식별 배너** — 가 모두 빠져 "토큰은 KRDS, 인상은 비-KRDS"가 됐다. 사용자가 원본 비교 후 **표준형**을 선택했다(정부 블루 전환, 식별 배너 추가, 본문 17px).

- 헌장 **§17**(브랜드/시맨틱 분리). KEI=환경연구원(green 정체성).
- KRDS Primary = `#256ef4`(정부 블루), 본문 17px, 흰 배경 + 운영기관 식별자 + 정부 식별 배너.

## 결정

**표준형을 채택한다(이전 확장형 결정을 번복).**

- **Primary = KRDS 정부 블루.** `--color-brand` → `--krds-color-light-primary-50`(#256ef4), `--color-brand-strong` → `primary-60`(#0b50d0). 버튼·링크·활성 탭·포커스·내비 활성에 사용.
- **KEIwi green은 로고/액센트로 강등.** BrandMark(키위)·소량 포인트에만 유지. **Primary·상태색 어디에도 green을 쓰지 않는다**(§17).
- **헤더 = 흰 배경**(`surface`/`ink`/`border`), 다크 모드에선 토큰이 자동으로 어두워짐. 상단에 **정부 공식 식별 배너** 추가(KRDS 아이덴티티 필수 요소).
- **상태색 = KRDS System** 유지(success/danger/warning/information, [tokens.spec](../../design-system/spec/tokens.spec.md) §4).
- **타이포 = KRDS 스케일**(본문 17px, 16px 루트에서 재선언 — 루트 62.5%는 Tailwind rem 유틸을 깨므로 미적용, 동일 결과).
- **컴포넌트 = 자체 구현 유지**(tokens-only, [0006](0006-krds-adoption.md)). krds-react 미도입.

## 고려한 대안

- **확장형(green Primary 유지)** — 정체성은 강하나 원본 KRDS 대비 "KRDS답지 않은" 인상. 사용자 검증에서 "변화가 작다"로 기각. (초기 결정이었으나 번복.)
- **루트 62.5%(10px)로 KRDS rem 네이티브** — Tailwind `max-w-*`/`--container-*`/기본 type 스케일이 전부 0.625× 축소돼 레이아웃 붕괴. → 기각, 16px 루트에서 KRDS 스케일 재선언으로 동일 결과.
- **krds-react 채택** — 1MB CSS·신생·React19 미검증 리스크([0006](0006-krds-adoption.md)). → 미도입 유지.

## 결과

- 원본 KRDS와 거의 동일한 인상(흰 헤더·정부 블루·식별 배너·17px). KEIwi 정체성은 키위 로고 + green 액센트로 잔존.
- **후속:** 탭/버튼/내비를 KRDS 네이비 스타일로, 컴포넌트 KRDS화(Phase 3). 브랜드 green ramp는 로고용으로만 유지.
- 영향 문서 동기화: [color.spec](../../design-system/spec/color.spec.md) §2, [tokens.spec](../../design-system/spec/tokens.spec.md) §6, [tokens.json](../../design-system/spec/tokens.json) brand, [tasks.md](../../specs/krds-redesign/tasks.md).
- 참조: [0006](0006-krds-adoption.md), [0001](0001-framework-and-styling.md), 헌장 §17.

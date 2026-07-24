# 0006. KRDS 디자인 시스템 채택 (콘솔 크롬)

- 상태: 채택
- 날짜: 2026-06-27

## 맥락

사용자가 콘솔 디자인 시스템을 **대한민국 정부 디자인 시스템 KRDS**로 전면 교체하도록 지시했다(게이트형 SDD). Phase 0에서 병렬 리서치로 `krds-react`/`krds-uiux` 호환성·차트 라이브러리·현행 콘솔을 검증했다.

- 헌장 **§I-2**(단일 콘솔=Grafana, 재구현 금지)·**§6**(지루한 기술)·**§8**(의존성=ADR)·**§17**(브랜드/시맨틱 분리).
- 현행: Tailwind v4 `@theme` 토큰([0001](0001-framework-and-styling.md)), Grafana 임베드([0002](0002-grafana-embed.md)).
- 검증 결과: `krds-uiux`(공식 NIA)는 토큰(`transformed_tokens.json`/`krds_tokens.css`)·원본 SCSS·Pretendard GOV 폰트 포함, JS는 SSR 비호환. `krds-react`는 'use client' 부재·1MB CSS·신생/단일 메인테이너·React19 미검증.

## 결정

KRDS를 채택하되 **콘솔 크롬에 한정**한다. Phase 0 4대 결정:

1. **적용 범위 = 콘솔 크롬만** — shell/nav/카드/탭/배지/Stat·헬스카드/테이블/알림. **시계열 메트릭은 Grafana 임베드 유지**(§I-2). 네이티브 차트로 Grafana를 대체하지 않는다(차트=defer-to-grafana).
2. **토큰 = Tailwind v4 `@theme` 유지 + KRDS primitive 주입** — `krds-uiux`의 `--krds-*`를 primitive SSOT로, `@theme`이 참조([[tokens.spec]]). [0001](0001-framework-and-styling.md) **보완**(대체 아님).
3. **컴포넌트 = `krds-uiux` tokens-only + 자체 React 구현** — 토큰·Pretendard GOV 폰트만 사용하고 컴포넌트는 `components/krds/*`로 직접 구현. `krds-react` 패키지·`ui-script.js`(DOM 직접조작)는 **미사용**(SSR·번들·공급망 리스크 회피).
4. **레이아웃 = 풀폭 반응형 + 다크(KRDS 선명한 화면) 1급** — 관제/NOC 환경.

의존성 추가(§8): **`krds-uiux`**(토큰·폰트 자산). 차트 라이브러리는 **미도입**.

## 고려한 대안

- **`krds-react` 전면 wrap 채택** — 공식 컴포넌트 재사용으로 구현량↓이나, 1MB CSS·sideEffects 미설정·신생/단일 메인테이너·React19 미검증·'use client' 부재. → **기각**(저위험 컴포넌트 시범도 *보류*, 필요 시 별도 ADR).
- **네이티브 KRDS 차트로 Grafana 대체** — 헌장 §I-2/[0002](0002-grafana-embed.md) 정면 위배(중복·비용). 추진 시 헌장 개정 ADR 선행 필요. → **기각**.
- **KRDS SCSS 파이프라인 채택 + Tailwind 제거** — 프롬프트의 SCSS 권장에 충실하나 현행 컴포넌트 전면 재작성·[0001](0001-framework-and-styling.md) 대체. → **기각**(저churn 우선).

## 결과

- 디자인 토큰 SSOT가 `krds-uiux` primitive로 이동(값은 KRDS 소유, 참조만). 브랜드 전략은 [0007](0007-brand-color-strategy.md).
- 스펙은 `design-system/spec/`(SDD). 구현은 Phase 2~5(토큰→컴포넌트→화면→검증).
- #2(노드 드릴다운 `var-instance` 임베드)·Grafana 임베드 구조는 **불가침**(유지).
- 참조: [[principles]], [[tokens.spec]], Phase 0 결정(`krds-redesign-decisions`).

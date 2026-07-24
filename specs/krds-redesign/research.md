# KRDS 리디자인 — Research (Phase 0 근거)

- 권위: [spec.md](./spec.md) 보조. 결정의 사실 근거.
- 방법: 병렬 조사(krds-react/krds-uiux 패키지 실측, KRDS 공식 규칙, 차트 라이브러리, 현행 콘솔 감사).

## 1. krds-uiux (채택: tokens-only)
- 공식 NIA "HTML Component Kit" v1.1.0. 포함: `transformed_tokens.json`·`krds_tokens.css`(`--krds-*` :root 790줄, 3계층)·원본 SCSS·**Pretendard GOV 서브셋 폰트**·바닐라 JS.
- JS(`ui-script.js`)는 DOM 직접조작형 → **SSR 비호환(avoid)**. @font-face 미포함 → 소비자가 선언.
- **결론: tokens-only** — 토큰·폰트만 사용, 컴포넌트는 자체 React 구현.

## 2. krds-react (미채택)
- 공식 v1.1.1, 컴포넌트 ~45종. 단 빌드 산출물에 `'use client'` 0개·포털/`useLayoutEffect` 의존 → App Router 서버컴포넌트 직접 사용 불가(래핑 필수). CSS 단일 1MB·sideEffects 미설정·신생/단일 메인테이너·**React 19 미검증**.
- **결론: 미채택**(공급망·번들·SSR 리스크). 저위험 컴포넌트 시범도 보류 → 필요 시 별도 ADR.

## 3. 차트 라이브러리 (결론: defer-to-grafana)
- Recharts/visx/ECharts 비교: 모두 SSR·토큰주입·번들에서 트레이드오프. ECharts는 사실상 Grafana급 → §I-2 위배 유혹.
- **헌장 §I-2/§2 + ADR-0002**가 이미 결론: 시계열은 Grafana 임베드, 네이티브 차트로 대체 금지. 대체하려면 헌장 개정 ADR 필요.
- **결론: 네이티브 차트 도입 안 함.** 필요 시 '시계열 재현 금지·요약 전용' 경계를 ADR로 봉인 후 visx 우선 평가(백로그).

## 4. 현행 콘솔 감사
- 현재 = Tailwind v4 `@theme` + CSS 변수(브랜드 green/blue/gray + 시맨틱). 컴포넌트는 시맨틱 유틸만(raw hex 0).
- **유지:** lib/status·inventory·prometheus · config/env · types · Grafana 임베드(#2 var-instance 포함) · App Router · inventory.yaml.
- **교체:** @theme 토큰 값 · 서체 · radius · 크롬 색.
- **핵심 이점:** 컴포넌트가 시맨틱 유틸만 쓰므로 @theme 값 교체만으로 자동 리스킨(Phase 2에서 입증).

## 5. KRDS 공식 규칙 (출처 확인)
- 디자인 원칙 7개(krds.go.kr/utility_02) · 토큰 3계층(style_07) · 네이밍(utility_03) · 매직넘버 40=3:1/50=4.5:1/70=7:1/90=15:1(style_02) · System 색 매핑(style_02/09) · Pretendard GOV 17px(style_03) · radius 2/4/6/10/12(style_04) · 8pt 그리드 360/768/1024/1280(style_05) · KWCAG 2.2/44px(utility_04).
- 상세·인용은 [`design-system/spec/`](../../design-system/spec/) 각 스펙에 출처와 함께 반영.

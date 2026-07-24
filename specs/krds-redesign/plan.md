# KRDS 리디자인 — Plan (HOW)

- 상태: 진행 중
- 권위: [spec.md](./spec.md) 종속. 헌장 우선.
- 관련: 작업=[tasks.md](./tasks.md) · 근거=[research.md](./research.md) · 설계 상세=[`design-system/spec/`](../../design-system/spec/)

> 이 문서는 **어떻게**(아키텍처·기술·단계)를 정한다. 무엇/왜=spec.md.

## 1. 기술 컨텍스트

- Next.js 16(App Router, RSC, force-dynamic) · React 19 · TypeScript 5 · **Tailwind v4 `@theme`**(ADR-0001).
- KRDS 자산: **krds-uiux@1.1.0**(tokens-only) — `krds_tokens.css`(primitive)·Pretendard GOV 폰트. krds-react·ui-script(JS)는 미사용(research.md).
- 차트: **없음** — 시계열은 Grafana 임베드(§I-2, defer-to-grafana).

## 2. 헌장 체크 (Constitution Check)

| 조항 | 준수 방법 |
|---|---|
| §I-2 단일 콘솔=Grafana | KRDS는 크롬만. 네이티브 차트 0. 시계열 임베드 유지 |
| §17 브랜드/시맨틱 분리 | 브랜드(green/blue) ↔ KRDS System(상태) 물리 분리(ADR-0007) |
| §8 의존성=ADR | krds-uiux 추가를 ADR-0006으로 근거 |
| §13 시크릿 | 토큰/폰트는 시크릿 아님. .env 불변 |
| §6 지루한 기술 | Tailwind 유지·차트 라이브러리 미도입 |
| §11 사람이 적용 | 빌드 산출물 배포(재시작)는 사람 |

## 3. 아키텍처 — 토큰 3계층

```
L0 KRDS primitive   --krds-color-{light|high-contrast}-{family}-{step}   (krds_tokens.css, 참조전용)
   ↓ var()
L2 @theme 시맨틱     --color-* / --radius-* / --font-*                    (globals.css, 라이트 기본)
   ↓ override
다크               :root[data-theme="dark"]가 --color-*를 high-contrast로 재정의
```

- **매핑 표·라이트/다크 값**: [`design-system/spec/tokens.spec.md`](../../design-system/spec/tokens.spec.md) §4·§5 + [`tokens.json`](../../design-system/spec/tokens.json).
- **컴포넌트 불변**: `bg-success-500` 등 시맨틱 유틸만 쓰므로 @theme 값 교체만으로 자동 리스킨.
- **rem-root 주의**: KRDS rem=10px → 색만 var 참조, radius/타이포는 px/16px-rem 재선언(tokens.spec §2).

## 4. 다크 모드 · FOUC

- 스위치 `<html data-theme>`. 토글=`useSyncExternalStore`(DOM 구독) + 쿠키/localStorage.
- FOUC: `<head>` blocking inline script가 페인트 전 쿠키→localStorage→시스템선호로 `data-theme` 설정. `suppressHydrationWarning`. (layout.spec §5)
- Grafana 임베드 테마 동기화는 **별도 게이트**(realtime-update.spec §Grafana) — 현재 light 유지.

## 5. 서체

- Pretendard GOV(`next/font/local`, 패키지 동봉 woff2, @font-face 직접 선언) weight 400/700. tnum=Pretendard tabular. (typography.spec)

## 6. 단계 (게이트형 SDD — 각 단계 끝 보고·승인)

| Phase | 산출 | 상태 |
|---|---|---|
| 0 정렬·검증 | research(krds 호환·차트·감사) + 4대 결정 | ✅ |
| 1 스펙 | principles·tokens(.spec/.json)·color·typo·shape·layout·patterns·ADR | ✅(컴포넌트 spec 잔여) |
| 2 토큰·파운데이션 | globals @theme·Pretendard·다크·radius 구현 | ✅ |
| 3 컴포넌트 | 크롬 컴포넌트 KRDS 구현(묶음 A→B→C) | ⬜ |
| 4 화면 | 라우트 조립·/servers/[id] | ⬜ |
| 5 검증 | 자동 대비·a11y·README·CI | ⬜ |

## 7. 설계 산출물 (design-system/spec/)

principles.md · tokens.spec.md+tokens.json · color.spec.md · typography.spec.md · shape.spec.md · layout.spec.md · patterns/{server-status,stat-card,realtime-update}.spec.md · (components/ 잔여).

## 8. 검증 전략

verify(기존) + `check:no-krds-primitive`(신설) + 자동 대비 검사(매직넘버, Phase 5) + Playwright 라이트/다크 한 화면 + a11y 체크리스트(컴포넌트별).

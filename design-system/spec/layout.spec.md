# KEIwi 레이아웃 스펙 (8pt 그리드 · 풀폭 · 다크 모드)

> **Phase 1.** 그리드·브레이크포인트·콘텐츠 폭·셸 구조·다크 전환(FOUC 방지)을 고정. 출처: KRDS 레이아웃(style_05) + Phase 0 결정(풀폭+다크 1급). 다크 메커니즘은 [[tokens.spec]] §11 구현.

## 0. 권위·출처
- KRDS 8pt 그리드·브레이크포인트(360/768/1024/1280). [[principles]] AC1.1(한 화면)·AC6.2(FOUC)·AC6.3(풀폭) 인용.

## 1. 8pt 그리드
- 모든 간격·정렬은 **8pt 기준**(4px 하프스텝 허용). 현행 Tailwind 4px 스케일 유지([[tokens.spec]] §8).
- KRDS `padding-card-*`(PC: large 40 / medium 32 / small 24 / xsmall 16px) 의도를 카드 패딩에 차용.

## 2. 브레이크포인트 (KRDS 표준형)
| 단계 | min-width | 컬럼 | 가터 | 스크린 마진 |
|---|---|---|---|---|
| small | 360 | 4 | 16 | 16 |
| medium | 768 | 8 | 16 | 24 |
| large | 1024 | 12 | 24 | 24 |
| xlarge | 1280 | 12 | 24 | 24 |
- xsmall(<360) 최적화 제외. 마진: 모바일 ≥16, PC ≥24.

## 3. 콘텐츠 폭 — **풀폭 반응형** (Phase 0 결정)
- 관제/NOC·와이드 모니터 → **KRDS 1200px 고정 캡을 적용하지 않는다.** 콘텐츠 영역은 **유체(fluid) 풀폭**, KRDS **마진/가터는 준수**.
- 단, **가독 measure**: 장문 텍스트 블록은 폭 제한(약 70~80자). 표/대시보드/strip은 풀폭 활용.
- 현행 `app-shell`의 `max-w-7xl`(1280) → **풀폭으로 확장**(좌우 마진 sm:24px 유지). 초광폭에서 strip 카드는 그리드 컬럼 수로 흡수(현행 `lg:grid-cols-5` 등).

## 4. 셸 구조 (유지 + KRDS 리스킨)
- 현행 `app-shell`: `flex h-dvh flex-col` + TopBar + `main`(스킵링크·`#main`). **구조 유지**, 토큰만 KRDS.
- 랜드마크: `header`(banner)·`nav`·`main`·(필요시 `aside`). KRDS Header/Side Menu 패턴은 components 단계.
- **한 화면(AC1.1):** Overview는 `h-dvh` 풀높이 플렉스로 strip(shrink) + 메트릭(`flex-1 min-h-0`) — 현행 충족, 회귀는 `npm run screenshot`(스크롤=0).

## 5. ★ 다크 모드 전환 + FOUC 방지 (구현 스니펫)
스위치 = `<html data-theme="light|dark">`. tokens.spec §11의 L1 별칭만 전환.

**(a) 서버 선반영 — 쿠키 우선** (`app/layout.tsx`, 서버 컴포넌트):
```tsx
import { cookies } from "next/headers";
export default async function RootLayout({ children }) {
  const theme = (await cookies()).get("keiwi-theme")?.value === "dark" ? "dark" : "light";
  return (
    <html lang="ko" data-theme={theme} style={{ colorScheme: theme }}
          className={pretendardGov.variable}>
      <head>{/* (b) 인라인 스크립트 */}</head>
      <body>{children}</body>
    </html>
  );
}
```
> 쿠키가 있으면 **서버 렌더 HTML에 이미 올바른 data-theme** → 플래시 없음. (page는 force-dynamic이므로 요청별 쿠키 반영 가능.)

**(b) 첫 방문(쿠키 없음) 폴백 — `<head>` 최상단 blocking inline script** (페인트 전 동기):
```tsx
<script dangerouslySetInnerHTML={{ __html:
  `(function(){try{` +
  `var m=document.cookie.match(/(?:^|; )keiwi-theme=(light|dark)/);` +
  `var t=m?m[1]:(localStorage.getItem('keiwi-theme')||` +
  `(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));` +
  `var e=document.documentElement;e.dataset.theme=t;e.style.colorScheme=t;` +
  `}catch(_){}})();` }} />
```
- 외부 의존 0·동기·try/catch 안전. CSP는 nonce 또는 hash 허용(Phase 5).

**(c) 토글**(client): `data-theme` 갱신 + `localStorage.keiwi-theme` + **쿠키**(`document.cookie='keiwi-theme='+t+';path=/;max-age=31536000;samesite=lax'`) 동시 기록 → 다음 SSR이 (a)로 선반영. `aria-pressed`로 토글 상태 노출.

## 6. 모션·기타
- `prefers-reduced-motion` 존중(현행 유지). 모드 전환은 무전환(즉시) 또는 짧은 페이드(reduced-motion 시 0).

## 7. 검증
- 한 화면: `npm run screenshot`(desktop/laptop 스크롤=0).
- FOUC: 라이트/다크 쿠키 각각으로 초기 로드 — 첫 페인트 모드 일치(수동 + 스크린샷).
- 풀폭: 초광폭 뷰포트에서 마진/가터 유지·measure 제한 확인.

## 8. 다음 게이트
파운데이션 완료 → **`patterns/`**(stat-card · server-status · realtime-update) → **`components/`**(button·badge·tag·card·tab·table·header·side-menu·breadcrumb·alert·spinner …).

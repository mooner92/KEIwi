# 06 · 구현 (스택 결합)

> 값·규칙([01]~[05])을 실제 스택에 배선하는 방법. 참조 구현 = **Next.js(App Router) + Tailwind v4 + `krds-uiux`**. 다른 스택은 "3계층 토큰" 개념만 이식하면 됨.

## 1) KRDS 토큰 설치
```bash
npm install krds-uiux
```
전역에서 primitive 토큰 CSS 1회 import(레이아웃 최상단):
```ts
// app/layout.tsx
import "krds-uiux/resources/css/token/krds_tokens.css"; // L0 primitive (--krds-*)
import "./globals.css";                                  // L2 semantic (@theme)
```
> `krds-uiux`의 JS(`ui-script.js`)·React 패키지·1MB CDN CSS는 **쓰지 않는다**(SSR·번들·프레임워크 미검증 리스크). **토큰 CSS + 폰트 파일만** 사용, 컴포넌트는 자체 구현.

## 2) Pretendard GOV 폰트 (@font-face 직접 선언)
패키지엔 폰트 파일(woff2 subset)만 있고 **@font-face가 없다** → 직접 선언. Next는 `next/font/local` 권장(굵기 400/700만).
```ts
// app/fonts.ts
import localFont from "next/font/local";
export const pretendardGov = localFont({
  src: [
    { path: "./fonts/PretendardGOV-Regular.subset.woff2", weight: "400", style: "normal" },
    { path: "./fonts/PretendardGOV-Bold.subset.woff2",    weight: "700", style: "normal" },
  ],
  variable: "--font-pretendard-gov",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});
```
비-Next는 표준 `@font-face`로 동일 파일 지정.

## 3) 3계층 토큰 (핵심 아키텍처)
```
L0 primitive  --krds-*            (krds_tokens.css — KRDS 소유, 참조만)
   ↓ 매핑
L1 semantic   @theme --color-*    (globals.css — 역할 토큰, 라이트 기본)
   ↓ 다크 오버라이드
L1' dark      [data-theme=dark]   (시맨틱/크롬/뉴트럴만 재정의)
   ↓ 사용
L2 component  Tailwind 유틸        (bg-brand, text-ink, border-border … — hex 없음)
```
- **L1은 KRDS primitive를 참조**(예 `--color-ink: var(--krds-color-light-gray-90)`), 브랜드만 자체 램프(예 `--color-brand: var(--color-green-500)`).
- **다크 = KRDS 고대비 팔레트**로 시맨틱만 스왑(전경 -20/-30, 면 -90/-95). 그림자는 면 대비로 대체.
- Tailwind v4는 `@theme`의 `--color-*`/`--text-*`/`--radius-*`가 자동으로 `bg-*`/`text-*`/`rounded-*` 유틸이 됨.

### KEIwi 시맨틱 토큰 이름(참조)
크롬: `canvas · surface · surface-2 · border · border-strong · ink · ink-muted · ink-subtle · chrome · chrome-ink · brand · brand-strong`.
상태: `success/warning/danger/info/neutral -50/100/400/500/600/700`.
램프: `gray-* · green-*(brand) · blue-*(secondary)`.
타입: `text-xs(13)…text-3xl(40)`, 반경 `radius-sm(4)/md(6)/lg(10)/xl(12)`, 그림자 `shadow-1/2/3`.

## 4) 다크(테마) 배선
- `<html data-theme>` 스왑. FOUC 방지: 페인트 전 동기 스크립트(쿠키→localStorage→시스템 선호).
- 스크린샷/서버 렌더가 테마를 알도록 쿠키(`<앱>-theme`) 사용.

## 5) no-raw-hex 규칙 (강제)
- **컴포넌트/화면 코드에 hex/rgb() 금지.** 색은 토큰 유틸(`bg-brand`,`text-danger-700` 등)로만.
- 예외: 토큰 계층(globals.css)·스탠드얼론 SVG(favicon/OG 이미지)만 hex 허용.
- CI/로컬 검사 스크립트로 강제(`check:no-raw-hex`). 위반 시 실패.

## 6) 검증 (릴리스 게이트)
- **정적**: `typecheck` · `lint` · `test`(순수 로직) · `check:no-raw-hex`.
- **시각 QA(Playwright)**: 뷰포트 desktop(1440)·laptop(1366)·mobile(390) × **라이트/다크**, 세로 스크롤 여부 검사. 각 컴포넌트 변경마다 스크린샷으로 규격 확인.
- **라이브 서빙 앱 주의**: 프로덕션 `.next`를 라이브로 서빙 중이면 같은 디렉터리에서 `build`/`dev` 금지(운영 파손). **격리 빌드**(git worktree + 하드링크 node_modules + `next start -p <다른 포트>`)에서만 빌드·스크린샷. 헤드리스 Chromium은 dev HMR과 충돌 → **프로덕션 빌드**로 검증.
- **접근성**: [05](./05-accessibility.md) 체크리스트.

```bash
# 격리 검증 예시
git worktree add --detach /tmp/qa HEAD
cp -al app/node_modules /tmp/qa/app/node_modules
cp app/.env.local /tmp/qa/app/.env.local
rsync -a --delete app/src/ /tmp/qa/app/src/
( cd /tmp/qa/app && node_modules/.bin/next build && node_modules/.bin/next start -p 3199 )
SCREENSHOT_URL=http://127.0.0.1:3199 SCREENSHOT_THEME=dark npm run screenshot
```

## 7) 이식 체크리스트 (새 프로젝트)
- [ ] `krds-uiux` 설치 + `krds_tokens.css` import.
- [ ] Pretendard GOV `@font-face`(굵기 400/700).
- [ ] `@theme` 시맨틱 토큰을 `--krds-*`에 매핑([01] 값), 다크 오버라이드.
- [ ] `--color-brand`(+포커스 링)에 **자체 브랜드 램프**([02]). 링크=info.
- [ ] 컴포넌트 규격([03]) 구현, 반경/상태/포커스 준수.
- [ ] no-raw-hex 검사 도입. Playwright 라이트/다크 스크린샷 게이트.

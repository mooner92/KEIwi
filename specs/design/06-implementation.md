# 06 · 구현 (스택 결합)

> [01]~[05]의 값·규칙을 실제 스택에 배선하는 방법. 참조 구현 = **Next.js(App Router) + Tailwind v4**.
> 다른 스택은 "토큰 2계층 + 테마 오버라이드" 개념만 이식하면 된다.

---

## 1. 토큰 계층 — 2단이면 충분하다

```
L1  @theme --color-* / --text-* / --radius-* / --shadow-*     ← globals.css (라이트 기본)
L1' :root[data-theme="dark"] { --color-*: … }                 ← 다크 오버라이드
L2  Tailwind 유틸  bg-surface · text-ink · border-border …    ← 컴포넌트 (hex 없음)
```

v2에는 primitive(L0) 램프 계층이 더 있었다(`--krds-*` → `gray-90` → `--color-ink`). **삭제했다.**
이유: 램프가 노출되면 개발자가 "적당한 스텝"을 직접 고르고, 그 순간 역할 토큰 체계가 무너진다.
v3에서 색은 **역할 이름으로만** 존재한다.

### Tailwind v4 `@theme`
Tailwind v4는 `@theme` 안의 CSS 변수를 자동으로 유틸리티로 만든다. **설정 파일이 필요 없다.**
| 변수 접두 | 생성되는 유틸 |
|---|---|
| `--color-surface-2` | `bg-surface-2` `text-surface-2` `border-surface-2` |
| `--text-base` (+`--text-base--line-height`, `--text-base--font-weight`) | `text-base` (크기+줄간격+굵기 동시) |
| `--radius-lg` | `rounded-lg` |
| `--shadow-pop` | `shadow-pop` |
| `--font-sans` | `font-sans` |

```css
@import "tailwindcss";

@theme {
  --font-sans: var(--font-pretendard-gov);
  --text-base: 0.875rem;
  --text-base--line-height: 1.5;
  --color-canvas: #f7f8fa;
  --radius-lg: 8px;
  --radius-xl: 8px;   /* 상한 고정 — 실수로 rounded-xl을 써도 시스템이 안 무너진다 */
  --shadow-1: none;   /* 구 그림자 별칭을 none으로 죽인다 */
  /* … [01]의 표 전량 */
}
```

**하위호환 별칭 전략**: 이름을 바꾸면 기존 컴포넌트가 전부 깨진다. `--color-brand: var(--color-accent-ink)`,
`--shadow-1: none`, `--shadow-2: var(--shadow-pop)`처럼 **구 이름을 새 값으로 재정의**해 두면
마이그레이션 중에도 화면이 무너지지 않는다. 신규 코드는 새 이름만 쓴다.

### 다크 오버라이드
```css
:root[data-theme="dark"] { color-scheme: dark; --color-canvas: #0c0d10; /* … */ }
```
- `color-scheme: dark` 필수 — 네이티브 스크롤바·폼 컨트롤이 따라온다.
- **면·선·글·상태·브랜드만 재정의**한다. 타이포·반경은 테마와 무관하다.
- `<html data-theme>` 스왑. **FOUC 방지**: 페인트 전 동기 스크립트(쿠키 → localStorage → 시스템 선호).
- 서버 렌더/스크린샷이 테마를 알아야 하므로 **쿠키**(`keiwi-theme`)를 진실원으로 쓴다.
- 외부 임베드가 있으면 테마 전환 시 **iframe `src`의 `theme=`도 함께 갱신**한다(→ [04 §2](./04-patterns.md)).

---

## 2. Pretendard GOV — 실파일 4종

```ts
// app/fonts.ts
import localFont from "next/font/local";
export const pretendardGov = localFont({
  src: [
    { path: "./fonts/PretendardGOV-Regular.subset.woff2",  weight: "400", style: "normal" },
    { path: "./fonts/PretendardGOV-Medium.subset.woff2",   weight: "500", style: "normal" },
    { path: "./fonts/PretendardGOV-SemiBold.subset.woff2", weight: "600", style: "normal" },
    { path: "./fonts/PretendardGOV-Bold.subset.woff2",     weight: "700", style: "normal" },
  ],
  variable: "--font-pretendard-gov",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});
```
- 출처: PretendardGOV 릴리스의 `web/static/woff2-subset` (4개 파일 모두 동일 서브셋 범위).
- **4종 전부 필수.** v3는 위계를 색이 아니라 굵기로 만든다(§01 굵기 표). 실파일 없이 `font-medium`/
  `font-semibold`를 쓰면 브라우저가 400을 합성(faux bold)해 **한글 자소가 뭉갠다** — v2의 실제 결함
  ([07](./07-changelog.md) 결함 ②).
- 비-Next 스택은 동일 파일로 표준 `@font-face` 4개를 선언하면 된다.
- `display: swap` — 폰트 로딩 중에도 텍스트가 보인다(관제 화면에서 공백은 곧 정보 손실).

### 검증
```bash
# 4개 파일이 다 있는지
ls apps/console/src/app/fonts/
# 브라우저 DevTools → Rendering → "Font rendering" 또는
# document.fonts.check("600 14px 'Pretendard GOV'")  → true 여야 한다
```

---

## 3. no-raw-hex (강제 게이트)

```bash
# scripts/check-no-raw-hex.sh — npm run check:no-raw-hex
grep -rnP '#[0-9a-fA-F]{3,8}\b' src/components && exit 1
```
- **`src/components` 아래 raw hex/rgb() 금지.** 색은 토큰 유틸로만.
- 예외는 **토큰 계층(`app/globals.css`)과 스탠드얼론 SVG**(favicon·OG 이미지)뿐.
- 로고 원색은 `--color-green-500` / `--color-blue-500`으로 **토큰화해서** 컴포넌트에서 참조한다
  (검사를 통과시키기 위한 우회가 아니라, 로고 색이 UI 시맨틱과 분리돼야 하기 때문).
- 이 검사는 `npm run verify` 파이프라인에 포함된다:
  `lint → typecheck → test → build → check:secrets → check:no-raw-hex`.

### 있으면 좋은 추가 검사 (수동 grep으로도 충분)
```bash
grep -rn "text-ink-faint" src/components          # ❌ ink-faint 텍스트 사용 (§05)
grep -rn "hover:-translate\|hover:scale" src      # ❌ 움직이는 hover (§00-5)
grep -rn "shadow-1\b" src/components              # 구 그림자 별칭 잔재 (none이지만 정리 대상)
grep -rnP "text-\[\d+px\]" src                    # ❌ 임의 폰트 크기 (§01)
grep -rn "rounded-\(xl\|2xl\|3xl\|full\)" src     # rounded-full은 dot/토글만 허용
```

---

## 4. 시각 검증 (Playwright)

```bash
SCREENSHOT_URL=http://127.0.0.1:3106 npm run screenshot                    # 라이트
SCREENSHOT_URL=http://127.0.0.1:3106 SCREENSHOT_THEME=dark npm run screenshot  # 다크
SCREENSHOT_PATHS=/overview,/logs,/about SCREENSHOT_URL=… npm run screenshot
```
- 뷰포트 **desktop 1440×900 · laptop 1366×768 · mobile 390×844** × **라이트/다크**.
- **desktop/laptop에 세로 스크롤이 생기면 종료코드 1** — "한 화면" 규칙(§04-1)을 기계가 강제한다.
  모바일은 스크롤 허용.
- 임베드(iframe)가 안 떠도 콘솔 레이아웃은 렌더되므로 `goto` 실패는 무시하고 진행한다.

### ⚠️ 라이브 서빙 앱 주의
프로덕션 `.next`를 라이브로 서빙 중인 디렉터리에서 `build`/`dev`를 돌리면 **운영이 파손된다.**
반드시 **git worktree + 별도 포트**에서만 빌드·스크린샷한다.
```bash
git worktree add /path/qa <branch>
cp -al <live>/apps/console/node_modules /path/qa/apps/console/node_modules
cp <live>/apps/console/.env.local /path/qa/apps/console/.env.local
( cd /path/qa/apps/console && npx next build && npx next start -p 3199 )
SCREENSHOT_URL=http://127.0.0.1:3199 npm run screenshot
```
헤드리스 Chromium은 dev HMR과 충돌하므로 **프로덕션 빌드**로 검증한다.

---

## 5. 새 프로젝트 이식 체크리스트

- [ ] `@theme`에 [01](./01-foundations.md)의 뉴트럴·상태 토큰을 **그대로** 복사(브랜드 독립적이다).
- [ ] **[02 §6](./02-brand-color-roles.md)의 8단계로 브랜드 3단을 다시 계산.** 건너뛰면 포커스 링이 1.4.11 위반.
- [ ] `:root[data-theme=dark]` 오버라이드 + FOUC 방지 스크립트 + 쿠키.
- [ ] 서체 실파일 400/500/600/700 로딩(합성 금지).
- [ ] 전역 `:focus-visible` 더블 링 + `prefers-reduced-motion` 블록.
- [ ] `.tnum` 유틸 + `body` 기본(14px / 1.5 / letter-spacing −0.006em).
- [ ] 상태 컴포넌트를 **색+형태+단어 3중**으로 구현([03 §0](./03-components.md)).
- [ ] `check:no-raw-hex` + Playwright 라이트/다크 게이트를 CI에.
- [ ] [07](./07-changelog.md)에 프로젝트 이력을 새로 쓴다.

## 6. 마이그레이션 순서 (기존 v2 코드가 있을 때)
1. **globals.css를 통째로 교체**하고 구 토큰을 별칭으로 살려둔다(`--color-brand`, `--shadow-1: none`).
   이 시점에서 화면은 안 깨지고 색만 조용해진다.
2. `success-*`/`info-*` 사용처를 찾아 무채색 + 형태 부호화로 바꾼다(**여기가 결함 ③이 터지는 지점** — 상태 구분이
   소실되지 않았는지 반드시 확인).
3. `hover:-translate`·`shadow-*` 잔재 제거.
4. 링크 색 → `ink-muted` + 밑줄.
5. 타이포 스케일 하향(17→14) — 레이아웃이 남는 공간만큼 콘텐츠를 늘린다.
6. 마지막에 별칭 토큰 사용처를 정리하고 별칭을 삭제한다.

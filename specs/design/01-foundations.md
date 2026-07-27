# 01 · Foundations (토큰)

> **원본은 `apps/console/src/app/globals.css`.** 이 문서는 그 값을 옮기고 근거를 붙인 것이다.
> 대비 수치는 WCAG 2.1 상대휘도 식으로 재계산했다(소수 둘째 자리 반올림). CSS 주석의 수치와 ±0.5 내에서
> 일치하며, 차이는 최초 산정 시 반올림 때문이다. **판정에 쓰는 값은 이 문서의 표다.**

## 어휘 (이것 외의 색 이름은 존재하지 않는다)
```
면    canvas · surface · surface-2 · surface-3
선    border-subtle · border · border-strong · border-control
글    ink · ink-muted · ink-subtle · ink-faint
문제  danger · danger-ink · danger-bg · danger-border
주의  warn · warn-ink · warn-bg · warn-border
브랜드 accent · accent-line · accent-ink · accent-bg · accent-contrast
크롬  chrome · chrome-ink · chrome-muted
로고  green-500 · blue-500  (로고 SVG 전용, 다른 곳 사용 금지)
```
**삭제된 것**: `gray-*` `success-*` `info-*` `neutral-*` `warning-*` `blue-*`(로고 제외) `danger-700` 등
**모든 숫자 스텝 램프**. 램프가 있으면 "적당한 스텝"을 골라 쓰게 되고 역할이 흐려진다. v3는 스텝이 아니라
**역할**만 노출한다.

---

## 색 — 라이트

### 면 (surface)
| 토큰 | hex | 용도 | 대비 |
|---|---|---|---|
| `canvas` | `#F7F8FA` | 페이지 바닥 | (surface 대비 1.06:1) |
| `surface` | `#FFFFFF` | 카드·패널·임베드 액자 | — |
| `surface-2` | `#F1F3F6` | hover · inset · 탭바 트랙 · 표 헤더 | surface 대비 1.11:1 |
| `surface-3` | `#E7EAEF` | pressed · 선택 행 | surface 대비 1.21:1 |

> 면 간 대비가 1.05~1.2:1로 아주 얕다. 의도된 것이다 — 분리는 **보더가** 하고, 면은 "같은 종이의 결"만
> 표현한다. 명도차로만 분리하려 들면 계단이 눈에 띄어 침묵 원칙(§00-1)이 깨진다.

### 선 (border)
| 토큰 | hex | 용도 | 흰 배경 대비 |
|---|---|---|---|
| `border-subtle` | `#EDEFF3` | 카드 **내부** 구분선 | 1.15:1 |
| `border` | `#E1E4E9` | 기본 1px 보더(카드·패널·표) | 1.27:1 |
| `border-strong` | `#C9CDD5` | hover 보더 · 점선(판정불가) | 1.59:1 |
| `border-control` | `#8A909E` | 입력·체크박스 **경계** | **3.20:1** ✅ WCAG 1.4.11 |

> `border-control`만 3:1을 넘긴다. 나머지 보더는 **장식**이지 UI 컴포넌트 경계가 아니므로 1.4.11 대상이 아니다.
> 폼 컨트롤의 경계는 "여기를 클릭/입력한다"는 정보라 3:1이 강제된다.

### 글 (ink)
| 토큰 | hex | 용도 | 흰 배경 | canvas | surface-2 |
|---|---|---|---|---|---|
| `ink` | `#16181D` | 본문·제목 | **17.76:1** | 16.71:1 | — |
| `ink-muted` | `#5A6170` | 보조 본문·링크 | **6.22:1** | 5.85:1 | 5.59:1 |
| `ink-subtle` | `#6E7583` | 메타·캡션 | **4.63:1** | 4.36:1 | 4.17:1 ⚠️ |
| `ink-faint` | `#9AA0AC` | **비텍스트 전용** — 정상 dot·구분자·disabled | 2.63:1 ❌ | — | 2.36:1 |

> ⚠️ `ink-subtle`은 흰 배경에서 4.63:1로 AA를 통과하지만 **`surface-2` 위에서는 4.17:1로 미달**한다.
> 회색 면 위의 메타 텍스트는 `ink-muted`(5.59:1)를 쓴다.
> ❌ `ink-faint`를 텍스트에 쓰면 어떤 배경에서도 AA 위반이다 → [05](./05-accessibility.md).

### 상태 (유채색은 문제에만)
| 토큰 | hex | 용도 | 흰 배경 대비 |
|---|---|---|---|
| `danger` | `#D92D20` | dot · 아이콘 · 액센트 바 | 4.83:1 |
| `danger-ink` | `#B42318` | **텍스트** | 6.57:1 |
| `danger-bg` | `#FEF3F2` | 배지·배너 배경 | (danger-ink 얹으면 6.05:1) |
| `danger-border` | `#FECDCA` | 배지·배너 보더 | — |
| `warn` | `#F79009` | dot만 | **2.35:1** — 단독 판독 불가 |
| `warn-ink` | `#B54708` | **텍스트** | 5.43:1 |
| `warn-bg` | `#FFFAEB` | 배지·배너 배경 | (warn-ink 얹으면 5.20:1) |
| `warn-border` | `#FEDF89` | 배지·배너 보더 | — |

**`warn`(주황)은 색 단독으로 절대 쓰지 않는다.** 2.35:1은 비텍스트 최소(3:1)에도 못 미친다 — 주황은 원래
흰 배경에서 대비를 못 내는 색이다. dot으로 쓸 때는 반드시 `warn-ink` 텍스트가 붙어 있어야 하고,
경고 배지는 `warn-bg` + `warn-border` + `warn-ink` 조합(면+선+글 3중)으로 만든다.

**성공/여유 색은 없다.** `ink-muted` + 단어로 표현한다(§00-2).

### 브랜드 (→ 상세는 [02](./02-brand-color-roles.md))
| 토큰 | hex | 용도 | 흰 배경 대비 |
|---|---|---|---|
| `accent` | `#38B38D` | 원색. **다크 전용** | 2.62:1 ❌ |
| `accent-line` | `#2E9B7B` | 라이트 1~2px 마크·**포커스 링** | 3.45:1 ✅ (≥3:1) |
| `accent-ink` | `#1F7A61` | 라이트 초록 **글자**·primary 버튼 면 | 5.23:1 ✅ (≥4.5:1) |
| `accent-bg` | `#EAF6F1` | 선택 행 배경. 화면당 1개소 이하 | (accent-ink 얹으면 4.72:1) |
| `accent-contrast` | `#FFFFFF` | `accent-ink` 버튼 위 글자 | 5.23:1 ✅ |

### 크롬 / 로고
| 토큰 | 라이트 | 용도 |
|---|---|---|
| `chrome` / `chrome-ink` / `chrome-muted` | `#FFFFFF` / `#16181D` / `#6E7583` | 상단바·사이드바 |
| `green-500` `#38B38D` · `blue-500` `#3CA2DF` | — | **로고 SVG 전용.** 대비 규칙의 명시적 예외(장식) |

하위호환 별칭 `--color-brand` / `--color-brand-strong`는 둘 다 `accent-ink`를 가리킨다.
기존 `text-brand`/`bg-brand`가 깨지지 않게 남긴 것이며 **신규 코드는 `accent-*`를 쓴다.**

---

## 색 — 다크

> "어두운 회색"이 아니라 **"빛이 꺼진 종이"**. 순흑(#000) 금지 — 대비가 스매싱되고 1px 보더가 소실된다.

### 면·선
| 토큰 | hex | 비고 |
|---|---|---|
| `canvas` | `#0C0D10` | Grafana 캔버스(#111217)보다 한 단 어둡다 → 임베드가 "뜬 면"이 된다 |
| `surface` | `#16181B` | Grafana 패널(#181B1F)과 사실상 동일 레벨(1.03:1) |
| `surface-2` | `#1B1E22` | surface 대비 1.06:1 |
| `surface-3` | `#22262B` | surface 대비 1.17:1 |
| `border-subtle` | `#1E2126` | |
| `border` | `#262A30` | |
| `border-strong` | `#333841` | |
| `border-control` | `#5F6673` | surface 대비 **3.08:1** ✅ 1.4.11 |

### 글
| 토큰 | hex | surface 대비 | canvas 대비 |
|---|---|---|---|
| `ink` | `#EDEEF1` | **15.33:1** | 16.75:1 |
| `ink-muted` | `#A2A9B5` | 7.52:1 | 8.22:1 |
| `ink-subtle` | `#7B8492` | 4.71:1 | 5.14:1 |
| `ink-faint` | `#565D69` | 2.68:1 ❌ 비텍스트 전용 | 2.93:1 |

> `ink`가 순백이 아닌 이유: 다크 배경 위 #FFF는 할레이션(글자 테두리가 번지는 착시)을 일으킨다.
> #EDEEF1로 15.33:1이면 AAA(7:1)를 여유 있게 넘는다.

### 상태·브랜드
| 토큰 | hex | surface 대비 |
|---|---|---|
| `danger` | `#F97066` | 6.38:1 |
| `danger-ink` | `#FDA29B` | 9.16:1 (danger-bg 위 8.84:1) |
| `danger-bg` / `danger-border` | `#2A1614` / `#46201C` | — |
| `warn` | `#F79009` | 7.58:1 (라이트와 달리 다크에서는 주황이 살아난다) |
| `warn-ink` | `#FEC84B` | 11.50:1 |
| `warn-bg` / `warn-border` | `#2A1E0B` / `#4A3510` | — |
| `accent` = `accent-line` = `accent-ink` | `#38B38D` | **6.78:1** — 셋이 하나로 합쳐진다 |
| `accent-bg` | `#14251F` | accent 얹으면 6.09:1 |
| `accent-contrast` | `#0C0D10` | 초록 면 위 글자 **7.40:1** |

> **다크에서 3단이 1단으로 합쳐지는 것이 핵심**이다. `#38B38D`는 어두운 면 위에서 6.78:1로 텍스트·라인·포커스
> 어디에나 쓸 수 있다. 브랜드색이 "가장 순수하게 사는" 곳이 다크다 → [02](./02-brand-color-roles.md).
>
> ⚠️ **초록 버튼 위 흰 글자는 절대 금지** — `#FFF` on `#38B38D` = **2.62:1**. 다크의 primary 버튼 글자는
> `accent-contrast`(=canvas 색, 7.40:1)다.

---

## 타이포그래피

**서체**: `Pretendard GOV` 단일(`--font-sans`). 폴백 `system-ui, sans-serif`.
v2에 있던 `display`/`mono` 별칭은 **삭제** — 값이 같은 간접층은 혼란만 준다.

### 스케일
| 토큰 | rem | px | line-height | 기본 weight | 용도 |
|---|---|---|---|---|---|
| `text-2xs` | 0.6875 | **11** | 1.45 | 500 | 섹션 캡션·유닛·범례. **한글 하한** |
| `text-xs` | 0.75 | 12 | 1.5 | — | 배지·메타·툴팁 |
| `text-sm` | 0.8125 | 13 | 1.5 | — | 사이드바·표 셀·칩·탭 |
| **`text-base`** | 0.875 | **14** | 1.5 | — | **★ 본문 기본** (`body`에도 직접 적용) |
| `text-md` | 0.9375 | 15 | 1.47 | — | 카드 제목·강조 본문 |
| `text-lg` | 1.0625 | 17 | 1.41 | — | 패널/섹션 타이틀 (구 본문 크기가 여기로 승격) |
| `text-xl` | 1.25 | 20 | 1.4 | — | 페이지 타이틀(H1) |
| `text-2xl` | 1.5 | 24 | 1.33 | — | **최대.** 32/40px 헤딩 폐기 |

`text-[Npx]` 같은 임의값 금지. 8단계면 충분하고, 넘치면 위계 설계가 잘못된 것이다.

### 굵기 — 위계의 주 수단
| weight | Tailwind | 용도 |
|---|---|---|
| 400 | (기본) | 본문·라벨·표 셀 |
| 500 | `font-medium` | 배지·보조 라벨·상태 텍스트·활성 아닌 탭 |
| 600 | `font-semibold` | 카드/패널/페이지 제목·활성 탭·활성 내비 |
| 700 | `font-bold` | **지양** — 400/500/600으로 3단이면 위계는 충분하다 |

**400/500/600/700 모두 실파일**을 로딩한다(→ [06](./06-implementation.md)). 실파일 없이 500/600을 쓰면
브라우저가 400을 굵게 합성(faux bold)해 한글 자소가 뭉갠다 — v2의 실제 결함이었다([07](./07-changelog.md) 결함 ②).

**위계 공식**: 제목 = `ink` + `semibold` / 본문 = `ink` / 보조 = `ink-muted` / 메타 = `ink-subtle`.
크기는 마지막 수단이다.

### 본문 기본 (`body`)
```css
font-size: 0.875rem;      /* 14 */
line-height: 1.5;
letter-spacing: -0.006em; /* 한글 자소가 무너지지 않는 하한 */
-webkit-font-smoothing: antialiased;
text-rendering: optimizeLegibility;
```
자간을 −0.006em보다 더 조이면 "쁘"·"쫒" 같은 밀집 자소의 획이 붙는다.

### 숫자 — `.tnum`
IP·바이트·퍼센트·타임스탬프 등 **갱신되는 숫자**에는 `.tnum` 클래스를 붙인다.
```css
.tnum { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; letter-spacing: 0; }
```
자리수가 흔들리면 값이 안 바뀌었는데도 "움직였다"고 인지된다(§00-5의 연장).

---

## 반경

| 토큰 | px | 적용 |
|---|---|---|
| `rounded-sm` | 4 | 배지 · 중첩 내부 요소 · 포커스 링 기본 반경 |
| `rounded-md` | 6 | 버튼 · 칩 · 입력 · nav 항목 |
| `rounded-lg` | **8** | ★ 카드 · 패널 · 팝오버 · 드로어 · **Grafana 액자** |
| `rounded-full` | — | dot · 토글 트랙 |

`radius-xl` / `2xl` / `3xl`은 **전부 8px로 고정**했다. 실수로 `rounded-2xl`을 써도 시스템이 무너지지 않게 하는
안전장치다. "8px보다 큰 반경은 이 시스템에 존재하지 않는다."

큰 요소일수록 반경을 키우는 관습(카드 12 · 배너 16)을 버린 이유: 반경이 제각각이면 화면이 여러 재질로
보인다. 상한을 고정하면 화면 전체가 **같은 재질**이 된다.

---

## 깊이 (그림자)

| 토큰 | 라이트 | 다크 |
|---|---|---|
| `shadow-pop` | `0 4px 12px -2px rgb(16 18 22 / .10), 0 2px 4px -2px rgb(16 18 22 / .06)` | `0 8px 24px -4px rgb(0 0 0 / .6), 0 0 0 1px #262A30` |
| `shadow-1` | `none` — 구 크롬 그림자, **보더로 대체** | 동 |
| `shadow-2` / `shadow-3` | = `shadow-pop`(하위호환 별칭) | 동 |

- **`shadow-pop`은 팝오버·드로어·모달 전용.** 카드·패널·액자·탭바·사이드바는 0(§00-4).
- 그림자 색이 순흑이 아니라 `rgb(16 18 22)`인 이유: 쿨 뉴트럴 위에 순흑 그림자는 누렇게 보인다.
- **다크 `shadow-pop`은 `0 0 0 1px border` 링을 포함**한다. 어두운 배경에서 검은 그림자는 안 보이므로
  링이 실질적인 "떠 있음" 신호를 담당한다.

---

## 밀도 (간격 리듬)

Tailwind 기본 4px 스케일을 그대로 쓴다. 별도 스페이싱 토큰을 만들지 않는다 — 의미 없는 간접층이다.
아래는 **관제 밀도의 기준값**이며 구현에서 확인된 실측치다.

| 자리 | 값 |
|---|---|
| 상단바 높이 | 56px (`h-14`) |
| 사이드바 폭 | 224px (`w-56`) |
| 메인 패딩 | 16px (`p-4`), ≥sm 24px (`sm:px-6`) |
| 페이지 세로 리듬(섹션 간) | 16px (`gap-4`) |
| 카드 그리드 갭 | 8~12px (`gap-2`~`gap-3`) |
| 내비 항목 | `py-2 pl-3 pr-2` · 13px · 항목 간 2px(`gap-0.5`) |
| 탭 | `px-3.5 py-2` · 13px |
| 표 헤더 / 셀 | `px-3 py-2` · 13px |
| 컨트롤(입력·버튼) 높이 | 40px(`h-10`) 기본, 밀집부 32px(`h-8`) |
| 배지 | `px-1.5 py-px` · 11px |
| 노드 카드(초콤팩트) | `px-2.5 py-1.5` — 1행 제목+상태, 1행 배지 (≈56px) |

**리듬 원칙**: 단일행 크롬은 조이고(≤8px), 의미 블록 사이는 벌린다(16px). 그 중간(12px)은 같은 블록 내부의
그룹 분리에만 쓴다. 세 단계로 충분하다.

---

## 포커스 링 (전역)

```css
:focus-visible {
  outline: 2px solid transparent;   /* forced-colors(OS 고대비) 폴백 */
  outline-offset: 2px;
  box-shadow: 0 0 0 2px var(--color-surface),      /* 내부: 면 분리 */
             0 0 0 4px var(--color-accent-line);   /* 외부: 브랜드 라인 */
  border-radius: var(--radius-sm);
}
```
- **왜 더블 링인가.** 내부 2px `surface` 밴드가 링의 **대비 기준면을 고정**한다. 이 밴드가 없으면
  초록 링이 회색 면(`surface-2`) 위에 놓일 때 대비가 3.10:1까지 떨어져 아슬아슬하다. 밴드가 있으면
  링은 언제나 흰 면(라이트) 대비 **3.45:1**로 판정된다.
- **왜 `accent-line`이지 `accent`가 아닌가.** 원색 `#38B38D`는 흰 배경 **2.62:1**로 WCAG 1.4.11(비텍스트 3:1)
  **미달**이다. v2의 포커스 링이 실제로 이 상태였다([07](./07-changelog.md) 결함 ①).
- 다크에서는 `accent-line`이 `#38B38D`이며 어두운 면 대비 6.78:1로 여유롭다.
- `overflow:hidden`에 잘리는 자리는 inset 링을 쓴다:
  `box-shadow: inset 0 0 0 2px var(--color-accent-line); outline-offset: -4px;`

## 모션

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important;
  }
}
```
기본 트랜지션은 `transition-colors` ≤150ms만. `transform`·`box-shadow`는 트랜지션 대상에서 제외한다(§00-5).

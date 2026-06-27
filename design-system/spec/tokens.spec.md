# KEIwi 토큰 스펙 (KRDS primitive → Tailwind v4 @theme)

> **Phase 1 / 최우선 게이트.** krds-uiux를 **primitive SSOT**로, Tailwind v4 `@theme`이 이를 참조하는 매핑·라이트/다크 값·네이밍 정규식·매직넘버 규칙·FOUC 전략을 정의한다.
> 동반 산출물 `tokens.json`은 이 문서의 매핑을 기계 가독 형태로 담아 빌드·네이밍 lint가 소비한다.
> 구현(@theme/CSS 작성)은 **Phase 2**다. 이 문서는 *무엇을·왜*를 고정한다.

## 0. 권위·출처·SSOT 선언

- **권위:** `Constitution.md`(§17 브랜드/시맨틱 분리) > Phase 0 결정 > 이 스펙. [[principles]] AC3.1·AC3.2(토큰 경유·Primitive 직접 사용 금지)·AC2.1(대비)·AC6.1(라이트/다크 동등)을 충족 근거로 인용.
- **Primitive SSOT(단일 소스):** `krds-uiux@1.1.0` 의
  - `resources/css/token/krds_tokens.css` (Generated 2024-12-09, `:root` 790줄) — **런타임 참조 대상**
  - `tokens/transformed_tokens.json` (Style Dictionary 출력) — 빌드/검증 참조
  - 계층: `primitive(color·number·typo)` → `semantic(gap·padding·radius·size-height)` → `mode-light`/`mode-high-contrast`(color 역할) + `responsive-pc`/`responsive-mobile`(typo·gap).
- **원칙:** primitive 값은 **KRDS가 소유**한다. 우리는 값을 복제하지 않고 `var(--krds-*)`로 **참조만** 한다(SSOT 1개 유지). 단 §3의 rem-root 예외(치수)는 재선언한다.

## 1. 토큰 3계층 모델 (본 프로젝트 적용)

```
[L0] KRDS Primitive   --krds-color-{light|high-contrast}-{family}-{step},  --krds-number-{n}
        (참조 전용 · 컴포넌트/유틸에서 직접 사용 금지)
   ↓ 참조
[L1] 활성 모드 별칭    --k-{role}        (라이트/다크에 따라 L0의 light/high-contrast를 가리킴)
        globals.css 의 :root / [data-theme="dark"] 에서만 정의
   ↓ 참조
[L2] @theme 시맨틱     --color-* / --text-* / --radius-*   (Tailwind 유틸 생성원)
        컴포넌트는 오직 이 유틸(bg-success-500 등)만 사용
```

- L0→L1→L2 **단방향**. 컴포넌트는 L2 유틸만, **L0/L1 직접 참조 금지**(lint §10).
- 다크 전환은 **L1에서만** 일어난다(§11). L2 이름은 모드와 무관하게 고정 → 컴포넌트 코드 불변.

## 2. ★ rem-root 주의 — 색은 참조, 치수는 재선언 (중대)

KRDS 토큰의 rem은 **root = 10px** 가정이다: `--krds-number-6: 1rem`이 곧 **10px**, `--krds-radius-large = number-6 = 10px`, `--krds-pc-font-size-body-medium: 1.7rem`=**17px**. 현행 콘솔/Tailwind는 **root 16px**다. 따라서:

| 토큰 종류 | rem 의존? | 방침 |
|---|---|---|
| **색상**(color) | ✗ (hex) | KRDS `var(--krds-...color...)` **직접 참조** (root 무관, SSOT 유지) |
| **radius** | KRDS는 rem | **px로 재선언**(2/4/6/10/12 — root 무관). KRDS rem var 직접 참조 금지 |
| **typography** | KRDS는 rem@10px | KRDS **px 의도**를 채택해 **16px-root rem(또는 px)로 재선언**(§8). KRDS rem var 직접 참조 금지(1.6× 인플레) |
| **spacing/gap** | KRDS는 rem@10px | 현행 Tailwind 4px 스케일 **유지**(저churn). KRDS number 스케일은 참고만 |

> **금지:** `--text-*`/`--radius-*`/`--spacing-*`에 `var(--krds-number-*)`/`var(--krds-pc-font-*)`를 직접 대입(= root 16px에서 1.6× 확대 버그). 색상만 var 참조.
> (대안: `html{font-size:62.5%}`로 10px-root 전환 시 KRDS rem을 네이티브로 쓸 수 있으나 **현행 16px 기준 UI 전체가 0.625× 축소**되어 Phase 0 '저churn' 위배 → 채택 안 함.)

## 3. KRDS 색상 primitive 카탈로그 (L0 — 값은 KRDS 소유)

`--krds-color-{mode}-{family}-{step}` ({mode}=`light`|`high-contrast`):

| family | steps | 라이트 base(-50) | 비고 |
|---|---|---|---|
| primary | 5·10·20·30·40·50·60·70·80·90·95 | `#256ef4` | KRDS 정부 블루 |
| secondary | 5..95 | light `#346fb2` / **HC `#268097`(teal)** | 모드별 색상 다름 |
| gray | 0·5·10·20·30·40·50·60·70·80·90·95·100 | `#6d7882` | 0=#fff,100=#000 |
| **danger** | 5..95 | `#de3412` | System |
| **warning** | 5..95 | `#9e6a00`(-50) / vivid `#ffb114`(-30) | System (§6 특례) |
| **success** | 5..95 | `#228738` | System |
| **information** | 5..95 | `#0b78cb` | System (우리 `info`) |
| point | 5..95 | `#d63d4a` | 강조 적색 |
| graphic | 10·30·50·70·90 | `#61758f` | 차트용(미사용) |
| alpha | black/white ×6 | — | 투명도 |

> 매핑은 우리 `info` ↔ KRDS `information`. point/graphic은 현재 미사용(브랜드·차트는 §5/Grafana).

## 4. 시스템 상태 색 매핑 (L2 → L1 → L0, 모드별)

우리 스케일 토큰은 **역할(role) 규약**을 가진다: `*-50`=subtle 배경, `*-100`=subtle 보더, `*-500`=base/아이콘/점, `*-600`=텍스트, `*-700`=강조 텍스트, `*-400`=중간 액센트. 이를 KRDS **mode-aware 역할 토큰**(라이트/다크 자동 반전)에 매핑한다. `C ∈ {success, danger, warning, information}`:

| @theme (L2) | 역할 | 라이트(L0/KRDS-light) | 다크(L0/KRDS-high-contrast) | 비고 |
|---|---|---|---|---|
| `--color-C-50` | subtle 배경 | `…light-C-5` | `…high-contrast-C-95` | surface-C-subtler |
| `--color-C-100` | subtle 보더 | `…light-C-10` | `…high-contrast-C-90` | border-C-light |
| `--color-C-400` | 중간 액센트 | `…light-C-40` | `…high-contrast-C-40` | hover 등 |
| `--color-C-500` | base/아이콘/점 | `…light-C-50` | `…high-contrast-C-50` | icon/element-C |
| `--color-C-600` | 텍스트 | `…light-C-60` | `…high-contrast-C-30` | text-C(라이트) |
| `--color-C-700` | 강조 텍스트 | `…light-C-70` | `…high-contrast-C-20` | 다크는 전경 반전 |

**근거(KRDS 역할 토큰으로 검증):** 라이트 `--krds-light-color-text-danger=danger-60`, `icon-danger=danger-50`, `surface-danger-subtler=danger-5`, `border-danger-light=danger-10`. 다크 `--krds-high-contrast-color-text-danger=danger-20`, `surface-danger-subtler=danger-95`. → 위 표는 KRDS 자체 결정과 일치. **다크에서 전경(텍스트/아이콘)은 -20/-30(밝게), 면(배경/보더)은 -90/-95(어둡게)로 반전**되므로 "같은 스텝 치환"이 아니라 이 표를 따른다.

**§6 warning 특례:** warning은 -50이 탁한 황갈이라 KRDS `element-warning`이 **-30**(vivid `#ffb114`)을 쓴다. 따라서 **점/면 강조용** `--color-warning-500`은 라이트 `warning-40`(`#c78500`, 텍스트 대비 확보) / 다크 `high-contrast-warning-30`로 매핑(아이콘 대비 3:1↑). 텍스트(`-700`)는 표 그대로 -70/-20.

## 5. 크롬·뉴트럴 색 매핑

| @theme | 역할 | 라이트 | 다크(HC) | KRDS 역할 근거 |
|---|---|---|---|---|
| `--color-canvas` | 앱 배경 | `light-gray-5` | `high-contrast-gray-95` | background-gray-subtler |
| `--color-surface` | 카드 면 | `light-gray-0`(#fff) | `high-contrast-gray-90` | surface-white / surface-gray-subtle |
| `--color-surface-2` | 융기 면 | `light-gray-10` | `high-contrast-gray-95` | background-gray-subtle |
| `--color-border` | 헤어라인 | `light-gray-20` | `high-contrast-gray-80` | border-gray-light |
| `--color-border-strong` | 강조 보더 | `light-gray-30` | `high-contrast-gray-70` | border-gray |
| `--color-ink` | 본문 텍스트 | `light-gray-90` | `high-contrast-gray-5` | text-basic |
| `--color-ink-muted` | 보조 텍스트 | `light-gray-70` | `high-contrast-gray-20` | text-subtle |
| `--color-ink-subtle` | 3차 텍스트 | `light-gray-50` | `high-contrast-gray-30` | text-disabled-on급 |
| `--color-chrome` | 다크 헤더 면 | `light-gray-90` | `high-contrast-gray-100` | background-inverse |
| `--color-chrome-ink` | 헤더 텍스트 | `light-gray-5` | `high-contrast-gray-5` | text-basic-inverse |

> 본문 대비: 라이트 ink(gray-90 `#1e2124`) on surface(#fff) ≈ 15:1, ink-muted(gray-70 `#464c53`) on #fff ≈ 8:1 → AA/AAA 충족. 다크 ink(gray-5 `#f4f5f6`) on surface(gray-90 `#1e2124`) ≈ 14:1. (정확 수치는 Phase 5 자동 검사로 확정.)

## 6. 브랜드(green/blue) — color.spec.md / ADR-0007로 위임

현행 브랜드 램프 `--color-green-*`(primary, base `#38B38D`)·`--color-blue-*`(secondary, `#3CA2DF`)는 **§17(브랜드/시맨틱 분리)** 자산. KRDS Primary(`#256ef4`)/Secondary와의 매핑 — **(A) KRDS Primary로 흡수** vs **(B) 확장형으로 별도 유지** — 는 **`color.spec.md`에 정책**, **결정 근거는 ADR-0007**에 남긴다(사용자 지시). 이 토큰 스펙은 구조만 고정:
- 어느 쪽이든 브랜드는 **L0 primitive 계층**에 둔다: (A)면 `--color-brand-* → var(--krds-color-light-primary-*)`, (B)면 별도 `--krds-ext-brand-*` primitive를 추가(값은 우리 소유, KRDS 네이밍 규약 준수).
- 상태색(success/danger/warning/information)은 **브랜드와 무관하게** §4 매핑을 따른다(§17).
- 어느 쪽이든 매직넘버 대비(§9) 준수.

## 7. 타이포그래피 스케일 (KRDS PC, §2에 따라 16px-root 재선언)

기준: **Pretendard GOV**, 본문 기본 **body-medium 17px**, 본문 최소 16px, 줄간격 ≥150%, weight 400/700. KRDS PC 스케일(px 의도) → 16px-root rem:

| @theme `--text-*` | KRDS 토큰 | px | rem(16) |
|---|---|---|---|
| display-large/medium/small | `pc-font-size-display-*` | 60/44/36 | 3.75/2.75/2.25 |
| heading-xlarge…xxsmall | `pc-font-size-heading-*` | 40/32/24/19/17/15 | 2.5/2/1.5/1.1875/1.0625/0.9375 |
| body-large/medium/small/xsmall | `pc-font-size-body-*` | 19/17/15/13 | 1.1875/1.0625/0.9375/0.8125 |
| label-large…xsmall | `pc-font-size-label-*` | 19/17/15/13 | 동일 |

- **폰트:** Pretendard GOV로 교체. krds-uiux `resources/fonts/PretendardGOV-{Regular,Bold}.subset.woff2`를 `next/font/local`로 등록(**@font-face가 패키지에 없으므로 직접 선언** — `font-family:"Pretendard GOV"`, weight 400/700). 수치(IP·메트릭)는 `tnum` 유지(Pretendard tabular 또는 mono 병행 — typography.spec에서 확정).
- 밀도(테이블/로그)는 body-small(15)·xsmall(13) 적극 사용(원칙 5), 대비 기준 유지.
- 모바일은 `responsive-mobile` 스케일 존재(display 44/32/28 등) — 풀폭 데스크톱 우선이라 PC 기준, 반응형은 layout.spec에서.

## 8. Radius / Spacing

- **Radius(px 재선언):** KRDS 5단계 — xsmall=2 / small=4 / medium=6 / large=10 / xlarge=12, max=원형. Tailwind 유틸 override:
  | 유틸 | KRDS | px |
  |---|---|---|
  | `rounded-sm` | small | 4 |
  | `rounded-md` | medium | 6 |
  | `rounded-lg` | large | 10 |
  | `rounded-xl` | xlarge | 12 |
  | `rounded-full` | max | 9999 |
  (현행 카드 `rounded-lg`는 8→**10px**로 미세 변경.)
- **Spacing:** 현행 Tailwind 4px 스케일 **유지**(저churn). KRDS `number`(rem@10px: 1·2·4·6·8·10·12·16·20·24·28·32…px)·`gap`·`padding` semantic은 참고용. 컴포넌트 spec에서 KRDS `padding-card-*`(PC large=40 / medium=32 / small=24 / xsmall=16px) 의도를 px로 차용 가능.

## 9. 매직넘버 대비 규칙 (KRDS 명도 스케일)

KRDS 스텝↔대비(기준 배경 대비): **40 = 3:1**, **50 = 4.5:1**, **70 = 7:1**, **90 = 15:1**.

| 용도 | 최소 대비 | 토큰 의무 |
|---|---|---|
| 본문 텍스트 | **4.5:1 (AA)** | 텍스트는 `*-700`(=-70, 7:1) 권장 / 최소 `*-600`(=-60) |
| 큰 텍스트·비텍스트(아이콘/보더/그래프) | **3:1** | `*-500`(=-50) 이상 |
| 강화(AAA) | 7:1 | `*-700`(=-70) |

- **색상 단독 금지(원칙 2):** 상태/로그레벨은 색 + 아이콘 + 텍스트 병행(상세 매핑은 `color.spec.md`).
- 라이트/다크 **양쪽** 위 기준 충족(§4·§5 매핑이 KRDS 역할 토큰을 따르므로 KRDS가 보장하는 대비 상속). 최종 검증은 Phase 5 자동 대비 검사(매직넘버 기준).

## 10. 네이밍 규칙 & 검증 정규식 & lint

**KRDS 네이밍 철학 준수:** 순서 `namespace>theme>category>component>type>variant>element>state>size>modifier`, **하이픈 구분**, **약어 금지**(`bg`→`background`, `xs`→`xsmall`).

본 프로젝트 L2 토큰(Tailwind `@theme`) 검증:
- **이름 정규식(통과 조건):**
  ```
  ^--(color|text|radius|font|spacing|leading|tracking)-[a-z][a-z0-9]*(-[a-z0-9]+)*$
  ```
  (전부 소문자 kebab, 알려진 카테고리로 시작.)
- **상태/시스템 색 정규식:**
  ```
  ^--color-(success|info|warning|danger|neutral)-(50|100|400|500|600|700)$
  ```
- **약어 금칙(매칭 시 실패):** `\b(bg|fg|btn|xs|sm|md|lg|xl|err|wrn|clr|bdr)\b`
- **L0 참조 전용 lint(`check:no-krds-primitive`):** `apps/console/src/**`(globals.css 제외)에서 다음 발견 시 실패:
  - `--krds-` 직접 참조, KRDS 클래스(`krds-…`), 또는 primitive 패밀리 직접 사용.
  - 즉 컴포넌트는 L2 유틸(`bg-success-500`)만. (기존 `check:no-raw-hex` 병행.)
- 위 규칙은 `tokens.json`에 기계 가독 형태로 수록 → Phase 2 빌드 게이트.

## 11. 다크 모드 메커니즘 + FOUC 방지 (사용자 지시)

- **스위치 축:** `<html data-theme="light|dark">`. `color-scheme`도 동기화.
- **L1 별칭 전환만:** `:root,[data-theme="light"]`는 `--k-* → var(--krds-light-color-*)`, `[data-theme="dark"]`는 `--k-* → var(--krds-high-contrast-color-*)`. L2 `@theme`는 `--k-*`만 참조 → 모드 무관.
- **FOUC 방지(SSR 선반영):**
  1. **쿠키 우선:** 루트 `layout.tsx`(서버)가 요청 쿠키 `keiwi-theme`를 읽어 `<html data-theme={cookie}>`를 **서버 렌더 시점에** 박는다 → 첫 페인트부터 올바른 모드(플래시 없음).
  2. **쿠키 없을 때(첫 방문):** `<head>` 최상단 **blocking inline script**가 페인트 전 동기 실행 — `localStorage.theme` 또는 `matchMedia('(prefers-color-scheme: dark)')`로 `data-theme`를 즉시 설정.
  3. **토글:** 클라이언트에서 `data-theme` 갱신 + `localStorage` + **쿠키(max-age 1y)** 동시 기록(다음 SSR이 쿠키로 선반영).
  - 인라인 스크립트는 최소·정적(외부 의존 0)로 §성능·CSP 고려. layout.spec에서 스니펫 확정.

## 12. 다크 토글 ↔ Grafana iframe 테마 (노트)

- **#2 임베드 구조는 불가침**(유지 목록): `buildEmbedSrc`의 `kiosk`·`var-instance`·이중 `?` 병합 로직 변경 금지.
- 현재 임베드는 `theme=light` 고정. 콘솔 다크 ↔ Grafana는 **별개 출처(iframe)** 라 자동 동기화되지 않는다.
- **동기화 정책(별도 게이트):** 콘솔이 다크면 임베드 URL의 `theme` 파라미터를 `dark`로 **선택적 동기화** — `buildEmbedSrc(…, { theme })`처럼 **파라미터만** 추가하고 `var-instance`/`kiosk`/병합 규칙은 그대로 둔다. 이 변경은 tokens 구현 범위 밖이며 `realtime-update.spec.md`(또는 임베드 노트)에서 다룬다. **현 단계 기본값: Grafana는 light 유지**(데이터 정확성·#2 회귀 0 우선).

## 13. tokens.json (동반 산출물) 역할

`design-system/spec/tokens.json`은 위 매핑을 기계 가독으로 담는다:
- `primitive`: SSOT 출처(krds_tokens.css)·패밀리·스텝 매니페스트(값은 KRDS 소유 표시).
- `semantic.color`: L2 토큰 → `{role, light:"--krds-…", dark:"--krds-…"}` (§4·§5 표).
- `semantic.radius`/`type`: KRDS px 의도(§7·§8).
- `naming`: 정규식·금칙어(§10). `contrast`: 매직넘버(§9).
- Phase 2 빌드 스크립트가 이를 읽어 `@theme` + L1 별칭 CSS를 생성(또는 검증)한다.

## 14. 다음 게이트
이 문서 + `tokens.json` 승인 후 → **`color.spec.md`**(브랜드↔KRDS Primary 정책 + 로그레벨·서버상태 System 매핑 표) & **ADR-0007**(브랜드 흡수 vs 확장 결정 근거). 이어 typography/shape/layout.spec.

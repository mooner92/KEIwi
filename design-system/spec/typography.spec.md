# KEIwi 타이포그래피 스펙 (Pretendard GOV + KRDS 스케일)

> **Phase 1.** 폰트 로딩·타입 스케일·수치 정렬 정책을 고정. 값 출처: [[tokens.spec]] §7 (krds_tokens.css `responsive-pc` 실측). KRDS rem-root(10px) 주의 → **16px-root rem/px로 재선언**.

## 0. 권위·출처
- 출처: KRDS 타이포(krds.go.kr/style_03) + krds-uiux `pc-font-size-*`. [[principles]] AC5.2(tnum)·AC2.1(대비)·AC1.1(밀도) 인용.

## 1. 서체 — Pretendard GOV
- **기본 서체 = Pretendard GOV**(한글·영문 공통). Geist Sans/Space Grotesk를 대체.
- **로딩:** krds-uiux 동봉 서브셋 `resources/fonts/PretendardGOV-{Regular,Bold}.subset.woff2`를 **`next/font/local`**로 등록. (Medium도 패키지에 있으나 KRDS는 **weight 400/700만** 사용 → Regular=400, Bold=700 로드.)
  - ⚠️ **패키지에 `@font-face` 없음** → `next/font/local`이 생성하므로 우리가 family·weight를 명시한다:
    ```ts
    // app/fonts.ts
    import localFont from "next/font/local";
    export const pretendardGov = localFont({
      src: [
        { path: "../../node_modules/krds-uiux/resources/fonts/PretendardGOV-Regular.subset.woff2", weight: "400", style: "normal" },
        { path: "../../node_modules/krds-uiux/resources/fonts/PretendardGOV-Bold.subset.woff2",    weight: "700", style: "normal" },
      ],
      variable: "--font-pretendard-gov",
      display: "swap",
      fallback: ["system-ui", "sans-serif"],
    });
    ```
  - `@theme`: `--font-sans: var(--font-pretendard-gov)`. `--font-display`도 동일 family(별도 디스플레이 서체 없음 — KRDS 단일 서체).
  - 서브셋이 일부 글리프 누락 시 `fallback`(system-ui)로 안전. 라이선스(SIL OFL/Pretendard) README 명기(Phase 5).

## 2. 타입 스케일 (KRDS PC, 16px-root)
`@theme`에 `--text-{role}` + 짝 line-height 정의. base 본문 = **body-medium 17px**, 본문 최소 16px, 줄간격 **≥150%**.

| 토큰 `--text-*` | px | rem(16) | line-height | 용도 |
|---|---|---|---|---|
| `display-large` | 60 | 3.75 | 1.25 | 히어로(거의 미사용) |
| `display-medium` | 44 | 2.75 | 1.25 | |
| `display-small` | 36 | 2.25 | 1.3 | |
| `heading-xlarge` | 40 | 2.5 | 1.3 | |
| `heading-large` | 32 | 2.0 | 1.3 | 페이지 H1급 |
| `heading-medium` | 24 | 1.5 | 1.35 | 섹션 H2 |
| `heading-small` | 19 | 1.1875 | 1.4 | 카드 제목 H3 |
| `heading-xsmall` | 17 | 1.0625 | 1.45 | |
| `heading-xxsmall` | 15 | 0.9375 | 1.5 | |
| `body-large` | 19 | 1.1875 | 1.6 | |
| **`body-medium`** | **17** | **1.0625** | **1.6** | **기본 본문** |
| `body-small` | 15 | 0.9375 | 1.6 | 밀도(테이블/로그) |
| `body-xsmall` | 13 | 0.8125 | 1.55 | 메타/배지 |
| `label-*` | 19/17/15/13 | = body | 1.4 | 폼 라벨/버튼 |

- **줄간격 전부 ≥1.5(본문)** — 큰 헤딩만 1.25~1.4 허용(KRDS 위계).
- **weight:** 본문/라벨 400, 강조·헤딩 700. (500/600 미사용 — KRDS 2단계.)
- **letter-spacing:** 기본 0(`--krds-typo-letter-spacing-0`). 대형 display만 약간 음수 허용(선택).
- 현행 `font-display:Space Grotesk` 페어링은 폐기(단일 서체). 현행 `text-base/lg` 등 Tailwind 기본 대신 위 `--text-*` 사용 권장(밀도·KRDS 정합).

## 3. 수치 정렬 (tnum) — IP·메트릭
- 현행 `.tnum`은 **Geist Mono** 기반 → **Pretendard GOV + `font-variant-numeric: tabular-nums`**로 전환(단일 서체 유지, KRDS 정합). Pretendard는 tnum 피처 지원.
  ```css
  .tnum { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
  ```
- 적용: IP, 포트, 카운트, 메트릭 수치(노드 카드·strip·표). 정렬·자릿수 흔들림 방지(AC5.2).
- (mono 서체가 꼭 필요한 코드/로그 raw 영역은 `--font-mono` 별도 유지 가능 — 기본은 Pretendard tnum.)

## 4. 검증
- 본문 ≥16px·줄간격 ≥1.5 — 리뷰/시각 QA.
- 폰트 로드 실패 시 fallback 렌더(레이아웃 시프트 최소, `display:swap`).
- tnum 적용 영역 수치 정렬 — 스크린샷 점검.

## 5. 다음
`shape.spec.md`(radius/border) → `layout.spec.md`.

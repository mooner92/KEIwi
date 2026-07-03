# 01 · Foundations (토큰)

> KRDS 원본 값. **정확한 px/hex** — 그대로 복붙해 이식한다.
> ⚠️ **단위 주의**: KRDS 원본 CSS는 루트 `62.5%`라 **1rem=10px**. 아래 표는 전부 **px**로 환산했다. 16px 루트(대부분의 Tailwind 기본) 프로젝트는 **px 열을 그대로** 쓰거나 rem을 재선언한다.

## 타이포그래피
- **폰트**: `"Pretendard GOV", sans-serif` (한/영 겸용, 공공기관 판독성 튜닝). 확장 폴백: Noto Sans, Nanum Gothic, Spoqa Han Sans, system-ui.
  - Pretendard GOV는 **@font-face가 패키지에 없음** → 직접 선언(→ [06](./06-implementation.md)). 정부 라이선스 폰트.
- **굵기**: 물리 폰트는 **400·700만**(Pretendard GOV 배포 파일 기준). 위계별 사용 규약(2026-07-03 명문화, [07 모호점 ②](./07-changelog.md) 해소):
  | weight | Tailwind | 용도 |
  |---|---|---|
  | 400 | (기본) | 본문·label |
  | 500 | `font-medium` | 보조 라벨·배지 |
  | 600 | `font-semibold` | 카드/패널 제목 |
  | 700 | `font-bold` | 페이지 제목·탭·강조 |

  ⚠️ **500/600은 브라우저 synthetic weight**(400 기반 합성 — 물리 파일 없음). 미세한 렌더 차는 허용하되, 한 화면의 위계 단계는 최대 3~4개 이내.
- **줄간격**: 전역 **1.5**(WCAG 1.4.12). 칩/태그 등 단행은 1.
- **자간**: 기본 0. Display·H1·H2만 +1px(0.1rem).
- **본문 기본**: **17px**(Pretendard GOV가 약간 작게 렌더 → 16px 아닌 17px 권장). 최소 16px.
- **한글 줄바꿈**: `word-break: keep-all`.

타입 스케일 (px, PC / Mobile). Body·Label은 크기 동일(의미만 구분: label=UI 컨트롤 텍스트).

| 역할 | PC | Mobile | 굵기 |
|---|---|---|---|
| Display L / M / S | 60 / 44 / 36 | 44 / 32 / 28 | 700 |
| Heading xlarge (H1) | 40 | 28 | 700 |
| Heading large (H2) | 32 | 24 | 700 |
| Heading medium (H3) | 24 | 22 | 700 |
| Heading small (H4) | 19 | 19 | 700 |
| Heading xsmall (H5) | 17 | 17 | 700 |
| Heading xxsmall | 15 | 15 | 700 |
| Body large | 19 | 19 | 400 |
| **Body medium (기본)** | **17** | **17** | 400 |
| Body small | 15 | 15 | 400 |
| Body xsmall | 13 | 13 | 400 |
| Label L/M/S/XS | 19/17/15/13 | = | 400 |
| Navigation title / depth | title 24·19 / depth 17·15 | title 22·17 | 400·700 |

이상적 제목:본문 비율 1.25~1.5×.

## 색 — 뉴트럴(그레이) 램프 (light)
높은 step = 어두움. gray는 0·100 포함.

| step | hex | | step | hex |
|---|---|---|---|---|
| 0 | `#ffffff` | | 50 | `#6d7882` |
| 5 | `#f4f5f6` | | 60 | `#58616a` |
| 10 | `#e6e8ea` | | 70 | `#464c53` |
| 20 | `#cdd1d5` | | 80 | `#33363d` |
| 30 | `#b1b8be` | | 90 | `#1e2124` |
| 40 | `#8a949e` | | 95 | `#131416` |
| | | | 100 | `#000000` |

고대비(다크) 모드용 `high-contrast-gray-*` 병렬 램프 존재(같은 step 명, 대비 강화).

## 색 — 시맨틱(상태) 램프 (light)
| family | 5 (연한 bg) | 30 | 40 | 50 (base) | 60 (text) | 70 |
|---|---|---|---|---|---|---|
| danger(error) | `#fdefec` | `#f48771` | `#f05f42` | `#de3412` | `#bd2c0f` | `#8a240f` |
| warning | `#fff3db` | `#ffb114`* | — | `#9e6a00` | `#8a5c00` | — |
| success | `#eaf6ec` | `#7ec88e` | `#3fa654` | `#228738` | `#267337` | — |
| information | `#e7f4fe` | `#5fb5f7` | `#2098f3` | `#0b78cb` | `#096ab3` | — |

- warning 특례\*: **채움(fill/element)** 역할은 밝은 `warning-30 #ffb114`, **텍스트/보더/아이콘**은 어두운 `warning-50/60`. 이 분리를 지키지 않으면 경고 UI가 탁해진다.
- warning 보조: 10 `#ffe0a3`, 20 `#ffc95c`.
- **방문 링크**: `#5917b8`(하드코딩 보라 — 어느 family에도 안 묶임, 그대로 사용).

## 색 — 역할 토큰 (light, 브랜드 독립)
- **텍스트**: basic gray-90 · bolder gray-95 · subtle gray-70 · disabled gray-40 · inverse gray-0.
- **면(surface/bg)**: white `#fff` · subtler gray-5 · subtle gray-10 · disabled gray-20 · inverse gray-90 · dim(모달 스크림) `#000000bf`.
- **보더**: light gray-20 · base gray-30 · dark gray-60 · darker gray-90 · disabled gray-30.
- **구분선(divider)**: light gray-20 · base gray-40 · dark gray-50.
- **입력**: border gray-60 · border-active `<brand>` · border-error danger-50 · surface white · surface-disabled gray-20.
- **링크**: default `<brand or info>` · hover +1 step · pressed +2 step · visited `#5917b8`.
> 브랜드 묶임 역할(primary/secondary/point, 링크 기본색, 입력 활성 보더, 포커스 링)은 [02](./02-brand-color-roles.md)에서 자체 브랜드로 교체.

## 스페이싱 (8pt 그리드, px)
원자 스케일 → 시맨틱 별칭 사용 권장.
- gap: 1=2 · 2=4 · 3=8 · 4=12 · 5=16 · 6=20 · 7=24 · 8=32 · 9=40 · 10=48 · 11=64 · 12=80
- padding: 1=2 · 2=4 · 3=8 · 4=10 · 5=12 · 6=16 · 7=20 · 8=24 · 9=32 · 10=40
- 컨트롤 높이: 40 · 48 · 56 · 64 · 80
- 아이콘: 16 / 20 / 24(기본) / 32 / 40, 스트로크 1.6px@24
- 카드 패딩(PC): xsmall 16 · small 24 · medium 32 · large 40
- 레이아웃 리듬(PC): breadcrumb→H1 32~40 · 섹션(H2↔) 48~80 · 콘텐츠→푸터 64 (관제는 축소 가능)

## 반경 (요소별 고정, px)
| 토큰 | px | 적용 |
|---|---|---|
| xsmall | 2 | 인디케이터·프로그레스 |
| small | 4 | 배지(비인터랙티브)·체크/라디오·스위치 |
| medium | 6 | **버튼·입력·텍스트영역·셀렉트·페이지네이션** |
| large | 10 | **카드·다이얼로그·패널** |
| xlarge | 12 | 배너·바텀시트 |
| max | pill/원 | 토글 트랙·dot·pill 배지·칩/태그(인터랙티브) |

## 그림자 (elevation, 이식 기준 레시피)
KRDS는 명명 스케일 없이 3단 알파(5%/8%/12%)로 조합.
- **sm(드롭다운/저팝오버)**: `0 0 2px rgba(0,0,0,.05), 0 4px 8px rgba(0,0,0,.08)`
- **md(맥락 도움/중팝오버)**: `0 0 2px rgba(0,0,0,.08), 0 8px 16px rgba(0,0,0,.12)`
- **lg(모달)**: `0 0 2px rgba(0,0,0,.08), 0 16px 24px rgba(0,0,0,.12)`
- 고대비 모드는 알파 12/20/40%로 강화. 다크는 그림자보다 **면 대비(canvas<surface<surface-2)**가 주 입체감.

## 브레이크포인트·컨테이너·그리드
- 브레이크포인트(px): small 360 · **medium 768(주 분기)** · **large 1024** · xlarge 1280 · xxlarge 1440.
- 컨테이너: 콘텐츠 max **1200**, wrap **1248**(=1200+24×2). 화면 여백 PC 24 / mobile 16. 거터 16(sm)·16~24(md+).
- 8pt 그리드. 열 그리드 토큰은 없음(flex 기반). 대시보드는 유동(fluid) 허용.

## z-index 사다리
skip link **10000** · 모달 dialog 1020 / modal 1010 / backdrop 1000 · 헤더/GNB ~60–71 · 툴팁/팝오버 100 · 소형 스택 1–10.

## 포커스 링 (접근성 핵심 — 브랜드 색 사용)
KRDS는 **더블 링**: 내부 2px(면/inverse) + 외부 4px(brand). 어떤 배경에서도 보이도록 outline+box-shadow 조합, `transition:0`(즉시 표시).
- 이식 권장 CSS(브랜드 교체 시 링도 자동 변경):
  ```css
  :focus-visible {
    outline: 2px solid transparent;                 /* forced-colors 폴백 */
    outline-offset: 2px;
    box-shadow: 0 0 0 2px var(--color-surface),      /* 내부: 면 분리 */
                0 0 0 4px var(--color-brand);        /* 외부: 브랜드 */
    border-radius: 4px;
  }
  ```
- overflow:hidden에 잘리는 요소는 KRDS `focus()`식 inset 링: `box-shadow: inset 0 0 0 2px var(--color-brand); outline-offset:-4px`.

## 대비 "매직 넘버" (step ↔ 대비비)
색을 **필요한 대비비로 고른다**: step **40≈3:1** · **50≈4.5:1** · **70≈7:1** · **90≈15:1**.
- 본문 텍스트 ≥4.5:1(→ step 50+) · 큰 텍스트/UI/아이콘 ≥3:1(→ step 40+) · 고대비 모드 본문 7:1→15:1.

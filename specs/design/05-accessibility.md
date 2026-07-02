# 05 · 접근성 (KWCAG / WCAG AA)

> 타협 불가 요건. KRDS는 접근성 우선 시스템 — 이 항목들은 "있으면 좋은" 게 아니라 **통과 기준**.

## 목표
- **WCAG / KWCAG Level AA**. 고대비("선명한 화면") 모드는 AAA급(본문 15:1).

## 대비 (매직 넘버로 고르기)
| 대상 | 최소 | step 힌트 |
|---|---|---|
| 본문 텍스트 | 4.5:1 | step 50+ |
| 큰 텍스트(≥19 bold/24)·UI·아이콘 | 3:1 | step 40+ |
| 비텍스트(경계/그래픽) | 3:1 | step 40+ |
| 고대비 모드 본문 / 라벨 / 아이콘 | 15:1 / 7:1 / 4.5:1 | 팔레트 스텝 전환으로 자동 |

## 포커스 (상시 가시)
- 모든 인터랙티브 요소에 **더블 링**(내부 2px 면 + 외부 4px brand). 제거 금지·`transition:0`(즉시).
- forced-colors(고대비 OS)엔 `outline: 2px solid transparent`로 폴백(box-shadow가 벗겨져도 outline이 뜨도록).
- 잘리는 요소는 inset 링. 상세 CSS → [01 · 포커스 링](./01-foundations.md).

## 키보드 / 포커스 순서
- 완전 키보드 조작. Enter/Space 활성. 논리적 tab 순서. disabled 컨트롤은 키보드 도달 제외.
- **스킵 네비게이션**: 첫 DOM 요소, focus 시 표시(z 10000).

## 색 · 의미
- **색 단독 금지** — 상태/의미는 항상 텍스트(+아이콘) 병기.
- 아이콘은 CSS 마스크 SVG(`background-color`=현재 토큰)로 → 고대비에서 자동 재색.

## 타이포 · 가독성
- 본문 16~17px·줄간격 ≥150%. 텍스트 확대(줌 0.9~1.5) 지원 시 레이아웃 깨지지 않게.
- 한글 `word-break: keep-all`(단어 중간 줄바꿈 방지).

## 폼 · 표 시맨틱
- native `input[type=radio|checkbox]` 유지(시각적 숨김이지 제거 아님) — a11y 트리 정확.
- `label`이 컨트롤을 감싼다. 오류 = `.is-error` + 색 + **2px 보더**(색만으로 표시 금지).
- 표: `<caption>`(헤더 정보 포함) + `<th scope>`. 이미지 alt. 시맨틱 HTML.

## 터치 · 타깃
- **터치 타깃 ≥44×44px**(마우스 ≥17). 최소 체크박스 20px여도 라벨 전체가 클릭영역.

## 스크린리더 전용
- `.sr-only`/`.blind`: `position:absolute; width/height:1px; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0`. (legend·caption에도 적용)

## 검증 체크리스트 (릴리스 게이트)
- [ ] 키보드만으로 전 기능 도달·조작, 포커스 항상 보임.
- [ ] 본문 4.5:1 / UI 3:1 대비 통과(라이트·다크).
- [ ] 상태/의미가 색 없이도 이해됨(텍스트 병기).
- [ ] 폼 오류가 색+텍스트+보더로 표시.
- [ ] 표에 caption/th scope, 이미지 alt.
- [ ] reduced-motion 존중(애니메이션 최소).

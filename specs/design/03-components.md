# 03 · 컴포넌트 규격

> KRDS 컴포넌트의 **수치·변형·상태**. 자체 구현(React 등) 시 이 값을 준수한다. 전부 **px**(1rem=10px 환산). 상태 = default / hover / focus / pressed(active) / disabled. 색은 [02](./02-brand-color-roles.md) 역할 토큰으로 참조(brand/info/success/…).

## 공통
- 반경: 버튼·입력·셀렉트·페이지네이션 **6**, 카드·다이얼로그 **10**, 칩·태그·배지·체크/라디오 **4**, 배너 **12**, pill=full.
- 폰트: label = 400. 제목/탭/아코디언 트리거 = 700.
- **터치 타깃 ≥44×44px**(마우스 ≥17). 포커스 = 더블 링([01](./01-foundations.md)). transition 짧게(0.2~0.4s).
- **색 단독 금지** — 상태는 텍스트/아이콘 병기.

## Button
기본 = primary·large. 계층 `primary/secondary/tertiary/text/link`, 크기 `xsmall~xlarge`.

| 크기 | 높이 | padX | radius | font | gap |
|---|---|---|---|---|---|
| xsmall | 32 | 10 | 4 | 15 | 2 |
| small | 40 | 12 | 6 | 15 | 2 |
| medium | 48 | 16 | 6 | 17 | 4 |
| **large(기본)** | 56 | 20 | 8 | 19 | 4 |
| xlarge | 64 | 24 | 8 | 19 | 4 |

- **primary**: fill `brand` → hover `brand-strong` → pressed +1 step · 텍스트 white · disabled fill gray-20/보더 gray-30/텍스트 gray-50.
- **secondary**: fill `brand-50`(tint) → hover `brand-100` · 보더 `brand` · 텍스트 `brand-strong`.
- **tertiary**: 투명 → hover gray-5 → pressed gray-10 · 보더 gray-60 · 텍스트 basic.
- **text**(높이 있음, fill/보더 없음): 높이 20/24/32/40/48 · padX 2 · 텍스트 basic.
- **link**: 색 link-default→hover→pressed→visited `#5917b8`.
- **icon**(정사각, 텍스트 없음): 16/20/24/32/40 · 투명 · `.border` 변형은 흰 bg+1px 보더+pill.
- 관제 콘솔 밀도: 보조 액션은 small/medium 사용 가능하나 터치 44 확보.

## Text input / Textarea
기본 large · width 100% · padX 16 · 보더 1px `input-border`(gray-60) · 텍스트 subtle.

| 크기 | 높이 | radius | font |
|---|---|---|---|
| small | 40 | 6 | 15 |
| medium | 48 | 6 | 17 |
| **large(기본)** | 56 | 8 | 19 |
| xlarge | 80 | 10 | 24(bold) |

- **focus**: 보더색 `brand`, **보더 2px**(굵기 증가가 포커스 신호) + 전역 더블 링.
- **disabled**: surface gray-20 · 보더 gray-30 · 텍스트 gray-50. **placeholder**: gray-40.
- **error**(`.is-error`): 보더 danger-50, 2px. **success**(`.is-success`): 보더 success.
- 구조: **라벨(필수, placeholder로 대체 금지)** + 필드 + 헬퍼 텍스트. 복붙 차단 금지·autocomplete 지원.
- **Textarea**: 높이 144 · padding 8/16 · resize:none · 글자수 카운터 15px(에러 시 danger).

## Select
input + 우측 chevron(background-image) · appearance:none. small40/medium48/large56 · radius 6~8 · padR = 16+8+아이콘. focus/disabled = input과 동일.

## Checkbox / Radio
native input은 sr-only(제거 아님). 라벨↔박스 gap 8 · 박스 margin-top 3 · 보더 1px gray-dark.

| 크기 | 박스 | 라디오 dot | 체크 | 라디오 radius | 체크 radius | font |
|---|---|---|---|---|---|---|
| medium(기본) | 20 | 10 | 12 | pill | 4 | 17 |
| large | 24 | 12 | 16 | pill | 4 | 19 |

- **checked**: 박스 보더/채움 `brand` + 흰 체크 · 라디오 dot `brand`. **disabled**: 회색. chip 변형(`.form-chip`)은 선택형 pill 버튼.

## Toggle switch
기본 large. 트랙 medium 32×20 / large 40×24 · radius=트랙높이(pill) · knob 원형 2px 보더.
- off 트랙 gray · on(checked) 트랙 `brand`, knob 슬라이드 · disabled 회색. transition `.4s cubic-bezier(.4,0,.23,1)`.

## Badge (상태 표시)
높이 24(large 32 · number 20 · dot 6×6) · padX 8 · **radius 4**(number/dot=pill) · font 15(large 17) · line-height=높이 · inline-flex 중앙.
- 변형: `outline`(보더+텍스트) · `solid`(채움+흰 텍스트) · `light`(tint bg=`<family>-5/10` + 색 텍스트).
- family: brand/info/success/warning/danger/neutral(gray)/point/disabled.
- 용도: **상태**("접수중"/"마감") · 안읽음/new. 한 요소에 배지 1개. **텍스트 병기**(색 단독 금지).

## Tag / Chip
pill(radius=높이). small24 / medium32(기본) / large40 · padX 8/10/12 · font 13/15/17 · line 1.
- 흰 bg + 1px gray-light 보더 · hover/active = tint. 선택형/삭제(×16px)/링크 변형. 래퍼 gap 4~8.
- **Badge=비인터랙티브 상태 / Tag=인터랙티브·선택형**. 혼동 금지.

## Card / Box
- radius **10** · 보더 1px `border` · bg `surface` · 패딩 16~24(xsmall16/small24) · 그림자 sm.
- hover(클릭 가능 시): 그림자 md + `-translate-y-0.5`(모션, reduced-motion 무력화) · 보더 강조.
- selected: 보더 `brand` + 얇은 `brand` 링.

## Tab
버튼 높이 48(min-width 64) · font 17 **bold** · 텍스트 subtle · gap 8 · 콘텐츠 mt 40(관제 축소 가능).
- **`.line`(권장)**: 활성 = 하단 **3~4px** 언더라인(`brand`) + `brand` 텍스트. 컨테이너 하단 보더가 트랙. 애니메이션 width 0→100%.
- `.fill`: padX 8 · radius 6 · 활성 = tint bg + 보더 + inverse 텍스트. `.full`: 동일폭.
- disabled: 텍스트 disabled.

## Table
- **thead th**: padding 8/16 · bg surface(회색 tint) · 하단 보더 1px · font **15 bold** · 텍스트 bolder · 좌측 정렬.
- **tbody th/td**: padding 12/16 · 하단 보더 1px divider · font **15~17 regular** · 텍스트 subtle.
- `table-layout:fixed; border-collapse:collapse`. **숫자 우정렬·텍스트 좌정렬·빈칸 "–"**(공백 아님)·셀 ≤3줄.
- 시맨틱: `<caption>`(헤더 정보 요약)·`<thead>`·`<th scope>`. **열 구분선 지양**(행 간격/zebra). 레이아웃용 표 금지. 모바일: 세로 스택 또는 좌측 헤더 고정 가로 스크롤.

## Breadcrumb
font 15 · item gap 4 · 링크 padX 4·radius 6·밑줄·hover tint · 구분자 = 회전 chevron(::after) · 홈 아이콘. 모바일 중간 생략(홈+마지막). 하단 여백 = breadcrumb→H1 리듬.

## Pagination
아이템 높이 40 · 페이지번호 40×40 정사각 · radius 6 · gap 8 · 중앙. **active = tint bg + bold + inverse 텍스트**. prev/next chevron. disabled = 회색. 모바일 full-width 랩.

## Modal / Dialog
- 크기 sm 400 / md 560 / lg 760(기본) · min-height 264 · 콘텐츠 max-height 80%.
- `.modal-content`: bg surface · **radius 12** · 1px 보더 · 그림자 lg.
- 헤더: padding-top 56·측 40 · 제목 **24 bold** 1행 생략. 바디 padding 16/40/8 스크롤. 푸터 buttons gap 8 우정렬·min-width 78.
- backdrop = dim(`#000000bf`). z: back 1000/modal 1010/dialog 1020. close 우상단 24. `data-type` full/bottom-sheet 변형.

## Tooltip / Popover
- **inline(다크)**: radius 4 · padding 4/12 · font 15 · inverse bg+텍스트 · nowrap · z 100.
- **box**: max-width 360 · 1px 보더 · radius 12 · padding 24 · surface bg. 화살표 8(inline)/12(box) 회전 사각. <420px 전폭·화살표 숨김.

## Accordion
트리거 padding 24(우측 아이콘 예약) · radius 10 · font **17 bold** · 텍스트 basic · chevron 24 회전 0↔180.
- hover/active = tint. **open**: tint bg + brand/secondary 텍스트. 바디 padding 0/24/24. 컨테이너 상/하 1px divider. `.type-line` 변형. 모바일 padding 16·아이콘 20.

## 내비게이션 (LNB/Side)
세로 padding 40 · 제목 24 · 제목 하단 보더 · 항목 버튼 font **17**·padding 16/8·gap 8 · 2~4 depth 중첩(3depth radius 6, 4depth 8). 활성 = `brand` 텍스트 + 좌측 액센트 바.
(헤더/GNB·정부 크롬은 [04](./04-patterns.md) 참조.)

## StatusPill (파생 — KRDS Badge 응용)
상태 = **dot(6~10px) + 라벨**. up→success · down→danger · no-data/unknown→neutral("데이터 없음"/"판정불가"). 색+단어 필수. 여유 등급도 동일 패턴(free/busy/full/unknown → success/warning/danger/neutral + "여유/바쁨/가득/판정불가").

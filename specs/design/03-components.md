# 03 · 컴포넌트 규격

> 상태 = default / hover / focus / pressed / disabled / selected.
> 색은 [01](./01-foundations.md)의 역할 토큰으로만 참조한다(raw hex 금지).
> 모든 컴포넌트에 공통으로 적용되는 것: **그림자 0**(팝오버·드로어·모달 제외) · **`transform` 금지** ·
> **포커스는 전역 더블 링이 담당**(컴포넌트가 개별 링을 만들지 않는다).

---

## 0. 상태 3중 부호화 — 이 시스템의 심장

유채색을 문제에만 쓰기로 한 순간(§00-2), 무채색 상태가 여러 개 생긴다. **색으로 구분 안 되는 것들은
형태로 가른다.** 은유는 하나로 통일한다: **속이 찼다 = 값이 있다 / 속이 비었다 = 값이 없다.**

### 노드 상태 (`StatusIndicator`)
| 상태 | 색 | **형태** | 단어 | dot 클래스 |
|---|---|---|---|---|
| `up` 정상 | `ink-faint` | **● 채운 원** | "정상" | `bg-ink-faint` + 텍스트 `ink-muted` |
| `down` 다운 | `danger` | ● 채운 원 | "다운" | `bg-danger` + 텍스트 `danger-ink` |
| `no-data` 수집 없음 | `ink-faint` | **○ 빈 원 (1.5px 링)** | "수집 없음" | `border-[1.5px] border-ink-faint` + 텍스트 `ink-subtle` |

- dot **10px**(`h-2.5 w-2.5`), 라벨 12px / **compact**(노드 카드 등 고밀도): dot **8px**, 라벨 11px.
- dot–라벨 간격 8px / compact 6px. dot에는 `aria-hidden`(정보는 단어가 이미 전달).
- **라벨 생략 금지.** 자리가 없으면 compact를 쓰지, 단어를 지우지 않는다.

### 여유 등급 (`CapacityBadge`)
| 등급 | 색 | **형태** | 단어 |
|---|---|---|---|
| `free` 여유 | `ink-muted` | **채운 면** `surface-2`, 보더 없음 | "여유" |
| `busy` 바쁨 | `warn-ink` | 채운 면 `warn-bg` + 1px `warn-border` | "바쁨" |
| `full` 가득 | `danger-ink` | 채운 면 `danger-bg` + 1px `danger-border` | "가득" |
| `unknown` 판정불가 | `ink-subtle` | **점선 보더 `border-dashed border-border-strong` + 투명 배경** | "판정불가" |

- 구성: `axis`(예 "GPU"/"일반") + 등급 단어 + 선택 `detail`(예 "36/48 GiB", `.tnum`).
- `detail`에 실수치가 있으면 등급 단어를 생략할 수 있다(`hideVerdictLabel`) — **수치 자체가 텍스트**라
  색 단독이 아니기 때문이다. 수치가 없으면 단어는 필수다.
- 11px(`text-2xs`) 하한: 10px에서 "판정불가"의 자소가 뭉갠다.

**왜 이게 기능 요건인가.** `unknown`이 `free`로 보이면 "여유 있다"는 **거짓 안심**을 주고, 사용자는 이미
가득 찬 GPU에 작업을 올린다. `no-data`가 `down`으로 보이면 **거짓 경보**로 야간 호출이 나간다.
정직성(모르면 모른다고 한다)이 시각 층에서 깨지는 것이라 접근성 이전에 제품 결함이다.

**새 상태를 추가할 때의 규칙**: 색을 먼저 고르지 말고 **"찼나 비었나"를 먼저 정하라.**

---

## 1. Badge (비인터랙티브 상태 표시)

| 속성 | 값 |
|---|---|
| 반경 | **4px** (`rounded-sm`) |
| 패딩 | `px-1.5 py-px` (좌우 6px) |
| 폰트 | 11px(`text-2xs`) · 500 |
| 높이 | 내용 기반(≈18px). 고정 높이 금지 |
| 배치 | `inline-flex items-center gap-1` |

- 변형은 **3가지뿐**: `무채색`(surface-2 + ink-muted) · `주의`(warn-bg/border/ink) · `문제`(danger-bg/border/ink).
  **브랜드 배지는 없다**(§02 금지 목록 — tint 배경은 예산을 즉시 초과).
- 한 요소에 배지 여럿 허용(축별: GPU/일반), 단 같은 축에 둘은 금지.
- 배지 안에 아이콘 넣지 않는다. 형태 신호는 배지의 **테두리/채움**이 담당한다.

## 2. Chip (인터랙티브 · 필터)

| 속성 | 값 |
|---|---|
| 반경 | **6px** (`rounded-md`) — pill 아님 |
| 높이 | 24~28px · 패딩 `px-2 py-1` |
| 폰트 | 12~13px · 400(선택 시 500) |
| 기본 | `border border-border bg-surface text-ink-muted` |
| hover | `border-border-strong bg-surface-2 text-ink` — **색만 변함** |
| 선택 | `border-border-strong bg-surface-3 text-ink font-medium` (초록 아님) |
| 삭제 × | 12px, `ink-subtle` → hover `ink` |

> **Badge(4px) vs Chip(6px)**: 반경이 역할을 말한다. 4px = 읽는 것, 6px = 누르는 것.
> v2의 "배지 4px vs 칩 pill" 상충은 v3에서 pill을 폐기하며 소멸했다(반경 상한 8px).

## 3. Button

| 크기 | 높이 | padX | 폰트 | 용도 |
|---|---|---|---|---|
| xs | 24 | 8 | 11 | 표 행 내 인라인 액션 |
| sm | 32 | 10 | 13 | 툴바·밀집부 **(관제 기본)** |
| md | **40** | 12 | 13~14 | 폼·모달 |
| lg | 48 | 16 | 14 | 랜딩·빈 상태 CTA |

반경 6px(`rounded-md`) · `font-medium` · `transition-colors` ≤150ms.

| 계층 | default | hover | pressed | disabled |
|---|---|---|---|---|
| **primary** (화면당 1개) | `bg-accent-ink text-accent-contrast` | 명도 −4% | `bg-surface-3` 눌림 대신 명도 −8% | `bg-surface-3 text-ink-faint cursor-not-allowed` |
| **secondary** | `border border-border-control bg-surface text-ink` | `bg-surface-2 border-border-strong` | `bg-surface-3` | 동 |
| **tertiary** (기본 선택) | 투명 · `text-ink-muted` | `bg-surface-2 text-ink` | `bg-surface-3` | `text-ink-faint` |
| **danger** | `bg-danger-bg border border-danger-border text-danger-ink` | `border-danger` | — | 동 |
| **icon** | 정사각(24/32/40) · 투명 · `text-ink-muted` | `bg-surface-2 text-ink` | — | — |

- **primary는 화면당 하나.** 두 번째 주 액션이 필요하면 설계가 틀린 것이다.
- 파괴적 액션은 빨간 채움 버튼이 아니라 **danger 계층(연한 배경 + 보더 + 붉은 글자)** + 확인 모달로.
  채움 빨강은 화면에서 가장 강한 신호라 실제 장애 표시와 경쟁한다.
- hover에 `transform`·그림자 금지.

## 4. Text input / Select / Textarea

| 속성 | 값 |
|---|---|
| 높이 | **40px**(`h-10`) 기본 · 32px(밀집 툴바) |
| 반경 | 6px |
| 보더 | 1px **`border-control`** (흰 배경 3.20:1 — 1.4.11 충족) |
| 배경 | `surface` (툴바 인셋 자리는 `surface-2`) |
| 폰트 | 13px · 텍스트 `ink` · placeholder `ink-subtle` |
| 패딩 | `px-3` (아이콘 있으면 `pl-8`) |

- **focus**: 전역 더블 링이 담당. 컴포넌트가 보더를 2px로 키우거나 자체 링을 만들지 않는다
  (링과 보더가 겹쳐 두께가 흔들린다).
- **error**: `border-danger` 1px + 하단 헬퍼 텍스트 `danger-ink` 12px. **색만으로 표시 금지.**
- **disabled**: `bg-surface-2 border-border text-ink-subtle cursor-not-allowed` + `aria-disabled`.
- **라벨은 필수**(시각적 라벨이 없으면 `aria-label`). placeholder로 라벨을 대체하지 않는다.
- Select는 우측 chevron 16px `ink-subtle`, `appearance:none`.

## 5. Card / Panel

| 속성 | 값 |
|---|---|
| 반경 | **8px** (`rounded-lg`) |
| 보더 | 1px `border` |
| 배경 | `surface` |
| 그림자 | **0** |
| 패딩 | 표준 12~16px · **관제 밀집 10px**(`px-2.5 py-1.5`) |
| 헤더 | `px-3 py-2` + `border-b border-border` · 제목 13px semibold `ink` |

| 상태 | 표현 |
|---|---|
| hover(클릭 가능) | `border-border-strong bg-surface-2` — **색만.** `translate`·그림자 금지 |
| selected | `border-accent-line` (+필요 시 1px `ring-accent-line`). 배경 워시 금지 |
| 상태 액센트 바 | 좌측 4px 세로 바. `up`→`ink-faint` · `down`→`danger` · `no-data`→`border-strong` |
| disabled/정적 | 보더 `border`, hover 반응 없음 |

- 카드 내부 구분선은 `border-subtle`(카드 외곽 `border`보다 연하게 — 안이 밖보다 강하면 안 된다).
- **노드 카드 규격**(초콤팩트, 약 56px): 1행 = 제목 13px semibold + `StatusIndicator compact` /
  2행 = `CapacityBadge` 1~2개. ip·os는 행을 늘리지 말고 `title` 툴팁으로.

## 6. Tab

| 속성 | 값 |
|---|---|
| 트랙 | 컨테이너 `border-b border-border`. 탭바 자체 배경·그림자 없음 |
| 버튼 | `px-3.5 py-2` · 13px |
| 비활성 | `text-ink-muted` 500 → hover `text-ink` |
| **활성** | `text-ink` **600** + 하단 **2~3px `accent-line`** 언더라인 (`-mb-px`로 트랙 위에 얹음) |

- **활성 탭 텍스트를 초록으로 칠하지 않는다.** 언더라인 하나로 충분하고, 텍스트까지 초록이면 예산 초과다.
- 접근성: `role="tablist"` + `role="tab"` + `aria-selected`. 링크(예 "새 탭에서 열기")는 tablist **밖**에 둔다.
- 탭 개수가 1개면 탭바를 렌더하지 않는다(빈 크롬 금지).

## 7. Table / List

| 자리 | 값 |
|---|---|
| thead th | `px-3 py-2` · 12~13px **500** · `text-ink-subtle` · `bg-surface-2` · 하단 1px `border` |
| tbody td | `px-3 py-2` · 13px 400 · `text-ink` (보조 열은 `ink-muted`) |
| 행 구분 | `divide-y divide-border`. **열 구분선 금지**(세로선은 소음) |
| hover 행 | `bg-surface-2` |
| 선택 행 | `bg-surface-3` (또는 화면당 1개소에 한해 `accent-bg`) |

- **숫자는 우정렬 + `.tnum`**, 텍스트는 좌정렬. 빈 칸은 공백이 아니라 **"—"**(값 없음을 명시).
- zebra 스트라이프는 쓰지 않는다 — 행 높이가 낮아 이미 판독되고, 면이 하나 더 생기면 침묵 원칙이 깨진다.
- 시맨틱: `<caption>`(sr-only 가능) · `<thead>` · `<th scope>`. 레이아웃용 표 금지.
- 셀 안 카운트/보조 수치는 `rounded-sm bg-surface-2 px-1 text-2xs text-ink-subtle`.

## 8. Nav (사이드바)

| 속성 | 값 |
|---|---|
| 폭 | 224px(`w-56`) · `border-r border-border` · `bg-surface` · **그림자 0** |
| 섹션 캡션 | 11px 600 `uppercase tracking-wide text-ink-subtle` |
| 항목 | `rounded-md py-2 pl-3 pr-2` · 13px · 항목 간 2px |
| 비활성 | `text-ink-muted` → hover `bg-surface-2 text-ink` |
| **활성** | `bg-surface-2 font-semibold text-ink` + **좌측 2px 세로 룰 `accent-line`**(`inset-y-1.5 left-0 rounded-full`) |
| 준비중 배지 | `rounded-sm border border-border px-1 text-2xs text-ink-subtle` |

- 활성 표시는 **룰 + 굵기 + 면** 3중. 텍스트는 `ink`(초록 아님).
- `aria-current="page"` 필수. 준비 중 항목은 `aria-label`로 상태를 문장으로 알린다.
- 사이드바는 자체 스크롤(`overflow-y-auto`)로 본문 높이에 영향을 주지 않는다.

## 9. Drawer / Popover / Modal — **그림자를 쓰는 유일한 자리**

| 속성 | 값 |
|---|---|
| 반경 | 8px |
| 배경 | `surface` · 보더 1px `border` |
| **그림자** | **`shadow-pop`** (라이트: 4px/12px 이중 · 다크: 24px + 1px 링) |
| 헤더 | `px-3 py-2` + `border-b border-border` · 제목 13px semibold |
| 닫기 | icon 버튼 24px `ink-muted` → hover `ink` |
| 백드롭(모달만) | `rgb(12 13 16 / .5)` — canvas 색 기반. 순흑 금지 |
| 모션 | 등장/퇴장만 허용(슬라이드·페이드 ≤200ms). `prefers-reduced-motion`에서 무력화 |

- **드로어는 뜬 것이므로 움직여도 되고 그림자를 가져도 된다**(§00-4·5의 명시적 예외).
  "어디서 왔는지"를 설명하는 움직임이기 때문이다.
- 포커스 트랩 + `Esc` 닫기 + 열기 전 포커스 복귀는 필수.
- 인라인 툴팁: `rounded-sm px-2 py-1 text-xs`, 배경 `ink` / 글자 `surface`(반전), `shadow-pop`, z 100.

## 10. Link

```
text-ink-muted underline underline-offset-2   →  hover: text-ink
```
**색으로 링크를 표시하지 않는다.** 밑줄이 어포던스를 전담한다(§02 금지 목록 1번).
외부 링크는 뒤에 `↗`를 붙이고 `target="_blank" rel="noopener noreferrer"`.

## 11. Empty state / Placeholder

- 컨테이너: `rounded-lg border border-border bg-surface` (준비중·미연결은 **`border-dashed border-border-strong` + `bg-surface-2`** — 점선 = "아직 비었다"는 형태 은유, §0과 일관).
- 구성: (선택) 마일스톤 배지 → 제목 **`text-lg`~`text-xl` semibold `ink`** → 설명 13~14px `ink-muted` → (선택) 액션 1개.
- 중앙 정렬, `max-w-xl`. 일러스트·아이콘 장식 금지.
- 외부 임베드가 인증/네트워크로 빌 수 있으면 **"새 탭에서 열기 ↗" + 인증 힌트**를 제공한다.

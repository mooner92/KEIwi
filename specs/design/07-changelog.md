# 07 · 변경 이력 (Changelog)

> 이 스펙을 기준으로 코드에 가한 변경 기록. 프로젝트별로 새로 쓴다. KEIwi 콘솔 = 첫 적용 사례.

---

## v2 크래프트 패스 — 2026-07-01 (진행 중)

**트리거**: 사용자 "KRDS로 전면 수정 요청했는데 반영 안 된 느낌, 디자인 너무 별로라 들어가기 싫다." → KRDS 레포/웹 재조사 후 전면 폴리시.
**진단**: 토큰 기반(Pretendard GOV·17px·시맨틱 색)은 이미 배선됐으나 ① 브랜드색이 정부 블루로 바뀜 ② 컴포넌트 완성도 부족(애드혹) ③ 다크 대비 탁함 ④ 여백/위계 약함.
**성격**: 재구축 아님 — **브랜드색 정합 + 컴포넌트 규격화 + 폴리시**.
**제약(사용자)**: 로고 변경 금지 · **메인 색상=우리 초록 유지** · 마스트헤드 미적용(내부 콘솔). §12 라이브 직접수정 금지(격리 빌드 검증).

### 배치 계획 (각 배치 Playwright 게이트)
| 배치 | 내용 | 상태 |
|---|---|---|
| **B0** | 토큰 정합(브랜드 초록·포커스 더블링·다크 대비) | ✅ 완료·검증 |
| B0.5 | Overview 크래프트(탭 라인형·카드/헤더 리듬) | ✅ 완료·검증 |
| B1 | Shell(헤더 식별 스트립·사이드냅 규격) | ⬜ 대기 |
| B2 | 공통 `components/krds/*`(Button·Badge·Card·Input·Tabs·StatusPill) 추출 | ⬜ 대기 |
| B3 | 화면 적용(assistant·현재신호·logs·resources 빈상태) | ⬜ 대기 |
| B4 | 전 화면 라이트/다크 + typecheck·lint·test·no-raw-hex 게이트 | ⬜ 대기 |

### B0 — 토큰 정합 (완료)
`apps/console/src/app/globals.css`
- **브랜드색**: `--color-brand` 정부블루(`--krds-...primary-50`, #256ef4) → **`--color-green-500`(#38B38D)**, `--color-brand-strong` → `green-600`. 다크: `primary-30` → **`green-300`**, strong `green-200`. → [02](./02-brand-color-roles.md).
  - *근거*: 사용자 "메인색=우리 것". KRDS 조사도 "primary는 자체 브랜드로 교체" 명시.
- **포커스 링**: 단일 `outline: 2px solid brand` → **KRDS 더블 링** `outline:2px transparent(forced-colors 폴백) + box-shadow: 0 0 0 2px surface, 0 0 0 4px brand`. → [01 포커스](./01-foundations.md).

`apps/console/src/components/fleet/node-card.tsx`
- 선택/포커스색 `info-700`(블루) → **`brand`**(초록). 컴포넌트 개별 focus-ring 제거(전역 더블 링이 담당). → 색 역할 일관성([02]).

### B0.5 — Overview 크래프트 (완료)
- `grafana-tabs.tsx` **탭**: 회색 알약 박스 → **KRDS `.line`**(하단 3px `brand` 언더라인 + `brand` 텍스트, 컨테이너 `border-b`가 트랙). → [03 Tab](./03-components.md).
- `node-card.tsx` **카드**: 패딩 `p-2.5`→`p-3.5`, 노드 id 15px→**17px bold**, 상태/여유 행 간격 `mt-1.5`→`mt-2/2.5`. → [03 Card].
- `fleet-strip.tsx` · `overview/page.tsx` **섹션 헤더**: 17px→**19px**(heading-small), 헤더 여백 `mb-2`→`mb-3`, 페이지 세로 리듬 `gap-2`→`gap-4`. → [01 리듬]·[04 골격].
- `page-header.tsx` **H1**: 24px→**32px**(heading-large).

### 검증 (완료분)
- 격리 빌드(worktree `next build`, exit 0, TS·lint 통과) + Playwright `/overview`·`/incidents` 라이트/다크 스크린샷. 세로 스크롤 없음.
- 확인: 활성 내비·탭 언더라인·"분석" 버튼·선택 카드·포커스가 **브랜드 초록**(라이트/다크). 제목/헤더 위계·카드 여백 개선.

### 채택하지 않음
- **정부 마스트헤드/식별자**(공식 전자정부 전용, 내부 콘솔엔 허위) — [04](./04-patterns.md).
- **krds-uiux JS·React 패키지·CDN CSS**(SSR/번들 리스크) — 토큰+폰트만.
- **네이티브 시계열 차트**(Grafana 임베드 유지, 헌장 §I-2).

### 배포 상태
- ⚠️ 변경은 **격리 빌드에만** 존재. 라이브 `:3105`(systemd `keiwi-console`) 미반영. 마무리 후 사람이 `npm run build && sudo systemctl restart keiwi-console`(§12).

### 남은 폴리시 후보(관찰됨)
- 다크: 정상 노드 카드의 미세 초록 워시(success tint 배지) — 상태 배지 outline/contained화 검토(B3).
- 현재신호(assistant): WARN/ERROR 컬러 텍스트 → KRDS 배지. 입력창 → KRDS input(보더+brand 포커스, `info-700` 링 제거).
- 서비스맵 패널 헤더·행 간격 KRDS Table 규격 정렬(B3).

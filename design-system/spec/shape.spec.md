# KEIwi 형태 스펙 (Radius · Border)

> **Phase 1.** 둥글기(radius)·보더 두께를 고정. 값 출처: [[tokens.spec]] §8 (krds-uiux `semantic.radius`·`border-width` 실측). radius는 **px 재선언**(root 무관).

## 0. 권위·출처
- KRDS 형태(krds.go.kr/style_04) + krds-uiux `--krds-radius-*`(= number 스텝)·`--krds-*-border-width-*`. [[principles]] AC6.1(라이트/다크) 인용.

## 1. Radius 스케일 (5단계, 최대 12px)
KRDS 표준형 5단계 + 원형. `@theme` `--radius-*`를 **px**로 선언(KRDS rem@10px 직접참조 금지).

| `--radius-*` | KRDS | px | 용도 |
|---|---|---|---|
| `xsmall` | xsmall | 2 | 미세 요소·태그 모서리 |
| `small` | small | 4 | 배지·칩·인풋 일부 |
| `medium` | medium | 6 | 버튼·인풋·작은 카드 |
| `large` | large | 10 | **카드·패널 기본** |
| `xlarge` | xlarge | 12 | 모달·대형 컨테이너 |
| `full` | max | 9999 | 점·아바타·pill(완전 원형만) |

- Tailwind 유틸 override: `rounded-sm`→4, `rounded-md`→6, `rounded-lg`→**10**, `rounded-xl`→12, `rounded-full`→9999.
- **KRDS 산정 규칙(신규 컴포넌트):** radius ≈ 컨테이너 높이 × 0.125, 반올림(홀수→상위 짝수), 최대 12px. 완전 원형만 `%`/full.

## 2. 컴포넌트별 radius 가이드
| 컴포넌트 | radius |
|---|---|
| 노드 카드·패널·Stat 카드 | `large`(10) |
| 버튼·텍스트 인풋·셀렉트 | `medium`(6) |
| 배지·태그·로그레벨 배지·탭 | `small`(4)~`medium`(6) |
| 모달·대형 시트 | `xlarge`(12) |
| 상태 점·아바타·pill | `full` |

- 현행 카드 `rounded-lg`(8) → **10px**로 정렬(KRDS large). 탭 `rounded-md`(6) 유지.

## 3. 포커스 링
- `:focus-visible` 2px 실선 + 2px offset(현행 유지) + radius `small`(4)(현행 3 → 4로 정렬). 색은 `--color-brand`(대비 ≥3:1 단계, color.spec §2).

## 4. Border 두께 (라이트/다크 차등 — KRDS 실측)
KRDS는 고대비(다크)에서 **가변(variable) 보더를 더 두껍게** 한다(가시성). `@theme` 또는 L1 별칭으로:

| 토큰 | 라이트 | 다크(고대비) |
|---|---|---|
| `border-width-regular`(가변) | 1px | **2px** |
| `border-width-medium`(가변) | 2px | **3px** |
| `border-width-static-regular` | 1px | 1px |
| `border-width-static-medium` | 2px | 2px |

- 기본 헤어라인(카드/디바이더)은 **가변 regular** → 라이트 1px, 다크 2px로 자동 굵어짐(AC6.1 가시성). 정적 보더(레이아웃 고정선)는 모드 무관 1px.
- 구현: L1 별칭 `--k-border-width-regular`를 모드별로 1px/2px 전환(다크 토글과 동일 메커니즘, tokens.spec §11).

## 5. 검증
- radius/보더는 토큰 경유(raw px 인라인 금지는 색만큼 강하진 않으나, `--radius-*` 사용 권장).
- 다크에서 보더 가시성 — 시각 QA(라이트/다크 스크린샷 비교).

## 6. 다음
`layout.spec.md`(8pt 그리드·풀폭·다크 FOUC 스니펫).

# 패턴: 서버 상태 (Server Status)

> **Phase 1.** 노드/플릿의 상태(up·down·no-data)를 **색+아이콘+텍스트 3채널**로 표현하는 캐논 패턴. 색 매핑은 [[color.spec]] §4, 토큰은 [[tokens.spec]].

## 목적
플릿 관제의 1차 신호(원칙 1·7). "정상/다운/데이터 없음"을 **3초 내·색각 무관·모호함 없이** 식별. 헌장 US4(**no-data ≠ down**) 시각적 보증.

## Anatomy
```
[상태 점/아이콘]  [라벨 텍스트]      (옵션: 좌측 액센트 바 — 카드)
   ●✓             정상
```
- **인디케이터:** 채운 점(현행) + 상태 아이콘(형태 구분). 점만 ≠ 충분 → 아이콘/텍스트 병행.
- **라벨:** 한국어 상태어(`정상`/`다운`/`데이터 없음`).
- **액센트 바(카드 한정):** 좌측 세로 바 — 보조 채널(색).

## Variants
| variant | 구성 | 사용처 |
|---|---|---|
| `dot-label`(기본) | 점+아이콘+라벨 | strip 카드, 리스트 |
| `bar`(액센트) | 좌측 세로 바 | NodeCard 좌측 |
| `count`(집계) | "N 정상 · M 다운 · K 데이터 없음" | strip 헤더 |

## States (3 — 닫힌 집합)
| 상태 | 점/면 토큰 | 텍스트 토큰 | 아이콘 | 라벨 |
|---|---|---|---|---|
| **up** | `success-500` | `success-700` | circle-check | `정상` |
| **down** | `danger-500` | `danger-700` | triangle-alert | `다운` |
| **no-data** | `neutral-400` | `ink-muted` | circle-dashed | `데이터 없음` |

- 액센트 바: up=`success-500`, down=`danger-500`, no-data=`neutral-300`.
- **불변식:** no-data는 색(회색)·아이콘(점선)·텍스트("데이터 없음") **세 채널 모두** down과 구분.

## 사용 토큰
`--color-success-*`/`--color-danger-*`/`--color-neutral-*`, `--color-ink-muted`, radius `full`(점), `--text-body-xsmall`(라벨). raw hex 금지.

## 접근성 (KWCAG 2.2 / WCAG 2.1)
- **색 단독 금지**(2.2/SC1.4.1) — 아이콘 형태 + 텍스트 병행. 그레이스케일에서 구분 가능.
- 점은 `aria-hidden`, 상태 의미는 **텍스트로 노출**(또는 `aria-label`="data04 정상").
- 대비: 텍스트 ≥4.5:1(-700), 점/바 ≥3:1(-500).
- 상태 변화는 [[realtime-update]]의 `aria-live` 정책 적용.

## Do / Don't
- **Do:** 점+아이콘+텍스트. no-data를 명확히 회색+점선. **Don't:** 빨강/초록 점만으로 구분, no-data를 down처럼(빨강) 표시.

## 반응형
- 좁은 폭: 라벨 유지(아이콘만으로 축약 금지 — a11y). strip은 그리드 컬럼 축소(2→3→5).

## 실시간 데이터 규칙
- 상태는 서버(force-dynamic)에서 Prometheus `up` 기반 산정([[principles]] AC7.1). 갱신/신선도는 [[realtime-update]].
- 수집 실패 → 전부 no-data로 안전 귀결(절대 down 아님).

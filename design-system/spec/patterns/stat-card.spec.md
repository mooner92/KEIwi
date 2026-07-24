# 패턴: Stat / KPI 카드

> **Phase 1.** 단일 수치 요약(한눈 glance) 카드. **차트가 아니다** — 시계열은 Grafana 임베드(헌장 §I-2). 토큰은 [[tokens.spec]], 형태 [[shape.spec]].

## 목적
"지금 값 하나"를 빠르게(원칙 4). 노드 카드, 향후 리소스/인시던트 요약. Grafana가 약한 **단일 시점 요약**만 담당(시계열 재현 금지 — defer-to-grafana).

## Anatomy
```
┌────────────────────────┐
│ 라벨            [상태]   │   ← 라벨(작게) + 옵션 상태 배지/액센트
│ 1,234 GB                │   ← 값(크게, tnum)
│ ▲ 12% · 보조 설명        │   ← 옵션 델타/추세 + 보조 텍스트
└────────────────────────┘
```
- **라벨**(body-xsmall, ink-muted) · **값**(heading-small~medium, tnum) · 옵션 **델타**(증감, 색+화살표+텍스트) · 옵션 **상태 액센트**([[server-status]]).

## Variants
| variant | 설명 |
|---|---|
| `plain` | 라벨 + 값 |
| `status` | + 상태 액센트(좌측 바/배지) — 노드 카드형 |
| `delta` | + 증감 지표(▲/▼ + %) |
| `unit` | 값 + 단위(IP/GB/%/req) |

## States
- `default` / `loading`(스켈레톤) / `empty`(값 없음 → "—"/안내) / `error`(수집 실패 → 안내, 0으로 위장 금지).
- 델타 색: 증가=문맥 의존(좋음=success / 나쁨=danger) — **의미 기반**, 단순 ▲=초록 금지(맥락 명시).

## Sizes
| size | 값 타이포 | 패딩 |
|---|---|---|
| `small` | heading-small(19) | card-small(24) |
| `medium`(기본) | heading-medium(24) | card-medium(32) |
| `large` | heading-large(32) | card-large(40) |

## 사용 토큰
`--color-surface`/`--color-border`(가변 보더 — 다크 굵어짐), radius `large`(10), `--text-heading-*`/`--text-body-xsmall`, `.tnum`(값), 상태색(액센트). raw hex 금지.

## 접근성
- 값-라벨 **프로그램적 연결**(`aria-labelledby` 또는 `<dt>/<dd>`). 값은 텍스트(이미지 금지).
- 델타는 색+기호(▲/▼)+텍스트("12% 증가") 3채널.
- 값 대비 ≥4.5:1(ink), 라벨 ≥4.5:1(ink-muted on surface).
- 변하는 값은 [[realtime-update]] `aria-live="polite"`.

## Do / Don't
- **Do:** 단일 수치·tnum 정렬·단위 명시·신선도 표기. **Don't:** stat 카드를 미니 시계열 차트로 비대화(§I-2 위배), 델타 색을 의미 없이.

## 반응형
- 그리드 카드(현행 `grid-cols-2 sm:3 lg:5`). 좁으면 값 우선, 보조 텍스트 생략 가능(값·라벨은 유지).

## 실시간·데이터 규칙
- 값 출처/단위/신선도 노출([[principles]] AC7.3). 수집 실패는 `error`/`empty`로(0 위장 금지). 시계열 심층은 Grafana 딥링크.

# KEIwi 색상 스펙 (브랜드 정책 + 상태/로그 System 매핑)

> **Phase 1.** 브랜드(green/blue) ↔ KRDS Primary/Secondary 정책과, **서버 상태·로그레벨 → System 색** 시맨틱 매핑을 고정한다.
> 토큰 메커니즘·값은 [[tokens.spec]]/`tokens.json`. 브랜드 흡수 vs 확장 **결정 근거는 ADR-0007**.

## 0. 권위·출처

- 권위: `Constitution.md` **§17(브랜드/시맨틱 토큰 분리)** > Phase 0 결정 > 이 스펙. [[principles]] AC2.1(대비)·AC2.2(색 단독 금지)·AC7.2(상태 3분류)를 충족 근거로 인용.
- KRDS System 색·매직넘버 출처: tokens.spec §3·§9 (krds_tokens.css 실측).

## 1. 색 사용 원칙

1. **토큰만** — 모든 색은 L2 유틸(`bg-success-500` 등) 경유. raw hex·`--krds-*` 직접 사용 금지(tokens.spec §10 lint).
2. **색 단독 금지** — 상태/레벨은 **색 + 아이콘(형태) + 텍스트** 3채널 병행. 색각이상(적·녹 단독)에서도 식별 가능해야 한다.
3. **매직넘버 대비** — 텍스트 ≥4.5:1(권장 -70), 비텍스트/아이콘/보더 ≥3:1(-50↑). 라이트/다크 양쪽.
4. **브랜드 ≠ 상태**(§17) — 브랜드 색을 success/danger 등 상태 의미로 쓰지 않는다(§2 정책).

## 2. 브랜드 정책 — **확장형 유지** (결정: ADR-0007, (B))

KEIwi 브랜드 **green(primary, base `#38B38D`)·blue(secondary, `#3CA2DF`)** 를 KRDS **확장형(extended)** primitive로 유지한다. KRDS Primary(`#256ef4`)로 흡수하지 않는다.

- **위치:** 브랜드는 L0 확장 primitive `--krds-ext-brand-*`(green)·`--krds-ext-brand2-*`(blue)로 둔다. KRDS와 동일하게 **11단계(5·10·20·30·40·50·60·70·80·90·95)** + **매직넘버 대비**를 만족하도록 재정렬(Phase 2 구현 시 대비 검증).
- **사용 범위(브랜드 역할 한정):** 로고/브랜드마크, 포커스 링(`--color-brand`), Primary 액션·링크·선택 강조 등 **식별·주조색**에만. **상태색으로 금지.**
- **⚠️ 대비 주의(중대):** 현행 `#38B38D`는 흰 배경 대비 ≈2.3:1 → **KRDS -50(4.5:1) 미달**. 즉 `#38B38D`는 **-40 등급(비텍스트·라지)** 으로 재배치하고, **텍스트/링크용 primary는 더 어두운 단계**(green-70급 `#25765f` 등 ≥4.5:1)를 쓴다. 포커스 링은 인접 대비 ≥3:1 단계 사용.
- **blue 혼동 방지:** 브랜드 blue(`#3CA2DF`)와 KRDS **information**(파랑, `#0b78cb`)은 의미가 다르다 — 브랜드 blue는 **secondary 식별**에만, **"정보(info)" 상태에는 KRDS information**만 사용. 둘을 같은 화면에서 정보 의미로 혼용 금지.
- **상태·크롬은 KRDS** — success/danger/warning/information + gray 크롬은 전부 KRDS(tokens.spec §4·§5). 브랜드와 독립.

## 3. KRDS System 색 (상태 도메인)

| System | KRDS family | 의미(본 제품) |
|---|---|---|
| Success | success(green) | 정상·up·완료 |
| Danger | danger(red) | 다운·error·실패 |
| Warning | warning(amber) | 경고·임계 근접 |
| Information | information(blue) | 정보·info·진행 |
| (Neutral) | gray | 데이터 없음·debug·비활성 |

> 도메인 매핑(프롬프트): **error→danger, warning→warning, healthy/up→success, info→information, no-data/debug→neutral/gray**.

## 4. ★ 서버 상태 매핑 (up / down / no-data)

3채널(색+아이콘+텍스트) 고정. 현행 `StatusIndicator`/`NodeCard`와 정합.

| 상태 | 시맨틱 토큰(점/면) | 텍스트 토큰 | 아이콘(형태) | 라벨 | 비고 |
|---|---|---|---|---|---|
| **up** | `success-500` | `success-700` | **채운 원 + 체크**(circle-check) | `정상` | 헌장 US4 |
| **down** | `danger-500` | `danger-700` | **삼각 경고 + !**(triangle-alert) | `다운` | |
| **no-data** | `neutral-400` | `ink-muted` | **점선/대시 원**(circle-dashed) | `데이터 없음` | **≠ down**(AC7.1) |

- **핵심 불변식:** no-data는 down과 **색·아이콘·텍스트 모두 구분**되어야 한다(회색+대시+"데이터 없음"). 색만 보고 down으로 오인 불가.
- 좌측 액센트 바(NodeCard)도 동일 토큰(up=success-500, down=danger-500, no-data=neutral-300).

## 5. ★ 로그레벨 매핑 (M2 — 지금 고정)

대용량 로그 테이블/배지용. 레벨은 **색 + 아이콘 + 텍스트(레벨명)** 병행. 가독 위해 배지는 배경(-50)+텍스트(-700)+보더(-100) 조합.

| 레벨 | 시맨틱 | 배지 배경/텍스트/보더 | 아이콘(형태) | 라벨 |
|---|---|---|---|---|
| **fatal** | danger(강) | `danger-100`/`danger-700`/`danger-400` | **팔각 X**(octagon-x) | `FATAL` |
| **error** | danger | `danger-50`/`danger-700`/`danger-100` | **삼각 !**(triangle-alert) | `ERROR` |
| **warn** | warning | `warning-50`/`warning-700`/`warning-100` | **삼각 경고**(alert) | `WARN` |
| **info** | information | `info-50`/`info-700`/`info-100` | **원 i**(info-circle) | `INFO` |
| **debug** | neutral | `neutral-100`/`neutral-700`/`neutral-300` | **벌레/점선**(bug) | `DEBUG` |
| **trace** | neutral(약) | `neutral-50`/`ink-muted`/`neutral-100` | **점 3개**(dots) | `TRACE` |

- 아이콘 **형태가 레벨마다 달라** 색 없이도 구분(색각이상 대응). fatal/error는 색은 같아도 **아이콘(팔각 vs 삼각)·라벨**로 구분.
- 정렬·밀도: 배지는 body-xsmall(13), 라벨 텍스트는 대비 ≥4.5:1(-700).

## 6. 색각이상(색맹) 대응

- **다중 채널 필수**(원칙 2 / AC2.2): 색 + 아이콘 형태 + 텍스트. 어느 하나만으로 정보 전달 금지.
- **적·녹 단독 구분 금지** — up(녹)/down(적)은 **아이콘 형태(체크 vs 삼각)** 로도 구분된다.
- **명도 차** 확보 — 상태색은 -500↑, 텍스트 -700로 명도 대비 유지.
- 검증: 컴포넌트 spec 체크리스트에 "그레이스케일에서 식별 가능?" 항목, Phase 5에서 시뮬레이션 점검(가능 시).

## 7. 차트·그래프 색

- **시계열은 Grafana 임베드**(헌장 §I-2) — 콘솔이 차트색을 정의하지 않는다.
- 콘솔 네이티브 요약(헬스/stat)은 위 시맨틱 토큰만. KRDS `graphic-*`(blue/red 5단계)는 **현재 미사용**(필요 시 별도 게이트).

## 8. 검증

| 항목 | 수단 |
|---|---|
| 색 단독 금지 | 컴포넌트 spec 체크리스트 + 코드 리뷰(상태=색+아이콘+텍스트) |
| 대비(매직넘버) | Phase 5 자동 대비 검사 |
| 브랜드≠상태 | 리뷰 — 브랜드 토큰이 상태 의미로 안 쓰임 |
| raw hex/primitive 직접사용 | `check:no-raw-hex` + `check:no-krds-primitive` |

## 9. 다음 게이트
`typography.spec.md`(Pretendard GOV 로딩 + KRDS PC 스케일 + tnum/mono 정책) → `shape.spec.md`(radius) → `layout.spec.md`(8pt 그리드·풀폭·다크 FOUC 스니펫). 이후 `patterns/`·`components/`.

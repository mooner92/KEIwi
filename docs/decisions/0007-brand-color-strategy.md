# 0007. 브랜드↔KRDS 색 전략 (확장형 유지)

- 상태: 채택
- 날짜: 2026-06-27

## 맥락

KRDS 디자인 시스템 채택(Phase 0)으로 콘솔의 색 토큰을 KRDS primitive(`--krds-*`) 기반으로 재정렬한다([[tokens.spec]] / `design-system/spec/tokens.json`). 이때 기존 KEIwi 브랜드 색을 어떻게 처리할지 결정해야 한다.

- 현행 브랜드: **green(primary, base `#38B38D`)·blue(secondary, `#3CA2DF`)** — 쿨톤. 제품명 KEIwi(KEI + kiwi)·브랜드마크(green 키위 단면)의 정체성.
- KRDS Primary = **`#256ef4`(정부 블루)**, Secondary = `#346fb2`(light)/`#268097`(고대비 teal).
- 헌장 **§17:** 브랜드 램프와 시맨틱 상태 토큰(success/info/warning/danger/neutral)을 **분리**한다.
- 사용자 지시: "기존 브랜드를 KRDS Primary로 **흡수**할지, **확장형**으로 별도 유지할지 결정 근거를 ADR-0007에 남겨라. 어느 쪽이든 매직넘버 대비는 준수."
- KEI = 한국환경연구원(정부 출연 연구기관). 대상은 **공개 정부 포털이 아니라 내부 연구 플릿 관제 콘솔**.

두 선택지: **(A) 흡수** — 브랜드를 KRDS Primary(블루)로 대체. **(B) 확장형** — 브랜드 green/blue를 KRDS 확장 팔레트로 유지하고 상태·크롬만 KRDS.

## 결정

**(B) 확장형 유지를 채택한다.**

- KEIwi 브랜드 green/blue를 KRDS **확장형(extended)** primitive `--krds-ext-brand-*`(green)·`--krds-ext-brand2-*`(blue)로 둔다. KRDS와 동일하게 **11단계(5~95)** 구조 + **매직넘버 대비**를 만족하도록 재정렬한다(구현·검증은 Phase 2).
- 브랜드 색은 **식별·주조색 역할에만** 쓴다: 브랜드마크, 포커스 링, Primary 액션·링크·선택 강조. **상태색(success/danger/warning/information)으로는 절대 사용하지 않는다**(§17).
- 모든 **상태·크롬 색은 KRDS**(System color + gray)로 간다([[tokens.spec]] §4·§5). 브랜드와 독립.
- 우리 `info` 상태 = KRDS `information`. 브랜드 blue(`#3CA2DF`)는 **secondary 식별 전용** — "정보" 의미에는 KRDS information만 사용(혼동 금지).

## 고려한 대안

- **(A) KRDS Primary로 흡수** — 브랜드를 정부 블루(`#256ef4`)로 통일. 장점: KRDS 충실도·"하나의 정부 서비스" 일관성(KRDS 원칙 3) 최대. 단점: (1) KEIwi/키위·**환경(green)** 정체성 상실 — KEI(환경연구원)에 green은 주제적으로도 적합하다. (2) 대상이 **내부 관제 콘솔**이라 공개 포털 수준의 정부블루 통일이 과하다. (3) 헌장 §17은 브랜드/시맨틱 **분리**를 요구하는데, 흡수는 브랜드를 KRDS Primary(=링크/포커스 등 광범위 역할)에 종속시켜 정체성 레버를 잃는다. → **기각.**
- **(A′) 부분 절충(브랜드는 로고만, 인터랙션 primary는 KRDS 블루)** — 식별성과 일관성 절충안이나, 화면 주조색이 블루가 되어 브랜드 green이 로고에서 고립(이질감). → 기각.
- **(B에서 매직넘버 무시하고 현행 green 그대로 사용)** — `#38B38D`는 흰 배경 대비 ≈2.3:1로 **-50(4.5:1) 미달**. 텍스트/링크 primary로 쓰면 AC2.1 위배. → 기각(그래서 (B)는 단계 재정렬 + 대비 검증을 동반).

## 결과

- **정체성 유지** + **§17(브랜드/시맨틱 분리) 강화**(브랜드는 KRDS System과 물리적으로 분리된 확장 ramp).
- 상태·크롬은 KRDS의 접근성(System 대비·고대비 모드)을 **상속**한다.
- **부채/후속:**
  - 브랜드 green/blue ramp를 KRDS 11단계 + 매직넘버에 맞춰 **재산출·대비 검증**(Phase 2). 현행 `#38B38D`는 **-40 등급**으로 내리고, 텍스트/링크 primary는 더 어두운 green(-70급 `#25765f` 등)을 쓴다. 포커스 링은 인접 대비 ≥3:1.
  - 브랜드 blue vs KRDS information(blue) **의미 분리 규칙**을 color.spec·리뷰로 강제.
- ADR-0001(Tailwind v4 `@theme` 토큰)을 **보완**한다(대체 아님): 브랜드/시맨틱 분리 구조는 유지하되, 시맨틱·크롬의 *값 출처*가 KRDS primitive로 바뀐다.
- 참조: [[tokens.spec]], `design-system/spec/color.spec.md`, [0001](0001-framework-and-styling.md), 헌장 §17, Phase 0 결정(`krds-redesign-decisions`).

# KRDS 리디자인 — Spec (WHAT + WHY)

- 상태: 진행 중 (Phase 0–2 완료, 3–5 잔여 — 진행 상황은 [tasks.md](./tasks.md))
- 날짜: 2026-06-27
- 권위: 이 spec은 [`Constitution.md`](../../Constitution.md)에 종속된다. 충돌 시 헌장이 이긴다.
- 원칙: **Spec이 진실의 원천**(헌장 §7). 행동 변경은 코드가 아니라 이 문서를 먼저 고친다.
- 관련: HOW=[plan.md](./plan.md) · 작업=[tasks.md](./tasks.md) · 근거=[research.md](./research.md) · 설계 상세=[`design-system/spec/`](../../design-system/spec/) · 결정=[ADR-0006](../../docs/decisions/0006-krds-adoption.md)/[0007](../../docs/decisions/0007-brand-color-strategy.md)

> 이 문서는 **무엇을·왜**만 정한다. **어떻게**는 plan.md, **작업 단위**는 tasks.md.

---

## 목적

KEIwi 콘솔의 **디자인 시스템을 대한민국 정부 디자인 시스템 KRDS로 전면 교체**한다. 단, 콘솔 **크롬(네이티브 UI)** 에 한정하고 시계열은 Grafana 임베드를 유지한다.

- **WHY — 일관성·신뢰.** KRDS 토큰/패턴을 단일 기준으로 삼아 화면 간 일관성과 정부 서비스 신뢰감을 확보한다(KRDS 원칙 3·7).
- **WHY — 접근성.** KRDS의 매직넘버 대비·System 색·고대비(다크) 모드를 1급으로 상속해 관제실(NOC) 사용성과 색각이상 대응을 보장한다.
- **WHY — 정체성 유지.** KEI(환경연구원)의 green 브랜드를 KRDS 확장형으로 유지한다([ADR-0007](../../docs/decisions/0007-brand-color-strategy.md)).
- **WHY — 헌장 정합.** 단일 콘솔=Grafana(§I-2)를 깨지 않는다. KRDS는 크롬만, 차트는 Grafana.

성공은 §수용 기준의 기계 검증으로 정의한다(헌장 §9).

---

## 범위 (in / out)

> (기술스택·구현 방식은 여기서 다루지 않는다 — [plan.md](./plan.md). Spec Kit 규칙: spec은 무엇·왜만.)

### In
1. **색·간격·형태 토큰을 KRDS 표준으로 교체** — 라이트/다크 양쪽, 상태·크롬·뉴트럴.
2. **정부 표준 서체 적용** — 한글 가독성 + 수치 정렬(자릿수 흔들림 없음).
3. **둥글기(형태) KRDS 표준화**.
4. **다크(선명한 화면) 모드** — 라이트 기본 + 토글, 새로고침 깜빡임(FOUC) 없음.
5. **크롬 UI 리스킨** — 헤더/네비/플릿카드/탭/배지/상태표시/요약카드(현재 콘솔이 쓰는 것 우선).
6. **상태·패턴 표현** — 서버 상태·요약 카드·실시간 갱신을 색+아이콘+텍스트로.
7. **풀폭 반응형** — 관제/NOC 와이드.

### Out
- **네이티브 차트로 Grafana 대체**(§I-2 — research.md: defer-to-grafana).
- **M2+ 컴포넌트**(table/modal/accordion/pagination/time-range-picker 등) — 해당 마일스톤 시점.
- **krds-react 패키지 채택** — tokens-only + 자체 구현([ADR-0006](../../docs/decisions/0006-krds-adoption.md)).
- **#2 var-instance Grafana 임베드 구조 변경** — 불가침(유지).

---

## 사용자 스토리

운영자(admin) 관점.

- **UD1 — 일관된 KRDS 룩.** 운영자로서 콘솔 전반이 정부 표준(KRDS) 디자인으로 일관돼 신뢰감 있게 보이길 원한다.
- **UD2 — 다크(NOC) 모드.** 운영자로서 관제실 장시간 응시를 위해 다크(선명한 화면) 모드를 1급으로 쓰고 싶다. 새로고침에도 깜빡임(FOUC) 없어야 한다.
- **UD3 — 접근성.** 운영자로서 상태/로그레벨을 색만이 아니라 아이콘+텍스트로 구분(색각이상)하고, 키보드로 조작하며, 본문 대비 ≥4.5:1로 읽고 싶다.
- **UD4 — 정체성 유지.** 운영자로서 KEIwi 브랜드(green) 정체성이 유지되되 상태색과는 분리되길 원한다.
- **UD5 — 기존 기능 불변.** 운영자로서 리디자인이 #2 노드 드릴다운·Grafana 임베드·한 화면 레이아웃을 깨지 않길 원한다.

---

## 수용 기준 (기계 검증 가능)

- [x] `npm run verify` 통과(lint/typecheck/test/build/check:secrets/check:no-raw-hex)
- [x] 컴포넌트에 raw hex 0건(`check:no-raw-hex`) — 색은 토큰 경유
- [ ] 컴포넌트가 `--krds-*` primitive 직접 참조 0건(`check:no-krds-primitive` — 신설 예정)
- [x] 라이트/다크 양쪽 렌더 + desktop/laptop **스크롤 없는 한 화면**(`npm run screenshot`)
- [ ] 본문/상태 텍스트 대비 ≥4.5:1, 비텍스트 ≥3:1 (자동 대비 검사 — Phase 5)
- [x] 다크 토글 동작 + 쿠키/localStorage 기록 + FOUC 방지(inline script)
- [x] 상태/로그레벨이 **색+아이콘+텍스트** 3채널(색각이상)
- [x] #2 var-instance 임베드·한 화면 레이아웃 회귀 0
- [x] 정부 표준 서체 적용, 수치 자릿수 정렬
- [ ] 디자인 토큰 단일 소스 = KRDS 표준 토큰(참조), 매핑이 설계 산출물과 일치

---

## 비범위

- infra 관제 스택 · M2~M5 기능 · Grafana 대시보드/차트 재구현 · 자체 인증(§14 Cloudflare Access).

---

## 의존 결정 (ADR)

| ADR | 결정 |
|---|---|
| [0006](../../docs/decisions/0006-krds-adoption.md) | KRDS 채택(크롬만, tokens-only, Grafana 유지), krds-uiux 의존성 |
| [0007](../../docs/decisions/0007-brand-color-strategy.md) | 브랜드 확장형 유지(green/blue, 상태색은 KRDS) |
| [0001](../../docs/decisions/0001-framework-and-styling.md) | (보완) Tailwind v4 `@theme` — KRDS primitive 주입 |

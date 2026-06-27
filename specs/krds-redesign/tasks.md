# KRDS 리디자인 — Tasks (체크 가능 작업)

- 권위: [spec.md](./spec.md) / [plan.md](./plan.md). `[x]`=완료, `[ ]`=잔여.
- 게이트: 각 Phase 종료 시 보고·승인.

## Phase 0 — 정렬·검증 ✅
- [x] T001 krds-react/krds-uiux 호환성 검증(SSR·번들·하이드레이션) → [research.md](./research.md)
- [x] T002 차트 라이브러리 평가 → defer-to-grafana(§I-2)
- [x] T003 현행 콘솔 감사(유지/교체 경계)
- [x] T004 4대 결정 확정(크롬만 / Tailwind+KRDS토큰 / tokens-only자체구현 / 풀폭+다크)
- [x] T005 IA·디렉터리·ADR 0006/0007 구성 승인

## Phase 1 — 스펙
- [x] T010 principles.md (KRDS 7원칙→수용기준)
- [x] T011 tokens.spec.md + tokens.json (primitive SSOT·매핑·정규식·매직넘버·FOUC)
- [x] T012 color.spec.md + ADR-0007 (브랜드 확장형 + 상태/로그 System 매핑)
- [x] T013 typography.spec.md (Pretendard GOV·KRDS 스케일)
- [x] T014 shape.spec.md (radius·보더)
- [x] T015 layout.spec.md (8pt·풀폭·다크 FOUC)
- [x] T016 patterns: server-status · stat-card · realtime-update
- [x] T017 ADR-0006 (KRDS 채택)
- [ ] T018 components/ spec 묶음 A(button·link·badge·tag/log-level-badge)
- [ ] T019 components/ spec 묶음 B(card·stat-card·tab·server-health-indicator)
- [ ] T020 components/ spec 묶음 C(header·side-menu·breadcrumb)
- [ ] T021 a11y-checklist.md

## Phase 2 — 토큰·파운데이션 ✅
- [x] T030 krds-uiux 설치(ADR-0006)
- [x] T031 Pretendard GOV(fonts.ts + woff2 복사) + tnum
- [x] T032 globals.css @theme → KRDS primitive(라이트) + radius
- [x] T033 다크 오버라이드(:root[data-theme=dark], high-contrast)
- [x] T034 layout.tsx(토큰 CSS import·FOUC inline script·suppressHydrationWarning)
- [x] T035 theme-toggle.tsx(useSyncExternalStore·쿠키) + top-bar 배치
- [x] T036 verify 통과 + Playwright 라이트/다크 한 화면
- [ ] T037 **배포** — `sudo systemctl restart keiwi-console`(사람, §11)

## Phase 3 — 컴포넌트 구현 ⬜
- [ ] T040 묶음 A 구현(+Storybook/스토리, a11y)
- [ ] T041 묶음 B 구현
- [ ] T042 묶음 C 구현
- [ ] T043 `check:no-krds-primitive` lint 신설

## Phase 4 — 화면
- [x] T050 Overview KRDS 조립 검수(브레드크럼·페이지헤더)
- [ ] T051 `/servers/[id]` 노드 상세(#2 드릴다운 발전형)
- [x] T052 풀폭 반응형 적용(max-w 제거)
- [x] T053 KRDS 표준 레이아웃 재설계 — 좌측 사이드메뉴 셸 + 브레드크럼 + 페이지헤더 + 유틸바(통합검색 자리표시). 워크플로 3안 심사로 선정
- [ ] T054 모바일 드로어(현재는 가로 폴백 nav) · 글자크기 토글 연결

## Phase 5 — 검증·문서 ⬜
- [ ] T060 자동 대비 검사(매직넘버) CI
- [ ] T061 a11y 테스트 + 색각 시뮬레이션
- [ ] T062 README(토큰 커스터마이즈·테마·라이선스)

## 백로그 (별도 게이트)
- [x] B01 다크 ↔ Grafana iframe `theme=dark` 동기화(임베드 구조 불변) — buildEmbedSrc theme 파라미터 + useTheme
- [ ] B02 브랜드 green/blue ramp KRDS 11단계 재정렬 + 매직넘버 대비 검증(ADR-0007 후속)
- [ ] B03 KRDS PC 타입 스케일(--text-*) 전면 적용(본문 17px)

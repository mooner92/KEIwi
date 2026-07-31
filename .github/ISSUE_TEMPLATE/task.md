---
name: "작업 티켓"
about: "기능·인프라·문서 작업을 SDD 흐름으로 추적합니다 (KEI 내부 전용)"
title: "<type>: "
labels: ["task"]
assignees: ["mooner92"]
---

<!--
KEIwi 내부 전용. 워크플로: constitution → /specify(WHAT+WHY) → /plan(HOW+ADR) → /tasks → /verify (헌장 §VI).
title 프리픽스는 커밋/브랜치 type 과 맞춘다: feat · fix · chore · docs · refactor · infra.
-->

## 배경 · 왜

<!-- 지금 왜 필요한가. 어떤 문제·요구에서 나왔는가. -->

## 수용 기준 (기계 검증 가능)

> [!IMPORTANT]
> "잘 된다"가 아니라 **"이 명령이 이 출력을 낸다"**로 쓴다(헌장 §9). CI가 강제할 수 있어야 한다.

- [ ] <!-- 예: `curl -s .../api/health` 가 `{"status":"ok"}` 를 반환한다 -->
- [ ] <!-- 예: `cd apps/console && npm run test` 가 신규 케이스 포함 통과한다 -->
- [ ] <!-- 예: Grafana 패널 X 가 노드 data03/data04 DCGM 메트릭을 표시한다 -->

## SDD 스펙 · 근거 링크

<!-- 존재하는 것만 링크. 없으면 이 티켓에서 먼저 spec/ADR을 만든다(헌장 §7·§8). -->

- **spec**: <!-- 예: specs/M2-logs/spec.md · specs/hardware-ops/spec.md · specs/alerting/spec.md -->
- **plan/tasks**: <!-- 예: specs/M3-resources/plan.md · specs/M3-resources/tasks.md -->
- **ADR**: <!-- 예: docs/decisions/0022-error-tracking-glitchtip.md -->
- **런북/문서**: <!-- 예: docs/runbooks/node-onboarding.md · docs/branching.md -->

## 실행 구분 — 에이전트 생성 / 사람 적용

> [!WARNING]
> 헌장 §11: 에이전트는 **레포에 생성**만, 프로덕션 적용·배포는 **사람**이 한다.

- **에이전트가 생성(레포 아티팩트)**:
  - [ ] <!-- compose·config·스크립트·spec·코드 등 -->
- **사람이 적용(되돌리기 어려운 반영)**:
  - [ ] <!-- .105 라이브 스택/타 노드 SSH 배포, main 병합, push, 태그, 알림 규칙 활성화 등 -->

## 비고

<!-- 의존 티켓·제약(시크릿은 레포 밖 §13, 온프레미스 only §I)·후속. -->

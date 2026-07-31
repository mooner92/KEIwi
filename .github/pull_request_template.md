<!--
KEIwi PR 템플릿 — KEI 내부 전용.
브랜치·커밋 규약은 docs/branching.md, 불변 규칙은 Constitution.md 를 따른다.
제목은 커밋 프리픽스 규약: <type>(<scope>): <요약, 한국어>  (예: feat(console): 로그 워크벤치 필터 칩)
-->

## 무엇을 / 왜

<!-- 이 PR이 바꾸는 것(무엇)과 근거(왜)를 2~4줄로. 문제→해결 순. -->

- **무엇**:
- **왜**:
- **근거 spec/ADR**: <!-- 예: specs/M2-logs/spec.md, docs/decisions/0022-error-tracking-glitchtip.md -->

## 변경 범위 — 단일 관심사

> [!IMPORTANT]
> 한 PR = 한 관심사. 디자인·알림·에러트래킹처럼 성격이 다른 변경을 한 브랜치에 섞지 않는다([`docs/branching.md`](../docs/branching.md)).

- [ ] 이 PR은 **하나의 관심사**만 다룬다(섞였으면 브랜치를 분리한다).
- [ ] 브랜치명이 `<type>/<kebab-slug>` 규약을 따른다(`feat · fix · chore · docs · refactor · infra`).
- [ ] `dev`에서 파생했고 **`dev`로** 낸다(`main` 직접 병합은 hotfix 예외만).

**영향 영역(scope)**: <!-- console · infra · logging · monitoring · docs · design-system · ansible ... -->

## 검증

> [!WARNING]
> `npm run verify`는 `build`를 포함하고, 콘솔은 `apps/console/.next`를 **라이브로 서빙**한다(헌장 §12). 라이브와 같은 디렉터리에서 `build`를 돌리지 말 것 — 에이전트 검증은 build 제외로. 자세히는 [`docs/testing.md`](../docs/testing.md).

- [ ] 정적·단위 검증 통과:
  ```bash
  cd apps/console
  npm run typecheck && npm run lint && npm run test && npm run check:no-raw-hex
  ```
- [ ] 시크릿 검사 통과 (`npm run check:secrets`).
- [ ] (풀 빌드가 필요하면) 격리 빌드로 검증 — 라이브 `.next` 미접촉([`docs/testing.md`](../docs/testing.md)).
- [ ] **UI 변경이면** 스크린샷 첨부(라이트/다크, `npm run screenshot`). <!-- 아래에 이미지 --> 
- [ ] **비-UI 변경이면** 경험적 검증(curl·메트릭·로그 출력)을 본문에 붙임.

<!-- 스크린샷 / 검증 출력:
| before | after |
| --- | --- |
| … | … |
-->

## 리뷰 포인트

<!-- 리뷰어가 집중해서 볼 지점. 위험한 변경·트레이드오프·되돌리기 어려운 부분. -->

-

## 머지 후 남는 것

<!-- 후속 작업·미해결·별도 티켓으로 뺀 것. 없으면 "없음". -->

- [ ] 후속 작업/티켓:
- [ ] 문서·ADR·spec 갱신 필요 여부:
- [ ] 작업 브랜치 삭제(머지 후).

## 헌장 준수 체크

> 전체 규칙 [`Constitution.md`](../Constitution.md).

- [ ] **§11 에이전트 생성·사람 적용** — 에이전트는 레포에 아티팩트만 만들었고, `main` 병합·`push`·프로덕션 배포 등 되돌리기 어려운 반영은 **사람 승인** 후 진행한다.
- [ ] **§13 시크릿은 레포 밖** — 키·비번·토큰·자격증명을 커밋하지 않았다(env/시크릿 스토어만 참조).
- [ ] **§7 spec이 진실의 원천** — 행동 변경이면 spec을 먼저 고쳤고 코드가 따라온다(드리프트 없음).
- [ ] **§9 기계 검증 가능** — 수용 기준을 "이 명령이 이 출력을 낸다"로 확인했다.

# 브랜치 전략 · 기여 흐름 (Branching & Contribution)

> KEIwi의 Git 워크플로 표준. **`main`/`dev` 2 상시 브랜치 + `dev` 파생 작업 브랜치** — 흔한 Git Flow 경량판. 2026-07-24 도입.

## 상시 브랜치

| 브랜치 | 의미 | 규칙 |
| --- | --- | --- |
| `main` | **배포/통합 기준선**(production). 항상 검증 통과 상태 유지. | 직접 커밋 금지. `dev` 병합(또는 hotfix)만. 병합은 **`--no-ff`**(통합 지점 명시). 태그(릴리스)는 여기에 부착. |
| `dev` | **통합 브랜치**. 작업 브랜치가 모이는 곳. | 작업 브랜치는 여기서 파생하고 여기로 PR. 안정되면 `main`으로 승격. |

## 작업 브랜치 — `dev`에서 파생

```
dev ──┬─ feat/<slug>     새 기능
      ├─ fix/<slug>      버그 수정
      ├─ chore/<slug>    빌드·설정·잡무(기능/버그 아님)
      ├─ docs/<slug>     문서만
      ├─ refactor/<slug> 동작 불변 구조 개선
      └─ infra/<slug>    인프라·배포·수집 설정
```

- **네이밍**: `<type>/<간결한-kebab-slug>` (예: `feat/log-workbench`, `infra/data01-onboarding`, `chore/gitignore-vendored`).
- **type 집합**: `feat · fix · chore · docs · refactor · infra`(+ 필요 시 `test · perf`). 커밋 프리픽스와 일치시킨다.
- 작업 브랜치는 **`dev`에서 파생 → `dev`로 PR**. `main` 직접 파생/병합 금지(hotfix 제외).

## 커밋 메시지 — Conventional Commits

```
<type>(<scope>): <요약, 한국어>

<본문(선택): 왜·무엇. 근거 ADR/spec 링크>
```

- `type`: 위 작업 브랜치 type과 동일 집합.
- `scope`: 영향 영역 — `console · infra · logging · monitoring · docs · design-system · ansible` 등.
- 예: `feat(console): 로그 워크벤치 1:1 비율·필터 칩`, `infra(logging): data01 xenial filebeat 7.17 벤더링`.

## PR 흐름

1. `dev`에서 작업 브랜치 파생 → 커밋.
2. 검증 통과 확인(콘솔: `npm run typecheck && lint && test && check:no-raw-hex`).
3. **`dev`로 PR**. 제목은 커밋 프리픽스 규약. 본문에 근거 spec/ADR.
4. 리뷰·머지(→ `dev`). 작업 브랜치는 머지 후 삭제.
5. `dev`가 안정되면 **`dev` → `main`** 병합(`--no-ff`)으로 릴리스, 필요 시 태그.

## hotfix (예외)

프로덕션 긴급 수정만 `main`에서 `fix/<slug>` 파생 → `main` 병합 후 **`dev`에도 반영**(체리픽/역병합)해 격차를 없앤다.

## 절대 규칙 (헌장 연동)

- **에이전트 생성 · 사람 적용**(§11): 에이전트는 브랜치·커밋·PR을 만들되, `main` 병합·`push`·배포 같은 되돌리기 어려운 원격 반영은 **사람 승인** 후.
- **시크릿은 레포 밖**(§13): 어떤 브랜치에도 키·비번·토큰 커밋 금지. 벤더링 바이너리도 커밋하지 않는다(`.gitignore`).
- 전체 규칙은 [`Constitution.md`](../Constitution.md).

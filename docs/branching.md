# 브랜치 전략 · 기여 흐름 (Branching & Contribution)

> KEIwi의 Git 워크플로 표준. **`main`(배포) · `dev`(통합) 2 상시 브랜치 + `dev` 파생 작업 브랜치**. Git Flow 경량판.
> 2026-07-24 도입 → **2026-07-31 실전판 개정**(규칙은 있었으나 안 지켜진 원인 교정).
> 이 문서의 규칙은 [`Constitution.md`](../Constitution.md)와 연동된다. 충돌 시 헌장이 우선.

---

## 0. 왜 이 문서를 고치나 — `feat/design-v3` 반면교사

규칙(구 버전 이 문서)은 **있었다**. 그런데 `v0.1.0` 이후 **한 브랜치 `feat/design-v3`에 25커밋이 뭉쳤다.** `git log v0.1.0..HEAD` 타입 분포:

| 관심사 | 커밋 | 원래 있어야 했던 브랜치 |
| --- | --- | --- |
| 디자인 v3 (콘솔 셸·워크벤치·대시보드 테마) | `feat(console)` 6, `feat(infra)` 1, `fix(design)` 1, `docs(infra)` 1 | `feat/design-v3` |
| 모니터링 알림 계층 (Grafana 규칙 5→9·Slack) | `feat(monitoring)` 2, `fix(monitoring)` 3 | `feat/monitoring-alerting` |
| 에러 트래킹 (GlitchTip·Sentry SDK·하트비트) | `feat(error-tracking)` 2, `fix(error-tracking)` 2, `docs(specs)` 2 | `feat/error-tracking-glitchtip` |
| 로그·인프라·문서 잡무 | `fix(logging)` 1, `fix(infra)` 1, `docs` 3 | 각각 분리 |

**세 개(이상)의 논리적 변경이 한 브랜치에 섞였다.** 그래서 생긴 실제 피해:

- **리뷰 불가** — PR 하나에 디자인 토큰과 알림 프로비저닝 YAML과 Django 스크러버가 같이 있으면 리뷰어(=미래의 나)가 무엇을 보는지 알 수 없다.
- **롤백 불가** — 알림 규칙만 되돌리려 해도 디자인 커밋과 뒤엉켜 `revert` 한 방에 안 끝난다.
- **이력추적 불가** — "GlitchTip 언제 왜 넣었지"를 찾으려면 25커밋을 헤집어야 한다. 브랜치 이름(`feat/error-tracking-glitchtip`)이 곧 답이어야 하는데 그 이름이 없었다.
- **릴리스 노트 불가** — 이 브랜치를 `dev`로 올리면 CHANGELOG의 한 줄이 "디자인+알림+에러트래킹"이 된다. 무의미하다.

**교훈: 규칙이 추상적("작업 브랜치는 dev에서 판다")이면 안 지켜진다.** 아래는 "언제 새 브랜치를 파는가"를 판단 가능한 기준과 명령으로 못박은 실전판이다.

---

## 1. 소스 브랜치 체계

| 브랜치 | 의미 | 커밋 규칙 |
| --- | --- | --- |
| `main` | **배포/production 기준선.** 콘솔(:3105)이 실제로 서빙하는 상태. 항상 검증 통과. | **직접 커밋·push 금지.** `dev` 병합만(hotfix 예외). 병합은 `--no-ff`. **릴리스 태그는 여기에만.** |
| `dev` | **통합 브랜치.** 작업 브랜치가 모여 서로 어울리는지 확인하는 곳. | **직접 커밋 금지.** 작업 브랜치를 여기서 파고, 여기로 PR. 안정되면 `main`으로 승격. |
| `feat/*` 등 | **작업 브랜치.** 하나의 논리적 변경 단위. | 자유롭게 커밋. `dev`에서 파생 → `dev`로 PR → 머지 후 삭제. |

```
main ◀──(릴리스, --no-ff, 태그)── dev ◀──(PR)── feat/<scope>-<slug>
                                    ◀──(PR)── feat/<other-scope>-<slug>
```

- `feat/*`는 **`dev`에서 파생 → `dev`로 PR.** `main`에서 직접 파생·병합 금지(§6 hotfix만 예외).
- `main`·`dev`에 **직접 커밋하지 않는다.** 실수 방지책은 §7.

**파생 명령(항상 최신 `dev`에서 시작):**
```bash
git switch dev && git pull --ff-only origin dev
git switch -c feat/monitoring-alerting     # 새 작업 브랜치
```

---

## 2. 브랜치 명명·범위 규칙 — **하나의 브랜치 = 하나의 논리적 변경**

### 형식: `<type>/<scope>-<slug>`

```
feat/monitoring-alerting-rules      infra/data01-onboarding
feat/error-tracking-glitchtip       docs/branching-revision
fix/logging-ingest-stalled          refactor/console-fleet-cards
```

- **`<type>`** — 커밋 프리픽스와 동일 집합: `feat · fix · docs · refactor · chore · perf`(+ 필요 시 `test`). 브랜치의 **주된** 성격 하나.
- **`<scope>`** — 영향 영역. 커밋 scope와 통일: `console · infra · logging · monitoring · error-tracking · design · docs · ansible · design-system`.
- **`<slug>`** — 간결한 kebab-case 요약. 나중에 "이게 뭐였지" 없이 읽히게.

### 언제 새 브랜치를 파야 하나 — 판단 기준

**"지금 커밋하려는 변경이 브랜치 이름과 같은 관심사인가?"** 를 매 커밋 전에 자문한다. 아니면 분리한다.

- ✅ `feat/monitoring-alerting`에서 알림 규칙 추가 → 오발화 수정 → Slack 라우팅 수정. **모두 알림 = 한 브랜치.**
- ❌ `feat/design-v3`에서 디자인 하다가 "알림도 붙이자" → **멈춘다.** 다른 관심사다. `dev`로 돌아가 `feat/monitoring-alerting`을 새로 판다.
- ❌ 버그를 발견했는데 지금 브랜치와 무관 → 별도 `fix/<scope>-<slug>`. 지금 브랜치에 끼워넣지 않는다.

**신호(하나라도 걸리면 분리):**
1. 커밋 scope가 브랜치의 scope와 **다르기 시작**한다(디자인 브랜치에 `feat(monitoring)`이 찍힌다).
2. "이 PR을 한 문장으로 요약"이 **"A 그리고 B"** 가 된다("그리고"가 나오면 둘이다).
3. 한 부분만 **롤백**하고 싶은데 다른 부분과 엉켜 못 되돌린다.
4. 서로 다른 spec/ADR을 동시에 건드린다.

작업 도중 섞인 걸 뒤늦게 알았다면:
```bash
git switch dev && git pull --ff-only origin dev
git switch -c feat/error-tracking-glitchtip
git cherry-pick <섞여든-커밋-sha> ...        # 관심사별로 옮겨 담는다
```

---

## 3. 커밋 메시지 — Conventional Commits (이미 잘 지켜짐 → 명문화)

`git log`가 증인이다. 아래 수준을 **규칙으로 고정**한다.

```
<type>(<scope>): <요약, 한국어, 명령형·현재형>

<본문(선택): 왜·무엇. 근거 ADR/spec 링크>
```

- **`<type>`**: `feat`(기능) · `fix`(버그) · `docs`(문서만) · `refactor`(동작 불변 구조개선) · `chore`(빌드·설정·잡무) · `perf`(성능) (+ `test`).
- **`<scope>`**: §2와 동일 집합. 브랜치 scope와 일치시킨다.
- **요약**: 한 줄, 무엇을 왜 했는지가 보이게. 마침표 없이.

**좋은 실례(실제 이력):**
```
feat(console): 로그 워크벤치 1:1 비율·필터 칩
fix(monitoring): LogIngestStalled 쿼리 교정 — OpenSearch는 빈 bucketAggs를 거부한다
infra(logging): data01 xenial filebeat 7.17 벤더링
feat(error-tracking): E4 로그 인입 하트비트 — dead man's switch (탐지 5.7일→40분)
```

- 한 커밋 = 한 가지 일. `feat`와 무관한 리팩터가 섞이면 커밋을 나눈다(`git add -p`).
- 브랜치가 섞이지 않았다면 커밋도 자연히 안 섞인다. **분리는 브랜치 단계에서 이미 끝나야 한다.**

---

## 4. PR 흐름 — `feat/*` → `dev`

1. **파생**: `dev` 최신화 후 `git switch -c <type>/<scope>-<slug>` (§1).
2. **작업·커밋**: §2·§3 준수. 한 관심사만.
3. **로컬 검증**(§7): `cd apps/console && npm run verify` — 통과해야 PR을 연다.
4. **PR 생성** → **base는 `dev`**:
   ```bash
   git push -u origin feat/<scope>-<slug>
   gh pr create --base dev --fill
   ```
   - 제목: 커밋 프리픽스 규약(`feat(monitoring): 알림 계층 1차`).
   - 본문: **무엇을·왜**, 근거 spec/ADR 링크, 검증 결과, 스크린샷(UI면).
5. **리뷰·머지**: 1인 운영이라도 PR로 남긴다(이력·롤백 단위). **머지 방식은 `--merge`(merge commit)** — 통합 지점을 남긴다(squash 아님, 현행 유지). 머지 후 브랜치 삭제(`gh pr merge --merge --delete-branch`).
6. **릴리스**: `dev`가 안정되면 **`dev` → `main`** 병합(§5).

> **에이전트 경계(헌장 §11):** 에이전트는 브랜치·커밋·PR 생성까지. **`main` 병합·`push`·배포·태그 같은 원격 반영은 사람 승인 후.**

---

## 5. `dev` → `main` 릴리스 & 버전·태그 정책

### SemVer — `vMAJOR.MINOR.PATCH`

| 자리 | KEIwi 맥락 기준 | 예 |
| --- | --- | --- |
| **MAJOR** | 되돌리기 어려운 구조 전환·운영 방식 파괴적 변경(사실상 드묾, 1.0.0 전엔 보류) | 콘솔 아키텍처 교체 |
| **MINOR** | **마일스톤/새 기능 묶음** 완료 | 알림 계층 + 에러 트래킹 + 디자인 v3 → `v0.2.0` |
| **PATCH** | 버그 수정·문서·소규모 교정만 | 오발화 쿼리 수정 → `v0.2.1` |

1.0.0 이전(`0.x`)에서는 **MINOR가 마일스톤, PATCH가 버그수정** 정도로 운용한다.

### 릴리스 절차 (사람 승인 후)

```bash
git switch dev && git pull --ff-only origin dev
cd apps/console && npm run verify           # 최종 검증
git switch main && git pull --ff-only origin main
git merge --no-ff dev -m "release: v0.2.0 — 알림 계층·에러 트래킹·디자인 v3"
git tag -a v0.2.0 -m "v0.2.0: 알림 9규칙·GlitchTip·콘솔 디자인 v3"
git push origin main --follow-tags
```

- **태그는 `main`에만.** `--no-ff`로 통합 지점을 명시.
- **CHANGELOG.md** 갱신(없으면 신설): 태그별로 `feat`/`fix`/`docs`를 사람이 읽는 문장으로 정리. 브랜치가 관심사별로 나뉘어 있으면 이 작업이 기계적으로 쉬워진다(§0의 이유).
- `v0.1.0 → v0.2.0`: 마일스톤(알림·에러트래킹·디자인) 완료이므로 **MINOR 상향**.

---

## 6. hotfix (예외 경로)

프로덕션(:3105) 긴급 장애만.
```bash
git switch main && git pull --ff-only origin main
git switch -c fix/<scope>-<slug>            # main에서 파생
# 수정·검증
gh pr create --base main --fill             # main으로 PR (긴급)
# 머지 후 반드시 dev에도 반영해 격차 제거:
git switch dev && git merge --no-ff main    # 또는 cherry-pick
```
hotfix는 PATCH 태그(`v0.2.1`)를 동반한다.

---

## 7. 강제 장치 — 규칙을 "안 지킬 수 없게"

이 환경의 `gh` 토큰은 **협업자(admin 아님)** 라 브랜치 보호를 코드로 못 건다. 그러니 **① 소유자가 GitHub에서 켤 것을 체크리스트로 남기고 ② 로컬 관례를 강제**한다.

### ① 소유자용 — GitHub Settings → Branches → Branch protection (사람이 1회 설정)

`main`, `dev` 각각에 **Add rule**:

- [ ] **Require a pull request before merging** — 직접 push 차단.
  - [ ] `main`: Require approvals(1). 1인 운영이면 최소한 self-review 강제로 "본 것".
- [ ] **Require status checks to pass** — 아래 **3개를 required 로 등록**한다
      (`.github/workflows/ci.yml` 의 잡 이름이 곧 status check 이름이다):
  - [ ] `console` — lint·typecheck·test·**build**·시크릿 게이트. build 는 여기서만 돈다(라이브 `.next` 보호, §12).
  - [ ] `repo-gates` — YAML·JSON·셸·파이썬·compose·Grafana 프로비저닝·런북·자격증명.
  - [ ] `infra-iac` — ansible·promtool(설정·규칙·**단위 테스트**)·메트릭명 가드.
  - > `npm run verify` 는 **콘솔 스코프뿐**이라 status check 이름이 아니다. 레포 전역 로컬 실행은
    > `bash scripts/verify-all.sh` 이고, CI는 그것을 3개 잡으로 나눠 돈다(도구 체인이 셋이라서).
  - > **1주 정보성 관찰 뒤에 required 로 올린다**(fleet-hardening T5-24). red 인 채 required 로 올리면
    > 1인 운영에서 머지가 전면 정지하고 우회할 사람도 없다.
- [ ] **Require branches to be up to date before merging** — 뒤처진 브랜치 머지 방지.
- [ ] **Require linear history**(선택) — `dev`는 끔(merge commit 유지), `main`은 취향껏.
- [ ] **Do not allow bypassing the above settings** — 관리자도 우회 금지.
- [ ] **Restrict who can push** — `main`/`dev` 직접 push 인원 0.
- [ ] (선택) **Require a tag** 규약은 GitHub이 강제 못 함 → §5 절차로 사람이 지킨다.

> 이 항목들은 **owner만** 설정 가능. 에이전트/협업자 토큰으로는 API로도 안 된다 → 그래서 문서로 규약한다.

### ② 모두에게 — 로컬 검증 관례(PR 열기 전 필수)

```bash
cd apps/console && npm run verify
# = lint && typecheck && test && build && check:secrets && check:no-raw-hex
```

- **`check:secrets`** — 키·토큰·비번 커밋 차단(헌장 §13 자동화). 실패하면 절대 push하지 않는다.
- **`check:no-raw-hex`** — 디자인 토큰 우회(생 hex) 차단.
- 실패한 채로 PR을 열지 않는다. 초록이 곧 "리뷰 시작 가능" 신호.

### ③ 실수 방지 로컬 훅(권장, 각자 1회)

`main`/`dev` 직접 커밋을 로컬에서 막는다:
```bash
cat > .git/hooks/pre-commit <<'SH'
#!/bin/sh
b=$(git rev-parse --abbrev-ref HEAD)
case "$b" in
  main|dev) echo "✋ $b 직접 커밋 금지 — 작업 브랜치를 파세요(docs/branching.md §1)"; exit 1;;
esac
SH
chmod +x .git/hooks/pre-commit
```

---

## 8. 절대 규칙 (헌장 연동)

- **에이전트 생성 · 사람 적용**(§11): 에이전트는 브랜치·커밋·PR을 만들되, `main` 병합·`push`·배포·태그 같은 되돌리기 어려운 원격 반영은 **사람 승인** 후.
- **시크릿은 레포 밖**(§13): 어떤 브랜치에도 키·비번·토큰 커밋 금지. 벤더링 바이너리도 커밋하지 않는다(`.gitignore` + `npm run check:secrets`).
- **KEI 내부 전용**: 이 저장소·문서는 외부 공개 금지(LICENSE: All rights reserved).
- 전체 규칙은 [`Constitution.md`](../Constitution.md).

---

### TL;DR

1. **한 브랜치 = 한 관심사.** "그리고"가 나오면 브랜치를 나눠라.
2. `feat/<scope>-<slug>`, `dev`에서 파생 → `dev`로 PR. `main`·`dev` 직접 커밋 금지.
3. PR 전 `npm run verify` 초록.
4. `dev`→`main`은 릴리스뿐. 태그는 `main`에만, 마일스톤=MINOR·버그=PATCH.
5. 브랜치 보호는 소유자가 GitHub에서 켠다(§7 체크리스트). 로컬 훅으로 실수 막는다.

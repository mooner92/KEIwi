# KEIwi · 테스트 / 검증

> [!IMPORTANT] 표준 규칙
> **모든 UI 작업은 마지막에 Playwright로 눈으로 확인**하고 스크린샷을 공유합니다. 비-UI 작업도 **끝에 경험적으로 검증**(런타임 curl·메트릭·로그)합니다. **추측으로 "됐다"고 하지 않습니다.** [[visual-qa-at-task-end]]

## 한눈에 — 무엇으로 무엇을 검증하나

| 도구 | 무엇 | 명령 |
| --- | --- | --- |
| **단위 테스트** | 순수 로직(상태 판정·파서·프롬프트·집계) | `npm run test` (vitest) |
| **정적 검사** | 타입·린트·시크릿·raw hex 금지 | `npm run typecheck` / `lint` / `check:secrets` / `check:no-raw-hex` |
| **시각 QA** | 레이아웃·스크롤·테마(라이트/다크) | `npm run screenshot` (Playwright) |
| **기능 테스트** | 어시스턴트 동작(신호별 다른 근거·답변) | `node scripts/assistant-func-test.mjs` (Playwright) |

> [!WARNING] `npm run verify`는 `build`를 포함 — 라이브 주의(§12)
> `verify` = `lint → typecheck → test → build → check:secrets → check:no-raw-hex`. 그런데 콘솔은 `apps/console/.next`를 **라이브로 서빙**하므로, 에이전트가 라이브와 같은 디렉터리에서 `build`를 돌리면 운영이 깨집니다. → **에이전트 검증은 build 제외**로:
> ```bash
> cd apps/console
> npm run typecheck && npm run lint && npm run test && npm run check:no-raw-hex
> ```
> 풀 빌드/시각·기능 검증은 아래 **격리 빌드**로.

## 격리 빌드 검증 (라이브 .next 미접촉, §12)

라이브를 건드리지 않고 프로덕션 빌드를 검증하려면 **git worktree + 하드링크 node_modules**로 격리 인스턴스를 띄웁니다(헤드리스 Playwright는 dev HMR과 충돌하므로 **프로덕션 빌드** 권장):

```bash
cd /KEIwi
git worktree add --detach /tmp/keiwi-qa HEAD
cp -al apps/console/node_modules /tmp/keiwi-qa/apps/console/node_modules   # 같은 fs면 즉시(하드링크)
cp apps/console/.env.local /tmp/keiwi-qa/apps/console/.env.local
cd /tmp/keiwi-qa/apps/console && node_modules/.bin/next build
node_modules/.bin/next start -p 3199 &        # 격리 포트(라이브 3105와 분리)
# … Playwright/스크린샷 검증 …
cd /KEIwi && git worktree remove /tmp/keiwi-qa --force   # 정리
```

> [!NOTE]
> `next dev`(turbopack)는 헤드리스 Chromium에서 **HMR WebSocket 실패 → 하이드레이션 불완전**으로 클라이언트 동작(useEffect 등)이 안 도는 경우가 있습니다. 그래서 기능/시각 검증은 **`next build` + `next start`(프로덕션)**로 합니다.

## 시각 QA — `npm run screenshot`

[`apps/console/scripts/screenshot.mjs`](../apps/console/scripts/screenshot.mjs): Playwright(chromium)로 **desktop(1440×900)·laptop(1366×768)·mobile(390×844)** 뷰포트별 스크린샷 + **세로 스크롤 여부**를 검증.

```bash
SCREENSHOT_URL=http://127.0.0.1:3199 \
SCREENSHOT_PATHS=/overview,/incidents \
SCREENSHOT_THEME=dark \
  npm run screenshot          # → ./screenshots/*.png
```
- **종료코드**: desktop/laptop 중 하나라도 세로 스크롤이 생기면 `1`(mobile은 허용).
- 환경변수: `SCREENSHOT_URL`(기본 `127.0.0.1:3105`) · `SCREENSHOT_PATHS`(기본 `/overview`) · `SCREENSHOT_THEME`(`light`|`dark`, `keiwi-theme` 쿠키) · `SCREENSHOT_OUT`.
- 출력은 gitignore(산출물).

## 기능 테스트 — 어시스턴트

[`apps/console/scripts/assistant-func-test.mjs`](../apps/console/scripts/assistant-func-test.mjs): `/incidents`에서 **서로 다른 두 신호를 분석 → 다른 근거·다른 답변**인지 검증(회귀 가드: "동일 답변 고정" 버그·"근거 0건" 버그).

```bash
BASE=http://127.0.0.1:3199 node scripts/assistant-func-test.mjs   # 실패 시 종료코드 1
```
> [!NOTE] Grafana iframe·외부 사이트
> Grafana 임베드는 Cloudflare Access 뒤라 헤드리스에서 인증 없이 **안 떠도 정상**입니다 — 검증 대상은 **콘솔 레이아웃·네이티브 동작**이지 Grafana 내용이 아닙니다. 라이브 URL(keiwi.excusa.uk)도 Access로 막히니 검증은 **localhost(격리 빌드)** 로.

## 단위 테스트

순수 로직만 vitest(`*.test.ts`)로 — 네트워크/DOM 없이 빠르게. 예:
- `lib/status.ts` — 상태 판정(US4 불변식 **no-data ≠ down** 회귀 보호).
- `lib/assistant.ts` — scrub·인용·런북 매칭·질의계획(parsePlan).
- `lib/service-catalog.ts` — 집계 빌더·파서.

## 설치 (1회)

```bash
cd apps/console
npm i -D playwright && npx playwright install chromium
# libnss3 등 부족하면: sudo npx playwright install-deps chromium
```

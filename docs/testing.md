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
| **기능 테스트** | 로그 워크벤치(드로어·인플레이스 분석·딥링크·토글·탭 순서) | `node scripts/logs-workbench-test.mjs` (Playwright) |
| **기능 테스트** | 임베드 베이스 host 분기(내부 IP→:3000, 로그인 루프 가드) | `node scripts/embed-host-test.mjs` (Playwright) |

> [!WARNING] `npm run verify`는 `build`를 포함 — 라이브 주의(§12)
> `verify` = `lint → typecheck → test → build → check:secrets → check:no-raw-hex`. 그런데 콘솔은 `apps/console/.next`를 **라이브로 서빙**하므로, 에이전트가 라이브와 같은 디렉터리에서 `build`를 돌리면 운영이 깨집니다. → **에이전트 검증은 build 제외**로:
> ```bash
> cd apps/console
> npm run typecheck && npm run lint && npm run test && npm run check:no-raw-hex
> ```
> 풀 빌드/시각·기능 검증은 아래 **격리 빌드**로.

> [!IMPORTANT] PR 전 표준은 `bash scripts/verify-all.sh` (레포 루트, build 제외가 기본)
> `npm run verify`는 **콘솔 스코프뿐**입니다. 레포 전역 게이트(YAML·JSON·셸·파이썬·compose·
> Grafana 프로비저닝·런북·규칙·메트릭명·ansible·자격증명)는 `scripts/gates/check-*`에 있고
> `scripts/verify-all.sh`가 글롭으로 전수 실행합니다 — CI(`console`·`repo-gates`·`infra-iac` 3잡)가
> 도는 것과 같은 게이트입니다.
> ```bash
> cd "$(git rev-parse --show-toplevel)"
> bash scripts/verify-all.sh            # rc=0 통과 / 1 위반 / 2 SKIP(도구 부재)
> bash scripts/verify-all.sh --dry-run  # 실행 계획만
> ```
> **rc=2를 초록으로 읽지 마십시오** — 도구가 없어 검사가 사라진 상태와 검사가 통과한 상태는
> 다릅니다. 도구 설치는 `bash scripts/gates/install-gate-tools.sh`(사용자 레벨).
> `--with-build`는 라이브 `.next`를 덮어쓰므로 **격리 worktree에서만** 쓰고 `/KEIwi`에서는
> 실행기가 거부합니다(§12). 시각 QA(Playwright)는 살아 있는 콘솔·Grafana가 필요해 **CI 비대상**이며
> 아래 격리 빌드 절차가 계속 담당합니다(ADR-0023).

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

## 기능 테스트 — 로그 워크벤치

[`apps/console/scripts/logs-workbench-test.mjs`](../apps/console/scripts/logs-workbench-test.mjs): `/logs` 워크벤치의 수용 기준([specs/logs-assistant](../specs/logs-assistant/spec.md) AC1~AC5)을 검증 — 드로어 표시·신호 클릭 인플레이스 분석(vLLM 실호출)·근거 "이 시점 →" iframe 시간창 딥링크·리셋·토글(Ctrl+I·헤더 버튼·localStorage 지속)·심화 링크 + Overview 탭 순서(시스템·GPU·모델·서비스).

```bash
BASE=http://127.0.0.1:3199 node scripts/logs-workbench-test.mjs   # 스크린샷 → ./screenshots/workbench
```
> [!NOTE] 헤드리스 한계
> 헤드리스 Chromium은 **물리 Ctrl+I 키를 페이지에 전달하지 않아**(kbd-debug로 확인) 합성 `KeyboardEvent`로 핸들러를 검증합니다. 실 브라우저에선 물리 키가 정상 전달됩니다.

[`apps/console/scripts/embed-host-test.mjs`](../apps/console/scripts/embed-host-test.mjs): 접속 host별 임베드 베이스 분기(`lib/grafana-host.ts`) — localhost/IP 접속 시 iframe이 `http://<host>:3000`(same-site)으로 향하는지 확인(크로스 사이트 쿠키 거부 → Grafana 로그인 무한 루프 회귀 가드).
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

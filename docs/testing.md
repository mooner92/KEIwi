# KEIwi — 테스트 / 시각 QA

> 표준 규칙: **모든 UI 개발 작업은 마지막에 Playwright 스크린샷으로 눈으로 확인**하고, 결과(스크린샷)를 공유한다. 비-UI 작업도 "끝에 경험적으로 검증"한다(런타임 curl, 메트릭 확인 등). 추측으로 "됐다"고 하지 않는다.

## 자동 검증 (`npm run verify`)
`apps/console`에서: `lint → typecheck → test(vitest) → build → check:secrets → check:no-raw-hex`. 코드 변경 후 항상 통과시킨다.

## 시각 QA (`npm run screenshot`) — UI 변경 시 필수
[`apps/console/scripts/screenshot.mjs`](../apps/console/scripts/screenshot.mjs): Playwright(chromium)로 콘솔을 띄워 **desktop(1440×900)·laptop(1366×768)·mobile(390×844)** 뷰포트별 스크린샷 + **세로 스크롤 여부**를 검증한다.

```bash
cd apps/console
# 1) 빌드
npm run build
# 2) 테스트용 인스턴스 기동(라이브 3105와 분리, dummy env로 iframe만 sized)
GRAFANA_URL=http://example.invalid GRAFANA_DASHBOARD_UID=x/y PROMETHEUS_URL=http://localhost:9090 \
  node node_modules/.bin/next start -p 3198 &   # (백그라운드)
# 3) 스크린샷 + 스크롤 검증
SCREENSHOT_URL=http://127.0.0.1:3198 npm run screenshot   # → ./screenshots/*.png
# 4) 인스턴스 종료
```
- **종료코드**: desktop/laptop 중 하나라도 세로 스크롤이 생기면 `1`(mobile은 허용).
- 출력: `apps/console/screenshots/<route>-<viewport>.png` (gitignore됨 — 산출물).
- 환경변수: `SCREENSHOT_URL`(기본 `http://127.0.0.1:3105`), `SCREENSHOT_PATHS`(기본 `/overview`, 쉼표 구분), `SCREENSHOT_OUT`.

> 외부 iframe(Grafana)은 헤드리스에서 인증 없이 안 떠도 무방하다 — 여기서 검증하는 건 **콘솔 레이아웃**(스크롤·비율)이지 Grafana 내용이 아니다.

## 설치 (1회)
```bash
cd apps/console
npm i -D playwright
npx playwright install chromium   # 브라우저 바이너리 다운로드
# 실행 시 libnss3 등 부족하면: sudo npx playwright install-deps chromium
```

## 단위 테스트
- `lib/status.ts`(상태 판정) 등 순수 로직은 vitest(`*.test.ts`). US4 불변식(no-data≠down) 회귀 보호.

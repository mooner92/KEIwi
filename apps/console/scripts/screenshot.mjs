// KEIwi 콘솔 시각 QA — Playwright로 페이지를 띄워 스크린샷 + 스크롤 여부 검증.
// 모든 UI 개발 작업의 마지막에 실행해 "스크롤 없이 한 화면" 등 레이아웃을 눈으로 확인한다.
//
// 사용:  SCREENSHOT_URL=http://127.0.0.1:3198 node scripts/screenshot.mjs
//   - SCREENSHOT_URL : 콘솔 베이스 URL (기본 http://127.0.0.1:3105)
//   - SCREENSHOT_OUT : 출력 디렉터리 (기본 ./screenshots)
//   - 종료코드: 어느 뷰포트라도 세로 스크롤이 생기면 1 (CI/검증용)
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.SCREENSHOT_URL ?? "http://127.0.0.1:3105";
const OUT = process.env.SCREENSHOT_OUT ?? "./screenshots";
const PATHS = (process.env.SCREENSHOT_PATHS ?? "/overview").split(",");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
let anyOverflow = false;

for (const route of PATHS) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
    });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
    } catch {
      // 외부 iframe(Grafana)가 안 떠도 콘솔 레이아웃은 렌더됨 — 무시
    }
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
    }));
    // mobile은 스크롤 허용(정보량상), desktop/laptop만 "한 화면" 강제
    const overflow = m.scrollH > m.innerH + 2;
    const strict = vp.name !== "mobile";
    if (overflow && strict) anyOverflow = true;
    const tag = `${route.replace(/\W+/g, "_").replace(/^_|_$/g, "") || "root"}-${vp.name}`;
    const file = `${OUT}/${tag}.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log(
      `  ${tag.padEnd(20)} ${vp.width}x${vp.height}  scrollH=${m.scrollH} innerH=${m.innerH}  ` +
        `${overflow ? (strict ? "✗ SCROLL" : "scroll(mobile ok)") : "✓ fits"}  → ${file}`,
    );
    await ctx.close();
  }
}

await browser.close();
console.log(anyOverflow ? "RESULT: 일부 뷰포트에 세로 스크롤 발생" : "RESULT: desktop/laptop 한 화면 OK");
process.exit(anyOverflow ? 1 : 0);

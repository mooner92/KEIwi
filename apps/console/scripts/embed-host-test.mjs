// 임베드 same-site 검증: 접속 host별로 iframe src가 올바른 Grafana 베이스로 향하는지.
// - 127.0.0.1:3199 접속 → iframe은 http://127.0.0.1:3000/... 이어야 함 (내부 = 같은 호스트)
// 사용: node scripts/embed-host-test.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://127.0.0.1:3199";
const expectPrefix = process.env.EXPECT || "http://127.0.0.1:3000/d/";

const browser = await chromium.launch();
const page = await browser.newPage();
let fail = 0;

for (const path of ["/overview", "/logs"]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  // /overview 기본 탭은 "서비스"(iframe 없음) → Grafana 탭(시스템/통합 로그)으로 전환
  const grafanaTab = page.getByRole("tab", { name: /시스템|통합 로그/ }).first();
  if (await grafanaTab.count()) await grafanaTab.click();
  await page.waitForSelector("iframe[title^='Grafana']", { timeout: 10000 });
  const src = await page.locator("iframe[title^='Grafana']").first().getAttribute("src");
  const ok = src?.startsWith(expectPrefix);
  console.log(`${ok ? "PASS" : "FAIL"} ${path} iframe src = ${src?.slice(0, 80)}...`);
  if (!ok) fail = 1;
}

await browser.close();
process.exit(fail);

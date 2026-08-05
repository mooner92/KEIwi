// RAG 어시스턴트 스모크 — /logs 어시스턴트에 질의 → 문서 근거 섹션 확인 + 스크린샷.
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://127.0.0.1:3199";
const OUT = process.env.OUT || "/tmp/rag-assistant.png";
const Q = process.env.Q || "로그 인입이 멈췄을 때 진단 순서";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

await page.goto(`${BASE}/logs`, { waitUntil: "networkidle" });
const drawer = page.getByRole("complementary", { name: "로그 어시스턴트" });
check("드로어 표시", await drawer.isVisible());

const panel = page.getByRole("region", { name: "로그 어시스턴트" });
const input = panel.getByRole("textbox").first();
await input.fill(Q);
await panel.getByRole("button", { name: "분석" }).click();

// 답변 렌더까지 대기 (근거 로그 details가 나타나면 완료)
await page
  .getByText(/근거 로그 \d+건/)
  .first()
  .waitFor({ timeout: 120_000 });

const docSummary = page.getByText(/문서 근거 \d+건/).first();
const hasDocs = await docSummary.isVisible().catch(() => false);
check("문서 근거 섹션 표시", hasDocs, hasDocs ? await docSummary.textContent() : "없음");

if (hasDocs) {
  await docSummary.click(); // <details> 펼치기
  await page.waitForTimeout(300);
  const items = page.locator("li", { hasText: /^\s*\[D\d+\]/ });
  const n = await items.count();
  const paths = [];
  for (let i = 0; i < n; i++) paths.push((await items.nth(i).innerText()).split("\n")[0]);
  check("[D n] 번호 + 레포 경로", n > 0, paths.join(" | "));
  check(
    "문서 경로가 실제 런북/ADR",
    paths.every((p) => /\[D\d+\]\s+(docs|specs|infra)\//.test(p) || /README\.md/.test(p)),
    paths.join(" | "),
  );
}

// 로그 근거는 여전히 [n]로 렌더 (alert-relay 계약 유지)
const logEvidence = page.getByText(/근거 로그 \d+건/).first();
await logEvidence.click();
await page.waitForTimeout(300);
const logNums = await page.locator("span.text-ink", { hasText: /^\[\d+\]$/ }).count();
check("로그 근거는 [n] 그대로", logNums > 0, `${logNums}건`);

await page.screenshot({ path: OUT, fullPage: false });
console.log("screenshot:", OUT);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);

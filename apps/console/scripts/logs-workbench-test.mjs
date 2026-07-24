// 로그 워크벤치 기능 테스트 (specs/logs-assistant AC1~AC5 + v2 필터 칩 F1~F4) — Playwright + 스크린샷.
// 사용: node scripts/logs-workbench-test.mjs  (BASE, OUT 환경변수 지원)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:3199";
const OUT = process.env.OUT || "./screenshots/workbench";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

// ── AC1: 드로어 기본 표시(신호 + 어시스턴트) ──────────────────────────────
await page.goto(`${BASE}/logs`, { waitUntil: "networkidle" });
const drawer = page.getByRole("complementary", { name: "로그 어시스턴트" });
check("AC1 드로어 표시", await drawer.isVisible());
const signalRows = drawer.locator("ul button");
const nSignals = await signalRows.count();
check("AC1 현재 신호 목록", nSignals > 0, `${nSignals}건`);
await shot("01-logs-default");

// ── F1: 레벨 칩 클릭 → 목록 건수 필터 + "표시 n" 카운트 반영 ──────────────
const levelChips = drawer.getByRole("group", { name: "레벨 필터" }).getByRole("button");
if (await levelChips.count()) {
  const chip = levelChips.first();
  const chipCount = Number(((await chip.locator("span.tnum").textContent()) || "").trim());
  await chip.click();
  await page.waitForTimeout(300);
  const nAfter = await signalRows.count();
  check(
    "F1 레벨 칩 → 목록 필터",
    nAfter === chipCount && nAfter <= nSignals,
    `${nSignals}→${nAfter} (칩 ${chipCount})`,
  );
  check("F1 '표시 n / 전체 m' 카운트", await drawer.getByText(/표시 \d+ \/ 전체 \d+/).isVisible());
  await shot("07-level-chip");
  await chip.click(); // 해제 — 이후 AC들은 전체 목록 기준
  await page.waitForTimeout(200);
} else {
  check("F1 레벨 칩 존재", false, "칩 0개");
}

// ── F2/F3: 노드 칩 → iframe src에 var-fleet_node 주입 · 리셋(전체) → 제거 ──
const nodeChips = drawer.getByRole("group", { name: "노드 필터" }).getByRole("button");
const iframeSrc = async () =>
  (await page.locator("iframe[title^='Grafana']").first().getAttribute("src")) || "";
if (await nodeChips.count()) {
  const nodeName = (((await nodeChips.first().locator("[data-chip-label]").textContent()) || "")).trim();
  await nodeChips.first().click();
  await page.waitForTimeout(500);
  const src = await iframeSrc();
  check(
    "F2 노드 칩 → var-fleet_node",
    src.includes(`var-fleet_node=${encodeURIComponent(nodeName)}`),
    src.slice(-100),
  );
  await shot("08-node-chip");
  await drawer.getByRole("button", { name: "전체", exact: true }).click();
  await page.waitForTimeout(500);
  check("F3 리셋 → var-fleet_node 제거", !(await iframeSrc()).includes("var-fleet_node="));
} else {
  check("F2 노드 칩 존재", false, "칩 0개");
}

// ── AC2: 신호 클릭 → 인플레이스 자동 분석(이동 없음) ─────────────────────
await signalRows.first().click();
check("AC2 URL 이동 없음", page.url().endsWith("/logs"));
check("AC2 선택 하이라이트", (await signalRows.first().getAttribute("aria-pressed")) === "true");
await shot("02-analyzing");
// vLLM 응답 대기(최대 90s): 답변 또는 에러 중 하나가 떠야 함
const answered = await Promise.race([
  drawer.locator("details summary").filter({ hasText: "근거 로그" }).waitFor({ timeout: 90000 }).then(() => "answer"),
  drawer.getByRole("alert").waitFor({ timeout: 90000 }).then(() => "error"),
]).catch(() => "timeout");
check("AC2 인플레이스 분석 완료", answered === "answer", answered);
await shot("03-answer");

// ── AC3: 근거 "이 시점 →" → iframe 시간창 딥링크 + 리셋 배너 ──────────────
if (answered === "answer") {
  await drawer.locator("details summary").click(); // 근거 펼치기
  const focusBtn = drawer.getByRole("button", { name: "이 시점 →" }).first();
  if (await focusBtn.count()) {
    await focusBtn.click();
    await page.waitForTimeout(500);
    const src = (await page.locator("iframe[title^='Grafana']").first().getAttribute("src")) || "";
    check("AC3 iframe 시간창 치환", /[?&]from=\d+&to=\d+/.test(src), src.slice(-90));
    check("AC3 리셋 배너", await page.getByText("±5분 범위").isVisible());
    await shot("04-deeplink");
    await page.getByRole("button", { name: "원래 범위로" }).click();
    await page.waitForTimeout(400);
    const src2 = (await page.locator("iframe[title^='Grafana']").first().getAttribute("src")) || "";
    check("AC3 원래 범위 복귀", !/[?&]from=\d{13}/.test(src2));
  } else {
    check("AC3 근거 버튼 존재", false, "근거 0건");
  }
}

// ── AC4: Ctrl+I 토글 + localStorage 지속 ─────────────────────────────────
// ※ 헤드리스 Chromium은 물리 Ctrl+I를 페이지에 전달하지 않음(환경 한계 — kbd-debug로 확인).
//   합성 keydown으로 핸들러 로직을 검증한다(실 브라우저에선 물리 키 전달됨).
const ctrlI = () =>
  page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", ctrlKey: true })));
await ctrlI();
await page.waitForTimeout(300);
check("AC4 Ctrl+I 닫힘(합성)", !(await drawer.isVisible()));
await shot("05-closed-fullwidth");
await page.reload({ waitUntil: "networkidle" });
check("AC4 닫힘 상태 지속(reload)", !(await page.getByRole("complementary", { name: "로그 어시스턴트" }).isVisible()));
await ctrlI();
await page.waitForTimeout(300);
check("AC4 Ctrl+I 다시 열림(합성)", await page.getByRole("complementary", { name: "로그 어시스턴트" }).isVisible());
// 헤더 버튼 토글(물리 클릭)도 검증
await page.getByRole("button", { name: /어시스턴트/ }).click();
await page.waitForTimeout(300);
check("AC4 헤더 버튼 닫힘", !(await page.getByRole("complementary", { name: "로그 어시스턴트" }).isVisible()));
await page.getByRole("button", { name: /어시스턴트/ }).click();
await page.waitForTimeout(300);
check("AC4 헤더 버튼 열림", await page.getByRole("complementary", { name: "로그 어시스턴트" }).isVisible());

// ── AC5: 전체 화면에서 계속 → /incidents ─────────────────────────────────
const deep = page.getByRole("link", { name: /전체 화면에서 계속/ });
check("AC5 심화 링크", ((await deep.getAttribute("href")) || "").startsWith("/incidents"));

// ── F4: 내비에 "어시스턴트" 부재(통합 로그 일원화) + /incidents 직접 접근 200 ──
const sideNav = page.locator("nav[aria-label='섹션 메뉴']");
check("F4 내비 어시스턴트 부재", (await sideNav.getByText("어시스턴트").count()) === 0);
const incResp = await page.goto(`${BASE}/incidents`, { waitUntil: "domcontentloaded" });
check("F4 /incidents 직접 접근 200", !!incResp && incResp.status() === 200);

// ── 탭 순서(별건): /overview = 시스템·GPU·모델·서비스, 기본 활성 = 시스템 ──
await page.goto(`${BASE}/overview`, { waitUntil: "networkidle" });
const tabs = page.getByRole("tab");
const labels = (await tabs.allTextContents()).map((s) => s.trim());
check("탭 순서", JSON.stringify(labels) === JSON.stringify(["시스템", "GPU", "모델", "서비스"]), labels.join("·"));
check("기본 활성=시스템", (await tabs.first().getAttribute("aria-selected")) === "true");
await shot("06-overview-tab-order");

await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n결과: ${results.length - fails}/${results.length} PASS`);
process.exit(fails ? 1 : 0);

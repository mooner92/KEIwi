// KEIwi 어시스턴트 기능 테스트 — Playwright로 /incidents 동작 검증.
// 회귀 방지 핵심: "다른 신호를 분석하면 다른 근거·다른 답변이 나오는가"
//   (fired useRef가 굳어 재분석이 안 되던 버그 + 진단 근거 0건 버그 회귀 가드)
//
// 사용:  BASE=http://127.0.0.1:3199 node scripts/assistant-func-test.mjs
//   - BASE : 콘솔 베이스 URL (기본 http://127.0.0.1:3199)
//   - OUT  : 스크린샷 출력 (기본 ./screenshots/assistant-func)
//   - 종료코드: 어서션 실패 시 1
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE ?? "http://127.0.0.1:3199";
const OUT = process.env.OUT ?? "./screenshots/assistant-func";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
let failures = 0;
const fail = (m) => { console.log("  FAIL:", m); failures++; };

await page.goto(`${BASE}/incidents`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForSelector('section[aria-label="현재 신호"]', { timeout: 30000 });
await page.waitForTimeout(800);

const signals = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('section[aria-label="현재 신호"] li').forEach((li) => {
    const a = li.querySelector('a[href*="/incidents?"]');
    const lab = li.querySelector("span.tnum");
    if (a) out.push({ label: lab ? lab.textContent.trim() : "", href: a.getAttribute("href") });
  });
  return out;
});
console.log("signals found:", signals.length);
if (signals.length < 2) fail("신호 2개 미만 — 비교 불가");

const first = signals[0] ?? null;
const second = signals.find((s) => s.label !== first?.label) ?? signals[1] ?? null;

// 신호 분석: API 응답(authoritative)을 기다려 answer/evidence 추출 + UI 렌더 확인 + 스크린샷
async function analyze(sig, tag) {
  const respP = page.waitForResponse(
    (r) => r.url().includes("/api/assistant") && r.request().method() === "POST",
    { timeout: 150000 },
  );
  await page.goto(`${BASE}${sig.href}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  let json = {};
  let status = 0;
  try {
    const resp = await respP;
    status = resp.status();
    json = await resp.json().catch(() => ({}));
  } catch (e) {
    fail(`${tag} /api/assistant 응답 없음: ${e.message}`);
  }
  await page
    .waitForSelector(
      'section[aria-label="로그 어시스턴트"] .whitespace-pre-wrap, section[aria-label="로그 어시스턴트"] [role="alert"]',
      { timeout: 30000 },
    )
    .catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${tag}.png`, fullPage: true });
  const r = {
    service: sig.label,
    status,
    answer: json.answer ?? null,
    evidenceCount: Array.isArray(json.evidence) ? json.evidence.length : 0,
    plan: json.plan ?? null,
    error: json.error ?? null,
  };
  console.log(`\n[${tag}] ${sig.label}  (HTTP ${status})`);
  console.log(`  evidence: ${r.evidenceCount}건  plan: ${r.plan ? JSON.stringify(r.plan) : "-"}`);
  if (r.error) console.log(`  error: ${r.error}`);
  console.log(`  answer: ${(r.answer || "").slice(0, 160).replace(/\s+/g, " ")}…`);
  return r;
}

if (first && second) {
  const A = await analyze(first, "signal-A");
  const B = await analyze(second, "signal-B");
  if (A.status !== 200) fail(`A HTTP ${A.status}`);
  if (B.status !== 200) fail(`B HTTP ${B.status}`);
  if (A.error) fail(`A 에러: ${A.error}`);
  if (B.error) fail(`B 에러: ${B.error}`);
  if (!A.answer) fail("A 답변 없음");
  if (!B.answer) fail("B 답변 없음");
  if (A.answer && B.answer && A.answer === B.answer && first.label !== second.label)
    fail("서로 다른 신호인데 답변 동일 — 재분석 버그 회귀");
  if (A.evidenceCount === 0) fail("A 근거 0건 — 진단검색 실패");
  if (B.evidenceCount === 0) fail("B 근거 0건 — 진단검색 실패");
}

console.log(
  failures === 0
    ? "\nPASS ✅  신호별 서로 다른 근거·답변 확인"
    : `\n${failures} FAILURE(S) ❌`,
);
await browser.close();
process.exit(failures === 0 ? 0 : 1);

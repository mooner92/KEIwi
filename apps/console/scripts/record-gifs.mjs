/**
 * 기능별 시연 GIF 생성기 — README·/about 에 붙일 자료를 만든다.
 *
 * 사용:
 *   node scripts/record-gifs.mjs                 # 전체
 *   node scripts/record-gifs.mjs overview-tabs   # 일부(이름 접두 매칭)
 *   BASE=http://localhost:3106 node scripts/record-gifs.mjs
 *
 * ⚠️ **익명화가 이 스크립트의 핵심 책임이다.**
 * 산출물은 PUBLIC 레포의 README 에 올라가는데 GIF 는 바이너리라 public-safety 게이트(P2)가
 * 읽지 못한다. 텍스트로는 막아둔 연구자 실계정이 화면 캡처로 새는 경로가 정확히 여기다.
 * 그래서 렌더된 DOM 의 텍스트를 **녹화 전에** 치환한다.
 *   · 매핑표는 레포에 두지 않는다(목록 자체가 개인정보 — 게이트 §P2 와 같은 판단).
 *     `~/.keiwi-gif-redact.json` 을 읽고, 없으면 **중단한다**(조용히 실명을 찍지 않는다).
 *   · Grafana 임베드는 교차 출처라 DOM 을 만질 수 없다. 다만 그쪽에 나오는 것은
 *     사설 IP·호스트명뿐이고 둘 다 이미 공개 레포에 있다(Constitution.md 등) — 허용.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3105";
const OUT = process.env.OUT || path.resolve("../../docs/media");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "keiwi-gif-"));
const VIEWPORT = { width: 1440, height: 900 };

// ── 익명화 ────────────────────────────────────────────────────────────────
const mapPath = path.join(os.homedir(), ".keiwi-gif-redact.json");
if (!fs.existsSync(mapPath)) {
  console.error(`익명화 매핑이 없다: ${mapPath}\n실명이 그대로 찍히므로 중단한다(§P2).`);
  process.exit(2);
}
const REDACT = JSON.parse(fs.readFileSync(mapPath, "utf8")).accounts;

/**
 * 페이지의 모든 텍스트 노드에서 실계정을 대체본으로 바꾼다.
 * `addInitScript` 로 넣어 **문서가 만들어질 때마다** 돌게 하고, MutationObserver 로
 * 서버 렌더 이후의 클라이언트 갱신(탭 전환·드로어)까지 따라간다.
 */
function redactionScript(map) {
  return `(() => {
    const MAP = ${JSON.stringify(map)};
    const keys = Object.keys(MAP).sort((a, b) => b.length - a.length); // 긴 것부터(부분일치 방지)
    const src = "\\\\b(" + keys.join("|") + ")\\\\b";
    // ⚠️ test 용과 replace 용을 **분리한다.** /g 정규식은 test() 호출마다 lastIndex 가 남아
    //    같은 객체를 재사용하면 한 번 걸러 false 가 된다(실측: 첫 녹화에서 실명이 그대로 샜다).
    const reTest = new RegExp(src);
    // 홈 경로는 따로 처리한다. 포트 수집기가 명령줄을 잘라 담아서 계정명이 **조각**으로
    // 남는다(실측: "/home/mhch"). 단어 경계 정규식은 조각을 못 잡으므로, 홈 경로의
    // 토큰이 실계정의 접두사이면 대체본으로 바꾼다. 경로 문맥으로 한정해 오탐을 막는다.
    // (이 주석은 템플릿 리터럴 안이라 백틱을 쓸 수 없다 — 쓰면 문자열이 끊긴다.)
    // 정규식 **리터럴을 쓰지 않는다** — 이 코드는 템플릿 리터럴 안이라 슬래시 이스케이프가
    // 한 겹 풀려 "//home/..." 즉 주석이 되어버렸다(실측: 주입 스크립트 전체가 죽었다).
    const homeRe = new RegExp("/home/([A-Za-z0-9_.-]{3,})", "g");
    const homeTest = new RegExp("/home/([A-Za-z0-9_.-]{3,})");  // /g 없는 판정용(lastIndex 함정 회피)
    const homeSwap = (s) => s.replace(homeRe, (full, tok) => {
      const hit = keys.find((k) => k === tok || k.startsWith(tok));
      return hit ? "/home/" + MAP[hit] : full;
    });
    const swap = (s) => homeSwap(s.replace(new RegExp(src, "g"), (m) => MAP[m] || m));
    const walk = (root) => {
      const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const hits = [];
      // 두 규칙 **모두**로 거른다. 계정명 정규식만 쓰면 "/home/mhch" 처럼 조각만 있는
      // 노드가 치환 함수에 도달조차 못 한다(실측: 이 한 건이 끝까지 남았다).
      while (it.nextNode()) {
        const v = it.currentNode.nodeValue;
        if (reTest.test(v) || homeTest.test(v)) hits.push(it.currentNode);
      }
      for (const n of hits) n.nodeValue = swap(n.nodeValue);
      // title 속성(툴팁)에도 계정이 들어간다
      for (const el of root.querySelectorAll ? root.querySelectorAll("[title]") : [])
        el.setAttribute("title", swap(el.getAttribute("title") || ""));
    };
    const run = () => { try { if (document.body) walk(document.body); } catch {} };
    // ⚠️ 감시자를 **여기서 바로 붙이면 안 된다.** addInitScript 시점에는 documentElement 가
    //    아직 없어 observe() 가 예외로 죽고, 그러면 초기 1회 치환 뒤 React 하이드레이션이
    //    원문을 되살려도 아무도 되돌리지 않는다(실측: swapped=368 인데 실명이 그대로 남았다).
    const arm = () => {
      run();
      try {
        new MutationObserver(run).observe(document.documentElement, {
          childList: true, subtree: true, characterData: true,
        });
      } catch {}
      // 감시자만으로는 프레임워크의 배치 갱신을 놓칠 수 있다. 녹화는 수십 초짜리라
      // 주기 청소가 싸고 확실하다 — 유출은 되돌릴 수 없는 실패다.
      setInterval(run, 800);  // 과하면 DOM 이 계속 흔들려 Playwright 대기가 길어진다
    };
    // ⚠️ 하이드레이션 **뒤에** 시작한다. 전에 텍스트를 바꾸면 서버 렌더 결과와 어긋나
    //    React 가 #418(text content mismatch)을 내고 인터랙션이 죽을 수 있다(실측).
    //    SSR 원문으로 하이드레이션을 끝낸 뒤 치환하면 화면만 바뀌고 동작은 그대로다.
    const start = () => setTimeout(arm, 400);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start);
  })();`;
}

// ── 시나리오 ──────────────────────────────────────────────────────────────
// 각 항목: {name, title, steps(page)} — steps 안에서 pause() 로 읽을 시간을 준다.
const pause = (page, ms) => page.waitForTimeout(ms);
const settle = async (page, ms = 1200) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await pause(page, ms);
};

const SCENARIOS = [
  {
    name: "overview-tabs",
    title: "Overview — 시스템·GPU·모델·서비스 4개 탭",
    async steps(page) {
      await page.goto(`${BASE}/overview`); await settle(page, 2500);
      for (const tab of ["keiwi-gpu", "keiwi-model-workload", "service"]) {
        await page.click(`a[href="?tab=${tab}"]`); await settle(page, 2600);
      }
      await page.click('a[href="?tab=keiwi-system"]'); await settle(page, 1800);
    },
  },
  {
    name: "overview-node-drilldown",
    title: "Overview — 플릿 스트립에서 노드 드릴다운",
    async steps(page) {
      await page.goto(`${BASE}/overview`); await settle(page, 2200);
      await page.click('a[href="/overview?node=data05"]'); await settle(page, 2600);
      await page.click('a[href="/overview?node=data03"]'); await settle(page, 2600);
    },
  },
  {
    name: "service-map",
    title: "서비스 맵 — GPU 프로세스 · 리스닝 포트 · 위키 링크",
    async steps(page) {
      await page.goto(`${BASE}/overview?tab=service`); await settle(page, 2200);
      // locator.evaluate 는 actionability 대기가 붙어, 익명화 루프가 DOM 을 계속 만지는
      // 동안 30초 타임아웃이 났다(실측). 대기가 필요 없는 작업이므로 직접 조작한다.
      for (const y of [300, 700, 1100]) {
        await page.evaluate((v) => {
          const uls = document.querySelectorAll("section ul");
          const el = uls[uls.length - 1];
          if (el) el.scrollTop = v;
        }, y);
        await pause(page, 900);
      }
      const wiki = page.locator('a[href*="/wiki?page="]').first();
      if (await wiki.count()) { await wiki.scrollIntoViewIfNeeded(); await wiki.hover(); await pause(page, 1200); }
    },
  },
  {
    name: "wiki-browse",
    title: "플릿 위키 — 서버·계정·프로젝트 문서 탐색",
    async steps(page) {
      await page.goto(`${BASE}/wiki`); await settle(page, 2000);
      const links = page.locator('nav[aria-label="위키 문서"] a');
      const n = Math.min(await links.count(), 4);
      for (let i = 1; i < n; i++) { await links.nth(i).click(); await settle(page, 1700); }
    },
  },
  {
    name: "wiki-graph",
    title: "플릿 위키 — 문서 그래프(서버→계정→프로젝트)",
    async steps(page) {
      await page.goto(`${BASE}/wiki?page=__graph__`); await settle(page, 2600);
      const node = page.locator("svg a").nth(2);
      if (await node.count()) { await node.hover(); await pause(page, 1200); await node.click(); await settle(page, 2000); }
    },
  },
  {
    name: "code-graph",
    title: "코드 그래프 — graphify 산출물 임베드",
    async steps(page) { await page.goto(`${BASE}/graph`); await settle(page, 4000); await pause(page, 2500); },
  },
  {
    name: "logs-workbench",
    title: "통합 로그 — 워크벤치",
    async steps(page) { await page.goto(`${BASE}/logs`); await settle(page, 4000); await pause(page, 3000); },
  },
  {
    name: "models",
    title: "모델 — 서빙 현황 · VRAM",
    async steps(page) {
      await page.goto(`${BASE}/models`); await settle(page, 2600);
      await page.mouse.wheel(0, 400); await pause(page, 1600);
    },
  },
  {
    name: "changelog-filter",
    title: "패치노트 — 유형·영역 태그 필터",
    async steps(page) {
      await page.goto(`${BASE}/changelog`); await settle(page, 2000);
      for (const q of ["신규", "수정", "사건"]) {
        const chip = page.locator(`a[href*="type="]`, { hasText: q }).first();
        if (await chip.count()) { await chip.click(); await settle(page, 1700); }
      }
    },
  },
  {
    name: "theme-toggle",
    title: "테마 — 라이트 ↔ 다크",
    async steps(page) {
      await page.goto(`${BASE}/overview?tab=service`); await settle(page, 2000);
      const btn = page.locator('button[aria-label*="테마"], button[title*="테마"]').first();
      for (let i = 0; i < 2; i++) {
        if (await btn.count()) { await btn.click(); await pause(page, 2200); }
      }
    },
  },
  {
    name: "about",
    title: "소개 — 프로젝트 개요",
    async steps(page) {
      await page.goto(`${BASE}/about`); await settle(page, 1800);
      for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 420); await pause(page, 1100); }
    },
  },
];

// ── 실행 ──────────────────────────────────────────────────────────────────
function toGif(webm, gif, { fps = 12, width = 1100 } = {}) {
  const vf =
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];` +
    `[s0]palettegen=max_colors=160:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-vf", vf, "-loop", "0", gif]);
}

const only = process.argv.slice(2);
const picked = only.length ? SCENARIOS.filter((s) => only.some((o) => s.name.startsWith(o))) : SCENARIOS;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];
for (const sc of picked) {
  const dir = path.join(TMP, sc.name);
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir, size: VIEWPORT },
    reducedMotion: "no-preference",
  });
  await ctx.addInitScript(redactionScript(REDACT));
  const page = await ctx.newPage();
  if (process.env.DEBUG) page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 160)));
  let error = null;
  try {
    await sc.steps(page);
  } catch (e) {
    error = e.message.split("\n")[0];
  }
  // 유출 검사 — 녹화를 닫기 전에 **화면 텍스트**를 직접 확인한다. 프레임을 눈으로 보는
  // 검증은 놓치기 쉽다(실제로 첫 시도에서 실명이 샜고 프레임을 열어보고서야 알았다).
  if (!error) {
    const leaked = await page.evaluate((names) => {
      const t = document.body ? document.body.innerText : "";
      const hits = names.filter((n) => new RegExp("\\b" + n + "\\b").test(t));
      // 잘린 조각까지 본다 — `/home/mhch` 처럼 수집기가 자른 형태가 실제로 새어 있었다.
      for (const m of t.matchAll(/\/home\/([A-Za-z0-9_.-]{3,})/g)) {
        const tok = m[1];
        if (names.some((n) => n.startsWith(tok)) && !hits.includes(tok)) hits.push("/home/" + tok);
      }
      return hits;
    }, Object.keys(REDACT)).catch(() => []);
    if (leaked.length) {
      error = `실계정 유출 ${leaked.length}건 — GIF 폐기`;
      if (process.env.DEBUG) console.log("  [leak]", leaked.join(", "));
    }
  }
  await ctx.close(); // 영상은 close 시점에 flush 된다
  const webm = fs.readdirSync(dir).find((f) => f.endsWith(".webm"));
  const gif = path.join(OUT, `${sc.name}.gif`);
  if (webm && error && error.startsWith("실계정 유출")) {
    if (fs.existsSync(gif)) fs.unlinkSync(gif); // 이전 실행의 오염본까지 지운다
    results.push({ name: sc.name, kb: 0, error });
    console.log(`✗ ${sc.name.padEnd(24)}   —      ${error}`);
  } else if (webm) {
    toGif(path.join(dir, webm), gif);
    const kb = Math.round(fs.statSync(gif).size / 1024);
    results.push({ name: sc.name, kb, error });
    console.log(`${error ? "△" : "✓"} ${sc.name.padEnd(24)} ${String(kb).padStart(5)} KB${error ? "  ⚠ " + error : ""}`);
  } else {
    results.push({ name: sc.name, kb: 0, error: error || "영상 없음" });
    console.log(`✗ ${sc.name.padEnd(24)}   —      ${error || "영상 없음"}`);
  }
}
await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });

const ok = results.filter((r) => r.kb > 0 && !r.error).length;
console.log(`\n생성 ${ok}/${results.length} · 합계 ${Math.round(results.reduce((a, r) => a + r.kb, 0) / 1024)} MB · ${OUT}`);
if (results.some((r) => r.error)) process.exitCode = 1;

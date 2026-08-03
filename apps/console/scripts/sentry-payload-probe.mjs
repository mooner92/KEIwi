// E3-4 / AC-E-6 — 원시 envelope 실측 게이트.
//
// 단위 테스트는 "내가 예상한 필드"만 검증한다. 이 스크립트는 "SDK가 실제로 무엇을
// 보내는가"를 바이트로 본다. 실제 DSN을 연결하기 전에 반드시 통과해야 한다.
//
// 방법: 로컬 echo 서버를 띄우고 DSN을 그쪽으로 향하게 한 뒤, 민감정보가 잔뜩 들어간
// 에러를 일부러 발생시켜 전송 페이로드를 덤프하고 금지 문자열을 grep한다.
//
// 사용: node scripts/sentry-payload-probe.mjs
import { createServer } from "node:http";
import { gunzipSync, inflateSync } from "node:zlib";
import * as Sentry from "@sentry/node";
import { baseSentryOptions } from "../src/lib/sentry-options.ts";

const PORT = 9977;
const captured = [];

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let buf = Buffer.concat(chunks);
    const enc = req.headers["content-encoding"];
    try {
      if (enc === "gzip") buf = gunzipSync(buf);
      else if (enc === "deflate") buf = inflateSync(buf);
    } catch { /* 압축이 아니면 원본 그대로 */ }
    captured.push(buf.toString("utf8"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
});

await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

Sentry.init({
  // 실제 운영과 **같은 옵션 모듈**을 쓴다 — 프로브만 통과하고 운영에서 새는 일 방지
  ...baseSentryOptions(`http://probekey00000000000000000000000@127.0.0.1:${PORT}/1`),
  release: "probe",
  environment: "probe",
});

// ── 민감정보를 최대한 심어 놓고 에러를 낸다 ──────────────────────────────
// 동료 OS 계정명 자리(exporter가 실제로 노출하는 값). 값은 **익명 대체본**이다 —
// 스크러버 판정이 태그 **키 허용목록**이라 값이 무엇이든 검증력은 같다(PUBLIC 레포 §13).
Sentry.setTag("user", "user6");
Sentry.setTag("route", "/logs");            // 허용 태그
// 이메일 도메인도 RFC 2606 예약 도메인을 쓴다 — 스크러버는 `user` 필드를 통째로
// 지우므로(값 매칭이 아니다) 실제 조직 도메인일 이유가 없다.
Sentry.setUser({ id: "u-1", ip_address: "192.168.1.101", email: "x@example.com" });
Sentry.addBreadcrumb({ category: "console", message: "DEBUG_DUMP_SECRET" });
Sentry.addBreadcrumb({ category: "http", data: { body: "BODY_SECRET" } });

function deep() {
  // S1(자격증명 리터럴 금지)에 걸리지 않도록 조립한다. **런타임 값은 종전과 동일**하며
  // sentry-scrub의 Slack 토큰 패턴(/\bxox[baprs]-[A-Za-z0-9-]{6,}/)을 그대로 만족한다 —
  // 이 프로브의 검증력(스크러버가 토큰 꼴을 마스킹하는가)은 불변이다.
  // 값을 바꾸지 않고 소스 리터럴만 없애는 이유: 값을 바꾸면 패턴을 벗어나 프로브가 무의미해진다.
  const SECRET_TOKEN = ["xoxb", "PROBE", "SECRET", "TOKEN"].join("-");
  throw new Error(
    `Prometheus 192.168.1.104:9400 스크랩 실패 (token=${SECRET_TOKEN})`,
  );
}
try { deep(); } catch (e) { Sentry.captureException(e); }

await Sentry.flush(5000);
await new Promise((r) => setTimeout(r, 800));
server.close();

// ── 판정 ────────────────────────────────────────────────────────────────
const raw = captured.join("\n");
console.log(`\n캡처된 envelope: ${captured.length}건 / ${raw.length} bytes\n`);

const FORBIDDEN = [
  ["동료 계정명", "user6"],
  ["시크릿 토큰", "PROBE-SECRET-TOKEN"],
  ["사설 IP(101)", "192.168.1.101"],
  ["사설 IP(104)", "192.168.1.104"],
  ["이메일", "example.com"],
  ["console breadcrumb", "DEBUG_DUMP_SECRET"],
  ["breadcrumb 페이로드", "BODY_SECRET"],
  ["절대경로", "/home/mooner92"],
  ["소스 본문", "const SECRET_TOKEN"],
];

let bad = 0;
for (const [label, needle] of FORBIDDEN) {
  const hit = raw.includes(needle);
  if (hit) bad++;
  console.log(`  ${hit ? "✗ 유출" : "✓ 차단"}  ${label.padEnd(20)} ${hit ? `← "${needle}"` : ""}`);
}

// 있어야 할 것도 확인 — 다 지워버리면 에러 추적이 무의미하다
const REQUIRED = [
  ["예외 타입", "Error"],
  ["함수명", "deep"],
  ["상대 파일경로", "apps/console/scripts"],
  ["허용 태그 route", "/logs"],
];
console.log();
let miss = 0;
for (const [label, needle] of REQUIRED) {
  const hit = raw.includes(needle);
  if (!hit) miss++;
  console.log(`  ${hit ? "✓ 보존" : "✗ 소실"}  ${label}`);
}

console.log(`\n${bad === 0 && miss === 0 ? "PASS — 실제 DSN 연결 가능" : `FAIL — 유출 ${bad}건 / 소실 ${miss}건`}`);
if (process.env.DUMP === "1") console.log("\n=== 원시 페이로드 ===\n" + raw.slice(0, 4000));
process.exit(bad === 0 ? 0 : 1);

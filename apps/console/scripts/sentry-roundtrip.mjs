// E3-7 — 서버 왕복 확인. 실제 DSN으로 예외 1건을 보내고 ingest 수용을 확인한다.
//
// 프로덕션 코드에 셀프테스트 라우트를 남기지 않기 위해 **일회성 스크립트**로 만든다
// (spec E3-7: "프로덕션에 셀프테스트 라우트를 남기지 않는다").
//
// 사용: node scripts/sentry-roundtrip.mjs
import { readFileSync } from "node:fs";
import * as Sentry from "@sentry/node";
import { baseSentryOptions } from "../src/lib/sentry-options.ts";

// .env.local에서 DSN을 읽는다(값은 출력하지 않는다).
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const dsn = env.match(/^GLITCHTIP_DSN=(.+)$/m)?.[1]?.trim();
if (!dsn) { console.error("✗ GLITCHTIP_DSN 없음"); process.exit(1); }
const host = dsn.replace(/^https?:\/\/[^@]+@/, "").split("/")[0];
console.log(`  대상: ${host} (key 마스킹)`);

Sentry.init({ ...baseSentryOptions(dsn), release: "roundtrip", environment: "verification" });

const marker = `KEIWI-ROUNDTRIP-${Date.now()}`;
Sentry.setTag("route", "/scripts/roundtrip");
const id = Sentry.captureException(
  new Error(`E3-7 왕복 확인 ${marker} — 이 이슈는 배선 검증용입니다(무시/해결 처리 가능)`),
);
console.log(`  event_id: ${id}`);
console.log(`  marker  : ${marker}`);

const ok = await Sentry.flush(10000);
console.log(`\n  flush: ${ok ? "✓ 전송 완료" : "✗ 타임아웃(전송 실패)"}`);
console.log(ok
  ? "  → GlitchTip UI에서 위 marker로 검색해 이슈 1건을 확인하세요."
  : "  → ingest 도달 실패. DSN 호스트/포트와 컨테이너 상태를 확인하세요.");
process.exit(ok ? 0 : 1);

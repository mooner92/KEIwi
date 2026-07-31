// 서버 런타임(Node) Sentry/GlitchTip 초기화 — instrumentation.ts의 register()가 로드한다.
//
// 옵션은 src/lib/sentry-options.ts 한 곳에서 만든다. 페이로드 실측 프로브
// (scripts/sentry-payload-probe.mjs)가 **같은 모듈**을 쓰므로, 프로브가 통과하면
// 운영도 같은 필터를 거친다는 것이 보장된다(E3-4에서 이 구조 때문에 유출 2건을 잡았다).
import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions } from "@/lib/sentry-options";
import { getGlitchTipDsn } from "@/config/env";

Sentry.init(baseSentryOptions(getGlitchTipDsn()));

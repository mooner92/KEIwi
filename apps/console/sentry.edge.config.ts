// Edge 런타임 초기화 — instrumentation.ts의 register()가 로드한다.
//
// 우리 콘솔은 현재 edge 라우트를 쓰지 않지만(전 라우트가 Node 런타임), Next가 edge
// 번들을 만들 때 초기화가 없으면 그 경로의 에러가 통째로 사라진다. 비용이 없으므로 둔다.
// 서버와 같은 옵션 모듈을 쓴다 — 스크러빙 규칙이 런타임마다 달라지면 안 된다.
import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions } from "@/lib/sentry-options";
import { getGlitchTipDsn } from "@/config/env";

Sentry.init(baseSentryOptions(getGlitchTipDsn()));

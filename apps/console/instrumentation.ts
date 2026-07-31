// Next.js 계측 진입점 — 런타임별 Sentry 초기화 + 서버 에러 후킹.
//
// ⚠️ `sentry.client.config.ts`는 만들지 않는다.
// Next 16 + Turbopack은 그 파일을 auto-import하지 않는다(구버전 webpack 규약).
// 브라우저 계측은 `instrumentation-client.ts`가 담당한다(E3-8, 아직 미배선).
//
// register()는 서버 부팅 시 1회 실행된다. DSN이 없으면 baseSentryOptions가
// enabled:false로 만들어 SDK가 조용히 비활성화된다 — 콘솔 부팅은 영향받지 않는다(AC-E-3).

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// App Router의 서버 컴포넌트·라우트 핸들러에서 발생한 에러를 SDK로 넘긴다.
// 이게 없으면 렌더 중 예외가 Next 내부에서 소진되어 GlitchTip에 도달하지 않는다.
export { captureRequestError as onRequestError } from "@sentry/nextjs";

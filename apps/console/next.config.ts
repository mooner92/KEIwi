import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const extraDevOrigins = (process.env.KEIWI_DEV_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// 미설정이면 **기동 시점에 경고한다.** 이 설정이 빠졌을 때의 증상은 "클릭·토글이 전부 무반응"
// 인데, SSR HTML도 콘솔 로그도 멀쩡해서 원인이 화면에 드러나지 않는다(실측 2026-08-12:
// LAN IP로 연 dev 서버에서 테마 토글·분석 버튼·탭이 모두 죽었고, 유일한 단서는 브라우저
// 콘솔의 webpack-hmr WebSocket 핸드셰이크 실패였다). 진단 비용이 큰 실패라 침묵시키지 않는다.
// `.env.local`은 커밋되지 않으므로 새 워크트리·새 머신에서 반드시 재발한다.
if (process.env.NODE_ENV === "development" && extraDevOrigins.length === 0) {
  console.warn(
    "[keiwi] KEIWI_DEV_ORIGINS 미설정 — localhost/127.0.0.1 외의 주소(LAN IP 등)로 이 dev 서버를 " +
      "열면 HMR WebSocket이 거부되고 하이드레이션이 죽어 클릭·토글이 전부 무반응이 됩니다. " +
      "원격에서 볼 계획이면 apps/console/.env.local 에 KEIWI_DEV_ORIGINS=<접속 주소> 를 넣으세요.",
  );
}

const nextConfig: NextConfig = {
  // OpenTelemetry는 Sentry SDK가 서버 계측에 쓴다. 번들링하면 런타임에 깨진다.
  serverExternalPackages: ["@opentelemetry/api"],

  // Next dev 표시기(좌하단 "N" 배지)를 숨긴다.
  //
  // 왜: 3106을 화면 검토·스크린샷에 그대로 쓰는데, 배지가 사이드바 푸터(환경·버전 표기)를
  // 덮어 그 자리를 볼 수 없다. dev 전용 UI라 프로덕션(3105)에는 애초에 없다 — 즉 끄더라도
  // 잃는 정보가 없고, 오히려 dev 화면이 프로덕션과 같아져 검토 결과를 그대로 신뢰할 수 있다.
  devIndicators: false,

  turbopack: {
    // 워크스페이스 루트를 이 앱 디렉터리로 못 박는다.
    //
    // 왜: Next는 lockfile을 위로 훑어 루트를 추론하는데, 상위 경로(예: 개발자 홈)에
    // package-lock.json이 있으면 그쪽을 루트로 잡는다. 그러면 클라이언트 번들과
    // webpack-hmr WebSocket 경로가 어긋나 **하이드레이션이 통째로 죽는다**
    // (SSR HTML은 정상이라 화면은 멀쩡해 보이고 클릭만 전부 무반응 — 진단이 어렵다).
    // 실제로 worktree를 홈 아래(~/keiwi-design)에 두자 이 현상이 재현됐다.
    //
    // import.meta.dirname을 쓰는 이유: 절대경로를 박으면 체크아웃 위치(worktree·CI·
    // 다른 개발자 머신)마다 깨진다. 설정 파일 자신의 위치가 곧 앱 루트다.
    root: import.meta.dirname,
  },

  // dev 서버에 어느 호스트로 접근해도 HMR이 살아있게 한다.
  //
  // 왜: Next 15.2+는 dev에서 교차 출처를 막는데, 기본 허용은 사실상 localhost뿐이다.
  // 그래서 127.0.0.1이나 LAN IP로 열면 webpack-hmr WebSocket이 거부되고,
  // 그 여파로 **하이드레이션이 통째로 죽는다**(SSR HTML은 정상이라 화면은 멀쩡한데
  // 클릭·토글만 전부 무반응 — 원인이 화면에 드러나지 않아 진단이 어렵다).
  // 실측: localhost ✓ / 127.0.0.1 ✗ 로 갈렸다.
  //
  // 사내망 전용 개발 서버라 LAN 대역 허용은 위험하지 않다(프로덕션엔 영향 없음 — dev 전용 옵션).
  //
  // 배포마다 달라지는 값(LAN IP·자체 도메인)은 소스에서 뺐다 — KEIWI_DEV_ORIGINS 로 주입한다
  // (쉼표 구분). 기본값에는 어느 배포에서나 같은 127.0.0.1·localhost 만 남긴다:
  // 이 둘이 빠지면 위 하이드레이션 사고가 그대로 재현되므로 env로 덮지 않고 **항상 더한다**.
  //   예) KEIWI_DEV_ORIGINS="192.0.2.10,*.example.com"   (실값은 .env.local 에만, §13)
  allowedDevOrigins: extraDevOrigins.concat(["127.0.0.1", "localhost"]),
};

// Sentry 빌드 플러그인 래핑 (specs/error-tracking §5).
//
// 우리가 끄는 것과 이유 — 전부 "외부로 나가거나, 우리에게 값이 없는" 것들이다:
//   sourcemaps.disable  : 소스맵 업로드는 소스 본문을 서버로 보낸다. 우리는 스택
//                         프레임에서 이미 context_line을 지우고 있어(§5.4) 일관성이 맞다.
//                         디버깅은 filename+lineno로 레포에서 직접 찾는다.
//   telemetry           : Sentry Inc.로 빌드 통계가 나간다. 자체호스팅의 취지에 반한다.
//   release create/finalize : sentry.io API를 호출한다. GlitchTip 대상이라 무의미하고,
//                         네트워크 실패로 빌드가 흔들릴 이유가 없다.
//   widenClientFileUpload=false : 업로드 자체를 안 하므로 불필요.
export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  sourcemaps: { disable: true },
  release: { create: false, finalize: false },
  // 브라우저 이벤트를 콘솔 자기 오리진으로 우회시킨다(광고차단기 회피 + 8090 비노출).
  // 실제 route handler는 E3-8에서 만든다.
  tunnelRoute: "/monitoring",
});

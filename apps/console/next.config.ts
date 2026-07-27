import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.105", "*.excusa.uk"],
};

export default nextConfig;

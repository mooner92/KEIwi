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
};

export default nextConfig;

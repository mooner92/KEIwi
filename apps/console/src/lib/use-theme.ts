import { useSyncExternalStore } from "react";

// 테마의 단일 진실 = <html data-theme>(인라인 스크립트가 페인트 전 설정).
// DOM을 외부 스토어로 구독 → setState/effect 없이 SSR·하이드레이션 안전.
function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => obs.disconnect();
}
function getSnapshot(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
/**
 * 서버 스냅샷은 **호출부가 쿠키에서 읽어 주입**한다(`useTheme(initial)`).
 *
 * 왜 인자로 받나: 서버엔 DOM이 없어 테마를 모른다. 예전엔 무조건 `"light"`로 추측했고,
 * 그 추측이 Grafana iframe src에 실려 다크 사용자에게 임베드가 두 번 로드되거나
 * (하이드레이션이 늦으면) 라이트로 고정됐다.
 *
 * 그렇다고 iframe을 하이드레이션 뒤로 미루면 **임베드가 하이드레이션에 의존**하게 되는데,
 * 이 레포는 dev 모드 하이드레이션이 불안정하다고 `docs/testing.md`에 명시돼 있다
 * — 실제로 그 방식이 3106에서 "Grafana가 아예 안 뜨는" 회귀를 냈다(2026-08-04).
 * 잘못된 테마보다 **부재가 더 나쁜 실패**다.
 *
 * 정답은 서버가 **알 수 있는 값**을 쓰는 것이다: 토글이 `keiwi-theme` 쿠키를 기록하므로
 * (`theme-toggle.tsx`) 서버 컴포넌트가 `cookies()`로 읽어 넘기면 SSR HTML이 처음부터
 * 올바른 테마의 iframe을 담고, 하이드레이션은 **토글 반응만** 맡는다.
 */
function makeServerSnapshot(initial: "light" | "dark") {
  return () => initial;
}

/**
 * 현재 활성 테마("light"|"dark")를 반응형으로 반환(토글 시 자동 갱신).
 *
 * @param initial 서버 렌더 시 쓸 값 — 서버 컴포넌트가 `keiwi-theme` 쿠키에서 읽어 준다.
 *                생략하면 "light"(쿠키 없는 첫 방문 = 인라인 스크립트 기본값과 동일).
 */
export function useTheme(initial: "light" | "dark" = "light"): "light" | "dark" {
  return useSyncExternalStore(subscribe, getSnapshot, makeServerSnapshot(initial));
}

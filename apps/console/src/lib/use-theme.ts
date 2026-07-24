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
function getServerSnapshot(): "light" | "dark" {
  return "light";
}

/** 현재 활성 테마("light"|"dark")를 반응형으로 반환(토글 시 자동 갱신). */
export function useTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

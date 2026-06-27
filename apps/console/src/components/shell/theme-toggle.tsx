"use client";

import { useSyncExternalStore } from "react";

// 테마의 단일 진실 = <html data-theme>(인라인 스크립트가 페인트 전 설정).
// DOM을 외부 스토어로 구독 → setState/effect 없이 SSR·하이드레이션 안전 (layout.spec §5).
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

// 라이트/다크(선명한 화면) 토글 — data-theme + 쿠키 + localStorage 3중 기록 (layout.spec §5c).
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isDark = theme === "dark";

  function toggle() {
    const next = isDark ? "light" : "dark";
    const el = document.documentElement;
    el.dataset.theme = next; // MutationObserver → useSyncExternalStore 재렌더
    el.style.colorScheme = next;
    try {
      localStorage.setItem("keiwi-theme", next);
    } catch {
      /* localStorage 불가(프라이빗 모드 등) 시 무시 — 쿠키로 충분 */
    }
    document.cookie = `keiwi-theme=${next};path=/;max-age=31536000;samesite=lax`;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      title={isDark ? "라이트 모드" : "다크 모드"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-muted outline-none transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}

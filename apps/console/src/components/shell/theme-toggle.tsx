"use client";

import { useTheme } from "@/lib/use-theme";

// 라이트/다크(선명한 화면) 토글 — data-theme + 쿠키 + localStorage 3중 기록 (layout.spec §5c).
// 테마 상태는 useTheme(DOM data-theme 구독)에서 — Grafana 임베드와 동일 소스.
export function ThemeToggle() {
  const theme = useTheme();
  const isDark = theme === "dark";

  function toggle() {
    const next = isDark ? "light" : "dark";
    const el = document.documentElement;
    el.dataset.theme = next; // MutationObserver → useTheme 재렌더
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
      // 32px — 상단바 컨트롤 공통 높이이자 포인터 타깃 하한. 40px은 14px 본문 대비 과했다.
      // 포커스는 전역 더블링(:focus-visible)에 위임. hover는 색만 바뀐다(움직이지 않는다).
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted outline-none transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}

import { TopBar } from "./top-bar";
import { SideNav } from "./side-nav";
import { MobileNav } from "./mobile-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      {/* 스킵 링크는 화면 위에 "떠 있는" 요소라 그림자가 허용되는 예외 */}
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:border focus-visible:border-border focus-visible:bg-surface focus-visible:px-3 focus-visible:py-1.5 focus-visible:text-sm focus-visible:font-medium focus-visible:text-ink focus-visible:shadow-pop"
      >
        본문으로 건너뛰기
      </a>
      <TopBar />
      <MobileNav />
      <div className="flex min-h-0 flex-1">
        <SideNav />
        {/* 상단 여백은 조인다 — 세로는 임베드가 쓸 픽셀이고, 가로는 상단바 px와 맞춘다 */}
        <main
          id="main"
          tabIndex={-1}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-3 outline-none sm:px-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

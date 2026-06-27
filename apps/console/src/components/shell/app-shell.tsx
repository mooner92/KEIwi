import { IdentifierBanner } from "./identifier-banner";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-3 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-surface focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-ink focus-visible:shadow"
      >
        본문으로 건너뛰기
      </a>
      <IdentifierBanner />
      <TopBar />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full min-h-0 max-w-7xl flex-1 flex-col overflow-y-auto px-4 py-4 outline-none sm:px-6"
      >
        {children}
      </main>
    </div>
  );
}

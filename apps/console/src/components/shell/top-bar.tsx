import { BrandMark } from "./brand-mark";
import { Nav } from "./nav";
import { ThemeToggle } from "./theme-toggle";

export function TopBar() {
  return (
    <header className="border-b border-border bg-surface text-ink">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7 shrink-0" />
          <span className="font-display text-lg font-semibold tracking-tight">
            KEIwi
          </span>
          <span className="hidden border-l border-border pl-2.5 text-xs text-ink-muted sm:inline">
            관제 콘솔
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Nav />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

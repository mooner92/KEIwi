"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isActive } from "./nav-items";

// 모바일(<md) 가로 내비 — 사이드 레일을 숨기는 좁은 화면용 폴백.
// 사이드바와 같은 언어를 쓴다: 활성 = surface-2 면 + ink 굵기 + 초록 룰.
// 다만 룰의 방향만 가로바에 맞춰 좌측 → 하단(탭 언더라인)으로 눕힌다.
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="섹션 메뉴"
      className="flex gap-1 overflow-x-auto border-b border-border bg-chrome px-4 py-1 md:hidden"
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              "relative inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-surface-2 font-semibold text-ink"
                : "text-ink-muted hover:text-ink",
            ].join(" ")}
          >
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent-line"
              />
            )}
            <span>{item.label}</span>
            {item.soon && (
              <span className="rounded-sm border border-border px-1 text-2xs tracking-wide text-ink-subtle">
                {item.soon}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

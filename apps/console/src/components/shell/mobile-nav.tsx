"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isActive } from "./nav-items";

// 모바일(<md) 가로 내비 — 사이드 레일을 숨기는 좁은 화면용 폴백.
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="섹션 메뉴"
      className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-4 py-1.5 md:hidden"
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-sm",
              active
                ? "bg-surface-2 font-semibold text-brand"
                : "text-ink-muted",
            ].join(" ")}
          >
            <span>{item.label}</span>
            {item.soon && (
              <span className="text-[10px] tracking-wide text-ink-subtle">
                {item.soon}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

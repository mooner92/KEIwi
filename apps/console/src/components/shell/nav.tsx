"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; soon?: string };

const ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview" },
  { href: "/logs", label: "Logs", soon: "M2" },
  { href: "/resources", label: "Resources", soon: "M3" },
  { href: "/incidents", label: "Incidents", soon: "M4" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="주요 메뉴" className="flex items-center gap-0.5 sm:gap-1">
      {ITEMS.map((item) => {
        const active =
          pathname === item.href ||
          (item.href === "/overview" && pathname === "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              "group inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-white/10 text-chrome-ink"
                : "text-chrome-muted hover:text-chrome-ink hover:bg-white/5",
            ].join(" ")}
          >
            <span>{item.label}</span>
            {item.soon && (
              <span className="rounded border border-white/15 px-1 text-[10px] font-medium tracking-wide text-chrome-muted">
                {item.soon}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

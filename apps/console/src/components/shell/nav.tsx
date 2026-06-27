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
            aria-label={
              item.soon
                ? `${item.label} — 준비 중, ${item.soon}에서 추가 예정`
                : undefined
            }
            className={[
              "group inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-surface-2 font-semibold text-brand"
                : "text-ink-muted hover:bg-surface-2 hover:text-ink",
            ].join(" ")}
          >
            <span>{item.label}</span>
            {item.soon && (
              <span className="rounded border border-border px-1 text-[10px] font-medium tracking-wide text-ink-subtle">
                {item.soon}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

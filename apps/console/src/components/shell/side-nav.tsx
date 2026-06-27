"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isActive } from "./nav-items";

// KRDS 사이드메뉴 — 좌측 풀하이트 세로 섹션 내비(md 이상). 자체 스크롤 분리로 콘텐츠 높이에 무영향.
export function SideNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="섹션 메뉴"
      className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex"
    >
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
          모니터링
        </p>
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={
                    item.soon
                      ? `${item.label} — 준비 중, ${item.soon}에서 추가 예정`
                      : undefined
                  }
                  className={[
                    "relative flex items-center justify-between rounded-md py-2 pl-3 pr-2 text-sm transition-colors",
                    active
                      ? "bg-surface-2 font-semibold text-brand"
                      : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                  ].join(" ")}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand"
                    />
                  )}
                  <span>{item.label}</span>
                  {item.soon && (
                    <span className="rounded border border-border px-1 text-[10px] font-medium tracking-wide text-ink-subtle">
                      {item.soon}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="border-t border-border px-4 py-3 text-[11px] leading-5 text-ink-subtle">
        <p className="tnum">환경 · data05</p>
        <p>KEIwi · M1</p>
      </div>
    </nav>
  );
}

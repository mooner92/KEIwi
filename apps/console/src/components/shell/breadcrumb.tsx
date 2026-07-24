"use client";

import { usePathname } from "next/navigation";
import { labelFor } from "./nav-items";

// KRDS 브레드크럼 — '홈 › 현재 섹션'. children은 우측 페이지 유틸/상태 슬롯.
export function Breadcrumb({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const label = labelFor(pathname);
  return (
    <div className="flex items-center justify-between gap-3">
      <nav aria-label="브레드크럼">
        <ol className="flex items-center gap-1.5 text-xs text-ink-muted">
          <li>홈</li>
          <li aria-hidden className="text-ink-subtle">
            ›
          </li>
          <li aria-current="page" className="font-medium text-ink">
            {label}
          </li>
        </ol>
      </nav>
      {children ? <div className="text-xs text-ink-muted">{children}</div> : null}
    </div>
  );
}

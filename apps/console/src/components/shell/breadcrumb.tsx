"use client";

import { usePathname } from "next/navigation";
import { labelFor } from "./nav-items";

// 브레드크럼 — '홈 › 현재 섹션'. children은 우측 페이지 유틸/상태 슬롯.
// 바로 아래 H1(20px)이 위치를 이미 말하므로 여기서 굵기·잉크를 쓰지 않는다.
// min-h로 행 높이를 고정 — children 유무에 따라 페이지마다 리듬이 흔들리지 않게.
export function Breadcrumb({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const label = labelFor(pathname);
  return (
    <div className="flex min-h-5 items-center justify-between gap-3 text-xs text-ink-subtle">
      <nav aria-label="브레드크럼">
        <ol className="flex items-center gap-1">
          <li>홈</li>
          <li aria-hidden className="text-ink-faint">
            ›
          </li>
          <li aria-current="page" className="text-ink-muted">
            {label}
          </li>
        </ol>
      </nav>
      {children ? <div className="text-ink-muted">{children}</div> : null}
    </div>
  );
}

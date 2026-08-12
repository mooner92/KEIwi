"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isActive } from "./nav-items";

// 좌측 풀하이트 세로 내비(md 이상). 자체 스크롤 분리로 콘텐츠 높이에 무영향.
// 192px — 항목 라벨이 짧아 그 이상은 빈 공간일 뿐이다. 크롬은 액자, 폭은 콘텐츠에 양보한다.
export function SideNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="섹션 메뉴"
      className="hidden w-48 shrink-0 flex-col border-r border-border bg-chrome md:flex"
    >
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <p className="px-2.5 pb-1 text-2xs font-medium tracking-wide text-ink-subtle">
          모니터링
        </p>
        <ul className="flex flex-col gap-px">
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
                    // 32px 행 — 상단바 컨트롤과 같은 눈금. hover는 색만 바뀐다.
                    "relative flex items-center justify-between gap-2 rounded-md py-1.5 pl-2.5 pr-2 text-sm transition-colors",
                    active
                      ? // 활성 표시는 좌측 초록 룰이 담당하고 텍스트는 ink로 둔다(초록 예산제).
                        "bg-surface-2 font-semibold text-ink"
                      : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                  ].join(" ")}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent-line"
                    />
                  )}
                  <span className="truncate">{item.label}</span>
                  {item.soon && (
                    <span className="shrink-0 rounded-sm border border-border px-1 text-2xs tracking-wide text-ink-subtle">
                      {item.soon}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-col gap-1 border-t border-border px-3 py-2.5 text-2xs leading-4 text-ink-subtle">
        {/* 링크는 초록이 아니라 밑줄로 알린다(초록 예산제) */}
        <Link
          href="/about"
          className="w-fit text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          소개
        </Link>
        <Link
          href="/changelog"
          className="w-fit text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          패치노트
        </Link>
        <Link
          href="/graph"
          className="w-fit text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          코드 그래프
        </Link>
        <div>
          <p className="tnum">환경 · data05</p>
          <p>KEIwi · M1</p>
        </div>
      </div>
    </nav>
  );
}

// 내비 항목 단일 소스 — side-nav·mobile-nav·breadcrumb가 공유(라벨/경로 중복 제거).
export type NavItem = { href: string; label: string; soon?: string };

export const NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview" },
  { href: "/logs", label: "Logs", soon: "M2" },
  { href: "/resources", label: "Resources", soon: "M3" },
  { href: "/incidents", label: "Incidents", soon: "M4" },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href === "/overview" && pathname === "/");
}

/** 현재 경로의 내비 라벨(브레드크럼용). 매칭 없으면 빈 문자열. */
export function labelFor(pathname: string): string {
  return NAV_ITEMS.find((i) => isActive(pathname, i.href))?.label ?? "";
}

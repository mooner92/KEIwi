// 내비 항목 단일 소스 — side-nav·mobile-nav·breadcrumb가 공유(라벨/경로 중복 제거).
export type NavItem = { href: string; label: string; soon?: string };

export const NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview" },
  { href: "/logs", label: "Logs" },
  { href: "/resources", label: "Resources", soon: "M3" },
  // "어시스턴트"(/incidents)는 내비에서 제거 — 어시스턴트는 통합 로그(/logs)로 일원화
  // (2026-07-04 사용자 지시). 라우트 자체는 워크벤치 "전체 화면에서 계속" 딥링크 대상으로 유지.
];

// 내비에는 없지만 breadcrumb 라벨이 필요한 라우트.
// /about(소개)은 사이드바 푸터에서 진입한다 — 주 내비는 관제 작업 흐름만 담는다.
const HIDDEN_ROUTES: NavItem[] = [
  { href: "/incidents", label: "어시스턴트" },
  { href: "/about", label: "소개" },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href === "/overview" && pathname === "/");
}

/** 현재 경로의 내비 라벨(브레드크럼용). 숨김 라우트(/incidents) 포함 — 매칭 없으면 빈 문자열. */
export function labelFor(pathname: string): string {
  return (
    [...NAV_ITEMS, ...HIDDEN_ROUTES].find((i) => isActive(pathname, i.href))?.label ?? ""
  );
}

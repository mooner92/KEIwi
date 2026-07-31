import { SearchField } from "./search-field";
import { ThemeToggle } from "./theme-toggle";

// 헤더 우측 유틸 클러스터 — KRDS 유틸리티 영역(통합검색 + 테마). 모바일은 테마만.
export function UtilBar() {
  return (
    <div className="flex items-center gap-1.5">
      <SearchField />
      <ThemeToggle />
    </div>
  );
}

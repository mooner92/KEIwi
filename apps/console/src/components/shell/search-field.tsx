// 통합검색 자리표시 — 백엔드 연결 전까지 비활성. 후속 검색 라우팅 지점.
// "준비 중"은 색이 아니라 낮춘 계조 + 문구로만 알린다(v3 §정상·비활성은 무채색).
export function SearchField() {
  return (
    <div className="relative hidden sm:block">
      <span
        aria-hidden
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3-3" strokeLinecap="round" />
        </svg>
      </span>
      <input
        type="search"
        disabled
        aria-disabled="true"
        aria-label="통합검색 (준비 중)"
        placeholder="통합검색 준비 중"
        // 32px — 상단바의 다른 컨트롤과 같은 높이. 포커스 링은 전역 :focus-visible에 위임.
        className="h-8 w-40 rounded-md border border-border bg-surface-2 pl-7 pr-2.5 text-sm text-ink-muted placeholder:text-ink-subtle disabled:cursor-not-allowed"
      />
    </div>
  );
}

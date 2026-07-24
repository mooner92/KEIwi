// KRDS SearchField(통합검색) 자리표시 — 백엔드 연결 전까지 비활성. 후속 검색 라우팅 지점.
export function SearchField() {
  return (
    <div className="relative hidden sm:block">
      <span
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
        className="h-10 w-44 rounded-md border border-border bg-surface-2 pl-8 pr-3 text-sm text-ink-muted placeholder:text-ink-subtle disabled:cursor-not-allowed"
      />
    </div>
  );
}

// 정부 공식 식별 배너 (KRDS 아이덴티티 — 모든 화면 상단 필수).
// 운영기관이 정부(KEI) 산하임을 표시. 카피는 기관 정책에 맞게 조정 가능.
export function IdentifierBanner() {
  return (
    <div className="border-b border-border bg-surface-2 text-ink-muted">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-1.5 px-4 py-1 text-xs sm:px-6">
        <span aria-hidden className="leading-none">🇰🇷</span>
        <span>이 누리집은 대한민국 공식 전자정부 누리집입니다.</span>
      </div>
    </div>
  );
}

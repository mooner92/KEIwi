// 콘텐츠 상단 페이지 헤더 — 가시 H1(위계). 선택적 설명·우측 액션 슬롯.
// H1 24px(text-xl) — 관제(NOC) 밀도 예외: 콘텐츠(임베드)가 화면 대부분을 차지하도록.
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

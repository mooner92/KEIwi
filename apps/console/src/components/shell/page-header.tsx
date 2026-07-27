// 콘텐츠 상단 페이지 헤더 — 가시 H1(위계). 선택적 설명·우측 액션 슬롯.
// H1은 20px(text-xl)에서 멈춘다: 화면 대부분은 Grafana 임베드의 몫이고 크롬은 액자다.
// 바깥 여백은 페이지가 정한다(여기선 마진 0) — 브레드크럼과의 간격이 한 곳에서만 결정되도록.
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
    <div className="flex min-h-8 items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

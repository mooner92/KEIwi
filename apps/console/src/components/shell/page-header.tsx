// 콘텐츠 상단 페이지 헤더 — 가시 H1(위계). 선택적 설명·우측 액션 슬롯.
// H1은 24px(text-2xl) — v3 스케일 상한. 페이지의 이름 하나는 또렷해야 하고(옵티컬 트래킹
// -0.021em이 함께 걸린다), 그 아래는 전부 임베드의 몫이므로 여기서 멈춘다.
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
        <h1 className="text-2xl font-semibold text-ink">
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

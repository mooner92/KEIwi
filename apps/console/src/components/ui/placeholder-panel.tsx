export function PlaceholderPanel({
  milestone,
  title,
  children,
}: {
  milestone: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface px-6 py-12 sm:px-10 sm:py-16">
      <div className="mx-auto max-w-xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-medium text-ink-muted">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-neutral-400" />
          {milestone}에서 추가 예정
        </span>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-muted">{children}</p>
      </div>
    </section>
  );
}

export function PlaceholderPanel({
  milestone,
  title,
  children,
}: {
  milestone: string;
  title: string;
  children: React.ReactNode;
}) {
  // 빈 상태는 사과하지도 자랑하지도 않는다 — 점선 테두리("아직 채워지지 않은 자리")와
  // 낮은 잉크 계조만으로 준비 중임을 알린다. 배지는 면·테두리를 걷고 캡션 한 줄로 남긴다.
  return (
    <section className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 sm:px-10 sm:py-16">
      <div className="mx-auto max-w-xl text-center">
        <span className="inline-flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-subtle">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ink-faint" />
          {milestone}에서 추가 예정
        </span>
        <h1 className="mt-3 text-lg font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-base leading-6 text-ink-subtle">{children}</p>
      </div>
    </section>
  );
}

import { getFleetStatus } from "@/lib/status";
import { FleetStrip } from "@/components/fleet/fleet-strip";
import { GrafanaEmbed } from "@/components/grafana/grafana-embed";

// 플릿 상태/대시보드는 요청 시점에 (정적 프리렌더 금지 — env/네트워크 의존)
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const nodes = await getFleetStatus();

  return (
    <div className="flex h-full flex-col gap-4">
      <h1 className="sr-only">플릿 Overview</h1>
      <FleetStrip nodes={nodes} />

      <section
        aria-label="메트릭 대시보드"
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base font-semibold tracking-tight text-ink">
            메트릭
          </h2>
          <p className="hidden text-xs text-ink-muted sm:block">
            시스템·GPU 메트릭은 Grafana 임베드 (콘솔은 재구현하지 않음)
          </p>
        </header>
        <div className="min-h-0 flex-1">
          <GrafanaEmbed />
        </div>
      </section>
    </div>
  );
}

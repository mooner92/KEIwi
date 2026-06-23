import { getFleetStatus } from "@/lib/status";
import { FleetStrip } from "@/components/fleet/fleet-strip";
import { GrafanaEmbed } from "@/components/grafana/grafana-embed";

// 플릿 상태/대시보드는 요청 시점에 (정적 프리렌더 금지 — env/네트워크 의존)
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const nodes = await getFleetStatus();

  return (
    <div className="space-y-8">
      <FleetStrip nodes={nodes} />

      <section aria-label="메트릭 대시보드">
        <header className="mb-3">
          <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
            메트릭
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            시스템·GPU 메트릭은 Grafana에서. 콘솔은 임베드만 합니다.
          </p>
        </header>
        <GrafanaEmbed />
      </section>
    </div>
  );
}

import Link from "next/link";
import { getFleetStatus } from "@/lib/status";
import { getFleetCapacity } from "@/lib/capacity";
import { FleetStrip } from "@/components/fleet/fleet-strip";
import { GrafanaEmbed } from "@/components/grafana/grafana-embed";
import { ServiceTable } from "@/components/service-map/service-table";
import { Breadcrumb } from "@/components/shell/breadcrumb";
import { PageHeader } from "@/components/shell/page-header";

// 플릿 상태/대시보드는 요청 시점에 (정적 프리렌더 금지 — env/네트워크 의존)
export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ node?: string }>;
}) {
  const [nodes, capacity, params] = await Promise.all([
    getFleetStatus(),
    getFleetCapacity(),
    searchParams,
  ]);

  // ?node=<id> → 데이터 있는 노드만 유효한 선택으로 인정. 그 노드의 node-exporter
  // instance(ip:9100)를 Grafana 시스템 임베드에 var-instance로 주입한다.
  const selectedNode = params.node
    ? nodes.find(
        (n) =>
          n.id === params.node && n.nodeInstance && n.status !== "no-data",
      )
    : undefined;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-col gap-1">
        <Breadcrumb />
        <PageHeader title="플릿 Overview" />
      </div>
      <FleetStrip
        nodes={nodes}
        capacity={capacity}
        selectedNodeId={selectedNode?.id}
      />

      <section
        aria-label="메트릭 대시보드"
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base font-semibold tracking-tight text-ink">
            메트릭
          </h2>
          {selectedNode ? (
            <p className="text-xs text-ink-muted">
              <span className="tnum font-medium text-ink">
                {selectedNode.id}
              </span>{" "}
              노드 메트릭 ·{" "}
              <Link
                href="/overview"
                className="text-info-700 underline underline-offset-2"
              >
                전체 보기
              </Link>
            </p>
          ) : (
            <p className="hidden text-xs text-ink-muted sm:block">
              노드 카드를 누르면 해당 노드 메트릭으로 이동 · Grafana 임베드
            </p>
          )}
        </header>
        <div className="min-h-0 flex-1">
          <GrafanaEmbed
            selectedInstance={selectedNode?.nodeInstance}
            selectedNodeName={selectedNode?.nodeName}
            selectedDcgm={selectedNode?.nodeDcgm}
            servicePanel={<ServiceTable node={selectedNode?.id} />}
          />
        </div>
      </section>
    </div>
  );
}

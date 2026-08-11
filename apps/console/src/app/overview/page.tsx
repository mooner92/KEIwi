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
  searchParams: Promise<{ node?: string; tab?: string }>;
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

  // 콘텐츠 우선(관제 밀도): 상단 = 얇은 노드 스트립, 아래 = Grafana 임베드가 화면 대부분.
  // 섹션 헤더행("플릿 상태"/"메트릭")은 제거 — 요약·추천·선택 안내는 FleetStrip 툴바가 흡수.
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
        selectedNode={selectedNode ?? undefined}
        activeTab={params.tab}
      />

      <section
        aria-label="메트릭 대시보드"
        className="flex min-h-0 flex-1 flex-col"
      >
        <GrafanaEmbed
          selectedInstance={selectedNode?.nodeInstance}
          selectedNodeName={selectedNode?.nodeName}
          selectedDcgm={selectedNode?.nodeDcgm}
          servicePanel={<ServiceTable node={selectedNode?.id} />}
          activeTab={params.tab}
        />
      </section>
    </div>
  );
}

import type { FleetNodeStatus, NodeStatus, NodeCapacity } from "@/types/fleet";
import { recommendGpuPlacement } from "@/lib/capacity";
import { NodeCard } from "./node-card";
import { PlacementHint } from "./placement-hint";

function count(nodes: FleetNodeStatus[], status: NodeStatus): number {
  return nodes.filter((n) => n.status === status).length;
}

/**
 * 플릿 한눈 상태 — 콘솔의 시그니처 뷰 (US1). 데이터 있는 노드는 클릭→메트릭 드릴다운.
 * capacity가 주어지면 노드별 여유 배지 + GPU 배치 추천(M3, ADR-0012/0013)을 함께 보인다.
 */
export function FleetStrip({
  nodes,
  capacity,
  selectedNodeId,
}: {
  nodes: FleetNodeStatus[];
  capacity?: NodeCapacity[];
  selectedNodeId?: string;
}) {
  const up = count(nodes, "up");
  const down = count(nodes, "down");
  const noData = count(nodes, "no-data");

  const capById = new Map((capacity ?? []).map((c) => [c.id, c]));
  const rec = capacity ? recommendGpuPlacement(capacity) : null;

  return (
    <section aria-label="플릿 상태">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
          플릿 상태
        </h2>
        <p className="text-xs text-ink-muted">
          <span className="tnum text-success-700">{up}</span> 정상
          <span className="px-1.5 text-ink-subtle">·</span>
          <span className="tnum text-danger-700">{down}</span> 다운
          <span className="px-1.5 text-ink-subtle">·</span>
          <span className="tnum">{noData}</span> 데이터 없음
        </p>
      </header>
      {capacity ? (
        <div className="mb-3">
          <PlacementHint rec={rec} />
        </div>
      ) : null}
      {nodes.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
          inventory에 노드가 없습니다. <span className="tnum">docs/inventory.yaml</span>을 확인하세요.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {nodes.map((node) => {
            // 드릴다운 가능: node-exporter 엔드포인트가 있고 데이터가 실제로 들어오는 노드.
            const drillable =
              Boolean(node.nodeInstance) && node.status !== "no-data";
            const selected = drillable && node.id === selectedNodeId;
            const href = drillable
              ? selected
                ? "/overview" // 선택된 카드 재클릭 → 전체(선택 해제)
                : `/overview?node=${encodeURIComponent(node.id)}`
              : undefined;
            return (
              <NodeCard
                key={node.id}
                node={node}
                capacity={capById.get(node.id)}
                href={href}
                selected={selected}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

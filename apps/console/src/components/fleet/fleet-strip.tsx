import type { FleetNodeStatus, NodeStatus } from "@/types/fleet";
import { NodeCard } from "./node-card";

function count(nodes: FleetNodeStatus[], status: NodeStatus): number {
  return nodes.filter((n) => n.status === status).length;
}

/** 플릿 한눈 상태 — 콘솔의 시그니처 뷰 (US1). */
export function FleetStrip({ nodes }: { nodes: FleetNodeStatus[] }) {
  const up = count(nodes, "up");
  const down = count(nodes, "down");
  const noData = count(nodes, "no-data");

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
      {nodes.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
          inventory에 노드가 없습니다. <span className="tnum">docs/inventory.yaml</span>을 확인하세요.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {nodes.map((node) => (
            <NodeCard key={node.id} node={node} />
          ))}
        </div>
      )}
    </section>
  );
}

import type { FleetNodeStatus, NodeStatus } from "@/types/fleet";
import { StatusIndicator } from "@/components/ui/status-indicator";

// 좌측 상태 액센트 바 — 시맨틱 토큰만.
const ACCENT: Record<NodeStatus, string> = {
  up: "bg-success-500",
  down: "bg-danger-500",
  "no-data": "bg-neutral-300",
};

export function NodeCard({ node }: { node: FleetNodeStatus }) {
  return (
    <article className="relative overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-border-strong">
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1 ${ACCENT[node.status]}`}
      />
      <div className="p-4 pl-5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-base font-semibold tracking-tight text-ink">
            {node.id}
          </h3>
          <span className="text-[11px] uppercase tracking-wide text-ink-subtle">
            {node.role}
          </span>
        </div>
        <p className="tnum mt-0.5 text-sm text-ink-muted">{node.ip}</p>
        <div className="mt-3 flex items-center justify-between">
          <StatusIndicator status={node.status} />
          <span className="text-[11px] uppercase tracking-wide text-ink-subtle">
            {node.os}
          </span>
        </div>
      </div>
    </article>
  );
}

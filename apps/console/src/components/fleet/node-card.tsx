import Link from "next/link";
import type { FleetNodeStatus, NodeStatus } from "@/types/fleet";
import { StatusIndicator } from "@/components/ui/status-indicator";

// 좌측 상태 액센트 바 — 시맨틱 토큰만.
const ACCENT: Record<NodeStatus, string> = {
  up: "bg-success-500",
  down: "bg-danger-500",
  "no-data": "bg-neutral-300",
};

/**
 * 플릿 노드 카드. `href`가 있으면 클릭 가능한 링크(해당 노드 메트릭으로 드릴다운),
 * 없으면 정적 카드(예: 데이터 없음 / node-exporter 없는 windows 노드).
 */
export function NodeCard({
  node,
  href,
  selected = false,
}: {
  node: FleetNodeStatus;
  href?: string;
  selected?: boolean;
}) {
  const body = (
    <>
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1 ${ACCENT[node.status]}`}
      />
      <div className="p-4 pl-5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-base font-semibold tracking-tight text-ink">
            {node.id}
          </h3>
          <span className="text-[11px] uppercase tracking-wide text-ink-muted">
            {node.role}
          </span>
        </div>
        <p className="tnum mt-0.5 text-sm text-ink-muted">{node.ip}</p>
        <div className="mt-3 flex items-center justify-between">
          <StatusIndicator status={node.status} />
          <span className="text-[11px] uppercase tracking-wide text-ink-muted">
            {node.os}
          </span>
        </div>
      </div>
    </>
  );

  const base = "relative block overflow-hidden rounded-lg border bg-surface";

  if (!href) {
    return <article className={`${base} border-border`}>{body}</article>;
  }

  return (
    <Link
      href={href}
      aria-label={`${node.id} 메트릭 보기`}
      aria-current={selected ? "true" : undefined}
      className={[
        base,
        "outline-none transition-colors hover:border-border-strong",
        "focus-visible:ring-2 focus-visible:ring-info-700",
        selected
          ? "border-info-700 ring-1 ring-info-700"
          : "border-border",
      ].join(" ")}
    >
      {body}
    </Link>
  );
}

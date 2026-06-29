import Link from "next/link";
import type { FleetNodeStatus, NodeStatus, NodeCapacity } from "@/types/fleet";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { CapacityBadge } from "@/components/ui/capacity-badge";

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
  capacity,
  href,
  selected = false,
}: {
  node: FleetNodeStatus;
  capacity?: NodeCapacity;
  href?: string;
  selected?: boolean;
}) {
  const gpu = capacity?.gpu ?? null;
  const general = capacity?.general;
  const body = (
    <>
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1 ${ACCENT[node.status]}`}
      />
      <div className="p-2.5 pl-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-sm font-semibold tracking-tight text-ink">
            {node.id}
          </h3>
          <span className="tnum text-[11px] text-ink-subtle">{node.ip}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <StatusIndicator status={node.status} />
          <span className="text-[10px] uppercase tracking-wide text-ink-muted">
            {node.os}
          </span>
        </div>
        {capacity ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {gpu ? (
              <CapacityBadge
                axis="GPU"
                verdict={gpu.verdict}
                detail={
                  gpu.verdict === "unknown"
                    ? undefined
                    : `VRAM ${Math.round(gpu.bestVramFreePct)}%`
                }
                title={
                  gpu.verdict === "unknown"
                    ? "GPU 메트릭 없음"
                    : `가장 여유한 GPU 기준 · util ${Math.round(gpu.bestUtilPct)}% · GPU ${gpu.gpuCount}장`
                }
              />
            ) : null}
            {general ? (
              <CapacityBadge
                axis="일반"
                verdict={general.verdict}
                title={
                  general.verdict === "unknown"
                    ? "CPU/메모리 메트릭 없음"
                    : `CPU ${Math.round(general.cpuBusyPct ?? 0)}% 사용 · 메모리 ${Math.round(general.memAvailPct ?? 0)}% 가용`
                }
              />
            ) : null}
          </div>
        ) : null}
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

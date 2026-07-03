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
      {/* 초콤팩트 밀도(콘텐츠 우선 — 임베드가 주인공): 이름+상태 1행 + 배지 1행(~56px).
          ip·os는 텍스트 행 대신 카드 title 툴팁으로(정보 보존). */}
      <div className="px-2.5 py-1.5 pl-3" title={`${node.ip} · ${node.os}`}>
        <div className="flex items-center justify-between gap-1.5">
          <h3 className="truncate font-display text-sm font-semibold text-ink">
            {node.id}
          </h3>
          <StatusIndicator status={node.status} compact />
        </div>
        {capacity ? (
          <div className="mt-1 flex flex-wrap gap-1">
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

  // 카드 반경 = 10px(rounded-lg) — specs/design/03 공통 반경 규격
  const base = "relative block overflow-hidden rounded-lg border bg-surface shadow-1";

  if (!href) {
    return <article className={`${base} border-border`}>{body}</article>;
  }

  return (
    <Link
      href={href}
      aria-label={`${node.id} (${node.ip}) 메트릭 보기`}
      aria-current={selected ? "true" : undefined}
      className={[
        base,
        // 호버 시 살짝 떠오르는 입체감(Toss/당근형 폴리시) — reduced-motion은 globals.css가 무력화
        "outline-none transition-all duration-150 hover:border-border-strong hover:shadow-2 hover:-translate-y-0.5",
        // 포커스는 globals.css :focus-visible 더블링(브랜드)이 담당. 선택 상태는 브랜드 링/보더.
        selected
          ? "border-brand ring-1 ring-brand"
          : "border-border",
      ].join(" ")}
    >
      {body}
    </Link>
  );
}

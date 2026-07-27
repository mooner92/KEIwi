import Link from "next/link";
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
 * 슬림 툴바 1줄(관제 밀도): 요약·추천·선택 노드 안내를 흡수 — 헤더행 대신
 * aria-label이 섹션 시맨틱을 유지한다.
 */
export function FleetStrip({
  nodes,
  capacity,
  selectedNodeId,
  selectedNode,
}: {
  nodes: FleetNodeStatus[];
  capacity?: NodeCapacity[];
  selectedNodeId?: string;
  /** 드릴다운 중인 노드 — 툴바 우측 "노드 메트릭 · 전체 보기" 안내(기능 보존). */
  selectedNode?: FleetNodeStatus;
}) {
  const up = count(nodes, "up");
  const down = count(nodes, "down");
  const noData = count(nodes, "no-data");

  const capById = new Map((capacity ?? []).map((c) => [c.id, c]));
  const rec = capacity ? recommendGpuPlacement(capacity) : null;

  return (
    <section aria-label="플릿 상태" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span className="font-medium text-ink">플릿</span>
        <span>
          {/* 0은 문제가 아니다 — 건수가 0이면 유채색을 쓰지 않는다(유채색은 실재하는 문제에만). */}
          <span className="tnum text-ink-muted">{up}</span> 정상
          <span className="px-1 text-ink-subtle">·</span>
          <span className={`tnum ${down > 0 ? "font-medium text-danger-ink" : "text-ink-muted"}`}>
            {down}
          </span>{" "}
          다운
          <span className="px-1 text-ink-subtle">·</span>
          <span className="tnum">{noData}</span> 없음
        </span>
        {capacity ? <PlacementHint rec={rec} /> : null}
        <span className="ml-auto">
          {selectedNode ? (
            <>
              <span className="tnum font-medium text-ink">{selectedNode.id}</span>{" "}
              노드 메트릭 ·{" "}
              <Link
                href="/overview"
                className="text-ink-muted underline underline-offset-2"
              >
                전체 보기
              </Link>
            </>
          ) : null}
        </span>
      </div>
      {nodes.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted shadow-1">
          inventory에 노드가 없습니다. <span className="tnum">docs/inventory.yaml</span>을 확인하세요.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
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

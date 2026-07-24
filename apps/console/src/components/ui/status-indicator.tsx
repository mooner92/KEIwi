import type { NodeStatus } from "@/types/fleet";

// 상태색은 시맨틱 토큰을 통해서만 (헌장 §17). up→success / down→danger / no-data→neutral.
const MAP: Record<NodeStatus, { dot: string; text: string; label: string }> = {
  up: { dot: "bg-success-500", text: "text-success-700", label: "정상" },
  down: { dot: "bg-danger-500", text: "text-danger-700", label: "다운" },
  "no-data": { dot: "bg-neutral-400", text: "text-ink-muted", label: "데이터 없음" },
};

export function StatusIndicator({
  status,
  className,
  compact = false,
}: {
  status: NodeStatus;
  className?: string;
  /** 콤팩트 변형(노드 카드 등 고밀도 자리) — dot 8px·라벨 11px. 색+단어 병기는 동일. */
  compact?: boolean;
}) {
  const s = MAP[status];
  return (
    <span
      className={`inline-flex items-center ${compact ? "gap-1.5" : "gap-2"} ${className ?? ""}`}
    >
      <span
        aria-hidden
        className={`${compact ? "h-2 w-2" : "h-2.5 w-2.5"} rounded-full ${s.dot}`}
      />
      <span className={`${compact ? "text-[11px]" : "text-xs"} font-medium ${s.text}`}>
        {s.label}
      </span>
    </span>
  );
}

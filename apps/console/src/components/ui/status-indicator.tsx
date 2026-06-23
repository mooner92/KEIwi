import type { NodeStatus } from "@/types/fleet";

// 상태색은 시맨틱 토큰을 통해서만 (헌장 §17). up→success / down→danger / no-data→neutral.
const MAP: Record<
  NodeStatus,
  { dot: string; text: string; label: string; live: boolean }
> = {
  up: { dot: "bg-success-500", text: "text-success-700", label: "정상", live: true },
  down: { dot: "bg-danger-500", text: "text-danger-700", label: "다운", live: false },
  "no-data": {
    dot: "bg-neutral-400",
    text: "text-ink-muted",
    label: "데이터 없음",
    live: false,
  },
};

export function StatusIndicator({
  status,
  className,
}: {
  status: NodeStatus;
  className?: string;
}) {
  const s = MAP[status];
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <span
        aria-hidden
        className={`h-2.5 w-2.5 rounded-full ${s.dot} ${s.live ? "status-live" : ""}`}
      />
      <span className={`text-xs font-medium ${s.text}`}>{s.label}</span>
    </span>
  );
}

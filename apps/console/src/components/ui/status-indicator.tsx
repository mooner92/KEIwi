import type { NodeStatus } from "@/types/fleet";

/**
 * 노드 상태 표시 — 색·형태·단어 3중 부호화.
 *
 * v3(Quiet Console): "정상"은 무채색이다 — 유채색은 문제에만 쓴다.
 * 그러면 정상(무채색)과 수집없음(무채색)이 색으로는 구분되지 않으므로 **형태로 가른다**:
 *   정상   ● 채운 원   (ink-faint)
 *   다운   ● 채운 원   (danger — 유일한 유채색)
 *   수집없음 ○ 빈 원(1.5px 링) — "속이 비었다 = 데이터가 없다"는 직관적 은유
 * 여기에 단어가 항상 병기되어 색각 이상·흑백 인쇄에서도 판별된다(spec US4: no-data를
 * down으로 오인 금지 + 정상과도 구분).
 */
const MAP: Record<
  NodeStatus,
  { dot: string; text: string; label: string; hollow: boolean }
> = {
  up: { dot: "bg-ink-faint", text: "text-ink-muted", label: "정상", hollow: false },
  down: { dot: "bg-danger", text: "text-danger-ink", label: "다운", hollow: false },
  "no-data": {
    dot: "border-[1.5px] border-ink-faint",
    text: "text-ink-subtle",
    label: "수집 없음",
    hollow: true,
  },
};

export function StatusIndicator({
  status,
  className,
  compact = false,
}: {
  status: NodeStatus;
  className?: string;
  /** 콤팩트 변형(노드 카드 등 고밀도 자리) — dot 8px·라벨 11px. 색+형태+단어 병기는 동일. */
  compact?: boolean;
}) {
  const s = MAP[status];
  return (
    <span
      className={`inline-flex items-center ${compact ? "gap-1.5" : "gap-2"} ${className ?? ""}`}
    >
      <span
        aria-hidden
        className={`${compact ? "h-2 w-2" : "h-2.5 w-2.5"} shrink-0 rounded-full ${s.dot}`}
      />
      <span className={`${compact ? "text-2xs" : "text-xs"} font-medium ${s.text}`}>
        {s.label}
      </span>
    </span>
  );
}

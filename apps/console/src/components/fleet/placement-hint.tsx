import { DEFAULT_CAPACITY_POLICY } from "@/config/capacity-policy";

type Rec = { nodeId: string; vramFreePct: number } | null;

/**
 * GPU 작업 배치 추천 한 줄 (spec UR2). 여유 GPU 없으면 거짓 추천 대신 "없음"(US4).
 * 판정 기준(임계)을 함께 노출(UR4).
 */
export function PlacementHint({ rec }: { rec: Rec }) {
  const p = DEFAULT_CAPACITY_POLICY;
  const basis = `기준: VRAM≥${p.gpuVramFreePct}% · util≤${p.gpuUtilBusyPct}%`;

  if (!rec) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
        <span aria-hidden className="h-2 w-2 rounded-full bg-neutral-400" />
        <span className="text-ink-muted">
          지금 <span className="font-medium text-ink">여유 GPU 없음</span> — 전체 바쁨/가득
        </span>
        <span className="ml-auto text-[11px] text-ink-subtle">{basis}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-success-100 bg-success-50 px-3 py-2 text-sm">
      <span aria-hidden className="h-2 w-2 rounded-full bg-success-500" />
      <span className="text-ink">
        GPU 작업 추천:{" "}
        <span className="font-semibold text-success-700">{rec.nodeId}</span>{" "}
        <span className="tnum text-ink-muted">
          (VRAM {Math.round(rec.vramFreePct)}% 여유)
        </span>
      </span>
      <span className="ml-auto text-[11px] text-ink-subtle">{basis}</span>
    </div>
  );
}

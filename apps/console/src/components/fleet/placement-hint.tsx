import { DEFAULT_CAPACITY_POLICY } from "@/config/capacity-policy";

type Rec = { nodeId: string; vramFreePct: number } | null;

/**
 * GPU 작업 배치 추천 한 줄 (spec UR2). 여유 GPU 없으면 거짓 추천 대신 "없음"(US4).
 * 슬림 인라인(관제 밀도) — 배너 대신 점+텍스트 한 줄. 판정 기준(임계, UR4)은 title 툴팁으로 보존.
 */
export function PlacementHint({ rec }: { rec: Rec }) {
  const p = DEFAULT_CAPACITY_POLICY;
  const basis = `기준: VRAM≥${p.gpuVramFreePct}% · util≤${p.gpuUtilBusyPct}%`;

  if (!rec) {
    return (
      <span
        title={basis}
        className="inline-flex items-center gap-1.5 text-xs text-ink-muted"
      >
        <span aria-hidden className="h-2 w-2 rounded-full bg-ink-faint" />
        <span>
          지금 <span className="font-medium text-ink">여유 GPU 없음</span> — 전체 바쁨/가득
        </span>
      </span>
    );
  }

  return (
    // 추천은 "문제"가 아니다 — 유채색을 쓰지 않고, 눈이 가야 할 노드명만 잉크 한 단으로 세운다.
    <span title={basis} className="inline-flex items-center gap-1.5 text-xs">
      <span aria-hidden className="h-2 w-2 rounded-full bg-ink-faint" />
      <span className="text-ink-muted">
        GPU 추천: <span className="tnum font-medium text-ink">{rec.nodeId}</span>{" "}
        <span className="tnum text-ink-subtle">(VRAM {Math.round(rec.vramFreePct)}% 여유)</span>
      </span>
    </span>
  );
}

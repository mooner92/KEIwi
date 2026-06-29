import type { Verdict } from "@/types/fleet";

// 여유 등급 → 시맨틱 색 + 텍스트 (색 단독 금지 — 단어로도 구분. 헌장 §17 / spec UR5).
// free=success / busy=warning / full=danger / unknown=neutral("판정불가").
const MAP: Record<Verdict, { bg: string; text: string; label: string }> = {
  free: { bg: "bg-success-50", text: "text-success-700", label: "여유" },
  busy: { bg: "bg-warning-50", text: "text-warning-700", label: "바쁨" },
  full: { bg: "bg-danger-50", text: "text-danger-700", label: "가득" },
  unknown: { bg: "bg-neutral-100", text: "text-ink-muted", label: "판정불가" },
};

/**
 * 여유 등급 배지. axis(예 "GPU"/"일반") + 등급 + 선택 detail(예 "VRAM 78%").
 * unknown은 "여유"로 오인되지 않게 중립색 + "판정불가" 텍스트(US4 정직성).
 */
export function CapacityBadge({
  axis,
  verdict,
  detail,
  title,
}: {
  axis: string;
  verdict: Verdict;
  detail?: string;
  title?: string;
}) {
  const v = MAP[verdict];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${v.bg} ${v.text}`}
    >
      <span className="opacity-70">{axis}</span>
      <span>{v.label}</span>
      {detail ? <span className="tnum opacity-80">{detail}</span> : null}
    </span>
  );
}

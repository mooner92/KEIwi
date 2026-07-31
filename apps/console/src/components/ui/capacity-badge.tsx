import type { Verdict } from "@/types/fleet";

/**
 * 여유 등급 배지 — 색·형태·단어 3중 부호화.
 *
 * v3(Quiet Console): 유채색은 "문제"에만. 여유(free)는 좋은 소식이므로 **무채색**이다.
 * 그러면 여유(무채색)와 판정불가(무채색)가 색으로 구분되지 않으므로 **테두리로 가른다**:
 *   여유     채운 면(surface-2)          — 값이 있다
 *   바쁨     warn (경고색)
 *   가득     danger (문제색)
 *   판정불가 점선 테두리 + 투명 배경      — "비어 있다 = 알 수 없다"
 * unknown이 "여유"로 오인되면 US4(정직성) 위반이라 형태 차이를 반드시 유지할 것.
 *
 * 11px 하한(text-2xs): 10px에서는 한글 "판정불가"의 자소가 뭉갠다.
 */
const MAP: Record<Verdict, { box: string; text: string; label: string }> = {
  free: { box: "bg-surface-2", text: "text-ink-muted", label: "여유" },
  busy: { box: "bg-warn-bg border border-warn-border", text: "text-warn-ink", label: "바쁨" },
  full: { box: "bg-danger-bg border border-danger-border", text: "text-danger-ink", label: "가득" },
  unknown: {
    box: "border border-dashed border-border-strong",
    text: "text-ink-subtle",
    label: "판정불가",
  },
};

/**
 * axis(예 "GPU"/"일반") + 등급 + 선택 detail(예 "36/48 GiB").
 * 반경 4px(rounded-sm) = 비인터랙티브 상태 표시 규격.
 */
export function CapacityBadge({
  axis,
  verdict,
  detail,
  title,
  hideVerdictLabel = false,
}: {
  axis: string;
  verdict: Verdict;
  detail?: string;
  title?: string;
  /** true면 등급 단어(바쁨 등) 생략 — 대신 detail 수치로 표현(수치=텍스트라 색단독 아님). */
  hideVerdictLabel?: boolean;
}) {
  const v = MAP[verdict];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-2xs font-medium ${v.box} ${v.text}`}
    >
      <span className="text-ink-subtle">{axis}</span>
      {hideVerdictLabel ? null : <span>{v.label}</span>}
      {detail ? <span className="tnum">{detail}</span> : null}
    </span>
  );
}

import Link from "next/link";
import type { FleetNodeStatus, NodeStatus, NodeCapacity } from "@/types/fleet";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { CapacityBadge } from "@/components/ui/capacity-badge";
import { DEFAULT_CAPACITY_POLICY } from "@/config/capacity-policy";

// 좌측 상태 바 — "문제인 카드"만 표식을 갖는다(v3 §1: 정상에는 표식조차 낭비다).
// 정상은 투명 바로 자리만 차지해 카드마다 좌측 들여쓰기가 흔들리지 않게 한다.
const ACCENT: Record<NodeStatus, string> = {
  up: "bg-transparent",
  down: "bg-danger",
  "no-data": "bg-border-strong",
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
  // GPU 배지: 절대 수치(예 "36/48 GiB")를 우선 — 없으면 가용 VRAM% 폴백.
  const GIB = 1024 ** 3;
  const hasVram = gpu?.vramTotalBytes !== undefined && gpu.vramTotalBytes > 0;
  const gpuDetail =
    gpu && gpu.verdict !== "unknown"
      ? hasVram
        ? `${Math.round((gpu.vramUsedBytes ?? 0) / GIB)}/${Math.round((gpu.vramTotalBytes ?? 0) / GIB)} GiB`
        : `VRAM ${Math.round(gpu.bestVramFreePct)}%`
      : undefined;
  // 일반(CPU·메모리) 배지도 GPU와 같은 문법으로 — **판정 근거 수치**를 보여준다.
  // 예전엔 GPU는 수치만("1/48 GiB"), 일반은 단어만("바쁨")이라 두 칩이 한 문장처럼 읽혀
  // "GPU 1GiB인데 바쁨?"이라는 오독을 만들었다[2026-08-04 사용자 리포트 — 실제로 data03은
  // GPU가 아니라 CPU 51%(임계 50 초과)로 busy였다]. 판정을 만든 축의 수치를 직접 보여주면
  // 칩이 자기 설명이 된다: 바쁨의 이유가 CPU면 "CPU 51%", 메모리면 "멤 가용 12%".
  const generalDetail = (() => {
    if (!general || general.verdict === "unknown") return undefined;
    const cpu = Math.round(general.cpuBusyPct ?? 0);
    const mem = Math.round(general.memAvailPct ?? 0);
    // free가 아닐 때: 원인이 된 축을 우선 표기(정책 임계와 동일한 순서 — capacity.ts judgeGeneral).
    if (general.verdict !== "free" && (general.memAvailPct ?? 100) < DEFAULT_CAPACITY_POLICY.memAvailFreePct)
      return `멤 가용 ${mem}%`;
    return `CPU ${cpu}%`;
  })();
  const body = (
    <>
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1 ${ACCENT[node.status]}`}
      />
      {/* 초콤팩트 밀도(콘텐츠 우선 — 임베드가 주인공): 이름+상태 1행 + 배지 1행.
          ip·os는 텍스트 행 대신 카드 title 툴팁으로(정보 보존). */}
      <div className="px-2.5 py-1.5 pl-3" title={`${node.ip} · ${node.os}`}>
        <div className="flex items-baseline justify-between gap-1.5">
          {/* 노드명은 카드의 유일한 제목 — tnum이라 dataNN의 자리수가 카드마다 흔들리지 않는다 */}
          <h3 className="tnum truncate text-md font-semibold text-ink">
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
                detail={gpuDetail}
                hideVerdictLabel={gpu.verdict !== "unknown"}
                title={
                  gpu.verdict === "unknown"
                    ? "GPU 메트릭 없음"
                    : `${gpu.verdict === "free" ? "여유" : gpu.verdict === "busy" ? "바쁨" : "가득"} · 가용 VRAM ${Math.round(gpu.bestVramFreePct)}% · util ${Math.round(gpu.bestUtilPct)}% · GPU ${gpu.gpuCount}장`
                }
              />
            ) : null}
            {general ? (
              <CapacityBadge
                axis="일반"
                verdict={general.verdict}
                detail={generalDetail}
                hideVerdictLabel={general.verdict !== "unknown"}
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

  // 카드는 떠 있지 않다 — 그림자 0, 분리는 1px 보더 + 면 명도차로(v3 §깊이)
  const base = "relative block overflow-hidden rounded-lg border bg-surface";

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
        // 관제 화면에서 카드가 마우스를 따라 들썩이면 소음이다 — 움직임 없이 색만 바뀐다(v3 §4)
        "outline-none transition-colors duration-150 hover:bg-surface-2",
        // 포커스는 globals.css :focus-visible 더블링이 담당. 선택 = 1px 초록 보더뿐(초록 예산제).
        // 선택 카드에는 hover 보더를 걸지 않는다 — 호버가 초록 선택 표식을 덮으면 안 되므로.
        selected ? "border-accent-line" : "border-border hover:border-border-strong",
      ].join(" ")}
    >
      {body}
    </Link>
  );
}

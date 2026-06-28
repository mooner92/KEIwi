import type { FleetNodeStatus, Node, UpSeries } from "@/types/fleet";
import { loadInventory } from "@/lib/inventory";
import { queryUp } from "@/lib/prometheus";

/**
 * 순수 판정 로직 (단위 테스트 대상 — status.test.ts).
 * 노드의 exporters 엔드포인트(ip:port)를 up{instance}와 매칭:
 *  - 매칭 series 0개            → no-data (절대 down 아님 — US4)
 *  - 매칭 series 중 하나라도 0  → down
 *  - 매칭 series 모두 1         → up
 */
export function resolveFleetStatus(
  nodes: Node[],
  up: UpSeries[],
): FleetNodeStatus[] {
  // 동일 instance에 복수 series가 올 수 있으므로 값을 모두 모은다(0이 1로 덮어써지지 않게).
  const byInstance = new Map<string, number[]>();
  for (const s of up) {
    const arr = byInstance.get(s.instance);
    if (arr) arr.push(s.value);
    else byInstance.set(s.instance, [s.value]);
  }
  return nodes.map((node) => {
    const matched = Object.values(node.exporters).flatMap(
      (endpoint) => byInstance.get(endpoint) ?? [],
    );
    const status: FleetNodeStatus["status"] =
      matched.length === 0
        ? "no-data"
        : matched.some((v) => v === 0)
          ? "down"
          : "up";
    return {
      id: node.id,
      ip: node.ip,
      os: node.os,
      role: node.role,
      status,
      nodeInstance: node.exporters.node,
      nodeName: node.hostname,
    };
  });
}

/**
 * 오케스트레이터 (서버 전용): inventory 로드 + Prometheus 질의 + 판정.
 * Prometheus 미설정/불가 시 up=[]로 안전 귀결 → 전부 no-data (US4, 절대 down 아님).
 */
export async function getFleetStatus(): Promise<FleetNodeStatus[]> {
  const nodes = await loadInventory();
  let up: UpSeries[] = [];
  try {
    up = await queryUp();
  } catch {
    up = [];
  }
  return resolveFleetStatus(nodes, up);
}

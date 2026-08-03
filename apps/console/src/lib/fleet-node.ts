import type { Node } from "@/types/fleet";

/**
 * 알림 딥링크의 node 파라미터 정규화 (specs/alert-enrichment §2 D2-2).
 *
 * Grafana 규칙 템플릿은 `192.168.1.104:9100`(instance 라벨) 형태만 만들 수 있으므로
 * 콘솔이 노드 id로 흡수한다. 순수 함수 — inventory는 호출부(서버)가 loadInventory()로 공급.
 *
 * 수용: `data04`(id) | `192.168.1.104`(ip) | `192.168.1.104:9100`(ip:port).
 * 미지 입력은 undefined — 판단은 호출부가 한다(원문 폴백 등).
 */
export function normalizeFleetNode(
  input: string | undefined,
  nodes: Pick<Node, "id" | "ip">[],
): string | undefined {
  const raw = input?.trim();
  if (!raw) return undefined;
  // ip:port → ip (IPv4만 — 플릿 inventory가 IPv4 단일 표기)
  const host = raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : raw;
  return nodes.find((n) => n.id === host || n.ip === host)?.id;
}

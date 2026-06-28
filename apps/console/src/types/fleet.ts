import { z } from "zod";

export const OsSchema = z.enum(["ubuntu", "windows"]);
export const RoleSchema = z.enum(["target", "stack-host"]);
export const NodeStatusSchema = z.enum(["up", "down", "no-data"]);

/** inventory.yaml의 노드 한 건 ([[fleet inventory source of truth]]) */
export const NodeSchema = z.object({
  id: z.string().min(1),
  ip: z.string().min(1),
  hostname: z.string().optional(),
  os: OsSchema,
  role: RoleSchema,
  gpu: z.string().nullable().optional(),
  exporters: z.record(z.string(), z.string().min(1)),
});

export const InventorySchema = z.object({ nodes: z.array(NodeSchema) });

export type Os = z.infer<typeof OsSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type NodeStatus = z.infer<typeof NodeStatusSchema>;
export type Node = z.infer<typeof NodeSchema>;

/** Prometheus up{} 시계열 한 건 (instance = ip:port, value = 0|1) */
export type UpSeries = { instance: string; value: number };

/** 플릿 상태 API / strip가 쓰는 노드 단위 결과 */
export type FleetNodeStatus = {
  id: string;
  ip: string;
  os: Os;
  role: Role;
  status: NodeStatus;
  /**
   * node-exporter 엔드포인트(ip:9100) — 노드 드릴다운(Grafana var-instance) 대상.
   * node exporter가 없는 노드(예: windows)는 undefined → 드릴다운 불가.
   */
  nodeInstance?: string;
  /** OS hostname(node_uname_info nodename) — Grafana var-nodename 드릴다운용. inventory hostname. */
  nodeName?: string;
};

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
  /** DCGM exporter 엔드포인트(ip:9400) — GPU 탭 드릴다운(var-instance)용. inventory exporters.dcgm. */
  nodeDcgm?: string;
};

// ── M3 여유 리소스 (ADR-0013) ────────────────────────────────────────────────

/** 여유 등급. unknown = 데이터 없음/해당 없음(거짓 "여유" 금지 — US4). */
export type Verdict = "free" | "busy" | "full" | "unknown";

/** GPU축 판정. present=true(노드에 DCGM 있음). 데이터 없으면 verdict=unknown. */
export type GpuCapacity = {
  present: true;
  /** 가장 여유한 GPU의 가용 VRAM%(모델 들어갈 자리 — GPU 여유의 binding) */
  bestVramFreePct: number;
  /** 그 GPU의 util%(보조 신호) */
  bestUtilPct: number;
  gpuCount: number;
  verdict: Verdict;
};

/** 노드 단위 여유 판정 결과(순수 함수 산출). */
export type NodeCapacity = {
  id: string;
  /** 어느 축이든 실데이터가 있었나(없으면 전부 unknown) */
  hasData: boolean;
  general: { cpuBusyPct?: number; memAvailPct?: number; verdict: Verdict };
  /** null = GPU 없는 노드(해당 없음). present 객체 = GPU 노드(데이터 없으면 verdict unknown). */
  gpu: GpuCapacity | null;
};

/** Prometheus 원시 표본 — instance(ip:port) 기준 매칭(status.ts 패턴). value=숫자. */
export type MetricSample = { instance: string; value: number };
/** GPU 표본 — DCGM은 노드당 복수 GPU라 gpu 라벨로 같은 물리 GPU의 util↔VRAM을 짝짓는다. */
export type GpuSample = { instance: string; gpu: string; value: number };

/** queryCapacity() 산출 = resolveFleetCapacity() 입력(순수 분리 — 테스트 가능). */
export type CapacityRaw = {
  cpuBusy: MetricSample[]; // ip:9100
  memAvail: MetricSample[]; // ip:9100
  gpuUtil: GpuSample[]; // ip:9400 (per GPU)
  gpuVramFree: GpuSample[]; // ip:9400 (per GPU, 가용 VRAM%)
};

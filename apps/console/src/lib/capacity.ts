import type {
  Node,
  CapacityRaw,
  NodeCapacity,
  GpuCapacity,
  Verdict,
  GpuSample,
  NodeGpuSample,
} from "@/types/fleet";
import {
  DEFAULT_CAPACITY_POLICY,
  type CapacityPolicy,
} from "@/config/capacity-policy";
import { loadInventory } from "@/lib/inventory";
import { queryCapacity } from "@/lib/prometheus";

/**
 * 여유 판정 (순수 — capacity.test.ts 대상). ADR-0013.
 *  - 일반축(CPU+mem): 둘 다 있어야 판정, 하나라도 없으면 unknown(정직 — US4).
 *  - GPU축: DCGM 있는 노드만(없으면 gpu=null=해당 없음). binding = 가용 VRAM(util 보조).
 *  - 무데이터/실패 = unknown. 절대 거짓 "여유" 금지.
 */
export function resolveFleetCapacity(
  nodes: Node[],
  raw: CapacityRaw,
  policy: CapacityPolicy = DEFAULT_CAPACITY_POLICY,
): NodeCapacity[] {
  const cpu = new Map(raw.cpuBusy.map((s) => [s.instance, s.value]));
  const mem = new Map(raw.memAvail.map((s) => [s.instance, s.value]));
  const utilByInst = groupGpu(raw.gpuUtil);
  const vramByInst = groupGpu(raw.gpuVramFree);
  const usedByInst = groupGpu(raw.gpuVramUsedMib ?? []);
  const totalByInst = groupGpu(raw.gpuVramTotalMib ?? []);
  const MIB = 1024 * 1024;
  const sumMib = (m: Map<string, number> | undefined) =>
    m ? [...m.values()].reduce((a, b) => a + b, 0) * MIB : undefined;
  // gpu-model-exporter VRAM(bytes)은 node 라벨 → node.id로 매핑(DCGM 없는 GPU 폴백).
  const modelUsedByNode = groupNodeGpu(raw.gpuModelUsedBytes ?? []);
  const modelTotalByNode = groupNodeGpu(raw.gpuModelTotalBytes ?? []);

  return nodes.map((node) => {
    const nodeInst = node.exporters.node;
    const dcgmInst = node.exporters.dcgm;

    const cpuBusyPct = nodeInst ? cpu.get(nodeInst) : undefined;
    const memAvailPct = nodeInst ? mem.get(nodeInst) : undefined;
    const general = {
      cpuBusyPct,
      memAvailPct,
      verdict: judgeGeneral(cpuBusyPct, memAvailPct, policy),
    };

    let gpu: GpuCapacity | null = dcgmInst
      ? judgeGpu(utilByInst.get(dcgmInst), vramByInst.get(dcgmInst), policy)
      : null;
    // 노드 전체 GPU VRAM 절대 사용/총량(bytes) — 카드 "36/48 GiB" 표시용.
    if (gpu && dcgmInst) {
      const used = sumMib(usedByInst.get(dcgmInst));
      const total = sumMib(totalByInst.get(dcgmInst));
      if (used !== undefined && total !== undefined && total > 0) {
        gpu = { ...gpu, vramUsedBytes: used, vramTotalBytes: total, source: "dcgm" };
      }
    }
    // 폴백: DCGM이 없거나(예 data01 Tesla M4 드라이버 418) 데이터를 못 읽을 때,
    // gpu-model-exporter VRAM(bytes)로 배지를 채운다(util 미상 → VRAM만으로 판정).
    if (!gpu || gpu.verdict === "unknown") {
      const gpuFromModel = judgeGpuFromModelVram(
        modelUsedByNode.get(node.id),
        modelTotalByNode.get(node.id),
        policy,
      );
      if (gpuFromModel) gpu = gpuFromModel;
    }

    const hasData =
      cpuBusyPct !== undefined ||
      memAvailPct !== undefined ||
      (gpu !== null && gpu.verdict !== "unknown");

    return { id: node.id, hasData, general, gpu };
  });
}

/** instance → (gpu → value) */
function groupGpu(samples: GpuSample[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const s of samples) {
    let m = out.get(s.instance);
    if (!m) {
      m = new Map();
      out.set(s.instance, m);
    }
    m.set(s.gpu, s.value);
  }
  return out;
}

/** node → (gpu → value) — gpu-model-exporter(node 라벨)용. */
function groupNodeGpu(samples: NodeGpuSample[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const s of samples) {
    let m = out.get(s.node);
    if (!m) {
      m = new Map();
      out.set(s.node, m);
    }
    m.set(s.gpu, s.value);
  }
  return out;
}

/**
 * gpu-model-exporter VRAM(bytes)만으로 GPU 판정(폴백 — DCGM 없는 노드).
 * util 정보가 없으므로 VRAM 여유%로만 판정하고, source="gpu-model"로 표시(배지 전용,
 * 배치 추천에서는 제외 — bestUtilPct=0은 실측 아님). 데이터 없으면 null.
 */
function judgeGpuFromModelVram(
  used: Map<string, number> | undefined,
  total: Map<string, number> | undefined,
  p: CapacityPolicy,
): GpuCapacity | null {
  if (!total || total.size === 0) return null;
  let bestFreePct = -1;
  let usedSum = 0;
  let totalSum = 0;
  for (const [g, t] of total) {
    const u = used?.get(g) ?? 0;
    totalSum += t;
    usedSum += u;
    const freePct = t > 0 ? ((t - u) / t) * 100 : 0;
    if (freePct > bestFreePct) bestFreePct = freePct;
  }
  const verdict: Verdict =
    bestFreePct < p.gpuVramFullPct ? "full" : bestFreePct >= p.gpuVramFreePct ? "free" : "busy";
  return {
    present: true,
    bestVramFreePct: bestFreePct,
    bestUtilPct: 0,
    gpuCount: total.size,
    verdict,
    vramUsedBytes: usedSum,
    vramTotalBytes: totalSum,
    source: "gpu-model",
  };
}

function judgeGeneral(
  cpuBusyPct: number | undefined,
  memAvailPct: number | undefined,
  p: CapacityPolicy,
): Verdict {
  if (cpuBusyPct === undefined || memAvailPct === undefined) return "unknown";
  if (cpuBusyPct >= p.cpuBusyFullPct || memAvailPct < p.memAvailFullPct)
    return "full";
  if (cpuBusyPct <= p.cpuBusyFreePct && memAvailPct >= p.memAvailFreePct)
    return "free";
  return "busy";
}

/**
 * GPU축 판정. binding = 가장 여유한 GPU의 가용 VRAM%(모델 들어갈 자리), util 보조.
 * 데이터 없으면 verdict=unknown(present는 유지 — 노드엔 GPU가 있으나 지금 못 읽음).
 */
function judgeGpu(
  utils: Map<string, number> | undefined,
  vrams: Map<string, number> | undefined,
  p: CapacityPolicy,
): GpuCapacity {
  // VRAM 표본이 GPU 식별의 기준(가용 자리). 없으면 판정 불가.
  if (!vrams || vrams.size === 0) {
    return {
      present: true,
      bestVramFreePct: 0,
      bestUtilPct: 0,
      gpuCount: 0,
      verdict: "unknown",
    };
  }
  // 가장 여유한 GPU(max 가용 VRAM%)와 그 GPU의 util.
  let bestGpu = "";
  let bestVram = -1;
  for (const [g, v] of vrams) {
    if (v > bestVram) {
      bestVram = v;
      bestGpu = g;
    }
  }
  const bestUtil = utils?.get(bestGpu) ?? 0;
  const allUtilHigh =
    utils !== undefined &&
    utils.size > 0 &&
    [...utils.values()].every((u) => u >= p.gpuUtilFullPct);

  let verdict: Verdict;
  if (bestVram < p.gpuVramFullPct || allUtilHigh) verdict = "full";
  else if (bestVram >= p.gpuVramFreePct && bestUtil <= p.gpuUtilBusyPct)
    verdict = "free";
  else verdict = "busy";

  return {
    present: true,
    bestVramFreePct: bestVram,
    bestUtilPct: bestUtil,
    gpuCount: vrams.size,
    verdict,
  };
}

/**
 * GPU 작업 배치 추천 (순수). GPU free 노드 중 가용 VRAM 최대를 1순위로.
 * 없으면 null(= "여유 GPU 없음" — 거짓 추천 금지).
 */
export function recommendGpuPlacement(
  caps: NodeCapacity[],
): { nodeId: string; vramFreePct: number } | null {
  const free = caps
    // gpu-model 폴백(util 미상·소용량 M4 등)은 배치 추천에서 제외 — DCGM 실측 GPU만.
    .filter((c) => c.gpu?.verdict === "free" && c.gpu?.source !== "gpu-model")
    .sort((a, b) => (b.gpu?.bestVramFreePct ?? 0) - (a.gpu?.bestVramFreePct ?? 0));
  const top = free[0];
  return top && top.gpu
    ? { nodeId: top.id, vramFreePct: top.gpu.bestVramFreePct }
    : null;
}

/**
 * 오케스트레이터 (서버 전용): inventory + Prometheus 질의 + 판정.
 * Prometheus 미설정/불가 시 raw 비움 → 전부 unknown(US4, 절대 거짓 "여유" 아님).
 */
export async function getFleetCapacity(): Promise<NodeCapacity[]> {
  const nodes = await loadInventory();
  let raw: CapacityRaw = {
    cpuBusy: [],
    memAvail: [],
    gpuUtil: [],
    gpuVramFree: [],
  };
  try {
    raw = await queryCapacity();
  } catch {
    // 안전 귀결: 전부 unknown
  }
  return resolveFleetCapacity(nodes, raw);
}

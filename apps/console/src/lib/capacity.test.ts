import { describe, it, expect } from "vitest";
import { resolveFleetCapacity, recommendGpuPlacement } from "@/lib/capacity";
import type { Node, CapacityRaw } from "@/types/fleet";

const ip = (id: string) => `192.168.1.${id}`;
const gpuNode = (id: string): Node => ({
  id: `data${id}`,
  ip: ip(id),
  os: "ubuntu",
  role: "target",
  gpu: "RTX",
  exporters: { node: `${ip(id)}:9100`, dcgm: `${ip(id)}:9400` },
});
const cpuNode = (id: string): Node => ({
  id: `data${id}`,
  ip: ip(id),
  os: "ubuntu",
  role: "target",
  gpu: null,
  exporters: { node: `${ip(id)}:9100` },
});

const EMPTY: CapacityRaw = { cpuBusy: [], memAvail: [], gpuUtil: [], gpuVramFree: [] };

describe("resolveFleetCapacity — 정직성(US4)", () => {
  it("데이터 없으면 전부 unknown, hasData=false (절대 거짓 '여유' 아님)", () => {
    const [c] = resolveFleetCapacity([gpuNode("4")], EMPTY);
    expect(c.general.verdict).toBe("unknown");
    expect(c.gpu?.verdict).toBe("unknown");
    expect(c.gpu?.present).toBe(true); // GPU 노드엔 GPU가 있으나 지금 못 읽음
    expect(c.hasData).toBe(false);
  });

  it("GPU 없는 노드는 gpu=null(해당 없음)", () => {
    const [c] = resolveFleetCapacity([cpuNode("1")], EMPTY);
    expect(c.gpu).toBeNull();
  });

  it("일반축은 cpu·mem 둘 다 있어야 판정(하나라도 없으면 unknown)", () => {
    const raw: CapacityRaw = { ...EMPTY, cpuBusy: [{ instance: "192.168.1.1:9100", value: 5 }] };
    expect(resolveFleetCapacity([cpuNode("1")], raw)[0].general.verdict).toBe("unknown");
  });
});

describe("resolveFleetCapacity — 일반축 경계값", () => {
  const raw = (cpu: number, mem: number): CapacityRaw => ({
    ...EMPTY,
    cpuBusy: [{ instance: "192.168.1.1:9100", value: cpu }],
    memAvail: [{ instance: "192.168.1.1:9100", value: mem }],
  });
  const v = (cpu: number, mem: number) =>
    resolveFleetCapacity([cpuNode("1")], raw(cpu, mem))[0].general.verdict;

  it("free: cpu≤50 & mem≥40", () => expect(v(10, 90)).toBe("free"));
  it("full: cpu≥85", () => expect(v(90, 90)).toBe("full"));
  it("full: mem<15", () => expect(v(10, 10)).toBe("full"));
  it("busy: 그 사이", () => expect(v(60, 30)).toBe("busy"));
});

describe("resolveFleetCapacity — GPU축 (binding = 가용 VRAM)", () => {
  const raw = (vrams: number[], utils: number[]): CapacityRaw => ({
    ...EMPTY,
    gpuVramFree: vrams.map((value, i) => ({ instance: "192.168.1.4:9400", gpu: String(i), value })),
    gpuUtil: utils.map((value, i) => ({ instance: "192.168.1.4:9400", gpu: String(i), value })),
  });
  const g = (vrams: number[], utils: number[]) =>
    resolveFleetCapacity([gpuNode("4")], raw(vrams, utils))[0].gpu!;

  it("free: 최고 가용 VRAM≥50 & 그 GPU util≤30 (data04 실측: 78% 여유)", () => {
    const gpu = g([78, 30], [0, 0]);
    expect(gpu.verdict).toBe("free");
    expect(gpu.bestVramFreePct).toBe(78);
    expect(gpu.gpuCount).toBe(2);
  });

  it("★핵심: VRAM 가득(8%) + util 0 → full (util 0이어도 모델 못 올림 — data05 사례)", () => {
    expect(g([8], [0]).verdict).toBe("full");
  });

  it("busy: best VRAM 32%(15~50 사이) — data05 best GPU", () => {
    expect(g([8.7, 32], [0, 0]).verdict).toBe("busy");
  });

  it("full: 모든 GPU util≥85 (VRAM 여유여도 다 돌고 있음)", () => {
    expect(g([60, 70], [90, 88]).verdict).toBe("full");
  });

  it("best GPU의 util로 판정(여유 VRAM이지만 그 GPU가 바쁘면 free 아님)", () => {
    // best VRAM=60(gpu0), 그 util=50>30 → free 아님(busy)
    expect(g([60, 20], [50, 0]).verdict).toBe("busy");
  });
});

describe("resolveFleetCapacity — GPU 폴백(gpu-model, DCGM 없는 노드 예: data01 Tesla M4)", () => {
  const GIB = 1024 ** 3;
  it("DCGM 없고 gpu-model VRAM만 → 배지용 GpuCapacity(source=gpu-model·VRAM 판정)", () => {
    const raw: CapacityRaw = {
      ...EMPTY,
      gpuModelTotalBytes: [{ node: "data1", gpu: "0", value: 4 * GIB }],
      gpuModelUsedBytes: [{ node: "data1", gpu: "0", value: 1 * GIB }], // 75% free
    };
    const gpu = resolveFleetCapacity([cpuNode("1")], raw)[0].gpu!;
    expect(gpu.present).toBe(true);
    expect(gpu.source).toBe("gpu-model");
    expect(gpu.verdict).toBe("free"); // 75% free ≥ 50
    expect(gpu.bestUtilPct).toBe(0); // util 미상
    expect(gpu.vramTotalBytes).toBe(4 * GIB);
    expect(gpu.vramUsedBytes).toBe(1 * GIB);
  });

  it("gpu-model 폴백은 배치 추천에서 제외(util 미상·소용량)", () => {
    const raw: CapacityRaw = {
      ...EMPTY,
      // 폴백 노드는 100% 여유여도, DCGM free 노드가 있으면 그쪽을 추천
      gpuModelTotalBytes: [{ node: "data1", gpu: "0", value: 4 * GIB }],
      gpuModelUsedBytes: [{ node: "data1", gpu: "0", value: 0 }],
      gpuVramFree: [{ instance: "192.168.1.4:9400", gpu: "0", value: 60 }],
      gpuUtil: [{ instance: "192.168.1.4:9400", gpu: "0", value: 0 }],
    };
    const rec = recommendGpuPlacement(resolveFleetCapacity([cpuNode("1"), gpuNode("4")], raw));
    expect(rec?.nodeId).toBe("data4"); // data1(폴백) 아님
  });

  it("DCGM이 있으면 폴백보다 DCGM 우선(source=dcgm)", () => {
    const raw: CapacityRaw = {
      ...EMPTY,
      gpuVramFree: [{ instance: "192.168.1.4:9400", gpu: "0", value: 78 }],
      gpuUtil: [{ instance: "192.168.1.4:9400", gpu: "0", value: 0 }],
      gpuVramUsedMib: [{ instance: "192.168.1.4:9400", gpu: "0", value: 1024 }],
      gpuVramTotalMib: [{ instance: "192.168.1.4:9400", gpu: "0", value: 49152 }],
      gpuModelTotalBytes: [{ node: "data4", gpu: "0", value: 999 * GIB }],
    };
    const gpu = resolveFleetCapacity([gpuNode("4")], raw)[0].gpu!;
    expect(gpu.source).toBe("dcgm");
    expect(gpu.vramTotalBytes).toBe(49152 * 1024 * 1024); // DCGM 값(48 GiB), 폴백 999 아님
  });
});

describe("recommendGpuPlacement", () => {
  const nodes = [gpuNode("4"), gpuNode("5"), cpuNode("1")];
  it("GPU free 노드 중 가용 VRAM 최대를 추천", () => {
    const raw: CapacityRaw = {
      ...EMPTY,
      gpuVramFree: [
        { instance: "192.168.1.4:9400", gpu: "0", value: 78 },
        { instance: "192.168.1.5:9400", gpu: "0", value: 60 },
      ],
      gpuUtil: [
        { instance: "192.168.1.4:9400", gpu: "0", value: 0 },
        { instance: "192.168.1.5:9400", gpu: "0", value: 0 },
      ],
    };
    const rec = recommendGpuPlacement(resolveFleetCapacity(nodes, raw));
    expect(rec).toEqual({ nodeId: "data4", vramFreePct: 78 });
  });

  it("free GPU 없으면 null('여유 GPU 없음')", () => {
    const raw: CapacityRaw = {
      ...EMPTY,
      gpuVramFree: [{ instance: "192.168.1.4:9400", gpu: "0", value: 8 }],
      gpuUtil: [{ instance: "192.168.1.4:9400", gpu: "0", value: 0 }],
    };
    expect(recommendGpuPlacement(resolveFleetCapacity(nodes, raw))).toBeNull();
  });
});

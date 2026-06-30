import { getPrometheusUrl } from "@/config/env";
import type { UpSeries, CapacityRaw } from "@/types/fleet";

type PromResult = { metric?: { instance?: string }; value?: [number, string] };

/** instant 질의 1건 → {metric(라벨 전체), value}. 서버 전용. 실패 throw. */
type PromSample = { metric: Record<string, string>; value: number };
async function promQuery(promql: string): Promise<PromSample[]> {
  const base = getPrometheusUrl().replace(/\/+$/, "");
  const res = await fetch(`${base}/api/v1/query?query=${encodeURIComponent(promql)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`[prometheus] HTTP ${res.status}`);
  const json: { data?: { result?: { metric?: Record<string, string>; value?: [number, string] }[] } } =
    await res.json();
  return (json.data?.result ?? [])
    .map((r) => ({ metric: r.metric ?? {}, value: Number(r.value?.[1]) }))
    .filter((s) => Number.isFinite(s.value));
}

/**
 * Prometheus `up` 질의 (서버 전용 — 'use client' 금지).
 * 네트워크/HTTP/파싱 오류는 throw하고, 호출부(getFleetStatus)가 no-data로 안전 귀결한다.
 */
export async function queryUp(): Promise<UpSeries[]> {
  const base = getPrometheusUrl().replace(/\/+$/, "");
  const res = await fetch(`${base}/api/v1/query?query=up`, { cache: "no-store" });
  if (!res.ok) throw new Error(`[prometheus] HTTP ${res.status}`);
  const json: { data?: { result?: PromResult[] } } = await res.json();
  return (json.data?.result ?? [])
    .map((r) => ({
      instance: r.metric?.instance ?? "",
      value: Number(r.value?.[1]),
    }))
    // instance 누락/비숫자 value series는 버린다 → 매칭 안 되면 no-data로 안전 귀결(US4)
    .filter((s) => s.instance !== "" && Number.isFinite(s.value));
}

/** 노드에 적재된 모델↔GPU 매핑 1건 (gpu-model-exporter, ADR-0016/0017). */
export type GpuModel = {
  node: string;
  model: string;
  framework: string;
  port: string;
  gpu: string;
  vramBytes: number;
};

/**
 * 노드별 적재 모델 질의 (서버 전용 — 서비스 맵). gpu_model_vram_bytes → 모델·GPU·포트·VRAM.
 * node 미지정이면 전체. 실패는 throw → 호출부(서비스 패널)가 빈 목록으로 안전 귀결.
 */
export async function queryGpuModels(node?: string): Promise<GpuModel[]> {
  // node는 내부(inventory id)지만 PromQL 주입 방지로 영숫자/하이픈만 허용.
  const safe = (node ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  const sel = safe ? `{node="${safe}"}` : "";
  const rows = await promQuery(`gpu_model_vram_bytes${sel}`);
  return rows.map((r) => ({
    node: r.metric.node ?? "",
    model: r.metric.model ?? "unknown",
    framework: r.metric.framework ?? "",
    port: r.metric.port ?? "",
    gpu: r.metric.gpu ?? "",
    vramBytes: r.value,
  }));
}

/**
 * 여유 리소스 판정용 메트릭 질의 (서버 전용 — M3, ADR-0013).
 * 4개 instant 질의를 병렬로. CPU는 idle rate(0~1)를 busy%로 환산.
 * DCGM은 노드당 복수 GPU라 gpu 라벨을 보존(util↔VRAM 짝짓기).
 * 실패는 throw → 호출부(getFleetCapacity)가 전부 unknown으로 안전 귀결(거짓 "여유" 금지).
 */
export async function queryCapacity(): Promise<CapacityRaw> {
  const [cpuIdle, memAvail, gpuUtil, gpuVramFree] = await Promise.all([
    promQuery(`avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m]))`),
    promQuery(`100*node_memory_MemAvailable_bytes/node_memory_MemTotal_bytes`),
    promQuery(`DCGM_FI_DEV_GPU_UTIL`),
    promQuery(`100*DCGM_FI_DEV_FB_FREE/(DCGM_FI_DEV_FB_FREE+DCGM_FI_DEV_FB_USED)`),
  ]);
  const nodeSamples = (rows: PromSample[]) =>
    rows
      .map((r) => ({ instance: r.metric.instance ?? "", value: r.value }))
      .filter((s) => s.instance !== "");
  const gpuSamples = (rows: PromSample[]) =>
    rows
      .map((r) => ({ instance: r.metric.instance ?? "", gpu: r.metric.gpu ?? "", value: r.value }))
      .filter((s) => s.instance !== "");
  return {
    // idle rate(0~1) → busy%(0~100)
    cpuBusy: nodeSamples(cpuIdle).map((s) => ({ instance: s.instance, value: 100 * (1 - s.value) })),
    memAvail: nodeSamples(memAvail),
    gpuUtil: gpuSamples(gpuUtil),
    gpuVramFree: gpuSamples(gpuVramFree),
  };
}

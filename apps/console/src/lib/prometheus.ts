import { getPrometheusUrl } from "@/config/env";
import type { UpSeries, CapacityRaw } from "@/types/fleet";
import { fetchWithTimeout, TIMEOUT_MS } from "@/lib/http";

type PromResult = { metric?: { instance?: string }; value?: [number, string] };

/** instant 질의 1건 → {metric(라벨 전체), value}. 서버 전용. 실패 throw. */
type PromSample = { metric: Record<string, string>; value: number };
async function promQuery(promql: string): Promise<PromSample[]> {
  const base = getPrometheusUrl().replace(/\/+$/, "");
  const res = await fetchWithTimeout(
    `${base}/api/v1/query?query=${encodeURIComponent(promql)}`,
    {},
    TIMEOUT_MS.prometheus,
  );
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
  const res = await fetchWithTimeout(`${base}/api/v1/query?query=up`, {}, TIMEOUT_MS.prometheus);
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
  // 소유자(OS 계정명) — SRE 백로그 #8 v1. 미지정/종료/passwd 없음 → "unknown"/"uid:<n>".
  user: string;
};

/**
 * 노드별 적재 모델 질의 (서버 전용 — 서비스 맵). gpu_model_vram_bytes → 모델·GPU·포트·VRAM.
 * node 미지정이면 전체. 실패는 throw → 호출부(서비스 패널)가 빈 목록으로 안전 귀결.
 */
export async function queryGpuModels(node?: string): Promise<GpuModel[]> {
  // node는 내부(inventory id)지만 PromQL 주입 방지로 영숫자/하이픈만 허용.
  const safe = (node ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  // 살균 결과가 비면 셀렉터가 사라져 **플릿 전체**가 반환된다 — 지정 실패의 안전한 방향은
  // "아무것도 안 주는 것"이지 "전부 주는 것"이 아니다(fail-closed).
  if (node !== undefined && safe === "") return [];
  const sel = safe ? `{node="${safe}"}` : "";
  const rows = await promQuery(`gpu_model_vram_bytes${sel}`);
  return rows.map((r) => ({
    node: r.metric.node ?? "",
    model: r.metric.model ?? "unknown",
    framework: r.metric.framework ?? "",
    port: r.metric.port ?? "",
    gpu: r.metric.gpu ?? "",
    vramBytes: r.value,
    user: r.metric.user ?? "unknown",
  }));
}

/** 노드의 리스닝 포트↔프로세스 1건 (port-exporter, 서비스 맵 v2). */
export type ListeningPort = {
  node: string;
  port: string;
  proto: string;
  process: string;
  pid: string;
  // 소유자(OS 계정명) — SRE 백로그 #8 v1. 미지정/종료/passwd 없음 → "unknown"/"uid:<n>".
  user: string;
};

/**
 * 노드별 리스닝 포트 질의 (서버 전용 — 서비스 맵 v2). keiwi_listening_port_info → 포트↔프로세스.
 * 포트 오름차순 정렬. 실패는 throw → 호출부가 빈 목록으로 안전 귀결.
 */
export async function queryListeningPorts(node?: string): Promise<ListeningPort[]> {
  const safe = (node ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  // 살균 결과가 비면 셀렉터가 사라져 **플릿 전체**가 반환된다 — 지정 실패의 안전한 방향은
  // "아무것도 안 주는 것"이지 "전부 주는 것"이 아니다(fail-closed).
  if (node !== undefined && safe === "") return [];
  const sel = safe ? `{node="${safe}"}` : "";
  const rows = await promQuery(`keiwi_listening_port_info${sel}`);
  return rows
    .map((r) => ({
      node: r.metric.node ?? "",
      port: r.metric.port ?? "",
      proto: r.metric.proto ?? "",
      process: r.metric.process ?? "unknown",
      pid: r.metric.pid ?? "",
      user: r.metric.user ?? "unknown",
    }))
    .sort((a, b) => (parseInt(a.port, 10) || 0) - (parseInt(b.port, 10) || 0));
}

/** 집계된 GPU 모델 프로세스 1건 (중복 제거 — model+framework, 노드별). */
export type GpuModelAgg = {
  node: string;
  model: string;
  framework: string;
  gpus: string[];
  ports: string[];
  vramBytes: number;
  // 소유자(OS 계정명) — 다른 소유자는 분리 집계(SRE 백로그 #8 v1).
  user: string;
};

/**
 * gpu_model_* 시리즈(=(gpu,pid)별)를 node+framework+model+user로 집계(순수 — 테스트 대상).
 * 같은 모델이 여러 GPU/pid로 흩어진 것을 1행으로: 사용 GPU 목록 + 포트 + 합계 VRAM.
 * 소유자(user)가 다르면 분리 집계 — "이 모델 누구 거냐" 귀속용(SRE 백로그 #8 v1).
 */
export function aggregateGpuModels(rows: GpuModel[]): GpuModelAgg[] {
  const map = new Map<string, GpuModelAgg>();
  for (const r of rows) {
    const key = `${r.node}|${r.framework}|${r.model}|${r.user}`;
    let a = map.get(key);
    if (!a) {
      a = {
        node: r.node,
        model: r.model,
        framework: r.framework,
        gpus: [],
        ports: [],
        vramBytes: 0,
        user: r.user,
      };
      map.set(key, a);
    }
    if (r.gpu && !a.gpus.includes(r.gpu)) a.gpus.push(r.gpu);
    if (r.port && !a.ports.includes(r.port)) a.ports.push(r.port);
    a.vramBytes += r.vramBytes;
  }
  const out = [...map.values()];
  out.forEach((a) => {
    a.gpus.sort();
    a.ports.sort();
  });
  return out.sort((a, b) => b.vramBytes - a.vramBytes);
}

/**
 * 여유 리소스 판정용 메트릭 질의 (서버 전용 — M3, ADR-0013).
 * 4개 instant 질의를 병렬로. CPU는 idle rate(0~1)를 busy%로 환산.
 * DCGM은 노드당 복수 GPU라 gpu 라벨을 보존(util↔VRAM 짝짓기).
 * 실패는 throw → 호출부(getFleetCapacity)가 전부 unknown으로 안전 귀결(거짓 "여유" 금지).
 */
export async function queryCapacity(): Promise<CapacityRaw> {
  const [cpuIdle, memAvail, gpuUtil, gpuVramFree, gpuVramUsed, gpuVramTotal, gpuModelUsed, gpuModelTotal] = await Promise.all([
    promQuery(`avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m]))`),
    promQuery(`100*node_memory_MemAvailable_bytes/node_memory_MemTotal_bytes`),
    promQuery(`DCGM_FI_DEV_GPU_UTIL`),
    promQuery(`100*DCGM_FI_DEV_FB_FREE/(DCGM_FI_DEV_FB_FREE+DCGM_FI_DEV_FB_USED)`),
    // 절대 VRAM(MiB) — 카드에 "36/48 GiB" 수치 표시용. total = used+free(FB_TOTAL 부재 노드 대비 안정).
    promQuery(`DCGM_FI_DEV_FB_USED`),
    promQuery(`DCGM_FI_DEV_FB_USED + DCGM_FI_DEV_FB_FREE`),
    // gpu-model-exporter VRAM(bytes, node 라벨) — DCGM 없는 GPU(data01 Tesla M4) 배지 폴백.
    promQuery(`gpu_vram_used_bytes`),
    promQuery(`gpu_vram_total_bytes`),
  ]);
  const nodeSamples = (rows: PromSample[]) =>
    rows
      .map((r) => ({ instance: r.metric.instance ?? "", value: r.value }))
      .filter((s) => s.instance !== "");
  const gpuSamples = (rows: PromSample[]) =>
    rows
      .map((r) => ({ instance: r.metric.instance ?? "", gpu: r.metric.gpu ?? "", value: r.value }))
      .filter((s) => s.instance !== "");
  // gpu-model-exporter는 node 라벨(instance 아님)로 노드를 식별한다.
  const nodeGpuSamples = (rows: PromSample[]) =>
    rows
      .map((r) => ({ node: r.metric.node ?? "", gpu: r.metric.gpu ?? "", value: r.value }))
      .filter((s) => s.node !== "");
  return {
    // idle rate(0~1) → busy%(0~100)
    cpuBusy: nodeSamples(cpuIdle).map((s) => ({ instance: s.instance, value: 100 * (1 - s.value) })),
    memAvail: nodeSamples(memAvail),
    gpuUtil: gpuSamples(gpuUtil),
    gpuVramFree: gpuSamples(gpuVramFree),
    gpuVramUsedMib: gpuSamples(gpuVramUsed),
    gpuVramTotalMib: gpuSamples(gpuVramTotal),
    gpuModelUsedBytes: nodeGpuSamples(gpuModelUsed),
    gpuModelTotalBytes: nodeGpuSamples(gpuModelTotal),
  };
}

export type InstalledModelSample = {
  /** node-exporter instance(ip:9100) — 호출부가 inventory ip로 노드 id에 매핑 */
  instance: string;
  name: string;
  format: string;
  source: string;
  sizeBytes: number;
};

/**
 * 설치 모델 카탈로그 질의 (서버 전용 — model-ops). 각 노드의 keiwi-model-catalog 수집기가
 * node-exporter textfile로 노출한 keiwi_installed_model_size_bytes를 읽는다(specs/model-ops §4).
 * 실패는 throw → 호출부가 로컬 스캔 폴백/빈 목록으로 안전 귀결.
 */
export async function queryInstalledModelCatalog(): Promise<InstalledModelSample[]> {
  const rows = await promQuery(`keiwi_installed_model_size_bytes`);
  return rows
    .map((r) => ({
      instance: r.metric.instance ?? "",
      name: r.metric.name ?? "unknown",
      format: r.metric.format ?? "unknown",
      source: r.metric.source ?? "dir",
      sizeBytes: r.value,
    }))
    .filter((m) => m.instance !== "");
}

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MODEL_OPS_POLICY, type ModelOpsPolicy } from "@/config/model-ops-policy";

/**
 * 모델 운영(model-ops) — 설치 모델 카탈로그 스캔 + VRAM 사전판정 (서버 전용).
 * specs/model-ops/spec.md §4·§5. 신규 수집 0 — 디스크 스캔과 기존 Prometheus 메트릭만 쓴다.
 */

export type FitVerdict = "ok" | "tight" | "no" | "unknown";

export type ModelFit = {
  verdict: FitVerdict;
  /** 로딩 오버헤드 반영 가중치 요구량(GiB). 미상이면 null */
  weightsGib: number | null;
  /** 요청 util 기준 vLLM 예약량(GiB). 미상이면 null */
  reserveGib: number | null;
  freeGib: number | null;
  totalGib: number | null;
  /** verdict=tight일 때만 — 이 util로 낮추면 예약이 여유 안에 들어온다 */
  suggestedUtil: number | null;
  /** 판정 근거 한 줄(판정불가 사유 포함) — 카드에 그대로 노출 */
  reason: string;
};

const GIB = 1024 ** 3;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * VRAM 사전판정. 입력이 하나라도 미상이면 "판정불가" — 거짓 "가능" 금지(ADR-0013).
 * freeMib/totalMib 는 DCGM(MiB) 실측, weightsBytes 는 디스크 실측.
 */
export function judgeModelFit(
  args: {
    weightsBytes: number | null;
    freeMib: number | null;
    totalMib: number | null;
    gpuMemUtil?: number;
  },
  policy: ModelOpsPolicy = DEFAULT_MODEL_OPS_POLICY,
): ModelFit {
  const util = args.gpuMemUtil ?? policy.defaultGpuMemUtil;
  const unknown = (reason: string): ModelFit => ({
    verdict: "unknown",
    weightsGib: args.weightsBytes != null ? round1((args.weightsBytes * policy.loadOverhead) / GIB) : null,
    reserveGib: null,
    freeGib: args.freeMib != null ? round1(args.freeMib / 1024) : null,
    totalGib: args.totalMib != null ? round1(args.totalMib / 1024) : null,
    suggestedUtil: null,
    reason,
  });
  if (args.weightsBytes == null || args.weightsBytes <= 0) return unknown("모델 크기 미상 — 디스크 실측 실패");
  if (args.freeMib == null || args.totalMib == null || args.totalMib <= 0)
    return unknown("GPU VRAM 메트릭 결손(DCGM) — 판정불가");

  const weightsGib = (args.weightsBytes * policy.loadOverhead) / GIB;
  const freeGib = args.freeMib / 1024;
  const totalGib = args.totalMib / 1024;
  const reserveGib = totalGib * util;

  const base = {
    weightsGib: round1(weightsGib),
    reserveGib: round1(reserveGib),
    freeGib: round1(freeGib),
    totalGib: round1(totalGib),
  };

  // 가중치가 여유(나아가 GPU 총량)를 넘으면 예약 여부와 무관하게 로드 자체가 불가 —
  // 이 검사가 예약 검사보다 먼저다(시각 QA 실측: 61 GiB 모델이 44 GiB GPU에서 "가능" 오판).
  if (weightsGib > freeGib) {
    return {
      verdict: "no",
      ...base,
      suggestedUtil: null,
      reason: `가중치 ${base.weightsGib} GiB > 여유 ${base.freeGib} GiB`,
    };
  }
  if (freeGib >= reserveGib) {
    if (weightsGib > reserveGib) {
      // 여유는 충분하나 기본 util 예약이 가중치보다 작음 — util 상향 필요.
      const suggested = Math.min(
        Math.ceil((weightsGib / totalGib + policy.utilSafetyMargin) * 100) / 100,
        Math.floor((freeGib / totalGib) * 100) / 100,
      );
      return {
        verdict: "tight",
        ...base,
        suggestedUtil: suggested,
        reason: `가중치 ${base.weightsGib} GiB가 기본 예약 ${base.reserveGib} GiB(util ${util})보다 큼 — util ${suggested} 이상으로 올려야 로드 가능`,
      };
    }
    return {
      verdict: "ok",
      ...base,
      suggestedUtil: null,
      reason: `여유 ${base.freeGib} GiB ≥ 예약 ${base.reserveGib} GiB (util ${util})`,
    };
  }
  // 남은 경우: weights ≤ free < reserve — 가중치는 들어가지만 기본 util 예약은 안 됨 → util 하향 제안.
  // 안전 마진을 빼되, 가중치 요구 아래로는 내리지 않는다(내리면 로드 자체가 실패).
  const margin = Math.floor((freeGib / totalGib - policy.utilSafetyMargin) * 100) / 100;
  const floor = Math.ceil((weightsGib / totalGib) * 100) / 100;
  const suggested = Math.max(margin, floor);
  return {
    verdict: "tight",
    ...base,
    suggestedUtil: suggested,
    reason: `가중치 ${base.weightsGib} GiB는 들어가나 예약 ${base.reserveGib} GiB > 여유 ${base.freeGib} GiB — util ${suggested} 이하 권장(KV 캐시·컨텍스트 여유 감소)`,
  };
}

export type InstalledModel = {
  name: string;
  sizeBytes: number;
  format: "safetensors" | "gguf" | "unknown";
};

/** HF 캐시 등 모델이 아닌 디렉터리 — 카탈로그에서 제외 */
const CATALOG_DENYLIST = new Set(["hub", "xet", "lost+found"]);
const WEIGHT_EXT = [".safetensors", ".gguf", ".bin", ".pt"];
const MAX_DEPTH = 3;

function walk(dir: string, depth: number, acc: { size: number; formats: Set<string> }): void {
  if (depth > MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith(".")) walk(p, depth + 1, acc);
    } else if (e.isFile()) {
      try {
        acc.size += fs.statSync(p).size;
      } catch {
        /* 삭제 경합 등 — 크기 합산만 건너뜀 */
      }
      const ext = path.extname(e.name).toLowerCase();
      if (ext === ".safetensors") acc.formats.add("safetensors");
      else if (ext === ".gguf") acc.formats.add("gguf");
      else if (WEIGHT_EXT.includes(ext)) acc.formats.add("unknown");
    }
  }
}

/**
 * 설치 모델 카탈로그 — 모델 디렉터리(1뎁스=모델 1개) 스캔. 가중치 파일이 없는 디렉터리는
 * 모델이 아니므로 제외. 디렉터리 접근 불가 시 빈 목록(호출부가 "카탈로그 없음"으로 정직 표기).
 */
export function listInstalledModels(dir: string): InstalledModel[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: InstalledModel[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || CATALOG_DENYLIST.has(e.name)) continue;
    const acc = { size: 0, formats: new Set<string>() };
    walk(path.join(dir, e.name), 1, acc);
    if (acc.formats.size === 0) continue;
    const format = acc.formats.has("safetensors")
      ? ("safetensors" as const)
      : acc.formats.has("gguf")
        ? ("gguf" as const)
        : ("unknown" as const);
    out.push({ name: e.name, sizeBytes: acc.size, format });
  }
  return out.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

/**
 * GPU 프로세스 목록이 "비어 있음"인지 "수집 실패"인지 판정 (순수 — 테스트 대상).
 *
 * 왜 필요한가: gpu-model-exporter는 `nvidia-smi`에 의존한다. 드라이버 커널↔유저스페이스
 * 불일치가 나면 smi가 exit 18로 죽어 **모델 목록이 조용히 0건**이 되는데, DCGM은 커널모듈
 * 값을 읽으므로 VRAM·온도를 정상 보고한다. 그러면 화면은 "GPU에 적재된 프로세스 없음"
 * = **유휴**로 읽히지만 실제로는 GPU가 사용 중이다(2026-08-12 data03 실측: DCGM 21/48 GiB,
 * 모델 0건, `nvidia-smi` rc=18).
 * "측정 못 함"이 "정상"으로 보이는 것 — 이 레포가 반복해서 고쳐 온 실패모드다(no-data ≠ down).
 *
 * 판정: VRAM이 유휴 기준선을 넘게 쓰이는데 모델이 0건이면 **수집 실패**로 본다.
 * @param usedGib DCGM 실측 사용 VRAM(GiB, 노드 합). null이면 판정 불가라 false.
 */
export function isGpuProbeSuspect(usedGib: number | null, modelCount: number): boolean {
  if (modelCount > 0) return false;
  if (usedGib == null) return false;
  // 유휴 기준선: dcgm-exporter 자신이 잡는 컨텍스트가 카드당 0.5 GiB 안팎이다(실측).
  // 2 GiB를 넘으면 "누군가 쓰고 있다"로 본다 — 오탐보다 미탐이 비싼 판정이다.
  return usedGib > 2;
}

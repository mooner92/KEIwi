import { describe, it, expect } from "vitest";
import { aggregateGpuModels, type GpuModel } from "@/lib/prometheus";

const m = (over: Partial<GpuModel>): GpuModel => ({
  node: "data04",
  model: "x",
  framework: "vllm",
  port: "",
  gpu: "0",
  vramBytes: 0,
  user: "mhchoi",
  ...over,
});

describe("aggregateGpuModels (중복 제거 — model+framework, 노드별)", () => {
  it("같은 모델이 여러 GPU/pid → 1행(GPU 목록·VRAM 합)", () => {
    const out = aggregateGpuModels([
      m({ model: "ollama", framework: "ollama", gpu: "0", port: "11434", vramBytes: 200 }),
      m({ model: "ollama", framework: "ollama", gpu: "1", port: "11434", vramBytes: 18000 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].gpus).toEqual(["0", "1"]);
    expect(out[0].ports).toEqual(["11434"]);
    expect(out[0].vramBytes).toBe(18200);
  });

  it("04_rag_api가 GPU 0에 2 pid → 여전히 1행(VRAM 합)", () => {
    const out = aggregateGpuModels([
      m({ model: "04_rag_api", framework: "uvicorn", gpu: "0", port: "9001", vramBytes: 2400 }),
      m({ model: "04_rag_api", framework: "uvicorn", gpu: "0", port: "9000", vramBytes: 2400 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].gpus).toEqual(["0"]);
    expect(out[0].ports).toEqual(["9000", "9001"]);
    expect(out[0].vramBytes).toBe(4800);
  });

  it("다른 모델·프레임워크는 분리", () => {
    const out = aggregateGpuModels([
      m({ model: "ollama", framework: "ollama", vramBytes: 100 }),
      m({ model: "Qwen", framework: "vllm", vramBytes: 200 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("같은 모델이라도 소유자(user)가 다르면 분리", () => {
    const out = aggregateGpuModels([
      m({ model: "ollama", framework: "ollama", user: "mhchoi", vramBytes: 100 }),
      m({ model: "ollama", framework: "ollama", user: "jdoe", vramBytes: 200 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((a) => a.user).sort()).toEqual(["jdoe", "mhchoi"]);
  });

  it("같은 모델이라도 노드가 다르면 분리", () => {
    const out = aggregateGpuModels([
      m({ node: "data04", model: "ollama", framework: "ollama", vramBytes: 1 }),
      m({ node: "data05", model: "ollama", framework: "ollama", vramBytes: 2 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((a) => a.node).sort()).toEqual(["data04", "data05"]);
  });

  it("VRAM 큰 순 정렬", () => {
    const out = aggregateGpuModels([
      m({ model: "small", vramBytes: 10 }),
      m({ model: "big", vramBytes: 999 }),
    ]);
    expect(out[0].model).toBe("big");
  });

  it("빈 입력 안전", () => {
    expect(aggregateGpuModels([])).toEqual([]);
  });
});

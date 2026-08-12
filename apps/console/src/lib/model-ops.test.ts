import { describe, expect, it } from "vitest";
import { isGpuProbeSuspect, judgeModelFit } from "./model-ops";

const GIB = 1024 ** 3;
const MIB_PER_GIB = 1024;

// A40 46068 MiB ≈ 45 GiB 기준의 실측형 케이스 (specs/model-ops AC-M-3·AC-M-4)
const TOTAL = 46068;

describe("judgeModelFit — 4단 판정 (spec §5)", () => {
  it("가능: 유휴 GPU에 32B-AWQ(19.3GB) — 여유 ≥ 예약", () => {
    const r = judgeModelFit({
      weightsBytes: 19.3 * GIB,
      freeMib: TOTAL, // 완전 유휴
      totalMib: TOTAL,
    });
    expect(r.verdict).toBe("ok");
    expect(r.reserveGib).toBeCloseTo((TOTAL / MIB_PER_GIB) * 0.9, 0);
    expect(r.suggestedUtil).toBeNull();
  });

  it("불가: 39GB 점유 GPU(여유 6.5GiB)에 32B-AWQ — 가중치조차 못 올림", () => {
    const r = judgeModelFit({
      weightsBytes: 19.3 * GIB,
      freeMib: 6.5 * MIB_PER_GIB,
      totalMib: TOTAL,
    });
    expect(r.verdict).toBe("no");
    expect(r.reason).toContain("가중치");
  });

  it("빠듯: 가중치는 들어가나 기본 util 예약 불가 — 하향 util 제안", () => {
    // 여유 25 GiB: weights 21.2 GiB ≤ 25 < reserve 40.5 GiB
    const r = judgeModelFit({
      weightsBytes: 19.3 * GIB,
      freeMib: 25 * MIB_PER_GIB,
      totalMib: TOTAL,
    });
    expect(r.verdict).toBe("tight");
    expect(r.suggestedUtil).not.toBeNull();
    // 제안 util 예약이 여유 이하이고, 가중치 요구 이상이어야 한다
    const totalGib = TOTAL / MIB_PER_GIB;
    expect(r.suggestedUtil! * totalGib).toBeLessThanOrEqual(25);
    expect(r.suggestedUtil! * totalGib).toBeGreaterThanOrEqual(r.weightsGib!);
  });

  it("빠듯 하한: 안전 마진이 가중치 요구 아래로 내려가면 가중치 하한으로 클램프", () => {
    // 여유 = 가중치와 거의 같게 — margin(floor(free/total-0.02))이 floor(weights/total) 미만이 되는 지점
    const weights = 24.9 * GIB; // ×1.1 → 27.39 GiB
    const r = judgeModelFit({
      weightsBytes: weights,
      freeMib: 27.5 * MIB_PER_GIB,
      totalMib: TOTAL,
    });
    expect(r.verdict).toBe("tight");
    const totalGib = TOTAL / MIB_PER_GIB;
    expect(r.suggestedUtil! * totalGib).toBeGreaterThanOrEqual(r.weightsGib!);
  });

  it("판정불가: VRAM 메트릭 결손 — 거짓 '가능' 금지(ADR-0013)", () => {
    const r = judgeModelFit({ weightsBytes: 10 * GIB, freeMib: null, totalMib: null });
    expect(r.verdict).toBe("unknown");
    expect(r.reason).toContain("결손");
  });

  it("판정불가: 모델 크기 미상", () => {
    const r = judgeModelFit({ weightsBytes: null, freeMib: 1000, totalMib: TOTAL });
    expect(r.verdict).toBe("unknown");
    expect(r.reason).toContain("크기 미상");
  });

  it("경계: 여유 == 예약이면 가능(≥)", () => {
    const totalMib = 40 * MIB_PER_GIB;
    const r = judgeModelFit({
      weightsBytes: 1 * GIB,
      freeMib: 36 * MIB_PER_GIB, // reserve = 40*0.9 = 36
      totalMib,
    });
    expect(r.verdict).toBe("ok");
  });

  it("불가: 가중치가 GPU 총량보다 큰 모델은 유휴 GPU에서도 불가 — 시각 QA 실측 회귀", () => {
    // 61 GiB(비양자화 32B) 모델 vs A40 44.99 GiB — 여유 ≥ 예약이어도 가중치가 안 들어간다
    const r = judgeModelFit({
      weightsBytes: 61 * GIB,
      freeMib: TOTAL, // 완전 유휴: free(44.99) ≥ reserve(40.49)인 상태
      totalMib: TOTAL,
    });
    expect(r.verdict).toBe("no");
  });

  it("빠듯(util 상향): 여유는 충분하나 가중치가 기본 예약보다 큰 경우", () => {
    // weights 38.5×1.1=42.35 GiB, free=total=44.99, reserve=40.49 → free≥reserve지만 weights>reserve
    const r = judgeModelFit({
      weightsBytes: 38.5 * GIB,
      freeMib: TOTAL,
      totalMib: TOTAL,
    });
    expect(r.verdict).toBe("tight");
    const totalGib = TOTAL / MIB_PER_GIB;
    expect(r.suggestedUtil! * totalGib).toBeGreaterThanOrEqual(r.weightsGib!);
    expect(r.suggestedUtil! * totalGib).toBeLessThanOrEqual(totalGib);
    expect(r.reason).toContain("올려야");
  });

  it("util 인자 반영: 낮춘 util 요청이면 같은 여유로도 가능", () => {
    const r = judgeModelFit({
      weightsBytes: 19.3 * GIB,
      freeMib: 25 * MIB_PER_GIB,
      totalMib: TOTAL,
      gpuMemUtil: 0.5, // reserve 22.5 GiB ≤ 25
    });
    expect(r.verdict).toBe("ok");
  });
});

describe("isGpuProbeSuspect — '유휴'와 '수집 실패' 구분 (data03 실측 회귀)", () => {
  it("VRAM 21 GiB 쓰는데 모델 0건이면 수집 실패로 본다", () => {
    expect(isGpuProbeSuspect(21, 0)).toBe(true);
  });

  it("모델이 1건이라도 잡히면 정상", () => {
    expect(isGpuProbeSuspect(21, 1)).toBe(false);
  });

  it("유휴 기준선(2 GiB) 이하면 진짜 유휴로 본다 — dcgm-exporter 자체 컨텍스트", () => {
    expect(isGpuProbeSuspect(1.0, 0)).toBe(false);
    expect(isGpuProbeSuspect(2, 0)).toBe(false);
  });

  it("VRAM을 모르면 단정하지 않는다", () => {
    expect(isGpuProbeSuspect(null, 0)).toBe(false);
  });
});

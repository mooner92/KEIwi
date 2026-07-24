/**
 * 여유 리소스 판정 임계 — 정책 상수 (ADR-0013).
 *
 * 기본값은 **보수적**(여유를 쉽게 선언하지 않음 — 오배치 비용 > 미배치 비용).
 * 운영 중 연구 패턴에 맞춰 조정 가능. 근거는 docs/decisions/0013-capacity-judgment-policy.md.
 *
 * GPU 여유의 binding 은 **가용 VRAM**(모델이 들어갈 자리). util 은 "지금 바쁜가"의 보조.
 */
export type CapacityPolicy = {
  /** GPU 가용 VRAM% ≥ 이면 free 후보 */
  gpuVramFreePct: number;
  /** GPU 가용 VRAM% < 이면 full */
  gpuVramFullPct: number;
  /** best GPU util% ≤ 이어야 free(여유여도 돌고 있으면 busy) */
  gpuUtilBusyPct: number;
  /** 모든 GPU util% ≥ 이면 full */
  gpuUtilFullPct: number;
  /** CPU busy% ≤ 이면 일반 free 후보 */
  cpuBusyFreePct: number;
  /** CPU busy% ≥ 이면 일반 full */
  cpuBusyFullPct: number;
  /** 메모리 가용% ≥ 이면 일반 free 후보 */
  memAvailFreePct: number;
  /** 메모리 가용% < 이면 일반 full */
  memAvailFullPct: number;
};

export const DEFAULT_CAPACITY_POLICY: CapacityPolicy = {
  gpuVramFreePct: 50,
  gpuVramFullPct: 15,
  gpuUtilBusyPct: 30,
  gpuUtilFullPct: 85,
  cpuBusyFreePct: 50,
  cpuBusyFullPct: 85,
  memAvailFreePct: 40,
  memAvailFullPct: 15,
};

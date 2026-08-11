/**
 * 모델 운영(model-ops) 판정 정책 상수 — specs/model-ops/spec.md §5.
 *
 * 원칙: 추정은 보수적으로, 근거 수치는 전부 노출, 모르면 "판정불가"(ADR-0013 계승).
 * vLLM은 가중치만큼이 아니라 --gpu-memory-utilization(기본 0.9)만큼 **예약**하므로
 * 판정은 두 겹이다: 예약 전량 확보(가능) / 가중치는 들어감(빠듯, util 하향 제안) / 그 미만(불가).
 */
export type ModelOpsPolicy = {
  /** 가중치 디스크 실측 대비 로딩 오버헤드 계수(CUDA 컨텍스트·버퍼) */
  loadOverhead: number;
  /** vLLM 기본 --gpu-memory-utilization */
  defaultGpuMemUtil: number;
  /** "빠듯" util 하향 제안 시 남겨두는 안전 마진(총 VRAM 대비 비율) */
  utilSafetyMargin: number;
};

export const DEFAULT_MODEL_OPS_POLICY: ModelOpsPolicy = {
  loadOverhead: 1.1,
  defaultGpuMemUtil: 0.9,
  utilSafetyMargin: 0.02,
};

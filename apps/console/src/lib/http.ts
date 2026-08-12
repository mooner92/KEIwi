/**
 * 서버 fetch 공용 가드 (서버 전용).
 *
 * 왜 필요한가: 데이터원 fetch에 타임아웃이 없으면 undici 기본값(~300초)까지 매달린다.
 * `/api/assistant`는 GPU 경합을 막으려 프로세스 전역으로 **동시 1요청**만 허용하므로,
 * OpenSearch 하나가 늘어지면 그 시간 내내 어시스턴트가 **모든 사용자에게 429**가 된다.
 * Prometheus도 마찬가지로 Overview SSR 전체를 붙잡는다.
 * → 데이터원마다 상한을 두고, 초과는 예외로 올려 호출부가 "판정불가"로 표기하게 한다.
 */

/** 데이터원별 상한. LLM만 길다 — 생성은 원래 오래 걸린다. */
export const TIMEOUT_MS = {
  prometheus: 5_000,
  opensearch: 10_000,
  llm: 180_000,
} as const;

/** 타임아웃이 걸린 fetch. 초과 시 `TimeoutError`로 reject된다. */
export function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  return fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
}

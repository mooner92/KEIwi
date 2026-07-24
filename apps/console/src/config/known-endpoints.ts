/**
 * 알려진 사내 서비스 포트(참조용 힌트). 서비스 맵에서 포트→무엇 주석에 사용.
 * 노드별 정밀 매핑이 아니라 플릿 공통 관례 — 포트 전수 수집(임의 ss)은 v2(서비스맵 백로그 B01).
 * 근거: [[keiwi-cloudflare-endpoints]] + infra(node/dcgm/gpu-model exporter 표준 포트).
 */
export type KnownEndpoint = { port: number; label: string };

export const KNOWN_ENDPOINTS: readonly KnownEndpoint[] = [
  { port: 764, label: "sshd" },
  { port: 3000, label: "grafana" },
  { port: 3100, label: "ms" },
  { port: 3105, label: "keiwi-console" },
  { port: 5678, label: "n8n" },
  { port: 5044, label: "logstash(beats)" },
  { port: 8003, label: "vllm(Qwen3-Coder)" },
  { port: 8010, label: "vllm(Qwen2.5-VL)" },
  { port: 8080, label: "open-webui" },
  { port: 9000, label: "rag-api" },
  { port: 9001, label: "rag-api" },
  { port: 9090, label: "prometheus" },
  { port: 9100, label: "node-exporter" },
  { port: 9200, label: "opensearch" },
  { port: 9400, label: "dcgm-exporter" },
  { port: 9836, label: "gpu-model-exporter" },
  { port: 11434, label: "ollama" },
] as const;

const BY_PORT = new Map<number, string>(KNOWN_ENDPOINTS.map((e) => [e.port, e.label]));

/** 포트(숫자/문자) → 알려진 라벨, 모르면 undefined. */
export function endpointLabel(port: number | string | undefined): string | undefined {
  if (port === undefined || port === "") return undefined;
  const n = typeof port === "number" ? port : parseInt(port, 10);
  return Number.isFinite(n) ? BY_PORT.get(n) : undefined;
}

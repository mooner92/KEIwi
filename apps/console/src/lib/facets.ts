import { getOpenSearchUrl } from "@/config/env";
import { fetchWithTimeout, TIMEOUT_MS } from "@/lib/http";

/** 질의계획 그라운딩용 실제 어휘(노드·서비스·카테고리). 환각 차단: 계획은 이 집합으로만 검증. */
export type Facets = { nodes: string[]; services: string[]; categories: string[] };

const EMPTY: Facets = { nodes: [], services: [], categories: [] };

// 프로세스 내 짧은 TTL 캐시 — 패싯은 자주 안 변함(매 요청 agg 방지). Date.now()는 앱코드라 허용.
let cache: { at: number; data: Facets } | null = null;
const TTL_MS = 60_000;

type Bucket = { key?: string };
function keys(agg: { buckets?: Bucket[] } | undefined): string[] {
  return (agg?.buckets ?? [])
    .map((b) => b.key)
    .filter((k): k is string => typeof k === "string" && k.length > 0);
}

/**
 * keiwi-logs-* 의 노드/서비스/카테고리 어휘를 terms agg로 수집(읽기 전용). 실패 시 빈 어휘.
 * 탐색형 질의계획기(LLM)에 주입 → 모델이 없는 노드/서비스를 지어내도 호출부가 검증·제거.
 */
export async function getFacets(): Promise<Facets> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const base = getOpenSearchUrl().replace(/\/+$/, "");
  const body = {
    size: 0,
    query: { range: { "@timestamp": { gte: "now-7d" } } },
    aggs: {
      nodes: { terms: { field: "fleet_node", size: 10 } },
      services: { terms: { field: "service", size: 40 } },
      categories: { terms: { field: "category", size: 15 } },
    },
  };

  try {
    const res = await fetchWithTimeout(`${base}/keiwi-logs-*/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, TIMEOUT_MS.opensearch);
    if (!res.ok) return EMPTY;
    const json: {
      aggregations?: {
        nodes?: { buckets?: Bucket[] };
        services?: { buckets?: Bucket[] };
        categories?: { buckets?: Bucket[] };
      };
    } = await res.json();
    const data: Facets = {
      nodes: keys(json.aggregations?.nodes),
      services: keys(json.aggregations?.services),
      categories: keys(json.aggregations?.categories),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return EMPTY;
  }
}

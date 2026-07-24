import { getOpenSearchUrl } from "@/config/env";

/** 노드에서 도는 서비스 1건(최근 로그 기준) — 서비스 맵 행. */
export type NodeService = {
  service: string;
  category: string;
  total: number;
  errorCount: number;
  warnCount: number;
};

// 운영 노이즈(rsyslog 자기로그·UFW 방화벽) 제외 — 신호 패널과 일관(ADR-0011/0015).
const NOISE_MUST_NOT = [
  { term: { service: "rsyslog.service" } },
  { match_phrase: { message: "UFW BLOCK" } },
];

/**
 * 노드별 서비스 집계 요청 본문(순수 — 테스트 대상). fleet_node 필터 + 노이즈 제외 +
 * service terms(상위 size) · 하위집계로 대표 category 1개 + error/warn 건수.
 */
export function buildServiceAggBody(fleetNode: string, from = "now-24h", size = 60) {
  return {
    size: 0,
    query: {
      bool: {
        filter: [
          { term: { fleet_node: fleetNode } },
          { range: { "@timestamp": { gte: from } } },
        ],
        must_not: NOISE_MUST_NOT,
      },
    },
    aggs: {
      services: {
        terms: { field: "service", size, order: { _count: "desc" } },
        aggs: {
          category: { terms: { field: "category", size: 1 } },
          levels: {
            filters: {
              filters: {
                error: { term: { log_level: "error" } },
                warn: { term: { log_level: "warn" } },
              },
            },
          },
        },
      },
    },
  };
}

type ServiceBucket = {
  key?: string;
  doc_count?: number;
  category?: { buckets?: { key?: string }[] };
  levels?: { buckets?: { error?: { doc_count?: number }; warn?: { doc_count?: number } } };
};
type AggJson = { aggregations?: { services?: { buckets?: ServiceBucket[] } } };

/** 집계 응답 → NodeService[] (순수 — 테스트 대상). error/warn 많은 순으로 정렬. */
export function parseServiceBuckets(json: AggJson): NodeService[] {
  const buckets = json.aggregations?.services?.buckets ?? [];
  return buckets
    .filter((b): b is ServiceBucket & { key: string } => typeof b.key === "string" && b.key.length > 0)
    .map((b) => ({
      service: b.key,
      category: b.category?.buckets?.[0]?.key ?? "unknown",
      total: b.doc_count ?? 0,
      errorCount: b.levels?.buckets?.error?.doc_count ?? 0,
      warnCount: b.levels?.buckets?.warn?.doc_count ?? 0,
    }))
    .sort((a, b) => b.errorCount - a.errorCount || b.warnCount - a.warnCount || b.total - a.total);
}

/**
 * 노드의 서비스 카탈로그(서버 전용 — 읽기 전용 _search agg). 신규 수집 0(기존 로그 재사용).
 * 실패는 throw → 호출부(서비스 패널)가 빈 목록으로 안전 귀결.
 */
export async function getNodeServices(fleetNode: string, from = "now-24h"): Promise<NodeService[]> {
  const base = getOpenSearchUrl().replace(/\/+$/, "");
  const res = await fetch(`${base}/keiwi-logs-*/_search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildServiceAggBody(fleetNode, from)),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`[opensearch] HTTP ${res.status}`);
  return parseServiceBuckets((await res.json()) as AggJson);
}

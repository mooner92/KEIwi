import { getOpenSearchUrl } from "@/config/env";

/** 어시스턴트 근거(인용)용 로그 1건. _id는 서버 검증된 실제 doc 식별자(날조 차단). */
export type LogDoc = {
  id: string;
  timestamp: string;
  fleetNode: string;
  service: string;
  level: string;
  message: string;
};

export type SearchLogsOpts = {
  /** 자유 텍스트(에러 메시지·질문 키워드) — BM25 query_string. */
  query?: string;
  service?: string;
  fleetNode?: string;
  /** 기본 신호 우선(error+warn). */
  levels?: string[];
  /** 시간창 시작(예 "now-1h"). 기본 now-6h. */
  from?: string;
  /** top-K. 기본 50. */
  size?: number;
};

type OsHit = {
  _id?: string;
  _source?: {
    "@timestamp"?: string;
    fleet_node?: string;
    service?: string;
    log_level?: string;
    message?: string;
  };
};

/**
 * keiwi-logs-* 로그 검색 (서버 전용 — 'use client' 금지). 읽기 전용(_search).
 * 네트워크/HTTP/파싱 오류는 throw → 호출부(어시스턴트)가 처리.
 */
export async function searchLogs(opts: SearchLogsOpts): Promise<LogDoc[]> {
  const base = getOpenSearchUrl().replace(/\/+$/, "");
  const levels = opts.levels ?? ["error", "warn"];
  const size = Math.min(Math.max(opts.size ?? 50, 1), 200);

  const filter: unknown[] = [
    { terms: { log_level: levels } },
    { range: { "@timestamp": { gte: opts.from ?? "now-6h" } } },
  ];
  if (opts.service) filter.push({ term: { service: opts.service } });
  if (opts.fleetNode) filter.push({ term: { fleet_node: opts.fleetNode } });

  const must: unknown[] = [];
  if (opts.query && opts.query.trim()) {
    must.push({
      query_string: {
        query: opts.query,
        default_field: "message",
        // 사용자/로그 텍스트라 파싱 실패해도 throw 말고 무시(견고).
        lenient: true,
      },
    });
  }

  const body = {
    size,
    sort: [{ "@timestamp": { order: "desc" } }],
    query: { bool: { must, filter } },
    _source: ["@timestamp", "fleet_node", "service", "log_level", "message"],
  };

  const res = await fetch(`${base}/keiwi-logs-*/_search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`[opensearch] HTTP ${res.status}`);
  const json: { hits?: { hits?: OsHit[] } } = await res.json();

  return (json.hits?.hits ?? [])
    .filter((h): h is OsHit & { _id: string } => Boolean(h._id))
    .map((h) => ({
      id: h._id,
      timestamp: h._source?.["@timestamp"] ?? "",
      fleetNode: h._source?.fleet_node ?? "unknown",
      service: h._source?.service ?? "unknown",
      level: h._source?.log_level ?? "info",
      message: h._source?.message ?? "",
    }));
}

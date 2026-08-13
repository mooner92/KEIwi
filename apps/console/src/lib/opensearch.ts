import { getOpenSearchUrl } from "@/config/env";
import { fetchWithTimeout, TIMEOUT_MS } from "@/lib/http";

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
  /** 레벨 필터. 생략·빈배열 = 전체 레벨(탐색형). 신호 패널은 ["error","warn"]를 명시. */
  levels?: string[];
  /** 시간창 시작(예 "now-1h"). 기본 now-6h. */
  from?: string;
  /** top-K. 기본 50. */
  size?: number;
  /** 운영 노이즈 제외(rsyslog 자기로그 + UFW 방화벽 차단). 신호/탐색 공통. */
  excludeNoise?: boolean;
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
  const size = Math.min(Math.max(opts.size ?? 50, 1), 200);

  const filter: unknown[] = [
    { range: { "@timestamp": { gte: opts.from ?? "now-6h" } } },
  ];
  // 레벨 미지정 = 전체(탐색형). 명시 시에만 필터(신호 패널 error/warn).
  if (opts.levels && opts.levels.length) {
    filter.push({ terms: { log_level: opts.levels } });
  }
  if (opts.service) filter.push({ term: { service: opts.service } });
  if (opts.fleetNode) filter.push({ term: { fleet_node: opts.fleetNode } });

  // 노이즈 제외는 쿼리단에서(클라이언트 slice 후 거르면 진짜 신호가 묻힘 — ADR-0015).
  const mustNot: unknown[] = [];
  if (opts.excludeNoise) {
    mustNot.push({ term: { service: "rsyslog.service" } });
    mustNot.push({ match_phrase: { message: "UFW BLOCK" } });
  }

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
    query: { bool: { must, filter, must_not: mustNot } },
    _source: ["@timestamp", "fleet_node", "service", "log_level", "message"],
  };

  const res = await fetchWithTimeout(`${base}/keiwi-logs-*/_search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, TIMEOUT_MS.opensearch);
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

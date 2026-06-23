import { getPrometheusUrl } from "@/config/env";
import type { UpSeries } from "@/types/fleet";

type PromResult = { metric?: { instance?: string }; value?: [number, string] };

/**
 * Prometheus `up` 질의 (서버 전용 — 'use client' 금지).
 * 네트워크/HTTP/파싱 오류는 throw하고, 호출부(getFleetStatus)가 no-data로 안전 귀결한다.
 */
export async function queryUp(): Promise<UpSeries[]> {
  const base = getPrometheusUrl().replace(/\/+$/, "");
  const res = await fetch(`${base}/api/v1/query?query=up`, { cache: "no-store" });
  if (!res.ok) throw new Error(`[prometheus] HTTP ${res.status}`);
  const json: { data?: { result?: PromResult[] } } = await res.json();
  return (json.data?.result ?? [])
    .map((r) => ({
      instance: r.metric?.instance ?? "",
      value: Number(r.value?.[1]),
    }))
    // instance 누락/비숫자 value series는 버린다 → 매칭 안 되면 no-data로 안전 귀결(US4)
    .filter((s) => s.instance !== "" && Number.isFinite(s.value));
}

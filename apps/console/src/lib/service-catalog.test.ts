import { describe, it, expect } from "vitest";
import { buildServiceAggBody, parseServiceBuckets } from "@/lib/service-catalog";
import { endpointLabel } from "@/config/known-endpoints";

describe("buildServiceAggBody (노드 서비스 집계 요청)", () => {
  const body = buildServiceAggBody("data04");
  it("fleet_node 필터 + 시간창", () => {
    const f = JSON.stringify(body.query.bool.filter);
    expect(f).toContain('"fleet_node":"data04"');
    expect(f).toContain("now-24h");
  });
  it("노이즈 제외(rsyslog + UFW)", () => {
    const mn = JSON.stringify(body.query.bool.must_not);
    expect(mn).toContain("rsyslog.service");
    expect(mn).toContain("UFW BLOCK");
  });
  it("service terms + category·levels 하위집계", () => {
    expect(body.aggs.services.terms.field).toBe("service");
    expect(body.aggs.services.aggs.category.terms.field).toBe("category");
    expect(Object.keys(body.aggs.services.aggs.levels.filters.filters)).toEqual([
      "error",
      "warn",
    ]);
  });
  it("size 0(문서 본문 안 가져옴)", () => {
    expect(body.size).toBe(0);
  });
});

describe("parseServiceBuckets (집계 → NodeService[])", () => {
  const json = {
    aggregations: {
      services: {
        buckets: [
          {
            key: "docker.service",
            doc_count: 30,
            category: { buckets: [{ key: "infra" }] },
            levels: { buckets: { error: { doc_count: 0 }, warn: { doc_count: 5 } } },
          },
          {
            key: "ollama.service",
            doc_count: 100,
            category: { buckets: [{ key: "gpu" }] },
            levels: { buckets: { error: { doc_count: 3 }, warn: { doc_count: 1 } } },
          },
          { key: "", doc_count: 9 }, // 빈 키 — 스킵
        ],
      },
    },
  };
  const out = parseServiceBuckets(json);
  it("빈 키는 스킵", () => {
    expect(out.find((s) => s.service === "")).toBeUndefined();
    expect(out).toHaveLength(2);
  });
  it("category·총건수·error/warn 매핑", () => {
    const d = out.find((s) => s.service === "docker.service")!;
    expect(d.category).toBe("infra");
    expect(d.total).toBe(30);
    expect(d.warnCount).toBe(5);
    expect(d.errorCount).toBe(0);
  });
  it("error 많은 순 정렬(ollama가 docker보다 앞)", () => {
    expect(out[0].service).toBe("ollama.service"); // error 3 > 0
  });
  it("category 없으면 unknown", () => {
    const o = parseServiceBuckets({
      aggregations: { services: { buckets: [{ key: "x.service", doc_count: 1 }] } },
    });
    expect(o[0].category).toBe("unknown");
  });
  it("빈 응답 안전", () => {
    expect(parseServiceBuckets({})).toEqual([]);
  });
});

describe("endpointLabel (알려진 포트)", () => {
  it("숫자/문자 포트 모두 매핑", () => {
    expect(endpointLabel(11434)).toBe("ollama");
    expect(endpointLabel("8003")).toBe("vllm(Qwen3-Coder)");
    expect(endpointLabel(9836)).toBe("gpu-model-exporter");
  });
  it("모르는/빈 포트는 undefined", () => {
    expect(endpointLabel(54321)).toBeUndefined();
    expect(endpointLabel("")).toBeUndefined();
    expect(endpointLabel(undefined)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { graphStats, toFileGraph, type RawGraph } from "./code-graph";

// 파일 A(심볼 a1) · 파일 B(심볼 b1) · 파일 C(고립)
const RAW: RawGraph = {
  built_at_commit: "abc123",
  nodes: [
    { id: "A", label: "a.ts", community: 0, source_file: "src/a.ts" },
    { id: "B", label: "b.ts", community: 0, source_file: "src/b.ts" },
    { id: "C", label: "c.sh", community: 1, source_file: "scripts/c.sh" },
    { id: "a1", label: "fnA()", community: 0 },
    { id: "b1", label: "fnB()", community: 0 },
  ],
  links: [
    { source: "A", target: "a1", relation: "contains" },
    { source: "B", target: "b1", relation: "contains" },
    { source: "C", target: "c1", relation: "contains" },
    // 심볼 간 호출 → 파일 의존으로 승격되어야 한다
    { source: "a1", target: "b1", relation: "calls" },
    // 같은 방향 중복 — 한 번만 센다
    { source: "A", target: "B", relation: "imports" },
    // 자기 자신 — 버린다
    { source: "a1", target: "A", relation: "calls" },
  ],
};

describe("toFileGraph — 심볼을 소유 파일로 접는다", () => {
  const g = toFileGraph(RAW);

  it("파일 노드만 남긴다(contains 출발점 = 파일)", () => {
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
  });

  it("심볼 간 호출을 파일 의존으로 승격하고 중복은 한 번만 센다", () => {
    expect(g.edges).toEqual([{ from: "A", to: "B" }]);
  });

  it("자기 자신으로 도는 간선은 버린다", () => {
    expect(g.edges.some((e) => e.from === e.to)).toBe(false);
  });

  it("degree를 무방향으로 센다", () => {
    expect(g.nodes.find((n) => n.id === "A")?.degree).toBe(1);
    expect(g.nodes.find((n) => n.id === "B")?.degree).toBe(1);
    expect(g.nodes.find((n) => n.id === "C")?.degree).toBe(0);
  });

  it("허브가 앞에 오도록 정렬한다", () => {
    expect(g.nodes[g.nodes.length - 1]?.id).toBe("C"); // degree 0이 뒤로
  });

  it("추출 커밋을 보존한다(낡음 판정용)", () => {
    expect(g.commit).toBe("abc123");
  });

  it("빈 입력에도 죽지 않는다", () => {
    const empty = toFileGraph({});
    expect(empty.nodes).toEqual([]);
    expect(empty.edges).toEqual([]);
    expect(empty.commit).toBeNull();
  });
});

describe("graphStats", () => {
  it("파일·의존·커뮤니티·고립 수를 센다", () => {
    const s = graphStats(toFileGraph(RAW));
    expect(s.files).toBe(3);
    expect(s.deps).toBe(1);
    expect(s.communities).toBe(2);
    expect(s.isolated).toBe(1); // c.sh
  });

  it("허브 목록에는 연결된 파일만 넣는다", () => {
    const s = graphStats(toFileGraph(RAW));
    expect(s.hubs.every((h) => h.degree > 0)).toBe(true);
  });
});

describe("모호 소유 심볼 — 가짜 파일 의존 방지 (실측 회귀)", () => {
  it("두 파일이 소유한(병합된) 심볼의 간선은 버린다", () => {
    const g = toFileGraph({
      nodes: [
        { id: "A", label: "a.ts" },
        { id: "P", label: "p.ts" },
        { id: "PT", label: "p.test.ts" },
        { id: "sym", label: "fn()" },
      ],
      links: [
        { source: "A", target: "a1", relation: "contains" },
        { source: "P", target: "sym", relation: "contains" },
        { source: "PT", target: "sym", relation: "contains" }, // 병합으로 이중 소유
        { source: "A", target: "sym", relation: "imports_from" }, // 어느 파일인지 모른다
      ],
    });
    expect(g.edges).toEqual([]); // A→P인지 A→PT인지 단정할 수 없으므로 그리지 않는다
  });
});

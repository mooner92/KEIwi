import { describe, it, expect } from "vitest";
import { normalizeFleetNode } from "@/lib/fleet-node";

// inventory.yaml 형상의 최소 픽스처 — 순수 함수라 로더 없이 검증한다.
const NODES = [
  { id: "data03", ip: "192.0.2.103" },
  { id: "data04", ip: "192.0.2.104" },
  { id: "data05", ip: "192.0.2.105" },
];

describe("normalizeFleetNode (딥링크 node 파라미터 정규화)", () => {
  it("노드 id 그대로 → id", () => {
    expect(normalizeFleetNode("data04", NODES)).toBe("data04");
  });
  it("ip → id", () => {
    expect(normalizeFleetNode("192.0.2.104", NODES)).toBe("data04");
  });
  it("ip:port (Grafana instance 라벨) → id", () => {
    expect(normalizeFleetNode("192.0.2.104:9100", NODES)).toBe("data04");
    expect(normalizeFleetNode("192.0.2.103:9400", NODES)).toBe("data03");
  });
  it("미지 입력 → undefined", () => {
    expect(normalizeFleetNode("10.0.0.1:9100", NODES)).toBeUndefined();
    expect(normalizeFleetNode("unknown-node", NODES)).toBeUndefined();
  });
  it("빈 값/undefined → undefined", () => {
    expect(normalizeFleetNode(undefined, NODES)).toBeUndefined();
    expect(normalizeFleetNode("  ", NODES)).toBeUndefined();
  });
});

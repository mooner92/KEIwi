import { describe, it, expect } from "vitest";
import { resolveFleetStatus } from "@/lib/status";
import type { Node, UpSeries } from "@/types/fleet";

const mkNode = (id: string, exporters: Record<string, string>): Node => ({
  id,
  ip: `192.168.1.${id}`,
  os: "ubuntu",
  role: "target",
  gpu: null,
  exporters,
});

const nodes: Node[] = [
  mkNode("1", { node: "192.168.1.1:9100" }),
  mkNode("2", { windows: "192.168.1.2:9182" }),
  mkNode("5", { node: "192.168.1.5:9100", dcgm: "192.168.1.5:9400" }),
];

describe("resolveFleetStatus", () => {
  it("매칭 series가 없으면 no-data (절대 down 아님) — US4 핵심 불변식", () => {
    const r = resolveFleetStatus(nodes, []);
    expect(r.map((n) => n.status)).toEqual(["no-data", "no-data", "no-data"]);
    expect(r.some((n) => n.status === "down")).toBe(false);
  });

  it("값=1 → up, 값=0 → down, 매칭 없음 → no-data", () => {
    const up: UpSeries[] = [
      { instance: "192.168.1.1:9100", value: 1 },
      { instance: "192.168.1.2:9182", value: 0 },
    ];
    const r = resolveFleetStatus(nodes, up);
    expect(r[0].status).toBe("up");
    expect(r[1].status).toBe("down");
    expect(r[2].status).toBe("no-data");
  });

  it("동일 instance에 복수 series(1과 0)가 와도 0이 덮어써지지 않고 down", () => {
    const dup: UpSeries[] = [
      { instance: "192.168.1.1:9100", value: 1 },
      { instance: "192.168.1.1:9100", value: 0 },
    ];
    expect(resolveFleetStatus(nodes, dup)[0].status).toBe("down");
  });

  it("복수 exporter: 모두 1이면 up, 하나라도 0이면 down (이기종 data05)", () => {
    const allUp: UpSeries[] = [
      { instance: "192.168.1.5:9100", value: 1 },
      { instance: "192.168.1.5:9400", value: 1 },
    ];
    expect(resolveFleetStatus(nodes, allUp)[2].status).toBe("up");

    const oneDown: UpSeries[] = [
      { instance: "192.168.1.5:9100", value: 1 },
      { instance: "192.168.1.5:9400", value: 0 },
    ];
    expect(resolveFleetStatus(nodes, oneDown)[2].status).toBe("down");
  });

  it("부분 매칭: 매칭된 series만으로 판정 (no-data로 떨어지지 않음)", () => {
    const partial: UpSeries[] = [{ instance: "192.168.1.5:9100", value: 1 }];
    expect(resolveFleetStatus(nodes, partial)[2].status).toBe("up");
  });

  it("status는 {up,down,no-data} 닫힌 집합 + 노드별 형태 보존", () => {
    const allowed = new Set(["up", "down", "no-data"]);
    const r = resolveFleetStatus(nodes, [{ instance: "192.168.1.1:9100", value: 1 }]);
    expect(r.every((n) => allowed.has(n.status))).toBe(true);
    expect(r[0]).toMatchObject({ id: "1", ip: "192.168.1.1", os: "ubuntu", role: "target" });
  });
});

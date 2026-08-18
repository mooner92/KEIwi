import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadInventoryFrom } from "./inventory";

const NODE = (ip: string) =>
  `nodes:\n  - id: data01\n    ip: ${ip}\n    os: ubuntu\n    role: target\n    exporters:\n      node: "${ip}:9100"\n`;

/**
 * 공개 저장소는 자리표시자를, 운영 노드는 실값을 쓴다. 이 분기가 깨지면 둘 중 하나가
 * 반드시 사고다 — 공개본에 실 IP 가 올라가거나, 콘솔이 노드를 식별하지 못하거나.
 */
describe("인벤토리 로컬 오버레이", () => {
  it("`.local.yaml` 이 있으면 그쪽이 이긴다(운영 노드)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inv-"));
    await writeFile(join(dir, "inv.yaml"), NODE("192.0.2.11"));
    await writeFile(join(dir, "inv.local.yaml"), NODE("10.9.9.9"));
    const nodes = await loadInventoryFrom(join(dir, "inv.yaml"));
    expect(nodes[0].ip).toBe("10.9.9.9");
  });

  it("`.local.yaml` 이 없으면 커밋본으로 떨어진다 — 없다고 죽지 않는다(CI·새 클론)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inv-"));
    await writeFile(join(dir, "inv.yaml"), NODE("192.0.2.11"));
    const nodes = await loadInventoryFrom(join(dir, "inv.yaml"));
    expect(nodes[0].ip).toBe("192.0.2.11");
  });
});

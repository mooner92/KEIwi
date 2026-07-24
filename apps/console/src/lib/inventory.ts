import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { getInventoryPath } from "@/config/env";
import { InventorySchema, type Node } from "@/types/fleet";

/**
 * docs/inventory.yaml 로드 + zod 검증 (서버 전용 — 'use client' 금지).
 * 스키마가 깨지면 fail-fast로 throw (헌장 §0: inventory가 단일 기준).
 */
export async function loadInventory(): Promise<Node[]> {
  const path = resolve(process.cwd(), getInventoryPath());
  const raw = await readFile(path, "utf8");
  const parsed = InventorySchema.safeParse(parse(raw));
  if (!parsed.success) {
    throw new Error(`[inventory] ${path} 스키마 검증 실패: ${parsed.error.message}`);
  }
  return parsed.data.nodes;
}

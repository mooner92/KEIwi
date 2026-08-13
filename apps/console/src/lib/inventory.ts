import { cache } from "react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { getInventoryPath } from "@/config/env";
import { InventorySchema, type Node } from "@/types/fleet";

/**
 * docs/inventory.yaml 로드 + zod 검증 (서버 전용 — 'use client' 금지).
 * 스키마가 깨지면 fail-fast로 throw (헌장 §0: inventory가 단일 기준).
 */
// React.cache — 한 요청 안에서 몇 번 불려도 파일 읽기·YAML 파싱·zod 검증을 한 번만 한다.
// fetch가 아니라 Next의 자동 메모이제이션 대상이 아니다(실측: Overview 1회 렌더에 3회 실행).
export const loadInventory = cache(async function loadInventory(): Promise<Node[]> {
  const path = resolve(process.cwd(), getInventoryPath());
  const raw = await readFile(path, "utf8");
  const parsed = InventorySchema.safeParse(parse(raw));
  if (!parsed.success) {
    throw new Error(`[inventory] ${path} 스키마 검증 실패: ${parsed.error.message}`);
  }
  return parsed.data.nodes;
});

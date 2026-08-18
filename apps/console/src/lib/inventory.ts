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
/**
 * 지정 경로에서 인벤토리를 읽는다 — **캐시 없음**(테스트가 부르는 진입점).
 * 오버레이 규칙은 여기에 있고, `loadInventory` 는 여기에 캐시만 씌운다.
 */
export async function loadInventoryFrom(configuredPath: string): Promise<Node[]> {
  const configured = resolve(process.cwd(), configuredPath);
  // 로컬 오버레이 — `<이름>.local.yaml` 이 있으면 그쪽이 이긴다.
  //
  // 왜: 이 저장소는 공개돼 있고 프로덕션 체크아웃과 **같은 트리**다. 커밋된
  // inventory 에 실제 IP·호스트명을 두면 공개되고, 그렇다고 지우면 콘솔이 노드를
  // 식별하지 못한다(Prometheus instance ↔ node id 매핑이 여기서 나온다).
  // 그래서 커밋본은 문서용 자리표시자(RFC 5737 TEST-NET)를 담고, 실제 값은
  // git 밖 `.local.yaml` 에 둔다. 운영 노드에만 존재하므로 자동으로 그쪽이 쓰인다.
  const local = configured.replace(/\.ya?ml$/, ".local.yaml");
  let path = configured;
  let raw: string;
  try {
    raw = await readFile(local, "utf8");
    path = local;
  } catch {
    raw = await readFile(configured, "utf8");
  }
  const parsed = InventorySchema.safeParse(parse(raw));
  if (!parsed.success) {
    throw new Error(`[inventory] ${path} 스키마 검증 실패: ${parsed.error.message}`);
  }
  return parsed.data.nodes;
}

export const loadInventory = cache(async function loadInventory(): Promise<Node[]> {
  return loadInventoryFrom(getInventoryPath());
});

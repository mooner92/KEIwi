import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { RunbookRef } from "@/lib/assistant";

// 레포 docs/runbooks/ (KB 진실의 원천 — 사람 PR 머지본만, ADR-0014). cwd = apps/console.
const RUNBOOKS_DIR = resolve(process.cwd(), "../../docs/runbooks");

/** 런북 frontmatter(YAML) 추출 — 첫 `---` 블록. */
function parseFrontmatter(raw: string): Record<string, unknown> | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  try {
    const v = parse(m[1]);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 레포 런북들의 frontmatter를 RunbookRef로 로드 (서버 전용 — 'use client' 금지).
 * 벡터 없음 — runbookMatch가 service·category·signature 키워드로 결정적 매칭(ADR-0014).
 * 디렉터리 부재/파싱 실패는 빈 배열/스킵으로 안전 귀결.
 */
export async function loadRunbooks(): Promise<RunbookRef[]> {
  let files: string[];
  try {
    files = (await readdir(RUNBOOKS_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const out: RunbookRef[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(resolve(RUNBOOKS_DIR, f), "utf8");
      const fm = parseFrontmatter(raw);
      if (fm && typeof fm.id === "string") {
        out.push({
          id: fm.id,
          path: `docs/runbooks/${f}`,
          service: typeof fm.service === "string" ? fm.service : undefined,
          category: typeof fm.category === "string" ? fm.category : undefined,
          signature: typeof fm.signature === "string" ? fm.signature : undefined,
        });
      }
    } catch {
      // 개별 파일 오류는 스킵
    }
  }
  return out;
}

import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadRunbooks } from "@/lib/runbooks";

// cwd = apps/console (vitest 실행 위치). runbooks.ts와 같은 경로 규약을 쓴다.
const RUNBOOKS_DIR = resolve(process.cwd(), "../../docs/runbooks");

async function runbookFiles(): Promise<string[]> {
  return (await readdir(RUNBOOKS_DIR)).filter((f) => f.endsWith(".md")).sort();
}

describe("loadRunbooks (어시스턴트 인덱싱 회귀 차단)", () => {
  it("모든 런북이 인덱싱된다 — frontmatter 누락 = 조용한 누락", async () => {
    // 왜 이 테스트가 있나: log-ingestion-stopped.md는 frontmatter가 없어
    // runbooks.ts:38(`fm.id` 없으면 버림)에 걸려 **유일하게 올바른 알림 런북이**
    // 어시스턴트에 인덱싱되지 않았다. 아무 에러도 나지 않아 6개월간 아무도 몰랐다.
    // 개수 비교만이 이 조용한 누락을 잡는다(스펙 §3.1 · AC-3-7).
    const files = await runbookFiles();
    const loaded = await loadRunbooks();
    const missing = files
      .map((f) => f.replace(/\.md$/, ""))
      .filter((id) => !loaded.some((r) => r.id === id));
    expect(missing).toEqual([]);
    expect(loaded.length).toBe(files.length);
  });

  it("id는 파일 stem과 일치하고 path는 docs/runbooks/ 아래다", async () => {
    for (const r of await loadRunbooks()) {
      expect(r.path).toBe(`docs/runbooks/${r.id}.md`);
    }
  });

  it("frontmatter에 alerts를 선언한 런북은 category도 갖는다(게이트 R6과 동일 계약)", async () => {
    // 게이트(check-runbooks.sh)는 CI에서 돌고 이 테스트는 콘솔 쪽에서 돈다.
    // 콘솔 매칭이 category에 의존하므로(assistant.ts runbookMatch) 여기서도 잠근다.
    const loaded = await loadRunbooks();
    const noCategory = loaded.filter((r) => !r.category);
    expect(noCategory.map((r) => r.id)).toEqual([]);
  });

  it("파일에 frontmatter가 실제로 있다(파서 우회 방지)", async () => {
    for (const f of await runbookFiles()) {
      const raw = await readFile(resolve(RUNBOOKS_DIR, f), "utf8");
      expect(raw.startsWith("---\n"), `${f}: frontmatter 없음`).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { parseSpans, parseWikiMd, readWikiPage } from "./wiki";

describe("parseSpans — 생성기 문법 부분집합", () => {
  it("굵게·코드·위키링크를 분해한다", () => {
    expect(parseSpans("**세션 기동** — `/a/b` [[data05]]")).toEqual([
      { t: "bold", v: "세션 기동" },
      { t: "text", v: " — " },
      { t: "code", v: "/a/b" },
      { t: "text", v: " " },
      { t: "wikilink", v: "data05" },
    ]);
  });

  it("일반 텍스트는 그대로", () => {
    expect(parseSpans("plain")).toEqual([{ t: "text", v: "plain" }]);
  });
});

describe("parseWikiMd", () => {
  const RAW = `---
kind: project
node: data05
---

[[data05]] · [[data05--user1]]

# console

## 무엇인가
<!-- llm-summary:start -->
_요약 대기_
<!-- llm-summary:end -->

| 항목 | 값 |
|---|---|
| 포트 | 3105 |
| git | 없음 |

- 항목 하나
`;

  it("frontmatter·제목·표·주석 숨김을 처리한다", () => {
    const page = parseWikiMd("s", RAW);
    expect(page.kind).toBe("project");
    expect(page.meta.node).toBe("data05");
    expect(page.title).toBe("console");
    const table = page.blocks.find((b) => b.type === "table");
    expect(table && table.type === "table" && table.rows.length).toBe(2);
    // 구획 마커(HTML 주석)는 렌더 대상이 아니다
    expect(JSON.stringify(page.blocks)).not.toContain("llm-summary");
  });

  it("frontmatter 없는 문서도 죽지 않는다", () => {
    const page = parseWikiMd("s", "# 제목\n본문");
    expect(page.title).toBe("제목");
    expect(page.kind).toBe("unknown");
  });
});

describe("readWikiPage — 경로 탈출 차단", () => {
  it.each(["../etc/passwd", "a/b", "a\\b", "..", ""])(
    "위험 슬러그 %j 는 파일시스템에 닿기 전에 null",
    (bad) => {
      expect(readWikiPage("/nonexistent", bad)).toBeNull();
    },
  );

  it("없는 문서는 null(미생성과 동일 경로) — throw하지 않는다", () => {
    expect(readWikiPage("/nonexistent", "data05")).toBeNull();
  });
});

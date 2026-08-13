import fs from "node:fs";
import path from "node:path";

/**
 * fleet-wiki 문서 읽기·파싱 (서버 전용) — specs/fleet-wiki §5.
 *
 * 생성기(infra/fleet-wiki/generate.py)가 만드는 **제한된 md 부분집합**만 파싱한다:
 * frontmatter · h1/h2 · 표 · 목록 · 문단 · 인라인(굵게·코드·[[위키링크]]) · HTML 주석(숨김).
 * 범용 md 라이브러리를 넣지 않는 이유 — 입력을 우리 생성기가 소유하므로 문법이 닫혀 있고,
 * 신규 런타임 의존성은 ADR 사안(§8)인데 이 부분집합엔 그 비용이 필요 없다.
 */

export type WikiSpan =
  | { t: "text"; v: string }
  | { t: "bold"; v: string }
  | { t: "code"; v: string }
  | { t: "wikilink"; v: string };

export type WikiBlock =
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "p"; spans: WikiSpan[] }
  | { type: "li"; spans: WikiSpan[] }
  | { type: "table"; header: string[]; rows: WikiSpan[][][] };

export type WikiPage = {
  slug: string;
  kind: string;
  title: string;
  meta: Record<string, string>;
  blocks: WikiBlock[];
};

/** 슬러그 검증 — 파일 경로로 쓰이므로 **경로 탈출을 여기서 차단**한다(허용 문자만). */
const SLUG_RE = /^[A-Za-z0-9._-]+$/;
const KIND_DIRS = ["servers", "accounts", "projects"] as const;

/** 인라인 파싱 (순수 — 테스트 대상): **굵게** · `코드` · [[링크]] */
export function parseSpans(line: string): WikiSpan[] {
  const out: WikiSpan[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[\[([^\]]+)\]\])/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ t: "text", v: line.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ t: "bold", v: m[2] });
    else if (m[4] !== undefined) out.push({ t: "code", v: m[4] });
    else if (m[6] !== undefined) out.push({ t: "wikilink", v: m[6] });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ t: "text", v: line.slice(last) });
  return out;
}

/** frontmatter + 본문 → 페이지 (순수 — 테스트 대상). 알 수 없는 줄은 문단으로 취급. */
export function parseWikiMd(slug: string, raw: string): WikiPage {
  const meta: Record<string, string> = {};
  let body = raw;
  if (raw.startsWith("---\n")) {
    const end = raw.indexOf("\n---\n", 4);
    if (end !== -1) {
      for (const line of raw.slice(4, end).split("\n")) {
        const i = line.indexOf(":");
        if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      body = raw.slice(end + 5);
    }
  }
  const blocks: WikiBlock[] = [];
  let title = slug;
  let table: { header: string[]; rows: WikiSpan[][][] } | null = null;
  const flushTable = () => {
    if (table) blocks.push({ type: "table", ...table });
    table = null;
  };
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("<!--") || trimmed === "" || /^\|[-| ]+\|$/.test(trimmed)) {
      if (trimmed === "") flushTable();
      continue; // 주석(구획 마커)·빈 줄·표 구분선은 렌더하지 않는다
    }
    if (trimmed.startsWith("| ") || trimmed.startsWith("|")) {
      const cells = trimmed.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (!table) table = { header: cells, rows: [] };
      else table.rows.push(cells.map(parseSpans));
      continue;
    }
    flushTable();
    if (trimmed.startsWith("# ")) {
      title = trimmed.slice(2);
      blocks.push({ type: "h1", text: title });
    } else if (trimmed.startsWith("## ")) {
      blocks.push({ type: "h2", text: trimmed.slice(3) });
    } else if (trimmed.startsWith("- ")) {
      blocks.push({ type: "li", spans: parseSpans(trimmed.slice(2)) });
    } else {
      blocks.push({ type: "p", spans: parseSpans(trimmed) });
    }
  }
  flushTable();
  return { slug, kind: meta.kind ?? "unknown", title, meta, blocks };
}

/** 페이지 1건 로드. 슬러그가 규칙을 벗어나면 **null**(경로 탈출 차단 — 파일시스템에 닿기 전). */
export function readWikiPage(dir: string, slug: string): WikiPage | null {
  if (!SLUG_RE.test(slug)) return null;
  const candidates =
    slug === "index" ? [path.join(dir, "index.md")] : KIND_DIRS.map((d) => path.join(dir, d, slug + ".md"));
  for (const p of candidates) {
    try {
      return parseWikiMd(slug, fs.readFileSync(p, "utf8"));
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

export type WikiListing = { kind: string; slug: string; title: string }[];

/** 전체 목록 — 사이드바용. 디렉터리가 없으면 null("미생성"과 "빈 위키"를 구분). */
export function listWikiPages(dir: string): WikiListing | null {
  if (!fs.existsSync(dir)) return null;
  const out: WikiListing = [];
  for (const sub of KIND_DIRS) {
    const d = path.join(dir, sub);
    let names: string[] = [];
    try {
      names = fs.readdirSync(d).filter((n) => n.endsWith(".md"));
    } catch {
      continue;
    }
    for (const n of names.sort()) {
      const slug = n.slice(0, -3);
      let title = slug;
      try {
        const m = fs.readFileSync(path.join(d, n), "utf8").match(/^# (.+)$/m);
        if (m) title = m[1];
      } catch {
        /* 제목은 장식 — 실패해도 slug로 */
      }
      out.push({ kind: sub, slug, title });
    }
  }
  return out;
}

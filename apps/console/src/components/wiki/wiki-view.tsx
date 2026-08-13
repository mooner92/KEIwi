import Link from "next/link";
import { getWikiDir } from "@/config/env";
import { WikiGraph } from "./wiki-graph";
import {
  listWikiPages,
  readWikiPage,
  type WikiBlock,
  type WikiSpan,
} from "@/lib/wiki";

/**
 * 그래프 뷰의 가상 슬러그. 생성기 슬러그 문자집합에 밑줄이 포함되어 이론상 같은 이름의
 * 디렉터리와 충돌할 수 있고 그때는 그래프가 우선한다 — 실플릿에 `__graph__` 디렉터리는
 * 없으며, 생긴다면 여기가 아니라 생성기에서 접두어를 바꿔 풀어야 한다.
 */
const GRAPH_SLUG = "__graph__";

/**
 * 플릿 위키 — 서버·계정·프로젝트 문서 뷰 (specs/fleet-wiki §5, P1).
 * 서버 렌더 + `?page=` URL 상태 — 클라이언트 상태에 걸지 않는다(탭·테마 사고의 교훈).
 * 문서는 생성기 산출물(레포 밖)을 파일에서 직접 읽는다 — 코드 그래프와 같은 패턴.
 */

const KIND_LABEL: Record<string, string> = {
  servers: "서버",
  accounts: "계정",
  projects: "프로젝트",
};

function Spans({ spans }: { spans: WikiSpan[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.t === "bold") return <b key={i} className="font-semibold text-ink">{s.v}</b>;
        if (s.t === "code") return <code key={i} className="tnum rounded-sm bg-surface-2 px-1 text-[0.92em]">{s.v}</code>;
        if (s.t === "wikilink")
          return (
            <Link key={i} href={`/wiki?page=${encodeURIComponent(s.v)}`} className="text-ink underline underline-offset-2 hover:text-ink-muted">
              {s.v}
            </Link>
          );
        return <span key={i}>{s.v}</span>;
      })}
    </>
  );
}

function Block({ b }: { b: WikiBlock }) {
  if (b.type === "h1") return <h2 className="mt-1 text-lg font-semibold text-ink">{b.text}</h2>;
  if (b.type === "h2") return <h3 className="mt-4 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{b.text}</h3>;
  if (b.type === "li")
    return <li className="ml-4 list-disc text-sm text-ink-muted"><Spans spans={b.spans} /></li>;
  if (b.type === "table")
    return (
      <table className="mt-1.5 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-ink-subtle">
            {b.header.map((h, i) => <th key={i} className="px-2 py-1 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((r, i) => (
            <tr key={i} className="border-b border-border-subtle last:border-b-0">
              {r.map((cell, j) => <td key={j} className="px-2 py-1 text-ink-muted"><Spans spans={cell} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  return <p className="mt-1 text-sm leading-6 text-ink-muted"><Spans spans={b.spans} /></p>;
}

function Empty({ dir }: { dir: string }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface p-8 text-center">
      <p className="text-base font-medium text-ink">플릿 위키 미생성</p>
      <p className="mt-1.5 max-w-lg text-sm leading-6 text-ink-subtle">
        scout 스냅샷에서 문서를 생성하면 이 화면이 채워집니다. 산출물은 실계정·경로를 담으므로
        <b> 레포 밖</b>에 생성됩니다.
      </p>
      <code className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-ink">
        python3 infra/fleet-wiki/generate.py /var/lib/keiwi-scout/scout.json
      </code>
      <p className="mt-2 text-2xs text-ink-subtle">찾는 경로: <span className="tnum">{dir}</span></p>
    </div>
  );
}

export function WikiView({ pageSlug }: { pageSlug?: string }) {
  const dir = getWikiDir();
  const listing = listWikiPages(dir);
  if (listing === null) return <Empty dir={dir} />;

  const slug = pageSlug || listing.find((p) => p.kind === "servers")?.slug || "index";
  const isGraph = slug === GRAPH_SLUG;
  const page = isGraph ? null : readWikiPage(dir, slug);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[240px_1fr]">
      {/* 좌 — 문서 트리(서버→계정→프로젝트) */}
      <nav aria-label="위키 문서" className="min-h-0 overflow-y-auto rounded-lg border border-border bg-surface">
        <Link
          href={`/wiki?page=${GRAPH_SLUG}`}
          aria-current={isGraph ? "page" : undefined}
          className={[
            "block border-b border-border px-3 py-1.5 text-sm",
            isGraph
              ? "bg-surface-2 font-semibold text-ink"
              : "text-ink-muted hover:bg-surface-2 hover:text-ink",
          ].join(" ")}
        >
          그래프 보기
        </Link>
        {(["servers", "accounts", "projects"] as const).map((kind) => {
          const items = listing.filter((p) => p.kind === kind);
          if (items.length === 0) return null;
          return (
            <div key={kind}>
              <p className="border-b border-border bg-surface-2 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                {KIND_LABEL[kind]} <span className="tnum font-normal">{items.length}</span>
              </p>
              <ul className="py-1">
                {items.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`/wiki?page=${encodeURIComponent(p.slug)}`}
                      aria-current={p.slug === slug ? "page" : undefined}
                      className={[
                        "block truncate px-3 py-1 text-sm",
                        p.slug === slug
                          ? "bg-surface-2 font-semibold text-ink"
                          : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                      ].join(" ")}
                      title={p.slug}
                    >
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* 우 — 문서 본문(또는 그래프) */}
      <article className="min-h-0 overflow-y-auto rounded-lg border border-border bg-surface px-4 py-3">
        {isGraph ? (
          <WikiGraph listing={listing} />
        ) : page ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2 text-2xs text-ink-subtle">
              <span className="rounded-sm border border-border bg-surface-2 px-1 py-px font-medium">
                {KIND_LABEL[page.kind === "server" ? "servers" : page.kind === "account" ? "accounts" : "projects"] ?? page.kind}
              </span>
              {page.meta.node && <span className="tnum">{page.meta.node}</span>}
              {page.meta.last_scan && <span className="tnum ml-auto">수집 {page.meta.last_scan}</span>}
            </div>
            {page.blocks.map((b, i) => <Block key={i} b={b} />)}
          </>
        ) : (
          <p className="py-8 text-center text-sm text-ink-subtle">
            문서를 찾을 수 없습니다 — <Link href="/wiki" className="underline underline-offset-2">목록으로</Link>
          </p>
        )}
      </article>
    </div>
  );
}

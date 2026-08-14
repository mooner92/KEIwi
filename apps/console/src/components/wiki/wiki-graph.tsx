import { parentSlug, type WikiListing } from "@/lib/wiki";

/**
 * 위키 그래프 — 서버→계정→프로젝트 3컬럼 SVG (specs/fleet-wiki §5, P2).
 * 간선은 슬러그 구조(parentSlug)에서 결정론으로 유도한다 — 문서 본문을 다시 읽지 않으므로
 * 목록(listing)만으로 그려지고, 렌더 비용이 문서 수에 선형이다. vis-network 같은 물리
 * 시뮬레이션을 쓰지 않는 이유: 계층이 3단으로 고정된 트리라 좌표가 결정론으로 나오는데
 * 물리 배치는 매 로드 다른 그림 + 신규 의존성(ADR 사안)만 남긴다.
 */

const ROW = 26; // 행 눈금 — 서비스 탭 포트 행과 같은 리듬
const COL_X = [12, 200, 420] as const; // 라벨 시작 x (서버·계정·프로젝트)
const EDGE_GAP = 14; // 라벨 끝→간선 시작 여백
const COL_W = [COL_X[1] - COL_X[0] - EDGE_GAP, COL_X[2] - COL_X[1] - EDGE_GAP, 300] as const;
const WIDTH = 760;

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

type Positioned = { slug: string; title: string; y: number };

/** 좌표 계산 (순수): 프로젝트가 행을 소비하고, 부모는 자식 y의 평균에 앉는다. */
function layout(listing: WikiListing) {
  const servers: Positioned[] = [];
  const accounts: Positioned[] = [];
  const projects: Positioned[] = [];
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  let row = 0;
  const yOf = (r: number) => r * ROW + ROW / 2;

  for (const s of listing.filter((p) => p.kind === "servers")) {
    const accs = listing.filter(
      (p) => p.kind === "accounts" && parentSlug("accounts", p.slug) === s.slug,
    );
    const accYs: number[] = [];
    for (const a of accs) {
      const projs = listing.filter(
        (p) => p.kind === "projects" && parentSlug("projects", p.slug) === a.slug,
      );
      const projYs: number[] = [];
      for (const pr of projs) {
        const y = yOf(row++);
        projYs.push(y);
        projects.push({ slug: pr.slug, title: pr.title, y });
      }
      const ay = projYs.length
        ? projYs.reduce((u, v) => u + v, 0) / projYs.length
        : yOf(row++);
      accYs.push(ay);
      accounts.push({ slug: a.slug, title: a.title, y: ay });
      for (const py of projYs)
        edges.push({ x1: COL_X[1] + COL_W[1], y1: ay, x2: COL_X[2] - 6, y2: py });
    }
    const sy = accYs.length ? accYs.reduce((u, v) => u + v, 0) / accYs.length : yOf(row++);
    servers.push({ slug: s.slug, title: s.title, y: sy });
    for (const ay of accYs)
      edges.push({ x1: COL_X[0] + COL_W[0], y1: sy, x2: COL_X[1] - 6, y2: ay });
  }
  // 고아(부모 문서 없는 계정·프로젝트)는 위 순회에서 빠진다 — 생성기가 항상 3단을 같이
  // 만들므로 정상 산출물엔 없고, 있다면 lint(깨진 링크)가 먼저 잡는 상태다.
  return { servers, accounts, projects, edges, height: Math.max(row, 1) * ROW + ROW };
}

function NodeLabel({ p, x, max, strong }: { p: Positioned; x: number; max: number; strong?: boolean }) {
  return (
    <a href={`/wiki?page=${encodeURIComponent(p.slug)}`} className="group">
      <title>{p.slug}</title>
      <circle cx={x - 6} cy={p.y} r={3} fill="currentColor" className="text-ink-subtle" />
      <text
        x={x + 4}
        y={p.y + 4}
        fill="currentColor"
        className={
          strong
            ? "text-ink text-[13px] font-semibold group-hover:underline"
            : "text-ink-muted text-[13px] group-hover:underline"
        }
      >
        {cut(p.title, max)}
      </text>
    </a>
  );
}

export function WikiGraph({ listing }: { listing: WikiListing }) {
  const g = layout(listing);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap gap-x-6 border-b border-border pb-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
        <span style={{ marginLeft: COL_X[0] }}>서버</span>
        <span style={{ marginLeft: COL_X[1] - COL_X[0] - 40 }}>계정</span>
        <span style={{ marginLeft: COL_X[2] - COL_X[1] - 40 }}>프로젝트</span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${g.height}`}
        width="100%"
        style={{ maxWidth: WIDTH }}
        role="img"
        aria-label="플릿 위키 문서 그래프 — 서버, 계정, 프로젝트 연결"
      >
        {g.edges.map((e, i) => (
          <path
            key={i}
            d={`M ${e.x1} ${e.y1} C ${(e.x1 + e.x2) / 2} ${e.y1}, ${(e.x1 + e.x2) / 2} ${e.y2}, ${e.x2} ${e.y2}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            className="text-border"
          />
        ))}
        {g.servers.map((p) => (
          <NodeLabel key={p.slug} p={p} x={COL_X[0]} max={18} strong />
        ))}
        {g.accounts.map((p) => (
          <NodeLabel key={p.slug} p={p} x={COL_X[1]} max={20} />
        ))}
        {g.projects.map((p) => (
          <NodeLabel key={p.slug} p={p} x={COL_X[2]} max={34} />
        ))}
      </svg>
    </div>
  );
}

import { getCodeGraphPath } from "@/config/env";
import {
  graphStats,
  layoutRadial,
  loadCodeGraph,
  type FileGraph,
  type PositionedNode,
} from "@/lib/code-graph";

/**
 * 코드 그래프 — 파일 단위 의존 관계를 **서버에서 SVG로 그린다**(specs/code-graph).
 *
 * 왜 서버 렌더 SVG인가: ① 신규 npm 의존성 0(그래프 라이브러리 미도입 — §I-6 지루한 기술)
 * ② JS 없이도 보인다. 이 콘솔은 하이드레이션이 죽으면 클라이언트 위젯이 통째로 무반응이
 * 되는 사고를 이미 두 번 겪었다(탭·테마) — 읽기 전용 그림을 클라이언트 상태에 걸 이유가 없다.
 * ③ 배치가 결정론적이라 같은 커밋이면 같은 그림이다(리뷰에서 diff가 의미를 갖는다).
 */

const SIZE = 1000;

function Empty({ path }: { path: string }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface p-8 text-center">
      <p className="text-base font-medium text-ink">코드 그래프 미생성</p>
      <p className="mt-1.5 max-w-lg text-sm leading-6 text-ink-subtle">
        아래 명령으로 생성하면 이 화면이 채워집니다. 로컬 AST 추출이라 <b>LLM 호출·외부 전송이
        없습니다</b>(수 초 소요). 산출물은 gitignore되는 재생성 가능한 인덱스입니다.
      </p>
      <code className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-ink">
        npm run graph:extract
      </code>
      <p className="mt-2 text-2xs text-ink-subtle">
        찾는 경로: <span className="tnum">{path}</span>
      </p>
    </div>
  );
}

function Graph({ nodes, edges }: { nodes: PositionedNode[]; edges: FileGraph["edges"] }) {
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const maxDeg = Math.max(1, ...nodes.map((n) => n.degree));
  // 라벨은 상위 10개만. nodes는 이미 연결 수 내림차순이라 앞에서 자르면 곧 허브다.
  const labelled = new Set(nodes.slice(0, 10).map((n) => n.id));
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-full w-full"
      role="img"
      aria-label={`파일 의존 그래프 — 파일 ${nodes.length}개, 의존 ${edges.length}개`}
    >
      <g>
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className="stroke-border-strong"
              strokeWidth={1}
              opacity={0.55}
            />
          );
        })}
      </g>
      <g>
        {nodes.map((n) => {
          // 반지름 = 연결 수. 색은 쓰지 않는다 — 상태가 아니라 구조를 보여주는 그림이므로
          // 유채색 예산을 쓰지 않고 크기·계조로만 위계를 만든다(디자인 v3).
          const r = 3 + 5 * Math.sqrt(n.degree / maxDeg);
          return (
            <g key={n.id}>
              <circle
                cx={n.x}
                cy={n.y}
                r={r}
                className={n.degree === 0 ? "fill-ink-faint" : "fill-ink-muted"}
              >
                <title>{`${n.file} · 연결 ${n.degree}`}</title>
              </circle>
              {/* 상위 허브만 라벨 — 전부 적으면 겹쳐서 오히려 못 읽는다(실측) */}
              {labelled.has(n.id) && (
                <text
                  x={n.x + r + 4}
                  y={n.y + 4}
                  className="fill-ink"
                  style={{ fontSize: 13, paintOrder: "stroke" }}
                >
                  {n.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export function CodeGraphView({ headCommit }: { headCommit?: string | null }) {
  const p = getCodeGraphPath();
  const graph = loadCodeGraph(p);
  if (!graph) return <Empty path={p} />;

  const s = graphStats(graph);
  const nodes = layoutRadial(graph.nodes, SIZE);
  const stale =
    headCommit && graph.commit ? !headCommit.startsWith(graph.commit.slice(0, 8)) : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* 요약 — 수치는 tnum으로 자리 고정 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span>
          파일 <span className="tnum font-medium text-ink">{s.files}</span>
        </span>
        <span>
          의존 <span className="tnum font-medium text-ink">{s.deps}</span>
        </span>
        <span>
          군집 <span className="tnum font-medium text-ink">{s.communities}</span>
        </span>
        <span>
          고립 <span className="tnum font-medium text-ink">{s.isolated}</span>
        </span>
        {graph.commit && (
          <span className="ml-auto text-2xs">
            추출 커밋 <span className="tnum">{graph.commit.slice(0, 8)}</span>
            {stale && (
              <span className="ml-1.5 rounded-sm border border-warn-border bg-warn-bg px-1 text-warn-ink">
                현재 코드와 다름 — 재생성 필요
              </span>
            )}
          </span>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_260px]">
        <section className="min-h-[420px] overflow-hidden rounded-lg border border-border bg-surface">
          <Graph nodes={nodes} edges={graph.edges} />
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
          <header className="border-b border-border bg-surface-2 px-3 py-1.5">
            <h3 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
              연결 많은 파일
            </h3>
          </header>
          <ul className="min-h-0 divide-y divide-border-subtle overflow-y-auto">
            {s.hubs.map((h) => (
              <li key={h.id} className="flex items-baseline justify-between gap-2 px-3 py-1.5">
                <span className="truncate text-xs text-ink" title={h.file}>
                  {h.label}
                </span>
                <span className="tnum shrink-0 text-2xs text-ink-subtle">{h.degree}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-3 py-1.5 text-2xs leading-4 text-ink-subtle">
            원 크기·중심에 가까울수록 연결이 많습니다. <b>고립 파일 {s.isolated}개</b>(스크립트·
            설정 등 의존 간선 0)는 그림에서 제외했습니다 — 간선이 없어 정보를 더하지 않고
            노이즈만 늘립니다. 상태가 아니라 구조를 보여주는 그림이라 유채색을 쓰지 않습니다.
          </p>
        </section>
      </div>
    </div>
  );
}

import { getCodeGraphPath } from "@/config/env";
import { graphStats, loadCodeGraph } from "@/lib/code-graph";

/**
 * 코드 그래프 — graphify의 **인터랙티브 시각화(graph.html)를 액자로 임베드**한다
 * (Grafana 임베드와 같은 패턴 — specs/design/04-patterns 외부 임베드 액자화).
 *
 * 수제 SVG 재구현은 하지 않는다. 한 번 해봤고 두 가지로 실패했다: ① 정적 점구름은
 * 900노드급 구조를 읽을 수 없었고 ② 심볼 병합을 잘못 귀속해 가짜 의존까지 그렸다.
 * 시각화는 graphify가 소유하고, 콘솔은 **요약 수치·허브 목록·신선도 판정**만 얹는다 —
 * 재구현 금지 원칙(§I-2)을 콘솔 자신에게도 적용한 것이다.
 */

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

export function CodeGraphView({ headCommit }: { headCommit?: string | null }) {
  const p = getCodeGraphPath();
  const graph = loadCodeGraph(p);
  if (!graph) return <Empty path={p} />;

  const s = graphStats(graph);
  const stale =
    headCommit && graph.commit ? !headCommit.startsWith(graph.commit.slice(0, 8)) : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* 요약 — 수치는 tnum으로 자리 고정. 시각화가 못 담는 판정(신선도·고립)을 여기서 준다 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span>
          파일 <span className="tnum font-medium text-ink">{s.files}</span>
        </span>
        <span>
          파일 간 의존 <span className="tnum font-medium text-ink">{s.deps}</span>
        </span>
        <span>
          고립 <span className="tnum font-medium text-ink">{s.isolated}</span>
          <span className="ml-1 text-2xs text-ink-subtle">(셸·설정 등 import 없음)</span>
        </span>
        <span className="text-2xs text-ink-subtle">
          허브: {s.hubs.slice(0, 5).map((h) => h.label).join(" · ")}
        </span>
        {graph.commit && (
          <span className="ml-auto text-2xs">
            추출 커밋 <span className="tnum">{graph.commit.slice(0, 8)}</span>
            {stale && (
              <span className="ml-1.5 rounded-sm border border-warn-border bg-warn-bg px-1 text-warn-ink">
                현재 코드와 다름 — <span className="tnum">npm run graph:extract</span>
              </span>
            )}
          </span>
        )}
      </div>

      {/* 액자(frame): 1px 보더 + 8px 반경 + 그림자 0 — Grafana 임베드와 동일 문법.
          내부는 graphify 소유(vis-network 인터랙티브: 드래그·줌·검색·커뮤니티 토글). */}
      <div className="min-h-[560px] flex-1 overflow-hidden rounded-lg border border-border bg-surface">
        <iframe
          src="/api/code-graph"
          title="graphify 코드 그래프"
          loading="lazy"
          className="h-full w-full"
          suppressHydrationWarning
        />
      </div>
      <p className="px-1 text-2xs text-ink-subtle">
        그래프 화면은 graphify 산출물(vis-network) 그대로입니다 — 드래그·줌·노드 클릭으로
        탐색하세요. 그래프가 비어 보이면 브라우저가 unpkg CDN(vis-network 라이브러리)에 접근할
        수 있는지 확인하세요. 심층 질의는 터미널에서:{" "}
        <span className="tnum">graphify explain &quot;이름&quot;</span> ·{" "}
        <span className="tnum">graphify path &quot;A&quot; &quot;B&quot;</span>
      </p>
    </div>
  );
}

import Link from "next/link";
import {
  queryCapacity,
  queryGpuModels,
  queryListeningPorts,
  aggregateGpuModels,
  type GpuModelAgg,
  type ListeningPort,
} from "@/lib/prometheus";
import { loadInventory } from "@/lib/inventory";
import { isGpuProbeSuspect } from "@/lib/model-ops";
import { wikiCoveredNodes, wikiPortIndex } from "@/lib/wiki";
import { getWikiDir } from "@/config/env";
import { endpointLabel } from "@/config/known-endpoints";

const gib = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GiB`;

/**
 * 서비스 맵 v2.1 — 노드(또는 플릿)에서 "무엇이 어디서 도는가": 좌 GPU 프로세스 / 우 리스닝 포트.
 * 2컬럼(Notion형) 조밀 레이아웃, 세로 스크롤 없이(컬럼 내부 스크롤). 포트 행 클릭 → 어시스턴트 상태/로그.
 * 데이터=Prometheus(gpu_model_* 집계·keiwi_listening_port_info). 신규 콘솔 수집 0. specs/service-map.
 */
export async function ServiceTable({ node }: { node?: string }) {
  const fleet = !node;
  let models: GpuModelAgg[] = [];
  let ports: ListeningPort[] = [];
  try {
    models = aggregateGpuModels(await queryGpuModels(node));
  } catch {
    models = [];
  }
  try {
    ports = await queryListeningPorts(node);
  } catch {
    ports = [];
  }

  // (P2) 포트 → 위키 문서 색인. null = 위키 미생성 — 그때는 배지를 만들지 않는다.
  // "미등록" 배지는 **위키가 커버하는 노드에서만** 단다 — scout 미배포 노드까지 칠하면
  // 배지 도배가 되어 신호 가치가 0이다(wikiCoveredNodes 주석의 실측).
  const portDocs = wikiPortIndex(getWikiDir());
  const wikiNodes = portDocs ? wikiCoveredNodes(portDocs) : new Set<string>();

  // 모델 0건이 "유휴"인지 "수집 실패"인지 가른다. gpu-model-exporter는 nvidia-smi에 의존해
  // 드라이버 커널↔유저스페이스 불일치 시 조용히 0건이 되는데, DCGM은 커널모듈 값을 읽어
  // VRAM을 정상 보고한다 → 둘의 모순이 곧 수집 실패 신호다(2026-08-12 data03 실측).
  //
  // ⚠️ 판정은 **반드시 노드 단위**다. 임계(2 GiB)가 "카드당 유휴 베이스라인 0.5 GiB"에서
  // 나온 값이라, 플릿 합계를 먹이면 카드가 여러 장인 순간 상시 오탐이 된다. 반대로
  // "전체 모델 0건"을 조건으로 걸면 노드 A만 정상이어도 노드 B의 수집 실패를 놓친다
  // — 원래 잡으려던 시나리오가 바로 그것이다.
  const suspects = await (async (): Promise<string[]> => {
    try {
      const [cap, inv] = await Promise.all([queryCapacity(), loadInventory()]);
      const nodeByIp = new Map(inv.map((n) => [n.ip, n.id]));
      const usedByNode = new Map<string, number>();
      for (const s of cap.gpuVramUsedMib ?? []) {
        const id = nodeByIp.get(s.instance.split(":")[0] ?? "");
        if (!id || (node && id !== node)) continue;
        usedByNode.set(id, (usedByNode.get(id) ?? 0) + s.value / 1024);
      }
      const modelsByNode = new Map<string, number>();
      for (const m of models) modelsByNode.set(m.node, (modelsByNode.get(m.node) ?? 0) + 1);
      return [...usedByNode.entries()]
        .filter(([id, gib]) => isGpuProbeSuspect(gib, modelsByNode.get(id) ?? 0))
        .map(([id]) => id)
        .sort();
    } catch {
      return []; // 모르면 단정하지 않는다
    }
  })();

  const NodeBadge = ({ n }: { n: string }) =>
    fleet && n ? (
      <span className="tnum shrink-0 rounded-sm bg-surface-2 px-1 text-2xs text-ink-subtle">{n}</span>
    ) : null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
      {/* 좌 — GPU 프로세스(모델) */}
      <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        {/* 표 헤더 문법: 면(surface-2) + 11px 대문자 자간 — 컬럼 라벨이지 제목이 아니므로
            초록 틱을 걷어내고 잉크 계조만으로 낮춘다(초록 예산제). */}
        <header className="flex items-baseline justify-between gap-2 border-b border-border bg-surface-2 px-3 py-1.5">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
            GPU 프로세스
          </h3>
          <span className="tnum text-2xs text-ink-subtle">{models.length}</span>
        </header>
        {/* 수집 실패 노드는 목록 유무와 무관하게 알린다 — 다른 노드가 정상이라고
            한 노드의 실패가 가려져서는 안 된다(거짓 초록). */}
        {suspects.length > 0 && (
          <div className="border-b border-warn-border bg-warn-bg px-3 py-2">
            <p className="text-xs font-medium text-warn-ink">
              판정불가 — 프로세스 수집 실패: <span className="tnum">{suspects.join(", ")}</span>
            </p>
            <p className="mt-0.5 text-2xs leading-4 text-ink-subtle">
              DCGM은 VRAM 사용을 보고하는데 그 노드의 프로세스 목록이 비었습니다.
              gpu-model-exporter가 GPU를 읽지 못하는 상태입니다(드라이버 커널↔유저스페이스
              불일치 등) — 런북 <span className="tnum">nvidia-driver-mismatch</span>.
            </p>
          </div>
        )}
        {models.length === 0 ? (
          suspects.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-ink-subtle">GPU에 적재된 프로세스 없음</p>
          )
        ) : (
          <ul className="min-h-0 divide-y divide-border-subtle overflow-y-auto">
            {models.map((mm, i) => (
              <li key={`${mm.node}-${mm.framework}-${mm.model}-${i}`} className="px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <NodeBadge n={mm.node} />
                    <span className="truncate text-sm text-ink">{mm.model}</span>
                  </span>
                  <span className="tnum shrink-0 text-sm text-ink-muted">
                    {gib(mm.vramBytes)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-subtle">
                  <span>
                    {mm.framework}
                    {/* 소유자(OS 계정) — "이 모델 누구 거냐" 문의 대처용이라 메타 중 유일하게
                        읽히는 값이어야 한다. 12px + 계조 한 단 위(ink-muted)로 올린다. */}
                    {mm.user !== "unknown" ? (
                      <span className="tnum text-ink-muted"> · {mm.user}</span>
                    ) : null}
                  </span>
                  <span className="tnum">GPU {mm.gpus.join(",")}</span>
                  {mm.ports.length ? <span className="tnum">:{mm.ports.join(" :")}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 우 — 리스닝 포트 (핵심). 행 클릭 → 어시스턴트 상태/로그 */}
      <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <header className="flex items-baseline justify-between gap-2 border-b border-border bg-surface-2 px-3 py-1.5">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
            리스닝 포트
          </h3>
          <span className="tnum text-2xs text-ink-subtle">{ports.length}</span>
        </header>
        {ports.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-subtle">
            포트 데이터 없음 — port-exporter 배포 필요(node-onboarding 런북).
          </p>
        ) : (
          <ul className="min-h-0 divide-y divide-border-subtle overflow-y-auto">
            {ports.map((p, i) => {
              const known = endpointLabel(p.port);
              const q = `${p.node || node || ""} ${p.process} 포트 ${p.port} 최근 상태`.trim();
              // (P2) 위키 매칭 — 문서가 있으면 링크, 커버 노드의 비매칭만 "미등록".
              const rowNode = p.node || node || "";
              const wikiSlug = portDocs?.[`${rowNode}:${p.port}`];
              return (
                <li key={`${p.proto}-${p.port}-${p.pid}-${i}`} className="flex items-stretch">
                  <Link
                    href={`/incidents?q=${encodeURIComponent(q)}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-surface-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <NodeBadge n={p.node} />
                      <span className="tnum font-medium text-ink">:{p.port}</span>
                      <span className="text-2xs uppercase text-ink-subtle">{p.proto}</span>
                      <span className="truncate text-ink-muted">{p.process}</span>
                      {/* 소유자(OS 계정) — "이 서비스 누구 거냐" 문의 대처용. unknown이면 생략 */}
                      {p.user !== "unknown" ? (
                        <span className="tnum shrink-0 text-xs text-ink-subtle">{p.user}</span>
                      ) : null}
                      {!wikiSlug && wikiNodes.has(rowNode) ? (
                        <span
                          className="shrink-0 rounded-sm border border-dashed border-border px-1 text-2xs text-ink-subtle"
                          title="플릿 위키에 문서가 없는 포트 — 새로 열렸거나 문서화 누락(specs/fleet-wiki §5)"
                        >
                          미등록
                        </span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {known ? <span className="text-xs text-ink-subtle">{known}</span> : null}
                      <span aria-hidden className="text-ink-faint">
                        →
                      </span>
                    </span>
                  </Link>
                  {wikiSlug ? (
                    // 형제 앵커 — 행 링크(어시스턴트) 안에 중첩하지 않는다(HTML 유효성).
                    <Link
                      href={`/wiki?page=${encodeURIComponent(wikiSlug)}`}
                      className="flex shrink-0 items-center border-l border-border-subtle px-2.5 text-2xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
                      title={`위키 문서: ${wikiSlug}`}
                    >
                      위키
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

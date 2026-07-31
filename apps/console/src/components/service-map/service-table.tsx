import Link from "next/link";
import {
  queryGpuModels,
  queryListeningPorts,
  aggregateGpuModels,
  type GpuModelAgg,
  type ListeningPort,
} from "@/lib/prometheus";
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
        {models.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-subtle">GPU에 적재된 프로세스 없음</p>
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
              return (
                <li key={`${p.proto}-${p.port}-${p.pid}-${i}`}>
                  <Link
                    href={`/incidents?q=${encodeURIComponent(q)}`}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-surface-2"
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
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {known ? <span className="text-xs text-ink-subtle">{known}</span> : null}
                      <span aria-hidden className="text-ink-faint">
                        →
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

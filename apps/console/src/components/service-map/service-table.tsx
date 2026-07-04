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
      <span className="tnum shrink-0 rounded-sm bg-surface-2 px-1 text-[10px] text-ink-subtle">{n}</span>
    ) : null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
      {/* 좌 — GPU 프로세스(모델) */}
      <section className="flex min-h-0 flex-col rounded-lg border border-border bg-surface shadow-1">
        <header className="border-b border-border px-3 py-2">
          <h3 className="font-display text-sm font-semibold text-ink">
            {/* KRDS 패널 헤더 좌측 브랜드 틱 — 워크벤치 "현재 신호"와 동일 문법(일관성) */}
            <span
              aria-hidden
              className="mr-2 inline-block h-3.5 w-[3px] rounded-full bg-brand align-[-2px]"
            />
            GPU 프로세스 <span className="font-normal text-ink-muted">· {models.length}</span>
          </h3>
        </header>
        {models.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">GPU에 적재된 프로세스 없음</p>
        ) : (
          <ul className="min-h-0 divide-y divide-border overflow-y-auto">
            {models.map((mm, i) => (
              <li key={`${mm.node}-${mm.framework}-${mm.model}-${i}`} className="px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <NodeBadge n={mm.node} />
                    <span className="truncate text-sm text-ink">{mm.model}</span>
                  </span>
                  <span className="tnum shrink-0 text-xs font-medium text-ink-muted">
                    {gib(mm.vramBytes)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-subtle">
                  <span>
                    {mm.framework}
                    {/* 소유자(OS 계정) — "이 모델 누구 거냐" 문의 대처용. unknown이면 생략 */}
                    {mm.user !== "unknown" ? <span className="tnum text-ink-subtle"> · {mm.user}</span> : null}
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
      <section className="flex min-h-0 flex-col rounded-lg border border-border bg-surface shadow-1">
        <header className="border-b border-border px-3 py-2">
          <h3 className="font-display text-sm font-semibold text-ink">
            {/* KRDS 패널 헤더 좌측 브랜드 틱 — 워크벤치 "현재 신호"와 동일 문법(일관성) */}
            <span
              aria-hidden
              className="mr-2 inline-block h-3.5 w-[3px] rounded-full bg-brand align-[-2px]"
            />
            리스닝 포트 <span className="font-normal text-ink-muted">· {ports.length}</span>
          </h3>
        </header>
        {ports.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">
            포트 데이터 없음 — port-exporter 배포 필요(node-onboarding 런북).
          </p>
        ) : (
          <ul className="min-h-0 divide-y divide-border overflow-y-auto">
            {ports.map((p, i) => {
              const known = endpointLabel(p.port);
              const q = `${p.node || node || ""} ${p.process} 포트 ${p.port} 최근 상태`.trim();
              return (
                <li key={`${p.proto}-${p.port}-${p.pid}-${i}`}>
                  <Link
                    href={`/incidents?q=${encodeURIComponent(q)}`}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-surface-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <NodeBadge n={p.node} />
                      <span className="tnum text-ink">:{p.port}</span>
                      <span className="text-ink-subtle">{p.proto}</span>
                      <span className="truncate text-ink-muted">{p.process}</span>
                      {/* 소유자(OS 계정) — "이 서비스 누구 거냐" 문의 대처용. unknown이면 생략 */}
                      {p.user !== "unknown" ? (
                        <span className="tnum shrink-0 text-[11px] text-ink-subtle">{p.user}</span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {known ? <span className="text-[11px] text-info-700">{known}</span> : null}
                      <span className="text-ink-subtle">→</span>
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

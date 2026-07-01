import Link from "next/link";
import { getNodeServices, type NodeService } from "@/lib/service-catalog";
import {
  queryGpuModels,
  queryListeningPorts,
  type GpuModel,
  type ListeningPort,
} from "@/lib/prometheus";
import { endpointLabel } from "@/config/known-endpoints";

// 카테고리 색(ADR-0010 분류축) — KRDS 토큰만.
const CAT: Record<string, string> = {
  gpu: "text-info-700",
  web: "text-success-700",
  infra: "text-ink-muted",
  system: "text-ink-subtle",
  "user-session": "text-warning-700",
  unknown: "text-ink-subtle",
};

const gib = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GiB`;

/**
 * 서비스 맵 — 노드별 서비스/모델/포트 카탈로그(서버 컴포넌트, 읽기 전용).
 * 행 → 어시스턴트(/incidents?service&node) 진단. 신규 수집 0(OpenSearch·Prometheus 재사용).
 * Overview 노드 드릴다운의 "서비스" 탭에서 렌더(ADR-0017, specs/service-map).
 */
export async function ServiceTable({ node }: { node: string }) {
  let services: NodeService[] = [];
  let models: GpuModel[] = [];
  let ports: ListeningPort[] = [];
  try {
    services = await getNodeServices(node);
  } catch {
    services = [];
  }
  try {
    models = await queryGpuModels(node);
  } catch {
    models = [];
  }
  try {
    ports = await queryListeningPorts(node);
  } catch {
    ports = [];
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      {/* GPU 적재 모델 */}
      {models.length > 0 ? (
        <section className="rounded-xl border border-border bg-surface shadow-1">
          <header className="border-b border-border px-3 py-2">
            <h3 className="font-display text-sm font-semibold text-ink">
              GPU 적재 모델{" "}
              <span className="font-normal text-ink-muted">· {models.length}</span>
            </h3>
          </header>
          <ul className="divide-y divide-border">
            {models.map((m, i) => (
              <li key={`${m.gpu}-${m.port}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                <span className="min-w-0 truncate text-ink">
                  <span className="tnum text-ink-subtle">GPU {m.gpu}</span> · {m.model}
                </span>
                <span className="tnum shrink-0 text-ink-muted">
                  {m.framework}
                  {m.port ? ` :${m.port}` : ""} · {gib(m.vramBytes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 리스닝 포트 ↔ 프로세스 (port-exporter, v2) */}
      {ports.length > 0 ? (
        <section className="flex min-h-0 flex-col rounded-xl border border-border bg-surface shadow-1">
          <header className="border-b border-border px-3 py-2">
            <h3 className="font-display text-sm font-semibold text-ink">
              리스닝 포트{" "}
              <span className="font-normal text-ink-muted">· {ports.length}</span>
            </h3>
          </header>
          <ul className="divide-y divide-border overflow-y-auto">
            {ports.map((p, i) => {
              const known = endpointLabel(p.port);
              return (
                <li
                  key={`${p.proto}-${p.port}-${p.pid}-${i}`}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="tnum text-ink">:{p.port}</span>
                    <span className="text-ink-subtle">{p.proto}</span>
                    <span className="truncate text-ink-muted">{p.process}</span>
                  </span>
                  {known ? (
                    <span className="shrink-0 text-[11px] text-info-700">{known}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* 서비스 카탈로그 */}
      <section className="flex min-h-0 flex-col rounded-xl border border-border bg-surface shadow-1">
        <header className="border-b border-border px-3 py-2">
          <h3 className="font-display text-sm font-semibold text-ink">
            서비스{" "}
            <span className="font-normal text-ink-muted">· 최근 24시간 · {services.length}</span>
          </h3>
        </header>
        {services.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">
            이 노드의 최근 로그가 없습니다(수집 미설정 또는 무활동).
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-y-auto">
            {services.map((s) => {
              const port = endpointLabel(s.service.match(/(\d{2,5})/)?.[1]);
              const href =
                `/incidents?service=${encodeURIComponent(s.service)}` +
                `&node=${encodeURIComponent(node)}` +
                `&q=${encodeURIComponent(s.service + " 최근 상태")}`;
              return (
                <li key={s.service} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-ink">{s.service}</span>
                    <span className={`shrink-0 text-[11px] ${CAT[s.category] ?? "text-ink-subtle"}`}>
                      {s.category}
                    </span>
                    {port ? (
                      <span className="tnum shrink-0 text-[11px] text-ink-subtle">· {port}</span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {s.errorCount > 0 ? (
                      <span className="tnum text-[11px] font-semibold text-danger-700">
                        err {s.errorCount}
                      </span>
                    ) : null}
                    {s.warnCount > 0 ? (
                      <span className="tnum text-[11px] font-semibold text-warning-700">
                        warn {s.warnCount}
                      </span>
                    ) : null}
                    <Link
                      href={href}
                      className="text-xs font-medium text-info-700 underline underline-offset-2"
                    >
                      로그·진단 →
                    </Link>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

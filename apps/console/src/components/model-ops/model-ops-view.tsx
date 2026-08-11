import { getModelOpsDir } from "@/config/env";
import { loadInventory } from "@/lib/inventory";
import {
  queryCapacity,
  queryGpuModels,
  queryInstalledModelCatalog,
  type GpuModel,
} from "@/lib/prometheus";
import {
  judgeModelFit,
  listInstalledModels,
  type InstalledModel,
  type ModelFit,
} from "@/lib/model-ops";

/**
 * 모델 운영 v1 — 서빙 가시화 + 노드별 설치 카탈로그(전수조사) + VRAM 사전판정
 * (specs/model-ops §2 US1~US3). 읽기 전용 — 기동/정지는 v1.5(ADR-0027 결정 후).
 *
 * 카탈로그 데이터원 우선순위: ① keiwi_installed_model_size_bytes(각 노드의
 * model-catalog textfile 수집기 — 플릿 전수조사) ② 수집기 미배포 전환기의 data05는
 * 로컬 디스크 스캔 폴백. 신규 콘솔 수집 0.
 */

type GpuRow = {
  node: string;
  gpu: string;
  usedGib: number | null;
  totalGib: number | null;
  freeMib: number | null;
  totalMib: number | null;
  serving: GpuModel[];
};

type NodeCatalog = {
  node: string;
  source: "수집기" | "로컬 스캔";
  models: (InstalledModel & { origin?: string })[];
};

const gib = (mib: number | null) => (mib == null ? "?" : (mib / 1024).toFixed(1));
const bytesGib = (b: number) => (b / 1024 ** 3).toFixed(1);

async function collect(): Promise<{ gpus: GpuRow[]; catalogs: NodeCatalog[] }> {
  const [inventory, capacity, serving, promCatalog] = await Promise.all([
    loadInventory().catch(() => []),
    queryCapacity().catch(() => null),
    queryGpuModels().catch(() => [] as GpuModel[]),
    queryInstalledModelCatalog().catch(() => []),
  ]);
  const nodeByIp = new Map(inventory.map((n) => [n.ip, n.id]));
  const nodeOf = (instance: string) => nodeByIp.get(instance.split(":")[0] ?? "") ?? instance;

  const rows = new Map<string, GpuRow>();
  for (const s of capacity?.gpuVramTotalMib ?? []) {
    const node = nodeOf(s.instance);
    rows.set(`${node}/${s.gpu}`, {
      node,
      gpu: s.gpu,
      totalMib: s.value,
      totalGib: s.value / 1024,
      usedGib: null,
      freeMib: null,
      serving: [],
    });
  }
  for (const s of capacity?.gpuVramUsedMib ?? []) {
    const row = rows.get(`${nodeOf(s.instance)}/${s.gpu}`);
    if (row) {
      row.usedGib = s.value / 1024;
      if (row.totalMib != null) row.freeMib = row.totalMib - s.value;
    }
  }
  for (const m of serving) {
    const row = rows.get(`${m.node}/${m.gpu}`);
    if (row) row.serving.push(m);
  }
  const gpus = [...rows.values()].sort(
    (a, b) => a.node.localeCompare(b.node) || a.gpu.localeCompare(b.gpu),
  );

  // 노드별 카탈로그 — 수집기 메트릭 우선, 미배포 전환기의 data05만 로컬 스캔 폴백.
  const byNode = new Map<string, NodeCatalog>();
  for (const m of promCatalog) {
    const node = nodeOf(m.instance);
    const entry = byNode.get(node) ?? { node, source: "수집기" as const, models: [] };
    entry.models.push({
      name: m.name,
      sizeBytes: m.sizeBytes,
      format: (["safetensors", "gguf"].includes(m.format) ? m.format : "unknown") as InstalledModel["format"],
      origin: m.source,
    });
    byNode.set(node, entry);
  }
  if (!byNode.has("data05")) {
    const local = listInstalledModels(getModelOpsDir());
    if (local.length > 0) byNode.set("data05", { node: "data05", source: "로컬 스캔", models: local });
  }
  const catalogs = [...byNode.values()]
    .map((c) => ({ ...c, models: c.models.sort((a, b) => b.sizeBytes - a.sizeBytes) }))
    .sort((a, b) => a.node.localeCompare(b.node));
  return { gpus, catalogs };
}

function VerdictBadge({ fit }: { fit: ModelFit }) {
  // v3 규칙: 정상·가능=무채색(색 예산제), 색은 경고·위험에만. 색 단독 금지 — 텍스트 병행.
  const cls: Record<ModelFit["verdict"], string> = {
    ok: "border-border bg-surface-2 text-ink",
    tight: "border-warn-border bg-warn-bg text-warn-ink",
    no: "border-danger-border bg-danger-bg text-danger-ink",
    unknown: "border-dashed border-border text-ink-subtle",
  };
  const label: Record<ModelFit["verdict"], string> = {
    ok: "가능",
    tight: fit.suggestedUtil != null ? `빠듯 · util ${fit.suggestedUtil}` : "빠듯",
    no: "불가",
    unknown: "판정불가",
  };
  return (
    <span
      title={fit.reason}
      className={`tnum inline-block whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-2xs ${cls[fit.verdict]}`}
    >
      {label[fit.verdict]}
    </span>
  );
}

function CatalogSection({ catalog, gpus }: { catalog: NodeCatalog; gpus: GpuRow[] }) {
  const targets = gpus.filter((g) => g.node === catalog.node);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <header className="flex items-baseline justify-between border-b border-border bg-surface-2 px-3 py-1.5">
        <h3 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
          설치된 모델 — {catalog.node}
          <span className="ml-1.5 font-normal normal-case">({catalog.source})</span>
        </h3>
        <span className="tnum text-2xs text-ink-subtle">{catalog.models.length}</span>
      </header>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-ink-subtle">
            <th className="px-3 py-1.5 font-semibold">모델</th>
            <th className="tnum px-2 py-1.5 text-right font-semibold">크기</th>
            {targets.map((g) => (
              <th key={g.gpu} className="px-2 py-1.5 font-semibold">
                GPU{g.gpu} 판정
              </th>
            ))}
            {targets.length === 0 && <th className="px-2 py-1.5 font-semibold">판정</th>}
          </tr>
        </thead>
        <tbody>
          {catalog.models.map((m) => (
            <tr key={`${m.origin ?? "dir"}/${m.name}`} className="border-b border-border last:border-b-0">
              <td className="max-w-0 truncate px-3 py-1.5 text-ink" title={`${m.name} (${m.format})`}>
                {m.name}
                {m.origin === "ollama" && <span className="ml-1.5 text-2xs text-ink-subtle">ollama</span>}
              </td>
              <td className="tnum whitespace-nowrap px-2 py-1.5 text-right text-ink-muted">
                {bytesGib(m.sizeBytes)} GiB
              </td>
              {targets.map((g) => (
                <td key={g.gpu} className="px-2 py-1.5">
                  <VerdictBadge
                    fit={judgeModelFit({ weightsBytes: m.sizeBytes, freeMib: g.freeMib, totalMib: g.totalMib })}
                  />
                </td>
              ))}
              {targets.length === 0 && (
                <td className="px-2 py-1.5">
                  <VerdictBadge
                    fit={judgeModelFit({ weightsBytes: m.sizeBytes, freeMib: null, totalMib: null })}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-1.5 text-2xs text-ink-subtle">
        {targets.length === 0
          ? "이 노드는 GPU VRAM 메트릭이 없어 판정불가로 표기됩니다(DCGM 결손)."
          : `여유 ${targets.map((g) => `GPU${g.gpu} ${gib(g.freeMib)} GiB`).join(" · ")} 기준 판정.`}
      </p>
    </section>
  );
}

export async function ModelOpsView() {
  const { gpus, catalogs } = await collect();

  return (
    <div className="flex flex-col gap-3">
      {/* ── 서빙 중 — 노드×GPU 격자 ── */}
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <header className="flex items-baseline justify-between border-b border-border bg-surface-2 px-3 py-1.5">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
            서빙 중 — GPU별 적재 모델
          </h3>
          <span className="tnum text-2xs text-ink-subtle">{gpus.length} GPU</span>
        </header>
        {gpus.length === 0 ? (
          <p className="px-3 py-4 text-xs text-ink-subtle">
            GPU VRAM 메트릭이 없습니다(DCGM 결손) — 판정불가. Prometheus 타깃을 확인하세요.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
            {gpus.map((g) => (
              <li key={`${g.node}/${g.gpu}`} className="flex flex-col gap-1 bg-surface px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-ink">
                    {g.node} · GPU{g.gpu}
                  </span>
                  <span className="tnum text-2xs text-ink-muted">
                    {g.usedGib == null ? "?" : g.usedGib.toFixed(1)}/{g.totalGib == null ? "?" : g.totalGib.toFixed(1)} GiB
                  </span>
                </div>
                {g.serving.length === 0 ? (
                  <span className="text-2xs text-ink-subtle">적재 모델 없음</span>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {g.serving.map((m) => (
                      <li key={`${m.model}/${m.port}`} className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-2xs text-ink" title={m.model}>
                          {m.model}
                        </span>
                        <span className="tnum shrink-0 text-2xs text-ink-subtle">
                          :{m.port}
                          {m.user !== "unknown" ? ` · ${m.user}` : ""} · {bytesGib(m.vramBytes)} GiB
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 노드별 설치 카탈로그 + 사전판정 (전수조사) ── */}
      {catalogs.length === 0 ? (
        <section className="rounded-lg border border-border bg-surface px-3 py-4">
          <p className="text-xs text-ink-subtle">
            설치 모델 카탈로그가 비어 있습니다 — model-catalog 수집기 미배포(전 노드) 또는 스캔
            디렉터리 접근 불가. 배포: <code className="tnum">ansible-playbook playbooks/agents.yml --tags model-catalog</code>
          </p>
        </section>
      ) : (
        catalogs.map((c) => <CatalogSection key={c.node} catalog={c} gpus={gpus} />)
      )}
      <p className="px-1 text-2xs text-ink-subtle">
        판정은 현재 여유 VRAM 대비 추정(가중치 ×1.1 · vLLM 예약 util 0.9 기준) — 근거 수치는 배지에
        마우스를 올리면 표시. 기동·정지는 v1.5(ADR-0027)에서 추가된다.
      </p>
    </div>
  );
}

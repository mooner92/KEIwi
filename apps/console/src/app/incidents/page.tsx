import { Breadcrumb } from "@/components/shell/breadcrumb";
import { PageHeader } from "@/components/shell/page-header";
import { CurrentSignals } from "@/components/signals/current-signals";
import {
  AssistantPanel,
  type AssistantInitial,
} from "@/components/assistant/assistant-panel";
import { buildAlertQuestion } from "@/lib/alert-presets";
import { normalizeFleetNode } from "@/lib/fleet-node";
import { loadInventory } from "@/lib/inventory";

// OpenSearch/vLLM·env 의존 → 정적 프리렌더 금지.
export const dynamic = "force-dynamic";

/**
 * 로그 어시스턴트 — 보류 M4(/incidents) 자리를 전용(ADR-0012/0014).
 * 좌: 현재 신호(에러 진입점) · 우: 어시스턴트(로컬 vLLM RAG). "분석" → ?service&node&q prefill.
 * 알림 딥링크(specs/alert-enrichment §2 E2): ?alert&node&mount&from — alert는 프리셋 질문으로,
 * node는 Grafana instance 라벨(`192.0.2.104:9100`)까지 흡수해 노드 id로 정규화.
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{
    service?: string;
    node?: string;
    q?: string;
    alert?: string;
    mount?: string;
    from?: string;
  }>;
}) {
  const p = await searchParams;

  // node 정규화 — inventory 로드 실패가 착지 자체를 막으면 안 된다(딥링크 실패 격리) → 원문 폴백.
  let fleetNode = p.node;
  if (p.node) {
    try {
      fleetNode = normalizeFleetNode(p.node, await loadInventory()) ?? p.node;
    } catch {
      /* 원문 그대로 사용 */
    }
  }

  // q(사람이 쓴 질문)가 항상 우선 — alert 프리셋은 q가 없을 때만(하위호환).
  const message =
    p.q ?? (p.alert ? buildAlertQuestion(p.alert, { node: fleetNode, mount: p.mount }) : undefined);
  const initial: AssistantInitial | undefined =
    p.service || message
      ? { service: p.service, fleetNode, message, from: p.from }
      : undefined;

  return (
    <div className="flex h-full flex-col gap-2">
      {/* breadcrumb→H1 간격은 전 페이지 gap-1.5로 통일(04 여백 리듬 일관성) */}
      <div className="flex flex-col gap-1.5">
        <Breadcrumb />
        <PageHeader title="로그 어시스턴트" />
      </div>
      <p className="text-xs text-ink-muted">
        에러를 골라 로컬 LLM으로 근거와 함께 진단합니다. 외부 전송 없음 · 읽기 전용(조치 자동적용 안 함).
      </p>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <CurrentSignals />
        {/* 신호가 바뀌면 remount → 새 신호로 재분석(같은 라우트라 key 없으면 재실행 안 됨) */}
        <AssistantPanel
          key={`${p.service ?? ""}|${p.node ?? ""}|${p.from ?? ""}|${(message ?? "").slice(0, 48)}`}
          initial={initial}
        />
      </div>
    </div>
  );
}

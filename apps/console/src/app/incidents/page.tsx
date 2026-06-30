import { Breadcrumb } from "@/components/shell/breadcrumb";
import { PageHeader } from "@/components/shell/page-header";
import { CurrentSignals } from "@/components/signals/current-signals";
import {
  AssistantPanel,
  type AssistantInitial,
} from "@/components/assistant/assistant-panel";

// OpenSearch/vLLM·env 의존 → 정적 프리렌더 금지.
export const dynamic = "force-dynamic";

/**
 * 로그 어시스턴트 — 보류 M4(/incidents) 자리를 전용(ADR-0012/0014).
 * 좌: 현재 신호(에러 진입점) · 우: 어시스턴트(로컬 vLLM RAG). "분석" → ?service&node&q prefill.
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; node?: string; q?: string }>;
}) {
  const p = await searchParams;
  const initial: AssistantInitial | undefined =
    p.service || p.q
      ? { service: p.service, fleetNode: p.node, message: p.q }
      : undefined;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-col gap-1">
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
          key={`${p.service ?? ""}|${p.node ?? ""}|${(p.q ?? "").slice(0, 48)}`}
          initial={initial}
        />
      </div>
    </div>
  );
}

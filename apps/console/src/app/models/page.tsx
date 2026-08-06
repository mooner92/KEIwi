import { Breadcrumb } from "@/components/shell/breadcrumb";
import { ModelOpsView } from "@/components/model-ops/model-ops-view";

// Prometheus·디스크 실측을 매 요청 조회 — 정적 캐시 금지.
export const dynamic = "force-dynamic";

export default function ModelsPage() {
  return (
    <div className="flex flex-col gap-2">
      <Breadcrumb />
      <ModelOpsView />
    </div>
  );
}

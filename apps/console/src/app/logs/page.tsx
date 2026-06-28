import { Breadcrumb } from "@/components/shell/breadcrumb";
import { PageHeader } from "@/components/shell/page-header";
import { LogsEmbed } from "@/components/grafana/logs-embed";

// 로그 대시보드/env는 요청 시점에 (정적 프리렌더 금지)
export const dynamic = "force-dynamic";

export default function LogsPage() {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Breadcrumb />
        <PageHeader
          title="통합 로그"
          description="플릿 로그 — Elasticsearch + Grafana (M2)"
        />
      </div>
      <section aria-label="로그 대시보드" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <LogsEmbed />
        </div>
      </section>
    </div>
  );
}

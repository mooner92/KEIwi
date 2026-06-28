import { getGrafanaLogs } from "@/config/env";
import { GrafanaTabs } from "./grafana-tabs";

// /logs — Grafana 로그 대시보드(ES datasource)를 임베드 (M2, ADR-0008).
// 메트릭과 동일 패턴(GrafanaTabs 재사용). env 미설정 시 안내 패널.
export function LogsEmbed() {
  let grafana: ReturnType<typeof getGrafanaLogs> | null = null;
  try {
    grafana = getGrafanaLogs();
  } catch {
    grafana = null;
  }

  if (!grafana) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface-2 p-8 text-center">
        <p className="text-sm font-medium text-ink">로그 대시보드 미설정</p>
        <p className="mt-1.5 max-w-sm text-sm leading-6 text-ink-muted">
          M2 ELK 스택 기동 후{" "}
          <span className="tnum">apps/console/.env.local</span>의{" "}
          <span className="tnum">GRAFANA_LOGS_DASHBOARD_UID</span>를 설정하면 통합 로그가 표시됩니다.
        </p>
      </div>
    );
  }

  return <GrafanaTabs baseUrl={grafana.url} dashboards={grafana.dashboards} />;
}

import { getGrafana } from "@/config/env";
import { GrafanaTabs } from "./grafana-tabs";

// Grafana 대시보드를 iframe으로 임베드 (헌장 §2: 재구현 금지, ADR-0002).
// 인증은 Cloudflare Access(헌장 §14)가 처리 — 콘솔은 토큰 주입 안 함.
// 대시보드 개수 가변: env 목록 → 탭(1개면 탭 없이 임베드). env 미설정 시 안내 패널.
export function GrafanaEmbed() {
  // 데이터 취득만 try/catch (JSX 렌더는 밖에서 — 렌더 에러를 try로 못 잡으므로)
  let grafana: ReturnType<typeof getGrafana> | null = null;
  try {
    grafana = getGrafana();
  } catch {
    grafana = null;
  }

  if (!grafana) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface-2 p-8 text-center">
        <p className="text-sm font-medium text-ink">Grafana 미연결</p>
        <p className="mt-1.5 max-w-sm text-sm leading-6 text-ink-muted">
          <span className="tnum">apps/console/.env.local</span>의{" "}
          <span className="tnum">GRAFANA_URL</span> /{" "}
          <span className="tnum">GRAFANA_DASHBOARD_UID</span>를 설정하면 대시보드가 표시됩니다.
        </p>
      </div>
    );
  }

  return <GrafanaTabs baseUrl={grafana.url} dashboards={grafana.dashboards} />;
}

import { headers } from "next/headers";
import { searchLogs, type LogDoc } from "@/lib/opensearch";
import { getGrafanaLogs } from "@/config/env";
import { resolveGrafanaBase } from "@/lib/grafana-host";
import { LogsWorkbench } from "@/components/assistant/logs-workbench";

// 로그·env·Host 의존 → 정적 프리렌더 금지
export const dynamic = "force-dynamic";

/**
 * /logs = 로그 워크벤치 — Grafana 임베드 + 어시스턴트 드로어(specs/logs-assistant).
 * 서버에서 신호(OpenSearch)와 임베드 설정(host 기준 base — 로그인 루프 방지)을 데이터로 내려주고,
 * 상호작용(신호 선택·인플레이스 분석·딥링크·토글)은 클라이언트 워크벤치가 담당.
 */
export default async function LogsPage() {
  // 현재 신호 — 대시보드와 같은 눈높이(24h error·warn, 노이즈 제외 — ADR-0015)
  let signals: LogDoc[] = [];
  try {
    signals = await searchLogs({
      levels: ["error", "warn"],
      from: "now-24h",
      excludeNoise: true,
      size: 12,
    });
  } catch {
    signals = [];
  }

  let grafana: { baseUrl: string; dashboards: { uid: string; label: string }[] } | null = null;
  try {
    const g = getGrafanaLogs();
    const host = (await headers()).get("host");
    grafana = { baseUrl: resolveGrafanaBase(g.url, host), dashboards: g.dashboards };
  } catch {
    grafana = null; // env 미설정 → 워크벤치가 안내 패널 표시
  }

  return <LogsWorkbench signals={signals} grafana={grafana} />;
}

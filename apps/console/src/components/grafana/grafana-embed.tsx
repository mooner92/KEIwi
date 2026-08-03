import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { getGrafana } from "@/config/env";
import { resolveGrafanaBase } from "@/lib/grafana-host";
import { GrafanaTabs } from "./grafana-tabs";

// Grafana 대시보드를 iframe으로 임베드 (헌장 §2: 재구현 금지, ADR-0002).
// 인증은 Cloudflare Access(헌장 §14)가 처리 — 콘솔은 토큰 주입 안 함.
// 임베드 베이스는 접속 Host 기준으로 결정(resolveGrafanaBase) — 내부 IP 접속 시
// 크로스 사이트 쿠키 거부로 생기는 Grafana 로그인 루프 방지(lib/grafana-host.ts).
// 대시보드 개수 가변: env 목록 → 탭(1개면 탭 없이 임베드). env 미설정 시 안내 패널.
// selectedInstance: 플릿 노드 드릴다운(var-instance) 대상 — 시스템 탭에만 적용.
// servicePanel: 노드 선택 시 "서비스" 네이티브 탭(ServiceTable) — 서버에서 렌더해 전달.
export async function GrafanaEmbed({
  selectedInstance,
  selectedNodeName,
  selectedDcgm,
  servicePanel,
}: {
  selectedInstance?: string;
  selectedNodeName?: string;
  selectedDcgm?: string;
  servicePanel?: ReactNode;
}) {
  // 데이터 취득만 try/catch (JSX 렌더는 밖에서 — 렌더 에러를 try로 못 잡으므로)
  let grafana: ReturnType<typeof getGrafana> | null = null;
  try {
    grafana = getGrafana();
  } catch {
    grafana = null;
  }

  if (!grafana) {
    return (
      // 빈 액자 — 점선은 "아직 채워지지 않은 자리"라는 뜻이다. 경고가 아니므로 무채색으로 조용히.
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface p-8 text-center">
        <p className="text-base font-medium text-ink">Grafana 미연결</p>
        <p className="mt-1.5 max-w-sm text-sm leading-6 text-ink-subtle">
          <span className="tnum">apps/console/.env.local</span>의{" "}
          <span className="tnum">GRAFANA_URL</span> /{" "}
          <span className="tnum">GRAFANA_DASHBOARD_UID</span>를 설정하면 대시보드가 표시됩니다.
        </p>
      </div>
    );
  }

  // 접속 Host 기준 임베드 베이스(내부 IP 접속 → 같은 호스트 :3000, same-site 쿠키 보장).
  const host = (await headers()).get("host");
  // 테마를 서버에서 안다 — 토글이 `keiwi-theme` 쿠키를 기록하므로(theme-toggle.tsx) SSR HTML이
  // 처음부터 올바른 테마의 iframe을 담을 수 있다. 이러면 임베드가 하이드레이션에 의존하지 않고
  // (2026-08-04 회귀 방지), 다크 사용자의 Grafana 이중 로드도 사라진다. use-theme.ts 주석 참조.
  const initialTheme = (await cookies()).get("keiwi-theme")?.value === "dark" ? "dark" : "light";

  // selectedInstance 변경 시 remount → 활성 탭이 시스템 탭으로 재설정되어 드릴다운이 즉시 반영.
  return (
    <GrafanaTabs
      key={selectedInstance ?? "__all__"}
      baseUrl={resolveGrafanaBase(grafana.url, host)}
      dashboards={grafana.dashboards}
      selectedInstance={selectedInstance}
      selectedNodeName={selectedNodeName}
      selectedDcgm={selectedDcgm}
      servicePanel={servicePanel}
      initialTheme={initialTheme}
    />
  );
}

import { getGrafana } from "@/config/env";

// Grafana 대시보드를 iframe으로 임베드 (헌장 §2: 재구현 금지, ADR-0002).
// 인증은 Cloudflare Access(헌장 §14)가 처리 — 콘솔은 토큰 주입 안 함.
export function GrafanaEmbed() {
  let src: string | null = null;
  try {
    const { url, uid } = getGrafana();
    src = `${url.replace(/\/+$/, "")}/d/${uid}?kiosk`;
  } catch {
    src = null; // env 미설정 — 아래 안내 패널로 안전 귀결
  }

  if (!src) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface-2 p-8 text-center">
        <p className="text-sm font-medium text-ink">Grafana 미연결</p>
        <p className="mt-1.5 max-w-sm text-sm leading-6 text-ink-muted">
          <span className="tnum">apps/console/.env.local</span>의{" "}
          <span className="tnum">GRAFANA_URL</span> /{" "}
          <span className="tnum">GRAFANA_DASHBOARD_UID</span>를 설정하면 대시보드가 표시됩니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <iframe
        src={src}
        title="Grafana 메트릭 대시보드"
        loading="lazy"
        className="h-[70vh] min-h-[480px] w-full rounded-lg border border-border bg-surface"
      />
      <p className="text-right text-xs text-ink-muted">
        대시보드가 비어 보이면{" "}
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="text-info-700 underline underline-offset-2"
        >
          새 탭에서 열기
        </a>{" "}
        — 인증이 필요할 수 있습니다.
      </p>
    </div>
  );
}

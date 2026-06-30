"use client";

import { useState, type ReactNode } from "react";
import { useTheme } from "@/lib/use-theme";

type Dashboard = { uid: string; label: string };
type Tab = { key: string; label: string; kind: "service" | "grafana"; dash?: Dashboard };

// 임베드 URL 조립: 입력(경로/슬러그/쿼리/전체 URL 무엇이든)을 경로+쿼리로 분해해
// kiosk(크롬 숨김)·theme(콘솔 테마 매칭 — 다크 동기화)를 올바르게 병합(? 중복 방지).
// 기존 쿼리(var-*, from/to, refresh 등)는 보존하고 kiosk/theme만 갱신한다.
// instance가 주어지면 노드 드릴다운 — 기존 var-instance를 치환해 해당 노드로 고정.
function buildEmbedSrc(
  baseUrl: string,
  entry: string,
  instance?: string,
  nodeName?: string,
  theme: "light" | "dark" = "light",
): string {
  const base = baseUrl.replace(/\/+$/, "");
  let e = entry.trim();
  const dIdx = e.indexOf("/d/");
  if (dIdx !== -1) e = e.slice(dIdx + 3); // 전체 URL을 붙여넣어도 '/d/' 뒤만 사용
  const qIdx = e.indexOf("?");
  const path = (qIdx === -1 ? e : e.slice(0, qIdx)).replace(/^\/+|\/+$/g, "");
  const existing = qIdx === -1 ? "" : e.slice(qIdx + 1);
  const params = existing
    .split("&")
    .filter(
      (p) =>
        p &&
        !/^kiosk(=|$)/i.test(p) &&
        !/^theme=/i.test(p) &&
        !(instance && /^var-(instance|node|host)=/i.test(p)) &&
        !(nodeName && /^var-nodename=/i.test(p)),
    );
  if (nodeName) params.push(`var-nodename=${encodeURIComponent(nodeName)}`);
  if (instance) {
    // 인스턴스 변수 이름이 대시보드마다 instance/node/host 중 무엇인지 달라
    // 후보를 모두 설정한다(대시보드에 없는 변수는 Grafana가 무시).
    const v = encodeURIComponent(instance);
    params.push(`var-instance=${v}`, `var-node=${v}`, `var-host=${v}`);
  }
  params.push("kiosk", `theme=${theme}`);
  return `${base}/d/${path}?${params.join("&")}`;
}

// 탭 바 = "서비스"(콘솔 네이티브 패널) + Grafana 대시보드 탭들(통합). 노드 드릴다운 시
// 시스템=node-exporter(9100)+nodename, GPU=DCGM(9400)만 var 주입(모델/서비스는 미주입).
export function GrafanaTabs({
  baseUrl,
  dashboards,
  selectedInstance,
  selectedNodeName,
  selectedDcgm,
  servicePanel,
}: {
  baseUrl: string;
  dashboards: Dashboard[];
  selectedInstance?: string;
  selectedNodeName?: string;
  selectedDcgm?: string;
  /** 노드 선택 시 "서비스" 탭에 렌더할 서버 패널(ServiceTable). 없으면 탭 없음. */
  servicePanel?: ReactNode;
}) {
  const theme = useTheme(); // 콘솔 다크 ↔ Grafana 임베드 테마 동기화
  const tabs: Tab[] = [
    ...(servicePanel ? [{ key: "__svc__", label: "서비스", kind: "service" as const }] : []),
    ...dashboards.map((d) => ({ key: d.uid, label: d.label, kind: "grafana" as const, dash: d })),
  ];
  // 노드 선택 시 "서비스" 탭부터(없으면 시스템 탭). remount(key=instance)로 상태 초기화.
  const systemIdx = tabs.findIndex(
    (t) => t.kind === "grafana" && /시스템|system|node/i.test(t.label),
  );
  const [active, setActive] = useState(
    servicePanel ? 0 : selectedInstance && systemIdx >= 0 ? systemIdx : 0,
  );
  const cur = tabs[active] ?? tabs[0];

  const onService = cur?.kind === "service";
  const onSystem = cur?.kind === "grafana" && /시스템|system|node/i.test(cur.label);
  const onGpu = cur?.kind === "grafana" && /gpu/i.test(cur.label);
  const onModel = cur?.kind === "grafana" && /모델|model/i.test(cur.label);
  const applyInstance = onSystem ? selectedInstance : onGpu ? selectedDcgm : undefined;
  const applyNodeName = onSystem ? selectedNodeName : undefined;
  const src =
    onService || !cur?.dash
      ? ""
      : buildEmbedSrc(baseUrl, cur.dash.uid, applyInstance, applyNodeName, theme);

  return (
    <div className="flex h-full flex-col gap-2">
      {tabs.length > 1 && (
        <div role="tablist" aria-label="대시보드" className="flex shrink-0 flex-wrap gap-1">
          {tabs.map((t, i) => {
            const selected = i === active;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(i)}
                className={[
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  selected
                    ? "border border-border bg-surface-2 font-medium text-ink"
                    : "border border-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
      {onModel ? (
        <p className="shrink-0 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-ink-muted">
          이 뷰는 <span className="font-medium text-ink">플릿 전체</span>입니다 — 노드 선택과
          무관하게, 현재 모델이 구동 중인 노드만 표시됩니다.
        </p>
      ) : null}
      {onService ? (
        servicePanel
      ) : (
        <>
          <iframe
            key={src}
            src={src}
            title={`Grafana — ${cur?.label ?? ""}`}
            loading="lazy"
            className="min-h-[240px] w-full flex-1 rounded-lg border border-border bg-surface"
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
        </>
      )}
    </div>
  );
}

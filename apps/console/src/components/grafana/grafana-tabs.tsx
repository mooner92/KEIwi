"use client";

import { useState } from "react";
import { useTheme } from "@/lib/use-theme";

type Dashboard = { uid: string; label: string };

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

// 시스템(node-exporter) 대시보드 추정: 라벨에 시스템/system/node 포함 첫 탭, 없으면 0.
// 노드 드릴다운(var-instance)은 이 탭에만 적용한다(GPU/DCGM 등 타 대시보드 오염 방지).
function findSystemTab(dashboards: Dashboard[]): number {
  const i = dashboards.findIndex((d) => /시스템|system|node/i.test(d.label));
  return i === -1 ? 0 : i;
}

// GPU 탭 추정: 라벨에 gpu 포함 첫 탭(없으면 -1). GPU 탭은 DCGM instance(ip:9400)로 드릴다운.
function findGpuTab(dashboards: Dashboard[]): number {
  return dashboards.findIndex((d) => /gpu/i.test(d.label));
}

// 대시보드 개수 가변 — 줄바꿈 탭 바(1개면 탭 숨김). 선택된 대시보드를 kiosk로 임베드.
// selectedInstance: 노드 드릴다운 대상(ip:9100) — 시스템 탭에서만 var-instance로 주입.
export function GrafanaTabs({
  baseUrl,
  dashboards,
  selectedInstance,
  selectedNodeName,
  selectedDcgm,
}: {
  baseUrl: string;
  dashboards: Dashboard[];
  selectedInstance?: string;
  selectedNodeName?: string;
  selectedDcgm?: string;
}) {
  const systemTab = findSystemTab(dashboards);
  const gpuTab = findGpuTab(dashboards);
  const theme = useTheme(); // 콘솔 다크 ↔ Grafana 임베드 테마 동기화
  // 노드가 선택된 채 진입하면 시스템 탭부터 보여 드릴다운이 바로 보이게 한다.
  const [active, setActive] = useState(selectedInstance ? systemTab : 0);
  const current = dashboards[active] ?? dashboards[0];
  // 탭별로 다른 instance를 주입: 시스템=node-exporter(9100)+nodename, GPU=DCGM(9400).
  const onSystem = active === systemTab;
  const onGpu = gpuTab >= 0 && active === gpuTab;
  // 모델 탭은 플릿 전체(노드 스코프 미주입) — 노드 클릭 시 혼동 방지 안내(ADR-0016).
  const onModel = /모델|model/i.test(current.label);
  const applyInstance = onSystem
    ? selectedInstance
    : onGpu
      ? selectedDcgm
      : undefined;
  const applyNodeName = onSystem ? selectedNodeName : undefined;
  const src = buildEmbedSrc(baseUrl, current.uid, applyInstance, applyNodeName, theme);

  return (
    <div className="flex h-full flex-col gap-2">
      {dashboards.length > 1 && (
        <div
          role="tablist"
          aria-label="대시보드"
          className="flex shrink-0 flex-wrap gap-1"
        >
          {dashboards.map((d, i) => {
            const selected = i === active;
            return (
              <button
                key={`${d.uid}-${i}`}
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
                {d.label}
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
      <iframe
        key={src}
        src={src}
        title={`Grafana — ${current.label}`}
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
    </div>
  );
}

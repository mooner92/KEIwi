"use client";

import { useState } from "react";

type Dashboard = { uid: string; label: string };

// 대시보드 개수 가변 — 줄바꿈 탭 바(1개면 탭 숨김). 선택된 대시보드를 kiosk로 임베드.
export function GrafanaTabs({
  baseUrl,
  dashboards,
}: {
  baseUrl: string;
  dashboards: Dashboard[];
}) {
  const [active, setActive] = useState(0);
  const base = baseUrl.replace(/\/+$/, "");
  const current = dashboards[active] ?? dashboards[0];
  // kiosk = Grafana 크롬(사이드바/상단/헤더) 숨김 · theme=light = 콘솔(라이트)과 매칭.
  // current.uid는 '/d/' 뒤 경로(uid 또는 uid/slug) — 슬러그 포함 시 리다이렉트 없이 kiosk 유지.
  const src = `${base}/d/${current.uid}?kiosk&theme=light`;

  return (
    <div className="space-y-2">
      {dashboards.length > 1 && (
        <div role="tablist" aria-label="대시보드" className="flex flex-wrap gap-1">
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
      <iframe
        key={src}
        src={src}
        title={`Grafana — ${current.label}`}
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

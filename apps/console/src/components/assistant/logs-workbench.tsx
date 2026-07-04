"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { LogDoc } from "@/lib/opensearch";
import { GrafanaTabs, type EmbedTimeOverride } from "@/components/grafana/grafana-tabs";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { Breadcrumb } from "@/components/shell/breadcrumb";
import { PageHeader } from "@/components/shell/page-header";

type GrafanaConf = { baseUrl: string; dashboards: { uid: string; label: string }[] };

const STORE_KEY = "keiwi-logs-assist"; // 드로어 열림 상태 지속(AC4)
const FOCUS_WINDOW_MS = 5 * 60 * 1000; // 근거 딥링크 ±5분(AC3)

const LEVEL: Record<string, { badge: string; label: string }> = {
  error: { badge: "bg-danger-50 text-danger-700", label: "ERROR" },
  warn: { badge: "bg-warning-50 text-warning-700", label: "WARN" },
};

// @timestamp(UTC ISO) → KST "MM-DD HH:MM:SS". 고정 오프셋(+9h)·UTC 파트로 산출해
// 서버/클라 로컬 tz에 무관(하이드레이션 안전). 파싱 실패 시 "".
function fmtKST(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/**
 * 로그 워크벤치 — 좌 Grafana 로그 임베드 + 우 접이식 어시스턴트 드로어(specs/logs-assistant).
 * 업계 표준 2계층 패턴: 콘텐츠 옆 상주 패널 + 데이터 지점(신호 행) 인라인 진입점.
 * 신호 클릭 → 이동 없이 인플레이스 분석(AC2) · 근거 "이 시점 →" → 임베드 시간창 점프(AC3)
 * · 토글 Ctrl/Cmd+I + localStorage(AC4) · 심화는 /incidents 풀페이지(AC5).
 */
export function LogsWorkbench({
  signals,
  grafana,
}: {
  signals: LogDoc[];
  grafana: GrafanaConf | null;
}) {
  const [open, setOpen] = useState(true); // 기본 열림(발견성) — 저장된 닫힘만 복원
  const [selected, setSelected] = useState<LogDoc | null>(null);
  const [focus, setFocus] = useState<EmbedTimeOverride | null>(null);

  useEffect(() => {
    // 저장된 닫힘 상태 복원 — SSR과 첫 클라이언트 렌더를 일치시키려면(하이드레이션 안전)
    // localStorage는 마운트 후에만 읽을 수 있어 이 setState가 불가피(1회, 조건부).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem(STORE_KEY) === "closed") setOpen(false);
  }, []);
  const toggle = useCallback(() => {
    setOpen((o) => {
      localStorage.setItem(STORE_KEY, o ? "closed" : "open");
      return !o;
    });
  }, []);

  // Ctrl/Cmd+I — 어시스턴트 토글(Datadog 관례)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // 근거 로그 → Grafana 시간창 딥링크(iframe 내부는 못 건드려도 src는 콘솔 소유)
  const onEvidenceFocus = (d: LogDoc) => {
    const t = Date.parse(d.timestamp);
    if (!Number.isFinite(t)) return;
    setFocus({
      from: String(t - FOCUS_WINDOW_MS),
      to: String(t + FOCUS_WINDOW_MS),
      vars: d.fleetNode ? { fleet_node: d.fleetNode } : undefined,
    });
  };

  const deepDiveHref = selected
    ? `/incidents?service=${encodeURIComponent(selected.service)}&node=${encodeURIComponent(selected.fleetNode)}&q=${encodeURIComponent(selected.message.slice(0, 160))}`
    : "/incidents";

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Breadcrumb />
        <PageHeader
          title="통합 로그"
          description="플릿 로그 — OpenSearch + Grafana · 우측 어시스턴트로 에러 즉시 진단"
          actions={
            <button
              type="button"
              onClick={toggle}
              aria-pressed={open}
              title="어시스턴트 열기/닫기 (Ctrl+I)"
              className={[
                "inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors",
                open
                  ? "border-brand bg-surface-2 text-brand"
                  : "border-border text-ink-muted hover:bg-surface-2 hover:text-ink",
              ].join(" ")}
            >
              어시스턴트
              <kbd className="rounded-sm border border-border px-1 text-[10px] text-ink-subtle">
                Ctrl+I
              </kbd>
            </button>
          }
        />
      </div>

      <div
        className={[
          "grid min-h-0 flex-1 grid-cols-1 gap-3",
          // 임베드:어시스턴트 ≈ 3:1 (드로어를 폭에 비례해 확대 — 넓은 모니터에서도 유지)
          open ? "lg:grid-cols-[minmax(0,3fr)_minmax(360px,1fr)]" : "",
        ].join(" ")}
      >
        {/* 좌 — Grafana 로그 임베드 (§I-2 재구현 금지) */}
        <section aria-label="로그 대시보드" className="flex min-h-0 flex-col gap-2">
          {focus ? (
            <p className="flex shrink-0 items-center justify-between gap-2 rounded-md border border-info-100 bg-info-50 px-3 py-1.5 text-xs text-info-700">
              <span>근거 로그 시점 ±5분 범위를 보는 중입니다.</span>
              <button
                type="button"
                onClick={() => setFocus(null)}
                className="font-medium underline underline-offset-2"
              >
                원래 범위로
              </button>
            </p>
          ) : null}
          {grafana ? (
            <div className="min-h-0 flex-1">
              <GrafanaTabs
                baseUrl={grafana.baseUrl}
                dashboards={grafana.dashboards}
                timeOverride={focus}
              />
            </div>
          ) : (
            <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface-2 p-8 text-center">
              <p className="text-sm font-medium text-ink">로그 대시보드 미설정</p>
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-ink-muted">
                <span className="tnum">apps/console/.env.local</span>의{" "}
                <span className="tnum">GRAFANA_LOGS_DASHBOARD_UID</span>를 설정하면 통합 로그가
                표시됩니다.
              </p>
            </div>
          )}
        </section>

        {/* 우 — 어시스턴트 드로어: 현재 신호(진입점) + 인플레이스 분석 */}
        {open ? (
          <aside aria-label="로그 어시스턴트" className="flex min-h-0 flex-col gap-3">
            <section className="flex max-h-[45%] min-h-0 shrink-0 flex-col rounded-lg border border-border bg-surface shadow-1">
              <header className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
                <h2 className="font-display text-sm font-semibold tracking-tight text-ink">
                  현재 신호{" "}
                  <span className="font-normal text-ink-muted">· 24h error·warn</span>
                </h2>
                <span className="tnum text-xs text-ink-subtle">{signals.length}건</span>
              </header>
              {signals.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-ink-muted">
                  지금 신호 없음(정상) 또는 데이터 없음
                </p>
              ) : (
                <ul className="min-h-0 divide-y divide-border overflow-y-auto">
                  {signals.map((s) => {
                    const lv = LEVEL[s.level] ?? { badge: "bg-neutral-100 text-ink-muted", label: s.level };
                    const active = selected?.id === s.id;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(s)}
                          aria-pressed={active}
                          className={[
                            "block w-full px-3 py-2 text-left transition-colors",
                            active ? "bg-surface-2" : "hover:bg-surface-2",
                          ].join(" ")}
                        >
                          <span className="flex items-center gap-2 text-[11px]">
                            <span
                              className={`rounded-sm px-1 font-semibold ${lv.badge}`}
                            >
                              {lv.label}
                            </span>
                            <span className="tnum shrink-0 text-ink-subtle" title={s.timestamp}>
                              {fmtKST(s.timestamp)}
                            </span>
                            <span className="tnum min-w-0 truncate text-ink-subtle">
                              {s.fleetNode} · {s.service}
                            </span>
                            <span
                              className={`ml-auto shrink-0 text-xs font-medium ${active ? "text-brand" : "text-info-700"}`}
                            >
                              {active ? "분석 중 ✓" : "분석 →"}
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-xs text-ink-muted">
                            {s.message.slice(0, 160)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* 신호 선택 → key remount로 그 자리에서 자동 분석(AC2). 근거 행 → 임베드 딥링크(AC3). */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <AssistantPanel
                key={selected?.id ?? "__free__"}
                initial={
                  selected
                    ? {
                        service: selected.service,
                        fleetNode: selected.fleetNode,
                        message: selected.message.slice(0, 300),
                      }
                    : undefined
                }
                onEvidenceFocus={grafana ? onEvidenceFocus : undefined}
              />
            </div>

            <p className="shrink-0 text-right text-xs text-ink-muted">
              외부 전송 없음 · 읽기 전용 ·{" "}
              <Link
                href={deepDiveHref}
                className="font-medium text-info-700 underline underline-offset-2"
              >
                전체 화면에서 계속 →
              </Link>
            </p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { useTheme } from "@/lib/use-theme";

type Dashboard = { uid: string; label: string };
type Tab = { key: string; label: string; kind: "service" | "grafana"; dash?: Dashboard };

/**
 * 시간창/변수 강제 지정 — 어시스턴트 근거 로그 "이 시점 →" 딥링크(specs/logs-assistant AC3)
 * + 워크벤치 필터 칩의 var 주입(vars만 지정 가능). 배열 값 = Grafana 멀티밸류
 * (var-k=a&var-k=b 반복) 관례.
 */
export type EmbedTimeOverride = {
  from?: string;
  to?: string;
  vars?: Record<string, string | string[]>;
};

// 임베드 URL 조립: 입력(경로/슬러그/쿼리/전체 URL 무엇이든)을 경로+쿼리로 분해해
// kiosk(크롬 숨김)·theme(콘솔 테마 매칭 — 다크 동기화)를 올바르게 병합(? 중복 방지).
// 기존 쿼리(var-*, from/to, refresh 등)는 보존하고 kiosk/theme만 갱신한다.
// instance가 주어지면 노드 드릴다운 — 기존 var-instance를 치환해 해당 노드로 고정.
// override가 주어지면 from/to(둘 다 있을 때만)·지정 var를 치환 — iframe 내부는 못 건드려도 src는 콘솔 소유.
function buildEmbedSrc(
  baseUrl: string,
  entry: string,
  instance?: string,
  nodeName?: string,
  theme: "light" | "dark" = "light",
  override?: EmbedTimeOverride,
): string {
  const base = baseUrl.replace(/\/+$/, "");
  let e = entry.trim();
  const dIdx = e.indexOf("/d/");
  if (dIdx !== -1) e = e.slice(dIdx + 3); // 전체 URL을 붙여넣어도 '/d/' 뒤만 사용
  const qIdx = e.indexOf("?");
  const path = (qIdx === -1 ? e : e.slice(0, qIdx)).replace(/^\/+|\/+$/g, "");
  const existing = qIdx === -1 ? "" : e.slice(qIdx + 1);
  // from/to 치환은 둘 다 있을 때만(딥링크) — vars만 온 필터 override는 시간창을 건드리지 않음.
  const hasWindow = Boolean(override?.from && override?.to);
  const overrideVarKeys = Object.keys(override?.vars ?? {}).map((k) => `var-${k.toLowerCase()}=`);
  const params = existing
    .split("&")
    .filter(
      (p) =>
        p &&
        !/^kiosk(=|$)/i.test(p) &&
        !/^theme=/i.test(p) &&
        !(instance && /^var-(instance|node|host)=/i.test(p)) &&
        !(nodeName && /^var-nodename=/i.test(p)) &&
        !(hasWindow && /^(from|to)=/i.test(p)) &&
        !overrideVarKeys.some((k) => p.toLowerCase().startsWith(k)),
    );
  if (nodeName) params.push(`var-nodename=${encodeURIComponent(nodeName)}`);
  if (instance) {
    // 인스턴스 변수 이름이 대시보드마다 instance/node/host 중 무엇인지 달라
    // 후보를 모두 설정한다(대시보드에 없는 변수는 Grafana가 무시).
    const v = encodeURIComponent(instance);
    params.push(`var-instance=${v}`, `var-node=${v}`, `var-host=${v}`);
  }
  if (override) {
    if (hasWindow && override.from && override.to) {
      params.push(
        `from=${encodeURIComponent(override.from)}`,
        `to=${encodeURIComponent(override.to)}`,
      );
    }
    for (const [k, v] of Object.entries(override.vars ?? {})) {
      // 배열 = 같은 키 반복 push(var-k=a&var-k=b — Grafana 멀티밸류 관례).
      for (const one of Array.isArray(v) ? v : [v]) {
        params.push(`var-${k}=${encodeURIComponent(one)}`); // 대시보드에 없는 var는 Grafana가 무시
      }
    }
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
  timeOverride,
}: {
  baseUrl: string;
  dashboards: Dashboard[];
  selectedInstance?: string;
  selectedNodeName?: string;
  selectedDcgm?: string;
  /** 노드 선택 시 "서비스" 탭에 렌더할 서버 패널(ServiceTable). 없으면 탭 없음. */
  servicePanel?: ReactNode;
  /** 시간창/변수 강제(근거 로그 딥링크) — Grafana 탭 전체에 적용. */
  timeOverride?: EmbedTimeOverride | null;
}) {
  const theme = useTheme(); // 콘솔 다크 ↔ Grafana 임베드 테마 동기화
  // 탭 순서: 시스템·GPU·모델(env 순서) → 서비스 마지막 (2026-07-02 사용자 지시 — v2.1 R01 개정).
  const tabs: Tab[] = [
    ...dashboards.map((d) => ({ key: d.uid, label: d.label, kind: "grafana" as const, dash: d })),
    ...(servicePanel ? [{ key: "__svc__", label: "서비스", kind: "service" as const }] : []),
  ];
  // 기본 활성 = 첫 탭(시스템). 노드 드릴다운도 remount(key=instance)로 시스템부터.
  const [active, setActive] = useState(0);
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
      : buildEmbedSrc(
          baseUrl,
          cur.dash.uid,
          applyInstance,
          applyNodeName,
          theme,
          timeOverride ?? undefined,
        );

  return (
    <div className="flex h-full flex-col gap-2">
      {(tabs.length > 1 || src) && (
        <div className="flex shrink-0 flex-wrap items-center border-b border-border">
          {/* 링크는 tablist 밖이 정석 — role은 탭 버튼 wrapper에만 부여(접근성) */}
          {tabs.length > 1 && (
            <div role="tablist" aria-label="대시보드" className="flex flex-wrap">
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
                      // 활성 신호는 1.5px 초록 언더라인 하나 — 글자까지 초록으로 칠하지 않는다
                      // (초록 예산제). 위계는 잉크 계조 + 굵기로만 만든다.
                      "relative -mb-px px-3 py-1.5 text-sm transition-colors",
                      selected
                        ? "font-semibold text-ink"
                        : "font-medium text-ink-muted hover:text-ink",
                    ].join(" ")}
                  >
                    {t.label}
                    {selected && (
                      <span
                        aria-hidden
                        className="absolute inset-x-0 -bottom-px h-[1.5px] bg-accent-line"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {/* 하단 안내행을 탭 행 우측으로 흡수(세로 공간 절약) — 인증 힌트는 title로 보존 */}
          {src ? (
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              title="대시보드가 비어 보이면 새 탭에서 여세요 — 인증이 필요할 수 있습니다"
              className="ml-auto pb-1.5 pl-3 text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              새 탭에서 열기 ↗
            </a>
          ) : null}
        </div>
      )}
      {onModel ? (
        <p className="shrink-0 rounded-md border border-border bg-surface-2 px-3 py-1 text-xs text-ink-subtle">
          이 뷰는 <span className="font-medium text-ink">플릿 전체</span>입니다 — 노드 선택과
          무관하게, 현재 모델이 구동 중인 노드만 표시됩니다.
        </p>
      ) : null}
      {onService ? (
        servicePanel
      ) : (
        // 액자(frame): 1px 보더 + 8px 반경 + 그림자 0. iframe을 감싸 모서리를 확실히 깎는다
        // — 임베드 내부는 Grafana 소유라 콘솔이 할 수 있는 건 액자를 조용히 두르는 것뿐이다.
        <div className="min-h-[240px] flex-1 overflow-hidden rounded-lg border border-border bg-surface">
          <iframe
            key={src}
            src={src}
            title={`Grafana — ${cur?.label ?? ""}`}
            loading="lazy"
            className="h-full w-full"
          />
        </div>
      )}
    </div>
  );
}

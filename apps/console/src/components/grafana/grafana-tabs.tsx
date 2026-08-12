"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useTheme } from "@/lib/use-theme";

type Dashboard = { uid: string; label: string };
type Tab = { key: string; label: string; kind: "service" | "grafana"; dash?: Dashboard };

/**
 * `?tab=` 에 쓸 짧고 안정적인 슬러그. env의 대시보드 항목은
 * "uid/slug?orgId=1&from=…" 형태라 그대로 URL에 실으면 주소가 지저분해지고,
 * 대시보드 쿼리를 바꾸는 순간 링크가 깨진다 → **Grafana uid 부분만** 쓴다.
 */
function tabSlug(t: Tab): string {
  if (t.kind === "service") return "service";
  const e = t.dash?.uid ?? "";
  const dIdx = e.indexOf("/d/");
  const path = (dIdx === -1 ? e : e.slice(dIdx + 3)).replace(/^\/+/, "");
  return (path.split("?")[0] ?? "").split("/")[0] ?? "";
}

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
  initialTheme = "light",
  activeKey,
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
  /** SSR 시 쓸 테마 — 서버가 `keiwi-theme` 쿠키에서 읽어 준다(use-theme.ts 주석 참조). */
  initialTheme?: "light" | "dark";
  /**
   * URL 기반 탭(`?tab=<key>`) 활성화 — 지정하면 탭이 **버튼이 아니라 링크**가 된다.
   *
   * 왜: 탭이 useState만으로 동작하면 **하이드레이션이 실패한 브라우저에서 완전히 죽는다**
   * (클릭해도 아무 반응 없음 — SSR HTML은 멀쩡해서 원인 파악도 어렵다). 이 파일은 이미
   * 같은 계열의 회귀를 겪었다(2026-08-04: 임베드를 하이드레이션 뒤로 미뤘더니 Grafana가
   * 아예 안 떴다 → "부재가 잘못된 상태보다 나쁜 실패"). 임베드에 적용한 그 교훈을 탭에도
   * 적용한다 — 링크는 JS 없이도 동작하고, 딥링크·뒤로가기·공유까지 덤으로 얻는다.
   * 미지정(로그 워크벤치)이면 기존 클라이언트 상태 방식 그대로.
   */
  activeKey?: string;
}) {
  // ── 테마 동기화 ─────────────────────────────────────────────────────────
  // 서버는 DOM이 없어 테마를 모르므로 **쿠키에서 읽은 값(initialTheme)을 주입**받는다
  // (서버 컴포넌트 grafana-embed.tsx가 cookies()로 읽어 넘긴다).
  // 그래야 SSR HTML이 처음부터 올바른 테마의 iframe을 담는다 —
  //   · 다크 사용자의 Grafana 이중 로드(light→dark)가 사라지고
  //   · 임베드가 **하이드레이션에 의존하지 않는다**(2026-08-04 회귀의 교훈:
  //     iframe을 하이드레이션 뒤로 미뤘더니 dev 모드에서 Grafana가 아예 안 떴다.
  //     잘못된 테마보다 부재가 더 나쁜 실패다.)
  // 토글 시 반응은 useSyncExternalStore가 <html data-theme> 변화를 구독해 처리한다.
  const theme = useTheme(initialTheme);
  // 탭 순서: 시스템·GPU·모델(env 순서) → 서비스 마지막 (2026-07-02 사용자 지시 — v2.1 R01 개정).
  const tabs: Tab[] = [
    ...dashboards.map((d) => ({ key: d.uid, label: d.label, kind: "grafana" as const, dash: d })),
    ...(servicePanel ? [{ key: "__svc__", label: "서비스", kind: "service" as const }] : []),
  ];
  // 기본 활성 = 첫 탭(시스템). 노드 드릴다운도 remount(key=instance)로 시스템부터.
  const [localActive, setLocalActive] = useState(0);
  // URL 모드면 활성 탭이 서버가 준 activeKey에서 나온다(하이드레이션 불필요).
  const linked = activeKey !== undefined;
  const keyed = tabs.findIndex((t) => tabSlug(t) === activeKey);
  const active = linked ? (keyed === -1 ? 0 : keyed) : localActive;
  const cur = tabs[active] ?? tabs[0];

  // 링크 모드에서 현재 쿼리(?node= 등)를 보존한 채 tab만 바꾼 href를 만든다.
  // SSR에서도 실행되므로 생성된 <a href>가 HTML에 그대로 담긴다 = JS 없이 동작.
  const search = useSearchParams();
  const hrefFor = (key: string) => {
    const p = new URLSearchParams(search?.toString() ?? "");
    p.set("tab", key);
    return `?${p.toString()}`;
  };

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
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* 링크는 tablist 밖이 정석 — role은 탭 버튼 wrapper에만 부여(접근성) */}
          {tabs.length > 1 && (
            <div role="tablist" aria-label="대시보드" className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
              {tabs.map((t, i) => {
                const selected = i === active;
                // 세그먼티드 컨트롤(macOS) — 활성은 색이 아니라 **면 계조**로 떠오른다:
                // 트랙(surface-2) 위에 활성 세그먼트만 surface+보더. 초록 예산 0.
                // (구 언더라인 방식은 탭이 4개뿐인 이 화면에서 존재감이 없어 "탭인지 몰랐다"는
                // 피드백의 원인이었다 — 세그먼트는 조작 가능한 영역이 형태로 드러난다.)
                const cls = [
                  "rounded-md px-3 py-1 text-sm transition-colors",
                  selected
                    ? "border border-border bg-surface font-semibold text-ink"
                    : "border border-transparent font-medium text-ink-muted hover:text-ink",
                ].join(" ");
                const inner = t.label;
                // 링크 모드 = JS 없이도 동작(하이드레이션 실패 내성). scroll=false로
                // 탭 전환 시 페이지가 위로 튀지 않게 한다.
                return linked ? (
                  <Link
                    key={t.key}
                    href={hrefFor(tabSlug(t))}
                    scroll={false}
                    role="tab"
                    aria-selected={selected}
                    className={cls}
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setLocalActive(i)}
                    className={cls}
                  >
                    {inner}
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
              className="ml-auto pl-3 text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
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
          {src ? (
            <iframe
              key={src}
              src={src}
              title={`Grafana — ${cur?.label ?? ""}`}
              loading="lazy"
              className="h-full w-full"
              // 브라우저 확장이 iframe에 속성을 주입해 생기는 하이드레이션 경고를 막는다.
              // (실측: Ruffle 확장이 data-ruffle-polyfilled를 붙여 서버 HTML과 어긋남 —
              //  확장 없는 브라우저에서는 재현되지 않는다.) iframe은 광고차단·플래시
              //  에뮬레이터 등이 흔히 건드리는 대상이고, 여기 속성은 전부 위 props에서
              //  파생돼 클라이언트 전용 상태가 없으므로 억제해도 잃는 정보가 없다.
              suppressHydrationWarning
            />
          ) : (
            // 대시보드 uid가 없을 때만 도달한다(정상 경로에서는 SSR부터 iframe이 있다).
            // 자리표시자를 "로딩 중"으로 쓰지 않는다 — 임베드가 클라이언트 상태에 의존하면
            // 하이드레이션이 실패한 브라우저에서 Grafana가 영영 안 뜬다(2026-08-04 회귀).
            <div className="flex h-full w-full items-center justify-center p-6 text-center">
              <p className="text-sm text-ink-subtle">
                대시보드가 지정되지 않았습니다 —{" "}
                <span className="tnum">GRAFANA_DASHBOARD_UID</span>를 확인하세요.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

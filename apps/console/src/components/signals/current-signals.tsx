import Link from "next/link";
import { searchLogs, type LogDoc } from "@/lib/opensearch";

// 레벨 = 색 + 형태(dot) + 단어 — 색만으로 뜻을 전하지 않는다(v3 §5). /logs 워크벤치와 같은 어휘.
const LEVEL: Record<string, { dot: string; ink: string; label: string }> = {
  error: { dot: "bg-danger", ink: "text-danger-ink", label: "ERROR" },
  warn: { dot: "bg-warn", ink: "text-warn-ink", label: "WARN" },
};

/**
 * 현재 신호 — 최근 error+warn top-N (OpenSearch 읽기 전용). 어시스턴트 진입점(spec UA1).
 * rsyslog/UFW 노이즈 제외(ADR-0011 신호우선과 일관). 각 행 "분석" → 어시스턴트에 prefill.
 * §I-2: 진입점 요약만(시계열 그래프 없음 — 탐색은 /logs Grafana).
 */
export async function CurrentSignals() {
  let signals: LogDoc[] = [];
  let probeError: string | null = null;
  try {
    // 노이즈(rsyslog 자기로그·UFW 방화벽) 제외를 쿼리단에서 — top-N이 진짜 신호로 채워짐(ADR-0015).
    signals = await searchLogs({
      levels: ["error", "warn"],
      from: "now-24h",
      excludeNoise: true,
      size: 12,
    });
  } catch (e) {
    // 검색 실패를 빈 목록으로 접으면 "신호 없음(정상)"으로 읽힌다 — 인시던트 탐지의
    // 1차 진입점에서 벌어지는 거짓 초록이다. 실패를 **상태로 승격**해 구분한다
    // (GPU 프로세스 패널에서 같은 실패모드를 고친 것과 같은 처리).
    probeError = e instanceof Error ? e.message : String(e);
  }

  return (
    // 카드 그림자 0 — 분리는 1px 보더와 면 명도차로만(v3 §3)
    <section
      aria-label="현재 신호"
      className="flex min-h-0 flex-col rounded-lg border border-border bg-surface"
    >
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">
          현재 신호{" "}
          <span className="font-normal text-ink-muted">· 최근 24시간 error·warn (노이즈 제외)</span>
        </h2>
      </header>
      {probeError ? (
        <div className="px-3 py-6 text-center">
          <p className="text-base font-medium text-warn-ink">판정불가 — 로그 검색 실패</p>
          <p className="mt-1 text-sm leading-6 text-ink-subtle">
            OpenSearch를 조회하지 못했습니다. <b>신호가 없는 것이 아니라 못 본 것</b>입니다 —
            이 상태에서 &quot;정상&quot;으로 판단하지 마세요.
          </p>
        </div>
      ) : signals.length === 0 ? (
        <p className="px-3 py-6 text-center text-base text-ink-muted">
          최근 24시간 신호 없음 — 검색은 정상 동작했습니다
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle overflow-y-auto">
          {signals.map((s) => {
            const lv = LEVEL[s.level] ?? {
              dot: "bg-ink-faint",
              ink: "text-ink-muted",
              label: s.level.toUpperCase(),
            };
            const href =
              `/incidents?service=${encodeURIComponent(s.service)}` +
              `&node=${encodeURIComponent(s.fleetNode)}` +
              `&q=${encodeURIComponent(s.message.slice(0, 160))}`;
            return (
              <li key={s.id} className="px-3 py-1.5">
                <div className="flex items-center justify-between gap-2 text-2xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`flex shrink-0 items-center gap-1 font-semibold ${lv.ink}`}>
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${lv.dot}`} />
                      {lv.label}
                    </span>
                    <span className="tnum min-w-0 truncate text-ink-subtle">
                      {s.fleetNode} · {s.service}
                    </span>
                  </span>
                  <Link
                    href={href}
                    className="shrink-0 text-ink-muted underline underline-offset-2 hover:text-ink"
                  >
                    분석 →
                  </Link>
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-ink">
                  {s.message.slice(0, 160)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

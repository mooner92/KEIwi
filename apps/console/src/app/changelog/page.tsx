import type { Metadata } from "next";
import { Breadcrumb } from "@/components/shell/breadcrumb";
import { PageHeader } from "@/components/shell/page-header";
import {
  CHANGELOG,
  CHANGELOG_META,
  type ChangelogEntry,
  type ChangelogType,
} from "@/data/changelog";

export const metadata: Metadata = {
  title: "패치노트",
  description:
    "KEIwi 변경 이력 — 첫 커밋부터 전수조사한 날짜별 신규·개선·수정·사건 기록.",
};

/** 정적 데이터만 렌더하는 서버 컴포넌트 — 네트워크/env 의존 없음, 프리렌더 가능. */

// 타입 배지 — v3 원칙: 무채색 기본, 유채색은 문제에만(사건=위험색, 보안=주황 계열).
const TYPE_BADGE: Record<ChangelogType, string> = {
  신규: "border-border bg-surface-2 text-ink-muted",
  개선: "border-border bg-surface-2 text-ink-muted",
  수정: "border-border bg-surface-2 text-ink-muted",
  인프라: "border-border bg-surface-2 text-ink-muted",
  문서: "border-border bg-surface-2 text-ink-muted",
  사건: "border-danger-border bg-danger-bg text-danger-ink",
  보안: "border-warn-border bg-warn-bg text-warn-ink",
};

// 요약 스트립의 타입 표기 순서 — 만든 것(신규·개선·수정) → 문제(사건·보안) → 뒷받침(인프라·문서).
const TYPE_ORDER: ChangelogType[] = [
  "신규",
  "개선",
  "수정",
  "사건",
  "보안",
  "인프라",
  "문서",
];

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "YYYY-MM-DD" → 요일 한 글자. 날짜 문자열만 다루므로 타임존 무관(UTC 고정 파싱). */
function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** 날짜 내림차순 그룹(최신 위). 그룹 안은 데이터 순서(=그날의 커밋 시각순) 유지. */
function groupByDateDesc(entries: ChangelogEntry[]): [string, ChangelogEntry[]][] {
  const map = new Map<string, ChangelogEntry[]>();
  for (const e of entries) {
    const group = map.get(e.date);
    if (group) group.push(e);
    else map.set(e.date, [e]);
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
}

export default function ChangelogPage() {
  const groups = groupByDateDesc(CHANGELOG);
  const first = CHANGELOG[0]?.date ?? "";
  const typeCounts = TYPE_ORDER.map(
    (t) => [t, CHANGELOG.filter((e) => e.type === t).length] as const,
  ).filter(([, n]) => n > 0);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pb-8">
      <div className="flex flex-col gap-1">
        <Breadcrumb />
        <PageHeader
          title="패치노트"
          description="정본은 git 이력 — 커밋 전수조사를 날짜별로 정리한 변경 기록입니다."
        />
      </div>

      {/* 요약 스트립 — 기간 · 총 커밋 · 타입별 카운트 */}
      <section
        aria-label="변경 이력 요약"
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-surface px-3.5 py-2.5"
      >
        <p className="tnum text-sm text-ink">
          {first} ~ {CHANGELOG_META.snapshotDate}
        </p>
        <p className="tnum text-sm text-ink-muted">
          커밋 {CHANGELOG_META.surveyedCommits}건 · 항목 {CHANGELOG.length}건
        </p>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {typeCounts.map(([t, n]) => (
            <li key={t} className="flex items-center gap-1 text-2xs">
              <span
                className={`rounded-sm border px-1 py-px font-medium ${TYPE_BADGE[t]}`}
              >
                {t}
              </span>
              <span className="tnum text-ink-subtle">{n}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 날짜 내림차순 타임라인 */}
      <div className="flex flex-col gap-5">
        {groups.map(([date, entries]) => (
          <section key={date} aria-labelledby={`d-${date}`} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2 border-b border-border pb-1.5">
              <h2 id={`d-${date}`} className="tnum text-md font-semibold text-ink">
                {date} ({weekdayOf(date)})
              </h2>
              <span className="tnum text-2xs text-ink-subtle">{entries.length}건</span>
            </div>
            <ul className="flex flex-col gap-2">
              {entries.map((e, i) => (
                <li
                  key={`${e.shas.join("-")}-${i}`}
                  className={[
                    "rounded-lg border border-border bg-surface p-3.5",
                    // 사건은 좌측 위험색 룰로 살짝 강조 — 유채색은 문제에만.
                    e.incident ? "border-l-2 border-l-danger" : "",
                  ].join(" ")}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={`rounded-sm border px-1.5 py-px text-2xs font-medium ${TYPE_BADGE[e.type]}`}
                    >
                      {e.type}
                    </span>
                    <span className="text-2xs text-ink-subtle">{e.scope}</span>
                    <span className="ml-auto tnum text-2xs text-ink-subtle">
                      {e.shas.join(" · ")}
                    </span>
                  </div>
                  <h3 className="mt-1.5 font-semibold text-ink">{e.title}</h3>
                  <p className="mt-1 text-ink-muted">{e.summary}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-2xs text-ink-subtle">
        스냅샷 {CHANGELOG_META.snapshotDate} 기준 — 이후 변경은 릴리스마다 추가됩니다.
      </p>
    </div>
  );
}

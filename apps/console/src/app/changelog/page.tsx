import type { Metadata } from "next";
import Link from "next/link";
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

/** `?type=`·`?scope=`로 항목을 걸러 본다 — 탭과 같은 이유로 **URL이 상태를 소유**한다
 *  (클라이언트 상태였다면 하이드레이션이 죽는 순간 필터도 통째로 죽는다 — 이 콘솔이
 *  세 번 겪은 실패모드). 링크라 JS 없이 동작하고, 필터된 화면을 그대로 공유할 수 있다. */
export default async function ChangelogPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; scope?: string }>;
}) {
  const params = await searchParams;
  // 검증: 알려진 타입·실존 scope만 인정 — 임의 값은 조용히 무필터로(오타가 빈 화면을 만들지 않게)
  const typeFilter = TYPE_ORDER.includes(params.type as ChangelogType)
    ? (params.type as ChangelogType)
    : null;
  const scopes = [...new Set(CHANGELOG.map((e) => e.scope))].sort();
  const scopeFilter = scopes.includes(params.scope ?? "") ? (params.scope as string) : null;
  const filtered = CHANGELOG.filter(
    (e) => (!typeFilter || e.type === typeFilter) && (!scopeFilter || e.scope === scopeFilter),
  );
  /** 현재 필터에서 한 축만 바꾼 href — 나머지 축은 보존한다(탭의 hrefFor와 같은 규약). */
  const hrefFor = (next: { type?: ChangelogType | null; scope?: string | null }) => {
    const q = new URLSearchParams();
    const ty = next.type === undefined ? typeFilter : next.type;
    const sc = next.scope === undefined ? scopeFilter : next.scope;
    if (ty) q.set("type", ty);
    if (sc) q.set("scope", sc);
    const s = q.toString();
    return s ? `/changelog?${s}` : "/changelog";
  };

  const groups = groupByDateDesc(filtered);
  const first = CHANGELOG[0]?.date ?? "";
  // 범위 끝은 **데이터에서** 계산한다. 스냅샷 날짜를 쓰면 이후 릴리스 항목을 추가할 때마다
  // 헤더만 과거에 멈춰(항목은 최신인데 기간은 08-03) 화면이 스스로 모순된다.
  const last = CHANGELOG[CHANGELOG.length - 1]?.date ?? first;
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
          {first} ~ {last}
        </p>
        <p className="tnum text-sm text-ink-muted">
          커밋 {CHANGELOG_META.surveyedCommits}건 · 항목 {CHANGELOG.length}건
        </p>
        <ul className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {typeCounts.map(([t, n]) => {
            const active = typeFilter === t;
            return (
              <li key={t} className="flex items-center gap-1 text-2xs">
                {/* 클릭=필터, 다시 클릭=해제(토글). 활성은 색이 아니라 테두리·굵기로 */}
                <Link
                  href={hrefFor({ type: active ? null : t })}
                  aria-pressed={active}
                  className={[
                    "rounded-sm border px-1 py-px font-medium transition-colors",
                    TYPE_BADGE[t],
                    active ? "border-ink font-semibold text-ink" : "hover:border-border-strong",
                  ].join(" ")}
                >
                  {t}
                </Link>
                <span className="tnum text-ink-subtle">{n}</span>
              </li>
            );
          })}
        </ul>
        {(typeFilter || scopeFilter) && (
          <p className="flex items-center gap-2 text-2xs text-ink-muted">
            필터: <span className="font-medium text-ink">{[typeFilter, scopeFilter].filter(Boolean).join(" · ")}</span>
            <span className="tnum">{filtered.length}건</span>
            <Link href="/changelog" className="underline underline-offset-2 hover:text-ink">
              전체 보기
            </Link>
          </p>
        )}
      </section>

      {/* 날짜 내림차순 타임라인 */}
      <div className="flex flex-col gap-5">
        {groups.length === 0 && (
          <p className="rounded-lg border border-dashed border-border bg-surface px-3 py-6 text-center text-sm text-ink-subtle">
            이 필터에 해당하는 항목이 없습니다 —{" "}
            <Link href="/changelog" className="underline underline-offset-2">전체 보기</Link>
          </p>
        )}
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
                    <Link
                      href={hrefFor({ type: typeFilter === e.type ? null : e.type })}
                      className={`rounded-sm border px-1.5 py-px text-2xs font-medium hover:border-border-strong ${TYPE_BADGE[e.type]}`}
                    >
                      {e.type}
                    </Link>
                    <Link
                      href={hrefFor({ scope: scopeFilter === e.scope ? null : e.scope })}
                      className="text-2xs text-ink-subtle underline-offset-2 hover:text-ink hover:underline"
                    >
                      {e.scope}
                    </Link>
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

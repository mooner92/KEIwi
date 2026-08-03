"use client";

import { useEffect, useRef, useState } from "react";
import type { LogDoc } from "@/lib/opensearch";

type RunbookRef = { id: string; path: string };
type Plan = {
  node?: string;
  service?: string;
  keywords: string[];
  levels?: string[];
  from?: string;
};
type Result = {
  answer: string;
  evidence: LogDoc[];
  runbook: RunbookRef | null;
  plan?: Plan;
};
export type AssistantInitial = {
  service?: string;
  fleetNode?: string;
  message?: string;
  /** 시간창 시작(예 "now-6h") — 알림 딥링크의 ?from → ErrorContext.from(E2). */
  from?: string;
};

// 탐색 진입을 돕는 예시(클릭 시 그대로 질의).
const EXAMPLES = [
  "data04 ollama 최근 경고",
  "docker 관련 로그",
  "gpu 카테고리 에러",
];

/**
 * 로그 어시스턴트 (client). 질의 → /api/assistant(로컬 vLLM RAG) → 인용 응답.
 * prefill(현재 신호 "분석")이 있으면 마운트 시 1회 자동 분석. 읽기 전용(조치 자동적용 없음).
 * onEvidenceFocus: 근거 로그 행 "이 시점 →" 콜백(로그 워크벤치의 Grafana 딥링크 — specs/logs-assistant AC3).
 */
export function AssistantPanel({
  initial,
  onEvidenceFocus,
}: {
  initial?: AssistantInitial;
  onEvidenceFocus?: (doc: LogDoc) => void;
}) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fired = useRef(false);

  async function run(body: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setResult(j as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!fired.current && (initial?.service || initial?.message)) {
      fired.current = true;
      run({
        service: initial.service,
        fleetNode: initial.fleetNode,
        message: initial.message,
        from: initial.from,
      });
    }
  }, [initial]);

  return (
    // 나란히 놓인 패널이지 떠 있는 드로어가 아니다 — 그림자 없이 보더+면으로만 분리(v3 §3).
    <section
      aria-label="로그 어시스턴트"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-3"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) run({ message: question, question });
        }}
        className="flex gap-2"
      >
        {/* 입력 경계는 border-control — 흰 면 위 3:1을 넘겨야 컨트롤로 읽힌다(WCAG 1.4.11).
            포커스 링은 전역 :focus-visible(더블 링)이 담당하므로 여기서 보더를 덧칠하지 않는다. */}
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="예: data04 ollama 경고, docker 로그, gpu 카테고리 에러 (로컬 LLM · 외부 전송 없음)"
          className="h-9 min-w-0 flex-1 rounded-md border border-border-control bg-surface px-2.5 text-base text-ink outline-none placeholder:text-ink-subtle"
        />
        {/* 화면당 단 하나의 primary — 초록 예산 전부를 이 버튼이 쓴다(§초록 예산제) */}
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="inline-flex h-9 shrink-0 items-center rounded-md bg-accent-ink px-3 text-sm font-medium text-accent-contrast disabled:opacity-50"
        >
          분석
        </button>
      </form>

      {initial?.service || initial?.message ? (
        <p className="text-xs text-ink-subtle">
          분석 대상:{" "}
          <span className="tnum font-medium text-ink">
            {initial.service ?? ""} {initial.fleetNode ? `· ${initial.fleetNode}` : ""}
          </span>
        </p>
      ) : null}

      {!result && !loading && !error && !initial?.service && !initial?.message ? (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setQuestion(ex);
                run({ message: ex, question: ex });
              }}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-ink"
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      <div aria-live="polite" className="min-h-0">
        {loading ? (
          <p className="text-base text-ink-muted">로컬 vLLM 분석 중… (수 초)</p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-base text-danger-ink"
          >
            {error}
          </p>
        ) : null}
        {result ? <Answer result={result} onEvidenceFocus={onEvidenceFocus} /> : null}
      </div>
    </section>
  );
}

function planSummary(p: Plan): string {
  const parts = [
    p.node ?? "전체 노드",
    p.service ?? "전체 서비스",
    p.levels?.join("/") ?? "전체 레벨",
    p.from ?? "now-24h",
  ];
  if (p.keywords.length) parts.push(`키워드: ${p.keywords.join(" ")}`);
  return parts.join(" · ");
}

function Answer({
  result,
  onEvidenceFocus,
}: {
  result: Result;
  onEvidenceFocus?: (doc: LogDoc) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* 답변은 이 화면에서 유일하게 "읽는" 텍스트 — 14px/1.5(text-base)로 본문 가독성을 확보 */}
      <div className="whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-base text-ink">
        {result.answer}
      </div>

      {result.plan ? (
        <p className="text-xs text-ink-subtle">
          검색 계획: <span className="tnum">{planSummary(result.plan)}</span>
        </p>
      ) : null}

      {result.runbook ? (
        <p className="text-sm text-ink-muted">
          관련 런북: <span className="font-medium text-ink">{result.runbook.id}</span>{" "}
          <span className="tnum text-ink-subtle">({result.runbook.path})</span>
        </p>
      ) : null}

      <details className="rounded-md border border-border">
        <summary className="cursor-pointer px-3 py-1.5 text-sm font-medium text-ink-muted">
          근거 로그 <span className="tnum">{result.evidence.length}</span>건 (서버 검증)
        </summary>
        <ul className="divide-y divide-border-subtle border-t border-border">
          {result.evidence.map((d, i) => (
            <li key={d.id} className="px-3 py-1.5">
              <div className="flex items-center justify-between gap-2 text-2xs">
                {/* 인용 번호는 답변 본문의 [n]과 눈으로 맞춰야 해서 tnum·ink로 또렷하게 */}
                <span className="tnum min-w-0 truncate text-ink-subtle">
                  <span className="text-ink">[{i + 1}]</span> {d.timestamp} · {d.fleetNode} ·{" "}
                  {d.service}
                </span>
                {onEvidenceFocus ? (
                  <button
                    type="button"
                    onClick={() => onEvidenceFocus(d)}
                    title="Grafana 로그를 이 시각 ±5분으로 이동"
                    className="shrink-0 text-ink-muted underline underline-offset-2 hover:text-ink"
                  >
                    이 시점 →
                  </button>
                ) : null}
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm text-ink-muted">{d.message}</p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

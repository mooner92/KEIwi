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
 */
export function AssistantPanel({ initial }: { initial?: AssistantInitial }) {
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
      });
    }
  }, [initial]);

  return (
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
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="예: data04 ollama 경고, docker 로그, gpu 카테고리 에러 (로컬 LLM · 외부 전송 없음)"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-info-700"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="shrink-0 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          분석
        </button>
      </form>

      {initial?.service || initial?.message ? (
        <p className="text-xs text-ink-muted">
          분석 대상:{" "}
          <span className="tnum text-ink">
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
              className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      <div aria-live="polite" className="min-h-0">
        {loading ? (
          <p className="text-sm text-ink-muted">로컬 vLLM 분석 중… (수 초)</p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </p>
        ) : null}
        {result ? <Answer result={result} /> : null}
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

function Answer({ result }: { result: Result }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="whitespace-pre-wrap rounded-md bg-surface-2 px-3 py-2 text-sm leading-6 text-ink">
        {result.answer}
      </div>

      {result.plan ? (
        <p className="text-xs text-ink-muted">
          검색 계획:{" "}
          <span className="tnum text-ink-subtle">{planSummary(result.plan)}</span>
        </p>
      ) : null}

      {result.runbook ? (
        <p className="text-sm">
          <span className="text-ink-muted">관련 런북: </span>
          <span className="font-medium text-success-700">{result.runbook.id}</span>{" "}
          <span className="tnum text-ink-subtle">({result.runbook.path})</span>
        </p>
      ) : null}

      <details className="rounded-md border border-border">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink-muted">
          근거 로그 {result.evidence.length}건 (서버 검증)
        </summary>
        <ul className="divide-y divide-border border-t border-border">
          {result.evidence.map((d, i) => (
            <li key={d.id} className="px-3 py-1.5 text-xs">
              <span className="tnum text-ink-subtle">
                [{i + 1}] {d.timestamp} · {d.fleetNode} · {d.service}
              </span>
              <p className="mt-0.5 line-clamp-2 text-ink-muted">{d.message}</p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

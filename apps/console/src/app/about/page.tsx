import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumb } from "@/components/shell/breadcrumb";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = {
  title: "소개",
  description:
    "KEIwi — KEI 연구 서버 플릿(data01~05)을 하나의 콘솔에서 모니터링·로깅·진단하는 온프레미스 관제 시스템.",
};

/** 소개 페이지는 정적 콘텐츠만 — 네트워크/env 의존이 없어 프리렌더 가능. */

type Capability = { title: string; body: string; detail: string };

const CAPABILITIES: Capability[] = [
  {
    title: "메트릭",
    body: "5노드의 CPU·메모리·디스크와 GPU 6장의 사용률·VRAM·온도를 15초 간격으로 수집합니다.",
    detail: "Prometheus · node-exporter · DCGM",
  },
  {
    title: "통합 로그",
    body: "각 서버의 journald를 한곳에 모아 서비스·레벨로 정규화하고, 문제 신호를 먼저 보여줍니다.",
    detail: "Filebeat → Logstash → OpenSearch · 365일 보존",
  },
  {
    title: "여유 판정",
    body: "어느 서버에 GPU 작업을 올릴 수 있는지 판정합니다. 데이터가 없으면 '판정불가'로 정직하게 답합니다.",
    detail: "VRAM 기준 · 거짓 '여유' 금지",
  },
  {
    title: "로그 어시스턴트",
    body: "에러 로그를 사내 GPU의 로컬 LLM이 근거 인용과 함께 진단합니다. 외부로 나가는 데이터는 없습니다.",
    detail: "로컬 vLLM · RAG · 읽기 전용",
  },
];

type FleetNode = { id: string; role: string; gpu: string; state: "수집" | "대기" };

const FLEET: FleetNode[] = [
  { id: "data01", role: "연구 서버", gpu: "Tesla M4 ×1", state: "수집" },
  { id: "data02", role: "연구 서버 (Windows)", gpu: "—", state: "대기" },
  { id: "data03", role: "연구 서버", gpu: "Quadro RTX 6000 ×2", state: "수집" },
  { id: "data04", role: "연구 서버", gpu: "Quadro RTX 6000 ×2", state: "수집" },
  { id: "data05", role: "관제 스택 호스트", gpu: "A40 ×2", state: "수집" },
];

const PRINCIPLES = [
  {
    title: "단일 콘솔은 Grafana",
    body: "표준 대시보드를 콘솔에서 재구현하지 않습니다. 콘솔은 Grafana를 임베드하고, Grafana가 잘 못 하는 것만 더합니다.",
  },
  {
    title: "모르면 모른다고 한다",
    body: "메트릭이 없을 때 '정상'이나 '다운'으로 단정하지 않고 '수집 없음'으로 구분해 표시합니다.",
  },
  {
    title: "에이전트는 만들고, 사람이 적용한다",
    body: "설정·코드·런북은 저장소에 만들되 프로덕션 적용은 사람이 합니다.",
  },
  {
    title: "데이터는 망 밖으로 나가지 않는다",
    body: "메트릭·로그·추론 모델이 전부 온프레미스입니다. 모든 화면은 사내 전용입니다.",
  },
];

const STACK: { area: string; value: string }[] = [
  { area: "콘솔", value: "Next.js 16 · React 19 · TypeScript · Tailwind v4" },
  { area: "메트릭", value: "Prometheus · node-exporter · DCGM · 자체 exporter" },
  { area: "로그", value: "Filebeat · Logstash · OpenSearch" },
  { area: "대시보드", value: "Grafana (iframe 임베드 · 프로비저닝)" },
  { area: "어시스턴트", value: "로컬 vLLM (Qwen3-Coder-30B) · BM25 RAG" },
  { area: "배포", value: "Ansible (agentless) · inventory.yaml 단일 기준" },
  { area: "접근", value: "Cloudflare Zero Trust · 사내 전용" },
];

export default function AboutPage() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pb-8">
      <div className="flex flex-col gap-1">
        <Breadcrumb />
        <PageHeader title="KEIwi 소개" />
      </div>

      {/* 리드 — 이 시스템이 무엇인지 한 문단 */}
      <section className="max-w-3xl">
        <p className="text-md text-ink">
          KEI 연구 서버 플릿을 <strong className="font-semibold">하나의 콘솔에서</strong>{" "}
          모니터링·로깅·진단하고, 어느 서버가 여유 있는지 판단해 GPU 작업 배치를 돕는{" "}
          <strong className="font-semibold">온프레미스 관제 시스템</strong>입니다.
        </p>
        <p className="mt-2 text-ink-muted">
          서버마다 흩어져 있던 모니터링을 한곳으로 모으고, 로그와 메트릭을 같은 화면에서 보며,
          문제가 생기면 근거와 함께 진단합니다. 모든 데이터와 모델이 사내에 있습니다.
        </p>
      </section>

      {/* 무엇을 하는가 */}
      <section aria-labelledby="cap-h" className="flex flex-col gap-2">
        <h2 id="cap-h" className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
          무엇을 하는가
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {CAPABILITIES.map((c) => (
            <li
              key={c.title}
              className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-3.5"
            >
              <h3 className="text-md font-semibold text-ink">{c.title}</h3>
              <p className="flex-1 text-ink-muted">{c.body}</p>
              <p className="text-2xs text-ink-subtle">{c.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 데이터 흐름 */}
      <section aria-labelledby="flow-h" className="flex flex-col gap-2">
        <h2 id="flow-h" className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
          데이터 흐름
        </h2>
        <div className="rounded-lg border border-border bg-surface p-4">
          <ol className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            {[
              { step: "수집", body: "각 노드의 exporter와 journald" },
              { step: "저장", body: "Prometheus · OpenSearch (data05)" },
              { step: "표출", body: "Grafana 대시보드" },
              { step: "해석", body: "콘솔 요약 · 로컬 LLM 진단" },
            ].map((s, i, arr) => (
              <li key={s.step} className="flex flex-1 items-center gap-3">
                <div className="flex-1">
                  <p className="flex items-baseline gap-1.5">
                    <span className="tnum text-2xs text-ink-subtle">{i + 1}</span>
                    <span className="font-semibold text-ink">{s.step}</span>
                  </p>
                  <p className="text-ink-muted">{s.body}</p>
                </div>
                {i < arr.length - 1 && (
                  <span aria-hidden className="hidden text-ink-faint lg:inline">
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 플릿 구성 */}
        <section aria-labelledby="fleet-h" className="flex flex-col gap-2">
          <h2
            id="fleet-h"
            className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle"
          >
            플릿 구성
          </h2>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-2xs uppercase tracking-wide text-ink-subtle">
                  <th className="px-3 py-2 font-semibold">노드</th>
                  <th className="px-3 py-2 font-semibold">역할</th>
                  <th className="px-3 py-2 font-semibold">GPU</th>
                  <th className="px-3 py-2 font-semibold">상태</th>
                </tr>
              </thead>
              <tbody>
                {FLEET.map((n) => (
                  <tr key={n.id} className="border-b border-border-subtle last:border-0">
                    <th scope="row" className="px-3 py-2 font-medium text-ink">
                      {n.id}
                    </th>
                    <td className="px-3 py-2 text-ink-muted">{n.role}</td>
                    <td className="px-3 py-2 text-ink-muted">{n.gpu}</td>
                    <td className="px-3 py-2">
                      {/* 색 단독 금지 — 형태(채움/점선)와 단어를 함께 쓴다 */}
                      <span
                        className={
                          n.state === "수집"
                            ? "rounded-sm bg-surface-2 px-1.5 py-px text-2xs font-medium text-ink-muted"
                            : "rounded-sm border border-dashed border-border-strong px-1.5 py-px text-2xs font-medium text-ink-subtle"
                        }
                      >
                        {n.state}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-2xs text-ink-subtle">
            data02는 Windows로 수집 에이전트 적용을 준비 중입니다.
          </p>
        </section>

        {/* 기술 스택 */}
        <section aria-labelledby="stack-h" className="flex flex-col gap-2">
          <h2
            id="stack-h"
            className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle"
          >
            기술 스택
          </h2>
          <dl className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface">
            {STACK.map((s) => (
              <div key={s.area} className="flex gap-3 px-3 py-2">
                <dt className="w-20 shrink-0 font-medium text-ink">{s.area}</dt>
                <dd className="text-ink-muted">{s.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* 원칙 */}
      <section aria-labelledby="principle-h" className="flex flex-col gap-2">
        <h2
          id="principle-h"
          className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle"
        >
          운영 원칙
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <li
              key={p.title}
              className="rounded-lg border border-border bg-surface p-3.5"
            >
              {/* 좌측 초록 룰 = "이 프로젝트가 지키는 것" 표식(초록 예산제 안에서의 유일한 장식) */}
              <h3 className="border-l-2 border-accent-line pl-2.5 font-semibold text-ink">
                {p.title}
              </h3>
              <p className="mt-1.5 text-ink-muted">{p.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 바로가기 */}
      <section aria-labelledby="link-h" className="flex flex-col gap-2">
        <h2 id="link-h" className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
          바로가기
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/overview"
            className="rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-ink hover:border-border-strong hover:bg-surface-2"
          >
            플릿 Overview
          </Link>
          <Link
            href="/logs"
            className="rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-ink hover:border-border-strong hover:bg-surface-2"
          >
            통합 로그
          </Link>
          <a
            href="https://github.com/mooner92/KEIwi"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-ink hover:border-border-strong hover:bg-surface-2"
          >
            저장소 ↗
          </a>
        </div>
      </section>
    </div>
  );
}

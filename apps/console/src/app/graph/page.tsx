import { execFileSync } from "node:child_process";
import { Breadcrumb } from "@/components/shell/breadcrumb";
import { PageHeader } from "@/components/shell/page-header";
import { CodeGraphView } from "@/components/code-graph/code-graph-view";

// 산출물 파일을 매 요청 읽는다(재생성하면 새로고침만으로 반영) — 정적 캐시 금지.
export const dynamic = "force-dynamic";

/** 현재 HEAD — 그래프가 낡았는지 판정용. 실패해도 화면은 그대로 뜬다(부가 정보다). */
function headCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 3000,
    }).trim();
  } catch {
    return null;
  }
}

export default function GraphPage() {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-col gap-1">
        <Breadcrumb />
        <PageHeader title="코드 그래프" />
      </div>
      <CodeGraphView headCommit={headCommit()} />
    </div>
  );
}

import type { NextRequest } from "next/server";
import { answerError, explore, type ErrorContext } from "@/lib/assistant";
import { loadRunbooks } from "@/lib/runbooks";
import { getFacets } from "@/lib/facets";

// env(OpenSearch/vLLM)·네트워크 의존 → 정적 프리렌더 금지.
export const dynamic = "force-dynamic";

// GPU 자기경합 방지(ADR-0014): on-demand + 동시 1요청. 백그라운드 폴링 없음.
let inFlight = 0;
const MAX_CONCURRENT = 1;

export async function POST(req: NextRequest) {
  let ctx: ErrorContext;
  try {
    ctx = (await req.json()) as ErrorContext;
  } catch {
    return Response.json({ error: "잘못된 요청(JSON 아님)" }, { status: 400 });
  }

  if (inFlight >= MAX_CONCURRENT) {
    return Response.json(
      { error: "어시스턴트가 사용 중입니다(연구 GPU 경합 방지). 잠시 후 다시." },
      { status: 429 },
    );
  }

  inFlight++;
  try {
    const runbooks = await loadRunbooks();
    // 모드 분기: 신호행 "분석"(service/node 동반) → 진단형, 자유 질문 → 탐색형(질의계획).
    const isExplore = !ctx.service && !ctx.fleetNode;
    const question = (ctx.question || ctx.message || "").trim();
    if (isExplore && question) {
      const facets = await getFacets();
      const result = await explore(question, facets, runbooks);
      return Response.json(result);
    }
    const result = await answerError(ctx, runbooks);
    return Response.json(result);
  } catch (e) {
    // OpenSearch/vLLM 미설정·불가 등. 콘솔은 읽기 전용이라 부작용 없음.
    return Response.json(
      { error: `어시스턴트 처리 실패: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  } finally {
    inFlight--;
  }
}

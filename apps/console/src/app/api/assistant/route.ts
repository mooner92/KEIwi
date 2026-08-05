import type { NextRequest } from "next/server";
import { answerError, explore, type ErrorContext } from "@/lib/assistant";
import { loadRunbooks } from "@/lib/runbooks";
import { getFacets } from "@/lib/facets";

// env(OpenSearch/vLLM)·네트워크 의존 → 정적 프리렌더 금지.
export const dynamic = "force-dynamic";

// GPU 자기경합 방지(ADR-0014): on-demand + 동시 1요청. 백그라운드 폴링 없음.
// 이 게이트가 문서 RAG(:8131)의 **상류 게이트**이기도 하다 — 서비스 쪽 세마포어 2는
// 이중 안전일 뿐이고, 라이브 vLLM에 대한 실제 동시성 상한은 여기 1이다(§12).
let inFlight = 0;
const MAX_CONCURRENT = 1;

// 응답 형태(가산 확장, ADR-0026):
//   evidence     — 로그 근거. **여기 형태를 바꾸지 마라.** alert-relay가
//                  `render_assistant_reply()`에서 이 배열로 Slack 근거줄을 렌더하고
//                  0건이면 답글을 생략한다(AC-E3-7).
//   docEvidence  — 문서 근거(런북·ADR). 새 필드라 기존 소비자는 무시한다.
//   ragStatus    — ok|skipped|error. RAG가 죽어도 answer/evidence는 정상이다.

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

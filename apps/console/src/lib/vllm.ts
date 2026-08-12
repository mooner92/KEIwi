import { getVllmUrl, getVllmModel, getVllmBackend } from "@/config/env";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOpts = {
  maxTokens?: number;
  temperature?: number;
};

/** 생성이 이 시간을 넘기면 끊는다 — 어시스턴트는 대화형이라 무한 대기가 장애보다 나쁘다. */
const TIMEOUT_MS = 180_000;

// ── ollama 네이티브 경로 ─────────────────────────────────────────────────────
//
// 왜 OpenAI 호환(/v1/chat/completions)을 쓰지 않는가 — 실측(2026-08-12, qwen3.5:9B):
//   ollama의 OpenAI 호환 레이어는 **thinking을 끌 방법이 없다.** `think` 파라미터를 무시하고
//   프롬프트의 `/no_think` 지시어도 이 모델에는 먹지 않는다. 그 결과 응답이
//   `reasoning`만 626자 채운 채 `content=""` · `finish_reason="length"` 로 잘린다
//   (max_tokens를 2000으로 올려도 동일 — 사고과정이 예산을 전부 소진한다).
//   네이티브 `/api/chat` + `think:false`는 같은 질문에 `content="둘"` · thinking 0으로 정상 응답한다.
// → reasoning 모델을 근거 기반 RAG에 쓰려면 이 경로가 유일하다.

type OllamaBody = {
  model: string;
  messages: ChatMessage[];
  think: false;
  stream: false;
  options: { temperature: number; num_predict: number };
};

/** ollama `/api/chat` 요청 본문 (순수 — 테스트 대상). */
export function buildOllamaBody(
  model: string,
  messages: ChatMessage[],
  opts: ChatOpts,
): OllamaBody {
  return {
    model,
    messages,
    // 이 두 값이 계약의 핵심이다 — 빼면 답변이 빈 채로 돌아온다(위 주석).
    think: false,
    stream: false,
    options: {
      temperature: opts.temperature ?? 0.1,
      num_predict: opts.maxTokens ?? 700,
    },
  };
}

/**
 * ollama 응답 파싱 (순수 — 테스트 대상).
 * content가 비었는데 thinking이 있으면 **think:false가 먹지 않은 것**이다 — 빈 문자열을
 * 답변으로 돌려주면 "모델이 대답을 안 한다"로 오진하게 되므로 원인을 적어 throw한다.
 */
export function parseOllamaResponse(json: unknown): string {
  const m = (json as { message?: { content?: unknown; thinking?: unknown } })?.message;
  const content = typeof m?.content === "string" ? m.content : "";
  if (content.trim() !== "") return content;
  const thinking = typeof m?.thinking === "string" ? m.thinking : "";
  if (thinking.trim() !== "") {
    throw new Error(
      "[llm] 빈 응답 — thinking만 생성됨(think:false 미적용). 모델/ollama 버전을 확인하세요.",
    );
  }
  throw new Error("[llm] 빈 응답");
}

/** OpenAI 호환 응답 파싱 (순수 — 테스트 대상). */
export function parseOpenAiResponse(json: unknown): string {
  const c = (json as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;
  if (typeof c !== "string" || c.trim() === "") throw new Error("[llm] 빈 응답");
  return c;
}

/**
 * 로컬 LLM 채팅 완료 (서버 전용 — 'use client' 금지). 외부 egress 0(사내 엔드포인트만).
 * 백엔드는 `VLLM_BACKEND`로 고른다 — `openai`(vLLM 등 OpenAI 호환) | `ollama`(네이티브).
 * 실패는 throw → 호출부 처리. MVP는 비스트리밍(스트리밍은 backlog).
 *
 * env 접두사가 `VLLM_*`인 것은 역사적 이유다(최초 백엔드가 vLLM) — 지금은 "로컬 LLM 엔드포인트"를 뜻한다.
 */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOpts = {},
): Promise<string> {
  const base = getVllmUrl().replace(/\/+$/, "");
  const backend = getVllmBackend();
  const isOllama = backend === "ollama";

  const url = isOllama ? `${base}/api/chat` : `${base}/v1/chat/completions`;
  const body = isOllama
    ? buildOllamaBody(getVllmModel(), messages, opts)
    : {
        model: getVllmModel(),
        messages,
        max_tokens: opts.maxTokens ?? 700,
        temperature: opts.temperature ?? 0.1,
        stream: false,
      };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`[llm] HTTP ${res.status}`);
  const json: unknown = await res.json();
  return isOllama ? parseOllamaResponse(json) : parseOpenAiResponse(json);
}

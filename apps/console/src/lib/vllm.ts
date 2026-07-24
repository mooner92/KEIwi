import { getVllmUrl, getVllmModel } from "@/config/env";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOpts = {
  maxTokens?: number;
  temperature?: number;
};

/**
 * 로컬 vLLM 채팅 완료 (서버 전용 — 'use client' 금지). OpenAI 호환 /v1/chat/completions.
 * 외부 egress 0(내부 vLLM만). 실패는 throw → 호출부 처리. MVP는 비스트리밍(스트리밍은 backlog).
 */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOpts = {},
): Promise<string> {
  const base = getVllmUrl().replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getVllmModel(),
      messages,
      max_tokens: opts.maxTokens ?? 700,
      temperature: opts.temperature ?? 0.1,
      stream: false,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`[vllm] HTTP ${res.status}`);
  const json: { choices?: { message?: { content?: string } }[] } =
    await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("[vllm] 빈 응답");
  return content;
}

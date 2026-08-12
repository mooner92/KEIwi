import { describe, expect, it } from "vitest";
import { buildOllamaBody, parseOllamaResponse, parseOpenAiResponse } from "./vllm";

describe("buildOllamaBody — think:false 계약", () => {
  it("think·stream을 false로 고정한다 (빼면 답변이 빈 채로 온다)", () => {
    const b = buildOllamaBody("qwen3.5:9B", [{ role: "user", content: "안녕" }], {});
    expect(b.think).toBe(false);
    expect(b.stream).toBe(false);
    expect(b.model).toBe("qwen3.5:9B");
  });

  it("maxTokens·temperature를 ollama options 이름으로 옮긴다", () => {
    const b = buildOllamaBody("m", [], { maxTokens: 1234, temperature: 0.7 });
    expect(b.options.num_predict).toBe(1234);
    expect(b.options.temperature).toBe(0.7);
  });

  it("기본값: num_predict 700 · temperature 0.1 (근거 기반 답변이라 낮게)", () => {
    const b = buildOllamaBody("m", [], {});
    expect(b.options.num_predict).toBe(700);
    expect(b.options.temperature).toBe(0.1);
  });
});

describe("parseOllamaResponse", () => {
  it("정상 응답의 content를 돌려준다", () => {
    expect(parseOllamaResponse({ message: { content: "둘" } })).toBe("둘");
  });

  it("content가 비고 thinking만 있으면 원인을 적어 throw — 빈 답변으로 오진 방지", () => {
    expect(() =>
      parseOllamaResponse({ message: { content: "", thinking: "사고과정만 잔뜩" } }),
    ).toThrow(/think:false 미적용/);
  });

  it("둘 다 비면 일반 빈 응답으로 throw", () => {
    expect(() => parseOllamaResponse({ message: { content: "" } })).toThrow(/빈 응답/);
    expect(() => parseOllamaResponse({})).toThrow(/빈 응답/);
  });

  it("공백만 있는 content는 빈 것으로 취급", () => {
    expect(() => parseOllamaResponse({ message: { content: "   \n" } })).toThrow(/빈 응답/);
  });
});

describe("parseOpenAiResponse", () => {
  it("choices[0].message.content를 돌려준다", () => {
    expect(parseOpenAiResponse({ choices: [{ message: { content: "답" } }] })).toBe("답");
  });

  it("형태가 어긋나거나 비면 throw", () => {
    expect(() => parseOpenAiResponse({ choices: [] })).toThrow(/빈 응답/);
    expect(() => parseOpenAiResponse({ choices: [{ message: { content: "" } }] })).toThrow(
      /빈 응답/,
    );
    expect(() => parseOpenAiResponse(null)).toThrow(/빈 응답/);
  });
});

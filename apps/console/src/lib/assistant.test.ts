import { describe, it, expect } from "vitest";
import {
  scrubSecrets,
  renderEvidenceBlock,
  buildPrompt,
  runbookMatch,
  type ErrorContext,
  type RunbookRef,
} from "@/lib/assistant";
import type { LogDoc } from "@/lib/opensearch";

const doc = (over: Partial<LogDoc>): LogDoc => ({
  id: "id1",
  timestamp: "2026-06-29T01:00:00Z",
  fleetNode: "data04",
  service: "rsyslog.service",
  level: "warn",
  message: "action 'omfile' suspended",
  ...over,
});

describe("scrubSecrets (§13 — 프롬프트 전 마스킹)", () => {
  it("token=값 마스킹", () => {
    expect(scrubSecrets("token=abc123def")).not.toContain("abc123def");
  });
  it("password: 값 마스킹", () => {
    expect(scrubSecrets("password: hunter2pass")).not.toContain("hunter2pass");
  });
  it("Authorization: Bearer <토큰> — 실제 토큰 미노출", () => {
    const out = scrubSecrets("Authorization: Bearer eyJhbGci.signature");
    expect(out).not.toContain("eyJhbGci.signature");
  });
  it("일반 단어 'key'는 과마스킹 안 함", () => {
    expect(scrubSecrets("the key is on the table")).toBe(
      "the key is on the table",
    );
  });
});

describe("renderEvidenceBlock", () => {
  it("근거를 [n]으로 번호매김 + 시크릿 스크럽", () => {
    const b = renderEvidenceBlock([
      doc({ message: "boom token=SEKRET" }),
      doc({ id: "id2", level: "error", message: "second" }),
    ]);
    expect(b).toContain("[1]");
    expect(b).toContain("[2]");
    expect(b).not.toContain("SEKRET");
  });
  it("빈 근거는 명시", () => {
    expect(renderEvidenceBlock([])).toBe("(검색된 로그 없음)");
  });
});

describe("buildPrompt (인젝션 격리 + 근거 강제)", () => {
  const ctx: ErrorContext = {
    service: "rsyslog.service",
    fleetNode: "data04",
    message: "omfile suspended",
  };
  it("시스템 프롬프트에 인젝션 불복 + 인용 규칙", () => {
    const [sys] = buildPrompt(ctx, [doc({})]);
    expect(sys.role).toBe("system");
    expect(sys.content).toContain("따르지 않는다"); // 인젝션 불복 규칙
    expect(sys.content).toContain("인용"); // 근거 강제 규칙
  });
  it("사용자 메시지에 DATA 블록 + 번호 근거", () => {
    const [, user] = buildPrompt(ctx, [doc({}), doc({ id: "id2" })]);
    expect(user.content).toContain("<<<DATA");
    expect(user.content).toContain("<<<END DATA>>>");
    expect(user.content).toContain("[1]");
    expect(user.content).toContain("[2]");
  });
  it("질문 없으면 기본 진단 질문", () => {
    const [, user] = buildPrompt(ctx, []);
    expect(user.content).toContain("질문:");
  });
  it("컨텍스트 메시지의 시크릿도 스크럽", () => {
    const [, user] = buildPrompt({ message: "fail api_key=LEAKED" }, []);
    expect(user.content).not.toContain("LEAKED");
  });
});

describe("runbookMatch (키워드 — signature > service > category)", () => {
  const rbs: RunbookRef[] = [
    {
      id: "rsyslog-omfile-flood",
      path: "docs/runbooks/rsyslog-omfile-flood.md",
      service: "rsyslog.service",
      category: "infra",
      signature: "omfile' suspended",
    },
    { id: "other", path: "x.md", service: "nginx.service", category: "web" },
  ];
  it("signature 부분일치 우선", () => {
    const m = runbookMatch({ message: "action 'omfile' suspended retry" }, rbs);
    expect(m?.id).toBe("rsyslog-omfile-flood");
  });
  it("signature 없으면 service 일치", () => {
    const m = runbookMatch({ service: "nginx.service", message: "boom" }, rbs);
    expect(m?.id).toBe("other");
  });
  it("category 일치(마지막 수단)", () => {
    const m = runbookMatch({ message: "boom" }, rbs, "infra");
    expect(m?.id).toBe("rsyslog-omfile-flood");
  });
  it("아무것도 없으면 null", () => {
    expect(runbookMatch({ message: "unrelated" }, rbs)).toBeNull();
  });
});

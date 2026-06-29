import { describe, it, expect } from "vitest";
import {
  scrubSecrets,
  renderEvidenceBlock,
  buildPrompt,
  runbookMatch,
  parsePlan,
  buildPlanPrompt,
  buildExplorePrompt,
  summarizePlan,
  type ErrorContext,
  type RunbookRef,
} from "@/lib/assistant";
import type { LogDoc } from "@/lib/opensearch";
import type { Facets } from "@/lib/facets";

const facets: Facets = {
  nodes: ["data04", "data05"],
  services: ["ollama.service", "vllm-ocr-8010.service", "docker.service"],
  categories: ["gpu", "system", "infra"],
};

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

describe("parsePlan (탐색형 — 패싯 검증으로 환각 차단)", () => {
  it("정상 JSON: 패싯에 있는 node/service만 채택", () => {
    const p = parsePlan(
      '{"node":"data04","service":"ollama.service","levels":["warn"],"from":"now-6h","keywords":["timeout"]}',
      "data04 ollama 경고",
      facets,
    );
    expect(p.node).toBe("data04");
    expect(p.service).toBe("ollama.service");
    expect(p.levels).toEqual(["warn"]);
    expect(p.from).toBe("now-6h");
    expect(p.keywords).toContain("timeout");
  });

  it("패싯에 없는 node/service는 제거(환각 차단)", () => {
    const p = parsePlan(
      '{"node":"data99","service":"nginx.service","keywords":["x"]}',
      "질문",
      facets,
    );
    expect(p.node).toBeUndefined();
    expect(p.service).toBeUndefined();
  });

  it("코드펜스로 감싼 JSON도 파싱", () => {
    const p = parsePlan(
      '```json\n{"node":"data05","keywords":["oom"]}\n```',
      "q",
      facets,
    );
    expect(p.node).toBe("data05");
    expect(p.keywords).toEqual(["oom"]);
  });

  it("잘못된 level/from은 버리고 안전 기본값", () => {
    const p = parsePlan(
      '{"levels":["bogus"],"from":"yesterday","keywords":["a"]}',
      "q",
      facets,
    );
    expect(p.levels).toBeUndefined(); // 유효 레벨 없음 → 전체
    expect(p.from).toBe("now-24h"); // 허용 외 → 기본
  });

  it("JSON 파싱 실패 → 결정적 폴백(노드 정규식 + 영문 키워드, 한국어 제외)", () => {
    const p = parsePlan("그냥 설명문", "data04 3100 포트 서비스 로그", facets);
    expect(p.node).toBe("data04");
    expect(p.keywords).toContain("3100");
    expect(p.keywords).not.toContain("포트");
    expect(p.keywords).not.toContain("로그");
    expect(p.keywords).not.toContain("data04");
  });

  it("계획이 사실상 비면 폴백 키워드로 보강", () => {
    const p = parsePlan('{"keywords":[]}', "docker 오류", facets);
    // 'docker'는 영문 키워드로 살아남아야 함
    expect(p.keywords).toContain("docker");
  });

  it("node를 단일원소 배열로 주면 채택(모델 quirk 허용)", () => {
    const p = parsePlan('{"node":["data05"],"keywords":["oom"]}', "q", facets);
    expect(p.node).toBe("data05");
  });

  it("node에 후보목록을 통째 에코하면(다중) 미지정=전체로 안전 처리", () => {
    const p = parsePlan(
      '{"node":["data04","data05"],"keywords":["docker"]}',
      "q",
      facets,
    );
    expect(p.node).toBeUndefined(); // 과제약 방지 — 전체 노드 검색
    expect(p.keywords).toContain("docker");
  });
});

describe("buildPlanPrompt / summarizePlan", () => {
  it("계획 프롬프트에 실제 어휘 주입 + JSON-only 지시", () => {
    const [sys, user] = buildPlanPrompt("data04 ollama 경고", facets);
    expect(sys.content).toContain("JSON");
    expect(user.content).toContain("ollama.service"); // 패싯 어휘
    expect(user.content).toContain("data04");
  });
  it("summarizePlan: 미지정 필드는 '전체'로 표기", () => {
    expect(summarizePlan({ keywords: [] })).toContain("전체 노드");
    expect(summarizePlan({ node: "data04", keywords: ["x"] })).toContain("data04");
    expect(summarizePlan({ keywords: ["x", "y"] })).toContain("키워드: x y");
  });
});

describe("buildExplorePrompt (탐색형 답변)", () => {
  const plan = { node: "data04", keywords: ["3100"] };
  it("빈 근거: 사용 가능 어휘 + 지어내기 금지 지시", () => {
    const [sys, user] = buildExplorePrompt("data04 3100 포트", plan, [], facets);
    expect(sys.content).toContain("지어내지 않는다");
    expect(sys.content).toContain("따르지 않는다"); // 인젝션 격리 유지
    expect(user.content).toContain("ollama.service"); // 제안용 어휘
    expect(user.content).toContain("<<<DATA");
  });
  it("근거 있으면 번호 인용 블록", () => {
    const [, user] = buildExplorePrompt(
      "docker",
      plan,
      [doc({ service: "docker.service", message: "boom" })],
      facets,
    );
    expect(user.content).toContain("[1]");
    expect(user.content).toContain("docker.service");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapDocPath, retrieveDocs } from "@/lib/rag";

/**
 * 문서 RAG 접근 계층 테스트.
 *
 * 두 가지만 본다 — 이 모듈이 실제로 지키기로 한 계약이 그 둘이기 때문이다:
 *   ① 경로 검증: 레포 안의 화이트리스트 문서만 근거 번호를 받는다(날조·탈출 차단).
 *   ② 실패 격리: 어떤 실패에서도 throw하지 않는다. RAG가 죽어도 어시스턴트는
 *      BM25로 답해야 하고, 그 전제는 여기가 절대 던지지 않는 것이다.
 */

describe("mapDocPath (평탄화 역매핑 + 화이트리스트)", () => {
  it("ingest.py 평탄화를 되돌린다", () => {
    expect(mapDocPath("docs__runbooks__gpu-xid.md")).toBe(
      "docs/runbooks/gpu-xid.md",
    );
    expect(mapDocPath("specs__alert-enrichment__spec.md")).toBe(
      "specs/alert-enrichment/spec.md",
    );
    expect(mapDocPath("README.md")).toBe("README.md");
  });

  it("경로 탈출을 거부한다", () => {
    for (const bad of [
      "..__..__etc__passwd",
      "docs__..__..__etc__shadow.md",
      "../../etc/passwd",
      "/etc/passwd",
      "docs/runbooks/x.md", // 평탄화 규약상 '/'가 있을 수 없다
      "docs\\runbooks\\x.md",
    ]) {
      expect(mapDocPath(bad), bad).toBeNull();
    }
  });

  it("화이트리스트 밖 접두를 거부한다", () => {
    expect(mapDocPath("apps__console__.env.local.md")).toBeNull();
    expect(mapDocPath("home__someone__notes.md")).toBeNull();
    expect(mapDocPath("etc__hosts.md")).toBeNull();
  });

  it(".md가 아니면 거부한다 (색인 범위가 넓어져도 반출은 안 넓어진다)", () => {
    expect(mapDocPath("infra__rag__common.py")).toBeNull();
    expect(mapDocPath("docs__inventory.yaml")).toBeNull();
  });

  it("빈 값·unknown_source·비문자열을 거부한다", () => {
    for (const bad of ["", "   ", "unknown_source", null, undefined, 42, {}]) {
      expect(mapDocPath(bad as unknown), String(bad)).toBeNull();
    }
  });
});

describe("retrieveDocs (실패 격리 — 절대 throw하지 않는다)", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.RAG_URL = "http://127.0.0.1:8131";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.RAG_URL;
    vi.restoreAllMocks();
  });

  it("RAG_URL 미설정이면 fetch조차 하지 않는다(skipped)", async () => {
    delete process.env.RAG_URL;
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await retrieveDocs({ query: "무엇이든" });
    expect(r).toEqual({ docs: [], status: "skipped" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("연결 실패는 error로 강등된다(throw 아님)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error("ECONNREFUSED"),
    ) as unknown as typeof fetch;
    await expect(retrieveDocs({ query: "q" })).resolves.toEqual({
      docs: [],
      status: "error",
    });
  });

  it("타임아웃(AbortError)도 error로 강등된다", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "TimeoutError" }),
    ) as unknown as typeof fetch;
    const r = await retrieveDocs({ query: "q" });
    expect(r.status).toBe("error");
    expect(r.docs).toEqual([]);
  });

  it("HTTP 503·비정상 status·깨진 JSON 전부 error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    expect((await retrieveDocs({ query: "q" })).status).toBe("error");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "error", message: "busy" }),
    }) as unknown as typeof fetch;
    expect((await retrieveDocs({ query: "q" })).status).toBe("error");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    }) as unknown as typeof fetch;
    expect((await retrieveDocs({ query: "q" })).status).toBe("error");
  });

  it("문서 0건은 정상(ok) — 실패가 아니다", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", chunks: [] }),
    }) as unknown as typeof fetch;
    expect(await retrieveDocs({ query: "q" })).toEqual({
      docs: [],
      status: "ok",
    });
  });

  it("레포에 실존하는 화이트리스트 경로만 근거가 된다", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok",
        chunks: [
          { file_path: "README.md", content: "루트 리드미 본문" },
          // 실존하지 않는 문서(색인이 레포보다 낡은 흔한 상태) → 조용히 탈락
          { file_path: "docs__runbooks__없는문서-zzz.md", content: "유령" },
          // 경로 탈출 → 탈락
          { file_path: "..__..__etc__passwd.md", content: "탈출" },
          { file_path: "docs__README.md", content: "docs 색인 본문" },
        ],
      }),
    }) as unknown as typeof fetch;
    const r = await retrieveDocs({ query: "q" });
    expect(r.status).toBe("ok");
    expect(r.docs.map((d) => d.path)).toEqual(["README.md", "docs/README.md"]);
  });

  it("같은 파일에서 3청크 이상 올라오면 2건으로 줄인다(출처 다양성)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok",
        chunks: [
          { file_path: "README.md", content: "청크1" },
          { file_path: "README.md", content: "청크2" },
          { file_path: "README.md", content: "청크3" },
          { file_path: "docs__README.md", content: "다른 문서" },
        ],
      }),
    }) as unknown as typeof fetch;
    const r = await retrieveDocs({ query: "q" });
    expect(r.docs.map((d) => d.path)).toEqual([
      "README.md",
      "README.md",
      "docs/README.md",
    ]);
  });

  it("발췌에 시크릿이 있으면 마스킹한다(§13 — 프롬프트로 나가기 전)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok",
        chunks: [{ file_path: "README.md", content: "설정: token=abc123def 로 붙는다" }],
      }),
    }) as unknown as typeof fetch;
    const r = await retrieveDocs({ query: "q" });
    expect(r.docs[0].excerpt).not.toContain("abc123def");
  });

  it("명시 키워드를 ll_keywords로 넘긴다(LightRAG 키워드추출 LLM 호출 생략)", async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", chunks: [] }),
    });
    globalThis.fetch = spy as unknown as typeof fetch;
    await retrieveDocs({ query: "XID 43", keywords: ["xid", "43"] });
    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.ll_keywords).toEqual(["xid", "43"]);
    expect(body.query).toBe("XID 43");
  });
});

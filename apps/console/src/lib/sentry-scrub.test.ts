import { describe, it, expect } from "vitest";
import { scrubEvent, maskHostInfo } from "@/lib/sentry-scrub";
import type { ErrorEvent } from "@sentry/nextjs";

/**
 * 반출 최소화 검증 (spec §5.4 / AC-E-6의 단위 테스트 대응분).
 * 여기서 막지 못하면 실제 envelope에 그대로 실린다.
 */

const ev = (o: Record<string, unknown>) => o as unknown as ErrorEvent;

describe("maskHostInfo — 사설 IP 마스킹", () => {
  it("플릿 IP를 가린다", () => {
    expect(maskHostInfo("connect 192.168.1.104:9400 failed")).toBe("connect [ip]:9400 failed");
  });
  it("172.18 도커 브리지도 가린다", () => {
    expect(maskHostInfo("http://172.18.0.1:8090/x")).toBe("http://[ip]:8090/x");
  });
  it("공인 IP는 건드리지 않는다(오탐 방지)", () => {
    expect(maskHostInfo("8.8.8.8 ok")).toBe("8.8.8.8 ok");
  });
});

describe("scrubEvent — 화이트리스트 재조립", () => {
  it("request에서 쿼리스트링·헤더·쿠키·body를 없앤다", () => {
    const e = scrubEvent(
      ev({
        request: {
          url: "http://192.168.1.105:3105/api/x?token=SECRET&node=data04",
          method: "GET",
          headers: { cookie: "session=abc" },
          data: { password: "p" },
          query_string: "token=SECRET",
        },
      }),
    )!;
    const r = (e as unknown as { request: Record<string, unknown> }).request;
    expect(r.url).toBe("http://[ip]:3105/api/x"); // 쿼리 제거 + IP 마스킹
    expect(r.method).toBe("GET");
    expect(r.headers).toBeUndefined();
    expect(r.data).toBeUndefined();
    expect(r.query_string).toBeUndefined();
  });

  it("허용 태그만 남긴다 — user 같은 계정명 태그는 소멸", () => {
    const e = scrubEvent(ev({ tags: { route: "/logs", runtime: "node", user: "user6", pid: "4916" } }))!;
    expect((e as unknown as { tags: Record<string, string> }).tags).toEqual({
      route: "/logs",
      runtime: "node",
    });
  });

  it("breadcrumb은 http/fetch만 남기고 data를 버린다", () => {
    const e = scrubEvent(
      ev({
        breadcrumbs: [
          { category: "http", data: { body: "SECRET" } },
          { category: "console", message: "debug dump" },
        ],
      }),
    )!;
    const c = (e as unknown as { breadcrumbs: Record<string, unknown>[] }).breadcrumbs;
    expect(c).toHaveLength(1);
    expect(c[0].category).toBe("http");
    expect(c[0].data).toBeUndefined();
  });

  it("스택 프레임의 소스 본문·변수·절대경로를 없애고 파일명을 상대화한다", () => {
    const e = scrubEvent(
      ev({
        exception: {
          values: [
            {
              value: "fetch 192.168.1.103 실패",
              stacktrace: {
                frames: [
                  {
                    filename: "/home/mooner92/keiwi-design/apps/console/src/lib/capacity.ts",
                    abs_path: "/home/mooner92/…",
                    context_line: "const token = process.env.SECRET",
                    pre_context: ["x"],
                    post_context: ["y"],
                    vars: { token: "SECRET" },
                    function: "judgeGpu",
                    lineno: 164,
                  },
                ],
              },
            },
          ],
        },
      }),
    )!;
    const f = (e as unknown as { exception: { values: { stacktrace: { frames: Record<string, unknown>[] } }[] } })
      .exception.values[0].stacktrace.frames[0];
    expect(f.filename).toBe("apps/console/src/lib/capacity.ts");
    expect(f.function).toBe("judgeGpu");
    expect(f.context_line).toBeUndefined();
    expect(f.pre_context).toBeUndefined();
    expect(f.vars).toBeUndefined();
    expect(f.abs_path).toBeUndefined();
    // 예외 메시지의 IP도 마스킹
    const v = (e as unknown as { exception: { values: { value: string }[] } }).exception.values[0];
    expect(v.value).toBe("fetch [ip] 실패");
  });

  it("contexts는 runtime만 — os·device(커널·RAM)는 정찰 정보라 버린다", () => {
    const e = scrubEvent(
      ev({ contexts: { runtime: { name: "node" }, os: { kernel_version: "6.8.0-117" }, device: { memory_size: 1 } } }),
    )!;
    expect((e as unknown as { contexts: Record<string, unknown> }).contexts).toEqual({
      runtime: { name: "node" },
    });
  });

  it("modules·user는 통째로 버린다", () => {
    const e = scrubEvent(ev({ modules: { next: "16" }, user: { id: "u1", ip_address: "192.168.1.9" } }))!;
    expect((e as unknown as { modules?: unknown }).modules).toBeUndefined();
    expect((e as unknown as { user?: unknown }).user).toBeUndefined();
  });

  it("모르는 새 필드가 request에 생겨도 재조립이라 새지 않는다(회귀 가드)", () => {
    const e = scrubEvent(ev({ request: { url: "http://x/y", method: "GET", futureSecretField: "LEAK" } }))!;
    expect(JSON.stringify(e)).not.toContain("LEAK");
  });
});

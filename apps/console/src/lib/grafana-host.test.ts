import { describe, it, expect } from "vitest";
import { resolveGrafanaBase, hostnameOf } from "@/lib/grafana-host";

// 픽스처 도메인은 RFC 2606(example.com) — 실도메인을 커밋하지 않는다(check:secrets S2 스코프
// 밖이지만 문서·픽스처 규약은 같다). 순수 문자열 비교라 도메인이 바뀌어도 동작은 불변이다.
const CONF = "https://grafana.example.com";

describe("resolveGrafanaBase (임베드 same-site 보장 — 로그인 루프 방지)", () => {
  it("같은 사이트(도메인 접속) → 설정 URL 그대로", () => {
    expect(resolveGrafanaBase(CONF, "console.example.com")).toBe(CONF);
    expect(resolveGrafanaBase(CONF, "grafana.example.com")).toBe(CONF);
    expect(resolveGrafanaBase(CONF, "a.b.example.com:443")).toBe(CONF);
  });

  it("대소문자 무시", () => {
    expect(resolveGrafanaBase(CONF, "CONSOLE.EXAMPLE.COM")).toBe(CONF);
  });

  it("내부 IP 접속 → 같은 호스트 :3000 (크로스 사이트 회피)", () => {
    expect(resolveGrafanaBase(CONF, "192.168.1.105:3105")).toBe(
      "http://192.168.1.105:3000",
    );
    expect(resolveGrafanaBase(CONF, "192.168.1.105")).toBe(
      "http://192.168.1.105:3000",
    );
  });

  it("localhost/루프백(QA 격리 빌드 포함) → 같은 호스트 :3000", () => {
    expect(resolveGrafanaBase(CONF, "localhost:3199")).toBe("http://localhost:3000");
    expect(resolveGrafanaBase(CONF, "127.0.0.1:3199")).toBe("http://127.0.0.1:3000");
  });

  it("사설 단일 라벨 호스트명 → 같은 호스트 :3000", () => {
    expect(resolveGrafanaBase(CONF, "data05:3105")).toBe("http://data05:3000");
  });

  it("IPv6 → 브래킷 유지", () => {
    expect(resolveGrafanaBase(CONF, "[::1]:3105")).toBe("http://[::1]:3000");
  });

  it("host 없음/빈 값 → 설정 URL 폴백", () => {
    expect(resolveGrafanaBase(CONF, null)).toBe(CONF);
    expect(resolveGrafanaBase(CONF, "")).toBe(CONF);
  });

  it("설정 URL이 비정상이면 그대로 반환(방어)", () => {
    expect(resolveGrafanaBase("not-a-url", "192.168.1.105")).toBe("not-a-url");
  });
});

describe("hostnameOf", () => {
  it("포트 제거·소문자", () => {
    expect(hostnameOf("KEIwi.Example.COM:3105")).toBe("keiwi.example.com");
  });
  it("IPv6 브래킷 파싱", () => {
    expect(hostnameOf("[2001:db8::1]:3105")).toBe("2001:db8::1");
  });
  it("null/빈 값 → \"\"", () => {
    expect(hostnameOf(null)).toBe("");
    expect(hostnameOf("  ")).toBe("");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { buildAlertQuestion, PRESET_ALERT_NAMES } from "@/lib/alert-presets";

describe("프리셋 테이블 ↔ alert-rules.yaml 동기 게이트", () => {
  it("라이브 알림 전 종을 프리셋이 커버한다(누락 시 이 테스트가 알림 추가를 강제)", () => {
    // 정본에서 alertname 추출 — 외우지 않는다(specs/alert-enrichment §2 D2-2).
    const yaml = readFileSync(
      resolve(
        process.cwd(),
        "../../infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml",
      ),
      "utf8",
    );
    const titles = [...yaml.matchAll(/^\s+title:\s+(\S+)\s*$/gm)].map((m) => m[1]);
    expect(titles.length).toBeGreaterThanOrEqual(14);
    for (const t of titles) expect(PRESET_ALERT_NAMES).toContain(t);
  });
});

describe("buildAlertQuestion (알림 → 초기 질문)", () => {
  it("DiskUsageHigh: node·mount 치환", () => {
    const q = buildAlertQuestion("DiskUsageHigh", { node: "data04", mount: "/" });
    expect(q).toBe("최근 6시간 data04 / 디스크 사용 급증의 원인 후보를 로그에서 찾아줘");
  });
  it("GpuTempHigh: node만 치환", () => {
    expect(buildAlertQuestion("GpuTempHigh", { node: "data03" })).toBe(
      "data03 GPU 과열 시점 전후의 GPU 관련 로그를 분석해줘",
    );
  });
  it("node·mount 부재 시 자리표시자 잔재·이중 공백 없음", () => {
    const q = buildAlertQuestion("DiskUsageHigh");
    expect(q).not.toMatch(/\{node\}|\{mount\}|\s{2}/);
    expect(q).toContain("디스크 사용 급증");
  });
  it("미지 alertname → 일반형 폴백(깨지지 않음, 알림명 포함)", () => {
    const q = buildAlertQuestion("SomeFutureAlert", { node: "data05" });
    expect(q).toContain("SomeFutureAlert");
    expect(q).toContain("data05");
    expect(q).not.toMatch(/\{node\}|\{mount\}/);
  });
  it("노드 무관 알림(LogIngestStalled)은 node를 무시해도 성립", () => {
    expect(buildAlertQuestion("LogIngestStalled")).toContain("로그 파이프라인");
  });
});

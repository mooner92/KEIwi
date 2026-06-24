import { z } from "zod";

/**
 * 환경변수는 이 모듈을 통해서만 읽는다 (프롬프트 §3.2 — 컴포넌트/route는 process.env 직접 접근 금지).
 * 필수 키는 누락/형식 오류 시 어떤 키인지 명시하며 fail-fast로 throw한다.
 * (모든 키를 한 번에 강제하지 않고 기능별로 분리 — 일부 미설정이어도 다른 기능은 동작)
 */
const urlString = z
  .string()
  .min(1)
  .refine((v) => {
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  }, "유효한 URL이 아님");

/** INVENTORY_PATH — 비밀 아님, 기본값 있음(없어도 동작). cwd = apps/console 기준 상대경로. */
export function getInventoryPath(): string {
  return z
    .string()
    .min(1)
    .default("../../docs/inventory.yaml")
    .parse(process.env.INVENTORY_PATH);
}

/** PROMETHEUS_URL — 서버 전용. 누락/형식오류 시 fail-fast. */
export function getPrometheusUrl(): string {
  const r = urlString.safeParse(process.env.PROMETHEUS_URL);
  if (!r.success) {
    throw new Error(
      "[env] PROMETHEUS_URL 누락/잘못됨 — apps/console/.env.local에 설정하세요 (.env.example 참고).",
    );
  }
  return r.data;
}

export type GrafanaDashboard = { uid: string; label: string };

/**
 * GRAFANA — Overview 임베드용. 대시보드 개수 가변(추가 시 env만 수정):
 *   GRAFANA_DASHBOARD_UID = "uid|라벨" 쉼표 목록 (라벨 생략 시 "대시보드 N").
 *   예) "abc123|시스템,def456|GPU,ghi789|네트워크"
 * 누락/형식오류 시 어떤 키인지 명시하며 fail-fast.
 */
export function getGrafana(): { url: string; dashboards: GrafanaDashboard[] } {
  const url = urlString.safeParse(process.env.GRAFANA_URL);
  const dashboards: GrafanaDashboard[] = (process.env.GRAFANA_DASHBOARD_UID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const [uid, ...rest] = entry.split("|");
      const label = rest.join("|").trim();
      return { uid: uid.trim(), label: label || `대시보드 ${i + 1}` };
    })
    .filter((d) => d.uid.length > 0);

  const missing: string[] = [];
  if (!url.success) missing.push("GRAFANA_URL");
  if (dashboards.length === 0) missing.push("GRAFANA_DASHBOARD_UID");
  if (missing.length > 0) {
    throw new Error(
      `[env] ${missing.join(", ")} 누락/잘못됨 — apps/console/.env.local에 설정하세요 (.env.example 참고).`,
    );
  }
  return { url: url.data as string, dashboards };
}

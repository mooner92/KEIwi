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

/** 어시스턴트(M-assistant)용 server-only 게터. 미설정 시 해당 기능만 비활성(다른 기능 영향 없음). */
function requiredUrl(name: string, raw: string | undefined): string {
  const r = urlString.safeParse(raw);
  if (!r.success) {
    throw new Error(
      `[env] ${name} 누락/잘못됨 — apps/console/.env.local에 설정하세요 (.env.example 참고).`,
    );
  }
  return r.data;
}

/** OPENSEARCH_URL — 서버 전용. 로그 검색(읽기 전용). */
export function getOpenSearchUrl(): string {
  return requiredUrl("OPENSEARCH_URL", process.env.OPENSEARCH_URL);
}

/** VLLM_URL — 서버 전용. 로컬 vLLM(OpenAI 호환) 베이스 URL. */
export function getVllmUrl(): string {
  return requiredUrl("VLLM_URL", process.env.VLLM_URL);
}

/** VLLM_MODEL — vLLM이 보고하는 정확한 model id(전체 경로일 수 있음 — /v1/models 확인). */
export function getVllmModel(): string {
  const r = z.string().min(1).safeParse(process.env.VLLM_MODEL);
  if (!r.success) {
    throw new Error(
      "[env] VLLM_MODEL 누락 — /v1/models 의 정확한 id로 apps/console/.env.local에 설정하세요.",
    );
  }
  return r.data;
}

export type GrafanaDashboard = { uid: string; label: string };

/** "경로|라벨" 쉼표 목록 → 대시보드 배열. 경로 = '/d/' 뒤 부분(uid 또는 uid/slug). */
function parseDashboards(raw: string | undefined): GrafanaDashboard[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const [uid, ...rest] = entry.split("|");
      const label = rest.join("|").trim();
      return { uid: uid.trim(), label: label || `대시보드 ${i + 1}` };
    })
    .filter((d) => d.uid.length > 0);
}

/** GRAFANA_URL + 지정 UID env → {url, dashboards}. 누락/형식오류 시 fail-fast. */
function grafanaFrom(
  uidEnvName: string,
  uidRaw: string | undefined,
): { url: string; dashboards: GrafanaDashboard[] } {
  const url = urlString.safeParse(process.env.GRAFANA_URL);
  const dashboards = parseDashboards(uidRaw);
  const missing: string[] = [];
  if (!url.success) missing.push("GRAFANA_URL");
  if (dashboards.length === 0) missing.push(uidEnvName);
  if (missing.length > 0) {
    throw new Error(
      `[env] ${missing.join(", ")} 누락/잘못됨 — apps/console/.env.local에 설정하세요 (.env.example 참고).`,
    );
  }
  return { url: url.data as string, dashboards };
}

/**
 * GRAFANA — Overview(메트릭) 임베드용. 대시보드 개수 가변(추가 시 env만 수정):
 *   GRAFANA_DASHBOARD_UID = "경로|라벨" 쉼표 목록. ※ 슬러그까지 권장(없으면 kiosk 풀림).
 *   예) "abc123/system|시스템,def456/gpu|GPU"
 */
export function getGrafana(): { url: string; dashboards: GrafanaDashboard[] } {
  return grafanaFrom("GRAFANA_DASHBOARD_UID", process.env.GRAFANA_DASHBOARD_UID);
}

/** GRAFANA(로그) — /logs 임베드용. GRAFANA_LOGS_DASHBOARD_UID = "uid/slug|라벨"(M2 ELK 로그 대시보드). */
export function getGrafanaLogs(): { url: string; dashboards: GrafanaDashboard[] } {
  return grafanaFrom("GRAFANA_LOGS_DASHBOARD_UID", process.env.GRAFANA_LOGS_DASHBOARD_UID);
}

/**
 * GLITCHTIP_DSN — 에러 트래킹(specs/error-tracking, ADR-0022). 서버·클라이언트 init에서 사용.
 *
 * ⚠️ 다른 게터와 달리 **절대 throw하지 않는다**(undefined 반환). 에러 트래킹은 관측
 * 부가 기능이라, DSN 미설정/오타가 콘솔 부팅을 막으면 주객전도다 — 빈 시크릿 하나가
 * 서비스 전체를 내리는 실패는 이미 측정됐다(Grafana, 2026-07-30). 미설정이면 SDK가
 * 조용히 비활성화될 뿐 콘솔은 정상 동작해야 한다(AC-E-3).
 */
export function getGlitchTipDsn(): string | undefined {
  const r = urlString.safeParse(process.env.GLITCHTIP_DSN);
  return r.success ? r.data : undefined;
}

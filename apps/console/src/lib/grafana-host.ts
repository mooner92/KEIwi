/**
 * Grafana 임베드 베이스 URL 결정 (iframe 세션 쿠키 same-site 보장 — 로그인 루프 방지).
 *
 * 콘솔 접속 host가 GRAFANA_URL과 같은 사이트(등록 도메인)면 설정값 그대로,
 * 다른 사이트(내부 IP·localhost·사설 호스트명 접속)면 같은 호스트의 Grafana(:3000)를 임베드한다.
 *
 * 왜: 크로스 사이트 iframe에서는 브라우저가 Grafana 세션 쿠키(SameSite=Lax 기본)를
 * 서드파티로 취급해 저장/전송을 거부한다 → 로그인해도 쿠키가 안 남아 로그인 화면 무한 루프.
 * (증상: keiwi.excusa.uk 접속은 정상, 192.168.x.x:3105 접속은 임베드 로그인 루프 — 2026-07-02)
 */

/** 내부(LAN) 접속 시 임베드할 Grafana 포트 — data05 docker-proxy(:3000, known-endpoints와 동일). */
const LAN_GRAFANA_PORT = 3000;

/** Host 헤더("h", "h:port", "[v6]:port")에서 hostname만 소문자로. 없으면 "". */
export function hostnameOf(host: string | null | undefined): string {
  const raw = (host ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 0 ? raw.slice(1, end) : "";
  }
  return raw.split(":")[0] ?? "";
}

/**
 * 쿠키 관점의 "사이트" 근사값: IP·IPv6·localhost·단일 라벨은 그 자체,
 * 도메인은 마지막 두 라벨(registrable domain 근사 — excusa.uk 류에 충분).
 */
function siteOf(hostname: string): string {
  if (!hostname) return "";
  if (
    hostname === "localhost" ||
    /^[0-9.]+$/.test(hostname) || // IPv4
    hostname.includes(":") // IPv6 (브래킷 제거 후)
  ) {
    return hostname;
  }
  const labels = hostname.split(".").filter(Boolean);
  return labels.length <= 2 ? hostname : labels.slice(-2).join(".");
}

/**
 * 임베드 베이스 결정 (순수 — 테스트 대상).
 * @param configuredUrl GRAFANA_URL (예: https://grafana.excusa.uk)
 * @param requestHost   요청 Host 헤더 (예: keiwi.excusa.uk · 192.168.1.105:3105)
 */
export function resolveGrafanaBase(
  configuredUrl: string,
  requestHost: string | null | undefined,
): string {
  const reqHost = hostnameOf(requestHost);
  if (!reqHost) return configuredUrl;

  let confHost = "";
  try {
    confHost = new URL(configuredUrl).hostname.toLowerCase();
  } catch {
    return configuredUrl; // env 검증을 통과했으면 도달 안 함 — 방어적 폴백
  }

  if (siteOf(reqHost) === siteOf(confHost)) return configuredUrl;
  const h = reqHost.includes(":") ? `[${reqHost}]` : reqHost; // IPv6 재브래킷
  return `http://${h}:${LAN_GRAFANA_PORT}`;
}

import fs from "node:fs/promises";
import path from "node:path";
import { getCodeGraphHtml } from "@/config/env";

// graphify 산출물(graph.html)을 매 요청 읽는다 — 재생성하면 새로고침만으로 반영.
export const dynamic = "force-dynamic";

/**
 * graphify 인터랙티브 시각화 서빙 (읽기 전용).
 *
 * 왜 iframe+라우트인가: graph.html은 vis-network 기반의 자체완결 문서(1.3MB)라
 * 콘솔 번들에 넣을 물건이 아니다 — Grafana 임베드와 같은 "외부 화면 액자화" 패턴을 쓴다
 * (specs/design/04-patterns). 수제 SVG 재구현은 이미 한 번 실패했다(읽히지 않음 + 심볼
 * 병합으로 가짜 엣지) — 재구현 금지 원칙(§I-2)의 교훈 그대로다.
 *
 * ⚠️ 알려진 트레이드오프: graph.html은 vis-network를 unpkg CDN에서 로드한다(브라우저 측).
 * 반출되는 데이터는 없지만 오프라인 브라우저에서는 그래프가 안 뜬다 — 그 경우 화면의
 * 안내대로 로컬 vendoring을 검토한다(§8 ADR 사안이라 v1에서는 도입하지 않았다).
 */
export async function GET() {
  const p = path.resolve(getCodeGraphHtml());
  try {
    const html = await fs.readFile(p, "utf8");
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    // iframe 안에 뜨는 폴백 — 부모 페이지의 "미생성" 안내와 같은 정보를 최소로.
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="display:grid;place-items:center;height:100vh;margin:0;font-family:system-ui;color:#6e7583;background:transparent"><p>graph.html 미생성 — <code>npm run graph:extract</code> 후 새로고침</p>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

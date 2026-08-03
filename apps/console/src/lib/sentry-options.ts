import { scrubEvent } from "./sentry-scrub.ts";

/**
 * Sentry/GlitchTip 공통 init 옵션 (specs/error-tracking §5).
 *
 * 왜 별도 모듈인가: 페이로드 실측 프로브(scripts/sentry-payload-probe.mjs)가 **실제와
 * 똑같은 설정**으로 측정해야 의미가 있다. 옵션이 두 곳에 흩어지면 프로브는 통과하는데
 * 운영에서는 새는 상황이 생긴다. 한 곳에서 만들어 둘 다 쓴다.
 */

/**
 * 세션 추적을 끄는 이유 — 실측으로 발견한 구멍(E3-4).
 *
 * session envelope는 **`beforeSend`를 거치지 않는다.** 그래서 스크러버가 완벽해도
 * 아래가 그대로 나갔다(실측 페이로드. IP는 문서용 대역 RFC 5737로 치환 — 실제로 나간 값은
 * 플릿 노드의 사설 IP였다. 배포 위상을 공개 레포 소스에 남기지 않는다 — check:secrets S2):
 *   {"type":"session"} {"did":"u-1","attrs":{"ip_address":"192.0.2.101", ...}}
 * 우리는 릴리스 헬스(세션 기반 지표)를 쓰지 않으므로 끄는 것이 손실 없는 해법이다.
 *
 * ※ `Sentry.setUser()`도 호출하지 않는다 — 사용자 식별이 필요 없고, did의 출처다.
 */
const DROP_INTEGRATIONS = new Set(["ProcessSession", "BrowserSession"]);

export function baseSentryOptions(dsn: string | undefined) {
  return {
    dsn,
    // dsn이 없으면 SDK가 조용히 비활성화된다 — 콘솔 부팅에 영향 없어야 한다(AC-E-3).
    enabled: Boolean(dsn),
    beforeSend: scrubEvent,
    // PII 기본 수집 금지. 이것만으로는 부족해서 beforeSend가 2차 방어를 한다.
    sendDefaultPii: false,
    // 호스트명 대신 고정값 — 서버명이 정찰 정보가 되지 않게.
    serverName: "keiwi-console",
    // 성능 트레이싱 미사용(§5): 스팬은 URL·쿼리를 많이 실어 나른다.
    tracesSampleRate: 0,
    // 긴 문자열이 통째로 실리는 것을 막는다(로그 원문 유입 방지).
    maxValueLength: 500,
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    integrations: (defaults: { name: string }[]) =>
      defaults.filter((i) => !DROP_INTEGRATIONS.has(i.name)),
    // 노이즈 — 사용자 이탈·확장 프로그램에서 오는 무의미한 에러
    ignoreErrors: [
      "AbortError",
      "ResizeObserver loop",
      /^NetworkError/,
      /Failed to fetch/,
    ],
  };
}

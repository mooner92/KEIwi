import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * 에러 이벤트 반출 최소화 — 화이트리스트 재구성 (specs/error-tracking spec §5.4).
 *
 * ⚠️ 삭제 나열(`delete a; delete b; …`)로 짜지 않는다. SDK가 새 필드를 추가하면 그게
 * 그대로 새어 나간다. 대신 **남길 것만 골라 새 객체를 만든다** — 모르는 필드는 기본 소멸.
 *
 * 자체호스팅이라 망 밖으로는 안 나가지만, 무엇이 기록되는지는 여전히 중요하다:
 * 이 플릿의 exporter는 `user` 라벨로 **동료의 OS 계정명**을 노출하고, 로그 원문에는
 * 경로·토큰이 섞일 수 있다. 기준선은 "이 문자열이 Slack 알림에 실려도 괜찮은가"다.
 *
 * 순수 함수 — sentry-scrub.test.ts 대상.
 */

/** 태그 화이트리스트. 여기 없는 키는 버린다. */
const ALLOWED_TAGS = new Set(["route", "runtime"]);

/** breadcrumb 화이트리스트 — 네트워크 계열만, 페이로드(data)는 통째로 버린다. */
const ALLOWED_BREADCRUMB_CATEGORIES = new Set(["http", "fetch"]);

/** 사설 IP·호스트명을 마스킹한다. 플릿 토폴로지는 에러 원인과 무관하다. */
const PRIVATE_IP = /\b(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){1,3}\b/g;

export function maskHostInfo(text: string): string {
  return text.replace(PRIVATE_IP, "[ip]");
}

/** 스택 프레임에서 소스 본문·변수·절대경로를 제거하고 파일명만 상대화한다. */
function scrubFrame(frame: Record<string, unknown>): Record<string, unknown> {
  const filename = typeof frame.filename === "string" ? frame.filename : undefined;
  return {
    // 소스 코드 본문(pre_context·context_line·post_context)과 지역변수(vars)는
    // 디버깅에 유용하지만 시크릿이 실릴 수 있는 자리다 — 남기지 않는다.
    function: frame.function,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
    // abs_path(/home/mooner92/…)는 서버 레이아웃 정찰 정보 → 레포 상대경로만
    filename: filename ? filename.replace(/^.*?apps\/console\//, "apps/console/") : undefined,
  };
}

/**
 * 이벤트를 화이트리스트로 재조립한다. `null`을 반환하면 전송하지 않는다.
 * (Sentry SDK의 beforeSend 계약)
 */
export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  const e = event as unknown as Record<string, unknown>;

  // ── request: URL의 쿼리스트링·헤더·쿠키·body를 통째로 버리고 최소만 재조립 ──
  const req = e.request as Record<string, unknown> | undefined;
  if (req) {
    const url = typeof req.url === "string" ? req.url.split("?")[0] : undefined;
    e.request = { url: url ? maskHostInfo(url) : undefined, method: req.method };
  }

  // ── tags: 허용 키만 ──
  const tags = e.tags as Record<string, unknown> | undefined;
  if (tags) {
    e.tags = Object.fromEntries(
      Object.entries(tags).filter(([k]) => ALLOWED_TAGS.has(k)),
    );
  }

  // ── breadcrumbs: 네트워크 계열만, 페이로드 제거 ──
  const crumbs = e.breadcrumbs as { category?: string }[] | undefined;
  if (Array.isArray(crumbs)) {
    e.breadcrumbs = crumbs
      .filter((c) => c.category && ALLOWED_BREADCRUMB_CATEGORIES.has(c.category))
      .map((c) => ({ category: c.category, type: (c as { type?: string }).type, data: undefined }));
  }

  // ── contexts: runtime만. os·device는 커널 버전·RAM 용량 등 정찰 정보다 ──
  const contexts = e.contexts as Record<string, unknown> | undefined;
  if (contexts) e.contexts = contexts.runtime ? { runtime: contexts.runtime } : {};

  // ── 스택 프레임 ──
  const exception = e.exception as { values?: { stacktrace?: { frames?: unknown[] } }[] } | undefined;
  for (const v of exception?.values ?? []) {
    const frames = v.stacktrace?.frames;
    if (Array.isArray(frames)) {
      v.stacktrace!.frames = frames.map((f) => scrubFrame(f as Record<string, unknown>));
    }
  }

  // ── 메시지·예외 값의 사설 IP 마스킹 ──
  for (const v of exception?.values ?? []) {
    const vv = v as unknown as Record<string, unknown>;
    if (typeof vv.value === "string") vv.value = maskHostInfo(vv.value);
  }
  const msg = e.message;
  if (typeof msg === "string") e.message = maskHostInfo(msg);

  // ── 통째로 버리는 것 ──
  // modules: 설치된 패키지 전체 목록(공급망 정찰). user: 우리는 사용자 식별을 하지 않는다.
  // server_name: 호스트명 대신 고정 문자열을 init에서 넣는다.
  delete e.modules;
  delete e.user;

  return event;
}

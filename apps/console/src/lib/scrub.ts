/**
 * 시크릿 스크럽 (프롬프트 조립 '전' — 로컬 vLLM이라도 프롬프트 로깅/캐싱 잔존 방지, §13).
 * structured(key=value)와 Bearer 토큰을 마스킹. ADR-0010 argv 토큰 경고와 동일 자세.
 *
 * 왜 별도 모듈인가: 로그 근거(assistant.ts)와 문서 근거(rag.ts)가 **둘 다** 이 함수를
 * 쓴다. assistant.ts에 두면 assistant ↔ rag 순환 import가 생긴다 — ESM에서 동작은
 * 하지만 초기화 순서에 의존하는 함정을 남긴다. 스크럽은 어느 쪽에도 속하지 않는
 * 공통 규약이므로 여기에 둔다. (`@/lib/assistant`에서 재수출 — 기존 import 유지)
 */
export function scrubSecrets(s: string): string {
  return (
    s
      // 'Bearer <token>' 먼저(실제 토큰이 \S+ 단일토큰 마스킹에 안 새도록)
      .replace(/\b(bearer)\s+([A-Za-z0-9._\-]{6,})/gi, "$1 ***")
      // key=value / token: value (structured)
      .replace(
        /\b(token|api[-_]?key|secret|password|passwd|authorization|auth)\b(\s*[=:]\s*)(\S+)/gi,
        "$1$2***",
      )
  );
}

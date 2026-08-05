import { access } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { getRagUrl } from "@/config/env";
import { scrubSecrets } from "@/lib/scrub";

/**
 * 문서 RAG 접근 계층 (서버 전용 — 'use client' 금지).
 *
 * ────────────────────────────────────────────────────────────────────────
 * 이것은 BM25 로그 검색의 **대체가 아니라 보강**이다.
 * ────────────────────────────────────────────────────────────────────────
 * 어시스턴트는 "이 에러가 왜 났나"를 **로그**에서 찾는다(OpenSearch BM25).
 * 이 모듈은 "매뉴얼이 뭐라 하나"를 **문서**에서 찾는다(LightRAG 지식그래프).
 * 둘은 답할 수 있는 질문이 다르므로 근거도 섞지 않는다 — 로그 근거는 `[n]`,
 * 문서 근거는 `[D n]`으로 번호 공간을 분리한다(assistant.ts).
 *
 * **실패 격리가 이 모듈의 첫 번째 계약이다.** 어떤 실패에서도 throw하지 않고
 * `{docs: [], status: "error"}`를 돌려준다. RAG 서비스가 죽어 있어도
 * 어시스턴트는 기존 BM25 경로로 정상 응답해야 한다.
 *
 * 파일 경로 검증(날조·경로탈출 차단)이 두 번째 계약이다. LightRAG가 돌려주는
 * `file_path`는 색인 시각의 문자열일 뿐이다 — 색인 이후 지워진 문서, 병합
 * 부작용으로 엉뚱해진 경로, 최악에는 조작된 값일 수 있다. **레포에 실제
 * 존재하는 화이트리스트 경로만** 근거 번호를 받는다. 로그 근거와 같은
 * "서버가 검증한 것만 렌더한다" 규약이다(ADR-0014).
 */

/** 서버가 검증한 문서 근거 1건(UI가 이것을 렌더 — 날조 차단). */
export type DocRef = {
  /** 레포 상대 경로. **실존이 확인된 값만** 여기에 온다. */
  path: string;
  /** 청크 발췌(스크럽·상한 적용). */
  excerpt: string;
};

export type RagStatus = "ok" | "skipped" | "error";

export type RagResult = {
  docs: DocRef[];
  /** ok=검색 성공(0건 포함) · skipped=RAG_URL 미설정 · error=거부/타임아웃/장애 */
  status: RagStatus;
};

/** 프롬프트에 실을 문서 근거 상한. 4건 × 900자 ≈ 3~4K 토큰. */
const MAX_DOCS = 4;
const EXCERPT_CHARS = 900;
/**
 * 같은 파일에서 가져올 청크 상한. 실측에서 한 질문에 gpu-xid.md 청크가 3건
 * 연속으로 올라왔다 — `[D1][D2][D3]`이 전부 같은 문서면 근거 목록이 출처
 * 다양성을 잃는다. 2건까지만 허용해 다른 문서에 자리를 남긴다.
 */
const MAX_PER_FILE = 2;
/**
 * 하드캡. BM25와 **병렬**로 돌리므로 순증은 `max(0, rag - bm25)`다.
 *
 * 4000ms로 잡았다가 라이브 실측에서 올렸다(2026-08-04). 명시 키워드가 없으면
 * LightRAG가 키워드추출 LLM을 한 번 부르는데, 그 상대가 **공유 연구 GPU**라
 * 지연이 우리 통제 밖이다. 실측 콜드 0.28~0.82s(신규 한국어 질문 3건)인데도
 * 콘솔 첫 호출 1건이 3.5s를 넘겨 504로 떨어졌다 — 답변은 로그 근거 40건으로
 * 정상이었지만(실패 격리 작동) 런북 근거를 통째로 잃었다.
 * 6s면 통상값의 7배 여유이고, 넘어가면 그때는 문서 근거를 포기하는 게 맞다.
 * (서비스 쪽은 5.5s로 더 짧게 — 서버가 먼저 끊어야 코루틴이 정리된다.)
 */
const TIMEOUT_MS = 6000;
const SERVICE_TIMEOUT_SEC = 5.5;

/** 레포 루트 (cwd = apps/console — runbooks.ts와 같은 규약). */
const REPO_ROOT = resolve(process.cwd(), "../..");

/**
 * 근거로 승격할 수 있는 경로 접두. 코퍼스(`ingest.py` CORPUS_GLOBS)와 같은 범위다.
 * `.env`·`apps/`·`infra/**\/*.py` 같은 것은 애초에 색인 대상이 아니지만,
 * 화이트리스트를 **여기서 다시** 좁히는 이유는 색인 범위가 넓어지는 변경이
 * 콘솔의 반출 범위를 조용히 넓히지 못하게 하기 위함이다.
 */
const ALLOWED_PREFIXES = ["docs/", "specs/", "infra/"] as const;
const ALLOWED_EXACT = ["README.md"] as const;

/**
 * LightRAG `file_path` → 레포 상대 경로 (순수 — fs 접근 없음).
 *
 * `ingest.py`가 `docs/runbooks/gpu-xid.md`를 `docs__runbooks__gpu-xid.md`로
 * 평탄화해 넣었다(LightRAG 1.5.5가 file_path를 basename으로 정규화해 중복
 * 판정하는 것에 대한 회피). 여기서 역매핑한다.
 *
 * 거부 조건 — 하나라도 걸리면 `null`(근거 번호를 받지 못한다):
 *   · 평탄화된 값에는 `/`가 있을 수 없다 → 있으면 색인 계약 위반이거나 조작
 *   · `..` 경로 탈출 · 절대경로 · NUL · 백슬래시
 *   · 화이트리스트 밖 접두 · `.md` 아님
 *   · 역매핑 결과가 레포 루트 밖(정규화 후 prefix 단언)
 */
export function mapDocPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw.trim();
  if (!flat || flat === "unknown_source") return null;
  // 평탄화 규약상 구분자는 없어야 한다. 있으면 우리가 넣은 값이 아니다.
  if (flat.includes("/") || flat.includes("\\") || flat.includes("\0")) return null;
  if (flat.includes("..")) return null;

  const rel = flat.split("__").join("/");
  // 역매핑 후에도 한 번 더 — `.__.`처럼 꼬아 만든 값이 여기서 걸린다.
  if (rel.startsWith("/") || rel.split("/").includes("..") || rel.includes("//")) {
    return null;
  }
  if (!rel.endsWith(".md")) return null;

  const allowed =
    ALLOWED_EXACT.some((e) => rel === e) ||
    ALLOWED_PREFIXES.some((p) => rel.startsWith(p));
  if (!allowed) return null;

  // 최종 방어: 실제 경로 해석 결과가 레포 루트 안인가.
  const abs = resolve(REPO_ROOT, rel);
  if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + sep)) return null;
  return rel;
}

type ServiceChunk = { file_path?: unknown; content?: unknown };

/** 발췌 정리 — 스크럽 → 공백 정규화 → 상한. */
function toExcerpt(content: string): string {
  return scrubSecrets(content).replace(/\s*\n\s*/g, "\n").trim().slice(0, EXCERPT_CHARS);
}

/**
 * 서비스 응답의 청크 배열 → 검증된 DocRef[] (실존 확인 포함).
 * 실존 확인에 실패한 경로는 **조용히 버린다** — 색인이 레포보다 낡은 것은
 * 흔한 상태이고, 그것 때문에 어시스턴트가 실패할 이유는 없다.
 */
async function toDocRefs(chunks: unknown): Promise<DocRef[]> {
  if (!Array.isArray(chunks)) return [];
  const out: DocRef[] = [];
  const perFile = new Map<string, number>();
  for (const c of chunks as ServiceChunk[]) {
    if (out.length >= MAX_DOCS) break;
    if (!c || typeof c !== "object") continue;
    const path = mapDocPath(c.file_path);
    if (!path) continue;
    if ((perFile.get(path) ?? 0) >= MAX_PER_FILE) continue;
    if (typeof c.content !== "string") continue;
    const excerpt = toExcerpt(c.content);
    if (!excerpt) continue;
    try {
      await access(resolve(REPO_ROOT, path));
    } catch {
      continue; // 레포에 없는 파일은 근거가 될 수 없다
    }
    perFile.set(path, (perFile.get(path) ?? 0) + 1);
    out.push({ path, excerpt });
  }
  return out;
}

export type RetrieveDocsOpts = {
  /** 자연어 질의(한국어). */
  query: string;
  /**
   * 명시 키워드. 넘기면 LightRAG가 자체 키워드추출 LLM 호출을 생략한다
   * (실측 hybrid 3.14s → 1.93s). 탐색형에서는 이미 계획기가 뽑아둔
   * `plan.keywords`를 재사용하므로 GPU 호출이 늘지 않는다.
   */
  keywords?: string[];
};

/**
 * 문서 근거 검색. **절대 throw하지 않는다** — 실패는 전부 `status:"error"`로 귀결.
 * `RAG_URL` 미설정이면 fetch 자체를 하지 않는다(`skipped`) — 부팅·기존 배포 무영향.
 */
export async function retrieveDocs(opts: RetrieveDocsOpts): Promise<RagResult> {
  const base = getRagUrl();
  if (!base) return { docs: [], status: "skipped" };
  const query = opts.query.trim();
  if (!query) return { docs: [], status: "skipped" };

  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query.slice(0, 2000),
        mode: "hybrid",
        chunk_top_k: 8, // 파일당 상한·실존 검증에서 탈락할 몫을 미리 확보
        // 넘기면 LightRAG 자체 키워드추출(LLM 1회)을 생략한다. 한국어 질문은
        // 계획기가 영문 토큰만 뽑아 비는 경우가 많고, 그때는 저쪽이 추출한다.
        ll_keywords: (opts.keywords ?? []).slice(0, 12),
        timeout_sec: SERVICE_TIMEOUT_SEC,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { docs: [], status: "error" };
    const json: { status?: unknown; chunks?: unknown } = await res.json();
    if (json.status !== "ok") return { docs: [], status: "error" };
    return { docs: await toDocRefs(json.chunks), status: "ok" };
  } catch {
    // 타임아웃(AbortError)·연결 거부·JSON 파싱 실패 — 전부 같은 결말이다.
    return { docs: [], status: "error" };
  }
}

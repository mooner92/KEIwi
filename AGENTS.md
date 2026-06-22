# KEIwi — 에이전트 가이드 (목차)

> 이 파일은 **백과사전이 아니라 지도**다. 상세를 인라인하지 않고 권위 있는 소스를 가리킨다. (헌장 §10)
> 모든 작업 세션은 아래 순서로 컨텍스트를 읽고 시작한다. (헌장 §VI)

## 0. 가장 먼저 읽을 것 (권위 순서)

1. **[`Constitution.md`](./Constitution.md)** — 프로젝트 헌장. **불변 규칙이며 모든 문서·코드에 우선**한다. 충돌 시 헌장이 이긴다.
2. **[`docs/inventory.yaml`](./docs/inventory.yaml)** — 플릿 단일 기준(source of truth). 노드 추가·변경은 이 파일 수정으로 시작.
3. 작업 중인 마일스톤의 **spec** — 예: [`specs/M1-console/spec.md`](./specs/M1-console/spec.md)

## 1. 디렉터리 지도

| 경로 | 내용 |
|---|---|
| `Constitution.md` | 헌장 (권위) |
| `AGENTS.md` | 이 목차 |
| `README.md` | 레포 개요 |
| `docs/inventory.yaml` | 플릿 인벤토리 (source of truth) |
| `docs/decisions/` | ADR (`NNNN-*.md`) — 모든 의존성·기술 선택 근거 |
| `docs/prompts/` | 마일스톤별 빌드 프롬프트 |
| `specs/<milestone>/spec.md` | 마일스톤 스펙 (WHAT + WHY) |
| `infra/` | 관제 스택(Prometheus/Grafana/ELK 등) — **범위 밖, 함부로 생성·수정 금지** |
| `apps/console/` | KEIwi 콘솔 (Next.js) — M1 deliverable |

## 2. 워크플로 (SDD)

```
헌장 → /specify (WHAT+WHY) → /plan (HOW + ADR) → /tasks → /verify
```

- **Spec이 진실의 원천.** 행동 변경은 코드가 아니라 spec을 먼저 고친다. (헌장 §7)
- 모든 의존성·기술 선택은 **ADR**로 근거를 남긴다. (헌장 §8)
- 수용 기준은 **기계 검증 가능**해야 한다. (헌장 §9)

## 3. 콘솔 실행법 (`apps/console`)

> 콘솔 관련 모든 명령은 `apps/console`에서 실행한다. dev 포트는 **3105**(라이브 스택과 분리).

```bash
cd apps/console
npm install
cp .env.example .env.local   # 값은 직접 채움 (커밋 금지)
npm run dev        # http://localhost:3105
npm run verify     # lint + typecheck + build + check:secrets
```

- 환경변수는 `src/config/env.ts`에서 zod로 검증해 한 곳에서만 읽는다.
- `.env.local`·시크릿은 **절대 커밋하지 않는다.** (헌장 §13)

## 4. 마일스톤

- **M1** 통합 메트릭 콘솔 ← *현재 작업* ([spec](./specs/M1-console/spec.md))
- **M2** 통합 로그 · **M3** 여유 리소스 뷰 · **M4** 장애 추적 · **M5** 크리티컬 알림

## 5. 안전 규칙 (요약 — 상세는 헌장)

- 에이전트는 생성, **적용(프로덕션 배포)은 사람**. (§11)
- 개발 격리: 라이브 `.105` 스택 방해 금지. (§12)
- 단일 콘솔 = Grafana. **Grafana 재구현 금지.** (§I-2)

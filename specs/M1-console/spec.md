# M1 콘솔 — Spec

- 상태: 제안 (게이트 검토 대기)
- 날짜: 2026-06-22
- 권위: 이 spec은 [`Constitution.md`](../../Constitution.md)에 종속된다. 충돌 시 헌장이 이긴다.
- 빌드 프롬프트: [`docs/prompts/M1-console.md`](../../docs/prompts/M1-console.md)
- 원칙: **Spec이 진실의 원천**이다(헌장 §7). 행동을 바꾸려면 코드가 아니라 이 문서를 먼저 고친다.
- 표기: 헌장 인용은 **전역 원칙 번호(1~17)**를 쓴다(예: 단일 콘솔=Grafana는 §2).

---

## 목적

M1은 KEIwi의 **첫 deliverable**로, 운영자가 단일 화면에서 KEI 연구 서버 플릿(5노드)의 상태를 **한눈에 인지**하고, 상세 메트릭은 Grafana로 바로 이어 보게 하는 **모니터링 콘솔**이다.

- **WHY — 단일 콘솔 = Grafana (헌장 §2).** 메트릭/로그/알림/장애는 전부 Grafana로 surface한다. KEIwi 콘솔(Next.js)은 그것을 **재구현하지 않고**, 브랜드 front door로서 (a) Grafana를 임베드하고 (b) Grafana로 표현하기 어려운 **플릿 한눈 상태(노드 헬스)** 같은 커스텀 뷰만 네이티브로 제공한다.
- **WHY — 운영자 인지.** 운영자의 첫 질문은 "지금 어느 서버가 살아있고, 어디에 주의가 필요한가?"이다. M1은 이 질문에 즉답하는 것을 목표로 한다.
- **WHY — 안전한 진입점.** 콘솔은 라이브 관제 스택을 **읽기만** 하고(질의·임베드), 별도 포트(3105)로 격리되어 `.105` 라이브 스택을 방해하지 않는다(헌장 §12).

M1의 성공은 §수용 기준의 기계 검증으로 정의한다(헌장 §9).

---

## 범위 (in / out)

### In (이번에 만든다)

1. **콘솔 앱** — Next.js(App Router, TypeScript). dev 포트 **3105**는 dev 스크립트(`next dev -p 3105`)에 고정해 격리를 보장한다(헌장 §12). `.env.example`의 `PORT=3105`는 이를 문서화한다.
2. **앱 셸 & 네비** — 상단 바(KEIwi 브랜드 마크 + 제품명) + 네비(**Overview / Logs / Resources / Incidents**). Overview만 활성.
3. **루트 리다이렉트** — `/` → `/overview`.
4. **Overview 페이지** — 상단에 플릿 상태 strip, 그 아래 Grafana 대시보드 임베드(`<iframe>`).
5. **플릿 상태 strip** — 각 inventory 노드를 카드로 표시, 상태를 시맨틱 토큰 색으로 표현. `no-data`는 neutral.
6. **플릿 상태 API** — `GET /api/fleet/status`: Prometheus `up`을 inventory와 매칭해 `[{ id, ip, os, role, status }]` 반환(서버 전용 질의).
7. **placeholder 페이지** — `logs`/`resources`/`incidents`: "Mx에서 추가됩니다" 안내(운영자 시점 카피).
8. **디자인 토큰** — 브랜드 램프(50~900)와 **시맨틱 상태 토큰(success/info/warning/danger/neutral·no-data)** 분리(헌장 §17). 타이포는 **display/body type scale + IP·메트릭 수치용 monospace 토큰**을 둔다(프롬프트 §5). CSS 변수 단일 소스 → Tailwind theme가 참조.
9. **품질 바닥** — 모바일까지 반응형, 키보드 포커스 가시, `prefers-reduced-motion` 존중.
10. **시크릿/환경설정 규율** — `config/env.ts`의 zod 검증(fail-fast). 검증 대상 env 키: `GRAFANA_URL`, `GRAFANA_DASHBOARD_UID`, `PROMETHEUS_URL`, `INVENTORY_PATH`, `PORT`. `.env.example`(값 비움) 커밋, `check-no-secrets.sh`.

### Out (이번에 안 한다 — 상세는 §비범위)

- `infra/` 관제 스택 생성/수정 · M2~M5 기능 · Grafana 대시보드 재구현 · 자체 인증.

---

## 사용자 스토리

운영자(admin) 관점. 각 스토리는 §수용 기준 또는 §보강 검증으로 추적된다.

- **US1 — 한눈 헬스.** 운영자로서 콘솔에 들어오면 5개 노드 각각의 **살아있음 / 죽음 / 데이터 없음**을 즉시 구분해 보고 싶다. 그래야 어디에 주의가 필요한지 바로 안다.
- **US2 — 끊김 없는 심층 보기.** 운영자로서 Overview에서 시스템·GPU 메트릭(Grafana 대시보드)을 **콘솔을 떠나지 않고** 보고 싶다.
- **US3 — 정직한 미완성.** 운영자로서 아직 없는 기능(로그/리소스/장애)이 **"예정"임을 명확히** 알고 싶다. 깨진 링크나 빈 화면으로 혼란을 주지 않아야 한다. (→ §보강 검증)
- **US4 — 오탐 없는 상태.** 운영자로서 아직 메트릭을 보내지 않는(혹은 수집 대상이 아닌) 노드를 **`down`(장애)으로 오인하지 않고 `no-data`로 구분**해 보고 싶다. 데이터 부재 ≠ 장애.
- **US5 — 어디서나 읽힘.** 운영자로서 모바일/노트북 어디서든 읽히고 키보드로 탐색 가능하길 원한다.

---

## 데이터 소스 (Grafana / Prometheus / inventory)

세 소스 모두 **읽기 전용**. 콘솔은 어떤 소스에도 쓰지 않는다.

| 소스 | 용도 | 노출 경계 | 비고 |
|---|---|---|---|
| **Grafana** | Overview 대시보드 임베드 | `GRAFANA_URL`은 iframe src로 **클라이언트에 노출**(내부망·Cloudflare Access 뒤라 허용) | 값은 `.env.local`의 `GRAFANA_URL`(사내 ZT 도메인), 대시보드는 `GRAFANA_DASHBOARD_UID` |
| **Prometheus** | 플릿 상태 질의 | `PROMETHEUS_URL`은 **서버 전용**(클라이언트 번들·HTML에 절대 비노출) | `GET {PROMETHEUS_URL}/api/v1/query?query=up`, route handler/RSC에서만 |
| **inventory** | 노드 단일 기준 | 서버 전용 파일 로드(`INVENTORY_PATH`) | [`docs/inventory.yaml`](../../docs/inventory.yaml). 노드 추가/변경의 단일 진입점(헌장 §0) |

> 실 운영 URL·UID는 `.env.local`에서만 주입한다. spec·레포에 실값을 박지 않는다(헌장 §13, 프롬프트 §10).

### 상태 판정 규칙 (US4의 핵심)

**status enum (M1 고정):** 노드 status ∈ `{ up, down, no-data }` — 3종만 쓴다. ("주의/warning" 같은 4번째 상태는 M1에서 도입하지 않는다.)

**매칭:** OS 무관하게 inventory의 `exporters` 엔드포인트(`ip:port`)를 `up{instance}` 라벨과 대조한다(node·windows·dcgm 동일 규칙, 헌장 §5 이기종 1급 지원).

**집계 (한 노드가 복수 exporter를 가질 때 — 예: data05 = node + dcgm):** 그 노드에 매칭되는 `up` series만 모아 판정한다.

| 조건 | 노드 status |
|---|---|
| 매칭되는 series가 **하나도 없음** | `no-data` (← **절대 `down` 아님**) |
| 매칭 series 중 **하나라도 값 = 0** | `down` |
| 매칭 series가 **모두 값 = 1** | `up` |

**가정 & 안전 불변식:**
- 매칭은 inventory `exporters` 값(`ip:port`)과 `up{instance}` 문자열의 정확 일치를 전제하며, Prometheus scrape 타겟이 동일 `ip:port`로 설정되어 있어야 한다. inventory 포트는 현재 "확인 필요" 상태다([`inventory.yaml`](../../docs/inventory.yaml) 헤더).
- **매칭 실패(포트/표기 불일치 등) 시 해당 노드는 항상 `no-data`로 안전 귀결되며, 절대 `down`으로 표기하지 않는다**(US4). 정확한 매칭/정규화 알고리즘은 ADR/plan(3단계)으로 위임하되, 이 no-data 안전 불변식은 spec이 보증한다.

**status → 시맨틱 토큰 매핑(헌장 §17):** `up → success` · `down → danger` · `no-data → neutral`. (`info`/`warning` 토큰은 M1 노드 status에 미사용 — 향후 세분류용 보류.)

---

## 수용 기준 (기계 검증 가능 — §8 그대로)

> 아래 11항목은 프롬프트 §8을 **글자 그대로** 옮긴 것이다(변경 금지). 각 항목의 구체적 검증 절차는 **§검증 방법**, §8이 직접 다루지 않는 추가 불변식은 **§보강 검증**을 참조.

- [ ] `npm run build` 성공 / `npm run lint` 무경고 / `npm run typecheck`(`tsc --noEmit`) 에러 0
- [ ] `npm run dev`가 포트 **3105**에서 기동
- [ ] `/`가 `/overview`로 리다이렉트
- [ ] `/overview`가 `GRAFANA_URL` 대시보드를 `<iframe>`으로 렌더 (iframe src가 env URL로 시작)
- [ ] `GET /api/fleet/status` → 200 + `[{ id, ip, os, role, status }]` JSON (Prometheus `up` 기반)
- [ ] 플릿 strip이 각 inventory 노드를 시맨틱 상태색으로 표시, **데이터 없는 노드는 no-data**(down 아님)
- [ ] 코드에 하드코딩 URL/시크릿 없음 — `npm run check:secrets` 통과
- [ ] 상태색이 시맨틱 토큰에서만 옴 (컴포넌트에 raw 상태 hex 없음)
- [ ] 반응형(모바일까지) / 키보드 포커스 가시 / reduced-motion 존중
- [ ] 파일이 §2 구조와 정확히 일치
- [ ] `specs/M1-console/spec.md`, `docs/inventory.yaml`, `AGENTS.md`, `docs/decisions/` ADR 존재

---

## 검증 방법 (각 §8 기준의 기계 검증 절차)

5단계에서 아래 절차로 §8 각 항목을 pass/fail 판정한다.

| §8 기준 | 검증 절차 (관측 신호) |
|---|---|
| build/lint/typecheck | `npm run build` exit 0 · `npm run lint` 경고 0 · `tsc --noEmit` 에러 0 |
| dev 포트 3105 기동 | package.json `dev` 스크립트에 `-p 3105` 포함(grep) **그리고** 기동 후 `curl -sI http://localhost:3105/`가 200 또는 `/overview`로의 3xx 반환 |
| `/` → `/overview` | `curl -sI http://localhost:3105/` → `3xx` + `Location: /overview` |
| Grafana iframe | `/overview` HTML에 `<iframe>` 존재 + `src`가 `GRAFANA_URL` 값으로 시작 |
| `GET /api/fleet/status` | `curl -s …/api/fleet/status` → 200, JSON 배열, 각 원소 키 `{id,ip,os,role,status}`, **`status ∈ {up,down,no-data}`** |
| no-data ≠ down | `lib/status.ts` 단위 테스트: inventory N노드 + `up` 결과에서 일부 instance 누락 입력 시 해당 노드 `status === "no-data"`(≠ down) 단언 |
| check:secrets | `npm run check:secrets` exit 0 |
| 상태색=시맨틱 토큰만 | `grep -rnP '#[0-9a-fA-F]{3,6}' src/components/` → 0건 (상태 raw hex 부재). `check-no-secrets.sh`는 URL만 검사하므로 이 hex 검사는 별도 |
| 반응형/포커스/reduced-motion | `globals.css`에 `@media (prefers-reduced-motion: reduce)` 블록 존재(grep) · `:focus-visible` 스타일 존재(grep) · 375px 뷰포트에서 가로 스크롤 없음(수동 또는 Playwright). 자동화 곤란분은 수동 체크로 분리 표기 |
| 파일 §2 구조 일치 | **프롬프트 §2.2 파일 트리**의 각 경로 존재(`test -f`/`ls`). 누락 0(잉여 파일은 허용) |
| 아티팩트 존재 | `spec.md`·`inventory.yaml`·`AGENTS.md`·`docs/decisions/*.md` 존재(`test -f`) |

---

## 보강 검증 (§8 외 추가 — spec이 보증하는 불변식)

§8이 직접 다루지 않으나 헌장·프롬프트 §1/§3/§4가 요구하므로 추가로 검증한다.

- [ ] **(US3) placeholder 라우트** — `/logs`·`/resources`·`/incidents`가 각각 200 + `placeholder-panel`("Mx에서 추가됩니다" 류 카피) 렌더. 내비는 Overview만 활성·나머지 "예정" 표시. 깨진 링크/404 없음.
- [ ] **(헌장 §13 / 프롬프트 §3.2) `PROMETHEUS_URL` 비노출** — 프로덕션 빌드 산출물(`.next/static`)과 페이지 HTML에 `PROMETHEUS_URL` 값/문자열 0건(grep).
- [ ] **(집계 규칙) 복수/이기종 exporter** — data05(node+dcgm)·data02(windows)도 단일 노드 상태로 집계되어 strip에 카드 1개로 표시.

---

## 비범위

명시적으로 이번 M1에서 다루지 않는다. (각 항목 옆은 근거)

- **infra 관제 스택 생성/수정** — Prometheus/Grafana/ELK compose 등. 헌장 §2(Grafana 재구현 금지), §11(사람이 적용), §12(개발 격리).
- **M2~M5 기능** — 로그(M2)/리소스(M3)/장애(M4)/알림(M5)은 placeholder 페이지만. 기능 구현은 각 마일스톤에서.
- **Grafana 대시보드 재구현** — 콘솔은 임베드만. 패널/쿼리를 Next.js로 다시 그리지 않는다.
- **자체 인증/로그인** — 헌장 §14. 인증은 Cloudflare Access(Zero Trust)가 담당.
- **메트릭 수집/exporter 설치·배포** — node/windows/DCGM exporter 설치, Prometheus 스크랩 설정 등은 사람이 적용(헌장 §11). 콘솔은 질의만.
- **라이브 스택 포트/볼륨 점유** — dev는 3105 등 별도 포트·별도 compose로 격리(헌장 §12). prod 포트/볼륨 바인딩 금지.
- **콘솔 → 소스 쓰기** — Prometheus/Grafana/inventory 어디에도 쓰지 않는다(읽기 전용).

---

## 의존 결정 (ADR 링크)

3단계(plan)에서 아래 ADR을 작성한다(헌장 §8 — 모든 의존성·기술 선택은 ADR). spec은 이 결정들에 종속됨을 선언한다.

| ADR | 결정 대상 | 기본 방향(프롬프트 §7) | 파일(예정) |
|---|---|---|---|
| 0001 | 프레임워크 & 스타일링 | Next.js(App Router) + Tailwind + CSS 변수 토큰 | `docs/decisions/0001-framework-and-styling.md` |
| 0002 | Grafana 임베드 방식 | `GRAFANA_URL`+`UID`로 iframe URL 구성 | `docs/decisions/0002-grafana-embed.md` |
| 0003 | inventory YAML 파싱 라이브러리 | 지루한 기술 선호(헌장 §6) | `docs/decisions/0003-inventory-yaml-parser.md` |

> 위 파일은 아직 존재하지 않으며 3단계 게이트에서 작성·승인된다. 의존성 추가는 ADR 없이 하지 않는다.

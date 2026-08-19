# KEIwi M1 — 모니터링 콘솔 (Next.js) 구축 프롬프트

> **사용법:** 이 파일 전체를 `.105`의 Claude Code 세션에 입력한다.
> 프로젝트 루트의 `constitution.md`가 최종 권위이며, 이 프롬프트와 충돌하면 헌장이 이긴다.
> 저장 위치: `docs/prompts/M1-console.md`

---

## 0. 역할 & 최우선 규칙

너는 KEIwi 프로젝트에서 작업하는 시니어 엔지니어다.

1. **작업 시작 전 루트 `constitution.md`를 먼저 읽고** 모든 결정에 적용한다.
2. **위반 금지(헌장 발췌):** 단일 콘솔=Grafana(대시보드 재구현 금지) · 브랜드/시맨틱 토큰 분리 · 개발 격리(.105 라이브 스택 보호) · 시크릿 레포 밖 · 의존성은 ADR · 수용 기준 기계 검증 가능 · 문서는 목차.
3. **모든 산출물은 §2에서 지정한 정확한 경로**에 둔다. 임의 위치에 파일을 만들지 않는다.
4. **게이트(§7)에서 반드시 멈추고** 승인을 받은 뒤 다음 단계로 간다.
5. 확신이 안 서면 추측하지 말고 멈춰서 질문한다.

---

## 1. 작업 범위

**이번 작업:** KEIwi 콘솔의 첫 deliverable인 **M1 모니터링 콘솔**을 Next.js(App Router, TypeScript)로 만든다. 콘솔은 브랜드 front door로서 **Grafana 대시보드를 임베드**하고, **플릿 상태 strip** 같은 커스텀 뷰만 네이티브로 만든다.

**범위 밖(건드리지 말 것):**
- `infra/`의 관제 스택(Prometheus/Grafana/ELK compose 등) — 이번엔 생성·수정하지 않는다.
- M2(로그)/M3(리소스)/M4(장애)/M5(알림) 기능 — placeholder 페이지만 만든다.
- Grafana 대시보드 자체의 재구현.

---

## 2. 리포지터리 파일 관리 (정확히 이 구조로)

### 2.1 레포 루트 구조

```
keiwi/
├─ constitution.md          # 권위 (이미 존재 — 읽기만)
├─ AGENTS.md                # 목차/맵 — 네가 생성
├─ README.md                # 레포 개요 + 구조 안내 — 네가 생성
├─ .gitignore               # 네가 생성/갱신
├─ docs/
│  ├─ inventory.yaml        # 플릿 단일 기준 — constitution §0에서 생성
│  ├─ decisions/            # ADR (NNNN-*.md)
│  │  └─ .gitkeep
│  └─ prompts/
│     └─ M1-console.md      # 이 파일
├─ specs/
│  └─ M1-console/
│     └─ spec.md            # M1 콘솔 스펙 — 네가 생성
├─ infra/                   # 관제 스택 (범위 밖, 생성/수정 금지)
│  └─ .gitkeep
└─ apps/
   └─ console/              # ← 이번 작업 전체가 이 안에서
```

- 콘솔 관련 모든 `npm` 명령은 **`apps/console`에서** 실행한다.
- 미래의 워커 서비스 등은 `apps/` 아래 형제 디렉터리로 들어갈 자리다(이번엔 안 만듦). monorepo 툴링(turborepo 등)은 도입하지 않는다 — 단순 디렉터리 분리.

### 2.2 콘솔 앱 내부 구조 (`apps/console`)

```
apps/console/
├─ package.json
├─ next.config.ts
├─ tsconfig.json
├─ tailwind.config.ts
├─ postcss.config.mjs
├─ eslint.config.mjs
├─ .env.example            # 키 목록(값 비움) — 커밋함
├─ .env.local             # 실제 값 — 사용자가 채움, 절대 생성/커밋 금지
├─ .gitignore             # create-next-app 것에 .env* 보강
├─ scripts/
│  └─ check-no-secrets.sh
└─ src/
   ├─ app/
   │  ├─ layout.tsx        # 루트 레이아웃: 폰트, AppShell, <html lang="ko">
   │  ├─ globals.css       # 디자인 토큰(CSS 변수) + 베이스 스타일
   │  ├─ page.tsx          # '/' → /overview 리다이렉트
   │  ├─ overview/
   │  │  └─ page.tsx       # 플릿 strip + Grafana 임베드
   │  ├─ logs/page.tsx     # M2 placeholder
   │  ├─ resources/page.tsx# M3 placeholder
   │  ├─ incidents/page.tsx# M4 placeholder
   │  └─ api/
   │     └─ fleet/
   │        └─ status/
   │           └─ route.ts # GET: Prometheus up{} → JSON
   ├─ components/
   │  ├─ shell/
   │  │  ├─ app-shell.tsx
   │  │  ├─ top-bar.tsx
   │  │  ├─ nav.tsx
   │  │  └─ brand-mark.tsx  # 키위 로고 자리(인라인 SVG placeholder)
   │  ├─ fleet/
   │  │  ├─ fleet-strip.tsx
   │  │  └─ node-card.tsx
   │  ├─ grafana/
   │  │  └─ grafana-embed.tsx
   │  └─ ui/
   │     ├─ status-indicator.tsx  # 시맨틱 토큰만 사용
   │     └─ placeholder-panel.tsx
   ├─ lib/
   │  ├─ prometheus.ts     # HTTP API 클라이언트 (서버 전용)
   │  ├─ inventory.ts      # docs/inventory.yaml 로더 (서버 전용)
   │  └─ status.ts         # up/down/no-data 판정 로직
   ├─ config/
   │  └─ env.ts            # zod 검증 env 접근 (서버), 누락 시 throw
   └─ types/
      └─ fleet.ts          # Node, NodeStatus 등 타입
```

### 2.3 명명 규칙

- 라우트 세그먼트 & 파일명: **kebab-case** (`overview`, `fleet-strip.tsx`).
- 컴포넌트 export: **PascalCase**. 함수/변수: **camelCase**. 타입/인터페이스: **PascalCase**.
- env 키: **SCREAMING_SNAKE_CASE**.
- 한 파일 = 한 주요 컴포넌트(+ 그 파일 전용 보조). 배럴 파일(`index.ts` 재export)은 만들지 않는다.
- import alias는 `@/*` (= `src/*`).

### 2.4 `.gitignore` (루트 + apps/console에 보강)

최소 다음을 포함:

```
node_modules/
.next/
out/
build/
coverage/
*.log
.DS_Store
# env: 실값은 전부 무시, 예시만 추적
.env
.env.*
!.env.example
```

### 2.5 `docs/inventory.yaml` 스키마

constitution §0의 노드 맵을 이 스키마로 옮긴다. **노드 추가/변경은 이 파일 수정으로 시작**한다.

```yaml
# docs/inventory.yaml — 플릿 단일 기준 (source of truth)
nodes:
  - id: data01                 # 안정적 식별자 (변하지 않음)
    ip: 192.0.2.11
    hostname: ""               # 알면 채움
    os: ubuntu                 # ubuntu | windows
    role: target               # target | stack-host
    gpu: null                  # 예: "A40 x2" | null
    exporters:                 # 있는 것만. 포트는 기본값(확인 필요)
      node: "192.0.2.11:9100"
  - id: data02
    ip: 192.0.2.12
    os: windows
    role: target
    gpu: null
    exporters:
      windows: "192.0.2.12:9182"   # windows_exporter 기본 포트
  - id: data03
    ip: 192.0.2.13
    os: ubuntu
    role: target
    gpu: null
    exporters:
      node: "192.0.2.13:9100"
  - id: data04
    ip: 192.0.2.14
    os: ubuntu
    role: target
    gpu: null
    exporters:
      node: "192.0.2.14:9100"
  - id: data05
    ip: 192.0.2.15
    os: ubuntu
    role: stack-host
    gpu: "A40 x2"
    exporters:
      node: "192.0.2.15:9100"
      dcgm: "192.0.2.15:9400"
```

> 포트(9100 node_exporter / 9182 windows_exporter / 9400 DCGM)는 표준 기본값이다. 실제 값은 확정 시 이 파일에서 갱신한다.

### 2.6 ADR 위치 & 템플릿

- 위치: `docs/decisions/NNNN-<kebab-title>.md` (NNNN = 0001부터 0패딩).
- 모든 의존성·기술 선택마다 1개. 템플릿:

```markdown
# NNNN. <제목>

- 상태: 제안 | 채택 | 폐기
- 날짜: YYYY-MM-DD

## 맥락
무엇을 / 왜 결정해야 하는가.

## 결정
선택한 것.

## 고려한 대안
- 대안 A — 채택하지 않은 이유
- 대안 B — 채택하지 않은 이유

## 결과
얻는 것 / 감수하는 것 / 후속 영향.
```

### 2.7 `specs/M1-console/spec.md` 섹션

```
# M1 콘솔 — Spec
## 목적
## 범위 (in / out)
## 사용자 스토리
## 데이터 소스 (Grafana / Prometheus / inventory)
## 수용 기준 (기계 검증 가능 — §8 그대로)
## 비범위
## 의존 결정 (ADR 링크)
```

### 2.8 `AGENTS.md` (목차)

100라인 이내. 백과사전이 아니라 **맵**이다. 다음을 가리킨다: `constitution.md`, `docs/inventory.yaml`, `specs/`, `docs/decisions/`, `apps/console/` 실행법. 상세 내용을 복붙하지 말고 링크/경로만.

---

## 3. 환경설정 & 시크릿 관리

### 3.1 `apps/console/.env.example` (값 비우고 커밋)

```
# Grafana — Overview 임베드용 (iframe src로 브라우저에 노출됨: 내부 ZT URL이라 허용)
GRAFANA_URL=
GRAFANA_DASHBOARD_UID=

# Prometheus — 플릿 상태 질의용 (서버 전용, 브라우저 비노출)
PROMETHEUS_URL=

# 플릿 인벤토리 경로 (레포 루트 기준 상대경로)
INVENTORY_PATH=../../docs/inventory.yaml

# dev 포트 (라이브 스택과 분리)
PORT=3105
```

### 3.2 규칙

- `config/env.ts`에서 **zod로 검증**해 한 곳에서만 env를 읽는다. 누락 시 어떤 키가 빠졌는지 명시하며 **fail-fast로 throw**.
- 컴포넌트·route handler는 `process.env`를 **직접 읽지 않고** `config/env.ts`를 통한다.
- `GRAFANA_URL`은 iframe 특성상 클라이언트 HTML에 노출된다(내부망·Cloudflare Access 뒤라 허용). `PROMETHEUS_URL`은 **서버 전용**으로 절대 클라이언트 번들에 들어가지 않게 한다(route handler/RSC에서만 사용).
- `.env.local`은 **사용자가 채운다.** 네가 생성하거나 실값을 커밋하지 않는다.

---

## 4. 구현 상세

### 4.1 디자인 토큰 (`globals.css` + `tailwind.config.ts`)

- **단일 소스:** `globals.css`에 CSS 커스텀 프로퍼티로 정의하고, `tailwind.config.ts`의 theme가 그 변수를 참조하게 한다.
- **브랜드 램프(TDS식 50~900):** green `#38B38D` / blue `#3CA2DF` / gray `#343E44` / black / white 각각.
- **시맨틱 상태 토큰(브랜드와 분리):** `success`(green계) / `info`(blue계) / `warning`(amber, 추가) / `danger`(red, 추가) / `neutral`·`no-data`(gray).
- **규칙:** 컴포넌트에 raw hex 인라인 금지. **상태색은 시맨틱 토큰을 통해서만** 사용.

### 4.2 앱 셸 & 네비 (`components/shell/*`, `app/layout.tsx`)

- 상단 바: KEIwi 브랜드(`brand-mark.tsx`의 키위 SVG placeholder) + 제품명.
- 네비 항목: **Overview / Logs / Resources / Incidents**. Overview만 활성, 나머지는 "M2/M3/M4 예정" placeholder로 명확히 표시(클릭 시 `placeholder-panel`).
- `layout.tsx`에서 폰트 로딩(§5) + AppShell 래핑.

### 4.3 Overview — Grafana 임베드 (`app/overview/page.tsx`, `components/grafana/grafana-embed.tsx`)

- `GRAFANA_URL` + `GRAFANA_DASHBOARD_UID`로 임베드 URL을 만들어 `<iframe>` 렌더. 대시보드를 재구현하지 않는다.
- 페이지 상단에 플릿 상태 strip(4.4), 그 아래 Grafana 임베드.

### 4.4 플릿 상태 strip (`components/fleet/*`, `app/api/fleet/status/route.ts`, `lib/*`)

- `route.ts`(GET): `lib/prometheus.ts`로 `{PROMETHEUS_URL}/api/v1/query?query=up` 호출.
- `lib/status.ts`: `up` 시계열의 `instance`(ip:port)를 `lib/inventory.ts`가 로드한 노드와 매칭.
  - 매칭되고 값=1 → `up`, 값=0 → `down`, **inventory에 있으나 매칭 series 없음 → `no-data`**(절대 down으로 표기하지 않음).
- 반환: `[{ id, ip, os, role, status }]`.
- `fleet-strip.tsx`: 각 노드를 `node-card`로 렌더, 상태를 **시맨틱 토큰 색**으로 표시. `no-data`는 neutral.
- `lib/prometheus.ts`·`lib/inventory.ts`는 **서버 전용**(`'use client'` 금지, fs/fetch 서버에서).

### 4.5 placeholder 페이지 (`logs`/`resources`/`incidents`)

- 각 페이지는 `placeholder-panel`로 "이 기능은 Mx에서 추가됩니다" 안내. 운영자 시점의 명확한 카피(§5).

---

## 5. 디자인 방향 (KEIwi identity)

- 마케팅 랜딩이 아니라 **운영자 콘솔**이다. 장식보다 **차분한 가독성·정밀한 여백·상태 명료성**이 우선. 미니멀할수록 타이포·스페이싱·디테일의 정밀도로 승부한다.
- 정체성은 키위 — 직접적 클립아트 남발 말고 **팔레트 + 단 하나의 시그니처 요소**로 표현. 보이는 대담함은 한 곳(플릿 상태 strip을 한눈에 읽히는 특색 있는 노드-헬스 표현)에만 쓰고 나머지는 조용히.
- **피할 것:** 흔한 admin 템플릿 룩(기본 사이드바+카드 그리드+드롭섀도), **그리고** AI 기본 3종(크림+세리프+테라코타 / 흑배경+애시드그린 / 브로드시트 헤어라인). 이 brief를 위한 의도적 선택을 한다.
- 타이포: display + body를 의도적으로 페어링하고, 숫자·IP·메트릭용 **monospace 유틸 페이스**를 둔다(수치·IP는 mono가 잘 읽힘). 명시적 type scale.
- 모션: 최소. 상태 변화 미세 트랜지션 정도. `prefers-reduced-motion` 존중.
- 카피: 운영자 시점·능동태. 시스템 내부 용어가 아니라 관리자가 인지·조작하는 것으로 이름 짓는다. no-data/에러 상태는 "무슨 일이고 어떻게 할지"를 인터페이스 목소리로.
- 품질 바닥: 모바일까지 반응형, 키보드 포커스 가시, reduced-motion 존중.

---

## 6. 스크립트 & 검증

### 6.1 `apps/console/package.json` scripts

```json
{
  "scripts": {
    "dev": "next dev -p 3105",
    "build": "next build",
    "start": "next start -p 3105",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "check:secrets": "bash scripts/check-no-secrets.sh",
    "verify": "npm run lint && npm run typecheck && npm run build && npm run check:secrets"
  }
}
```

### 6.2 `apps/console/scripts/check-no-secrets.sh` (참고 구현, 환경에 맞게 마무리)

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1) src에 하드코딩된 외부 http(s) URL 금지 (env 경유만 허용)
if grep -rnP 'https?://(?!localhost|127\.0\.0\.1)' src \
   | grep -vP '(process\.env|env\.)' ; then
  echo "FAIL: 하드코딩된 URL 발견 (env 경유로 바꿀 것)"; exit 1
fi

# 2) .env 실파일이 git 추적되면 실패
root="$(git rev-parse --show-toplevel)"
if git -C "$root" ls-files | grep -E 'apps/console/\.env(\.[a-z]+)?$' | grep -v '\.env\.example$' ; then
  echo "FAIL: .env 실파일이 추적됨"; exit 1
fi

echo "OK: secrets check passed"
```

---

## 7. 작업 순서 (SDD, 게이트 포함)

**1단계 — 컨텍스트 & 스캐폴딩 문서**
- 루트 `constitution.md` 읽기.
- `docs/inventory.yaml`(§2.5 스키마), `AGENTS.md`(§2.8), 루트 `README.md`, 루트 `.gitignore`, `docs/decisions/.gitkeep`, `infra/.gitkeep` 생성.
- 이해한 바를 **3~5줄로 요약**해 보고.

**2단계 — Spec → 게이트**
- `specs/M1-console/spec.md` 작성(§2.7, 수용 기준은 §8 그대로).
- **여기서 멈추고 승인 대기.**

**3단계 — ADR + 계획 → 게이트**
- `docs/decisions/`에 ADR 작성: (a) 프레임워크/스타일링(기본값 **Next.js + Tailwind + CSS 변수 토큰**, 다른 선택 시 근거), (b) Grafana 임베드 방식, (c) inventory 파싱 라이브러리(YAML).
- `apps/console` 스캐폴드 명령 + 최종 파일 트리(§2.2) + 짧은 구현 계획 제시.
- **여기서 멈추고 승인 대기.**

**4단계 — 구현**
- 브랜치 `feat/m1-console`에서 작업.
- 스캐폴드:
  ```
  npx create-next-app@latest apps/console \
    --ts --app --tailwind --eslint --src-dir --import-alias "@/*"
  ```
  (플래그는 버전에 맞게 조정. 생성 후 §2.2 구조로 정리.)
- §2~§6대로 구현. **작은 Conventional Commit 단위**(§9)로, 각 커밋은 빌드 통과.

**5단계 — 검증 & 보고**
- `apps/console`에서 `npm run verify` 실행.
- §8 수용 기준을 **항목별로 실제 명령·출력과 함께 pass/fail 표**로 보고.

---

## 8. 수용 기준 (전부 기계 검증 가능)

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

## 9. 커밋 & 브랜치 규약

- 브랜치: `feat/m1-console`.
- **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `style:`, `test:`.
- 작은 단위 커밋, 각 커밋은 빌드 통과 상태 유지.
- 최종은 PR로 정리(머지는 사용자가 한다 — 헌장 원칙 11).

---

## 10. 하지 말 것

- Grafana 대시보드를 Next.js로 재구현.
- 시크릿/실 URL 커밋, `.env.local` 생성, 자체 인증/로그인 구현.
- 라이브 `.105` 스택 건드리기(별도 포트 3105·별도 compose, prod 포트·볼륨 바인딩 금지). Prometheus/Grafana는 **읽기(질의/임베드)만**.
- `infra/` 스택 생성/수정.
- ADR 없이 의존성 추가.
- Prometheus 데이터 없는 노드를 `down`으로 표기.
- §2 외 임의 위치에 파일 생성, 배럴 `index.ts` 남발.

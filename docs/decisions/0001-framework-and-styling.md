# 0001. 프레임워크 & 스타일링 & 디자인 토큰

- 상태: 채택
- 날짜: 2026-06-22

## 맥락

M1 콘솔의 (a) 앱 프레임워크, (b) 스타일링 방식, (c) 디자인 토큰 시스템을 결정한다.

- 헌장 §V는 **Next.js를 확정 스택**으로 둔다.
- 헌장 §17 + 프롬프트 §4.1: **브랜드 램프(50~900)와 시맨틱 상태 토큰(success/info/warning/danger/neutral·no-data)을 분리**하고, **CSS 변수를 단일 소스**로 두며 raw hex 인라인을 금한다.
- 헌장 §6: **지루한(안정·보편) 기술 선호.**
- 현재(2026-06) `create-next-app@latest` = **Next.js 16.2**, 동반 Tailwind = **v4.3**. Tailwind v4는 설정 방식이 v3과 근본적으로 다르다: `tailwind.config.{js,ts}` 대신 **CSS-first** — `@import "tailwindcss";` + `@theme { … }`로 토큰을 정의하고, PostCSS 플러그인은 `@tailwindcss/postcss`다.

## 결정

- **Next.js 16 (App Router, TypeScript)** — `--src-dir`, import alias `@/*`.
- **Tailwind CSS v4** — `globals.css`에서 `@import "tailwindcss";` + **`@theme`로 디자인 토큰을 단일 정의**. 브랜드 램프와 시맨틱 토큰을 각각 CSS 커스텀 프로퍼티로 선언하고, Tailwind 유틸이 이를 참조하게 한다(예: `--color-success-500`, `--color-brand-green-500`).
- **`tailwind.config.ts`는 생성하지 않는다** (v4 CSS-first). PostCSS는 `postcss.config.mjs`에 `@tailwindcss/postcss`.
- 상태색은 **시맨틱 토큰을 통해서만** 접근(컴포넌트 raw hex 0건, spec §검증 방법의 grep로 강제).

## 고려한 대안

- **Tailwind v3 (`tailwind.config.ts`로 theme가 CSS 변수 참조)** — 프롬프트 §2.2 파일 목록과 글자 그대로 일치하고, **헌장 §6의 핵심 축("학습 데이터에 잘 표현되어 에이전트가 모델링하기 쉬운")에서는 JS config·v3 패턴이 v4 `@theme`(2025 초 GA, 학습데이터 적음)보다 우위**임을 인정한다. 그럼에도 v4를 택한 형량: (a) v4가 `create-next-app` 기본값·안정 릴리스라 v3은 매 스캐폴드마다 핀·다운그레이드로 기본 경로와 싸워야 하고, (b) v4 `@theme`가 "CSS 변수=단일 소스"(§4.1)를 더 곧장 만족한다 — 이 두 상쇄 근거가 §6의 모델링 용이성 이점을 넘어선다고 판단한다. v4의 실제 트레이드오프(PostCSS 플러그인 분리 `@tailwindcss/postcss`, 브라우저 요구 상향)도 감수 대상이다. → **기각**(단, §2.2 `tailwind.config.ts` 부재라는 구조 일탈 1건을 수반 — 게이트 사인오프 항목).
- **CSS Modules / vanilla-extract / styled-components** — Tailwind 생태계의 토큰↔유틸 일관성을 포기. §6 대비 덜 보편적. → 기각.
- **다른 프레임워크(SvelteKit/Remix 등)** — 헌장 §V가 Next.js를 확정. → 기각.

## 결과

- `create-next-app` 기본 경로를 따르므로 스캐폴드 마찰이 최소화된다.
- **프롬프트 §2.2 대비 단 하나의 구조 차이: `tailwind.config.ts` 미생성**(토큰은 `globals.css`의 `@theme`로 이동). spec의 §검증 방법 "파일 §2 구조 일치" 항목은 이 일탈을 ADR-0001 근거로 허용한다.
- 디자인 토큰이 `globals.css` 한 곳에 모여 브랜드/시맨틱 분리(§17)와 단일 소스(§4.1)를 동시에 만족. **프롬프트 §4.1 본문의 "tailwind.config의 theme가 변수를 참조"(v3 메커니즘) 서술은 v4 `@theme` 방식으로 대체된다** — §2.2 파일 일탈과 동일한 사인오프 범위.
- 후속: 토큰 명명 규칙·type scale·mono 유틸 페이스를 `globals.css`에 정의(spec 범위 In 8).
- 의존성 추가: `next` 16, `react`, `react-dom`, **`typescript`(+@types/*)**, `tailwindcss` v4, `@tailwindcss/postcss`, `eslint`(flat config). react/react-dom은 Next.js 동반 peer로 §V 확정에 귀속, `typescript`는 `--ts`로 명시 선택(타입=spec↔코드 드리프트 방지, §7). 검증/파싱/테스트 의존성은 [0003](0003-inventory-yaml-parser.md)·[0004](0004-config-validation-zod.md)·[0005](0005-unit-test-runner.md) 참조.

### Next 16 스캐폴드 실측 주의 (create-next-app@16.2.9)

- 스캐폴드 명령: `npx create-next-app@latest apps/console --ts --app --tailwind --eslint --src-dir --import-alias "@/*" --use-npm --yes --disable-git` (전부 유효 플래그·비대화형 확인). 레포 내부이므로 **`--disable-git`로 중첩 git 초기화 방지**.
- **`next lint` 제거됨** — 생성 `package.json`의 lint 스크립트는 `"lint": "eslint"`다. 프롬프트 §6.1의 `next lint`는 따르지 않고 `eslint`(flat config `eslint.config.mjs`)로 고정한다.
- 생성 `.gitignore`의 `.env*`에는 `!.env.example` 부정 패턴이 없어 example까지 무시된다 → `apps/console/.gitignore`에 **`!.env.example`을 보강**해야 `.env.example` 커밋이 가능(수용 기준). `git check-ignore -v apps/console/.env.example`가 매치 없음이어야 한다.

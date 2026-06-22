# KEIwi

> **KEIwi**("키위")는 KEI 연구 서버 플릿을 단일 콘솔에서 **모니터링·로깅·장애추적·알림**하고,
> 어느 서버가 여유 있는지 파악해 작업 배치를 돕는 **온프레미스 관제 시스템**이다.

모든 작업의 진입점은 [`Constitution.md`](./Constitution.md)(프로젝트 헌장)와 [`AGENTS.md`](./AGENTS.md)(목차)다. 먼저 이 둘을 읽는다.

## 무엇인가

- 5대 연구 서버(`192.168.1.101~105`)를 중앙(`.105`)에서 **Pull 방식**으로 관제한다.
- **단일 운영 콘솔 = Grafana.** KEIwi 콘솔(Next.js)은 브랜드 front door로서 커스텀 뷰만 담고 **Grafana를 임베드**한다(재구현하지 않는다).
- **온프레미스 only**, 외부 노출은 Cloudflare Access(Zero Trust) 뒤에서만.

플릿 구성은 [`docs/inventory.yaml`](./docs/inventory.yaml)이 단일 기준이다.

## 레포 구조

```
keiwi/
├─ Constitution.md     # 프로젝트 헌장 (권위)
├─ AGENTS.md           # 목차/지도 — 여기서 시작
├─ README.md           # 이 파일
├─ docs/
│  ├─ inventory.yaml   # 플릿 단일 기준 (source of truth)
│  ├─ decisions/       # ADR (의존성·기술 선택 근거)
│  └─ prompts/         # 마일스톤별 빌드 프롬프트
├─ specs/
│  └─ M1-console/      # M1 콘솔 스펙
├─ infra/              # 관제 스택 (범위 밖)
└─ apps/
   └─ console/         # KEIwi 콘솔 (Next.js) — M1
```

## 시작하기

콘솔 개발은 [`apps/console`](./apps/console)에서. 실행법 상세는 [`AGENTS.md` §3](./AGENTS.md)을 보라.

```bash
cd apps/console
npm install
npm run dev      # http://localhost:3105
```

## 워크플로 (SDD)

```
헌장 → spec(WHAT+WHY) → plan(HOW + ADR) → 구현 → verify
```

- **Spec이 진실의 원천**이다 — 행동을 바꾸려면 spec을 먼저 고친다.
- 모든 의존성·기술 선택은 [`docs/decisions/`](./docs/decisions)에 **ADR**로 근거를 남긴다.
- 수용 기준은 **기계 검증 가능**해야 한다.

## 마일스톤

| | 내용 | 상태 |
|---|---|---|
| **M1** | 통합 메트릭 콘솔 (시스템·GPU + 모델↔GPU 매핑) | 진행 중 |
| **M2** | 통합 로그 (ELK, Grafana 단일 콘솔) | 예정 |
| **M3** | 여유 리소스 뷰 ("free" 판정 + 가용 서버) | 예정 |
| **M4** | 장애 추적·시각화 (incident 기록 + 타임라인) | 예정 |
| **M5** | 크리티컬 에러 알림 (카탈로그 기반) | 예정 |

## 운영

온프레미스 사내 시스템. 프로덕션 적용·배포는 **사람이** 수행하며(헌장 §11), 머지는 PR로 사용자가 한다.

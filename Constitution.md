# KEIwi — 프로젝트 헌장 (Constitution)

> **KEIwi**("키위")는 KEI 연구 서버 플릿을 단일 콘솔에서 모니터링·로깅·장애추적·알림하고,
> 어느 서버가 여유 있는지 파악해 작업 배치를 돕는 **온프레미스 관제 시스템**이다.
>
> 이 문서는 프로젝트의 **불변 규칙**이다. 모든 작업 세션에서 에이전트가 **가장 먼저 읽으며**,
> 다른 모든 문서·코드에 우선한다. 충돌 시 이 헌장이 이긴다.

---

## 0. 플릿 인벤토리 (Source of Truth)

| IP | 서버 | OS | 역할 |
|---|---|---|---|
| 192.168.1.101 | 1 | Ubuntu | target |
| 192.168.1.102 | 2 | Windows | target |
| 192.168.1.103 | 3 | Ubuntu | target |
| 192.168.1.104 | 4 | Ubuntu | target |
| 192.168.1.105 | 5 | Ubuntu | **개발(Claude Code) + 관제 스택 호스트** (GPU 최상) |

- 다섯 노드는 단일 서브넷 `192.168.1.0/24` 안에 있다.
- GPU 유무·스펙, 노드별 수집 대상은 `docs/inventory.(md|yaml)`에 기입하며, **이 파일이 service discovery와 온보딩의 단일 기준**이다. 노드 추가·변경은 이 파일을 고치는 것으로 시작한다.

---

## I. 아키텍처 원칙

1. **온프레미스 only.** 모든 메트릭·로그·도메인 데이터는 사내에 머문다. 외부 SaaS에 의존하지 않는다. 외부 노출은 Cloudflare Access 뒤에서만 한다.

2. **단일 운영 콘솔 = Grafana.** 메트릭(Prometheus), 로그(Elasticsearch 데이터소스), 알림(통합 알림), 장애(annotation)를 **전부 Grafana로 surface**한다. Kibana는 심층 로그 탐색 보조로만 쓴다. KEIwi 콘솔(Next.js)은 브랜드 front door로서 커스텀 뷰(free-resource·incident board)만 담고 Grafana를 임베드한다. **Grafana를 재구현하지 않는다.**

3. **데이터 저장소는 성격별 3분리.** 시계열 메트릭 → **Prometheus TSDB**. 로그 → **Elasticsearch**. KEIwi 도메인 데이터(incident 기록·해결, 계정↔이메일 매핑, GPU 예약) → **관계형 DB**. 서로 섞지 않는다 — 메트릭/로그를 SQL에 넣지 않고, 도메인 데이터를 Prometheus/ES에 넣지 않는다.

4. **Pull 우선.** 플릿이 단일 서브넷이므로 중앙 Prometheus(.105)가 각 타깃을 직접 스크랩한다. Push(Pushgateway/remote_write)는 **ADR로 정당화된 예외**에만 허용한다.

5. **이기종 1급 지원.** Ubuntu와 Windows를 동등하게 취급한다. 모든 플릿 기능은 두 OS에서 동작하거나, 불가한 이유를 문서에 명시한다.

6. **지루한 기술 선호.** 안정적이고 학습 데이터에 잘 표현되어 에이전트가 모델링하기 쉬운 의존성을 택한다. 업스트림 동작이 불투명하고 기능이 작으면 직접 구현이 더 싸다고 판단한다.

---

## II. SDD · 문서 원칙

7. **Spec이 진실의 원천(source of truth).** 코드는 spec에서 파생된다. 행동을 바꾸려면 코드가 아니라 **spec을 먼저 고치고** 코드가 따라오게 한다. spec↔코드 드리프트는 버그다.

8. **모든 의존성·컴포넌트 선택은 ADR.** `docs/decisions/`에 "**왜 이걸 / 왜 대안은 아닌지**"를 기록한다. 근거 없는 의존성 추가를 금지한다. (DB·shipper·라이브러리 등 모든 기술 선택에 적용)

9. **수용 기준은 기계 검증 가능.** 모든 spec의 acceptance criteria는 실행·검증 가능해야 하며 CI가 강제한다. "잘 된다"가 아니라 "이 명령이 이 출력을 낸다"로 쓴다.

10. **문서는 목차지 백과사전이 아니다.** 짧은 진입점(`AGENTS.md`)이 깊고 신뢰할 수 있는 소스를 가리킨다(progressive disclosure). **에이전트 관점에서 컨텍스트에 없으면 존재하지 않는 것** — 모든 합의·결정·패턴은 반드시 레포에 버전 관리된 아티팩트로 남긴다. 머릿속·채팅·외부 문서는 접근 불가로 간주한다.

---

## III. 운영 · 안전 원칙

11. **에이전트는 생성, 사람은 적용.** 에이전트는 compose·config·스크립트를 **레포에 생성**한다. 프로덕션(.105 라이브 스택, 타 노드)에 대한 실제 적용·배포는 **사람이** 한다. 에이전트가 노드를 자율적으로 SSH-설치하지 않는다.

12. **개발 격리.** 개발은 .105에서 이뤄지지만, **라이브 관제 스택을 절대 방해하지 않는다.** dev 인스턴스는 별도 compose 프로젝트명·포트·볼륨으로 분리하고, 검증을 통과한 뒤에만 프로덕션으로 승격한다.

13. **시크릿은 레포 밖.** SMTP 자격증명·토큰·키 등은 **절대 커밋하지 않는다.** env 또는 시크릿 스토어에서 읽으며, 에이전트는 env를 읽는 코드만 작성한다.

14. **인증 = Cloudflare Access.** 콘솔·Grafana·Kibana는 Zero Trust 뒤에 둔다. **자체 인증 시스템을 만들지 않는다.**

15. **알림은 노이즈 최소화.** 정의된 "**귀속 가능한 크리티컬 이벤트 카탈로그**"(OOM kill, GPU Xid/ECC, 디스크 풀, oom-killer, runaway 프로세스 등)만 알림을 트리거한다. 모든 에러에 알림을 보내지 않는다.

16. **멱등성.** 셋업·설정 아티팩트는 재실행해도 안전해야 한다.

---

## IV. 디자인 원칙

17. **브랜드 토큰과 시맨틱 토큰 분리.** KEIwi 팔레트는 정체성·UI 크롬용이다:

    - green `#38B38D` (primary) · blue `#3CA2DF` (secondary) · gray `#343E44` (neutral) · black · white

    상태 표현은 **별도의 시맨틱 토큰**(success / info / warning / danger / neutral)으로 한다. 브랜드 팔레트가 전부 쿨톤이라 "위험/경고"를 표현할 수 없으므로 **amber · red를 추가**한다. 토스 TDS식 명도·채도 램프(예: 50~900)로 각 색을 운용한다.

---

## V. 기술 스택

- **확정:** Prometheus · Grafana · ELK(Elasticsearch / Logstash / Kibana) · Next.js · Docker Compose · Cloudflare Access
- **ADR로 결정(미정):**
    - 관계형 DB — SQLite vs PostgreSQL
    - 로그 shipper — Fluent Bit vs Filebeat(+Winlogbeat)
    - 앱 구조 — Next.js 풀스택(route handler + systemd 타이머) vs 별도 워커 서비스
    - 기타 부속은 필요 시 ADR과 함께 추가

---

## VI. 개발 워크플로

```
constitution  →  /specify (WHAT+WHY)  →  /plan (HOW + ADR)  →  /tasks  →  /verify
```

- 에이전트는 매 세션 **이 헌장 + 해당 마일스톤의 spec**을 먼저 읽는다.
- Claude Code 프롬프트는 이 문서들을 **가리키게** 만든다(내용을 인라인하지 않는다).

**마일스톤**

- **M1** 통합 메트릭 콘솔 (전 서버 시스템·GPU + 모델↔GPU 매핑)
- **M2** 통합 로그 (ELK, Grafana 단일 콘솔)
- **M3** 여유 리소스 뷰 ("free" 판정 + 가용 서버)
- **M4** 장애 추적·시각화 (incident 기록 + 타임라인 annotation)
- **M5** 크리티컬 에러 알림 (카탈로그 기반 + 사용자 귀속 이메일)
- **비전** 5서버 너머 전 연구서버 확장 + 자동 배치

---

## VII. 거버넌스

- 이 헌장은 다른 모든 문서·관행에 **우선**한다.
- 헌장 변경은 ADR로 기록한다.
- 헌장과 충돌하는 코드·문서는 **결함**으로 취급해 수정한다.

# 로그×어시스턴트 통합 (Logs Workbench) — Spec

> 2026-07-02. 상태: v1 라이브(2026-07-02 배포·Playwright 16/16) · **v2 스펙 확정(2026-07-04, 구현 대기)**. 권위: 헌장(§I-2 Grafana 재구현 금지 · 읽기 전용) · ADR-0014(어시스턴트).
> 트리거(사용자): "로그에서 에러가 발생했을 때 **그게 뭔지 즉시 설명** 듣고 싶다 — 사이드바 어시스턴트를 더 쓰기 쉽게 통합."

## WHY — 리서치 근거 (2026-07-02 웹 조사)
Elastic AI Assistant·Grafana Assistant·Datadog Bits AI/Watchdog·New Relic AI·OpenSearch Assistant·Netdata AI 공통 패턴:
1. **2계층 표준**: 상시 채팅 표면(도킹 사이드바/플라이아웃) + 데이터 지점 인라인 진입점("Explain this error")이 컨텍스트와 함께 그 표면을 연다.
2. **어시스턴트는 별도 페이지가 아니라 콘텐츠 옆에 산다** — 로그를 보면서 묻는다(풀페이지는 보조 모드).
3. 컨텍스트는 구조화 페이로드(메시지+서비스/노드+시간범위), 답변→대화 승격, 인용/증거 필수, 단축키(Datadog `Ctrl+I`)·상태 지속.
비권고: 플로팅 FAB(KRDS 톤 이질·화면 가림), iframe 내부 주입(cross-origin 불가).

## WHAT — v1 범위
`/logs`를 **워크벤치**로: 좌 Grafana 로그 임베드, 우 접이식 어시스턴트 드로어(현재 신호 + 인플레이스 분석).

### 수용 기준 (AC)
- **AC1** `/logs` 우측에 드로어(≈340~416px, lg+): 상단 **현재 신호**(24h error·warn, 노이즈 제외, 12건) + 하단 **AssistantPanel**.
- **AC2** 신호 행 클릭 → **페이지 이동 없이** 그 자리에서 자동 분석(AssistantPanel key-remount prefill). 선택 행 하이라이트.
- **AC3** 답변의 근거 로그 행에 **"이 시점 →"** → Grafana 임베드가 해당 시각 ±5분(+해당 노드 var)으로 점프(iframe src 갱신 — 역방향 딥링크). "원래 범위로" 리셋 배너 표시.
- **AC4** 드로어 토글: 헤더 버튼 + **Ctrl/Cmd+I**, 상태 localStorage 지속. 접으면 임베드 풀폭.
- **AC5** `/incidents`는 **심화 조사 풀페이지**로 존치 — 드로어에 "전체 화면에서 계속 →"(선택 신호 프리필) 링크.
- **AC6** 읽기 전용·외부 전송 없음 고지 유지. 모바일: 세로 스택. 라이트/다크 정상.

### 비범위 (백로그)
- 단계형 로딩(계획→검색→분석 스트리밍) — API 스트리밍 필요.
- 후속 질문 칩("비슷한 로그"/"직전 대비 패턴 변화" — OpenSearch LogPatternAnalysisTool형 baseline 비교).
- 전역 헤더 AI 런처(모든 페이지 공용 드로어) — 2단계.

## HOW — 설계 결정
| 결정 | 근거 |
|---|---|
| 드로어 = **레이아웃 분할**(오버레이 아님) | NOC 대화면, 로그와 답변 동시 시청(Grafana Assistant 도킹형) |
| 신호 데이터 = 서버(page)에서 `searchLogs` 후 **직렬화 prop** | iframe 내부 접근 불가 → 같은 OpenSearch를 콘솔이 직접 질의(Watchdog Insights 병치 논리) |
| 인플레이스 분석 = `AssistantPanel key=신호id` remount | 기존 prefill 자동실행 재사용, 신규 상태기계 불필요 |
| 딥링크 = `GrafanaTabs timeOverride` prop(src의 from/to/var 치환) | iframe 주입 불가하지만 **src는 콘솔 소유** |
| `logs-embed.tsx` 삭제 → 워크벤치가 GrafanaTabs 직접 렌더 | 임베드 설정(base·대시보드)을 서버에서 데이터로 전달(이미 src 속성으로 노출되는 값) |

## Tasks
- [x] T01 `grafana-tabs.tsx` `timeOverride` prop(from/to/vars 치환)
- [x] T02 `assistant-panel.tsx` `onEvidenceFocus` prop + 근거 행 "이 시점 →"
- [x] T03 `components/assistant/logs-workbench.tsx`(client) — 드로어·신호목록·토글(Ctrl+I·localStorage)·리셋 배너·전체화면 링크
- [x] T04 `logs/page.tsx` 서버 조립(searchLogs+getGrafanaLogs+resolveGrafanaBase) · `logs-embed.tsx` 제거
- [x] T05 검증 — typecheck·lint·test·no-raw-hex + 격리 빌드 Playwright(드로어·인플레이스 분석·딥링크·토글·라이트/다크·무스크롤) 스크린샷

---

## v2 (2026-07-04)

> 트리거(사용자, 2026-07-04): 실사용에서 **임베드 < 어시스턴트** — "그라파나는 유심히 안 보게 됨." 워크벤치의 무게중심을 어시스턴트로 재배분.
> **비율 이력**: 4:1(v1) → 3:1(1차 조정) → **1:1**(v2 재개정).

### 수용 기준 (AC — v1 AC6에서 이어서)
- **AC7** 임베드:어시스턴트 드로어 폭 = **1:1**(lg+). 근거: 사용자 사용 패턴(위 트리거).
- **AC8** 드로어에 **필터 칩**: 레벨(ERROR·WARN) · 노드(data0N), 각 칩에 **카운트 병기**(참고 UI의 좌측 필터 패널 문법). 칩 선택 → **신호 목록 필터 + Grafana 임베드 var(`fleet_node`·`log_level`) 동시 구동**.
- **AC9** 좌측 내비에서 **어시스턴트 항목 제거**(통합 로그로 일원화). `/incidents` 라우트는 존치 — 드로어 "전체 화면에서 계속 →" 딥링크 전용.
- **AC10** KRDS 폴리시: 패널 헤더 좌측 **브랜드 틱** · 신호 active 행 좌측 **액센트 바**.

### Tasks — V2
- [ ] V01 워크벤치 분할 1:1 (AC7)
- [ ] V02 필터 칩(레벨·노드·카운트) — 신호 목록 + 임베드 var 동시 필터 (AC8)
- [ ] V03 내비 어시스턴트 제거 · `/incidents` 딥링크 존치 (AC9)
- [ ] V04 패널 헤더 브랜드 틱 · active 행 액센트 바 (AC10)
- [ ] V05 검증 — typecheck·lint·test·no-raw-hex + 격리 빌드 Playwright(1:1·칩 동시 필터·내비·라이트/다크)

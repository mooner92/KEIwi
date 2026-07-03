# 로그×어시스턴트 통합 (Logs Workbench) — Spec

> 2026-07-02. 상태: v1 라이브(2026-07-02 배포·Playwright 16/16). 권위: 헌장(§I-2 Grafana 재구현 금지 · 읽기 전용) · ADR-0014(어시스턴트).
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

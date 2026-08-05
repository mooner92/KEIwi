// 패치노트 데이터 — 정본은 git 이력. 이 파일은 전수조사 스냅샷(2026-08-03, 160커밋)이며
// 이후 릴리스마다 항목을 추가한다.
// 정렬: 날짜 오름차순, 같은 날짜 안에서는 커밋 시각순. 한 커밋이 서로 다른 주제 여럿을
// 담은 경우 항목을 나눴고(같은 sha 복수 항목), 병합 항목은 shas가 복수가 된다.

export type ChangelogType =
  | "신규"
  | "개선"
  | "수정"
  | "사건"
  | "보안"
  | "인프라"
  | "문서";

export interface ChangelogEntry {
  /** 발생일(커밋 일자, KST) — YYYY-MM-DD */
  date: string;
  /** 관련 커밋 short sha — 자잘한 중복을 병합한 항목은 복수 */
  shas: string[];
  type: ChangelogType;
  /** 영향 영역 — console·monitoring·logging·alerting·infra·docs·specs 등 */
  scope: string;
  title: string;
  summary: string;
  /** 사건(incident) — 장애·오동작·소실을 발견하고 수습한 항목 */
  incident?: boolean;
}

/** 전수조사 메타 — 총 커밋 수에는 merge 커밋 등 별도 항목 없는 커밋이 포함된다. */
export const CHANGELOG_META = {
  snapshotDate: "2026-08-03",
  surveyedCommits: 160,
} as const;

export const CHANGELOG: ChangelogEntry[] = [
  // ── 2026-06-22 ──────────────────────────────────────────────
  {
    date: "2026-06-22",
    shas: ["9f17c1f"],
    type: "인프라",
    scope: "infra",
    title: "저장소 레이아웃·gitignore 스캐폴드",
    summary:
      "docs/decisions(ADR)·infra(범위 밖) 플레이스홀더 디렉터리와 node/next/env 무시 규칙을 추가해 저장소 골격을 잡음.",
  },
  {
    date: "2026-06-22",
    shas: ["a4f8195"],
    type: "문서",
    scope: "docs",
    title: "플릿 인벤토리를 단일 진실 원천으로 추가",
    summary:
      "헌장 §0 노드 맵을 5-node 스키마로 옮김. 노드 추가/변경의 단일 진입점이 됨.",
  },
  {
    date: "2026-06-22",
    shas: ["abf2bab"],
    type: "문서",
    scope: "docs",
    title: "AGENTS 지도·README·M1 빌드 프롬프트 추가",
    summary: "AGENTS.md(60줄 목차), README 개요, M1 빌드 프롬프트 보존(헌장 §10).",
  },
  {
    date: "2026-06-22",
    shas: ["52b5023"],
    type: "문서",
    scope: "docs",
    title: "프로젝트 헌장 추가",
    summary: "프로젝트 헌장(constitution) 문서를 추가.",
  },
  {
    date: "2026-06-23",
    shas: ["43aa871"],
    type: "문서",
    scope: "specs",
    title: "M1 콘솔 스펙 작성",
    summary:
      "specs/M1-console/spec.md — 목적/범위/사용자 스토리/데이터 소스/수용 기준/비범위/ADR 링크. 4-렌즈 적대적 검토 반영: status enum {up,down,no-data} 고정, 복수/이기종 exporter 집계 규칙, no-data 안전 불변식, 실 URL 제거(§13).",
  },
  {
    date: "2026-06-23",
    shas: ["89d7dce"],
    type: "문서",
    scope: "docs",
    title: "M1 콘솔 ADR 0001~0005 추가",
    summary:
      "0001 Next 16+Tailwind v4 @theme · 0002 Grafana iframe · 0003 yaml 파서 · 0004 zod 검증 · 0005 vitest. create-next-app@16 실측(next lint 제거→eslint, --disable-git 등) 반영.",
  },
  {
    date: "2026-06-23",
    shas: ["cddb9cc"],
    type: "문서",
    scope: "specs",
    title: "스펙 채택 표기 + ADR 링크 연결",
    summary:
      "spec 상태를 '채택'으로, ADR 0001~0005 링크와 verify 구성(test/hex/PROMETHEUS 보강), Tailwind v4 구조 일탈 명시. AGENTS ADR 색인 추가.",
  },

  // ── 2026-06-23 ──────────────────────────────────────────────
  {
    date: "2026-06-23",
    shas: ["71c48bc"],
    type: "신규",
    scope: "console",
    title: "Next 16 + Tailwind v4 콘솔 앱 셸 스캐폴드",
    summary:
      "create-next-app(Next 16/React 19/Tailwind v4)으로 콘솔 생성. 디자인 토큰(@theme: 브랜드 램프+시맨틱 분리), 상단바/네비/브랜드마크, :3105 포트와 verify 체인 스크립트.",
  },
  {
    date: "2026-06-23",
    shas: ["f0395c5"],
    type: "신규",
    scope: "console",
    title: "env 설정과 플릿 도메인 계층 구현",
    summary:
      "config/env.ts(zod fail-fast, 서버 전용), types/fleet.ts, lib/inventory(yaml+zod)·prometheus·status(매칭/집계). status.test.ts로 US4 불변식(no-data≠down) 등 5케이스 검증.",
  },
  {
    date: "2026-06-23",
    shas: ["1f70a89"],
    type: "신규",
    scope: "console",
    title: "플릿 상태 API 라우트 추가",
    summary:
      "GET /api/fleet/status → [{id,ip,os,role,status}]. Prometheus 불가 시 no-data로 안전 귀결(200 응답).",
  },
  {
    date: "2026-06-23",
    shas: ["e1e78e8"],
    type: "신규",
    scope: "console",
    title: "Overview — 플릿 strip + Grafana 임베드",
    summary:
      "플릿 상태 strip(시그니처 뷰)과 시맨틱 상태색, Grafana iframe(kiosk, env 미설정 시 안내 패널). force-dynamic 렌더링.",
  },
  {
    date: "2026-06-23",
    shas: ["9a803ec"],
    type: "신규",
    scope: "console",
    title: "M2~M4 자리표시 페이지 추가",
    summary: "logs/resources/incidents 페이지를 운영자 카피로 '예정' 명시하여 추가.",
  },
  {
    date: "2026-06-23",
    shas: ["c48dcb5"],
    type: "수정",
    scope: "console",
    title: "복수 series 상태 집계 버그 수정",
    summary:
      "동일 instance의 복수 series에서 value=0이 1로 덮어써져 down을 up으로 오인하던 버그 수정 — 노드당 모든 매칭 series를 평가. instance 누락/비숫자 value series 제외, 중복 instance 회귀 테스트 추가(6 pass).",
  },
  {
    date: "2026-06-23",
    shas: ["8150919"],
    type: "개선",
    scope: "console",
    title: "접근성·디자인 폴리시 (리뷰 반영)",
    summary:
      "node-card 대비 상향(ink-muted), sr-only h1, skip-link+main#main, reduced-motion 리셋과 정상 노드 펄스 제거(차분한 화면), Grafana 빈 로드 안내+새 탭 링크+lazy.",
  },

  // ── 2026-06-24 ──────────────────────────────────────────────
  {
    date: "2026-06-24",
    shas: ["1355ca9"],
    type: "인프라",
    scope: "monitoring",
    title: "Prometheus 설정 + data04 SSH 터널 유닛",
    summary:
      "infra/monitoring/: prometheus.yml(instance=ip:port로 inventory와 정렬), keiwi-tunnel-data04.service(systemd), 적용 순서 README. 라이브 미적용 — 사람이 적용(§11). data01~03은 no-data 유지.",
  },
  {
    date: "2026-06-24",
    shas: ["e9ed4e6"],
    type: "인프라",
    scope: "infra",
    title: "keiwi-console systemd 유닛 (:3105 상주)",
    summary:
      "Next.js production을 systemd로 상주(.env.local 자동 로드, Restart=always). 라이브 스택과 3105 포트 분리(§12), 적용은 사람이(§11).",
  },
  {
    date: "2026-06-24",
    shas: ["a7f1248"],
    type: "수정",
    scope: "infra",
    title: "keiwi-console 유닛 견고화",
    summary:
      "npm 래퍼 대신 next를 node로 직접 실행, systemd 최소 env 대응으로 HOME 설정, 적용 주석을 절대경로로 정정.",
  },
  {
    date: "2026-06-24",
    shas: ["781e0f8"],
    type: "수정",
    scope: "monitoring",
    title: "data04 타깃 주석 처리 (터널 가동 전)",
    summary:
      "터널 미가동 시 data04가 down으로 오표시되는 것 방지 — 기본은 data05만 relabel, keiwi-tunnel-data04 active 후 주석 해제하도록.",
  },
  {
    date: "2026-06-25",
    shas: ["bdc621b"],
    type: "신규",
    scope: "console",
    title: "Grafana 다중 대시보드 탭 지원",
    summary:
      "GRAFANA_DASHBOARD_UID을 'uid|라벨' 쉼표 목록(개수 가변)으로 파싱. 서버는 데이터만 취득, grafana-tabs(클라)가 N개 탭 전환. 1개면 탭 숨김.",
  },
  {
    date: "2026-06-25",
    shas: ["4715dda"],
    type: "수정",
    scope: "console",
    title: "Grafana 임베드 크롬 제거 (kiosk 유지)",
    summary:
      "임베드 URL을 /d/<uid/slug>?kiosk&theme=light로. 슬러그 포함 경로면 Grafana 정식화 리다이렉트가 없어 ?kiosk가 유지돼 사이드바/상단/헤더가 숨겨짐.",
  },
  {
    date: "2026-06-25",
    shas: ["b311524"],
    type: "수정",
    scope: "console",
    title: "kiosk/theme 파라미터 병합 견고화",
    summary:
      "buildEmbedSrc가 입력(경로/슬러그/쿼리/전체 URL)을 분해해 ? 중복 없이 kiosk·theme=light 병합. 기존 var-*/시간/refresh 파라미터 보존, .env에 쿼리 포함 입력 허용.",
  },

  // ── 2026-06-26 ──────────────────────────────────────────────
  {
    date: "2026-06-27",
    shas: ["d4d4df7"],
    type: "신규",
    scope: "monitoring",
    title: "모델 워크로드 관측 (vLLM 스크랩 + 대시보드)",
    summary:
      "prometheus.yml에 vllm 잡(8003/8010, model_name relabel). Grafana 'KEIwi Model Workload' 12패널 대시보드: 모델별 요청/토큰율/TTFT·ITL p95/KV캐시 + DCGM GPU util/VRAM/온도/전력 + 모델↔GPU 매핑표. data05 전용.",
  },

  // ── 2026-06-27 ──────────────────────────────────────────────
  {
    date: "2026-06-27",
    shas: ["1cf5d6e"],
    type: "수정",
    scope: "infra",
    title: "data04 터널 user5@IP·apt exporter·ufw 정정",
    summary:
      "터널 ExecStart를 'data04'(이름해석 실패)→'user5@192.0.2.104'로. node-exporter를 docker→apt로, vLLM 스크랩용 ufw 개방(도커 브리지 대역→8003/8010) 명시.",
  },
  {
    date: "2026-06-27",
    shas: ["d264f47"],
    type: "수정",
    scope: "infra",
    title: "data04 SSH 터널 포트 764로 정정",
    summary:
      "data04 sshd는 22가 아니라 764 — 터널 유닛에 -p 764 추가, ssh-copy-id -p 764와 Prometheus 컨테이너용 ufw 9104 개방을 README에 반영.",
  },
  {
    date: "2026-06-27",
    shas: ["a3c3e9b"],
    type: "인프라",
    scope: "monitoring",
    title: "data04 스크랩 타깃 활성화 (터널 검증 완료)",
    summary:
      "data04 node-exporter 타깃(192.0.2.201:9104 → instance 192.0.2.104:9100) 주석 해제. 터널 9104→200 응답 검증 후 활성화.",
  },
  {
    date: "2026-06-27",
    shas: ["4fcb519"],
    type: "개선",
    scope: "console",
    title: "Overview 한 화면 맞춤 (full-height flex)",
    summary:
      "AppShell h-dvh + main flex, Grafana iframe이 70vh 고정 대신 남은 높이를 채움(flex-1). desktop/laptop 세로 스크롤 제거.",
  },
  {
    date: "2026-06-27",
    shas: ["1bbe828"],
    type: "인프라",
    scope: "gates",
    title: "Playwright 시각 QA 도입",
    summary:
      "scripts/screenshot.mjs(뷰포트별 스크린샷 + 세로 스크롤 검증)과 npm run screenshot, docs/testing.md(시각 QA 표준 절차) 추가. screenshots/는 gitignore.",
  },
  {
    date: "2026-06-27",
    shas: ["3f37550"],
    type: "신규",
    scope: "console",
    title: "플릿 카드 클릭 → 노드 메트릭 드릴다운",
    summary:
      "노드 카드 클릭 → /overview?node=<id> → 그 노드의 node-exporter instance(ip:9100)를 시스템 임베드에 var-instance로 주입. 데이터 있는 노드(up/down)만 클릭 가능, 재클릭 시 전체 복귀.",
  },
  {
    date: "2026-06-27",
    shas: ["8feaa8d"],
    type: "문서",
    scope: "specs",
    title: "디자인시스템 Phase 1 스펙 + ADR 0006/0007",
    summary:
      "KRDS 리스킨 SDD Phase 1 — KRDS 공식 7원칙→관측 콘솔 수용기준(원칙7 신뢰=데이터 정확성, no-data≠down), tokens/color/typography(Pretendard GOV, 본문 17px)/shape/layout 스펙. ADR-0006 KRDS 채택(크롬만/tokens-only), ADR-0007 브랜드 확장형.",
  },
  {
    date: "2026-06-28",
    shas: ["e0c8d66"],
    type: "신규",
    scope: "console",
    title: "Phase 2 — KRDS 토큰·Pretendard·다크 모드",
    summary:
      "컴포넌트 코드 수정 없이 @theme 값만 krds-uiux primitive 참조로 바꿔 크롬이 자동 리스킨. 다크(high-contrast) 오버라이드, Pretendard GOV(next/font/local), FOUC 방지 inline script, 다크 토글(useSyncExternalStore, 쿠키+localStorage).",
  },
  {
    date: "2026-06-28",
    shas: ["4f51542"],
    type: "문서",
    scope: "specs",
    title: "KRDS 리디자인 정식 SDD (spec/plan/tasks)",
    summary:
      "Spec Kit 형식 — spec은 무엇·왜만, 기술은 plan.md로. 기존엔 spec.md만 있어 깊은 SDD가 미완이었음. tasks.md(Phase 0~5+백로그)·research.md(Phase 0 근거) 추가.",
  },
  {
    date: "2026-06-28",
    shas: ["2678a4b"],
    type: "문서",
    scope: "specs",
    title: "Phase 1 패턴 — 상태·스탯카드·실시간 갱신",
    summary:
      "server-status(색+아이콘+텍스트 3채널 상태 표현), stat-card(단일 수치 glance 카드), realtime-update(aria-live 정책 + Grafana 동기화 노트) 패턴 스펙.",
  },
  {
    date: "2026-06-28",
    shas: ["58dcd56"],
    type: "개선",
    scope: "console",
    title: "표준형 KRDS 전환 — 정부 블루·흰 헤더",
    summary:
      "원본 KRDS 대비 인상이 약하다는 피드백으로 ADR-0007을 확장형→표준형으로 번복. Primary=정부 블루(KRDS 정부 블루), 헤더 다크→흰 배경(KEIwi green은 로고만), 정부 식별 배너 신규, 본문 17px KRDS 타이포 스케일.",
  },
  {
    date: "2026-06-28",
    shas: ["7f537b7"],
    type: "신규",
    scope: "console",
    title: "KRDS 표준 레이아웃 — 좌측 사이드메뉴 셸",
    summary:
      "워크플로 3안(사이드메뉴/메인메뉴/관제밀도) 심사 → 좌측 사이드메뉴 셸 채택. 섹션 그룹+활성 액센트바+soon 배지, 브레드크럼+가시 H1 페이지헤더, 유틸바(검색 자리표시+테마 토글), nav-items.ts 단일 소스. 정부 식별 배너는 내부 도구라 제거.",
  },
  {
    date: "2026-06-28",
    shas: ["7f537b7"],
    type: "개선",
    scope: "console",
    title: "다크 모드 ↔ Grafana 테마 동기화",
    summary:
      "buildEmbedSrc에 theme 파라미터 + useTheme 훅으로 콘솔 다크 모드와 Grafana 임베드 테마를 동기화. 임베드 구조와 드릴다운 var-instance는 불변 보존.",
  },

  // ── 2026-06-28 ──────────────────────────────────────────────
  {
    date: "2026-06-28",
    shas: ["3a35dd8"],
    type: "수정",
    scope: "console",
    title: "드릴다운에 var-nodename 추가",
    summary:
      "대시보드가 Nodename(부모)→Instance(종속) 구조라 var-instance만 보내면 무시되고 기본 노드(data05)만 표시됨. var-nodename을 핵심 파라미터로 추가(data04=data04lx, data05=efc20b3d818e).",
  },
  {
    date: "2026-06-28",
    shas: ["e61c23b"],
    type: "수정",
    scope: "console",
    title: "드릴다운 instance 변수 후보 확장",
    summary:
      "var-nodename은 먹지만 Instance가 105로 고정되는 문제 — 대시보드의 instance 변수 이름이 instance가 아닐 수 있어(node/host) 후보를 모두 var-*로 설정.",
  },
  {
    date: "2026-06-28",
    shas: ["e61c23b"],
    type: "인프라",
    scope: "monitoring",
    title: "data04 GPU(RTX 6000) 수집 설정",
    summary:
      "data04 = Quadro RTX 6000 x2, DCGM 미설치 상태. inventory에 dcgm 엔드포인트(192.0.2.104:9400), prometheus dcgm-exporter job에 data04 타깃, 터널에 -L 9404 추가. 서버 측 dcgm-exporter 설치+터널 재적용+reload 필요.",
  },
  {
    date: "2026-06-28",
    shas: ["f737b37"],
    type: "문서",
    scope: "specs",
    title: "M2 통합 로그 SDD + ADR 0008/0009",
    summary:
      "결정 확정: Grafana ES 임베드 / Filebeat→Logstash→ES / Ansible / data04·05 먼저. specs/M2-logs/{spec,plan,tasks,research}.md와 ADR-0008(로그 파이프라인)·ADR-0009(Ansible, k8s 미채택).",
  },
  {
    date: "2026-06-28",
    shas: ["f737b37"],
    type: "신규",
    scope: "console",
    title: "/logs 페이지 — Grafana 로그 임베드",
    summary:
      "env getGrafanaLogs() + LogsEmbed(GrafanaTabs 재사용) + KRDS 셸·브레드크럼·헤더 페이지. GRAFANA_LOGS_DASHBOARD_UID env 추가, 미설정 시 안내 패널.",
  },
  {
    date: "2026-06-28",
    shas: ["7476283"],
    type: "인프라",
    scope: "logging",
    title: "M2 로그 인프라 — ELK·Filebeat·Ansible",
    summary:
      "워크플로 5안 병렬 생성+교차검증으로 major 2·minor 3 수정 반영. ES 단일노드+Logstash compose, 정규화 파이프라인, 표준필드 keyword 매핑 템플릿, Grafana ES datasource provisioning, 로그 대시보드(keiwi-logs), Ansible 멱등 배포. 전부 '에이전트 생성, 사람 적용'(§11).",
  },
  {
    date: "2026-06-28",
    shas: ["be3cc7e"],
    type: "신규",
    scope: "console",
    title: "GPU 탭 노드 드릴다운 — DCGM instance 주입",
    summary:
      "시스템 탭은 node-exporter(9100)+nodename, GPU 탭은 DCGM(9400) instance를 주입하도록 분기. 노드 클릭 후 GPU 탭 전환 시 그 노드의 GPU 표시. 전제: GPU 탭 대시보드에 instance 변수 필요.",
  },
  {
    date: "2026-06-28",
    shas: ["5132217"],
    type: "신규",
    scope: "monitoring",
    title: "노드 인식 GPU 대시보드(keiwi-gpu)",
    summary:
      "콘솔 var-instance(DCGM ip:9400)로 노드 전환되는 instance 변수 보유 대시보드. 8패널(VRAM%/사용률/온도/전력/추이/SM클럭/모델표), 전 패널 $instance 필터. data04(RTX 6000)·data05(A40)를 노드 카드 클릭으로 구분.",
  },
  {
    date: "2026-06-28",
    shas: ["daa01bc"],
    type: "사건",
    scope: "logging",
    title: "M2 저장 엔진 ES→OpenSearch 교체",
    summary:
      "data05에서 docker.elastic.co(Cloudflare R2)가 ES 이미지의 큰 레이어를 매번 reset(작은요청·Docker Hub·MSS클램프 무관)해 ES 입수 불가 → Docker Hub에서 정상 입수되는 OpenSearch 2.17.1(ES7.10 호환모드)+logstash-oss로 전환. ES-API 호환이라 데이터흐름·필드·콘솔·템플릿 동일, ADR-0008 개정(OpenSearch는 ES 포크, Apache-2.0).",
    incident: true,
  },
  {
    date: "2026-06-28",
    shas: ["2e1da11"],
    type: "수정",
    scope: "logging",
    title: "인덱스 템플릿 _comment 제거",
    summary: "OpenSearch가 루트 필드 _comment를 거부해 인덱스 템플릿에서 제거.",
  },
  {
    date: "2026-06-28",
    shas: ["fb5ef65"],
    type: "수정",
    scope: "logging",
    title: "Logstash OSS xpack 설정 제거",
    summary:
      "Logstash OSS에서 xpack 설정이 unknown setting으로 기동 실패를 일으켜 제거.",
  },
  {
    date: "2026-06-28",
    shas: ["e0dff61"],
    type: "인프라",
    scope: "logging",
    title: "M2 로그 수집 Ansible — Filebeat 배포(data04·05)",
    summary:
      "journald → data05 Logstash(beats:5044) → OpenSearch 수집기를 Ansible로 멱등 배포(inventory + filebeat role: Elastic APT 8.x 설치→journald 입력→fleet_node 주입→logstash 출력). 적용 후 keiwi-logs-* 인덱스에 data04·data05 양 노드 인입을 by_node 집계로 확인, 시크릿 없음(§13).",
  },
  {
    date: "2026-06-28",
    shas: ["c11755e"],
    type: "인프라",
    scope: "logging",
    title: "로그 대시보드 임포트 전용본(logs.import.json)",
    summary:
      "라이브 Grafana가 provisioning 디렉터리를 바인드하지 않아 UI 임포트가 필요 — logs.json의 하드코딩 datasource uid(keiwi-logs-es)를 __inputs 변수(${DS_KEIWI_LOGS_ES})로 바꾼 임포트 전용본 추가(대시보드 uid keiwi-logs 유지). 검증: 06.28 인덱스 실시간 인입, log_level 정규화, 계약 필드(fleet_node·host_name·log_level·message) 존재.",
  },
  {
    date: "2026-06-28",
    shas: ["902712f"],
    type: "사건",
    scope: "logging",
    title: "콘솔 /logs 복구 — OpenSearch 데이터소스 전환",
    summary:
      "라이브 Grafana(v13) 내장 elasticsearch 플러그인이 부팅마다 read-only 경로에서 자동업데이트(12.5.4→12.6.5) 실패해 데이터소스가 \"not found\" — 공식 grafana-opensearch-datasource(v2.33.1)를 쓰기 가능 경로에 설치해 교체. 콘솔 (외부 도메인 — 비공개) data04·data05 통합 로그 실시간 표시 확인.",
    incident: true,
  },
  {
    date: "2026-06-28",
    shas: ["594d8a1"],
    type: "문서",
    scope: "logging",
    title: "서비스 인지형 로그 분류 방향 수립(ADR-0010)",
    summary:
      "장애 주체(웹·GPU·jupyter·OpenFOAM)를 빠르게 짚는 서비스 인지형 분류를 설계하고 적대적 비평으로 과설계(포트스캔 데몬·다축 필드·command_line 인덱싱)를 제거. 실측 교정: systemd.unit이 주 분류기(실측 25유닛 유일·정확), 대화형 워크로드는 유닛화가 유일한 길, error 22%는 상당수가 진짜 vLLM/torch ERROR라 무작정 다운그레이드 금지(measure-first). service-category.yml·30일 ISM·specs/M2-logs 산출.",
  },
  {
    date: "2026-06-28",
    shas: ["6704571"],
    type: "신규",
    scope: "logging",
    title: "category 분류·log_level 계측기 구현, 보존 365일",
    summary:
      "logs.conf에 service(systemd.unit)→category 6범주 translate 필터(외부 regex 사전, 실측 25유닛 검증)와 log_level_source(body|priority|default) 계측기 구현 — error 22%의 stderr 인플레 vs 진짜 본문 ERROR 비율을 측정한 뒤 다운그레이드 결정(measure-first). 사용자 결정으로 보존 30d→365d(디스크 여유), grok bare-token에 INFO|INFORMATION|NOTICE 추가.",
  },
  {
    date: "2026-06-28",
    shas: ["7f5db9e"],
    type: "문서",
    scope: "logging",
    title: "오늘 인덱스 매핑 선반영 절차 보강",
    summary:
      "오늘 일자 인덱스는 이미 생성돼 템플릿이 소급되지 않으므로, category 문서 인입 전에 _mapping으로 keyword를 직접 선반영해 text 동적매핑을 막는 절차를 문서화.",
  },
  {
    date: "2026-06-28",
    shas: ["82a21c6"],
    type: "사건",
    scope: "logging",
    title: "priority 추출 경로 버그 — 레벨링 사망 발견·수정",
    summary:
      "계측 결과 log_level_source:priority=0 — priority 추출이 실제 Filebeat 경로 [log][syslog][priority]가 아닌 [priority][code]만 봐서 priority 기반 레벨링이 죽어 있었고, 시스템/커널의 우선순위 경고·에러가 전부 info로 떨어지던 것을 경로 추가로 수정. 함께 :ro 마운트 레이스 회피 적용 절차(stop→pull→template→start)와 무손실 reindex 절차(§2.5) 문서화.",
    incident: true,
  },
  {
    date: "2026-06-28",
    shas: ["069e846"],
    type: "신규",
    scope: "console",
    title: "로그 대시보드 category 필터·에러 우선 패널",
    summary:
      "$category 변수(gpu/web/infra/system/user-session)로 GPU↔웹 즉시 분리, 에러 우선 stat(에러·경고 등)과 '에러·경고 상위 서비스' 테이블로 장애 주체 추적(spec UL6), 모든 패널 쿼리에 category 필터 적용.",
  },
  {
    date: "2026-06-28",
    shas: ["8b8d91b"],
    type: "수정",
    scope: "console",
    title: "에러 우선 stat 쿼리 수정(빈 bucketAggs 거부)",
    summary:
      "OpenSearch 데이터소스가 빈 bucketAggs를 거부해 'invalid query, missing metrics and aggregations' 발생 — count 메트릭에 date_histogram 버킷 추가 + stat reduce=sum으로 해결. 정확도가 애매한 cardinality(활성 서비스/수집 노드)는 제거하고 에러·경고 카운트만 유지.",
  },
  {
    date: "2026-06-28",
    shas: ["8374ca5"],
    type: "개선",
    scope: "console",
    title: "통합 로그 신호 우선(signal-first) 재구성",
    summary:
      "raw 로그 firehose 개선(사용자 요청) — 레벨 기본값 error+warn으로 info 홍수([GIN]·/metrics·하트비트) 제외, UFW BLOCK 노이즈 제외, 에러 우선 stat→추세·상위서비스→문제 로그 순 재배치(전체 raw는 접힌 행). 효과: last 1h 3467→1221건(~65% 감소). 파이프라인 무변경.",
  },
  {
    date: "2026-06-28",
    shas: ["76f185c"],
    type: "사건",
    scope: "console",
    title: "신호 뷰 노이즈 제외를 service 기준으로",
    summary:
      "측정 결과 error+warn 신호 1221건의 99%가 rsyslog.service의 omfile suspended 도배(priority=4 warn) — message:omfile은 토큰화가 안 돼 제외 불가라 service 기준 제외로 변경. 제외 후 실제 신호 ~0(fleet 정상), 메인 패널 dedup=signature.",
    incident: true,
  },
  {
    date: "2026-06-29",
    shas: ["d08188b"],
    type: "문서",
    scope: "logging",
    title: "신호 우선 UX·rsyslog 인시던트 문서화(ADR-0011)",
    summary:
      "ADR-0011(신호 우선 대시보드·노이즈 정책: 대시보드 제외 채택·파이프라인 분류 보류·service 기준 제외·rsyslog 근본수정), rsyslog-omfile-flood 재사용 런북(data04 사례), README §6~8 확장, specs/M2-logs Phase 7·8 완료와 openQuestion 해소(priority 다운그레이드 불필요) 기록.",
  },
  {
    date: "2026-06-29",
    shas: ["eb3a0d3"],
    type: "문서",
    scope: "docs",
    title: "로드맵 조정 — M3 흡수·M4 보류(ADR-0012)",
    summary:
      "M1·M2 라이브 후 사용자 결정 — M3(여유 리소스)는 Overview와 데이터원이 같아 Overview 확장으로 흡수, M4 정식 incident 추적은 5서버엔 과해 보류(M2 신호뷰로 충족). 다음 착수는 새 마일스톤보다 M1/M2 심화.",
  },

  // ── 2026-06-29 ──────────────────────────────────────────────
  {
    date: "2026-06-29",
    shas: ["90ce475"],
    type: "문서",
    scope: "specs",
    title: "M3 여유 리소스 spec(WHAT/WHY)",
    summary:
      "M1 메트릭을 재사용한 free/busy 판정 + 작업배치 추천 스펙. §I-2 준수(네이티브 판정뷰, 상세는 Grafana 드릴다운), no-data/GPU없음=판정불가라는 정직성 원칙, ADR-0012 흡수 방향.",
  },
  {
    date: "2026-06-29",
    shas: ["b5e6e18"],
    type: "문서",
    scope: "specs",
    title: "M3 plan + ADR-0013 판정정책",
    summary:
      "실측 PromQL·이산등급 판정식·타입·Overview 통합·검증 계획. ADR-0013: GPU·일반 2축 분리, VRAM이 GPU 여유의 binding(util≠여유), 임계 8개 보수적, 무데이터=unknown(거짓 여유 금지).",
  },
  {
    date: "2026-06-29",
    shas: ["ebc9479"],
    type: "신규",
    scope: "console",
    title: "M3 여유 리소스 데이터 레이어(ADR-0013)",
    summary:
      "Verdict·GpuCapacity 등 타입, capacity-policy(임계 8개), prometheus.queryCapacity(CPU busy·mem avail·DCGM util·VRAM free% 병렬질의), resolveFleetCapacity·recommendGpuPlacement 구현 — GPU binding=가용 VRAM, 무데이터=unknown(거짓 여유 금지 US4). 검증: 테스트 20/20, 라이브 data04=free 78%·data05=busy 32%.",
  },
  {
    date: "2026-06-29",
    shas: ["3b6db0a"],
    type: "신규",
    scope: "console",
    title: "M3 여유 리소스 UI — Overview 통합",
    summary:
      "capacity-badge(free/busy/full/unknown 배지), GPU 배치 추천 배너(기준 임계 노출 UR4, 여유없음 정직 표기), node-card·fleet-strip에 GPU·일반 여유 배지, overview 병렬 fetch. typecheck·lint·test 20/20·secrets·no-raw-hex 통과.",
  },
  {
    date: "2026-06-29",
    shas: ["e67065a"],
    type: "개선",
    scope: "console",
    title: "Overview 컴팩트화 — 카드 축소·메트릭 확대",
    summary:
      "사용자 요청 — 위 서버 카드 5개를 줄이고(node-card id+ip 한 줄, role 생략, p-2.5) 세로 gap-2로 flex-1 메트릭 임베드가 더 큰 영역을 차지하게 조정.",
  },
  {
    date: "2026-06-29",
    shas: ["f3bd90f"],
    type: "인프라",
    scope: "monitoring",
    title: "gpu-model-exporter 소스 버전관리(§11 복구)",
    summary:
      "모델↔GPU 매핑 익스포터(:9836, gpu_model_vram_bytes)가 레포 밖(MineSweeper)에서 PM2로만 실행돼 호스트 재구성 시 소실 위험 — KEIwi 레포로 미러링(라이브와 diff 0, stdlib만), systemd 유닛·README 추가. LLM어시스턴트 설계 워크플로 비평이 검증한 최우선 §11 위반 복구.",
  },
  {
    date: "2026-06-29",
    shas: ["7f9976b"],
    type: "문서",
    scope: "specs",
    title: "로그 어시스턴트 spec(WHAT/WHY, MVP)",
    summary:
      "설계 비평이 깎은 MVP — 읽기전용·인용강제·무의존성, 로컬 vLLM + OpenSearch RAG로 에러→근거 진단→기존 런북 연결. fix생성/자동적용/벡터DB/에이전트/능동알림은 비범위. 정직성: \"기존 /logs 대시보드를 실제 이기는가\"를 수용기준에 포함.",
  },
  {
    date: "2026-06-29",
    shas: ["cfb7c95"],
    type: "문서",
    scope: "specs",
    title: "어시스턴트 plan + ADR-0014",
    summary:
      "무의존성 BFF(fetch만)·인용 서버검증(번호근거)·시크릿 스크럽·인젝션 격리·on-demand GPU 설계. ADR-0014: 로컬 vLLM·읽기전용·자동적용 영구보류·no-vector/no-DB/no-agent(measure-first)·KB=레포 런북 SoT·/incidents 거주.",
  },
  {
    date: "2026-06-29",
    shas: ["fa5356e"],
    type: "신규",
    scope: "console",
    title: "로그 어시스턴트 라이브러리(Phase 3)",
    summary:
      "무의존성(fetch만) RAG 라이브러리 — searchLogs(BM25+필터, 읽기전용)·vllm.chat·scrubSecrets·buildPrompt(인젝션 격리·번호근거)·answerError. 인용은 서버 제공 번호로 날조 차단. 테스트 34/34 통과, 라이브에서 실제 containerd/docker CNI 에러를 로컬 vLLM이 정확 진단(외부 egress 0).",
  },
  {
    date: "2026-06-29",
    shas: ["f4a3580"],
    type: "신규",
    scope: "console",
    title: "어시스턴트 BFF·UI·KB — /incidents 전용 탭",
    summary:
      "/api/assistant(GPU 경합 방지 동시 1건·429, MVP 비스트리밍), current-signals(최근 error+warn + 행별 '분석'), assistant-panel(질의·인용응답·근거·런북·aria-live·prefill 자동분석), /incidents를 어시스턴트 전용 탭으로 전환, 런북 frontmatter 로더 KB. 테스트 34/34.",
  },
  {
    date: "2026-06-29",
    shas: ["31953fe"],
    type: "신규",
    scope: "console",
    title: "어시스턴트 탐색형 질의(질의계획, ADR-0015)",
    summary:
      "자유질의가 error/warn 잠금 + 영문 BM25라 한국어 질문에 무력하던 것을 해소 — facets(노드/서비스/카테고리 terms agg, 60s 캐시)로 환각 차단 그라운딩, 질의계획 생성·패싯검증·결정적 폴백·탐색 오케스트레이터 구현. 라이브 end-to-end 증명: \"docker 경고 왜?\"→계획→근거 33건→인용답변. 테스트 46/46(+12).",
  },
  {
    date: "2026-06-29",
    shas: ["31953fe"],
    type: "사건",
    scope: "console",
    title: "신호 패널 UFW 도배로 0건 — 노이즈 제외 수정",
    summary:
      "현재신호 패널이 UFW BLOCK(5,550/일)에 도배돼 클라이언트 후필터 후 0건('신호없음')으로 진짜 신호 8건이 묻힘 — searchLogs에 excludeNoise(rsyslog·UFW must_not)를 넣어 쿼리단에서 제외하고 24h/size12로 실제 신호 노출.",
    incident: true,
  },
  {
    date: "2026-06-29",
    shas: ["60ef66a"],
    type: "사건",
    scope: "monitoring",
    title: "GPU 드릴다운을 노드별 DCGM 대시보드로 분리",
    summary:
      "data04 클릭 시 GPU 탭에 data05가 뜨는 증상 — 근본원인은 var 버그가 아니라 데이터 부재(GPU 탭이 data05 전용 gpu-model-exporter 기반 대시보드를 임베드, 모델↔GPU 메트릭이 전부 data05). ADR-0016: GPU 탭=keiwi-gpu(DCGM :9400, instance 변수 multi+includeAll), 모델 탭=data05 전용으로 분리. data04 클릭=RTX6000 ×2 정확 표시 검증.",
    incident: true,
  },
  {
    date: "2026-06-29",
    shas: ["93446c4"],
    type: "사건",
    scope: "monitoring",
    title: "모델 탭 소실 — repo 프로비저닝 대시보드로 대체",
    summary:
      "모델 탭이 'Dashboard not found' — gpu-models-ver2가 Grafana UI 수제 대시보드라 docker restart(컨테이너 재생성) 때 DB와 함께 소실된 것이 원인(파일 프로비저닝 대시보드는 생존). repo의 model-workload.json(uid keiwi-model-workload)로 대체, 실데이터(Qwen3-Coder gpu0/Qwen2.5-VL gpu1/ollama·토큰·KV캐시·DCGM) 렌더 검증. 교훈: 임베드 대시보드는 repo 원본(§12).",
    incident: true,
  },
  {
    date: "2026-06-29",
    shas: ["9022ef1"],
    type: "개선",
    scope: "console",
    title: "모델 탭 '플릿 전체' 안내 — 혼동 차단",
    summary:
      "모델 탭(keiwi-model-workload)은 노드 스코프를 주입하지 않는 플릿 전체 뷰라 data04를 눌러도 data05 모델이 보여 혼동 — 탭 라벨이 '모델'일 때 상단에 \"플릿 전체 — 노드 선택과 무관\" 한 줄 안내 표시(ADR-0016 일관).",
  },

  // ── 2026-06-30 ──────────────────────────────────────────────
  {
    date: "2026-06-30",
    shas: ["6deeceb"],
    type: "사건",
    scope: "console",
    title: "어시스턴트 신호별 재분석 수정 + 기능테스트",
    summary:
      "다른 신호를 눌러도 항상 같은(첫 신호) 답·근거 0건 — 원인 ①fired useRef가 첫 분석 후 굳어 같은 라우트 navigate 시 remount 안 됨(신호 식별 key로 remount 강제), ②원시 메시지를 query_string으로 넣어 콜론·따옴표가 깨지고 창이 now-6h라 근거 0건(service+node+level+24h+excludeNoise로 변경). 라이브에서 두 서비스 각각 근거 3건 확인, Playwright 회귀 가드(assistant-func-test.mjs) 추가.",
    incident: true,
  },
  {
    date: "2026-06-30",
    shas: ["231911c"],
    type: "인프라",
    scope: "console",
    title: "어시스턴트 기능테스트 안정화",
    summary:
      "waitForResponse(/api/assistant)로 답변·근거를 authoritative하게 수집하고 waitForFunction 옵션 버그(2번째 인자) 수정. 프로덕션 빌드 기준 서로 다른 두 신호가 다른 근거·다른 답변임을 확인(동일답변 버그 회귀가드) PASS.",
  },
  {
    date: "2026-06-30",
    shas: ["705d4e0"],
    type: "인프라",
    scope: "infra",
    title: "노드 온보딩 표준 + gpu-model-exporter role(ADR-0017)",
    summary:
      "노드 추가/삭제/변경 표준 수립 — SoT=docs/inventory.yaml, 에이전트=Ansible role, §11 사람 적용, 오프보딩 절차 포함(ADR-0017), node-onboarding 런북 신설(신규 노드 관리의 단일 진입점). gpu-model-exporter role 신설로 data05 PM2 드리프트를 systemd로 수렴, data04 적용 시 모델 탭에 data04 모델 노출(B04 해소 경로).",
  },
  {
    date: "2026-06-30",
    shas: ["1fc1f59"],
    type: "문서",
    scope: "specs",
    title: "서비스 맵 v1 설계(specs/service-map)",
    summary:
      "노드별 운영 카탈로그 — 서비스/GPU모델/알려진포트 한 표 + 행→로그·진단 딥링크. v1은 신규 수집 0(OpenSearch service 패싯·Prometheus gpu_model_*·inventory 재사용), 포트→프로그램 전수 수집기는 v2 백로그. IA(Overview 탭 vs /service-map)는 사용자 합의 대기(T002).",
  },
  {
    date: "2026-06-30",
    shas: ["30daa95"],
    type: "문서",
    scope: "infra",
    title: "온보딩 — NOPASSWD 아닌 노드는 -K 필요 명시",
    summary:
      "data04 user5가 NOPASSWD sudo가 아니라 ansible become이 'Missing sudo password'로 실패 — agents.yml 적용 명령에 -K(--ask-become-pass)를 런북 §3과 playbook 주석에 추가.",
  },
  {
    date: "2026-06-30",
    shas: ["3e0b08d"],
    type: "수정",
    scope: "infra",
    title: "gpu-model-exporter role check 모드 가드",
    summary:
      "--check 드라이런에서 가드가 스킵돼 유닛 미작성 상태로 systemctl 기동이 'Could not find service'로 실패하던 것 보강(nvidia-smi check_mode:false, start는 not check_mode). 실적용은 정상이었음.",
  },
  {
    date: "2026-06-30",
    shas: ["46b5433"],
    type: "수정",
    scope: "monitoring",
    title: "gpu-exporter 모델 탐지 강화",
    summary:
      "data04 검증에서 발견 — python -m vllm...api_server --model X 형식을 기존 'vllm serve' 매칭이 놓쳐 unknown 처리 → --model/--served-model-name/serve 모두 인식 + 런처 부모 6단계 등반으로 수정. vllm/ollama가 아닌 GPU 프로세스(uvicorn RAG API 등)는 unknown 대신 앱명+포트(예: 04_rag_api/uvicorn/9001)로 표기. 실제 data04 cmdline 4종 파싱 정확 검증.",
  },
  {
    date: "2026-06-30",
    shas: ["6fa51ed"],
    type: "인프라",
    scope: "monitoring",
    title: "data04 모델을 모델 탭까지 배선",
    summary:
      "ADR-0017 §3 완성 — data04 gpu-model-exporter(:9836)를 콘솔 모델 탭에 노출. 터널에 192.0.2.201:9837 포워딩 추가, prometheus gpu-model-exporter job에 node 라벨(data05)과 data04 타깃(node=data04) 부여, model-workload.json에 node 템플릿 변수(multi+All)와 {node=~$node} 필터 적용.",
  },
  {
    date: "2026-06-30",
    shas: ["9e3c9c1"],
    type: "문서",
    scope: "docs",
    title: "README·AGENTS 리치 재작성",
    summary:
      "상태 테이블·아키텍처/파이프라인 Mermaid·GitHub 알림 콜아웃·레포 트리·문서지도·ADR 0001~0017 색인·콘솔 화면표·로드맵 간트로 README를 재작성(사실은 모두 현행화, data04 모델 노출 반영). AGENTS도 마일스톤 현행화(M1/M2 라이브)·런북 링크 정리, 링크 대상 전수 존재 확인.",
  },
  {
    date: "2026-06-30",
    shas: ["99138cf"],
    type: "인프라",
    scope: "infra",
    title: ".pyc 추적 해제 + __pycache__ gitignore",
    summary:
      "exporter py_compile로 생성된 .pyc가 레포에 추적되던 것 제거(빌드 산출물은 레포 밖).",
  },
  {
    date: "2026-06-30",
    shas: ["4973a56"],
    type: "신규",
    scope: "console",
    title: "서비스맵 Phase 1 — 노드 서비스 카탈로그 라이브러리",
    summary:
      "Overview 네이티브 '서비스' 탭(T002)을 위한 라이브러리 층. 신규 수집 0으로 기존 OpenSearch/Prometheus 재사용 — service-catalog.ts(서비스 집계·카테고리·error/warn, 노이즈 제외), queryGpuModels(gpu_model_vram_bytes→모델·GPU·포트·VRAM, PromQL 주입 가드), known-endpoints 참조. 테스트 57/57(+11).",
  },
  {
    date: "2026-06-30",
    shas: ["0e928cf"],
    type: "신규",
    scope: "console",
    title: "Overview 노드 드릴다운에 네이티브 '서비스' 탭",
    summary:
      "ServiceTable(서버 컴포넌트)로 노드 서비스 카탈로그+GPU 적재 모델+알려진 포트 주석을 표시하고, 행 클릭 시 /incidents 어시스턴트(로그·진단)로 연결. grafana-tabs를 통합 탭 모델(서비스 네이티브+Grafana)로 확장, 노드 선택 시 '서비스' 탭 기본 활성.",
  },
  {
    date: "2026-06-30",
    shas: ["e473213"],
    type: "문서",
    scope: "docs",
    title: "서비스맵 Phase 4 검증 — Playwright PASS",
    summary:
      "격리 프로덕션 빌드 Playwright로 드릴다운 탭 [서비스·시스템·GPU·모델] 및 data04 Qwen2.5-14B·04_rag_api·로그진단 링크 렌더 확인(에러 0). README 콘솔 화면표에 서비스 탭 반영 — 서비스맵 v1 완료.",
  },
  {
    date: "2026-06-30",
    shas: ["cc383a1"],
    type: "문서",
    scope: "docs",
    title: "monitoring·logging·ansible README 리치 재작성",
    summary:
      "상태표·Mermaid·GitHub 콜아웃·교차링크 스타일로 인프라 README 3종을 재구성하며 모든 절차 보존 — 수집현황 표(data04 node·dcgm·gpu-model 라이브), Ansible role 2종+[gpu] 그룹, 로그 템플릿 선적용 순서·레이스·reindex·ISM·노이즈 정책 유지. 교차링크 전수 검증.",
  },
  {
    date: "2026-06-30",
    shas: ["229bf0f"],
    type: "개선",
    scope: "console",
    title: "브랜드 마크 교체 — 노드망+회로 트레이스 로고",
    summary:
      "키위 단면 로고를 좌상 녹색(모니터링 허브-스포크 노드망)/우하 파랑(PCB 회로 트레이스) 분할 마크로 교체 — 'KEI Wired Interface' 은유. 인라인 SVG(브랜드 토큰, raw hex 0)라 36px 헤더 소형·테마 전환에서도 또렷.",
  },
  {
    date: "2026-06-30",
    shas: ["79b3f39"],
    type: "신규",
    scope: "console",
    title: "새 마크 favicon(icon.svg) + OG 이미지·메타",
    summary:
      "app/icon.svg 파비콘(옛 favicon.ico 제거), next/og로 마크+타이틀 OG 이미지(1200x630, 영문 텍스트로 tofu 방지), layout metadata(metadataBase·title 템플릿·openGraph) 추가. 외부 링크 언퍼는 Cloudflare Access 우회가 별도 필요.",
  },
  {
    date: "2026-06-30",
    shas: ["47b0d81"],
    type: "개선",
    scope: "console",
    title: "elevation 토큰 도입 — 표면 입체감·여백",
    summary:
      "그림자 0·전부 보더라 평면적이던 진단을 해결 — Figma Foundation elevation을 --shadow-1/2/3 토큰으로 반영(다크는 약화, 면 대비 주도). 노드 카드 rounded-xl+호버 리프트, 패널·top-bar에 shadow-1, 노드 그리드 gap 2→3.",
  },
  {
    date: "2026-06-30",
    shas: ["58bf0d1"],
    type: "문서",
    scope: "docs",
    title: "testing.md 재작성 + docs/README 인덱스 허브 신설",
    summary:
      "테스트 가이드를 한눈 표(단위·정적·시각·기능)+격리 빌드 절차(worktree+하드링크 node_modules, dev HMR 헤드리스 충돌 회피)로 정리. docs/README.md를 신설해 SDD specs·ADR 0001~0017·런북·인프라·디자인·테스트 문서의 인덱스 허브로. 링크 대상 전수 검증.",
  },

  // ── 2026-07-01 ──────────────────────────────────────────────
  {
    date: "2026-07-01",
    shas: ["1a69580"],
    type: "신규",
    scope: "monitoring",
    title: "port-exporter — 포트→프로세스 수집기(서비스맵 v2)",
    summary:
      "\"어느 포트에 무슨 프로그램\"의 완성 — ss -tulnpH 파싱으로 keiwi_listening_port_info{port,proto,process,pid} 노출하는 경량 exporter(stdlib·root). Ansible role+prometheus 잡(node 라벨 data05/04)+터널 9987 포워드까지 배선, 실 ss 데이터로 파싱 검증.",
  },
  {
    date: "2026-07-01",
    shas: ["1a69580"],
    type: "신규",
    scope: "console",
    title: "서비스 탭 '리스닝 포트' 섹션",
    summary:
      "queryListeningPorts(포트순)로 포트·프로토콜·프로세스+known-endpoint 라벨을 ServiceTable에 표시. typecheck·lint·test 57 통과, 라이브 데이터는 배포 후 확인(§11).",
  },
  {
    date: "2026-07-01",
    shas: ["6212328"],
    type: "인프라",
    scope: "infra",
    title: "agents.yml 태그 분리 — 선택 배포",
    summary:
      "--tags port로 port-exporter만 배포할 수 있게 태그(gpu-model·port)를 추가 — data05에서 gpu-model systemd가 PM2와 겹치는 충돌 회피.",
  },
  {
    date: "2026-07-01",
    shas: ["e934245"],
    type: "문서",
    scope: "specs",
    title: "서비스맵 v2.1 재설계 스펙 — 라이브 피드백 5건",
    summary:
      "라이브 사용 피드백을 spec-first로 결정: ①서비스 탭 항상 존재·기본 활성 ②model+framework 집계로 모델 중복 제거 ③리스닝 포트 주 패널화 ④로그기반 서비스 목록 제거(어시스턴트와 중복) ⑤2컬럼(Notion형) 조밀 레이아웃. spec 수용기준·plan·tasks(R01~R06) 갱신.",
  },
  {
    date: "2026-07-01",
    shas: ["981e434"],
    type: "개선",
    scope: "console",
    title: "서비스맵 v2.1 UI — 2컬럼·모델집계·포트 주패널",
    summary:
      "R01~R05 구현 — 서비스 탭 항상 존재·기본 활성, aggregateGpuModels(순수)로 중복 제거(GPU 목록·합계 VRAM, 테스트 6 추가), 좌 GPU 프로세스/우 리스닝 포트 2컬럼, 포트 행 클릭→/incidents 진단. 테스트 63 통과.",
  },
  {
    date: "2026-07-01",
    shas: ["6dc3d01"],
    type: "문서",
    scope: "specs",
    title: "서비스맵 v2.1 tasks R01~R06 완료 기록",
    summary: "R01~R06 완료를 Playwright 검증과 함께 스펙에 기록.",
  },

  // ── 2026-07-02 ──────────────────────────────────────────────
  {
    date: "2026-07-02",
    shas: ["d423f7f"],
    type: "사건",
    scope: "console",
    title: "내부(IP) 접속 시 Grafana 로그인 무한 루프 해결",
    summary:
      "원인 — GRAFANA_URL((외부 도메인 — 비공개)) 고정 탓에 IP(192.0.2.105:3105) 접속 시 iframe이 크로스 사이트가 되어 SameSite=Lax 세션 쿠키가 서드파티로 거부, 로그인 성공해도 쿠키가 안 남아 무한 루프. resolveGrafanaBase()로 접속 Host가 같은 사이트면 설정값, 아니면 http://<host>:3000(same-site) 임베드로 분기. 단위 테스트 11종+Playwright 회귀 가드.",
    incident: true,
  },
  {
    date: "2026-07-02",
    shas: ["7c2ae2b"],
    type: "신규",
    scope: "console",
    title: "로그 워크벤치 — /logs 어시스턴트 드로어 통합",
    summary:
      "업계 패턴 리서치(Elastic/Grafana/Datadog/New Relic 등) 결론 \"상주 패널+데이터 지점 인라인 진입점\" 2계층을 기존 부품으로 조립 — 우측 접이식 드로어(24h error·warn 신호 12건+어시스턴트), 신호 클릭 인플레이스 자동 분석, 근거 로그→iframe 시간창 ±5분 딥링크, Ctrl/Cmd+I 토글. 탭 순서는 시스템·GPU·모델·서비스(기본=시스템)로 개정. Playwright 기능 테스트 16/16.",
  },
  {
    date: "2026-07-02",
    shas: ["094ff64"],
    type: "개선",
    scope: "console",
    title: "KRDS v2 크래프트 패스 — 브랜드 초록 원복·규격 정합",
    summary:
      "--color-brand를 정부블루에서 우리 초록(#38B38D)으로 원복(로고·메인색 유지 원칙), KRDS 더블 포커스 링(내부 2px+외부 4px), 카드 반경 12→10px·입력/버튼 small 40px·터치 타깃 등 규격 정합, H1 32px·섹션 19px 위계 리듬과 노드 카드 콤팩트화.",
  },
  {
    date: "2026-07-02",
    shas: ["094ff64"],
    type: "문서",
    scope: "specs",
    title: "이식형 디자인 시스템 스펙 9종(specs/design)",
    summary:
      "KRDS 레포·krds.go.kr 심층 조사 기반의 프레임워크 중립 이식형 스펙 9종(원칙·파운데이션 px/hex·브랜드 규칙·컴포넌트 규격·패턴·접근성·구현·변경이력)을 신설.",
  },
  {
    date: "2026-07-02",
    shas: ["15a805d"],
    type: "사건",
    scope: "monitoring",
    title: "대시보드 소실 사고 — 프로비저닝 바인드로 재발 방지",
    summary:
      "docker cp로 주입한 대시보드가 컨테이너 재생성 시 소실되는 사고 발생(2026-07-02, keiwi-gpu·model-workload·logs 소실→복구). 프로비저닝 바인드 마운트 표준(docker-compose.yml 권장본 신규)+복구 절차 문서화로 재발 방지, 관리자 비번은 .env 분리(§13)·env는 최초 init만 유효 주의 기록.",
    incident: true,
  },
  {
    date: "2026-07-02",
    shas: ["15a805d"],
    type: "인프라",
    scope: "monitoring",
    title: "Grafana 익명 뷰어 + GPU 대시보드 노드 구분",
    summary:
      "GF_AUTH_ANONYMOUS(Viewer, LAN 조회 전용) 영구화. DCGM 메트릭에 이중 label_replace(instance→node)로 범례에 노드 구분(\"data05 · GPU 0\"), 모델↔GPU 매핑 테이블에 노드 컬럼+VRAM 내림차순.",
  },
  {
    date: "2026-07-02",
    shas: ["7422856"],
    type: "문서",
    scope: "docs",
    title: "콘솔 화면표·테스트 가이드·SRE 백로그 갱신",
    summary:
      "README 화면표에 /logs 워크벤치(드로어·딥링크·Ctrl+I)·드릴다운 탭 순서 반영, testing.md에 워크벤치·임베드 host 분기 기능 테스트 등재(헤드리스 Ctrl+I 한계 포함). specs/sre-addons/backlog.md — 4각도 웹 리서치(신뢰성·리소스관리·GPU관측·커리어) 종합 Tier별 후보.",
  },

  // ── 2026-07-03 ──────────────────────────────────────────────
  {
    date: "2026-07-03",
    shas: ["e8a0f76"],
    type: "인프라",
    scope: "infra",
    title: "data03 온보딩 완료 + sudo NOPASSWD 표준화",
    summary:
      "data03(192.0.2.103, GPU 없음)을 런북 ADR-0017 표준 절차로 완전 온보딩 — node/port-exporter 직접 스크랩(같은 서브넷이라 data04와 달리 터널 불필요), filebeat 배포로 fleet_node:data03 7.9k건 유입 확인, 콘솔 카드 \"정상\". 런북 부록에 sudo 자동화 표준(A안 NOPASSWD 권장) — data03·data04 적용으로 -K 프롬프트 제거.",
  },
  {
    date: "2026-07-03",
    shas: ["8c86a01"],
    type: "인프라",
    scope: "infra",
    title: "data03 GPU 평면 온보딩 — Quadro RTX 6000 x2",
    summary:
      "인벤토리 gpu:null로 빠져 있던 GPU 평면을 lspci로 확인(TU102GL RTX 6000 x2) 후 온보딩 — 드라이버 535.309.01(data04 동일)+nvidia-container-toolkit+dcgm-exporter 컨테이너, gpu-model-exporter role 배포, node 라벨은 스크랩단 부여(IP 하드코딩 label_replace는 레거시). 검증: DCGM GPU 0/1 up, 콘솔 GPU 배지(VRAM 99%), GPU 배치 추천 1순위 data03 전환.",
  },
  {
    date: "2026-07-03",
    shas: ["c231a0e"],
    type: "문서",
    scope: "docs",
    title: "전 문서 최신화 — data03 실전 교훈 매뉴얼 승격",
    summary:
      "data03 온보딩(2026-07-03)에서 검증된 명령·교훈을 런북으로 승격 — 계정명 확인 선행(ls /home, 가정 금지), sudoers 원격 원라이너(ssh -t 필수, 로컬 오실행 사고 경고), 직접 스크랩 vs 터널 결정 기준, GPU 표준 절차, -K 폐지. ADR-0017 개정 노트, README·AGENTS(플릿 3정상·GPU 6장)·infra README·specs 상태 정합 스윕(교차 감사 통과).",
  },
  {
    date: "2026-07-03",
    shas: ["68871c8"],
    type: "개선",
    scope: "console",
    title: "콘텐츠 우선 레이아웃 — 임베드 67.3% 확보",
    summary:
      "\"노드 카드는 얇은 스트립, Grafana가 잘 보여야\"는 사용자 스케치 기반 전면 개선 — 섹션 헤더를 슬림 툴바 1줄로, 노드 카드 초콤팩트(59px, ip/os는 툴팁·aria-label 보존), H1 32→24px. Playwright 실측 overview 임베드 67.3%(목표 65%, 기존 ~45%)·logs 75.8%. specs/design에 관제(NOC) 밀도 예외·콘텐츠 ≥60% 원칙 명문화, 감사 모호점 3건 전건 해소.",
  },
  {
    date: "2026-07-03",
    shas: ["e1a001e"],
    type: "신규",
    scope: "monitoring",
    title: "익스포터 user 라벨 — 모델·서비스 소유 계정 귀속",
    summary:
      "\"이 모델/서비스 누구 거냐\" 문의 대처(SRE 백로그 #8 v1) — gpu-model·port-exporter가 /proc/<pid>/status Uid→pwd.getpwuid로 PID 소유 OS 계정을 user 라벨로 노출(unknown/uid:N/root 폴백, 신규 권한 0). 라이브 파스 검증: 실제 Qwen 모델 user=\"mooner92\".",
  },
  {
    date: "2026-07-03",
    shas: ["e1a001e"],
    type: "신규",
    scope: "console",
    title: "서비스 탭·대시보드에 소유자 표시",
    summary:
      "GPU 프로세스·리스닝 포트 행에 소유자 표시, aggregateGpuModels dedup 키에 user 포함(소유자 다르면 분리). Grafana 모델↔GPU 테이블에 \"소유자\" 컬럼. specs/ownership-attribution 스펙(계약·AC·후속 백로그 CMDB/유휴탐지/showback) 신설, 테스트 75 통과.",
  },
  {
    date: "2026-07-03",
    shas: ["19d3d10"],
    type: "문서",
    scope: "docs",
    title: "SRE 백로그 #8 사용자별 귀속 v1 완료 표시",
    summary: "sre-addons 백로그에 #8 완료를 기록.",
  },

  // ── 2026-07-04 ──────────────────────────────────────────────
  {
    date: "2026-07-04",
    shas: ["ae98e69"],
    type: "개선",
    scope: "console",
    title: "노드 카드 VRAM 절대수치 + 워크벤치 3:1·신호 시각",
    summary:
      "사용자 피드백 3건 — GPU 배지를 등급 단어(\"바쁨\")에서 절대값(\"37/48 GiB\")으로(DCGM FB_USED/TOTAL 노드 합산, 색 등급은 유지·단어는 툴팁, 없으면 VRAM% 폴백), 워크벤치 임베드:어시스턴트 4:1→3:1, 신호 목록에 KST 발생 시각(고정 오프셋으로 하이드레이션 안전). Playwright 실측 data04 37/48·data05 70/89.",
  },
  {
    date: "2026-07-04",
    shas: ["ef1829c"],
    type: "개선",
    scope: "console",
    title: "로그 워크벤치 v2 — 1:1·필터 칩·내비 일원화",
    summary:
      "임베드:어시스턴트 3:1→1:1(어시스턴트 활용 우선), ERROR/WARN·노드 필터 칩이 신호 목록과 Grafana 임베드 변수(var-fleet_node·var-log_level)를 동시 구동(EmbedTimeOverride 확장, logs size 12→60). 좌측 내비에서 \"어시스턴트\" 제거(통합로그 일원화), /incidents는 \"전체 화면에서 계속\" 딥링크 전용 존치. Playwright 22/22(목록 60→42 필터 실측).",
  },
  {
    date: "2026-07-04",
    shas: ["0806c26"],
    type: "문서",
    scope: "alerting",
    title: "알림 정책 스펙 v1.1 + 플랫폼 로드맵",
    summary:
      "\"무엇에·언제·어디로 알릴지\" 단일 기준 — 5원칙(증상기반·actionable·페이지 4조건), SEV 3단계, 판정 4질문 게이트, 카탈로그(가용성·GPU헬스·포화·vLLM·로그·스택자기건강), 노이즈 억제(for·dedup·inhibition·burn-rate), 채널(SEV1 ntfy폰/SEV3 이메일). 적대적 검토 반영: dead man's switch(data05 SPOF)·터널down blackbox ICMP 재정의·XID 분기·no-data(data01/02) 오알림 차단. SRE 실무·연구원 IDP Phase 1→5 로드맵도 신설.",
  },

  // ── 2026-07-06 ──────────────────────────────────────────────
  {
    date: "2026-07-06",
    shas: ["d64063b"],
    type: "문서",
    scope: "specs",
    title: "메트릭 수집 확장 추천 — 7 사각지대 리서치",
    summary:
      "sysadmin+SRE 4각도 리서치로 7 사각지대(HW건강·전원·OS위생·단명job·GPU효율·에너지·장기보존)를 Tier 표로 정리. 핵심은 대부분 '이미 있는 걸 켜기'(node-exporter textfile/systemd·Grafana12 번들·recording rules 0), 연구실 급소는 단명job 계정·GPU MFU·에너지 showback.",
  },
  {
    date: "2026-07-06",
    shas: ["1384de5"],
    type: "수정",
    scope: "monitoring",
    title: "시스템 탭 Forbidden(403) 근본 해결 — 익명 대시보드",
    summary:
      "UI 임포트 node-exporter-full이 익명 뷰어에서 403이던 문제를 프로비저닝 대시보드 system.json(uid keiwi-system, datasource/instance/nodename 변수)으로 대체 — GPU/로그 탭처럼 익명 렌더.",
  },
  {
    date: "2026-07-06",
    shas: ["1384de5"],
    type: "인프라",
    scope: "monitoring",
    title: "수집 켜기 — node-hygiene·smartctl·recording rules",
    summary:
      "metrics-collection 스텝1(알림 0, 수집·시각화만) — node-exporter textfile+systemd 수집기(보안업데이트·reboot-required 위생 스크립트+timer), smartctl-exporter role(:9633, 바이너리는 사람이 오프라인 벤더링·egress 0·pre-flight assert), recording rule 12개(CPU/mem/fs/predict_linear 24h/net/io/systemd-failed), syshealth 대시보드(메트릭 부재 안전). jq·yaml·syntax-check 통과, 콘솔 무변경.",
  },
  {
    date: "2026-07-06",
    shas: ["b09c52a"],
    type: "문서",
    scope: "specs",
    title: "AIOps 리서치 — 챗 어시스턴트 너머 AI 투입 방식",
    summary:
      "4각도 종합 결론 — ①이상탐지는 통계·결정적 룰이 정석(LLM 아님, DeepLog류 실증 우위 없음) ②첫 수는 잠자는 자산 활성화(OpenSearch RCF·DCGM 전조 룰) ③KEIwi 엣지는 유휴 GPU 배치 LLM 한계비용 0(Drain3·야간 다이제스트·임베딩 인시던트 메모리 등) ④게이트: 비지도 출력→다이제스트만, 페이징→결정적 룰만(1인 SRE 소음 방지). 기각 근거 명시(text-to-PromQL 69%·vmanomaly 유료 등).",
  },

  // ── 2026-07-09 ──────────────────────────────────────────────
  {
    date: "2026-07-09",
    shas: ["bca7daf"],
    type: "인프라",
    scope: "monitoring",
    title: "AIOps Tier1 착수 — RCF 관찰모드 + z-score 밴드",
    summary:
      "OpenSearch RCF detector 'keiwi-log-errors-by-node' 생성·시작(RUNNING, fleet_node별 HC, 10m 간격) — 알림 미연결 관찰 모드, 정의 JSON+README는 레포가 원본. CPU/mem/GPU util z-score 밴드(±3σ, 1h) recording 12개(대시보드 오버레이 전용, alert 0). node-hygiene(data03/04) 라이브 적용 — 첫 수집 발견: data04 reboot 대기+보안업데이트 57건, data03 31건.",
  },

  // ── 2026-07-24 ──────────────────────────────────────────────
  {
    date: "2026-07-24",
    shas: ["e90738a"],
    type: "인프라",
    scope: "infra",
    title: "data01 온보딩(메트릭) — 16.04 호환 어댑테이션",
    summary:
      "data01(Ubuntu 16.04 EOL·py3.6·공유서버 50+계정·Tesla M4 x1) 온보딩 — apt 0.11 대신 모던 node_exporter 1.8.2 바이너리+systemd, 익스포터 py3.6 호환 패치(capture_output→PIPE 등, 플릿 전체 무해), port-exporter 313포트+user 라벨 가동, nvidia-smi persistence로 418 드라이버 콜드콜 지연 해소. DCGM은 드라이버 418로 불가(문서화). smartctl_exporter 0.14.0 벤더링으로 전 플릿 블로커 해소(data03 가동, data01은 smartmontools 6.4 JSON 미지원 제외).",
  },
  {
    date: "2026-07-24",
    shas: ["4267845"],
    type: "개선",
    scope: "console",
    title: "GPU 배지 gpu-model 폴백 — DCGM 없는 GPU도 표시",
    summary:
      "DCGM 불가 GPU(data01 Tesla M4·드라이버 418)는 용량 판정이 DCGM 전용이라 배지가 안 떴음 — gpu-model-exporter의 gpu_vram_total/used_bytes로 폴백해 VRAM 배지 렌더(source:\"gpu-model\"). GPU 배치 추천에서는 폴백 제외(util 미상 소용량 M4가 1순위 되는 것 방지). 테스트 78(폴백 3케이스).",
  },
  {
    date: "2026-07-24",
    shas: ["00426e2"],
    type: "수정",
    scope: "monitoring",
    title: "GPU 대시보드 범례 간결화 — 게이지 잘림 해소",
    summary:
      "범례를 {{node}} · GPU {{gpu}}로 줄여 작은 게이지 6개에서 'NVIDIA A40'/'Quadro RTX 6000' 모델명이 잘리던 문제 해소. 모델명은 노드로 이미 구분(data03/04=RTX6000·data05=A40)되고 하단 HW 스펙 표에 유지.",
  },
  {
    date: "2026-07-24",
    shas: ["2e28113"],
    type: "인프라",
    scope: "logging",
    title: "data01 로그 수집 — xenial filebeat 7.17 벤더링",
    summary:
      "Ubuntu 16.04(glibc 2.23)는 8.x apt filebeat 불가 → 7.17.28 정적 바이너리 벤더링(systemd keiwi-filebeat)으로 journald→data05 Logstash 수집. seek fallback:tail로 3.8G 과거 재적재 차단, Logstash가 7.x journald.* 중첩 필드 정규화(라이브 적재·필드 결측 0 확인). [logging] apt role 그룹엔 미포함(xenial에서 깨짐).",
  },
  {
    date: "2026-07-24",
    shas: ["8b3dd03"],
    type: "문서",
    scope: "docs",
    title: "브랜치 전략 문서 + 벤더링 gitignore",
    summary:
      "docs/branching.md 신설 — main/dev 2 상시 브랜치+dev 파생 작업 브랜치(feat·fix·chore 등), Conventional Commits, PR 흐름·hotfix. 벤더링 exporter 바이너리(smartctl·filebeat) gitignore 규칙, README에 data01 온보딩(메트릭+로그) 현황 반영.",
  },
  {
    date: "2026-07-24",
    shas: ["2cba06b"],
    type: "인프라",
    scope: "infra",
    title: "main 통합 — M1+M2+data01, main/dev 기준선",
    summary:
      "M1 메트릭 콘솔+M2 통합 로그+모니터링 4·5·data01 온보딩을 main으로 통합. main/dev 워크플로 도입 기준선 — 이후 작업은 dev 파생(상세 docs/branching.md).",
  },

  // ── 2026-07-27 ──────────────────────────────────────────────
  {
    date: "2026-07-27",
    shas: ["e1249e3"],
    type: "개선",
    scope: "console",
    title: "디자인 v3 'Quiet Console' 토큰 체계 전환",
    summary:
      "KRDS 원칙 폐기(서체만 유지) — 4개 방향 독립 설계 후 3관점(관제적합·접근성·구현비용) 심사로 \"정적(Quiet Console)\" 채택: 유채색은 문제에만·초록 예산제·그림자 최소·본문 17→14px. 심사에서 드러난 실결함 교정 — 포커스 링 WCAG 1.4.11 미달(#38B38D 2.62:1 → 마크 #2E9B7B·글자 #1F7A61 분리), font-medium 합성 문제(Medium/SemiBold woff2 4단 추가), \"정상 vs 수집없음\" 형태 분리(● 채움/○ 빈 원), \"0 다운\" 0건이면 무채색.",
  },
  {
    date: "2026-07-27",
    shas: ["e1249e3"],
    type: "신규",
    scope: "console",
    title: "/about 소개 페이지 신설",
    summary:
      "사이드바 푸터 진입의 소개 페이지 — 개요·데이터흐름·플릿·스택·원칙. 로고(brand-mark) 원색은 보존, KRDS 토큰 import 제거. 3106 격리로 prod 3105 무손상 검증.",
  },
  {
    date: "2026-07-27",
    shas: ["6b1de66"],
    type: "개선",
    scope: "console",
    title: "디자인 v3 전면 적용 — 셸·워크벤치·플릿 재정렬",
    summary:
      "셸 크롬을 본문 14px에 맞춘 32px 눈금으로 통일(상단바 56→48px·사이드바 224→192px), 필터 칩 선택을 색이 아닌 면+보더로(✓ 글리프 제거로 칩 폭 흔들림 소음 해소), 초록 예산제 위반(mobile-nav 초록 글자→언더라인) 교정, iframe 액자화(그림자 0)·활성 탭 언더라인. specs/design 9개 파일 v3 재작성 — 대비 재계산 중 주석 반올림 오차 2건 발견·정정(danger-ink 6.2→6.57 등). 4페이지×3뷰포트×라이트/다크 무스크롤.",
  },
  {
    date: "2026-07-27",
    shas: ["6b1de66"],
    type: "사건",
    scope: "console",
    title: "turbopack.root 미고정 — 하이드레이션 전사 버그 수정",
    summary:
      "상위 경로(개발자 홈)의 lockfile 때문에 워크스페이스 루트가 오인되면 클라이언트 번들·HMR 경로가 어긋나 하이드레이션이 통째로 죽음 — SSR은 정상이라 화면은 멀쩡한데 클릭만 무반응이라 진단이 어려웠다. next.config에서 turbopack.root를 import.meta.dirname으로 앱 디렉터리에 고정(체크아웃 위치가 달라져도 안 깨짐).",
    incident: true,
  },
  {
    date: "2026-07-27",
    shas: ["a037edb"],
    type: "개선",
    scope: "monitoring",
    title: "Grafana 대시보드 v3 테마 — 게이지 제거·투명 패널",
    summary:
      "콘솔 크롬만 v3로 바꾸자 \"크게 안 바뀌었다\"는 평 — 화면 약 67%가 기본 룩의 Grafana 임베드였고 알록달록한 게이지 아크가 지배했기 때문. 변환 규칙: gauge 전면 제거→stat+스파크라인, 전 패널 transparent, 정상 무채색·임계 초과만 유채색(#F79009/#D92D20), 시리즈는 중립 계조+선 스타일 구분. uid -v3 접미사 신규 파일로 prod(:3105) 무손상 — 디자인 콘솔(:3106)만 env로 v3 uid 주입해 나란히 비교. targets·templating·노이즈 제외 쿼리 원본 동일 검증, 적용은 사람이(§11).",
  },
  {
    date: "2026-07-27",
    shas: ["44f7d81"],
    type: "문서",
    scope: "infra",
    title: "v3 대시보드 적용·전환 절차 문서화",
    summary:
      "콘솔 화면의 67%가 Grafana 임베드라 크롬만 바꾸면 디자인이 그대로로 보인다는 점, uid가 달라 원본 대시보드와 공존하므로 같은 Grafana에서 두 콘솔이 나란히 돌 수 있다는 점, 되돌리려면 env의 -v3만 지우면 된다는 전환 절차를 기록했다.",
  },
  {
    date: "2026-07-27",
    shas: ["39ef71d"],
    type: "수정",
    scope: "design",
    title: "시리즈 정체성 색 복원 — 상태 vs 정체성 분리",
    summary:
      "\"유채색은 문제에만\" 원칙을 시리즈 색에까지 과잉 적용해 노드 4대 시계열이 전부 회색이 되어 어느 선이 어느 노드인지 읽을 수 없는 기능 결함이 생겼다. 색의 두 역할을 분리 — 상태(정상 무채·문제만 유채)는 유지하고, 정체성(어느 노드인가)에는 저채도 6색 팔레트(--color-series-1..6)를 도입. 빨강/주황은 상태 전용 예약이라 data04는 황토(채도로 분리), 로그 error/warn처럼 시리즈 축이 곧 심각도면 예약색을 쓰는 예외 규칙 추가. thresholds·쿼리·uid는 전부 무변경(프로그램 대조).",
  },

  // ── 2026-07-30 ──────────────────────────────────────────────
  {
    date: "2026-07-30",
    shas: ["2a4b8f0"],
    type: "사건",
    scope: "logging",
    title: "로그 수집 5.7일 무성 중단 — 원인 2건 제거",
    summary:
      "2026-07-24~30 4개 노드 로그가 5.7일간 중단됐고 아무도 몰랐다(약 500만 건 미적재) — alert 규칙 0건, 대시보드는 \"에러 0건\"을 초록으로 표시해 오독. 원인 A(발신측): filebeat 7.17이 지원하지 않는 include_matches `not` 문법이 조용히 전부 불일치로 동작해 이벤트 0건(커서 6일 정지) — 애초에 불필요한 중복 방어였다. 원인 B(수신측): 라이브 Logstash가 git 워킹트리를 :ro 바인드한 상태에서 git checkout이 리로드를 유발해 파이프라인 사망. 재시작 복구(백로그 ~2,800건/s) + 런북 log-ingestion-stopped.md와 교훈 3개 기록.",
    incident: true,
  },
  {
    date: "2026-07-30",
    shas: ["56111f5"],
    type: "문서",
    scope: "docs",
    title: "README 운영자 우선 전면 재작성",
    summary:
      "264행→222행(-16%). 순서를 '지금 상태→문제 발생 시→커버리지→Quickstart'로 반전하고 모든 수치를 data05 라이브 실측+각 행 확인 명령 병기로 교체. 최대 약점(alert 규칙 0건과 로그 5.7일 무성 중단)을 정면 배치. 재작성 중 실버그 발견 — `·`(U+00B7)는 github-slugger가 제거하지 않아 앵커가 깨진다.",
  },
  {
    date: "2026-07-30",
    shas: ["56111f5"],
    type: "문서",
    scope: "specs",
    title: "Sentry 도입 설계 스펙 신규 작성",
    summary:
      "사용자 요구는 \"Slack이 막혔으니 Sentry로\"였으나 실측 결과 data05에서 hooks.slack.com·sentry.io 모두 도달 가능 — 전제가 사실과 달랐고, 보안이 이유라면 Sentry.io는 Slack보다 반출량이 크다. SaaS/self-hosted/GlitchTip 3안과 필드 단위 반출 표, 역할 분담(앱 에러=Sentry / 인프라 메트릭=Grafana / 무성 실패=Crons)을 담았다.",
  },
  {
    date: "2026-07-30",
    shas: ["9a38343"],
    type: "신규",
    scope: "alerting",
    title: "Grafana 알림 계층 1차 — Slack 2채널·규칙 5건",
    summary:
      "alert 0건 상태에서 로그 인입 5.7일 중단을 아무도 몰랐던 공백을 메운다. 알림도 코드로 프로비저닝(UI 수제 금지). 임계는 2026-07-30 실측 대비로 정해 첫날 오발화 0건 목표(디스크 90%·GPU 85°C·메모리 5% 등). 핵심 LogIngestStalled: 30분 유입 100건 미만 발화, noDataState=Alerting(쿼리가 죽어도 장애). Grafana 13 slack 알림기에 thread_ts 없음을 실측 정정 — 노이즈 제어는 그룹핑으로. 개인 워크스페이스라 알림 본문은 요약+런북 링크만(반출 최소화).",
  },
  {
    date: "2026-07-30",
    shas: ["410426b"],
    type: "사건",
    scope: "alerting",
    title: "알림 프로비저닝 불허 키로 Grafana 기동 실패",
    summary:
      "alerting 프로비저닝 3파일 투입에 Grafana가 기동 실패(포트 3000 미리스닝, 콘솔 임베드 전부 깨짐). 원인은 존재하지 않는 최상위 키 inhibitionRules(조사 보고를 검증 없이 수용)와 오타 muteTimings(정답 muteTimes). 같은 세션 세 번째 미검증 실수임을 인정하고 \"벤더 스키마에 확인되지 않은 키는 넣지 않는다\" 규칙 고정. 억제는 파일 프로비저닝 미지원이라 그룹핑(group_wait 차등)으로 대체.",
    incident: true,
  },
  {
    date: "2026-07-30",
    shas: ["4591f91"],
    type: "사건",
    scope: "alerting",
    title: "slack.com SNI 차단 발견 — endpointUrl 우회",
    summary:
      "Grafana 기동 불가 2차 — 빈 SLACK_BOT_TOKEN($__env 치환 0자, 여러 줄 붙여넣기로 read 실패)이 contact point 검증 실패로 Grafana 전체를 내렸다. 조사 중 slack.com이 L7/SNI 필터로 TLS 리셋됨을 발견(TCP 443 열림만 보고 \"안 막혔다\"고 한 앞선 판단이 틀렸다 — api.slack.com은 정상). Slack 알림기의 endpointUrl로 api.slack.com 경유 우회, 추가 인프라 없음. 프로비저닝 파일 1개 실패가 Grafana 전체를 내리는 구조적 위험도 기록.",
    incident: true,
  },
  {
    date: "2026-07-30",
    shas: ["27a630b"],
    type: "수정",
    scope: "alerting",
    title: "LogIngestStalled 쿼리 교정 — 빈 bucketAggs 거부",
    summary:
      "5규칙 중 LogIngestStalled만 health=error — OpenSearch ds는 빈 bucketAggs를 거부한다. 답은 이미 자체 문서(infra/logging README §7)에 있었는데 참조하지 않았다. date_histogram(min_doc_count 0, 유입 0 구간을 0으로 채워야 '정지'와 '데이터 없음'을 구분)+reduce(sum) 3단 구성으로 교정. 이번엔 적용 전 /api/ds/query 실측 — 30분 합계 27,585건, 임계 100건 대비 275배 여유. Slack 양 채널 전송 ok 확인.",
  },
  {
    date: "2026-07-30",
    shas: ["fdb418d"],
    type: "문서",
    scope: "specs",
    title: "에러 트래킹 SDD 스펙 — GlitchTip 자체호스팅",
    summary:
      "스펙 없이 즉흥 구현하다 같은 세션에서 5번 실패한 뒤 SDD로 복귀 — 구현 전에 스펙만 작성(87KB, ADR-0022). 정정 4건: GlitchTip은 Sentry Crons 미구현(check_in 폐기)이라 자체 Uptime heartbeat 사용, heartbeat엔 status 파라미터가 없어 판정 역전 등. GV-1~GV-8 게이트(\"정본 3개 밖의 키는 쓰지 않는다\"), F1~F11 실패 모드 표, AC-E-1~20 전부 명령+기대출력. 배치는 compose 1.29 recreate 버그 때문에 /data/glitchtip 분리(폭발 반경 분리).",
  },
  {
    date: "2026-07-30",
    shas: ["4a554b8"],
    type: "수정",
    scope: "infra",
    title: "T0-7 상시 빨간 항목 정리 — 10건 전수 진단",
    summary:
      "알림 확장 전 \"항상 빨간 것\"을 없앤다. 해결 2건: OpenSearch yellow→green(unassigned 37개 전부 단일노드 replica 샤드, 인덱스 템플릿으로 재발 차단), data04 journal 848M→200M+apt 캐시 정리 ≈1GB. 원인 확정: data05 smartctl down은 ufw 드랍, vllm :8010 루프는 드라이버 mismatch. data01 rc-local(5년 failed)은 라이브 IP 소스라 건드리면 재부팅 후 접속 불능 위험 — known-issue 문서화. data01 Jupyter 커널 RSS 291GB(73.6%) 등은 통보 대상으로 분류(자동 조치 금지).",
  },
  {
    date: "2026-07-30",
    shas: ["dd9e1a6"],
    type: "신규",
    scope: "alerting",
    title: "알림 규칙 5→9건 — 결정적 실패 4종 추가",
    summary:
      "GpuTempHigh 85→92°C 자기 결함 교정 — 85는 유휴 현재값 기준이었고 30일 분포는 data04 GPU1 p99 87°C·최대 88°C로 상시 발화 결함(임계는 부하 시 분포로). 결정적 실패 4건 추가: GpuXidErrorNew(changes로 latched 잔존값 43 함정 회피), OomKillOccurred(%보다 정확), SmartHealthFailed(연구 데이터는 재현 불가), DiskFillPredicted(predict_linear — \"4시간 뒤 찬다\"는 크기 무관 동일 의미). 전 신규 쿼리 투입 전 라이브 실측 발화 0건.",
  },
  {
    date: "2026-07-30",
    shas: ["17abac0"],
    type: "문서",
    scope: "specs",
    title: "alerting spec v2 — 임계 결정 프레임워크",
    summary:
      "지표 3분류(결정적 실패/소진 예측/행동 이탈)별로 임계 정하는 방법이 다르다는 프레임워크 신설. 업계 기본값(디스크80·메모리10%·온도85)이 자체 30일 실측(86.5%·9.9%·p99 87°C)에서 셋 다 상시 발화임을 반증 수치로 명시. \"서버별 임계 압력의 절반은 안 고친 문제의 합리화\" 원칙. 정본은 alert-rules.yaml(스펙이 YAML을 따라온다), 드리프트 3건 교정, 표↔YAML 9/9 일치 검증.",
  },
  {
    date: "2026-07-30",
    shas: ["8958949"],
    type: "신규",
    scope: "error-tracking",
    title: "GlitchTip E0 게이트 실측 + E1 인프라 파일",
    summary:
      "컨테이너 0·코드 0줄·되돌릴 것 0인 측정부터. GV-7: 호스트 PG 16.14는 127.0.0.1 전용 → 컨테이너 PG 포트 미노출로 충돌 해소. GV-2: \"유령 키\"로 의심한 것들이 정본 settings.py(1,337줄)에서 전부 실존 확인 — 성급한 판정을 정본이 교정. 산출물은 docker-compose(정본 이탈 3건뿐)·check-env.sh 빈 시크릿 게이트(5케이스 자체 테스트 — 빈 토큰이 Grafana를 내린 실패를 기계적으로 차단). 라이브 적용은 사람.",
  },
  {
    date: "2026-07-30",
    shas: ["43ec711"],
    type: "신규",
    scope: "console",
    title: "GlitchTip DSN 게터 — throw 금지 설계",
    summary:
      "다른 env 게터와 달리 getGlitchTipDsn은 절대 throw하지 않고 undefined를 반환한다. 에러 트래킹은 관측 부가 기능 — DSN 미설정/오타가 콘솔 부팅을 막으면 주객전도. 빈 시크릿 하나가 서비스 전체를 내리는 실패는 Grafana에서 이미 측정됐다(2026-07-30). SDK 없이 타입·테스트 78건 기준선 확립.",
  },

  // ── 2026-07-31 ──────────────────────────────────────────────
  {
    date: "2026-07-31",
    shas: ["d84d63d"],
    type: "인프라",
    scope: "docs",
    title: "graphify 도입 — 문서 지식 그래프, 반출 0",
    summary:
      "문서 지식 그래프(ADR↔스펙↔런북)를 로컬 vLLM 백엔드로 구축 — ADR 18개→18노드/15엣지, 전부 로컬 경유(외부 전송 0). 역할 분담: 코드=codebase-memory-mcp / 문서=graphify(CLI), graphify 훅은 이중 리마인더 충돌로 미설치. ANTHROPIC/GEMINI 백엔드 금지 명문화 — 외부 API 사용 시 KEI 내부 문서가 반출된다. .gitignore 산출물 누수 교정.",
  },
  {
    date: "2026-07-31",
    shas: ["0616d7a"],
    type: "수정",
    scope: "error-tracking",
    title: "등록 플래그 의미 교정 — False면 첫 계정 불가",
    summary:
      "정본 settings.py 확인으로 오류 2건 교정: ① ENABLE_USER_REGISTRATION은 단순 on/off — False인 채로는 UI에서 첫 관리자 계정조차 못 만든다(설치 문서 요약을 검증 없이 수용). 값은 False 유지+첫 계정은 createsuperuser로. ② ENABLE_OPEN_USER_REGISTRATION은 가입 플래그가 아니라 조직 생성 권한 매핑. 교훈: GV-2를 키 존재 확인에서 의미 확인까지 넓혀야 한다.",
  },
  {
    date: "2026-07-31",
    shas: ["31a3235"],
    type: "수정",
    scope: "error-tracking",
    title: "ALLOWED_HOSTS·CSRF 와일드카드 경고 해소",
    summary:
      "createsuperuser 실행 중 실제로 뜬 와일드카드 경고를 해소 — 정본에서 두 키의 타입·기본값을 확인하고 실제 접근 경로(Cloudflare 터널·SSH 포트포워딩 localhost·Prometheus 브리지)만 허용. CSRF는 Django 4+ 요구대로 스킴 포함. 라이브 반영은 사람이 재생성할 때. E1-3~E1-5·E2-1 완료.",
  },
  {
    date: "2026-07-31",
    shas: ["f939d71"],
    type: "신규",
    scope: "console",
    title: "Sentry SDK + 화이트리스트 스크러버",
    summary:
      "@sentry/nextjs 10.69.0 설치. scrubEvent는 삭제 나열이 아니라 화이트리스트 재조립 — SDK가 새 필드를 추가해도 모르는 필드는 기본 소멸(미지 필드 회귀 가드 테스트로 고정). 쿼리스트링·헤더·쿠키·동료 OS 계정명 태그·스택 소스 본문·절대경로·사설 IP를 차단. 기준선은 \"이 문자열이 Slack 알림에 실려도 괜찮은가\". DSN 호스트를 미생성 터널 도메인에서 127.0.0.1:8090으로 교정, AC-E-5 통과(올바른 key 200/잘못된 key 403). 테스트 88건.",
  },
  {
    date: "2026-07-31",
    shas: ["7aed719"],
    type: "보안",
    scope: "console",
    title: "원시 페이로드 게이트 — 유출 2건 발견·차단",
    summary:
      "단위 테스트 10건 전부 통과 상태에서 원시 envelope를 덤프해 grep하니 2건이 샜다. ① session envelope는 beforeSend를 거치지 않아 ip_address가 유출 — 릴리스 헬스 미사용이므로 세션 통합 제거(손실 0). ② 예외 메시지 속 토큰이 통과 — Slack/GitHub/OpenAI 토큰 패턴+key=value 마스킹 추가(token=[secret], key는 보존). 프로브가 실제 init 옵션(sentry-options.ts)을 import하도록 강제. 재측정 결과 금지 9종 차단·보존 4종 유지 PASS.",
  },
  {
    date: "2026-07-31",
    shas: ["505fb7d"],
    type: "신규",
    scope: "console",
    title: "Sentry 계측 배선 + /metrics 404 원인 규명",
    summary:
      "instrumentation.ts·server/edge config·withSentryConfig 배선(Next 16+Turbopack은 client config auto-import 안 함). 소스맵 업로드·telemetry·release 호출은 전부 비활성 — 외부로 나가거나 값이 없는 것들. 서버 왕복 flush 성공(일회성 스크립트, 셀프테스트 라우트 미잔류). /metrics 404는 조사 보고 오류 — 정본 urls.py의 ENABLE_OBSERVABILITY_API 조건부 라우트(기본 False)여서 env 추가. \"라이브 적용 금지\" 주석 덕에 down 타깃 상주는 없었다.",
  },
  {
    date: "2026-07-31",
    shas: ["ac8b88b"],
    type: "신규",
    scope: "error-tracking",
    title: "로그 인입 하트비트 — 탐지 5.7일→40분",
    summary:
      "5.7일 무성 중단의 재발을 막는 dead man's switch. GlitchTip 하트비트엔 status 파라미터가 없어 판정은 스크립트가 하고 정상일 때만 POST — 스크립트·타이머·서버 어느 쪽이 죽어도 ping 부재→알림으로 안전한 방향으로 실패한다. 실측 확정 2건: POST 필수(GET 405)·URL은 127.0.0.1:8090(터널 미완). Grafana LogIngestStalled와는 실패 도메인이 달라 중복 아님(임계 100건/30분은 동일값). ping 5분=모니터 600s의 절반. 4개 시나리오 실측 검증.",
  },
  {
    date: "2026-07-31",
    shas: ["15329be"],
    type: "문서",
    scope: "docs",
    title: "README 갱신 — 알림 계층 가동 반영",
    summary:
      "\"최대 약점 — 알림 계층이 없다\"가 더는 사실이 아니라 갱신하되 5.7일 장애는 약점의 근거가 아니라 설계의 근거로 유지. 실측 반영: 타깃 21중 20up(분모 명시)·시계열 16,633·alert 9건·GlitchTip 6.2.2·테스트 88건. vLLM :8010은 드라이버 mismatch로 stop·disable(재시작 17,031회 ≈ 61시간 CPU 소모)하고 스크랩 주석 처리 — 영구 down 타깃은 알림 무시 습관의 시작. 트러블슈팅 2행(SNI 차단·임계 근거) 추가.",
  },
  {
    date: "2026-07-31",
    shas: ["30ad029"],
    type: "문서",
    scope: "docs",
    title: "GitHub 정비 — 브랜치 체계·템플릿·CHANGELOG",
    summary:
      "브랜치 규칙이 문서엔 있으나 안 지켜진 문제(feat/design-v3에 25커밋이 디자인+알림+에러트래킹으로 뭉침)를 고친다. LICENSE(Proprietary, KEI 내부 전용)·CHANGELOG(Keep a Changelog, 0.1.0·0.2.0을 git 이력 근거로)·PR/이슈 템플릿·CODEOWNERS 신설. branching.md 55→243줄 개정 — 새 브랜치 판단 4신호, main/dev 직접 커밋 차단 pre-commit 훅, 브랜치 보호는 gh 토큰이 협업자라 문서로.",
  },

  // ── 2026-08-02 ──────────────────────────────────────────────
  {
    date: "2026-08-02",
    shas: ["100f49d"],
    type: "신규",
    scope: "bmc",
    title: "SEL 백필 — BMC 이벤트 로그 확보",
    summary:
      "SEL은 BMC가 OS와 무관하게 남기는 기록이라 Prometheus·OpenSearch가 한 번도 보지 못한 계층. data04 SEL이 64% 차 있어(순환 삭제 전) 먼저 텍스트로 확보했다 — Overflow: false라 아직 유실 없음. 부수 발견: data03 BMC는 UTC, data04는 KST — 시각 설정 불일치(교정 대상). data01·02·05는 미수집.",
  },
  {
    date: "2026-08-02",
    shas: ["100f49d"],
    type: "사건",
    scope: "bmc",
    title: "시설 전원 상실 4회 규명 — 회로 공유 증거",
    summary:
      "두 노드의 `Power Supply | Redundancy Lost` 구간 대조 결과 6년간 4회가 분 단위로 동시 발생(2020-09-24 21분 / 2023-03-31 2분 / 2025-05-10 22분 / 2025-06-21 57분). 선행 이벤트가 AC lost이므로 PSU 고장이 아닌 입력 AC 상실이고, 동시성은 두 노드가 같은 전원 회로에 물려 있다는 첫 실측 증거. 매번 이중 급전이 흡수해 무중단 — 단일 급전 장비였다면 4회 다운. 가용성이 지켜져 위험이 보이지 않았다. 한계(원인 미상, 건물/회로 구분 불가 등)도 정직하게 기록.",
    incident: true,
  },
  {
    date: "2026-08-02",
    shas: ["9de4844"],
    type: "문서",
    scope: "specs",
    title: "external-watchdog 제안 — L4 외부 감시 계층",
    summary:
      "현 3계층(Grafana·GlitchTip 하트비트·T4-12 예정)은 전부 사이트 안에서 돈다 — 전원·네트워크 사건이면 감시자와 피감시자가 함께 죽고, 이는 가설이 아니라 실적(SEL: 6년간 AC 상실 4회, 최장 57분). 링 토폴로지·Sentry.io 기각, Healthchecks.io 채택 후보(체크 20개·Slack 무료). 체크 2개를 다른 실패 도메인(data05·data03)에서 무조건 발신 — 침묵 조합이 곧 진단. 반출은 UUID·시각·공인IP뿐이지만 최초의 상시 외부 의존이라 ADR-0023 게이트 전 구현 금지.",
  },
  {
    date: "2026-08-02",
    shas: ["10f2488"],
    type: "문서",
    scope: "specs",
    title: "fleet-hardening 스펙 — 운영 부채 5축·AC 85",
    summary:
      "실재하는 운영 부채 5축 교정 SDD 스펙(AC 85·태스크 83): ①GPU 스택 정합성+커버리지 구멍(node_hygiene가 정작 고장난 data05에 없음) ②물리 디스크 SMART(RAID 뒤 전부 사각지대) ③GPU 런북+runbook_url 무결성(알림 9건 중 전용 런북 1건뿐) ④섀시 전력 배선(816W 수집 중 소비처 0)+거짓 recording rule 2건 ⑤CI 파이프라인 부재 해소. 게이트 심사 2회, 차단 15건 전부 실행 검증으로 해소. 모든 AC에 실행 가능한 검증 명령.",
  },

  // ── 2026-08-03 ──────────────────────────────────────────────
  {
    date: "2026-08-03",
    shas: ["581df3d"],
    type: "인프라",
    scope: "gates",
    title: "게이트 도구 4종 설치 + promtool 2엔진 폴백",
    summary:
      "yamllint·shellcheck·ansible-lint·promtool 설치(sha256sums 대조 후, sudo 0). 스펙의 pipx/venv 폴백이 이 호스트에서 둘 다 불가(ensurepip 없음·PEP 668) — uv로 교체(단일 정적 바이너리, 시스템 무오염). check-rules.sh 2엔진: promtool 있으면 전강도, 없으면 PyYAML 구조 검사 강등(못 잡는 것을 주석에 명시). docker 경로는 --entrypoint=/bin/promtool 필수 — 아니면 조용히 실패. 역증명 포함 AC-1-16 전부 실행 검증, 방금 설치한 shellcheck가 자기 코드의 SC2209·SC2034를 잡았다.",
  },
  {
    date: "2026-08-03",
    shas: ["4c8b709"],
    type: "신규",
    scope: "monitoring",
    title: "W1 — GPU 정합성 탐지·런북 3종·게이트",
    summary:
      "탐지가 정작 고장난 노드를 제외하고 있었다 — node_hygiene가 드라이버 깨진 .105를 자동 스킵. 소비처를 inventory 명시 선언(host|container)으로 바꾸고 미선언은 assert로 차단. 드라이버 정합성 메트릭 6종(커널모듈↔유저스페이스 대조) 신설. 알림 9건 중 전용 런북 1건뿐 → GPU 런북 3종(xid·thermal·driver-mismatch)+check-runbooks.sh 게이트. 검증이 결함 4건을 잡아 전부 교정 — 특히 sev3→warning(숫자 등급은 어느 라우팅 정책에도 안 걸려 조용히 기본 경로로 빠진다). 콘솔 테스트 88→92, 라이브 무변경.",
  },
  {
    date: "2026-08-03",
    shas: ["c490cd2"],
    type: "수정",
    scope: "monitoring",
    title: "거짓 recording rule·거짓 초록 교정",
    summary:
      "배포 전에 day-1 오발화를 잡았다 — bios recording rule의 라벨이 product(실제는 product_name)라 전부 한 그룹으로 뭉쳐 max=3을 반환, BiosVersionDrift가 배포 즉시 오발화할 뻔(올바른 라벨로는 max=1, 드리프트 0이 정답). gpu_driver_versions의 \"2\"는 두 버전이 아니라 알려진 버전 1+라벨 부재 버킷 1. 대시보드 거짓 초록 2건(or vector(0)+noValue:0이 실제 2를 0 초록으로 위조 / 2노드만 보고하는 지표의 합계 0 초록)과 게이트 자체 결함 2건(alert: 금지 grep 우회·subquery 유령 식별자)도 교정.",
  },
  {
    date: "2026-08-03",
    shas: ["c490cd2"],
    type: "신규",
    scope: "monitoring",
    title: "섀시 전력 배선 — recording 13종·대시보드",
    summary:
      "931W가 수집만 되고 소비처가 0이었다 — recording rule 13종(섀시·GPU 몫·일일 kWh)과 대시보드 row 2개 신설. node_hwmon_power_average_watt는 단수형 — 복수형 오타를 잡는 메트릭명 가드 check-promql-metrics.sh를 스냅샷 대조로 함께 만들었다. hardware-ops T1-4·T1-5는 폐기 표기(중복 작업 방지), 진행 24/83.",
  },
  {
    date: "2026-08-03",
    shas: ["baf59d9"],
    type: "신규",
    scope: "monitoring",
    title: "물리 디스크 SMART — RAID 뒤 24본 가시화",
    summary:
      "smartctl --scan-open이 /dev/sda 한 줄만 반환하고 ssacli도 없어 기성 exporter로는 원리적으로 물리 디스크가 안 보였다(Prometheus엔 HPE LOGICAL VOLUME 3개뿐). -d cciss,N 강제 지정이 동작함을 실측 — data03·04 각 12본, textfile collector 경로로 수집 role 신설. 실측으로 data04 열화 2본 발견(GDL 773 / GDL 66+미교정 read 8) — RAID가 흡수해 관측 스택이 여태 몰랐다(SEL의 PSU 사건과 같은 구조). 부수 이득: data04 :9633 포트 충돌 블로커 소멸. 알림은 2주 섀도 후 승격.",
  },
  {
    date: "2026-08-03",
    shas: ["baf59d9"],
    type: "인프라",
    scope: "gates",
    title: "CI 파이프라인 — 게이트 15종·Actions 3잡",
    summary:
      "헌장 §9 이행. check-no-secrets를 4규칙으로 재작성(정규식 엔진을 python3 re로 못박음 — (?i)·\\s가 grep -E에서 조용히 안 잡힌다). self-test 픽스처는 파일로 커밋하지 않음(PUBLIC 레포 push protection이 패턴만 보고 차단). 검증이 critical을 잡았다 — 로컬 rc=0은 08-02 빌드 잔재(.next) 덕이었고, release.yml이 빌드 전에 S3 게이트를 돌려 구조적 영구 red. 빌드를 앞으로 옮기고 새 클론 시뮬레이션 rc=0 확인. 진행표를 실측 58/83으로 동기화.",
  },
  {
    date: "2026-08-03",
    shas: ["ad8f443"],
    type: "수정",
    scope: "console",
    title: "Grafana 임베드 테마 간헐 불일치 수정",
    summary:
      "콘솔은 다크인데 임베드만 라이트로 고정되던 버그. 근본 원인: 테마의 진실은 클라이언트에만 있는데 useTheme 서버 스냅샷이 \"light\"를 추측 — 그 추측이 SSR HTML의 iframe src에 실려, 하이드레이션이 늦거나 깨지면(확장 프로그램 주입·HMR 전례) 임베드가 라이트로 고정. 정상 경로에서도 다크 사용자는 매번 2번 로드. iframe을 하이드레이션 후 진짜 테마를 안 뒤에만 생성(useSyncExternalStore). 프로덕션 빌드 Playwright 실측: theme=light 로드 0회.",
  },
  {
    date: "2026-08-03",
    shas: ["9be3110"],
    type: "문서",
    scope: "specs",
    title: "alert-enrichment 스펙 — 알림 보강 4단계",
    summary:
      "2026-08-03 첫 실전 알림(DiskUsageHigh data04)이 증명한 결함 4종을 E1 메시지 수리→E2 딥링크→E3 웹훅 중계+로컬LLM 스레드 분석→E4 귀속의 4단계로 닫는 스펙(554줄·AC 25·태스크 27). 초기 오진 교정 — Grafana가 템플릿을 안 렌더하는 게 아니라 파일 프로비저닝의 env 보간이 $labels를 삼켜(미정의 변수→빈 문자열) 리터럴로 흐른 것이 제목 버그의 진짜 원인(공식 $$ 이스케이프 규정+grafana#78118 동일 증상).",
  },
  {
    date: "2026-08-03",
    shas: ["9be3110"],
    type: "수정",
    scope: "alerting",
    title: "E1 알림 메시지 수리 — $$labels·템플릿",
    summary:
      "alert-rules.yaml의 $labels 25곳을 $$로 이스케이프, summary 4규칙에 현재값·임계·지속 렌더(\"사용률 90% 초과\"→\"192.0.2.104 / 사용률 95.2% (임계 90% · 15m 지속)\"). templates.yaml 신설(KST 시작시각·해결 통지·런북 링크 조립, $ 문자 0개로 보간 함정 원천 회피). warning 라우트 group_by에 node 추가 — 다중 노드 동시 발화 시 제목에서 노드가 사라지는 문제. 재발 방지 게이트 check-alerting-escapes.sh — check-ci-coverage가 새 게이트의 CI 미배선을 즉시 잡아 축5 게이트가 도입 하루 만에 실전으로 일했다.",
  },
  {
    date: "2026-08-03",
    shas: ["657fcc4"],
    type: "신규",
    scope: "alerting",
    title: "E2 딥링크 14규칙 + SMART noData 임시 강등",
    summary:
      "전 규칙에 annotation 3종(__dashboardUid__·drilldown_url·console_url) — 알림에서 클릭 1번으로 그 노드·그 시간창. 대시보드 배정: 노드→system-v3·GPU→gpu-v3·로그→logs-v3. SMART 3규칙은 noDataState NoData→OK 임시 강등 — E1 배포 지시가 \"수집기 배포 뒤에만 켠다\"는 축2 설계 순서를 어겨 경고 그대로 DatasourceNoData 2건 상주 발화[실측]. 원설계가 옳으므로 삭제가 아닌 강등, 수집기 배포+스크랩 1주기 확인 후 T2-16 복원 조건 명시. 작업 중 YAML을 두 번 깨뜨려 최종본은 HEAD에서 결정적 재구성.",
  },
  {
    date: "2026-08-03",
    shas: ["b8814f3"],
    type: "신규",
    scope: "console",
    title: "알림 딥링크 착지점 — /incidents 확장",
    summary:
      "알림 console_url이 착지할 곳을 보수 — /incidents가 alert·mount·from searchParams 수용. alert=<이름>은 콘솔의 프리셋 질문 테이블(lib/alert-presets.ts, 14규칙 전수)이 질문으로 변환(URL에 한국어 미탑재 — 인코딩 회피+코드 버전관리). lib/fleet-node.ts로 data04|192.0.2.104|IP:port 3형태를 fleetNode로 정규화(Grafana 템플릿은 IP:port만 만들 수 있다). 테스트 92→103, Playwright 실측 — 착지 200·정규화 표시·vLLM 다운 시에도 페이지 생존.",
  },
  {
    date: "2026-08-03",
    shas: ["0ae34b4"],
    type: "수정",
    scope: "console",
    title: "임베드 미표시 회귀 — 테마를 쿠키로 SSR",
    summary:
      "직전 테마 수정(ad8f443)이 iframe을 하이드레이션 후에만 만들게 해 dev(3106)에서 Grafana가 아예 안 뜨는 회귀 — dev 하이드레이션이 불안정하다고 문서에 명시돼 있었는데 임베드를 그 신호에 의존시켰다. \"잘못된 테마보다 부재가 더 나쁜 실패다\". 근본 수정: 토글이 기록하는 keiwi-theme 쿠키를 서버 컴포넌트가 cookies()로 읽어 SSR HTML이 처음부터 올바른 테마의 iframe을 담는다 — 다크 사용자 이중 로드도 소멸. 검증: SSR HTML 직접 확인·Playwright light 로드 0회·테스트 103건.",
  },
  {
    date: "2026-08-03",
    shas: ["1c3367e"],
    type: "보안",
    scope: "security",
    title: "PUBLIC 레포 민감정보 정화 + 재발방지 게이트",
    summary:
      "레포가 PUBLIC(포트폴리오)이라 운영 상세를 걷어낸다 — 코드 공개는 의도, 운영 상세 공개는 사고. 외부 도메인 전면 제거(존재 자체 비공지, 딥링크는 RFC1918 내부 IP로), 연구자 실계정→user1~6, 홈 하위 경로 전 세그먼트 일반화(파일명이 연구 주제를 특정), 예시 IP는 RFC 5737. check-public-safety.sh 게이트 — 검증이 lookbehind의 @ 때문에 user@host 꼴이 통째로 투명한 우회를 잡아 교정. relay critical 수정: sqlite 쓰기 실패 시 Slack 중복 도배(하필 대표 원인이 디스크 풀)·redaction fail-open. 경고: 이 커밋 전까지 공개 노출은 1건도 줄지 않았다 — push가 실제 조치.",
  },

  // ── 2026-08-04 ──────────────────────────────────────────────
  {
    date: "2026-08-04",
    shas: [],
    type: "신규",
    scope: "console",
    title: "어시스턴트에 문서 RAG 연결 — 로그 근거 [n] + 문서 근거 [D n]",
    summary:
      "런북·ADR 지식그래프(LightRAG)를 어시스턴트에 배선. BM25 로그 검색의 대체가 아니라 보강이다 — 로그는 '왜 났나', 문서는 '매뉴얼이 뭐라 하나'. 실측 효과: '로그 인입이 멈췄을 때 진단 순서' 답변이 \"하트비트 상태를 확인해야 한다\"는 일반론에서 log-ingestion-stopped.md의 실제 3단계(logstash 로그 확인→컨테이너 재시작→인입 재개 검증)로 바뀌었다. 배선은 stdlib HTTP 서비스(:8131, ADR-0026) — child_process는 요청마다 콜드 1.49s 고정 과세라 기각, lightrag-server는 fastapi 미설치(실측) + 문서 업로드/삭제 쓰기 엔드포인트가 딸려와 읽기전용 원칙 위반이라 기각. 핵심은 aquery(생성 17.7s)가 아닌 aquery_data(검색만 0.3~0.8s)만 노출해 근거번호 계약을 콘솔이 계속 소유하는 것. 로그 번호 [n]은 그대로 뒀다 — alert-relay가 Slack 근거줄을 [\\d+]로 렌더·판정하고 있어 [L n]으로 바꾸면 본문 인용과 근거 목록이 어긋난다(실측). 문서 경로는 평탄화 역매핑 후 레포 실존이 검증된 것만 번호를 받는다. 실패 격리 실증: RAG 정지 상태에서 어시스턴트가 로그 근거 40건으로 1.5s 정상 응답. 타임아웃은 4s→6s — 콜드 1건이 3.5s를 넘겨 런북 근거를 통째로 잃는 것을 라이브에서 관측했다. 테스트 103→123 + 파이썬 유닛 21건(GPU·색인 0).",
  },
];

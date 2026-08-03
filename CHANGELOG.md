# Changelog

이 파일은 KEIwi(KEI 온프레미스 연구 서버 플릿 관제 콘솔)의 주요 변경을 기록한다.

- 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)을 따른다.
- 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따른다.
- **이 저장소는 KEI 내부 전용이다** — 외부 공개·재배포 금지(LICENSE 참조).
- 카테고리: Added(추가) / Changed(변경) / Fixed(수정) / Removed(제거) / Security(보안).
- "라이브"는 실제 가동·검증된 것, "1차/미완"은 도입만 되고 후속이 남은 것을 뜻한다.

## [0.2.0] - 2026-07-31

디자인 v3 + 관측 3계층(알림·에러 트래킹·하트비트). feat/design-v3 → dev(PR #3) → main.

### Added
- **알림 계층(라이브)** — Grafana 알림 규칙 9건을 코드로 프로비저닝, Slack 2채널(#keiwi-infra·#keiwi-web)로 발신. 1차 5건(`9a38343`) 후 결정적 실패 4건 추가로 9건(`dd9e1a6`: GpuXidErrorNew·OomKillOccurred·SmartHealthFailed·DiskFillPredicted). 임계는 2026-07-30 실측 기반, 첫날 오발화 0건 확인.
- **로그 인입 하트비트 — dead man's switch(라이브)** — 정상일 때만 GlitchTip 하트비트로 POST(`127.0.0.1:8090`), 신호 부재를 장애로 판정. 로그 인입 중단 탐지 5.7일 → 40분(`ac8b88b`). Grafana `LogIngestStalled`와 서로 다른 실패 도메인으로 이중화.
- **GlitchTip 에러 트래킹(콘솔 계측 라이브 / 외부 터널 미완)** — 자체호스팅 GlitchTip + 콘솔 Sentry SDK 배선, 반출 최소화 스크러버(화이트리스트)로 egress 통제(`f939d71`). DSN 게터는 부팅 안전 우선 no-throw(`43ec711`), 서버 왕복 성공(`505fb7d`), E1 인프라·게이트 실측 통과(`8958949`). 외부 도메인 터널 E1-7은 미완(주소는 레포에 적지 않는다 §13) — 현재 로컬 루프백 사용.
- **디자인 v3 "Quiet Console" + /about** — 정적(靜的) 토큰 체계 신설·소개 페이지(`e1249e3`), 셸·워크벤치·플릿/임베드 전면 재정렬(`6b1de66`). Grafana 대시보드 v3 테마(게이지 제거·투명 패널·팔레트 정렬, `a037edb`).
- **문서 지식 그래프 + 코드베이스 메모리 도구** — graphify 도입(ADR↔스펙↔런북 그래프), vLLM 백엔드로 egress 0(`d84d63d`).
- **specs** — alerting v2(임계 결정 프레임워크, `17abac0`) / hardware-ops(축2 신선도·크로스노드 watchdog) / error-tracking SDD(GlitchTip 자체호스팅, ADR-0022, `fdb418d`).
- **Proprietary LICENSE** — All rights reserved, KEI 내부 전용 명문화.

### Changed
- KRDS(디자인 v2) → v3 "Quiet Console"로 전면 전환(`6b1de66`).
- 브랜치 워크플로 실사용 — feat/design-v3 → dev PR #3(`1a3892e`)로 통합(전략 문서 자체는 0.1.0에서 수립).

### Fixed
- **로그 인입 5.7일 중단 복구(원인 2건)** — (A) data01 filebeat 7.17 journald 입력의 미지원 `include_matches: not` 문법이 조용히 전건 불일치로 동작해 입력 전멸, 불필요한 중복 방어 블록 제거. (B) 수신측 라이브 Logstash가 git 워킹트리를 `:ro` 바인드+auto-reload 하던 중 브랜치 체크아웃으로 구설정이 덮여 파이프라인 사망. 재시작 복구 + 런북 신설(`docs/runbooks/log-ingestion-stopped.md`, `2a4b8f0`).
- **포커스 링 WCAG 1.4.11 미달** — 디자인 v2 버그(#38B38D가 흰 배경 대비 2.62:1) 교정(`e1249e3`).
- **폰트 합성 문제** — `font-medium/semibold`가 실파일 없이 합성되던 문제, Medium/SemiBold woff2 추가(`e1249e3`).
- **GPU 온도 임계 결함** — GpuTempHigh 임계를 유휴 현재값 기준 85°C에서 p99 분포 기준 92°C로 교정(정상 부하 상시 발화 제거, `dd9e1a6`).
- **OpenSearch yellow → green** — unassigned 37 샤드(전부 `.opendistro-*` replica) 해소(`4a554b8`).
- **smartctl 스크랩** — data05 smartctl:9633이 ufw의 docker 브리지 드랍으로 down이던 것 확인, `ufw allow` 1줄로 해결(exporter 무죄, `4a554b8`).
- 알림 프로비저닝이 Grafana 기동을 막던 불허 키 제거(`410426b`) / Slack SNI 차단 우회를 위한 endpointUrl 지정(`4591f91`) / `LogIngestStalled` 쿼리 교정(OpenSearch 빈 bucketAggs 거부, `27a630b`).

## [0.1.0] - 2026-07-24

M1 콘솔 + M2 통합 로그를 중심으로 한 최초 릴리스(태그 `v0.1.0`, `2cba06b`). 2026-06-22 착수.

### Added
- **M1 콘솔** — Next.js 16 + Tailwind v4 앱 셸 스캐폴드(`71c48bc`), 플릿 상태 API(`1f70a89`), Overview(플릿 스트립 + Grafana 임베드, `e1e78e8`), 대시보드 탭 다중 지원(`bdc621b`), 플릿 카드→노드 메트릭 드릴다운(`3f37550`).
- **인프라 기반** — 프로젝트 헌장(Constitution) + ADR 0001~0005, 플릿 인벤토리 SoT, AGENTS 맵. Prometheus 설정 + data04 SSH 터널(:764), keiwi-console systemd 유닛(:3105 상주, `e9ed4e6`).
- **모델 워크로드 관측** — vLLM 스크랩 + Grafana 대시보드(`d4d4df7`), data04 모델 배선(터널 9836·node 라벨, `6fa51ed`).
- **KRDS 디자인 v2** — 파운데이션 스펙 + ADR 0006/0007(`8feaa8d`), KRDS 토큰·Pretendard GOV·다크 모드(`e0c8d66`), 표준형 KRDS 전환(정부 블루·흰 헤더·식별 배너, `58dcd56`).
- **M2 통합 로그(라이브)** — Filebeat → Logstash → OpenSearch(ES에서 전환, `daa01bc`), category 분류 + log_level 계측 + 보존 365일(ADR-0010, `6704571`), 신호 우선(signal-first) 재구성(ADR-0011, `8374ca5`), 콘솔 `/logs` 임베드.
- **로그 어시스턴트** — 온프레미스 vLLM RAG 어시스턴트, BFF·UI·KB(ADR-0014, `f4a3580`), 워크벤치 통합(`7c2ae2b`).
- **여유 리소스(M3 → Overview 통합)** — 데이터 레이어 + UI 배지·배치 추천(ADR-0013, `ebc9479`/`3b6db0a`), 로드맵 조정(M3 흡수·M4 보류, ADR-0012, `eb3a0d3`).
- **서비스 맵** — port-exporter(포트→프로세스) + 서비스 탭(`1a69580`), v2.1 UI 재설계(`981e434`), 노드 서비스 카탈로그·GPU 모델.
- **노드 온보딩** — 온보딩 표준 + gpu-model-exporter Ansible role(ADR-0017, `705d4e0`), data03(Quadro RTX 6000 x2, `8c86a01`), data01(16.04 xenial 호환·filebeat 7.17·smartctl 벤더링, `e90738a`), ansible NOPASSWD 표준화.
- **AIOps Tier1(관찰 모드)** — RCF 이상탐지 활성 + z-score 밴드·node-hygiene(`bca7daf`), 시스템 탭 익명 대시보드(`1384de5`).
- **사용자별 귀속** — 모델·서비스 소유 계정 표시(user 라벨, `e1a001e`).
- 브랜드 마크·favicon·OG 메타(`229bf0f`/`79b3f39`), 알림 정책 스펙 + 플랫폼 로드맵(`0806c26`), Playwright 비주얼 QA(`1bbe828`).

### Changed
- 브랜치 전략 문서화(main/dev·feat/chore) + 벤더링 gitignore(`8b3dd03`).
- Grafana 임베드 정리 — kiosk + theme 병합, slug 보존 경로(`4715dda`/`b311524`).

### Fixed
- 콘솔 `/logs`를 Grafana OpenSearch 데이터소스로 전환해 동작화(`902712f`).
- 노드 드릴다운에 var-nodename 추가(Instance만으론 전환 안 됨, `3a35dd8`), instance 변수 후보 확장(`e61c23b`).
- 임베드 host 분기 — 내부 IP 접속 시 Grafana 로그인 무한 루프 해결(`d423f7f`).
- Logstash OSS에서 xpack 설정 제거(기동 실패, `fb5ef65`), 인덱스 템플릿 `_comment` 제거(OpenSearch 루트 필드 거부, `2e1da11`).
- GPU 대시보드 범례 간결화(게이지 잘림 해소, `00426e2`), a11y·디자인 폴리시(`8150919`).

[0.2.0]: 로컬 태그 예정 — feat/design-v3 → dev(PR #3) → main
[0.1.0]: 태그 v0.1.0 (2cba06b)

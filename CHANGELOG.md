# Changelog

이 파일은 KEIwi(KEI 온프레미스 연구 서버 플릿 관제 콘솔)의 주요 변경을 기록한다.

- 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)을 따른다.
- 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따른다.
- **이 저장소는 KEI 내부 전용이다** — 외부 공개·재배포 금지(LICENSE 참조).
- 카테고리: Added(추가) / Changed(변경) / Fixed(수정) / Removed(제거) / Security(보안).
- "라이브"는 실제 가동·검증된 것, "1차/미완"은 도입만 되고 후속이 남은 것을 뜻한다.

## [Unreleased]

### Added
- **코드 그래프 `/graph`** — graphify(`extract --code-only`) AST 산출물을 파일 단위 의존 그래프로 시각화. LLM 호출 0·egress 0·신규 npm 의존성 0, 서버 렌더 SVG라 JS 없이도 보인다. 배치는 해바라기(연결 많은 파일이 중심) — 커뮤니티 원형 배치는 이 레포 규모에서 커뮤니티가 80개로 쪼개져 그림이 뭉개져 폐기했다.
- **어시스턴트 ollama 백엔드** — `VLLM_BACKEND`(openai|ollama). ollama의 OpenAI 호환 레이어는 thinking을 끌 수 없어 reasoning 모델 응답이 빈 채로 잘린다(실측) → 네이티브 `/api/chat` + `think:false`만 동작.
- **서버 fetch 타임아웃** — `lib/http.ts`에 데이터원별 상한(Prometheus 5s·OpenSearch 10s·LLM 180s). 상한이 없어 어시스턴트가 전역 429로 잠길 수 있었다(동시 1요청 제한).

### Fixed
- **거짓 초록 3건** — ① 서비스 탭이 GPU 수집 실패를 "프로세스 없음"으로 표시(data03이 17 GiB 쓰는 중에 노는 서버로 읽힘) ② 현재 신호 패널·③ 로그 워크벤치가 OpenSearch 조회 실패를 "지금 신호 없음(정상)"으로 접음 — 인시던트 탐지의 1차 진입점이다. 전부 "판정불가"로 분기하고 근거·런북을 함께 노출.
- **LAN IP 접속 시 하이드레이션 사망** — dev 서버를 LAN IP로 열면 `allowedDevOrigins`가 HMR WebSocket을 거부해 모든 클릭·토글이 무반응이 된다("탭·테마·분석 버튼" 신고 3건의 공통 원인). 값 주입으로 해소하고, `.env.local`이 커밋되지 않아 재발하므로 dev 기동 시 경고 + docs/testing.md에 증상→원인→조치.
- **GPU 수집 실패 판정 스코프** — 노드 단위 임계에 플릿 합계를 먹여 카드가 여러 장이면 상시 오탐, 동시에 노드별 실패는 미탐이던 것을 노드별 판정으로 교정.
- **PromQL 노드 살균 fail-open** — 살균 결과가 비면 셀렉터가 사라져 플릿 전체가 반환되던 것을 fail-closed로.

### Changed
- `loadInventory()`에 `React.cache` — Overview 1회 렌더에 3회 실행되던 파일 읽기+YAML 파싱+zod 검증.
- 콘솔 패치노트(`/changelog`)에 2026-08-05~12 항목 9건 추가.

## [0.3.0] - 2026-08-11

L2 승인 실행기 · 모델 운영(model-ops) v1 · Overview 탭 회귀 수정. feat/l2-approval → dev(PR #18) → main(PR #19).

### Added
- **L2 승인 실행기(구현 완료·파일럿 전)** — 알림→L1 제안을 사람이 CLI로 승인해 실행하는 결정론 실행기(`infra/alert-relay/remediation_l2.py`, ADR-0026). 상태를 바꾸는 지점은 이 파일의 `subprocess.run` **정확히 1회**뿐이고 게이트가 그것을 강제한다. dry-run 기본 · 실행 전 7단계 재검증(승인 이벤트·런북 SHA·명령 근거성·정책) · append-only 감사 원장(`/var/log/keiwi/remediation.jsonl`). fail-open 3건(무기록 실행·손상 원장·TOCTOU) 차단.
- **모델 운영(model-ops) v1** — `/models` 탭: 노드×GPU 서빙 현황(모델·포트·소유자·VRAM) + 설치 모델 카탈로그 + **VRAM 사전판정 4단**(가능/빠듯/불가/판정불가). vLLM이 가중치가 아니라 `--gpu-memory-utilization`만큼 예약하는 특성을 반영한 2겹 판정식이고, "빠듯"에는 권장 util을 수치로 제시한다. 메트릭 결손은 "판정불가"로 정직 표기(ADR-0013 계승).
- **모델 카탈로그 전수조사 수집기** — `roles/model-catalog`가 각 노드에서 디스크 스캔 + `ollama list`를 `keiwi_installed_model_size_bytes`로 노출한다. **신규 포트·scrape job·ufw 규칙 0**(node-hygiene이 검증한 textfile 배관 재사용). 스캔 루트 접근 실패는 `keiwi_model_catalog_dir_ok=0`으로 "모델 0개"와 구분.
- **런북 2건** — `home-migration-to-data`(`/home`을 RAID6 배열로 이전하는 사용자별 bind mount 절차) · `nvidia-driver-mismatch`(커널↔유저스페이스 불일치 판별·수복).
- **specs** — model-ops(서빙 가시화·판정·기동/정지, Q1~Q4 미결) · auto-remediation 사다리 L0~L4 · fleet-hardening · external-watchdog.

### Fixed
- **Overview 탭 무반응** — 시스템·GPU·모델·서비스 탭이 `useState`에만 의존해 **하이드레이션이 실패하면 통째로 죽었다**(SSR HTML은 정상이라 원인 파악도 어렵다). 활성 상태를 `?tab=` URL로 옮겨 탭을 `<Link>`로 만들었다 — JS OFF에서도 전환·iframe 교체가 동작함을 회귀 테스트로 확인. 노드를 선택하면 탭이 시스템으로 튕기던 문제도 같이 해소(딥링크·뒤로가기 부수 효과).
- **VRAM 판정 오판** — 가중치가 GPU 총량을 넘는 모델(61 GiB)이 유휴 44 GiB GPU에서 "가능"으로 나오던 검사 순서 결함. 시각 QA가 잡았고 회귀 테스트 2건 추가.
- **모델 카탈로그 수집기 shellcheck SC2043** — 스캔 루트가 1개인 노드에서 렌더된 루프가 정적으로 판정되던 문제, 배열 수신으로 교정.

### Changed
- **NVIDIA 정합성 메트릭 일원화** — hardware-ops T0-1의 자체 구현안을 폐기하고 fleet-hardening T1-3 산출물(6종: 위 4종 + `node_nvidia_probe_ok`·`node_nvidia_smi_exit_code`, 유저스페이스 경로를 `readlink -f`로 해석)을 인수했다. 자체안을 넣었다면 data01 legacy에서 깨지는 회귀였다.
- **inventory 드라이버 실측 반영** — `driver`·`kernel_module` 필드 신설(418.39 / 595.71.05 open / 535.309.01 / 595.84). data05가 proprietary로 로드돼 data03(open)과 플레이버가 갈린 상태 — 표준은 ADR-0020(신설 예정)에서 확정한다.
- **AC-3-2 개정(정직성)** — data05 재부팅(T0-4)이 탐지 배포·증거 보존보다 **먼저** 일어나 `node_nvidia_version_mismatch`의 1→0 전이가 시계열에 남지 않았다. 스펙이 "되돌릴 수 없는 순서 제약"으로 경고한 그 위반이 실제로 발생했고, 해당 AC는 재발 시 검증 항목으로 전환했다. 현재의 `= 0`은 "고쳤다"가 아니라 "현재 정합"만 뜻한다.

### Security
- **PUBLIC 레포 안전** — 이전 런북 초안이 연구자 실계정·홈 상세 경로를 담고 있던 것을 게이트(`check-public-safety` P3)가 차단, 익명 대체본(user1~user6)으로 교정하고 실제 대상은 작업 시점 명령으로 뽑도록 절차화했다.

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

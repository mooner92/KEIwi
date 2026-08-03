# 알림 보강 (Alert Enrichment)

> **한 문장: 2026-08-03 첫 실전 알림이 증명한 4가지 결함 — 리터럴 템플릿·빈약한 컨텍스트·딥링크 부재·수동 30분 추적 — 을 4단계로 닫는다.**
>
> 알림은 정확히 발화했다. 그런데 제목에는 `{{ .instance }}`가 그대로 찍혔고,
> 본문은 "사용률 90% 초과" 한 줄이었고, 클릭할 곳은 낡은 문서 링크뿐이었고,
> 원인(누가·언제·무엇으로)은 사람이 30분 동안 df→du→find→소유자로 손추적했다.
> 이 스펙은 그 30분을 "알림 도착 즉시 0분(E1·E2) + 스레드 답글 1~3분(E3·E4)"으로 만든다.

- 작성 2026-08-03. 상태: **스펙 초안 — E1은 오늘 배포 가능한 크기.**
- 권위: 헌장(§9 기계 검증 · §11 에이전트 생성/사람 적용 · §12 라이브 직접수정 금지 · §13 시크릿 레포 밖 · §15 알림 노이즈 최소화) + "어시스턴트는 조치를 자동 적용하지 않는다 — 읽기 전용, 근거 번호와 함께 출발점만 제공".
- 이 폴더가 알림 보강의 **단일 진실원(SoT)**이다. 수치는 2026-08-03 실전 사건과 같은 날 실측이다. 추정은 [가설], 미검증 문법은 [검증 필요]로 표기한다.

---

## 1. 왜 이 스펙이 존재하나 — 실전 사건 1건, 결함 4종

### 1.1 사건 타임라인 (2026-08-03, 전부 실측)

| 시각 | 일 |
|---|---|
| 17:45~17:48 | data04에서 sunakang이 tensorflow venv 2개(각 1.1G) 설치 |
| 17:59 | **DiskUsageHigh data04 발화** — 첫 실전 알림. Slack 제목에 `{{ .instance }}` 리터럴 노출 |
| ~18:30 | 사람이 수동 추적 완료(약 30분): `/` 95% → `/home` 303G(jhkim 134G·mhchoi 76G·sunakang 30G) → `find -mtime` 최근 대형 파일 → 소유자 확인 |

### 1.2 결함 4종

1. **리터럴 템플릿** — 제목·라벨의 `{{ $labels.instance }}`가 `{{ .instance }}`로 깨져 노출. 원인은 §1.3.
2. **빈약한 메시지** — "사용률 90% 초과" 한 줄. 마운트포인트·현재값·임계·시작시각 전부 없음.
3. **딥링크 부재** — 콘솔·드릴다운으로 가는 링크 없음. runbook_url은 발화 단어조차 없는 낡은 문서를 가리킴(fleet-hardening §1.4가 이미 실측).
4. **귀속 부재** — 누가·언제·어떤 의도의 작업으로 발생했는지 자동으로 알 수 없음. 30분 수동 추적.

### 1.3 근본 원인 교정 — 초기 오진을 바로잡는다

초기 진단은 "Grafana가 규칙 라벨 템플릿을 렌더하지 않는다"였다. **틀렸다.**
정확한 원인: **파일 프로비저닝의 환경변수 보간이 `$labels`를 삼킨다.** Grafana는 모든 프로비저닝 YAML에서 `$VAR`을 환경변수로 치환하며, 미정의 변수 `labels`는 빈 문자열이 되어 `{{ $labels.instance }}` → `{{ .instance }}`만 남고, 이는 라벨/주석 템플릿 문맥에서 무효라 리터럴로 흐른다. 공식 문서가 이 충돌과 이스케이프(`$$`)를 명시하고, GitHub #78118이 동일 증상(프로비저닝만 문제, UI 생성 규칙은 정상)을 보고한다.
[출처: grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/file-provisioning/ · github.com/grafana/grafana/issues/78118]

실측: `infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml`에 이스케이프 안 된 `$labels`가 **dev 16곳**(node 라벨 8 + summary 8), W1 브랜치(chore/gate-toolchain, 4c8b709)에는 **24곳**(주석 1곳 별도). W1은 GpuTempHigh 92°C 오기를 고쳤지만 **이 버그는 그대로다.**
파생 결함: `node` 라벨이 전 인스턴스 동일 리터럴이라 `notification-policies.yaml:23-25`의 `group_by:[alertname,node]` 노드별 그룹핑이 무력하다.

---

## 2. 4단계 — 각 단계는 독립 배포 가능

| 단계 | 내용 | 신규 컴포넌트 | 알림 경로 의존 | 크기 |
|---|---|---|---|---|
| **E1 메시지 수리** | `$$` 이스케이프 + 현재값·마운트·임계·지속 + notification 템플릿 그룹 | 0 (프로비저닝 파일만) | 없음 (Grafana 단독) | **오늘 배포 가능** |
| **E2 딥링크** | 규칙 annotation에 드릴다운·콘솔 딥링크 + 콘솔 파라미터 소보수 | 0 | 없음 | 이번 주 |
| **E3 스레드 보강** | 웹훅 중계(alert-relay) → Slack 직접 게시(ts 확보) → 스레드에 LLM 분석 답글 | **relay 1개**(유일한 신규 서비스, data05) | **생김 — §4 트레이드오프** | 섀도 2주 포함 |
| **E4 귀속** | df/du/find/owner 스크립트화 + journald COMMAND 검색 + 로컬 LLM 의도 요약 | collector 스크립트(read-only) | 없음 (스레드 답글에만 첨부) | 단계적 |

**독립성**: E1·E2는 Grafana 프로비저닝 파일만 고친다. E4의 수집기는 E3 없이도 CLI로 단독 실행 가능하다(알림 오면 사람이 한 줄 실행 — 수동 30분이 수동 30초가 된다). E3만이 유일하게 새 서비스를 만들며, 섀도 기간 동안 기존 Grafana 직송 경로를 건드리지 않는다.

### 게이트 질문 (단계 간 관문 — 게이트형 SDD)

| 게이트 | 질문 | 통과 판정 |
|---|---|---|
| E1→E2 | 다음 발화(테스트 포함)에서 Slack만 보고 "df 단계"를 생략할 수 있었나? | 메시지에 현재값·마운트·시작시각 확인(AC-E1-6) |
| E2→E3 | 클릭 1번으로 그 노드·그 시간창의 분석 문맥에 도착하나? | AC-E2-2·E2-3 |
| E3 섀도→컷오버 | 섀도 2주간 중계 유실 0건 · 기본 게시 지연 p95<5s · 2차 답글이 유용했나(사람 판정) | AC-E3 전체 + 관찰 로그 |
| E4 0단계→1단계(psacct) | **실사건 2건 이상에서 0단계 귀속이 불충분했나?** 충분하면 1단계는 영구 보류 | 사건 기록 리뷰 |
| E4 1단계→2단계(auditd/eBPF) | psacct로도 불충분 + 프라이버시·부하 근거를 ADR로 통과했나? | ADR 승인 |

---

## 3. 기존 자산·스펙과의 관계 — 새로 만드는 것이 가장 적은 경로

| 자산/스펙 | 관계 |
|---|---|
| 콘솔 로그 어시스턴트 (`apps/console/src/lib/assistant.ts`) | **그대로 재사용.** `POST localhost:3105/api/assistant`가 라이브이고 인증 미들웨어 없음 — E3가 코드 분리 없이 호출한다. 동시 1요청(429)·502는 relay가 직렬화·재시도로 흡수 |
| OpenSearch `keiwi-logs-*` (journald→Filebeat 인입) | **sudo 경유 명령 귀속은 수집기 추가 없이 지금 된다** — data04 `COMMAND=` 307건/24h 실측. E4 0단계의 절반이 공짜 |
| `contact-points.yaml` bot token + api.slack.com | 같은 토큰으로 `chat.postMessage`+`thread_ts` 가능(추가 스코프 불필요). E3의 전제 [출처: api.slack.com/methods/chat.postMessage] |
| `specs/alerting/spec.md:256` | "모든 알림에 runbook_url + `__dashboardUid__`/`__panelId__` 필수" 정책 — E2가 그 이행이다 |
| `specs/sre-addons/aiops-beyond-chat.md` 2-4 | "알림 조사 패키지 자동 생성" 아이디어 — E3+E4가 그 축소 구현(결정적 수집 + 단발 LLM 해석) |
| `specs/fleet-hardening` 축3 (W1) | runbook_url 전면 교체·규칙 9→14는 그쪽 소관 — **재정의 금지.** 이 스펙의 이스케이프 픽스를 W1 브랜치에도 반영해야 한다(T-E1-6, 병합 순서 조율) |
| `specs/external-watchdog` | relay `/healthz` 감시를 얹는다(감시자를 감시하는 기존 축) |
| `specs/ownership-attribution` | "GPU/포트의 소유 계정" v1 — E4는 그 형제(디스크 변화의 소유 계정). 라벨 계약(`user`) 재사용 |
| HolmesGPT/Robusta/Datadog 패턴 | 구조만 차용(알림 선게시→스레드 후속, 결정적 수집→LLM 해석, 근거 인용 강제). **통짜 도입은 5노드·1인 규모에 과잉이라 기각** [출처: cncf.io/blog/2026/04/21/auto-diagnosing-kubernetes-alerts-with-holmesgpt-and-cncf-tools/] |

### 뒤집는 판단 1건 — 정직하게 기록

`contact-points.yaml:19-20`은 "스레딩 중계는 5노드 규모에 값어치가 아직 없다"고 적었다. E3는 이 판단을 **갱신**한다: 중계는 스레딩만이 아니라 ① LLM 분석 첨부(사건의 요구 c) ② 귀속 요약 첨부(요구 d) ③ 발생→해결 한 스레드 묶음을 한 컴포넌트로 해결하며, 업계 표준 흐름(Robusta: 알림 선게시→스레드 답글)과 일치한다. 근거와 되돌리기 조건은 **ADR로 남긴다**(T-E3-5, 번호는 `docs/decisions/` 최신 확인 후 — fleet-hardening이 0023·0024 예약).

---

## 4. 순서 제약과 트레이드오프

1. **E1이 모든 것의 선행이다.** E2의 딥링크 annotation도, E3 웹훅 payload의 summary도 E1이 고친 템플릿을 타고 흐른다. E1 없이 E3를 하면 relay가 깨진 리터럴을 그대로 중계한다.
2. **E3 컷오버 후 알림 경로가 relay에 의존한다.** 완화: ① 섀도 2주(실채널 무영향) ② systemd `Restart=always` + external-watchdog `/healthz` 감시 ③ Grafana 직송 설정을 `contact-points.fallback.yaml`로 레포에 보존 — 롤백은 파일 1개 복사+리로드(<5분, 리허설 AC-E3-6) ④ relay는 stdlib 전용 소형 코드로 유지. 상세는 spec §3.4.
3. **알림 전달은 LLM에 의존하지 않는다(불변 제약).** relay는 웹훅 수신 즉시 기본 메시지를 게시하고 200을 반환한다. LLM·수집기는 그 뒤 비동기 — vLLM이 죽어도 1차 전달은 무손실(AC-E3-2).
4. **data05만 `sudo -n` 실패** — E4 수집기의 data05 폴백 경로 필요. sudoers 교정은 hardware-ops T0-6 `[server]`(사람) 소관 — **재정의 금지**(fleet-hardening README §4.2.1이 정본).

---

## 5. 파일 지도

| 파일 | 내용 |
|---|---|
| **README.md**(이 문서) | 사건·결함·4단계·게이트·기존 스펙 관계 |
| [spec.md](./spec.md) | 단계별 문제(실측)→설계(구체 코드)→판단→**기계 검증 AC** + 위험 |
| [tasks.md](./tasks.md) | 실행 체크박스(크기·선행·`[server]` 구분) |

---

## 6. 이 스펙이 하지 않는 것 (스코프 아웃 — 암묵 누락 금지)

- **자동 조치(self-heal) 일체** — 파일 삭제·프로세스 kill·quota 집행 금지. 헌장("조치를 자동 적용하지 않는다")이며, 업계도 같은 방향이다(자동 수리 시도의 22%가 잘못된 RCA로 사건 악화 보고, HolmesGPT 기본 read-only) [출처: incident.io/blog/what-is-ai-sre-complete-guide-2026].
- **원문 명령·전체 경로의 Slack 반출** — 로컬 LLM의 "~ 의도로 보인다" 요약만 나간다. 원문은 노드/콘솔(Zero Trust 뒤) 밖으로 안 나간다(spec §4.1 프라이버시 원칙, AC-E4-3 게이트).
- **풀 auditd·eBPF 상시 수집** — 연구 노드 성능·프라이버시 비용이 편익 초과. 게이트 2개 뒤 별도 ADR로만(§2 게이트 표).
- **HolmesGPT 등 외부 프레임워크 도입** — 구조 차용으로 충분. egress 최소 원칙 유지(외부 LLM API 금지 — 전부 로컬 vLLM).
- **소프트 quota·사용량 정책 집행** — 통보·가시화까지가 이 스펙. 정책은 별건.
- **Grafana 규칙 자체의 증감·임계 변경** — `specs/alerting`(임계 프레임워크)과 fleet-hardening 축3(규칙 9→14) 소관. 이 스펙은 기존 규칙의 **메시지·링크·후속 보강**만 만진다.
- **inhibition** — 파일 프로비저닝 불가 실측(notification-policies.yaml:65-83). 현행 그룹핑 대체 유지.

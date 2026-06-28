# M2 통합 로그 — Spec (WHAT + WHY)

- 상태: 초안 (착수 2026-06-28)
- 날짜: 2026-06-28
- 권위: 이 spec은 [`Constitution.md`](../../Constitution.md)에 종속된다. 충돌 시 헌장이 이긴다.
- 원칙: **Spec이 진실의 원천**(헌장 §7). 기술스택은 여기서 다루지 않는다 → [plan.md](./plan.md).
- 관련: HOW=[plan.md](./plan.md) · 작업=[tasks.md](./tasks.md) · 근거=[research.md](./research.md)

> 무엇을·왜만. 어떻게(ELK/수집기/Grafana 연동/Ansible)는 plan.md.

---

## 목적

플릿(data01~05)의 **로그를 한 곳에 모아, 운영자가 단일 콘솔에서 검색·필터·시간범위로 탐색**하게 한다. M1(메트릭)이 "지금 상태가 어떤가"라면, M2는 **"무슨 일이 있었나"**를 로그로 추적한다.

- **WHY — 저장소 3분리 (헌장 §I-3).** 로그는 **Elasticsearch**(검색 특화)에 모은다. 메트릭(Prometheus)·도메인(관계형)과 분리.
- **WHY — 단일 콘솔 = Grafana (헌장 §I-2).** 로그도 **Grafana로 surface**해 KEIwi 콘솔에 임베드한다(M1 메트릭과 동일 패턴). 별도 뷰어(Kibana) 운영은 최소화 — 콘솔 일관성 우선.
- **WHY — 운영자 인지.** 장애·이상 징후 시 "어느 서버에서 무슨 로그가" 떴는지 빠르게 찾아 원인에 도달한다.

성공은 §수용 기준의 기계 검증으로 정의한다(헌장 §9).

---

## 범위 (in / out)

### In
1. **로그 수집** — 각 서버(data01~05)에서 로그를 중앙 저장소로 전송. 시스템 로그(journald/syslog) + 주요 앱 로그(예: vLLM/ollama).
2. **중앙 저장** — 플릿 로그를 검색 가능한 단일 저장소에 보관(**보존 기간 정책 포함** — ISM, [ADR-0010](../../docs/decisions/0010-log-taxonomy.md)).
3. **콘솔 탐색** — KEIwi 콘솔 `/logs`에서 검색 + **시간범위·서버·로그레벨·서비스/범주 필터**.
4. **레벨 표현** — error/warn/info/debug를 **색+아이콘+텍스트** 3채널로(접근성). M1 [`color.spec`](../../design-system/spec/color.spec.md) §5 로그레벨 매핑 재사용.
5. **수집 정직성** — 수집 안 되는 서버는 "데이터 없음"으로 구분(M1 US4 정신 — 부재≠장애). 분류 안 되는 서비스는 **`unknown`/`user-session`으로 정직하게** 두고 에러로 위장하지 않는다.
6. **서비스 인지형 분류** — 운영자가 장애 주체(웹·GPU·시스템 등)를 빠르게 짚도록 로그를 **`category`(단일 keyword)** 로 분류. 주 신호는 `service`(=systemd.unit)이며, **포트스캔은 보조 신호일 뿐 주 분류기가 아니다**(드리프트 차단, §7). 근거 [ADR-0010](../../docs/decisions/0010-log-taxonomy.md).

### Out
- 로그 기반 **알림**(M5) · **장애 타임라인**(M4) · APM/분산 트레이싱.
- 1·2·3번 서버 수집은 **SSH 터널/접근이 준비된 서버부터**(M1과 동일 — 4·5 우선).

---

## 사용자 스토리

운영자(admin) 관점.

- **UL1 — 한 곳에서 검색.** 여러 서버 로그를 콘솔 하나에서 검색·필터하고 싶다(서버마다 ssh 들어가지 않고).
- **UL2 — 필터.** 시간범위/서버/레벨(error·warn·info)로 좁혀 보고 싶다.
- **UL3 — 메트릭↔로그 연계.** 메트릭 이상 시점의 로그로 바로 이동하고 싶다(M1 Grafana와 같은 시간축).
- **UL4 — 접근성.** 레벨을 색만이 아니라 아이콘+텍스트로 구분하고, 키보드로 탐색하고 싶다.
- **UL5 — 정직한 수집.** 수집 안 되는 서버를 "장애"가 아니라 "데이터 없음"으로 보고 싶다.
- **UL6 — 장애 주체 식별.** 공용 서버에서 누가 에러를 냈는지(웹·GPU·jupyter·OpenFOAM 등) **범주/서비스로 좁혀** 빠르게 원인 주체에 도달하고 싶다. 대화형 작업(jupyter/OpenFOAM)은 로그를 보려면 **유닛으로 띄워야** 잡힌다([ADR-0010](../../docs/decisions/0010-log-taxonomy.md) §대화형).

---

## 수용 기준 (기계 검증 가능)

- [ ] 각 대상 서버의 로그가 **중앙 저장소에 수집**된다(쿼리로 서버별 최근 로그 확인).
- [ ] 콘솔 `/logs`에서 **검색 + 시간범위/서버/레벨 필터**가 동작한다.
- [ ] 로그레벨이 **색+아이콘+텍스트**로 구분된다(색 단독 금지, 색각이상 대응).
- [ ] 수집 안 되는 서버는 **"데이터 없음"**(down 아님)으로 표기.
- [ ] 콘솔은 저장소를 **읽기만**(쓰기 없음). 시크릿은 레포 밖(§13).
- [ ] 단일 콘솔 원칙(§I-2) 준수 — 로그 뷰는 Grafana 임베드(콘솔 재구현 아님).
- [ ] **분류** — `category`(gpu·web·infra·system·user-session·unknown) terms 집계가 실측 유닛대로 갈린다(스캔 없이 systemd.unit 기반). 미분류는 `unknown`/`user-session`으로 노출(에러 위장 금지).
- [ ] **보존** — `keiwi-logs-*`에 ISM 정책이 부착되어 보존 기간이 강제된다(`_plugins/_ism/explain`로 확인).
- [ ] **신호 우선** — `/logs` 첫 화면이 raw firehose가 아니라 에러·경고 중심(레벨 기본 error+warn, 노이즈 제외, 전체 raw는 접힌 행). 평소 신호 0~소수, 장애 시 부각([ADR-0011](../../docs/decisions/0011-signal-first-log-ux.md)).

---

## 미해결 질문 (openQuestions)

1. **log_level 다운그레이드** — ✅ *해소(2026-06-28): 불필요*. 계측 결과 priority 추출 버그(`[log][syslog][priority]` 경로) 수정 후 가동 — error/warn은 진짜(vLLM body ERROR + rsyslog의 정당한 priority=4 warn)라 인플레가 아님. PRIORITY→warn 다운그레이드는 진짜 신호를 숨길 위험이라 미적용. 노이즈는 [ADR-0011](../../docs/decisions/0011-signal-first-log-ux.md)로 대시보드 제외·발생원 차단.
2. **대화형 워크로드(jupyter/OpenFOAM)** — ✅ *결정(2026-06-28): 현재 불필요*. 유닛화 표준화·command_line 분류 모두 보류. `user-session`에 정직하게 둔다(필요해지면 유닛화, [ADR-0010](../../docs/decisions/0010-log-taxonomy.md)).
3. **GPU 가속 simulation** — ✅ *결정(2026-06-28): 현재 고려 안 함*. 단일 `category`로 가고 누락 수용. 필요 시 boolean 교차 플래그 재검토.
4. **보존 기간** — ✅ *결정(2026-06-28): 365일*(디스크 여유 확인). `keiwi-logs-ism.json` `min_index_age=365d`. 줄이려면 한 줄.
5. **포트 디스커버리(요구 b)** — 보류. P2 보조 카탈로그로라도 추진할지, 완전 폐기할지(OpenFOAM 포트 없어 목표 미달).
6. **과거 인덱스 소급** — 신규 keyword 미소급. 과거 미분류 수용 vs reindex 비용(소급 불요면 자연 소멸).

---

## 비범위

- 알림(M5)·장애추적(M4)·도메인 DB. infra 스택은 **에이전트 생성, 사람 적용**(§11). 라이브 직접 수정 금지(§12).

---

## 의존 결정 (ADR — plan.md에서 확정)

| 결정 | 후보 | 비고 |
|---|---|---|
| 로그 저장소 | Elasticsearch(§I-3 명시) | 확정적 |
| 수집기(shipper) | Filebeat / Fluent-bit / Logstash | plan.md |
| 콘솔 뷰 | Grafana(ES datasource) 임베드 / Kibana | §I-2상 Grafana 우선 |
| 스택·에이전트 배포 | docker-compose(data05) + 수동 / **Ansible** | plan.md + ADR |

> 모든 의존성·기술 선택은 ADR로 근거를 남긴다(§8).

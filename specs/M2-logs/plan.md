# M2 통합 로그 — Plan (HOW)

- 상태: 완료(라이브 — 잔여는 [tasks.md](./tasks.md) 백로그)
- 권위: [spec.md](./spec.md) 종속. 헌장 우선.
- 관련: 작업=[tasks.md](./tasks.md) · 근거=[research.md](./research.md) · 결정=[ADR-0008](../../docs/decisions/0008-log-pipeline.md)(로그 파이프라인)/[ADR-0009](../../docs/decisions/0009-ansible-config-mgmt.md)(Ansible)

> 무엇·왜=spec.md. 여기선 **어떻게**(아키텍처·기술·배포·단계).

## 1. 기술 컨텍스트 (사용자 확정)
- 저장소 = **Elasticsearch**(헌장 §I-3). 단일 노드(data05), 8.x, security off(내부망+Cloudflare Access, 시크릿 없음).
- 수집 = **Filebeat(각 서버) → Logstash(data05, 파싱/정규화) → ES**.
- 뷰 = **Grafana(Elasticsearch datasource)** Logs 패널 → KEIwi 콘솔 `/logs` 임베드(헌장 §I-2 단일 콘솔, M1 메트릭과 동일 패턴). Kibana 미사용.
- 배포 = **Ansible**(infra/ansible/) — Filebeat 설치·설정 멱등 일괄. ELK 스택은 data05 docker-compose.
- 범위 = **data04·data05 먼저**.

## 2. 헌장 체크
| 조항 | 준수 |
|---|---|
| §I-2 단일 콘솔=Grafana | 로그 뷰=Grafana 임베드, Kibana 미사용 |
| §I-3 저장소 3분리 | 로그→ES (메트릭=Prometheus와 별도) |
| §I-4 Pull/수집 | Filebeat가 push하나 중앙 수집 모델 — ADR-0008에 근거 |
| §6 지루한 기술 | ELK·Ansible 표준 스택 |
| §8 의존성=ADR | ADR-0008/0009 |
| §11 사람이 적용 | 에이전트는 infra/에 생성, 사람이 data05/서버에 적용 |
| §13 시크릿 | 비번/토큰 레포밖, .example만 |

## 3. 아키텍처 — 데이터 흐름
```
[각 서버 data04·05]  journald + 앱로그
        │ Filebeat (Ansible로 설치/설정)
        ▼  beats:5044
[data05]  Logstash  ── 파싱/정규화 ──▶  Elasticsearch (keiwi-logs-*)
                                              │ ES datasource
                                              ▼
                                         Grafana (Logs 대시보드 uid=keiwi-logs)
                                              │ iframe kiosk
                                              ▼
                                       KEIwi 콘솔 /logs (임베드)
```
**필드 표준(Logstash 보장):** `@timestamp` · `fleet_node`(data04|data05) · `log_level`(error|warn|info|debug) · `service`(systemd.unit) · `message` · `host_name` · **`category`**(gpu·web·infra·system·user-session·unknown, [ADR-0010](../../docs/decisions/0010-log-taxonomy.md)) · **`log_level_source`**(body|priority|default, 계측용). → Grafana 변수 `node`·`level`·`category`로 필터(spec UL2/UL6).

> ⚠️ 저장소는 [ADR-0008 개정](../../docs/decisions/0008-log-pipeline.md)으로 **OpenSearch**(ES 7.10 호환). Grafana는 **grafana-opensearch-datasource** 플러그인(내장 elasticsearch가 v13에서 깨짐, [ADR-0010](../../docs/decisions/0010-log-taxonomy.md)). 운영 절차는 [infra/logging/README](../../infra/logging/README.md).

## 4. 인프라 산출물 (infra/, 에이전트 생성·사람 적용)
- `infra/logging/docker-compose.yml` — ES(단일노드)+Logstash (data05).
- `infra/logging/logstash/` — logstash.yml · pipeline/logs.conf(파싱).
- `infra/logging/filebeat/filebeat.yml` — 참조 표준(실배포는 Ansible 템플릿).
- `infra/monitoring/grafana/provisioning/datasources/elasticsearch.yaml` + `infra/monitoring/dashboards/logs.json`(uid keiwi-logs).
- `infra/ansible/` — inventory + roles/filebeat + playbooks/logging.yml.

## 5. 콘솔 (apps/console — M2 범위 In)
- `/logs` placeholder → **Grafana 로그 대시보드 임베드**(메트릭과 동일 GrafanaTabs 재사용).
- env `GRAFANA_LOGS_DASHBOARD_UID` 추가(uid|label). 미설정 시 안내 패널.
- 브레드크럼+페이지헤더(KRDS 셸) 적용.

## 6. 배포 순서 (사람, §11)
1. [data05] `infra/logging` 스택 기동(ES+Logstash) — compose.
2. [data05] Grafana ES datasource + 로그 대시보드 import.
3. [data05→서버] Ansible로 Filebeat 설치/설정(data04·05).
4. [console] `.env.local`에 `GRAFANA_LOGS_DASHBOARD_UID` 설정 → 재시작.

## 7. 단계
| Phase | 산출 | 상태 |
|---|---|---|
| 0 정렬 | 4결정(뷰/수집기/배포/범위) | ✅ |
| 1 스펙 | spec.md | ✅ |
| 2 설계·설정 | plan + ADR + infra 설정 + 콘솔 배선 | ✅ |
| 3 스택 기동 | OpenSearch+Logstash(사람) | ✅ |
| 4 에이전트 | Filebeat(Ansible, data04·05) | ✅ |
| 5 뷰 | Grafana(OpenSearch ds) + 콘솔 `/logs` | ✅ |
| 6 검증 | 수집 확인·필터·README | ✅ |
| 7 분류·교정 | category 사전 + log_level 교정(priority 버그 수정) + ISM([ADR-0010](../../docs/decisions/0010-log-taxonomy.md)) | ✅ |
| 8 신호 우선·노이즈 | 신호 우선 대시보드 + 노이즈 제외 + rsyslog 근본수정([ADR-0011](../../docs/decisions/0011-signal-first-log-ux.md)) | ✅ |

**Phase 7 (서비스 인지형 — measure-first 게이트).** 산출물은 생성됨(사람이 적용):
1. `infra/logging/logstash/pipeline/service-category.yml` — service→category 사전(생성됨).
2. `infra/logging/elasticsearch/keiwi-logs-template.json` — `category`·`log_level_source` keyword 추가(생성됨) → 사람이 PUT 먼저.
3. `infra/logging/elasticsearch/keiwi-logs-ism.json` — 30일 보존(생성됨) → 사람이 PUT.
4. `logs.conf` §3b translate + §4 grok 교정 + `log_level_source` — [README](../../infra/logging/README.md)에 정확한 코드. **measure-first**: rubydebug로 user@ 필드보존·error 인플레 계측 후 적용(priority 다운그레이드는 계측 후 결정).
- 대화형(jupyter/OpenFOAM): 유닛화 권장(P1). 포트 디스커버리: 거절/보조(P2). 상세 [ADR-0010](../../docs/decisions/0010-log-taxonomy.md).

## 8. 검증 전략
- 콘솔 `npm run verify` + `/logs` 임베드 스크린샷(KRDS 셸·한 화면).
- 파이프라인: ES에 `keiwi-logs-*` 인덱스 생성 + 서버별 최근 로그 쿼리.
- Grafana 로그 대시보드 node/level 필터 동작.

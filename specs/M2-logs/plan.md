# M2 통합 로그 — Plan (HOW)

- 상태: 진행 중
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
**필드 표준(Logstash 보장):** `@timestamp` · `fleet_node`(data04|data05) · `log_level`(error|warn|info|debug) · `service` · `message` · `host_name`. → Grafana 변수 `node`(fleet_node)·`level`(log_level)로 필터(spec UL2).

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
| 2 설계·설정 | plan + ADR + infra 설정 + 콘솔 배선 | 진행 |
| 3 스택 기동 | ES+Logstash(사람) | ⬜ |
| 4 에이전트 | Filebeat(Ansible) | ⬜ |
| 5 뷰 | Grafana 대시보드 + 콘솔 검증 | ⬜ |
| 6 검증 | 수집 확인·필터·a11y·README | ⬜ |

## 8. 검증 전략
- 콘솔 `npm run verify` + `/logs` 임베드 스크린샷(KRDS 셸·한 화면).
- 파이프라인: ES에 `keiwi-logs-*` 인덱스 생성 + 서버별 최근 로그 쿼리.
- Grafana 로그 대시보드 node/level 필터 동작.

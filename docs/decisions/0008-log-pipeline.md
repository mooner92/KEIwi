# 0008. M2 로그 파이프라인 (Filebeat → Logstash → OpenSearch → Grafana)

- 상태: 채택 (개정 2026-06-28 — 저장 엔진 ES→OpenSearch, 레지스트리 제약)
- 날짜: 2026-06-28

> ⚠️ **개정(2026-06-28):** 저장 엔진을 Elasticsearch → **OpenSearch**(ES의 Apache-2.0 포크, ES-API 호환)로 변경.
> **이유:** data05에서 `docker.elastic.co`(Cloudflare R2)가 ES 이미지의 큰 레이어 전송을 매번 reset(작은 요청·Docker Hub·연결 자체는 정상, IP·MSS 클램프 무관) → ES 이미지 입수 불가. OpenSearch는 Docker Hub에서 정상 입수.
> **정합:** 헌장 §I-3는 "검색 특화 저장소(Elasticsearch)"를 의도 — OpenSearch가 이를 충족(ES 7.10 포크). 데이터흐름·표준필드·인덱스 템플릿·콘솔·Logstash 정규화는 **동일**. Grafana는 Elasticsearch 데이터소스를 **OpenSearch 호환 모드**(`compatibility.override_main_response_version=true` → ES 7.10 보고)로 그대로 사용. Logstash는 OpenSearch output 플러그인. 라이선스도 Apache-2.0로 단순화(Elastic License 회피).
> **후속:** elastic.co 입수 가능해지면 ES 복귀 재검토 가능(설정 호환).

## 맥락

M2(통합 로그, [spec](../../specs/M2-logs/spec.md))의 로그 저장·수집·뷰 스택을 결정한다.

- 헌장 **§I-3**: 로그는 **Elasticsearch**(검색 특화)에 — 메트릭(Prometheus)·도메인(관계형)과 저장소 분리. → 저장소는 확정적으로 ES.
- 헌장 **§I-2**: 단일 운영 콘솔 = Grafana. 로그도 Grafana로 surface(콘솔 임베드).
- 헌장 §6(지루한 기술), §11(사람 적용), §13(시크릿).
- 사용자 결정: 콘솔 뷰=Grafana(ES datasource), 수집기=Filebeat→Logstash, 범위=data04·05 먼저.

## 결정

**Filebeat(각 서버) → Logstash(data05) → Elasticsearch(data05) → Grafana(ES datasource) → 콘솔 임베드.**

- **Elasticsearch** 단일 노드(data05 docker-compose), 8.x, `discovery.type=single-node`, `xpack.security.enabled=false`(내부망 + Cloudflare Access 뒤, 레포에 시크릿 없음). 인덱스 `keiwi-logs-%{+YYYY.MM.dd}`.
- **Logstash**(data05): beats input 5044 → 파싱/정규화(log_level·service·fleet_node·host_name·@timestamp) → ES. 필드 표준화 책임.
- **Filebeat**(각 서버): journald + 선택 앱 로그 → Logstash. 경량 수집.
- **Grafana**: Elasticsearch datasource + Logs 대시보드(uid keiwi-logs, 변수 node/level) → 콘솔 `/logs` iframe 임베드. **Kibana 미사용**(§I-2 단일 콘솔).

## 고려한 대안

- **Loki + Grafana** — Grafana 네이티브 로그 스토어라 통합은 매끈하나 **§I-3가 로그→Elasticsearch를 명시** → 기각.
- **Filebeat → ES 직행(Logstash 없음)** — 단순하나 파싱/정규화(log_level 추출·필드 통일)가 약함. 사용자가 Logstash 가공을 선택 → 채택(Filebeat→Logstash→ES).
- **Fluent-bit** — 더 경량이나 Elastic 생태계 공식은 Filebeat, 사용자 선택도 Filebeat → 기각.
- **Kibana로 뷰** — ELK 정석이나 **두 번째 콘솔**이 되어 §I-2 위배 → 기각(Grafana ES datasource로 surface).
- **ES 8 security 활성** — 내부 단일노드 + ZT 뒤라 과함, 시크릿 관리 부담(§13) → 비활성(내부망 한정, README 명시).

## 결과

- 로그가 ES에 모이고 Grafana로 단일 콘솔에서 탐색(§I-2/§I-3 동시 충족).
- 인프라는 `infra/logging/`(compose·logstash·filebeat) + `infra/monitoring/grafana/`(datasource·dashboard). 배포는 [ADR-0009](0009-ansible-config-mgmt.md) Ansible(Filebeat) + data05 compose(스택).
- 라이선스: Elasticsearch(Elastic License/SSPL)·Logstash·Filebeat·Grafana — **내부 사용**. 상업/외부 배포 시 라이선스 재검토(README 명기).
- 보안 후속: ES security off는 내부망 전제 — 외부 노출 금지(Cloudflare Access·방화벽). 추후 필요 시 활성 ADR.
- 참조: [spec](../../specs/M2-logs/spec.md), [plan](../../specs/M2-logs/plan.md), 헌장 §I-2/§I-3.

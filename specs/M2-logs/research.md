# M2 통합 로그 — Research (근거)

- 권위: [spec.md](./spec.md) 보조. 결정의 사실 근거. 상세 결정은 [ADR-0008](../../docs/decisions/0008-log-pipeline.md)/[ADR-0009](../../docs/decisions/0009-ansible-config-mgmt.md).

## 1. 저장소 = Elasticsearch (헌장 §I-3 명시)
로그→ES는 헌장이 직접 지정. 대안(Loki)은 Grafana 통합이 매끈하나 §I-3 위배 → ES 확정. 단일 노드(data05)면 docker-compose로 충분(k8s 불필요, ADR-0009 맥락).

## 2. 뷰 = Grafana(ES datasource), Kibana 미사용
헌장 §I-2(단일 콘솔=Grafana). Grafana는 ES datasource + Logs 패널/Explore로 로그 탐색 가능 → 콘솔에 임베드(M1 메트릭과 동일). Kibana는 두 번째 콘솔이 되어 §I-2 위배. 트레이드오프: Grafana 로그 UX가 Kibana보다 단순하나 일관성·단일 콘솔 우선.

## 3. 수집 = Filebeat → Logstash → ES
- Filebeat: Elastic 공식 경량 수집기. journald 지원, 각 서버 부담 적음.
- Logstash: 파싱/정규화(log_level 추출, 필드 통일) 담당 — 사용자가 가공 파이프라인 선택. Filebeat 직행 대비 필드 일관성↑.
- Fluent-bit(더 경량)는 ES 생태계 공식이 Filebeat라 제외.

## 4. 배포 = Ansible (k8s 미채택)
5대 독립 GPU 연구서버 — 클러스터 아님. k8s는 워크로드 충돌·복잡도 과다(§6 위배). Ansible(agentless, data05 control)로 "전 서버 에이전트 일괄 설치"를 멱등 달성. data04 GPU 수동 설치의 반복·삽질이 도입 근거. M1 exporter도 후속 role로 흡수 가능.

## 5. 보안(ES security off)
내부망 + Cloudflare Access(ZT) 뒤 단일노드 → xpack.security 비활성으로 단순화(시크릿 관리 부담 회피, §13). 외부 노출 금지 전제. 추후 필요 시 활성 ADR.

## 6. 콘솔 연동
M1의 GrafanaEmbed/GrafanaTabs 패턴 재사용 — `/logs`가 Grafana 로그 대시보드(uid keiwi-logs)를 kiosk 임베드. env `GRAFANA_LOGS_DASHBOARD_UID`. 미설정 시 안내 패널(M1과 동일 정직성).

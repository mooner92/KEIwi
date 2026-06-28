# M2 통합 로그 — Tasks

- 권위: [spec.md](./spec.md)/[plan.md](./plan.md). `[x]`=완료, `[ ]`=잔여. `[server]`=사람 적용(§11).

## Phase 0 — 정렬·결정 ✅
- [x] T001 4결정(뷰=Grafana ES / 수집기=Filebeat→Logstash / 배포=Ansible / 범위=data04·05)

## Phase 1 — 스펙 ✅
- [x] T010 spec.md (WHAT·왜)

## Phase 2 — 설계·설정 (진행)
- [x] T020 plan.md
- [x] T021 ADR-0008(로그 파이프라인) · ADR-0009(Ansible)
- [ ] T022 infra/logging: docker-compose(ES+Logstash) · logstash 파이프라인 · filebeat 표준
- [ ] T023 infra/monitoring/grafana: ES datasource provisioning · 로그 대시보드(uid keiwi-logs)
- [ ] T024 infra/ansible: inventory · roles/filebeat · playbooks/logging.yml
- [ ] T025 콘솔 /logs: env getGrafanaLogs + LogsEmbed + 페이지(브레드크럼·헤더)
- [ ] T026 .env.example: GRAFANA_LOGS_DASHBOARD_UID

## Phase 3 — 스택 기동 (사람) ⬜
- [ ] T030 [server] data05에서 infra/logging compose 기동(ES+Logstash), 볼륨/메모리 확인
- [ ] T031 [server] ES 헬스 + Logstash 5044 수신 확인

## Phase 4 — 에이전트(Filebeat) ⬜
- [ ] T040 [server] Ansible로 data04·05에 Filebeat 설치·설정(`ansible-playbook ... logging.yml`)
- [ ] T041 [server] keiwi-logs-* 인덱스 생성 + 서버별 최근 로그 쿼리 확인

## Phase 5 — 뷰(Grafana·콘솔) ⬜
- [ ] T050 [server] Grafana ES datasource + 로그 대시보드 import
- [ ] T051 [console] .env.local GRAFANA_LOGS_DASHBOARD_UID 설정 → 재시작
- [ ] T052 /logs 임베드 + node/level 필터 동작 확인(스크린샷)

## Phase 6 — 검증·문서 ⬜
- [ ] T060 로그레벨 색+아이콘+텍스트(색각이상) · no-data≠down
- [ ] T061 README(M2 운영: 스택·Ansible·라이선스)

## 백로그
- [ ] B01 data01·02·03 SSH 터널/접근 준비 후 Filebeat 확장
- [ ] B02 M1 exporter(node/dcgm)도 Ansible role로 흡수(수동→코드)
- [ ] B03 메트릭↔로그 시간축 연계(드릴다운)

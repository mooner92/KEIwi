# M2 통합 로그 — Tasks

- 권위: [spec.md](./spec.md)/[plan.md](./plan.md). `[x]`=완료, `[ ]`=잔여. `[server]`=사람 적용(§11).

## Phase 0 — 정렬·결정 ✅
- [x] T001 4결정(뷰=Grafana ES / 수집기=Filebeat→Logstash / 배포=Ansible / 범위=data04·05)

## Phase 1 — 스펙 ✅
- [x] T010 spec.md (WHAT·왜)

## Phase 2 — 설계·설정 ✅
- [x] T020 plan.md
- [x] T021 ADR-0008(로그 파이프라인) · ADR-0009(Ansible) · ADR-0010(분류·보존)
- [x] T022 infra/logging: docker-compose(OpenSearch+Logstash) · logstash 파이프라인 · filebeat 표준
- [x] T023 infra/monitoring/grafana: OpenSearch datasource provisioning · 로그 대시보드(uid keiwi-logs)
- [x] T024 infra/ansible: inventory · roles/filebeat · playbooks/logging.yml
- [x] T025 콘솔 /logs: env getGrafanaLogs + LogsEmbed + 페이지(브레드크럼·헤더)
- [x] T026 .env.example: GRAFANA_LOGS_DASHBOARD_UID

## Phase 3 — 스택 기동 (사람) ✅
- [x] T030 [server] data05에서 infra/logging compose 기동(OpenSearch+Logstash), 볼륨/메모리 확인
- [x] T031 [server] OpenSearch GREEN + Logstash 5044 수신 + 인덱스 템플릿 PUT 확인

## Phase 4 — 에이전트(Filebeat) ✅
- [x] T040 [server] Ansible로 data04·05에 Filebeat 설치·설정(`ansible-playbook ... logging.yml`, RECAP failed=0)
- [x] T041 [server] keiwi-logs-* 인덱스 생성 + by_node(data04·05) 인입 확인

## Phase 5 — 뷰(Grafana·콘솔) ✅
- [x] T050 [server] Grafana OpenSearch datasource(provisioning) + 로그 대시보드(uid keiwi-logs)
- [x] T051 [console] .env.local GRAFANA_LOGS_DASHBOARD_UID 설정 → 재시작
- [x] T052 콘솔 /logs 임베드 + 로그 표시 확인

## Phase 6 — 검증·문서 ✅
- [x] T060 콘솔 /logs 실시간 로그(레벨 색·시간범위·서버/레벨 필터) 동작
- [x] T061 infra/logging/README(스택·OpenSearch 전환·분류·보존 운영)

## Phase 7 — 서비스 인지형 분류·교정 (ADR-0010, measure-first 게이트)
산출물 생성됨, 적용은 사람(§11). 순서 준수: 템플릿 PUT → 사전+logs.conf → ISM.
- [x] T070 service-category.yml(service→category 상호배타 regex 사전) 생성
- [x] T071 keiwi-logs-template.json에 category·log_level_source keyword 추가
- [x] T072 keiwi-logs-ism.json(30일 보존) 생성
- [x] T073 ADR-0010 + README에 logs.conf §3b translate·§4 grok 교정 정확히 문서화
- [x] T074 logs.conf 구현 — §3b translate-category + grok INFO\|NOTICE + log_level_source 계측기(repo 반영). priority 다운그레이드는 계측 후로 보류
- [ ] T075 [server] **적용**(README §2.3) — 템플릿 PUT → logs.conf+사전 cp → `logstash -t` → 리로드 → category 분포 검증
- [ ] T076 [server] 적용 후 계측 — `log_level:error AND log_level_source:priority` 분포로 인플레 규모 확인 → priority 다운그레이드 여부 결정(openQuestion 1)
- [x] T077 keiwi-logs-ism.json(365일, 사용자 결정) 생성 — [ ] [server] PUT `_ism/policies/keiwi-logs-retention` + `_ism/explain` 확인
- [ ] T078 logs.json에 $category 변수 + 에러 우선 패널(service 정규식 폴백) → 사람 import

## 백로그
- [ ] B01 data01·02·03 SSH 터널/접근 준비 후 Filebeat 확장
- [ ] B02 M1 exporter(node/dcgm)도 Ansible role로 흡수(수동→코드)
- [ ] B03 메트릭↔로그 시간축 연계(드릴다운) · GPU(DCGM)↔서비스 로그 상관(P1)
- [ ] B04 대화형 워크로드 유닛화(jupyter@.service·krun) → 사전에 notebook/simulation 키 추가(P1, 게이트 통과 시)
- [ ] B05 포트 인벤토리 → 사전 보강 후보 diff(사람 머지), 메트릭 저장(P2, 선택)

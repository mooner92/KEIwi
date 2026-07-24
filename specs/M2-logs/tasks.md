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
- [x] T075 [server] 적용 — 템플릿 PUT + 그날 인덱스 매핑 선반영 + reindex(text→keyword), 파이프라인 마운트 자동 리로드, category 분포 검증(gpu·web·infra·system·user-session)
- [x] T076 [server] 계측 — priority 추출 버그 발견·수정(`[log][syslog][priority]`), log_level_source 가동(priority 151). **결론: priority→warn 다운그레이드 불필요**(인플레 아님, rsyslog가 정당하게 priority=4 warn)
- [x] T077 keiwi-logs-ism.json(365일) 생성 + [server] PUT `_ism/policies/keiwi-logs-retention`(부착 확인됨)
- [x] T078 logs.json에 $category 변수 + 에러 우선 stat/추세/상위서비스 + 데이터링크 → import

## Phase 8 — 신호 우선 UX · 노이즈 정리 (ADR-0011)
- [x] T080 신호 우선 대시보드(logs.json v3) — 레벨 기본 error+warn, 요약→추세/상위서비스→문제로그→raw 접힌행, dedup signature
- [x] T081 노이즈 제외 — `NOT service:"rsyslog.service" AND NOT message:"UFW BLOCK"`(message 토큰화 한계로 service 기준 채택). 효과: last1h 3466→0 신호
- [x] T082 [server] rsyslog 도배 근본 수정 — data04 `systemctl disable --now rsyslog`(상대경로 config 오타, journald+Filebeat 중복). 런북 `docs/runbooks/rsyslog-omfile-flood.md`
- [x] T083 [server] 기존 rsyslog 노이즈 정리 — `_delete_by_query service:rsyslog.service`(328,538건 삭제, 실패 0)
- [x] T084 문서 — ADR-0011 + 런북 + README §6·7·8 + memory `m2-logs-live`

## 백로그
- [ ] B01 data01·02 접근 준비 후 Filebeat 확장 — data03은 완료(2026-07-03 온보딩, 직접 스크랩 + filebeat 가동)
- [ ] B02 M1 exporter(node/dcgm)도 Ansible role로 흡수(수동→코드)
- [ ] B03 메트릭↔로그 시간축 연계(드릴다운) · GPU(DCGM)↔서비스 로그 상관(P1)
- [ ] B04 대화형 워크로드 유닛화(jupyter@.service·krun) → 사전에 notebook/simulation 키 추가(P1, 게이트 통과 시)
- [ ] B05 포트 인벤토리 → 사전 보강 후보 diff(사람 머지), 메트릭 저장(P2, 선택)

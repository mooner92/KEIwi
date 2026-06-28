# KEIwi M2 통합 로그 — 운영 README

> 에이전트는 생성, 사람은 적용(헌장 §11). 라이브 직접수정 금지(§12). 시크릿 레포 밖(§13).
> 결정 근거: [ADR-0008](../../docs/decisions/0008-log-pipeline.md)(파이프라인) · [ADR-0010](../../docs/decisions/0010-log-taxonomy.md)(분류·보존).

## 1. 구성 (현재 동작)

```
각 서버(data04·05) Filebeat(journald) → data05 Logstash(:5044) → OpenSearch(keiwi-logs-*)
  → Grafana(grafana-opensearch-datasource, uid keiwi-logs-es) → 콘솔 /logs(iframe)
```
- 저장: **OpenSearch**(ES 7.10 호환 모드, Apache-2.0) — `infra/logging/docker-compose.yml`. 컨테이너 `keiwi-opensearch`·`keiwi-logstash`.
- 데이터소스: Grafana **OpenSearch 전용 플러그인**(`grafana-opensearch-datasource`). 내장 elasticsearch 플러그인이 v13에서 자동업데이트 실패로 깨져 전환함(ADR-0010 결과). provisioning은 라이브 Grafana가 디렉터리 미바인드라 `docker cp`로 주입 → `docker restart grafana`.
- 표준 필드(공유 계약): `@timestamp · fleet_node · log_level · service · message · host_name` (+ ADR-0010: `category · log_level_source`).

## 2. 서비스 분류 (category) — ADR-0010

`category`는 `service`(=systemd.unit)를 운영 범주로 묶는 **상호배타 6값**: `gpu · web · infra · system · user-session · unknown`. Logstash `translate` + 외부 regex 사전으로 파생한다.

### 2.1 신규 서비스 추가 (코드 수정 불필요)
`infra/logging/logstash/pipeline/service-category.yml`에 **상호배타 anchored regex** 키만 추가(겹치면 비결정적 — 반드시 anchoring):
```yaml
"^myapp-.*": "web"     # 예: 새 웹앱 유닛
"^jupyter-.*": "notebook"   # 유닛화한 jupyter (P1)
"^openfoam-.*": "simulation" # 유닛화한 OpenFOAM (P1)
```
적용: 사전 파일을 컨테이너에 반영(아래 디렉터리는 이미 compose 볼륨 마운트됨) → Logstash가 `refresh_interval`(300s)로 자동 리로드.

### 2.2 logs.conf에 translate 블록 추가 (사람이 적용 — measure-first 게이트)
`infra/logging/logstash/pipeline/logs.conf` **§3(service 정규화) 직후**에 삽입:
```ruby
# §3b) service → category (외부 regex 사전, ADR-0010)
translate {
  id => "translate-category"
  source => "service"
  target => "category"
  dictionary_path => "/usr/share/logstash/pipeline/service-category.yml"
  regex => true
  exact => true
  fallback => "unknown"
  refresh_interval => 300
}
```
- `docker-compose.yml`이 `./logstash/pipeline` 전체를 `/usr/share/logstash/pipeline:ro`로 마운트하므로 사전 파일은 자동 반영(추가 마운트 불필요). `pipeline.yml`의 `path.config`는 `logs.conf` 단일 지정이라 `.yml` 사전이 파이프라인으로 오로딩되지 않음(안전).
- **선결 확인:** `docker exec keiwi-logstash bin/logstash-plugin list | grep translate` (OSS 이미지 번들 여부).
- **적용 전 필수(§12):** `docker exec keiwi-logstash bin/logstash -t -f /usr/share/logstash/pipeline/logs.conf` 로 구성검증. `config.reload.automatic`이 켜져 있어 잘못된 저장은 라이브를 즉시 깨뜨린다.
- §6 정리 블록의 `remove_field`가 `category`를 지우지 않게 둘 것(현재 안 지움).

### 2.3 인덱스 템플릿 선적용 (순서 중요)
`category`·`log_level_source`는 신설 keyword다. `manage_template=false`라 선적용 안 하면 동적매핑이 text로 만들어 Grafana terms·변수가 깨진다. **사전·logs.conf 적용 전에** 먼저:
```bash
curl -s -X PUT 'http://localhost:9200/_index_template/keiwi-logs' \
  -H 'Content-Type: application/json' -d @infra/logging/elasticsearch/keiwi-logs-template.json
```
→ **신규 일자 인덱스부터** 반영(과거 인덱스 소급 안 됨 — 자연 소멸).

### 2.4 검증
```bash
# category 분포가 실측 유닛대로 갈리는지
curl -s 'localhost:9200/keiwi-logs-*/_search?size=0' -H 'Content-Type: application/json' \
  -d '{"aggs":{"c":{"terms":{"field":"category","size":10}}}}'
# 파일입력 vLLM(service=vllm)이 unknown으로 안 새고 gpu로 잡히는지
```

## 3. log_level 교정 — "계측 먼저" (ADR-0010)

**실측 결과:** `error` 22%의 상당수는 **진짜 vLLM/torch ERROR 로그**(앱 verbosity)다 — stderr→PRIORITY 인플레가 아님. 따라서:
- **하지 말 것:** 모든 priority=3을 무작정 warn으로 내리기(진짜 에러를 숨김).
- **할 것 (P0, 안전):**
  1. `logs.conf` grok-level 본문 패턴에 `INFO|NOTICE` 추가, bare-token(L133 `\b(ERROR|WARNING|...)\b`)을 구조화형(`[ERROR]`·`level=error`)·줄머리 앵커로 좁혀 `0 errors`·스택프레임 오탐 축소. **본문 명시 ERROR는 계속 error 승격**(진짜 에러 보존).
  2. `log_level_source`(body|priority|default) keyword 신설 — 이게 계측기.
     ```bash
     # stderr 인플레 규모 정량화
     curl -s 'localhost:9200/keiwi-logs-*/_search?size=0' -H 'Content-Type: application/json' \
       -d '{"query":{"bool":{"must":[{"term":{"log_level":"error"}},{"term":{"log_level_source":"priority"}}]}}}'
     ```
  3. 위 분포를 본 뒤에만 PRIORITY=3→warn 다운그레이드를 결정(openQuestion).
- **앱 노이즈(vLLM ERROR) 자체 줄이기**는 앱 verbosity 설정 또는 대시보드 노이즈 필터의 영역.

## 4. 보존 (OpenSearch ISM)

`infra/logging/elasticsearch/keiwi-logs-ism.json` — 기본 **30일 후 delete**, `ism_template`로 신규 `keiwi-logs-*` 인덱스 자동 부착.
```bash
curl -s -X PUT 'http://localhost:9200/_plugins/_ism/policies/keiwi-logs-retention' \
  -H 'Content-Type: application/json' -d @infra/logging/elasticsearch/keiwi-logs-ism.json
# 부착 확인
curl -s 'localhost:9200/_plugins/_ism/explain/keiwi-logs-*?pretty'
```
- **디스크 예산:** vLLM 4.3M+ 문서가 용량을 지배 → 30일 보존 시 data05 디스크 점검. 초과 시 `gpu`만 단기 보존(별도 인덱스 라우팅) 검토.
- **함정:** `min_index_age`는 인덱스 **생성시각** 기준. `seek:head` 백필 시 과거명 인덱스(예 `keiwi-logs-2026.03.*`)가 30일 잔존(명-보존 불일치). → 백필 지양, 불가피하면 직후 cursor 복귀 + 과거명 인덱스 수동삭제.

## 5. 대화형 워크로드(jupyter/OpenFOAM) 캡처 — 유닛화 (ADR-0010)

**확인된 사실:** 셸에서 띄운 대화형 jupyter/OpenFOAM은 journald에 안 들어오거나 `user@<UID>.service`에 묻혀(command_line=systemd 매니저) 분류 불가. → 로그를 보고 분류하려면 **유닛으로 띄워야** 한다.

- **권장:** `systemd-run --user --unit=jupyter-$USER --collect jupyter lab ...` 또는 운영자가 `jupyter@.service`·`openfoam-run@.service` 템플릿 + 래퍼(`krun`) 배포. 고유 `_SYSTEMD_UNIT` 생성 → 2.1 사전에 키만 추가하면 분류됨(+ cgroup 자원회계 보너스).
- **선행 게이트(P1 착수 전):** `logs.conf` output의 `stdout { codec => rubydebug }`를 1회 켜서 user@ 이벤트의 필드 보존을 라이브 재확인.

## 6. 트러블슈팅

- **콘솔 /logs "Datasource not found":** Grafana 내장 elasticsearch 플러그인 깨짐. `grafana-opensearch-datasource` 사용 확인(ADR-0010). `docker exec grafana ls /var/lib/grafana/plugins/`.
- **docker-compose v1.29.2 `ContainerConfig` KeyError:** recreate 버그. `docker ps -aq --filter name=<svc> | xargs -r docker rm -f` 후 `up -d`(신규 생성).
- **인덱스 템플릿 PUT 400:** OpenSearch는 `_comment` 등 루트 필드 거부 — 표준 키만.

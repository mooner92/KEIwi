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

### 2.2 logs.conf §3b translate 블록 — **이미 repo에 반영됨, 적용만**
`logs.conf` §3(service 정규화) 직후에 `translate-category` 블록이 **이미 추가돼 있다**(`source=service → target=category`, 사전 `service-category.yml`, `regex/exact/fallback=unknown`).
- `docker-compose.yml`이 `./logstash/pipeline` 전체를 `/usr/share/logstash/pipeline:ro`로 마운트하므로 사전 파일은 자동 반영(추가 마운트 불필요). `pipeline.yml`의 `path.config`는 `logs.conf` 단일 지정이라 `.yml` 사전이 파이프라인으로 오로딩되지 않음(안전).
- **선결 확인:** `docker exec keiwi-logstash bin/logstash-plugin list | grep translate` (OSS 이미지 번들 여부).
- **적용:** §2.3 통합 절차 참조. `config.reload.automatic`이 켜져 있어 잘못된 저장은 라이브를 즉시 깨뜨리므로 `bin/logstash -t` 선검증 필수(§12).
- §6 정리 블록의 `remove_field`가 `category`를 지우지 않게 둘 것(현재 안 지움).

### 2.3 통합 적용 절차 (data05, 사람 — 순서 중요)
`category`·`log_level_source`는 신설 keyword다. `manage_template=false`라 **템플릿 선적용**을 안 하면 동적매핑이 text로 만들어 Grafana terms·변수가 깨진다. 반드시 ① 템플릿 → ② 파이프라인 순.

```bash
cd /KEIwi/infra/logging

# ① 인덱스 템플릿 선적용 (category·log_level_source keyword) — 신규 일자 인덱스부터 반영
curl -s -X PUT 'http://localhost:9200/_index_template/keiwi-logs' \
  -H 'Content-Type: application/json' -d @elasticsearch/keiwi-logs-template.json   # {"acknowledged":true}

# ①b 오늘 인덱스(이미 생성됨)는 템플릿 소급 안 됨 → category 문서가 들어오기 전에(=②보다 먼저)
#     매핑을 직접 선반영해 text 동적매핑을 막는다. (안 하면 오늘 분만 category.keyword 로 조회해야 함)
curl -s -X PUT "http://localhost:9200/keiwi-logs-$(date +%Y.%m.%d)/_mapping" \
  -H 'Content-Type: application/json' \
  -d '{"properties":{"category":{"type":"keyword"},"log_level_source":{"type":"keyword"}}}'

# ② 파이프라인 반영 — ⚠ pipeline 디렉터리는 호스트 :ro 마운트라 docker cp 불가/불필요.
#    git pull 이 마운트된 logs.conf 를 직접 갱신하고 config.reload.automatic 이 자동 로드한다.
#    즉 git pull 순간 새 파이프라인이 바로 라이브가 된다(아래 ①b 레이스 주의 → ⑤ 순서 권장).
#    구성검증(권장):
docker exec keiwi-logstash bin/logstash --path.settings /usr/share/logstash/config \
  -t -f /usr/share/logstash/pipeline/logs.conf      # "Config Validation Result: OK"
```
- translate 플러그인 부재로 검증이 실패하면: `docker exec keiwi-logstash bin/logstash-plugin install logstash-filter-translate` 후 재시도.
- 과거 인덱스는 keyword 소급 안 됨(자연 소멸). category/log_level_source는 **신규 일자 인덱스부터**.

> **⚠ 레이스 주의(중요).** `:ro` 마운트 + `config.reload.automatic` 때문에 `git pull` 즉시 새 파이프라인이 돌아 **그날 인덱스에 category가 text로 동적매핑**된다(템플릿 PUT보다 먼저). 이를 피하려면 **logstash를 멈추고** 받아라:
> ```bash
> docker stop keiwi-logstash && git pull
> curl -X PUT .../_index_template/keiwi-logs -d @elasticsearch/keiwi-logs-template.json
> curl -X PUT ".../keiwi-logs-$(date +%Y.%m.%d)/_mapping" -d '{"properties":{"category":{"type":"keyword"},"log_level_source":{"type":"keyword"}}}'
> docker start keiwi-logstash   # 이제 category 문서가 keyword 매핑된 인덱스로 들어감
> ```
> 이미 text 로 들어간 그날 인덱스는 §2.5 로 고친다.

### 2.5 이미 text 로 동적매핑된 그날 인덱스 고치기 (reindex, 무손실)
레이스로 `category`/`log_level_source` 가 text 가 된 인덱스는 in-place 변경 불가 → 템플릿 매핑으로 reindex.
```bash
D=$(date +%Y.%m.%d)
curl -s -X POST "localhost:9200/_reindex?wait_for_completion=true" -H 'Content-Type: application/json' \
  -d "{\"source\":{\"index\":\"keiwi-logs-$D\"},\"dest\":{\"index\":\"keiwi-logs-$D-fix\"}}"   # -fix 는 keiwi-logs-* 템플릿 → keyword
curl -s -X DELETE "localhost:9200/keiwi-logs-$D"                                                # logstash 가 다음 쓰기에 템플릿으로 재생성(keyword)
curl -s -X POST "localhost:9200/_reindex?wait_for_completion=true" -H 'Content-Type: application/json' \
  -d "{\"source\":{\"index\":\"keiwi-logs-$D-fix\"},\"dest\":{\"index\":\"keiwi-logs-$D\"}}"
curl -s -X DELETE "localhost:9200/keiwi-logs-$D-fix"
```
- 원본 로그는 각 서버 journald 에도 있으니 최악에도 안전. 다만 reindex 중 들어오는 신규 문서는 재생성 인덱스(keyword)로 정상 적재된다.
- **그날만의 문제** — 다음 일자 인덱스(`keiwi-logs-<내일>`)는 템플릿으로 처음부터 keyword 라 reindex 불필요.

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
- **구현됨 (repo `logs.conf`, §2.3로 적용):**
  1. grok bare-token에 `INFO|INFORMATION|NOTICE` 추가 — vLLM의 bare `INFO 06-28 ...` 줄이 PRIORITY 폴백이 아니라 **본문으로 정확히 info** 분류된다. **bare-token은 일부러 좁히지 않았다**(대문자 `\b(ERROR|...)\b` 유지) — vLLM의 `ERROR` 줄은 진짜 ERROR라 그대로 error 보존. 공격적 narrowing은 진짜 에러를 숨길 위험이라 보류.
  2. `log_level_source`(body|priority|default) keyword 신설 — **계측기**.
     ```bash
     # stderr→priority 인플레 규모 정량화 (적용 후 실행)
     curl -s 'localhost:9200/keiwi-logs-*/_search?size=0' -H 'Content-Type: application/json' \
       -d '{"query":{"bool":{"must":[{"term":{"log_level":"error"}},{"term":{"log_level_source":"priority"}}]}}}'
     # body 출처 error(진짜 본문 ERROR) 대비:
     #   ...{"term":{"log_level_source":"body"}}... 로도 카운트해 body:priority 비율 확인
     ```
- **보류 (계측 후 결정, openQuestion):** 위 분포에서 `log_level_source:priority`가 크면 그때 PRIORITY=3→warn 다운그레이드. body 출처 error(진짜 vLLM ERROR)는 유지.
- **앱 노이즈(vLLM ERROR) 자체 줄이기**는 앱 verbosity 또는 대시보드 노이즈 필터의 영역(파이프라인 밖).

## 4. 보존 (OpenSearch ISM)

`infra/logging/elasticsearch/keiwi-logs-ism.json` — **365일 후 delete**(사용자 결정 2026-06-28, 디스크 여유), `ism_template`로 신규 `keiwi-logs-*` 인덱스 자동 부착. 단기로 줄이려면 `min_index_age` 한 줄.
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

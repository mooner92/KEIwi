# OpenSearch 이상탐지(RCF) — 관찰 모드

내장 anomaly-detection 플러그인(RCF)을 M2 통합 로그에 활성화. **관찰 모드 원칙**
(specs/sre-addons/aiops-beyond-chat §Tier1-0): 비지도 출력은 대시보드/다이제스트 전용,
**알림/페이징 미연결**. 첫 48h는 계절 패턴 학습 중 — 튜닝 금지, 첫 2~4주 소음 특성 관찰 후
suppression rule 조정.

| detector | 무엇 | 정의 |
|---|---|---|
| keiwi-log-errors-by-node | 노드별 error/warn 로그량 이상(10m 간격, HC by fleet_node) | [keiwi-log-errors-by-node.json](./keiwi-log-errors-by-node.json) |

## 운용 (data05, 재현 명령)
```bash
# 생성 + 시작 (레포 JSON이 원본 — 라이브는 이 정의를 따른다)
ID=$(curl -s -X POST 'localhost:9200/_plugins/_anomaly_detection/detectors' \
  -H 'Content-Type: application/json' -d @keiwi-log-errors-by-node.json | jq -r ._id)
curl -s -X POST "localhost:9200/_plugins/_anomaly_detection/detectors/$ID/_start"
# 상태/결과
curl -s "localhost:9200/_plugins/_anomaly_detection/detectors/$ID/_profile/state"
curl -s 'localhost:9200/_plugins/_anomaly_detection/detectors/results/_search' \
  -H 'Content-Type: application/json' -d '{"query":{"range":{"anomaly_grade":{"gt":0}}},"size":5,"sort":[{"data_start_time":"desc"}]}'
# 중지/삭제
curl -s -X POST "localhost:9200/_plugins/_anomaly_detection/detectors/$ID/_stop"
curl -s -X DELETE "localhost:9200/_plugins/_anomaly_detection/detectors/$ID"
```
결과 시각화: Grafana keiwi 데이터소스(OpenSearch)에서 인덱스 `.opendistro-anomaly-results*`,
필드 `anomaly_grade`/`confidence`/`entity.value`(노드). 2026-07-09 활성(id zPEuRJ8BgKuBcuAw08Ta).

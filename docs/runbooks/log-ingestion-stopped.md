---
id: log-ingestion-stopped
kind: alert
alerts: [LogIngestStalled]
service: keiwi-logstash
category: infra
severity: critical
signature: "No configuration found in the configured sources"
affected_nodes: [data01, data03, data04, data05]
last_verified: 2026-08-03
# tier — 이 런북의 actions가 도달할 수 있는 최대 자율 레벨(auto-remediation spec §1·§2.3).
#   3 = L3(사전승인 자동) 후보. 수집기 재시작은 정답형·멱등·가역이고 blast가 관측 평면에
#   한정된다. **후보일 뿐이다** — 실제 승격은 ADR-0027(신설 예정) + L2 무사고 20회(earned autonomy) 뒤다.
#   지금 이 런북은 tier 3이므로 **L2(승인 후 실행) 대상**이다(ADR-0026 · remediation_l2.py).
tier: 3
actions:
  - id: inspect-logstash-config-error
    title: Logstash가 설정을 못 찾는 조용한 실패인지 확인
    risk: low
    reversible: true
    idempotent: true
    command: >-
      sudo docker logs --tail 60 keiwi-logstash 2>&1 | grep -iE 'error|exception|reload'
  - id: restart-logstash
    title: Logstash 컨테이너 재시작 (파이프라인 리로드 복구)
    risk: medium
    reversible: true
    idempotent: true
    command: >-
      sudo docker restart keiwi-logstash
  - id: verify-ingest-resumed
    title: 인입 재개 검증 (건수가 증가해야 복구)
    risk: low
    reversible: true
    idempotent: true
    command: >-
      sleep 30 && curl -s 'localhost:9200/keiwi-logs-*/_count'
---

# 런북 · 통합 로그 인입 중단 (silent stop)

> 로그가 **조용히** 멈추는 장애를 진단·복구한다. 이 장애의 무서운 점은 **아무것도 에러를 내지 않는다**는 것이다 — `systemctl`은 `active`, 포트는 열려 있고, 대시보드는 "에러 0건"을 초록으로 보여준다. 사람은 "플릿이 건강하다"고 읽는다.

> [!CAUTION] 실제 사고 (2026-07-24 ~ 07-30, 5.7일)
> 4개 노드 전체 로그가 5.7일간 중단됐고 **아무도 몰랐다.** 500만 건 상당이 OpenSearch에 적재되지 않았다.
> 발견 경로는 알림이 아니라, 다른 작업 중 우연한 조회였다. 원인은 **두 개의 독립 결함**이었다(§2·§3).
> 이 사고가 알림 계층(alert 규칙 0건) 부재의 비용을 정량적으로 보여준다 → [specs/hardware-ops](../../specs/hardware-ops/README.md) 축2.

## 1. 30초 진단 — 어디가 끊겼나

```bash
# ① 노드별 최신 로그 시각 (가장 빠른 판별)
curl -s 'localhost:9200/keiwi-logs-*/_search' -H 'Content-Type: application/json' -d '{
 "size":0,"aggs":{"n":{"terms":{"field":"fleet_node","size":10},
 "aggs":{"last":{"max":{"field":"@timestamp"}}}}}}' | python3 -m json.tool | grep -E 'key|value_as_string'

# ② 인입이 실제로 흐르는지 (증가해야 정상)
curl -s 'localhost:9200/keiwi-logs-*/_count'; sleep 20; curl -s 'localhost:9200/keiwi-logs-*/_count'
```

판독:
| 관찰 | 범인 |
| --- | --- |
| **전 노드가 같은 시각에 멈춤** | 수신측 — Logstash 또는 OpenSearch (§2) |
| **일부 노드만 멈춤** | 그 노드의 Filebeat (§3) |
| 최신 시각이 과거지만 계속 전진 | 정상 — 백로그 flush 중. 기다린다 |

수신측 생존 확인(전부 정상인데도 데이터가 안 흐르면 §2의 조용한 실패다):
```bash
ss -tlnp | grep 5044                      # Logstash beats 입력
curl -s localhost:9200/_cluster/health     # yellow는 단일노드 정상
df -h /data                                # watermark(85%↑) 확인
```

## 2. 수신측 — Logstash가 설정을 못 찾는 조용한 실패

```bash
sudo docker logs --tail 60 keiwi-logstash 2>&1 | grep -iE 'error|exception|reload'
```
`No configuration found in the configured sources.` 가 15초마다 반복되면 이것이다. **복구:**
```bash
sudo docker restart keiwi-logstash
sleep 30 && curl -s 'localhost:9200/keiwi-logs-*/_count'   # 증가하면 복구
```

> [!WARNING] 근본 원인 — git 작업이 곧 프로덕션 변경이다
> 라이브 Logstash는 파이프라인 설정을 **git 워킹트리에서 직접 `:ro`로 바인드**하고
> `config.reload.automatic`이 켜져 있다. 그래서 `/KEIwi`에서의 **모든** git 작업이 라이브 리로드를 유발한다:
> `git pull` · **`git checkout`(브랜치 전환)** · `git merge` · `git stash`.
>
> 실사고: `git checkout -b main origin/main` 으로 워킹트리가 구버전으로 되돌아간 순간
> `logs.conf`가 다시 쓰였고(mtime이 중단 시각과 정확히 일치), Logstash가 리로드하다 파이프라인이 죽었다.
> 이후 머지로 파일 내용은 복원됐지만 Logstash는 스스로 회복하지 못했다.
> [`infra/logging/README.md`](../../infra/logging/README.md) §1.2가 이 위험을 경고하지만 `git pull`만 예시로 들어
> "브랜치 전환도 같은 파일 쓰기"라는 점을 놓치기 쉽다.
>
> **예방**: `/KEIwi`에서 git 작업 전 `docker stop keiwi-logstash` → 작업 → `docker start`.
> **구조적 해결(권장)**: 라이브 설정을 git 밖 경로(`/data/monitoring/logstash/pipeline/`)로 분리하고
> 배포를 명시적 `cp`로만 하기 — 대시보드 프로비저닝이 이미 이 표준을 따른다.

## 3. 발신측 — Filebeat가 이벤트를 0건 내보내는 조용한 실패

해당 노드에서(예 data01):
```bash
ssh -p 764 "<user>@<ip>" 'sudo -n sh -c "
  systemctl is-active keiwi-filebeat
  tail -2 /var/log/keiwi-filebeat/filebeat | grep -o \"libbeat.*pipeline[^}]*}\"
  ls -l /var/lib/keiwi-filebeat/registry/filebeat/log.json
"'
```
판독 — **`systemctl active`는 아무것도 보장하지 않는다.** 볼 것은 두 개다:
- `output.events`의 `acked`/`total`이 **0이거나 증가하지 않음** → 입력이 이벤트를 못 만들고 있다
- `registry/.../log.json`의 **mtime이 멈춰 있음** → 커서가 전진하지 않는다

> [!CAUTION] 실사고 — 지원되지 않는 필터가 입력을 전멸시킴
> 자기수집 루프를 막겠다고 journald 입력에 `include_matches: [- not _SYSTEMD_UNIT=...]`를 넣었다.
> **filebeat 7.17의 journald 입력은 `not` 접두 문법을 지원하지 않는다**(8.x에서 추가).
> 지원 안 되는 표현이 조용히 "전부 불일치"로 동작해 **6일간 이벤트 0건**이었고,
> filebeat 로그에는 **ERROR가 한 줄도 없었다**(INFO 모니터링 줄만 10MB). `active`·포트 정상.
>
> 게다가 그 필터는 **처음부터 불필요**했다 — `logging.to_files: true`로 자기 로그가 journald에
> 들어가지 않으므로 루프가 생기지 않는다. **중복 방어가 유일한 입력을 죽인 사례다.**
>
> **복구**: `include_matches` 블록 제거 → `filebeat test config` → `systemctl restart`.
> 커서가 남아 있으면 중단 구간을 자동 백필한다(재적재 아님 — 커서 이후만).

**교훈으로 세운 규칙**
1. **벤더링 버전에서 지원 여부가 불확실한 옵션을 "방어적으로" 넣지 마라.** 문서에 있어도 그 마이너 버전에서 되는지 확인하라.
2. 설정 변경 후 **`active` 확인으로 끝내지 마라** — `output.events.acked`가 증가하는지, OpenSearch 건수가 증가하는지까지 봐라.
3. 조용한 실패는 **부재를 검증**해야 잡힌다. 존재를 검증하면 통과한다.

## 4. 백필 (필요할 때만)

중단 구간의 원본은 **각 노드 journald에 남아 있다**. 커서가 유지됐다면 재시작만으로 자동 백필된다.
커서까지 잃었다면 `seek: head`를 고려하되, [`infra/logging/README.md`](../../infra/logging/README.md) §3 경고를 먼저 읽어라 —
ISM `min_index_age`는 인덱스 **생성시각** 기준이라 과거명 인덱스가 보존정책과 어긋난다. 꼭 필요한 구간만.

## 5. 이 장애를 다시 5.7일간 모르지 않으려면

지금은 **alert 규칙이 0건**이라 인입 중단을 알려줄 장치가 없다. 최소 두 개가 필요하다:
- **인입 신선도(freshness)** — 노드별 최신 로그가 N분 이상 오래되면 경고. "0건"과 "안 옴"을 구분하는 유일한 지표.
- **dead man's switch** — 파이프라인이 살아있다는 하트비트가 끊기면 경고. 조용한 실패는 "문제 신호의 부재"로만 드러난다.

설계는 [specs/hardware-ops](../../specs/hardware-ops/README.md) 축2, 정책 기준은 [specs/alerting/spec.md](../../specs/alerting/spec.md).

---
id: rsyslog-omfile-flood
kind: incident                # 종결된 인시던트 기록 — 담당 알림이 없다(alerts·severity 없음이 정상)
service: rsyslog.service
category: infra
signature: "omfile' suspended"
affected_nodes: [data04]
first_seen: 2026-06-28
last_seen: 2026-06-28
occurrences: 1
status: resolved
fix_kind: root-cause
detection_query: '{"query":{"term":{"service":"rsyslog.service"}}}'
last_verified: 2026-06-28   # 처방을 data04에 실제로 적용해 검증한 날(= 인시던트 종결일)
# tier 1 = L1 제안까지. 두 조치 모두 blast가 로컬을 넘는다:
#   disable-rsyslog는 **시스템 로깅 데몬을 끄는 것**이라 `/var/log/syslog`에 의존하는 도구가
#   있으면 조용히 깨지고, purge-flood-docs는 **비가역 삭제**다(지운 문서는 안 돌아온다).
#   둘 다 "이 노드에 rsyslog 파일 출력이 정말 불필요한가"라는 사람의 판단이 선행해야 한다.
tier: 1
actions:
  - id: count-flood-by-node
    title: 어느 노드가 도배 중인가
    risk: low
    reversible: true
    idempotent: true
    command: >-
      curl -s 'localhost:9200/keiwi-logs-*/_search?size=0' -H 'Content-Type: application/json'
      -d '{"query":{"term":{"service":"rsyslog.service"}},"aggs":{"n":{"terms":{"field":"fleet_node"}}}}'
  - id: read-rsyslog-real-reason
    title: 진짜 이유는 suspended 메시지 **앞**에 있다
    risk: low
    reversible: true
    idempotent: true
    command: >-
      sudo journalctl -u rsyslog -n 80 --no-pager | grep -ivE 'suspended|retry' | tail -25
  - id: disable-rsyslog
    title: rsyslog 비활성 — journald+Filebeat와 중복일 때만
    # 되돌릴 수는 있다(enable --now). 그러나 `/var/log/syslog`를 읽는 도구가 있으면
    # 그 도구가 조용히 깨진다 — 되돌리기 전까지 무엇이 깨졌는지도 모른다.
    risk: high
    reversible: true
    idempotent: true
    command: >-
      sudo systemctl disable --now rsyslog
  - id: purge-flood-docs
    title: 기존 도배 문서 삭제 — **먼저 유입을 멈춘 뒤에만**
    risk: high
    reversible: false
    idempotent: true
    command: >-
      curl -s -X POST 'localhost:9200/keiwi-logs-*/_delete_by_query?conflicts=proceed&wait_for_completion=false'
      -H 'Content-Type: application/json' -d '{"query":{"term":{"service":"rsyslog.service"}}}'
---

# 런북 — rsyslog `omfile suspended` 로그 도배

> 한 노드의 `rsyslog.service`가 error/warn 로그를 폭주시켜 통합 로그(M2)를 덮는 현상.
> 최초 사례: **data04 (2026-06-28)** — 단일 노드에서 328,538건(전체 로그의 ~65%) 도배.
> 결정 근거: [ADR-0011](../decisions/0011-signal-first-log-ux.md).

## 증상

- 콘솔 `/logs` 또는 OpenSearch에서 특정 노드의 `service=rsyslog.service`가 `warn`(priority 4)로 대량.
- 메시지(반복): `action 'action-0-builtin:omfile' suspended (module 'builtin:omfile'), retry 0. There should be messages before this one giving the reason for suspension. [v8.2312.0 try https://www.rsyslog.com/e/2007 ]`
- 신호 우선 대시보드에선 `NOT service:"rsyslog.service"`로 가려지지만, **저장 공간을 갉아먹고** 호스트엔 실제 데몬 오류가 진행 중.

## 빠른 확인 (data05, OpenSearch — 읽기 전용)

```bash
# 어느 노드인가
curl -s 'localhost:9200/keiwi-logs-*/_search?size=0' -H 'Content-Type: application/json' \
  -d '{"query":{"term":{"service":"rsyslog.service"}},"aggs":{"n":{"terms":{"field":"fleet_node"}}}}'
# 누적량
curl -s 'localhost:9200/keiwi-logs-*/_count' -H 'Content-Type: application/json' \
  -d '{"query":{"term":{"service":"rsyslog.service"}}}'
```

## 진단 (해당 노드에서)

```bash
ssh -p 764 "<user>@<node-ip>"        # 계정은 노드별(레포에 적지 않는다) · 포트는 전부 764
df -h /var/log /var /                                 # ① 디스크 full? (흔한 원인 — 비웠다면 아님)
sudo journalctl -u rsyslog -n 80 --no-pager | grep -ivE 'suspended|retry' | tail -25   # ② 진짜 이유(앞 메시지)
grep -rsnE 'omfile|/var/log|:omfile|ActionFileDefault' /etc/rsyslog.conf /etc/rsyslog.d/   # ③ 출력 경로
ls -la /var/log/ | head -20                           # ④ 출력 파일 권한/존재
```

원인 판별:
- **① 디스크 full** → 가장 흔함. `/var/log` 정리 + logrotate 점검. 누가 채웠는지 근본 확인.
- **③에 상대경로**(예 `var/log/auth.log` — 앞 `/` 누락) → rsyslog가 상대경로로 못 써 무한 재시도. **data04 사례가 이것.**
- **②에 `Permission denied`/`No such file`** → 출력 경로 권한·부재.

## 처방

**플릿은 journald → Filebeat → OpenSearch 로 로그를 이미 받는다. rsyslog의 로컬 파일 출력은 중복이다.**

- **(권장) journald+Filebeat로 충분하면 rsyslog 비활성:**
  ```bash
  sudo systemctl disable --now rsyslog     # 도배 중단 + 저장 절감 + 데몬오류 해소
  ```
  → journald·Filebeat·콘솔 로깅에 영향 없음(rsyslog와 독립). `/var/log/syslog`·`/var/log/auth.log` 같은 파일에 의존하는 도구가 있으면 보류.
- **(대안) rsyslog를 유지해야 하면 config 수정:** `/etc/rsyslog.d/50-default.conf`의 상대경로를 절대경로로(`var/log/...` → `/var/log/...`), 또는 디스크/권한 해결 후 `sudo systemctl restart rsyslog`.

## 정리 (기존 노이즈 삭제, data05)

rsyslog를 멈춘 뒤(=새로 안 쌓임) 기존 도배 문서를 비운다(파괴적 — 사람이 실행).
```bash
curl -s -X POST 'localhost:9200/keiwi-logs-*/_delete_by_query?conflicts=proceed&wait_for_completion=false' \
  -H 'Content-Type: application/json' -d '{"query":{"term":{"service":"rsyslog.service"}}}'
# 진행: curl -s 'localhost:9200/_tasks/<task-id>'   →  "completed":true, deleted==total, failures 0
# 확인: 위 _count 가 0
```

## 검증

```bash
# 신규 유입 멈춤(분 단위 추이가 0으로)
for w in now-1m now-2m now-5m; do
  curl -s 'localhost:9200/keiwi-logs-*/_count' -H 'Content-Type: application/json' \
    -d "{\"query\":{\"bool\":{\"must\":[{\"term\":{\"service\":\"rsyslog.service\"}},{\"range\":{\"@timestamp\":{\"gte\":\"$w\"}}}]}}}"; echo " ($w)"
done
# 파이프라인 생존(해당 노드 다른 서비스가 계속 들어오는지)
```

## data04 사례 기록 (2026-06-28)

- 디스크 27%(full 아님). 원인 = `50-default.conf` 상대경로 오타(`var/log/auth.log`·`var/log/mail.err`).
- 처방 = `systemctl disable --now rsyslog`(journald+Filebeat 중복). 신규 유입 즉시 0.
- 정리 = `_delete_by_query service:rsyslog.service` → 328,538건 삭제(10s, 실패 0).
- 후속: data01~03 합류 시 동일 점검(상대경로 config가 이미지/배포로 퍼졌을 수 있음).

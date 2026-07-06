# smartctl-exporter (디스크/NVMe SMART 수집)

prometheus-community/smartctl_exporter를 각 노드에 systemd로 띄워 디스크·NVMe SMART
지표(:9633/metrics)를 수집한다. 고장 예측(재할당 섹터·마모도·온도 등)의 원천 신호.
data05(관제 + 로그 365d 보존)가 급소라 우선 대상.

- **수집만.** 알림/recording rule 미생성(사용자 알림 보류 — 헌장 정책).
- 배포: Ansible `roles/smartctl-exporter`(agents.yml의 `smartctl` play, hosts=nodes).
- Prometheus 잡: `infra/monitoring/prometheus.yml`의 `smartctl-exporter`.

## 바이너리 vendoring (egress 0)

대상 노드는 인터넷 접근이 없다(egress 0, self-host). Ansible role은 **레포에 vendored된
바이너리를 그대로 배포**한다(gpu-model/port 익스포터의 vendored 패턴과 동형).

이 디렉터리에 `smartctl_exporter`(linux-amd64) 실행 파일을 두어야 role이 배포한다:

```
infra/monitoring/smartctl-exporter/smartctl_exporter   # ← 여기 (git 미추적 권장, 바이너리)
```

바이너리는 **오프라인/사내 미러**로 확보한다. 예(egress 있는 별도 머신에서 받아 복사):

```
# prometheus-community/smartctl_exporter releases 에서 linux-amd64 tar.gz 를 받아
tar xzf smartctl_exporter-*.linux-amd64.tar.gz
cp smartctl_exporter-*.linux-amd64/smartctl_exporter \
   infra/monitoring/smartctl-exporter/smartctl_exporter
```

바이너리가 없으면 role의 사전 assert가 명확한 메시지와 함께 즉시 실패한다.
대상 아키텍처(linux/amd64)와 일치해야 한다.

> smartctl 자체(smartmontools)는 role이 apt로 설치한다 — 익스포터가 이를 shell out 한다.

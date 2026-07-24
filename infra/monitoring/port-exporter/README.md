# infra/monitoring/port-exporter · 리스닝 포트↔프로세스 익스포터

> "어느 포트에 무슨 프로그램이 떠 있나"를 노드별로 노출하는 **경량 Prometheus 익스포터**(stdlib only). 서비스 맵 v2([specs/service-map](../../../specs/service-map/spec.md) 백로그 B01)의 데이터 소스.

- **무엇**: `ss -tulnpH`(리스닝 TCP + 바운드 UDP)를 파싱해 `keiwi_listening_port_info{port,proto,process,pid} 1` 노출. `:9986/metrics`.
- **왜**: node-exporter/DCGM는 수치만, gpu-model-exporter는 GPU 모델만 준다. 임의 리스닝 포트↔프로세스는 별도 수집이 필요.
- **root 필요**: `ss -p`가 프로세스명을 보려면 root. systemd 유닛이 root로 동작(비루트면 `process=unknown`).

## 배포 (사람, §11)

**표준 = Ansible role** ([infra/ansible](../../ansible/README.md)):
```bash
cd infra/ansible
ansible-playbook -i inventory.ini playbooks/agents.yml --limit data04 -K   # NOPASSWD 아니면 -K
```
→ `/opt/keiwi/port-exporter/port-exporter.py` + `keiwi-port-exporter.service`(:9986) enable. 수동 배포는 `keiwi-port-exporter.service` 헤더 주석 참고.

## 노출 + 스크레이프

- data05: 호스트 :9986 → Prometheus(컨테이너)가 도커 브리지 `172.18.0.1:9986`로 스크레이프(`node=data05`).
- data04: SSH 터널(`keiwi-tunnel-data04`)에 `-L 172.18.0.1:9987:localhost:9986` 추가 → 타깃 `172.18.0.1:9987`(`node=data04`). ufw `172.18.0.0/16 → 9986/9987` 개방.
- `infra/monitoring/prometheus.yml`의 `port-exporter` 잡 참고.

## 검증

```bash
# 노드에서 직접
curl -s localhost:9986/metrics | grep keiwi_listening_port_info | head
# Prometheus에서(노드 라벨)
curl -s localhost:9090/api/v1/query --data-urlencode 'query=keiwi_listening_port_info{node="data04"}'
```
콘솔 Overview → 노드 → **서비스 탭**의 "리스닝 포트" 섹션에 표시.

> [!NOTE]
> 42844 같은 임시 고포트(ephemeral)도 잡힌다 — 콘솔/대시보드에서 알려진 포트 위주로 보이거나 필터할 수 있다(known-endpoints).

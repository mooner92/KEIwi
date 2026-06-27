# infra/monitoring — 플릿 수집 설정 (data04·data05 적용본)

KEIwi 콘솔은 Prometheus `up`을 [`docs/inventory.yaml`](../../docs/inventory.yaml)와 매칭해 상태를 낸다. 콘솔이 노드를 `up`/`down`으로 보이게 하려면 **Prometheus `up{instance}` 라벨이 inventory의 `exporters` 값(`ip:port`)과 정확히 일치**해야 한다.

> 권위는 [`Constitution.md`](../../Constitution.md). 에이전트는 이 설정을 **생성**하고, 라이브(`.105`/`/data/monitoring`)에 **적용은 사람이** 한다(§11). dev 격리(§12) 유지.

## 현재 상태 (적용 전)

- 라이브 Prometheus는 .105 로컬 컨테이너만 컨테이너명으로 수집(`node-exporter:9100` 등) → inventory와 라벨 불일치 → 콘솔에서 전부 `no-data`.
- `data04`(192.168.1.104:9100)는 .105에서 **직접 도달 불가** → SSH 터널 필요.
- `data01~03`은 터널 미설정 → 수집 안 함 → 콘솔에서 `no-data`(설계된 동작, down 아님).

## 적용 순서 (.105에서, 사람이)

1. **data04 SSH 터널** — [`keiwi-tunnel-data04.service`](./keiwi-tunnel-data04.service) 참고:
   ```bash
   sudo cp infra/monitoring/keiwi-tunnel-data04.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now keiwi-tunnel-data04
   systemctl status keiwi-tunnel-data04        # active 확인
   ```
   (전제: data04에 node-exporter가 `localhost:9100`, .105에서 `ssh data04` 키 인증 동작)

2. **Prometheus 설정** — [`prometheus.yml`](./prometheus.yml)의 내용을 `/data/monitoring/prometheus.yml`에 반영 후:
   ```bash
   sudo docker restart prometheus      # docker-compose 1.29는 ContainerConfig 버그 → docker restart 권장
   ```

3. **콘솔 `.env.local`** (`apps/console/.env.local`, 직접 채움):
   ```
   GRAFANA_URL=https://grafana.excusa.uk
   GRAFANA_DASHBOARD_UID=<대시보드 uid>
   PROMETHEUS_URL=http://localhost:9090
   ```

## data04 node-exporter (Phase A — data04 노드에서)

data04엔 docker가 없으니 **apt 패키지**로 (data04에서):
```bash
sudo apt update && sudo apt install -y prometheus-node-exporter
sudo systemctl enable --now prometheus-node-exporter   # :9100 자동 기동
ss -tlnp | grep :9100                                  # 확인
```
**전제(.105 터널용)**: .105의 `mooner92` 공개키가 data04의 `mhchoi:~/.ssh/authorized_keys`에 등록돼야 함(유닛이 `mhchoi@192.168.1.104`로 접속). 등록:
```bash
# .105에서
ssh-copy-id mhchoi@192.168.1.104    # 또는 mooner92의 ~/.ssh/id_*.pub를 수동 등록
```
그다음 .105에서 터널 enable → `prometheus.yml`의 data04 블록 주석 해제 → `sudo docker restart prometheus`.

## 모델 워크로드 (Phase B — vLLM /metrics → Grafana)

`prometheus.yml`에 **`vllm` 잡** 포함됨(`172.18.0.1:8003`/`8010`). 위 2번으로 반영·restart하면 vLLM 워크로드 메트릭(요청/토큰/지연/KV캐시)이 수집된다. 모델/포트가 늘면 `vllm` 잡 `targets`에 줄만 추가.

> ⚠️ **방화벽(ufw)**: Prometheus 컨테이너(브리지 `172.18.0.0/16`)가 호스트의 vLLM 포트에 닿아야 한다. ufw가 active면 **포트별로 열어야** 함(안 열면 타깃 down/timeout — gpu-model-exporter 9836만 열려있던 게 원인):
> ```bash
> sudo ufw allow from 172.18.0.0/16 to any port 8003 proto tcp
> sudo ufw allow from 172.18.0.0/16 to any port 8010 proto tcp
> ```

**Grafana 대시보드 import** ([`dashboards/model-workload.json`](./dashboards/model-workload.json)):
- Grafana → Dashboards → New → **Import** → Upload JSON → `model-workload.json` → Prometheus 데이터소스 선택 → Import.
- import 후 URL의 `/d/` 뒤 경로(`keiwi-model-workload/<slug>`)를 복사.

**콘솔 탭 추가** — `apps/console/.env.local`의 `GRAFANA_DASHBOARD_UID`에 항목 추가 후 `sudo systemctl restart keiwi-console`:
```
GRAFANA_DASHBOARD_UID=<기존 시스템 경로>|시스템,<기존 GPU 경로>|GPU,keiwi-model-workload/<slug>|모델 워크로드
```

## 검증

```bash
curl -s 'http://localhost:9090/api/v1/query?query=up' | grep -o '192.168.1.10[45]:[0-9]*'
# 기대: 192.168.1.104:9100, 192.168.1.105:9100, 192.168.1.105:9400
```
콘솔 `/api/fleet/status`·strip에서 **data04·data05 = up/down**, **data01~03 = no-data**.

## 1·2·3 추가 시

각 노드에 node-exporter 기동 → 터널 유닛 복제(포트만 변경, 예 data03 → `172.18.0.1:9103`) → `prometheus.yml`에 `instance: 192.168.1.10X:9100` 타깃 추가 → restart. inventory는 이미 5노드라 별도 수정 불필요.

## 참고

- 이 디렉터리는 **권장본**이다. 라이브 `/data/monitoring`의 `docker-compose.yml`(prometheus/grafana/node-exporter/dcgm-exporter)은 그대로 두고 `prometheus.yml`만 정렬하면 된다.
- 보안: 라이브 compose의 Grafana 관리자 비밀번호가 평문 기본값으로 보인다 — env/시크릿으로 옮기는 것을 별도 권장(헌장 §13).

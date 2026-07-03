---
id: node-onboarding
kind: procedure
category: infra
status: active
first_seen: 2026-06-30
last_seen: 2026-07-03
---

# 런북 — 노드 온보딩 / 오프보딩

> 관리망(KEIwi 플릿)에 노드를 **추가·삭제·변경**하는 단일 표준 절차. 결정 근거 [ADR-0017](../decisions/0017-node-onboarding-standard.md). 단일 소스는 [docs/inventory.yaml](../inventory.yaml)(헌장 §0). **에이전트는 레포에 생성만, 라이브 적용은 사람**(헌장 §11) — 적용 단계는 `(사람)`으로 표시.

## 0. 원칙

- **SoT**: 모든 노드/에이전트 사실은 `docs/inventory.yaml`에서 시작. Ansible·Prometheus·콘솔이 이 값을 따른다.
- **에이전트 = Ansible role**: filebeat·gpu-model-exporter(+향후 node/dcgm). 노드 속성(`os`,`gpu`)으로 적용 role 결정. systemd 멱등(§16).
- **두 평면**: ①메트릭(Prometheus `up`→콘솔 up/down) ②로그(Filebeat→Logstash→OpenSearch→Grafana). 노드는 둘 다 붙어야 "완전 온보딩".
- **콘솔/대시보드는 자동**: 노드 변수·inventory 파생이라 노드별 코드 수정 불필요.

## 1. 사전 준비 (control = data05)

- data05에서 모든 ansible/적용을 실행(자기 자신은 `ansible_connection=local`).
- 대상 노드: **SSH 키 인증** 가능해야 함(data05 공개키를 대상 계정 `authorized_keys`에 등록 — `ssh-copy-id -p <port> <user>@<ip>`), **무비번 sudo(NOPASSWD)**(ansible `become_ask_pass=False` 전제). 비번 sudo면 `--ask-become-pass`로 실행.
- SSH 포트가 22가 아니면(예 data04=764) inventory에 `ansible_port`.

## 2. 노드 추가 (add) — data0N 예시

### 2.1 인벤토리 갱신 (레포)
1. `docs/inventory.yaml`의 `nodes:`에 항목 추가/확인 — `id·ip·hostname·os(ubuntu|windows)·role(target|stack-host)·gpu·exporters{node:"ip:9100"[, dcgm:"ip:9400"]}`. 필드 추가 시 `apps/console/src/types/fleet.ts` zod 스키마도 동반 수정.
2. `infra/ansible/inventory.ini`에 같은 노드를 그룹에 추가:
   - 로그 대상: `[logging]`에 `dataNN ansible_host=<ip> ansible_user=<user> fleet_node=dataNN`
   - GPU 노드: `[gpu]`에도 추가(아래 2.3)
   - SSH 포트 다르면 그룹 `:vars`의 `ansible_port` 확인.

### 2.2 메트릭 평면 — node-exporter/DCGM (사람)
1. **대상 노드에 익스포터 설치**: `node-exporter`(우분투 `sudo apt install prometheus-node-exporter` → `:9100`), GPU면 `dcgm-exporter`(`:9400`) — 플릿 표준(data03·data04 확립, 2026-07-03):
   ```bash
   # ① NVIDIA 드라이버 — 플릿 표준 535 계열(data04=535.309.01과 정합)
   sudo apt update && sudo apt install -y nvidia-driver-535-server && sudo reboot
   nvidia-smi                                    # 재부팅 후 GPU 인식 확인
   # ② docker + NVIDIA container toolkit
   sudo apt install -y docker.io
   curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
   curl -sL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
   sudo apt update && sudo apt install -y nvidia-container-toolkit
   sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker
   # ③ dcgm-exporter — data04와 동일 설정
   sudo docker run -d --name dcgm-exporter --restart unless-stopped --gpus all -p 9400:9400 nvidia/dcgm-exporter:latest
   curl -s localhost:9400/metrics | head -3      # DCGM_FI_* 나오면 OK
   ```
2. **.105에서 도달 불가하면 SSH 터널**: `infra/monitoring/keiwi-tunnel-data04.service`를 복제 → 포워드 포트를 노드별로 변경(예 data04=9104/9404, 다음 노드=9105/9405), `ssh -p <port> <user>@<ip>`로 `-L 172.18.0.1:<lport>:localhost:9100`(+ GPU면 :9400). `sudo cp` → `systemctl enable --now keiwi-tunnel-dataNN`.
3. **ufw**: `.105`에서 docker bridge가 터널 포트에 닿게 `sudo ufw allow from 172.18.0.0/16 to any port <lport> proto tcp`.
4. **Prometheus 타깃**(레포 `infra/monitoring/prometheus.yml`): 해당 job `static_configs`에 타깃 추가하되 **`labels.instance`를 `docs/inventory.yaml`의 exporters 값과 정확히 일치**시킨다(콘솔이 `up{instance}`를 그 값과 정확 매칭 — 불일치 시 조용히 no-data). 예:
   ```yaml
   - targets: ['172.18.0.1:9105']
     labels: { instance: '192.168.1.10N:9100' }
   ```
5. **라이브 반영(사람)**: 위 내용을 `/data/monitoring/prometheus.yml`에 반영 → `sudo docker restart prometheus`(compose 1.29 버그로 recreate 아닌 restart).

### 2.3 GPU 모델 익스포터 (GPU 노드만) — Ansible role
GPU 노드는 어떤 모델이 어느 GPU에 떴는지 보이게 `gpu-model-exporter`(:9836)를 띄운다. → §3 참조(data04가 구체 예).

### 2.4 로그 평면 — Filebeat (Ansible, 자동 멱등)
1. 2.1에서 `[logging]`에 추가했는지 확인.
2. **ufw**: 대상→`data05:5044` 허용.
3. **적용(사람)**: data05에서
   ```bash
   cd /KEIwi/infra/ansible
   ansible -i inventory.ini dataNN -m ping              # 연결 확인
   ansible-playbook -i inventory.ini playbooks/logging.yml --limit dataNN --check --diff  # 드라이런
   ansible-playbook -i inventory.ini playbooks/logging.yml --limit dataNN                 # 적용
   ```
4. 새 systemd 서비스가 새 카테고리로 분류돼야 하면 `infra/logging/logstash/pipeline/service-category.yml`에 앵커 정규식 한 줄 추가(300s 내 자동 reload, 재시작 불필요).

### 2.5 검증
- 메트릭: 콘솔 Overview에서 노드 카드가 `정상`(no-data 아님). 또는 `curl -s localhost:9090/api/v1/query --data-urlencode 'query=up{instance="192.168.1.10N:9100"}'` == 1.
- 로그: `ansible -i inventory.ini dataNN -m command -a 'systemctl is-active filebeat'` == active. /logs 탭에서 `fleet_node:dataNN` 로그 유입.

## 3. GPU 모델 익스포터 추가 (A — data04 구체 예)

data04 GPU엔 모델이 떠 있으나(gpu1 ~22GB) 익스포터가 없어 모델명이 안 보인다([[data04-gpu-model-invisible]]). role로 표준 배포:

1. `infra/ansible/inventory.ini` `[gpu]` 그룹에 `data04`, `data05` 확인(아래 inventory 참고).
2. **적용(사람, data05)** — data04 mhchoi는 NOPASSWD sudo가 아니므로 `-K`(sudo 비번 프롬프트) 필요:
   ```bash
   cd /KEIwi/infra/ansible
   ansible-playbook -i inventory.ini playbooks/agents.yml --limit data04 -K --check --diff
   ansible-playbook -i inventory.ini playbooks/agents.yml --limit data04 -K
   #   "BECOME password:" 에 data04 sudo 비번 입력(레포 저장 안 함 §13)
   ```
   → 대상에 `/opt/keiwi/gpu-model-exporter/gpu-model-exporter.py` 배치 + `keiwi-gpu-model-exporter.service`(systemd, :9836) enable/start. (data05의 기존 PM2 실행은 같은 role로 systemd 수렴 — 드리프트 해소.)
3. **.105로 노출(사람)**: data04는 직접 도달 불가 → `keiwi-tunnel-data04.service`에 9836 포워드 추가(`-L 172.18.0.1:9837:localhost:9836`) → `systemctl restart keiwi-tunnel-data04` + `ufw allow from 172.18.0.0/16 to any port 9837`.
4. **Prometheus(사람)**: `gpu-model-exporter` job에 data04 타깃 추가 + **node 라벨**로 노드 구분:
   ```yaml
   - targets: ['172.18.0.1:9836'];  labels: { node: data05 }
   - targets: ['172.18.0.1:9837'];  labels: { node: data04 }
   ```
   `/data/monitoring/prometheus.yml` 반영 → `docker restart prometheus`.
5. **모델 대시보드 노드 구분**: `infra/monitoring/dashboards/model-workload.json`에 `node` 템플릿 변수 추가 + `gpu_model_*{node="$node"}` 필터(현재 단일 호스트 가정). 재provisioning(`docker cp` + `docker restart grafana`).
6. **검증**: `curl -s localhost:9090/api/v1/query --data-urlencode 'query=gpu_model_vram_bytes{node="data04"}'` 가 data04 모델 반환 → 콘솔 모델 탭에 data04 Qwen 노출.

## 4. 노드 삭제 (offboarding)

순서대로 잔재 제거:
1. **로그**: `inventory.ini`에서 노드 제거 → 대상에서 `sudo systemctl disable --now filebeat`(사람). 인덱스는 ISM(365d)로 자연 만료(즉시 삭제 원하면 사람이 `_delete_by_query fleet_node:dataNN`).
2. **메트릭**: `prometheus.yml`에서 해당 타깃 제거 + 라이브 반영 + `docker restart prometheus`. 터널 유닛 `systemctl disable --now keiwi-tunnel-dataNN` + 유닛 파일 제거(사람). ufw 규칙 회수.
3. **에이전트**: GPU 노드면 `systemctl disable --now keiwi-gpu-model-exporter`(사람).
4. **인벤토리**: `docs/inventory.yaml`에서 노드 제거(또는 `role`/주석으로 보관). 콘솔은 자동으로 카드 제거.
5. **검증**: 콘솔에 노드 카드 사라짐, Prometheus `up`에 잔여 타깃 없음.

## 5. 변경 (modify)

- IP/포트/계정 변경: `docs/inventory.yaml` + `inventory.ini` + (터널 유닛/prometheus 타깃 라벨) 동반 수정 후 재적용. **두 inventory를 항상 함께** 고친다(드리프트 방지).
- 에이전트 설정 변경: 해당 role의 `defaults/`·`templates/` 수정 → playbook 재실행(멱등, 변경 시에만 restart).

## 6. 이 매뉴얼 자체 수정

- 절차가 바뀌면 이 런북 + 관련 role/playbook을 **같은 PR**에서 갱신, `last_seen` 갱신. 큰 방식 변경은 ADR로 근거(헌장 §8) 후 [ADR-0017](../decisions/0017-node-onboarding-standard.md) 개정 링크.
- `AGENTS.md` 디렉터리 지도에 본 런북이 등록돼 있는지 확인.

## 부록 — sudo 비번 자동화 (`-K` 제거)

`-K`(BECOME 프롬프트)는 대상 계정이 NOPASSWD sudo가 아닐 때의 임시 우회다. 표준은 둘 중 하나:

**A. NOPASSWD sudoers (권장 — 파일 1개, 이후 영구 무프롬프트)** — 대상 노드에서 1회:
```bash
# <user>를 ansible 계정으로. visudo -cf 검증 실패 시 파일이 적용되지 않게 순서 유지.
echo '<user> ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/90-keiwi-ansible
sudo chmod 440 /etc/sudoers.d/90-keiwi-ansible
sudo visudo -cf /etc/sudoers.d/90-keiwi-ansible   # "parsed OK" 확인(필수)
```
이후 해당 노드는 `-K` 없이 `ansible-playbook …` 실행. (신뢰 내부망 + 키 인증 전제 — 키 관리가 곧 접근 통제)

**B. Ansible Vault (비번을 유지하고 싶을 때)** — 비번을 암호화 저장, 실행은 무프롬프트:
```bash
cd /KEIwi/infra/ansible
mkdir -p host_vars/data04
ansible-vault create host_vars/data04/vault.yml     # 내용: ansible_become_password: "<sudo비번>"
echo '<vault암호>' > ~/.config/keiwi-vault-pass && chmod 600 ~/.config/keiwi-vault-pass  # 레포 밖(§13)
# ansible.cfg에: [defaults] vault_password_file = ~/.config/keiwi-vault-pass
```
vault.yml은 암호화돼 커밋 가능하나, **vault 암호 파일은 반드시 레포 밖**(§13). A가 더 단순해 플릿 표준은 A.

## 알려진 한계 (백로그)
- inventory 이중관리(docs/inventory.yaml ↔ inventory.ini) 수기 동기화 — 동적 인벤토리 어댑터 미도입.
- node-exporter·dcgm-exporter는 아직 수동(role 미흡, B02). data02(Windows)는 winlogbeat role 부재.
- Prometheus는 static_configs만(SD 없음) — 타깃은 수기 편집.

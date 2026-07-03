# 0017 — 노드 온보딩 표준 (inventory 단일소스 · 에이전트=Ansible role)

- 상태: 채택(2026-06-30)
- 맥락: [ADR-0009](./0009-ansible-config-mgmt.md)(Ansible 채택), [docs/inventory.yaml](../inventory.yaml)(§0 SoT), 헌장 §11/§12/§16
- 관련: [[m2-logs-live]], [[data04-gpu-model-invisible]], `docs/runbooks/node-onboarding.md`

## 맥락

관리망에 노드를 추가/삭제하는 절차가 **일관되지 않고 흩어져** 있다. 발견(2026-06-30) 결과:

- **에이전트 4종**(node-exporter·dcgm-exporter·gpu-model-exporter·filebeat) 중 **filebeat만 Ansible role**로 멱등 자동화. 나머지는 수동 설치(apt/컨테이너/PM2) + README 산문 절차 — ADR-0009가 약속한 "수동→코드" 표준화 미완(백로그 B02).
- **inventory 이중 관리**: `docs/inventory.yaml`(5노드, SoT 표방) ↔ `infra/ansible/inventory.ini`(2노드)를 손으로 동기화 → 드리프트.
- 노드 추가 시 건드릴 곳이 흩어짐: inventory 2곳 · SSH 터널 유닛 복제 · prometheus.yml 수기 편집 + 라이브 반영 + `docker restart` · ufw · ansible 재실행. 순서 의존·누락 시 조용히 no-data.
- **오프보딩(삭제) 절차가 문서화 안 됨** — 노드를 빼면 잔재(터널 유닛·prometheus 타깃·로그 인덱스)가 남는다.

## 결정

노드 추가/삭제/변경을 **하나의 표준**으로 관리한다.

1. **단일 소스 = `docs/inventory.yaml`** (헌장 §0). 모든 노드/에이전트 사실의 출발점. Ansible·Prometheus·콘솔이 이 값을 따른다.
2. **에이전트 = Ansible role**(ADR-0009 약속 이행). role-per-agent: `filebeat`(기존) + `gpu-model-exporter`(본 ADR 신설) + 향후 `node-exporter`·`dcgm-exporter`. 노드 속성(`os`, `gpu`)으로 어떤 role을 적용할지 결정. systemd 멱등(§16). **PM2 등 비표준 실행은 systemd role로 수렴**(data05 gpu-model-exporter 드리프트 해소).
3. **운영 매뉴얼 = `docs/runbooks/node-onboarding.md`** — 추가/삭제/변경을 메트릭·로그 두 평면에 대해 단계별로(§11 `(사람)` 표식). 이 런북이 "어떻게 관리하는가"의 단일 진입점.
4. **§11 불변**: 에이전트는 role·playbook·런북을 레포에 **생성만**. 라이브 적용(SSH 설치·prometheus 반영·docker restart)은 **사람**. 자동화는 "멱등 재현 절차"를 제공할 뿐 자동 적용이 아니다.
5. **inventory 드리프트 축소**(점진): 1차로 런북이 두 파일을 함께 갱신하도록 강제. 2차(백로그)로 `docs/inventory.yaml`에서 `inventory.ini`를 생성하는 어댑터(동적 인벤토리) 도입 검토.

## 고려한 대안

- **현행 수동 유지**: 노드가 늘수록 누락·드리프트 심화 — 기각.
- **풀 동적 인벤토리(inventory.yaml→ansible 즉시 자동)**: 이상적이나 윈도우(data02)·터널·ufw 등 비-Ansible 단계가 남아 한 번에 안 됨. 점진 도입(백로그)으로.
- **Kubernetes/SD 기반 재구성**: ADR-0009에서 이미 기각(규모 과합).

## 결과

- `docs/runbooks/node-onboarding.md`(추가/삭제/변경 매뉴얼) + `infra/ansible/roles/gpu-model-exporter/`(신설 role) + `playbooks/agents.yml`(에이전트 적용) + `inventory.ini` `[gpu]` 그룹.
- **A(즉시 효과)**: data04에 gpu-model-exporter를 role로 배포 → 모델 탭에 data04 모델(Qwen 14B) 노출(B04 해소). 절차는 런북 §"GPU 모델 익스포터 추가".
- 한계/후속(백로그): node-exporter·dcgm-exporter role화, inventory 동적 어댑터, 윈도우(data02) winlogbeat role, gpu_model_* 메트릭에 node 라벨 + 모델 대시보드 노드 변수.

## 개정 — 2026-07-03 (data03 실전 적용)

data03 온보딩(계정 mooner92, sshd :764, GPU Quadro RTX 6000×2)으로 본 표준을 실전 검증하고 다음을 개정했다. 상세 절차는 [런북](../runbooks/node-onboarding.md).

1. **직접 스크랩 경로 추가**: 같은 서브넷 + 대상 ufw에서 `.105` 발신 허용 가능이면 SSH 터널 없이 **직접 스크랩 우선**(data03 — ufw로 9100/9400/9836/9986 허용). 터널은 도달 불가 시만(data04). 런북 §2.2.
2. **sudo NOPASSWD 표준화**: `/etc/sudoers.d/90-keiwi-ansible` **전 노드 적용** → ansible `-K` 폐지. 신규 노드는 원격 원라이너(`ssh -t … sudo tee + visudo -cf`) 1회 — 런북 §1·부록.
3. **GPU 절차 구체화**: 드라이버 535.309.01 → docker.io+nvidia-container-toolkit → dcgm-exporter 컨테이너(`--restart unless-stopped --gpus all`) 표준 블록 확립(data03·04). 노드 구분 `node` 라벨은 **Prometheus 스크랩단에서 부여**(대시보드 `label_replace` IP 하드코딩은 data04/05 레거시). 런북 §2.2·§3.

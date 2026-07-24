# 0009. 에이전트·설정 배포 = Ansible (k8s 미채택)

- 상태: 채택
- 날짜: 2026-06-28

## 맥락

플릿(data01~05)에 모니터링/로그 에이전트(node-exporter·DCGM·Filebeat 등)를 **여러 서버에 일괄 설치·설정**할 방법을 정한다. 현재는 전부 **수동**(서버마다 apt·docker·systemd 직접) — data04 GPU(DCGM) 설치에서 보듯 서버별 차이로 반복·삽질·드리프트가 크다.

- 헌장 §6(지루한 기술), §11(사람 적용), §12(개발 격리).
- 서버는 **GPU 연구 워크로드(vLLM/ollama)** 가 도는 독립 서버 — 클러스터 아님.
- 사용자 논의: k8s vs Ansible vs 현행. 사용자가 **Ansible 도입** 선택.

## 결정

**Ansible을 설정 관리/에이전트 배포 도구로 채택한다.**

- `infra/ansible/` — agentless. **data05(control)** 에서 SSH(포트 764, 키)로 data04·05(이후 확장)에 멱등 적용.
- 역할: `roles/filebeat`(M2), 향후 `roles/node-exporter`·`roles/dcgm-exporter`로 M1 수동 설치도 표준화.
- inventory에 호스트·`fleet_node`·접속정보(키 경로, 비번 아님). 시크릿은 레포밖(§13) — vault 또는 외부 주입.
- 실행은 **사람이**(`ansible-playbook ...`) — 에이전트는 playbook을 레포에 생성(§11).

## 고려한 대안

- **k8s(클러스터화)** — DaemonSet으로 에이전트 자동배포되나, 5대 독립 GPU 연구서버를 클러스터로 묶는 것은 **워크로드 충돌·운영복잡도**가 크고 §6(지루한 기술)에 위배. 에이전트 배포라는 목적엔 Ansible이 충분. → 기각(k8s 비용분석은 본 ADR이 대신).
- **현행 수동** — 단순하나 서버 증가·반복 작업에서 드리프트·실수. data04 DCGM에서 비효율 확인. → 기각.
- **Salt/Chef/Puppet** — 에이전트 상주형(Salt minion 등) 또는 무거움. agentless·표준·학습데이터 풍부한 **Ansible**이 §6에 가장 부합. → 기각.

## 결과

- 에이전트 설치/설정이 선언적·멱등·일괄화. 서버별 삽질 감소.
- M2 Filebeat 배포가 첫 적용. M1 exporter들도 후속 role로 흡수 가능(수동→코드).
- GPU 연구 워크로드는 건드리지 않음(에이전트만 설치, k8s 미편입).
- 시크릿: SSH 키·비번은 레포밖(§13). inventory에 실값 금지.
- 참조: [M2 plan](../../specs/M2-logs/plan.md), [ADR-0008](0008-log-pipeline.md), 헌장 §6/§11/§13.

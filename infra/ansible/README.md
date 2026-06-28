# infra/ansible — 플릿 로그 수집기(Filebeat) 배포 (Ansible)

KEIwi M2 통합 로그의 **수집 계층**을 멱등하게 배포한다. 각 서버에 Filebeat를 설치/설정/기동해 **journald(시스템 로그)** [+ 선택 파일 로그]를 **data05의 Logstash(beats:5044)** 로 보낸다 → Elasticsearch → Grafana(콘솔 임베드).

> 권위는 [`Constitution.md`](../../Constitution.md). 단일 기준은 [`docs/inventory.yaml`](../../docs/inventory.yaml).
> 에이전트는 이 설정을 **생성**하고, 라이브 **적용은 사람이** 한다(§11). dev 격리(§12), 시크릿은 레포 밖(§13) — 이 트리에 비번/토큰/키 없음.

## 파이프라인에서의 위치

```
[각 서버] Filebeat(journald) ──5044──▶ [data05] Logstash ──▶ Elasticsearch ──▶ Grafana ──▶ 콘솔
   이 디렉터리의 책임 ^^^^^^^^^^^^^^^                  (infra/logging/)      (infra/monitoring/grafana/)
```

이 디렉터리는 **Filebeat(수집기)만** 다룬다. Logstash/Elasticsearch/Grafana는 `infra/logging/`·`infra/monitoring/grafana/`.

## 구성

| 경로 | 내용 |
|---|---|
| `ansible.cfg` | 실행 기본값(inventory·roles 경로·become·SSH) |
| `inventory.ini` | 대상 노드(data04·data05), `ansible_port=764`, `fleet_node` host_vars |
| `playbooks/logging.yml` | 플레이북 — `filebeat` 역할 적용 |
| `roles/filebeat/tasks/main.yml` | 설치(Elastic APT) + 설정 배포 + enable, 멱등 |
| `roles/filebeat/templates/filebeat.yml.j2` | 계약대로의 Filebeat 설정(`fleet_node`·logstash 변수화) |
| `roles/filebeat/handlers/main.yml` | 설정 변경 시 `restart filebeat` |
| `roles/filebeat/defaults/main.yml` | `logstash_host`/`logstash_port`/`filebeat_es_major`/선택 파일 입력 기본값 |

## 전제 (사람이 준비)

1. **control 노드 = data05** 에서 실행한다(관제 스택 호스트). data05 자신은 `ansible_connection=local`.
2. **data04 SSH(포트 764) 키 인증** — data05의 공개키가 data04 `mhchoi`에 등록되어야 한다(메트릭 터널과 동일 전제):
   ```bash
   # data05에서 (포트 764!)
   ssh-copy-id -p 764 mhchoi@192.168.1.104     # mhchoi 비번 1회
   ssh -p 764 mhchoi@192.168.1.104 true        # 키 인증 동작 확인(무프롬프트)
   ```
   `mhchoi`는 sudo 권한이 있어야 한다(설치에 `become`).
3. **Ansible 설치**(data05): `sudo apt install -y ansible` (또는 pipx). community 모듈 불필요 — `ansible.builtin`만 사용.
4. **data05 Logstash 가동 + 5044 개방** — 수집 대상(data04 등)이 `data05:5044`에 닿아야 한다. ufw가 active면:
   ```bash
   sudo ufw allow from 192.168.1.0/24 to any port 5044 proto tcp
   ```
   (Logstash beats input 자체는 `infra/logging/`의 책임.)

## 실행 (data05에서, 사람이 — §11)

```bash
cd infra/ansible

# 0) 연결 확인
ansible -i inventory.ini logging -m ping        # data05=local, data04=ssh:764

# 1) 사전 점검(변경 없이 diff)
ansible-playbook -i inventory.ini playbooks/logging.yml --check --diff

# 2) 적용
ansible-playbook -i inventory.ini playbooks/logging.yml

# 특정 노드만:
ansible-playbook -i inventory.ini playbooks/logging.yml --limit data04
```

멱등하다 — 변경이 없으면 `changed=0`, 설정이 바뀐 경우에만 Filebeat가 재시작된다.

## 검증

```bash
# 각 대상에서 Filebeat 상태
ansible -i inventory.ini logging -b -m shell -a 'systemctl is-active filebeat'

# data05에서 ES에 노드별 로그가 들어오는지(계약: keiwi-logs-*, fleet_node)
curl -s 'http://localhost:9200/keiwi-logs-*/_search?size=0' \
  -H 'Content-Type: application/json' \
  -d '{"aggs":{"by_node":{"terms":{"field":"fleet_node"}}}}' | python3 -m json.tool
# 기대: fleet_node 버킷에 data04, data05
```

콘솔/Grafana Logs 대시보드(uid=keiwi-logs)에서 `node`(=fleet_node)·`level`(=log_level) 필터로 확인.

## 선택 파일 로그(예: vLLM)

journald 외에 파일 로그를 추가하려면 inventory host_vars 또는 `-e`로 경로를 준다:
```bash
ansible-playbook -i inventory.ini playbooks/logging.yml \
  --limit data05 -e '{"filebeat_extra_log_paths":["/var/log/vllm/*.log"]}'
```

## 1·2·3 추가 시

`inventory.ini [logging]`에 노드를 추가하고 `fleet_node=data0N` 지정 → 재실행. `docs/inventory.yaml`은 이미 5노드라 별도 수정 불필요. (접근 준비 안 된 서버는 수집 안 함 = 콘솔에서 "데이터 없음", 장애 아님 — spec UL5.)

## 주의

- **라이브 직접수정 금지(§12).** 이 트리는 권장본이며, 적용은 위 절차로 사람이 한다.
- **시크릿 없음(§13).** SSH 키·비번은 레포 밖. 내부망 + Cloudflare Access 뒤라 Filebeat→Logstash는 평문(계약과 일치).
- `filebeat.yml`은 Ansible이 관리한다 — 노드에서 직접 고치지 말 것(다음 실행에서 덮어써짐). 변경은 템플릿에서.

# infra/logging/filebeat-xenial · 구형 우분투(16.04) 로그 수집 — 벤더링 Filebeat

> **data01**(Ubuntu 16.04 xenial, glibc 2.23)은 표준 filebeat **role을 쓸 수 없다**: role은 Elastic **8.x APT** 저장소로 설치하는데 8.x 패키지가 요구하는 glibc가 xenial보다 높다. 그래서 **7.17.x 정적 바이너리를 벤더링**해 systemd로 띄운다. `smartctl-exporter` 벤더링 패턴과 동일하며, **계약(fleet_node·journald 입력·Logstash 출력)은 role과 같다** — 실제로 Logstash 파이프라인이 7.x journald.* 중첩 필드를 그대로 정규화한다(신규 ECS와 구형 둘 다 처리).

> [!IMPORTANT]
> 에이전트는 생성, **적용은 사람**(§11). 바이너리는 레포에 담지 않는다(§13 아님이지만 용량·라이선스 — vendored 패턴). 아래 절차로 오프라인 벤더링.

## 왜 role이 아닌가 (결정 요약)

| | 표준 노드(data03·04·05) | data01 (xenial) |
| --- | --- | --- |
| 설치 | ansible `filebeat` role, Elastic 8.x apt | **7.17.x 정적 바이너리 벤더링** |
| 입력 | journald | journald (동일) |
| 출력 | logstash 192.0.2.15:5044 | 동일 |
| 관리 | `[logging]` 그룹 + `playbooks/logging.yml` | systemd 유닛(수동/이 디렉터리) |
| inventory | `[logging]`에 포함 | **미포함**(apt role이 xenial에서 깨지므로) |

data01을 `[logging]`에 넣지 말 것 — logging 플레이북이 8.x apt를 시도해 실패한다.

## 파일

- `keiwi-filebeat.yml` — 설정(journald·`cursor_seek_fallback: tail`·fleet_node·logstash 출력·파일로깅). **노드마다 `fleet_node`만 변경.**
- `keiwi-filebeat.service` — systemd 유닛(`-e` 없음 → 자기 로그 파일로만, journald 자기수집 루프 차단).

## 배포 절차 (data05에서 벤더링 → data01로)

```bash
# ① data05(egress 가능 호스트)에서 7.17.x linux-x86_64 tarball 벤더링
V=7.17.28
cd /tmp
curl -fSLO https://artifacts.elastic.co/downloads/beats/filebeat/filebeat-${V}-linux-x86_64.tar.gz
tar xzf filebeat-${V}-linux-x86_64.tar.gz

# ② data01로 홈 + 설정 전송(포트 <SSH_PORT>)
#    계정은 레포에 적지 않는다(§13) — infra/ansible/README.md «노드 계정 주입»
N=$KEIWI_USER_DATA01@192.0.2.11
scp -P <SSH_PORT> -r filebeat-${V}-linux-x86_64 "$N:/tmp/filebeat-home"
scp -P <SSH_PORT> /KEIwi/infra/logging/filebeat-xenial/keiwi-filebeat.yml     "$N:/tmp/"
scp -P <SSH_PORT> /KEIwi/infra/logging/filebeat-xenial/keiwi-filebeat.service "$N:/tmp/"

# ③ data01에서 설치(사람, sudo)
ssh -p <SSH_PORT> "$N" 'sudo sh -s' <<'EOF'
mkdir -p /opt/keiwi
rm -rf /opt/keiwi/filebeat && mv /tmp/filebeat-home /opt/keiwi/filebeat
install -m 0644 -o root -g root /tmp/keiwi-filebeat.yml /opt/keiwi/filebeat/keiwi.yml
install -m 0644 -o root -g root /tmp/keiwi-filebeat.service /etc/systemd/system/keiwi-filebeat.service
mkdir -p /var/lib/keiwi-filebeat /var/log/keiwi-filebeat
systemctl daemon-reload && systemctl enable --now keiwi-filebeat
EOF
```

## 검증

```bash
# 설정·출력 헬스체크(data01)
ssh -p <SSH_PORT> "$KEIWI_USER_DATA01@192.0.2.11" \
  '/opt/keiwi/filebeat/filebeat test config -c /opt/keiwi/filebeat/keiwi.yml --path.home /opt/keiwi/filebeat; \
   /opt/keiwi/filebeat/filebeat test output -c /opt/keiwi/filebeat/keiwi.yml --path.home /opt/keiwi/filebeat'
# → Config OK / dial up... OK / talk to server... OK

# OpenSearch 적재(data05) — 건수가 증가해야
curl -s 'localhost:9200/keiwi-logs-*/_count?q=fleet_node:data01'
```

## 주의 (xenial 특이사항)

- **seek 정책이 핵심**: `cursor_seek_fallback: tail` 없으면 최초 실행에 journald **처음(head)**부터 읽어 3.8G 과거를 재적재 → OpenSearch·디스크 폭주. tail로 신규만.
- data01 `/var/log/syslog`는 3.7GB로 비대하지만 **파일 입력이 아니라 journald**라 무관(과거 재적재 안 함).
- journald 입력은 7.x에서 **experimental**(부팅 WARN 1줄) — 실측 안정 가동. 필드는 Logstash가 구형 `journald.*` 경로로 정규화(`logs.conf`).
- 방화벽: 수신측 data05 ufw가 `192.0.2.0/24 → 5044` 허용(서브넷 전체) → data01 추가 규칙 불필요. 발신측 data01은 방화벽 없음.
- 파이썬/iproute2 등 다른 xenial 제약은 [노드 온보딩 런북](../../../docs/runbooks/node-onboarding.md) 참고.

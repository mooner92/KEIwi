# smartmontools-xenial · data01(Ubuntu 16.04)용 정적 smartctl 벤더링 — **설계만, 미배포**

> 전례: [`infra/logging/filebeat-xenial`](../../../logging/filebeat-xenial/README.md) —
> xenial(glibc 2.23)에서 표준 apt 경로가 막힐 때 정적 바이너리를 벤더링해 쓰는 패턴.
> 이 문서는 그 패턴을 smartctl에 적용한 **설계**이고, **배포는 T2-17 검증을 통과한 뒤에만** 한다.

> [!IMPORTANT]
> 에이전트는 생성, **적용은 사람**(헌장 §11). 바이너리는 레포에 담지 않는다(용량·라이선스 —
> `filebeat-xenial`과 같은 벤더링 패턴).

## 1. 왜 data01만 다른가 [실측 2026-08-03]

| 항목 | data03·04·05 | **data01** |
| --- | --- | --- |
| OS | Ubuntu 22.04/24.04 | **Ubuntu 16.04.7 LTS** (glibc 2.23) |
| smartctl | **7.4** (설치됨) | **미설치**. apt 후보 `6.4+svn4214-1ubuntu0.1` |
| `--json` | 지원(7.0+) | **미지원** — 6.4에는 JSON 출력 자체가 없다 |
| RAID 컨트롤러 | P816i-a / P408i-a (**smartpqi**) | **P840ar** (`sg0`, type 12, **hpsa**) |
| 논리 볼륨 | — | 27.3T LV 1개 |
| textfile 디렉터리 | 있음 | **있음**(`/var/lib/node_exporter/textfile`) — 배관은 완비 |

role의 가드가 `smartctl >= 7.0`이라 **지금 data01은 자동으로 스킵**되고 사유를 debug로 찍는다.
조용히 빠지는 것이 아니라 **왜 빠졌는지가 로그에 남는다.**

## 2. 왜 apt 6.4 + 텍스트 파싱이 아닌가

6.4를 깔면 파서가 **두 벌**이 된다(JSON용 하나, 텍스트용 하나). 텍스트 레이아웃은
smartmontools 버전마다 바뀌고, hardware-ops C5가 지목한 "root 셸에서 외부 텍스트를 정규식으로
파싱하는" 위험을 그대로 재현한다. 파서 표면적을 2배로 만들고 얻는 것은 노드 1대다.

## 3. 벤더링 절차 (검증 통과 후에만)

```bash
# ① egress 가능한 호스트(data05)에서 정적 빌드 확보
#    smartmontools는 공식 정적 바이너리를 배포하지 않는다 → 소스 빌드 또는
#    xenial 컨테이너 안에서 --enable-static 빌드가 필요하다.
#    (filebeat와 다른 점: Elastic은 정적 tarball을 주지만 smartmontools는 주지 않는다)
V=7.4
docker run --rm -v "$PWD:/out" ubuntu:16.04 bash -c '
  apt-get update && apt-get install -y build-essential wget
  wget -q "https://downloads.sourceforge.net/smartmontools/smartmontools-'"$V"'.tar.gz"
  tar xzf "smartmontools-'"$V"'.tar.gz" && cd "smartmontools-'"$V"'"
  ./configure --without-selinux LDFLAGS=-static && make -j4
  cp smartctl /out/smartctl'

# ② 정적인지·xenial에서 도는지 확인
file ./smartctl                  # "statically linked" 여야 한다
ldd  ./smartctl                  # "not a dynamic executable" 여야 한다

# ③ data01로 전송(포트 764 · 계정은 env, 레포에 적지 않는다 §13)
scp -P 764 ./smartctl "$KEIWI_USER_DATA01@192.168.1.101:/tmp/smartctl-7.4"

# ④ 설치(사람, sudo)
ssh -p 764 "$KEIWI_USER_DATA01@192.168.1.101" 'sudo install -o root -g root -m 0755 \
  /tmp/smartctl-7.4 /opt/keiwi/bin/smartctl'
```

## 4. role 배선

`infra/ansible/inventory.ini`의 data01 호스트 라인에 override 한 줄을 더한다:

```ini
data01 ansible_host=192.168.1.101 ansible_user="{{ ... }}" fleet_node=data01 \
       node_hygiene_apt_enabled=false disk_smart_smartctl_path=/opt/keiwi/bin/smartctl
```

그러면 role 가드(`smartctl --version >= 7.0` + textfile 디렉터리 존재)를 통과하고
나머지 배포 경로는 다른 노드와 **완전히 동일**하다 — 스크립트도 유닛도 타이머도 같은 템플릿이다.
갈라지는 것은 바이너리 경로 **하나뿐**이다.

## 5. ⚠️ 미검증 — 이것이 배포를 막는 이유

**hpsa(P840ar)에서 `-d cciss,N`이 물리 디스크를 반환하는지 확인된 바 없다.**
실측으로 확인된 것은 **smartpqi**(P816i-a·P408i-a)뿐이다. hpsa는 드라이버가 다르고,
`cciss` 패스스루가 같은 방식으로 노출되는지는 추측의 영역이다.

T2-17이 판정한다:

```bash
# 임시로 벤더링 바이너리를 두고(설치 아님) 한 번만 물어본다 — 읽기 전용
ssh -p 764 "$KEIWI_USER_DATA01@192.168.1.101" 'sudo /tmp/smartctl-7.4 --json -d cciss,0 /dev/sg0'
```

| 결과 | 판정 |
| --- | --- |
| `serial_number`가 있는 디스크 응답 | 배포 진행 — §3·§4 |
| `No such device` / `Unknown device type` | **data01을 이 축의 범위 밖으로 명시**하고 spec에 사유를 남긴다 |

**추측으로 배포하지 않는다.** 동작하지 않으면 **27.3T LV 하나가 사각지대로 남는다는 사실을
숨기지 않는다** — spec §2.1 표의 data01 행과 백로그 FB-04에 그대로 적는다.

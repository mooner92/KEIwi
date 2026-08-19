---
id: home-migration-to-data
kind: procedure
category: infra
service: filesystem
affected_nodes: [data04, data05]
last_verified: 2026-08-10
# tier 0 = 자동 조치 후보 아님. 본문 절차는 mv·rm -rf·mount·fstab 편집을 포함하고
#   대상이 **연구자 데이터**다. 비가역·비멱등이며 blast radius가 사용자 계정 전체다.
#   L1이 "고를 수 있는 것"에 절대 들어가서는 안 되므로 actions를 비운다(게이트 A8).
#   이 문서는 사람이 작업 창에서 순서대로 읽고 실행하는 절차서다(§11).
tier: 0
actions: []
---

# 런북 — `/home`을 RAID6 배열(`/data`)로 이전

> **역할 분담**: [disk-pressure](./disk-pressure.md)가 *"`/`가 왜 차는가"* 를 진단하고 "`/data`로 이전
> 협의"를 결론으로 낸다. **이 문서는 그 이전을 실제로 수행하는 절차서다.**
> 화이트리스트 회수(journal·apt·dangling)만 필요하면 [disk-usage-high](./disk-usage-high.md)로 간다.
>
> **에이전트 생성, 사람 적용(§11).** 아래 명령은 사람이 작업 창에서 실행한다.

## 0. 한 줄 요약

사용자 홈을 `/data/home/<계정>`으로 옮기고 **원래 경로에 bind mount**로 겹친다.
경로·`$HOME`·권한이 모두 그대로라 **사용자 경험은 바뀌지 않는다.**

> 아래 모든 블록은 대상 계정이 `U`에 들어 있다고 가정한다. **블록마다 먼저 지정**한다:
> `U=user1`

---

## 1. 사전 조사 결과 (2026-08-10 실측)

| 노드 | 마운트 | 장치 | 크기 | 사용률 | 여유 |
| --- | --- | --- | --- | --- | --- |
| data04 | `/` | sda3 (447G 부팅디스크) | 407G | **96%** | 19 GiB |
| data04 | `/data` | sdb1 (**RAID6 21.8T**) | 22T | 3% | 21T |
| data05 | `/` | sda3 | 407G | **86%** | 54 GiB |
| data05 | `/data` | sdb1 | 3.5T | 11% | 3.0T |

**RAID6는 정상 인식된다.** 알림이 가리킨 건 배열이 아니라 OS 디스크다.
소진 추세: data04 **−33 GiB/7d → 약 4일**, data05 **−70 GiB/7d → 약 5일**.
data05는 **관제 스택 호스트**라 `/`가 차면 Prometheus·OpenSearch·Grafana·GlitchTip이 동시에 멈춘다.

홈 사용량 분포(2026-08-10, **계정명은 익명화** — §13/PUBLIC 레포 규약):

| data04 (`/home` 302G) | | data05 (`/home` 217G) | |
| --- | --- | --- | --- |
| user1 | **134G** | mooner92 | **111G** (`.ollama` 42G · `.cache` 42G) |
| user2 | 76G | user3 | 54G |
| user3 | 38G | user4 | 21G |
| user4 | 30G | user5 | 19G |
| user5 | 23G | user6 | 14G |

> **실제 대상은 작업 시점에 뽑는다** — 사용량은 매일 바뀌므로 표를 신뢰하지 말고 이 명령의 출력을 쓴다:
>
> ```bash
> sudo du -xsh /home/* 2>/dev/null | sort -rh | head
> ```

### 무엇이 `/home`에 묶여 있나 — 이 조사가 계획을 결정했다

**data04 — systemd 유닛의 `/home` 참조 0건.** 대신 **사용자 세션**이 물고 있다:

- **tmux 3명 · 창 11개, 최장 2026-03-05부터 상주** · 나머지 2명도 5~6월부터
- jupyter-lab 3 · gunicorn 2 · code-server(VS Code Remote) 2 — 전부 사용자 세션 기동
- crontab 보유 2명 · 프로세스 수 상위 83 / 33 / 16 / 15개

> [!CAUTION]
> **tmux를 끊으면 그 안의 장기 작업이 함께 죽는다.** 3~6개월 상주 세션이라 무엇이 도는지
> 관리자가 알 수 없다. **사전 통보 없이 진행하지 않는다.**

**data05 — systemd 유닛 8개가 `/home`을 참조한다:**

| 유닛 | 참조 | 대상 계정 |
| --- | --- | --- |
| `keiwi-console` | `/home/mooner92`(PATH) | mooner92 |
| `pm2-mooner92` | `/home/mooner92/.pm2` | mooner92 |
| `hermes-gateway` | `/home/mooner92` | mooner92 (현재 disabled) |
| `vllm-ocr-8010` | `/home/mooner92/.cache/huggingface` | mooner92 (현재 disabled) |
| `jupyter-*` ×3 | 각 사용자 홈의 venv 내 `bin/jupyter` | 연구자 3명 |
| `open-webui` | 위 3명 중 1명의 홈 venv | 연구자 1명 |

> 유닛 ↔ 계정 대응은 레포에 적지 않는다(PUBLIC). 작업 시점에 뽑는다:
>
> ```bash
> grep -l '/home/' /etc/systemd/system/*.service | xargs -r -n1 basename
> ```

로그인 사용자는 mooner92뿐 — **data05는 조율 비용이 낮다.**

### 권한 실태 — 이전과 함께 정리한다

| data04 | | data05 | |
| --- | --- | --- | --- |
| 5개 계정 | `750` ✅ | user2·user5 | `750` ✅ |
| user4 | `700` ✅ | **5개 계정** | **`755` ⚠️ 타인 열람 가능** |
| user6 | `751` | | |

data05의 홈 5개는 **지금도 보호되지 않는다** — "홈은 보호된다"는 전제는 data04에서만 사실이다.
data04의 `/data/user5`은 **`777`**(누구나 삭제 가능) — 이전 시 이 관행을 복제하지 않는다.

`/data`는 `/home`과 **같은 ext4 · 같은 옵션**(`rw,relatime`, `nosuid`·`noexec` 없음), 확장 ACL 0건
→ **권한 체계가 동일하게 작동한다.**

---

## 2. 전략 — 왜 "사용자별"인가

**전체 `/home`을 한 번에 옮기지 않는다.** 그러면 data04에서 3명 전원의 tmux·jupyter·code-server를
동시에 끊어야 하고, 창 하나만 살아 있어도 막힌다. 조율 실패 시 작업 창이 통째로 날아간다.

**한 명씩 옮긴다.** 그 사용자만 로그아웃하면 되고, 실패해도 그 한 명만 롤백한다.
효과도 즉시 나온다 — data04는 **user1 한 명(134G)만 옮겨도 96% → 63%**.

| 순서 | 대상 | 회수 | 위험 | 근거 |
| --- | --- | --- | --- | --- |
| **0** | data05 `mooner92` 캐시(`.cache` 42G · dangling 이미지 12.9G) | **~55G** | **없음** | 재생성 가능. 다운타임 0 — 새벽까지 기다릴 필요 없음 |
| **1** | data05 `mooner92` 나머지(`.ollama` 포함) | ~56G | 낮음 | 본인 계정, 조율 불필요 |
| **2** | data04 `user1` | **134G** | 중 | 최대 효과. tmux 6월부터 — 통보 필수 |
| **3** | data04 `user2` | 76G | 중 | 본인 계정 |
| 4 | data04 `user3`·`user4`·`user5` | 91G | 중 | 다음 회차 |
| 5 | data05 `user3`·`user5`·`user6` | 89G | 중 | jupyter 유닛 정지 동반 |

**0번은 오늘 바로 가능하다.** 1~2번이 이번 새벽 목표다.

---

## 3. D-1 — 전날 준비

- [ ] **통보** — 작업 창(예: 03:00~05:00)과 "tmux·jupyter 세션이 종료된다"를 명시. 장기 작업이 있으면
      체크포인트 요청. **회신 없으면 그 사용자는 이번 회차에서 뺀다.**
- [ ] **여유 확인** — 대상 홈의 1.2배 이상인지(data04 21T · data05 3.0T, 충분)
- [ ] **알림 침묵** — Grafana silence 2시간(`DiskUsageHigh`·`NodeDown` 오탐 방지)
- [ ] **사전 복사(온라인)** — 서비스 정지 없이 미리 대부분을 복사해 둔다. 새벽 다운타임이 수 분으로 줄어든다.

```bash
U=user1
sudo mkdir -p /data/home
sudo chmod 755 /data/home
sudo rsync -aHAX --numeric-ids --info=progress2 "/home/$U/" "/data/home/$U/"
```

`-a`(권한·소유자·시각) `-H`(하드링크) `-A`(ACL) `-X`(확장속성) `--numeric-ids`(UID 그대로).
**후행 슬래시 2개 모두 필수** — 없으면 한 단계 더 깊이 들어간다.
(2026-08-10 검증: rsync 3.2.7에서 `750`/`600` 권한·하드링크 inode 동일성 보존 확인. `attr` 미설치라
xattr 보존은 미검증 — 확장 ACL 0건이라 실무 영향 없음.)

---

## 4. 당일 새벽 — 사용자 1명당 절차

> **한 명을 검증까지 끝낸 뒤** 다음 사람으로 넘어간다.

### 4-1. 세션·서비스 정지

```bash
U=user1
# (data05만) 그 계정에 걸린 유닛 — §1 표 참조
sudo systemctl stop "jupyter-$U" 2>/dev/null || true
# mooner92인 경우: sudo systemctl stop keiwi-console pm2-mooner92
sudo lsof +D "/home/$U" 2>/dev/null | awk 'NR>1 {print $1, $2, $3}' | sort -u
```

**게이트: `lsof` 출력이 비어야 다음으로 간다.** 비지 않으면 사용자에게 정리를 요청하고,
응답이 없으면 **그 사용자는 이번 회차에서 뺀다**(강제 진행하면 복사 중 파일이 바뀌어 정합성이 깨진다).
합의된 경우에만 `sudo pkill -u "$U" -t`로 세션을 종료한다.

### 4-2. 최종 동기화 (차이분만 — 수 초~수 분)

```bash
U=user1
sudo rsync -aHAX --numeric-ids --delete --info=progress2 "/home/$U/" "/data/home/$U/"
```

`--delete`는 사전 복사 이후 삭제된 파일까지 반영한다.

### 4-3. 교체 — 원본은 지우지 않는다

```bash
U=user1
STAMP=$(date +%Y%m%d)
sudo mv "/home/$U" "/home/$U.old-$STAMP"
sudo mkdir "/home/$U"
sudo chown --reference="/data/home/$U" "/home/$U"
sudo chmod --reference="/data/home/$U" "/home/$U"
sudo mount --bind "/data/home/$U" "/home/$U"
```

> [!IMPORTANT]
> **원본을 먼저 `mv`로 치우는 이유**: bind mount로 덮으면 원본이 **보이지 않는 채 용량만 계속
> 차지한다.** 이 순서를 지켜야 나중에 지울 수 있고, 롤백도 `umount` 한 줄로 끝난다.

### 4-4. 영구 반영 (fstab)

```bash
U=user1
sudo cp /etc/fstab "/etc/fstab.bak-$(date +%Y%m%d)"
printf '/data/home/%s  /home/%s  none  bind,x-systemd.requires=/data  0 0\n' "$U" "$U" | sudo tee -a /etc/fstab
sudo mount -a
sudo findmnt --verify
sudo findmnt "/home/$U"
```

`x-systemd.requires=/data`는 **부팅 시 `/data`가 먼저 마운트되도록 보장**한다(없으면 순서 경합으로
빈 디렉터리 위에 서비스가 뜰 수 있다). `findmnt --verify`는 `mount -a`가 놓치는 **부팅 시 도달 가능성**까지
검사한다 — 재부팅 전에 반드시 통과시킨다.

### 4-5. 검증 — 전부 통과해야 완료

```bash
U=user1
# ① 권한·소유자가 원본과 같은가
sudo stat -c '%A %U:%G %n' "/home/$U" "/home/$U".old-*
# ② 본인 계정으로 읽고 쓸 수 있는가
sudo -u "$U" bash -lc 'cd ~ && pwd && touch .migrate-test && rm .migrate-test && echo OK'
# ③ 타인이 못 보는가 (750/700이면 Permission denied가 정상)
sudo -u nobody ls "/home/$U" 2>&1 | head -1
# ④ 파일 수·용량이 맞는가
sudo find "/data/home/$U" | wc -l; sudo find "/home/$U".old-* | wc -l
sudo du -xsh "/data/home/$U" "/home/$U".old-*
```

```bash
U=user1
NODE=192.0.2.14
# ⑤ SSH 키 인증 — StrictModes 때문에 권한이 틀리면 여기서 깨진다
ssh -p <SSH_PORT> "$U@$NODE" 'echo SSH_OK'
# ⑥ (data05) 유닛 재기동
sudo systemctl start "jupyter-$U" 2>/dev/null || true
systemctl is-active "jupyter-$U" || true
```

⑤가 실패하면 **즉시 롤백**한다(§6). 원격 접속 수단을 잃기 전에 되돌리는 것이 최우선이다.
**작업 내내 별도 SSH 세션을 하나 열어 둔 채로** 진행한다.

### 4-6. 사용자 확인 후 원본 삭제 — **여기서 용량이 회수된다**

```bash
U=user1
sudo rm -rf "/home/$U".old-*
df -h /
```

> [!WARNING]
> **삭제 전까지 `/` 용량은 1 GB도 줄지 않는다.** data04는 여유가 19 GiB뿐이라 검증 기간 동안
> 매일 `df`를 확인한다. 급하면 검증 통과 후 당일 삭제한다.

---

## 5. 권한 정리 (이전과 함께)

이전은 권한을 바로잡을 기회다. **이전 직후, 원본 삭제 전에** 적용한다.

```bash
U=user1
sudo chmod 750 "/data/home/$U"
# data04 /data/user5 의 777 교정(별건이지만 같은 창에서 처리 권장)
sudo chmod 750 /data/user5
sudo chown user5:user5 /data/user5
```

data05의 **`755` 홈 5개**(5개 계정)는 이전 대상이 아니어도 `chmod 750`만 따로
적용할 수 있다 — 다운타임 0이지만 **타인 열람에 의존하던 스크립트가 있으면 깨지므로** 사용자 확인 후.

---

## 6. 롤백 — 어느 단계에서든 2분 내 복귀

```bash
U=user1
STAMP=20260810
sudo umount "/home/$U"
sudo rmdir "/home/$U"
sudo mv "/home/$U.old-$STAMP" "/home/$U"
sudo cp "/etc/fstab.bak-$STAMP" /etc/fstab
sudo mount -a
sudo findmnt "/home/$U" || echo "bind 없음 = 원상복구"
```

`/data/home/$U` 사본은 **지우지 않고 남겨둔다** — 다음 회차에 재사용한다.

**롤백 판단 기준**: SSH 키 인증 실패 · 로그인 불가 · 유닛 기동 실패 · 파일 수 불일치.
"느낌이 이상하다"도 충분한 사유다. 원본이 남아 있는 한 되돌리는 비용은 2분이다.

---

## 7. 위험과 대응

| 위험 | 가능성 | 영향 | 대응 |
| --- | --- | --- | --- |
| **tmux 장기 작업 유실**(data04) | 높음 | 큼 | D-1 통보 필수 · 회신 없으면 제외 · 강제 kill 금지 |
| 복사 중 파일 변경 → 정합성 깨짐 | 중 | 중 | `lsof` 게이트 통과 후에만 최종 rsync |
| SSH 키 인증 불능(StrictModes) | 낮음 | **큼** | 검증 ⑤ · 별도 SSH 세션 상시 유지 |
| fstab 오타 → 부팅 불가 | 낮음 | 큼 | `mount -a` + `findmnt --verify` · `fstab.bak` 보존 |
| `/data` 장애 → 홈 전체 접근 불가 | 낮음 | 큼 | RAID6(2본 동시 고장까지) · data04는 NFS 백업 228T |
| 삭제 전 `/` 소진(data04 19 GiB) | **중** | 큼 | 검증 기간 매일 `df` · 급하면 당일 삭제 |
| 심볼릭 링크 방식의 함정 | — | — | **쓰지 않는다.** sshd StrictModes·realpath 해석 문제 → bind mount만 |

---

## 8. 작업 순서 (새벽 2시간 창)

| 시각 | 작업 | 예상 |
| --- | --- | --- |
| D-1 낮 | 통보 · 사전 rsync(온라인) · silence | — |
| 03:00 | data05 `mooner92` — 유닛 정지 → 최종 sync → 교체 → 검증 | 20분 |
| 03:30 | data04 `user1` | 30분 |
| 04:10 | data04 `user2` | 20분 |
| 04:40 | 권한 정리(§5) · 유닛 재기동 · 전체 검증 | 20분 |
| 05:00 | 종료 · silence 해제 · 공지 | — |
| D+1 | 사용자 확인 후 `.old-*` 삭제 → **용량 회수** | — |

**중단 기준**: 04:30까지 진행 중인 사용자를 끝내지 못하면 **그 사용자는 롤백**하고 종료한다.
남은 사용자는 다음 회차로 넘긴다 — 시간에 쫓겨 검증을 건너뛰지 않는다.

---

## 9. 관련

- [disk-pressure](./disk-pressure.md) — 진단·분기(이 문서의 상류) · [disk-usage-high](./disk-usage-high.md) — 화이트리스트 회수
- [specs/alerting](../../specs/alerting/spec.md) — `DiskUsageHigh` >90% · `DiskFillPredicted` 4h 근거
- 헌장 §11(사람 적용) · §12(라이브 격리)

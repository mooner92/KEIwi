---
id: nvidia-driver-mismatch
service: nvidia
category: gpu
signature: "API mismatch"
affected_nodes: [data05]
first_seen: 2026-07-30
last_seen: 2026-08-06
occurrences: 1
status: resolved
fix_kind: workaround
detection_query: '{"query":{"match_phrase":{"message":"API mismatch"}}}'
---

# 런북 — NVIDIA 드라이버 커널↔유저스페이스 불일치

> 무인 업그레이드가 유저스페이스(NVML·nvidia-smi)를 새 버전으로 교체했지만 **재부팅을 안 해서**
> 커널에는 구버전 모듈이 남아 있는 상태. 기존에 GPU를 잡은 프로세스는 계속 돌지만,
> **신규 GPU 프로세스는 전부 기동 실패**한다. 겉보기 증상이 "vLLM이 안 뜬다"라서 원인을 놓치기 쉽다.
> 실사례: **data05 (2026-07-30 발견 → 2026-08-06 재부팅으로 수복)** — [hardware-ops T0-4](../../specs/hardware-ops/tasks.md).

## 증상

- `nvidia-smi` 실패 — **exit 18**, 메시지: `Failed to initialize NVML: Driver/library version mismatch`.
- 신규 GPU 프로세스(vLLM 등)가 `Failed to infer device type`으로 즉시 죽고, systemd `Restart=` 유닛은 **auto-restart 무한 루프**(CPU만 소모).
- 커널 로그(journald/`dmesg`)에 `NVRM: API mismatch: the client has the version X, but this kernel module has the version Y`.
- **기존 프로세스는 멀쩡** — 드라이버 교체 전에 GPU를 잡았기 때문. "8003은 사는데 8010은 죽는" 식의 비대칭이 이 결함의 지문이다.
- 메트릭: `node_nvidia_smi_ok = 0` · `node_nvidia_version_mismatch = 1` (node-hygiene, T0-1 배포 후) · `gpu_vram_total_bytes`에서 해당 노드 시리즈 소실(여유 판정 "판정불가", [ADR-0013](../decisions/0013-capacity-judgment-policy.md)).

## 판별 (3줄 — 해당 노드에서, 읽기 전용)

```bash
grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' /proc/driver/nvidia/version | head -1   # ① 커널 모듈 버전
readlink -f /usr/lib/x86_64-linux-gnu/libnvidia-ml.so.1                      # ② 유저스페이스(NVML) 버전 — .so.<버전>
modinfo nvidia | grep ^version                                               # ③ 디스크의 모듈 패키지 버전
```

①≠② 이면 mismatch 확정. (③이 ②와 같고 ①만 다르면 "설치는 됐고 재부팅만 안 한" 전형적 케이스.)

## 원인

`unattended-upgrades`가 NVIDIA 드라이버 패키지를 자동 갱신 → 유저스페이스는 즉시 교체되지만 로드된 커널 모듈은 재부팅 전까지 구버전 유지. (data05 실측: 커널 595.71.05 vs 유저스페이스 595.84, 무인 업그레이드 후 58일 미재부팅.)

## 조치 — 재부팅 (사람 적용, §11)

1. **사전 확인**: 그 노드에서 GPU를 잡고 있는 프로세스 파악(`fuser -v /dev/nvidia*` 또는 gpu-model-exporter). 구버전으로 살아있는 프로세스는 재부팅 후 **신버전 스택으로 다시 뜨며 서빙 모델이 바뀔 수 있다** — 콘솔 어시스턴트가 그 vLLM을 쓴다면 `.env.local`의 `VLLM_MODEL`을 새 모델 id로 맞추고 `keiwi-console` 재시작까지가 한 세트다(2026-08-06 실증: 8003이 Qwen3-Coder-30B → Qwen2.5-Coder-32B로 교체되어 어시스턴트 502).
2. auto-restart 루프 중인 유닛이 있으면 `systemctl stop`(재부팅 전 소음 제거).
3. **재부팅**.
4. **사후 검증**: `nvidia-smi` 정상 · `/var/run/cdi/nvidia.yaml` 재생성 확인 · GPU 유닛 active · `gpu_vram_total_bytes`에 해당 노드 시리즈 복귀 · `node_nvidia_version_mismatch = 0`.

## 예방

- **NVIDIA 패키지를 `unattended-upgrades` 블랙리스트에 등록** — 드라이버 갱신을 계획된 재부팅 창과 묶는다. 표준·절차는 [ADR-0020(예정)](../../specs/hardware-ops/tasks.md) (T6-1).
- node-hygiene의 정합성 4메트릭(T0-1)이 배포되면 mismatch 발생 즉시 메트릭으로 잡힌다 — `node_reboot_required`와 함께 보면 "업그레이드됐고 재부팅 대기 중"을 사전에 식별할 수 있다.

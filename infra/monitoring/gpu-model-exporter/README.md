# GPU model exporter — 어느 모델이 어느 GPU에 떠 있나

> DCGM(util·VRAM 숫자)이 **"무슨 모델"**인지는 안 알려준다. 이 익스포터가 GPU 컴퓨트 프로세스(vLLM/ollama)를
> `/proc` cmdline·`nvidia-smi`로 추적해 **모델↔GPU↔포트↔pid** 매핑을 Prometheus로 노출한다.
> KEIwi의 GPU 모델-인지 관측(M1 고도화)·`gpu-models` 대시보드가 이것에 의존한다.

## 왜 레포에 (버전관리 이유 — §11/§12)

이 익스포터는 본래 **MineSweeper 프로젝트**(`/gits/MineSweeper/deploy/gpu-model-exporter.py`)에서 만들어 data05에서 **PM2로 실행** 중이었다. 그러나 KEIwi 모니터링(Prometheus `gpu-model-exporter` 잡, `172.18.0.1:9836`)이 여기 의존하는데 **소스가 레포 밖 라이브 호스트에만 존재** → 호스트 재구성 시 모델 매핑이 통째로 소실된다(헌장 §11 에이전트 생성·§12 라이브 보호 위반). 그래서 KEIwi 모니터링 컴포넌트로 **여기에 미러링**한다(stdlib만, 의존성 0). 상류 수정 시 이 사본을 동기화하거나, 이 사본을 KEIwi용 정본으로 삼는다.

## 노출 메트릭 (실측)

```
gpu_model_vram_bytes{gpu,model,framework,port,pid}   # 그 모델 프로세스가 쓰는 VRAM(bytes)
gpu_model_info{gpu,model,framework,port,pid} 1        # 존재(1)
gpu_vram_total_bytes{gpu} / gpu_vram_used_bytes{gpu} / gpu_vram_free_bytes{gpu}
```
예: `gpu_model_vram_bytes{gpu="0",model="Qwen3-Coder-30B-A3B-Instruct-AWQ",framework="vllm",port="8003",...}`.

## 배포 (사람, §11 — 각 GPU 호스트)

의존성 없음(파이썬 stdlib). nvidia-smi + `/proc` 읽기.
- **현재(라이브):** data05에서 PM2(`pm2 start gpu-model-exporter.py --name gpu-model-exporter --interpreter python3`).
- **권장(재현가능):** `keiwi-gpu-model-exporter.service` systemd 유닛(이 디렉터리). ExecStart 경로만 배포 위치로 맞춰 `enable --now`.
- Prometheus는 `infra/monitoring/prometheus.yml`의 `gpu-model-exporter` 잡으로 `172.18.0.1:9836` 스크레이프(이미 라이브).
- 확인: `curl -s localhost:9836/metrics | grep gpu_model_info`.

## 노드 범위 (중요)

이 익스포터는 **로컬 nvidia-smi/`/proc`만 읽으므로 자기 호스트의 GPU만** 보고한다. 현재 **data05만** 모델 매핑이 있다. data04 등 다른 GPU 노드의 모델-인지는 **그 노드에서 익스포터를 띄우고** Prometheus가 스크레이프(직접 또는 DCGM처럼 SSH 터널)해야 한다 — 미검증 전제이므로 별도 작업(ADR/spec 게이트).

## 보안 (§13)

시크릿 없음. 내부망 전용(외부 노출 금지). 읽기 전용(시스템 수정 안 함, systemd 하드닝 적용).

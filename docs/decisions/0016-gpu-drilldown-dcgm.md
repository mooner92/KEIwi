# 0016 — GPU 드릴다운: 노드별 DCGM 대시보드로 분리

- 상태: 채택(2026-06-29)
- 맥락: [ADR-0002](./0002-grafana-embed.md) (Grafana 단일·재구현 금지), inventory.yaml
- 관련: [[m2-logs-live]]

## 증상

Overview에서 **data04 노드를 눌러도 GPU 탭에 data05 GPU/모델이 표시**됨(반복 보고).

## 근본 원인 (var 주입 버그 아님 — 데이터 부재)

콘솔 GPU 탭이 **`gpu-models-ver2`**(Grafana UI에서 손수 만든 대시보드)를 임베드하는데, 이 대시보드는 **커스텀 gpu-model-exporter(:9836) 메트릭** 위에 만들어졌다. 실측:

| 데이터소스 | data04 | data05 |
|---|---|---|
| DCGM(:9400) GPU 하드웨어(util·VRAM·온도·전력) | ✅ RTX 6000 ×2 | ✅ A40 ×2 |
| gpu-model-exporter(:9836) 모델↔GPU 매핑 | ❌ 없음 | ✅ (`172.18.0.1:9836`) |
| 추적되는 vLLM 워크로드 | ❌ | ✅ 8003·8010 |

`gpu_model_*` 메트릭은 data05 단일 호스트(9836)에만 있고, 추적되는 모델(Qwen3-Coder 8003, Qwen2.5-VL-OCR 8010)도 전부 data05에서 돈다. 따라서 data04를 눌러 `var-instance`를 주입해도 그 대시보드엔 data04 시리즈가 없어 data05가 그대로 보인다. **데이터가 없는 것**이지 변수 문제가 아니다.

## 결정

GPU를 두 관심사로 분리한다:

1. **GPU 탭 = 노드별 DCGM 대시보드(uid `keiwi-gpu`)** — 이미 repo에 있던 `infra/monitoring/dashboards/gpu.json`. `instance` 템플릿 변수(`label_values(DCGM_FI_DEV_GPU_TEMP, instance)`)로 모든 패널을 `{instance=~"$instance"}` 필터. 콘솔이 노드 클릭 시 주입하는 `var-instance=<dcgm ip:9400>`와 그대로 맞물려 **data04→RTX 6000 ×2** 정확 표시. 본 ADR에서 변수를 multi+includeAll(전체 보기=두 노드)로, 패널을 `=~`로 보정하고, 오해 소지 있던 "적재 모델" 테이블을 "VRAM·스펙(물리 GPU)"으로 정정.
2. **모델 탭 = `keiwi-model-workload`(repo 프로비저닝, data05)** — fleet 모델 워크로드 뷰. 노드 스코핑 없음(콘솔은 'GPU' 라벨 첫 탭에만 DCGM instance 주입 → `findGpuTab`이 `keiwi-gpu`를 선택, '모델' 탭은 미주입).
   - ⚠️ 당초 'GPU' 탭이 가리키던 `gpu-models-ver2`는 **Grafana UI에서 손수 만든 대시보드**였고, `keiwi-gpu` 프로비저닝을 위한 `docker restart`(컨테이너 재생성) 시 **DB와 함께 소실**됐다("Dashboard not found"). 파일 프로비저닝 대시보드(logs·gpu·model-workload)는 재기동마다 provider가 다시 로드해 살아남는다 → 모델 뷰도 repo의 `model-workload.json`(vLLM 요청/토큰/지연/KV캐시 + 모델↔GPU VRAM + DCGM)으로 대체. **교훈: 콘솔이 임베드하는 대시보드는 UI 수제가 아니라 repo 프로비저닝이어야 한다(§12).**

콘솔 코드 변경 불필요 — 기존 드릴다운(`grafana-tabs.tsx`의 `selectedDcgm` 주입)이 `keiwi-gpu`의 `instance` 변수와 호환. env(`GRAFANA_DASHBOARD_UID`)에서 탭 순서·라벨만 조정(사람, §11).

## 적용 (사람, data05 — §11)

```bash
# 1) GPU(keiwi-gpu) + 모델(keiwi-model-workload) 대시보드 프로비저닝
#    (라이브 Grafana는 바인드 마운트 없음 → docker cp)
sudo docker cp infra/monitoring/dashboards/gpu.json \
    grafana:/etc/grafana/provisioning/dashboards/keiwi/gpu.json
sudo docker cp infra/monitoring/dashboards/model-workload.json \
    grafana:/etc/grafana/provisioning/dashboards/keiwi/model-workload.json
sudo docker restart grafana   # 또는 provider updateInterval(30s) 대기

# 2) .env.local GRAFANA_DASHBOARD_UID 탭 구성:
#    시스템 | GPU=keiwi-gpu/gpu | 모델=keiwi-model-workload/keiwi-model-workload
# 3) 콘솔 재시작(env 반영): sudo systemctl restart keiwi-console
```

## 한계 / 후속

- data04의 **LLM 모델 뷰**는 거기서 모델을 구동할 때만 의미 있음(현재 미구동). 구동 시 gpu-model-exporter(vendored)를 data04에 배포 + 모델 메트릭에 node 라벨 추가 필요 — 백로그(B04).
- docker cp 주입은 컨테이너 재생성 시 소실(볼륨 아님). 영구화는 라이브 compose에 provisioning 바인드 마운트(별도 작업). 레포가 원본.

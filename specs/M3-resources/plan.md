# M3 여유 리소스 (Overview 통합) — Plan (HOW)

- 상태: 진행 중
- 권위: [spec.md](./spec.md) 종속. 헌장 우선.
- 관련: 작업=[tasks.md](./tasks.md) · 근거=[research.md](./research.md) · 결정=[ADR-0012](../../docs/decisions/0012-roadmap-m3-m4-pivot.md)(흡수)/[ADR-0013](../../docs/decisions/0013-capacity-judgment-policy.md)(판정 정책)

> 무엇·왜=spec.md. 여기선 **어떻게**(메트릭·판정식·타입·통합·검증).

## 1. 기술 컨텍스트
- 데이터 = **M1 Prometheus**(node-exporter 9100 + DCGM 9400). **새 수집 0**. `PROMETHEUS_URL`(서버 전용).
- 질의 = `apps/console/src/lib/prometheus.ts` 확장(`queryUp` 패턴 — 서버 전용, 실패 시 throw → 호출부가 안전 귀결).
- 판정 = 순수 함수 `lib/capacity.ts`(단위 테스트 대상, `status.ts`/`status.test.ts` 패턴).
- UI = **Overview에 통합**(별도 탭 X). fleet strip 카드에 **여유 배지** + 상단 **배치 추천 한 줄**. 네이티브 "판정·요약" 뷰(§I-2 — 대시보드 재구현 아님). 드릴다운은 기존 `GrafanaEmbed` 재사용.

## 2. 헌장 체크
| 조항 | 준수 |
|---|---|
| §I-2 단일 콘솔=Grafana | 판정·요약만 네이티브(fleet strip류), 상세 그래프는 Grafana 임베드 드릴다운 |
| §6 지루한 기술 | 새 수집·새 의존 0. 기존 메트릭 + 순수 판정 함수 |
| §8 의존성=ADR | 판정 임계·정책 = ADR-0013 |
| §11/§12 | infra 무변경(읽기만), 라이브 직접수정 없음 |
| §13 시크릿 | Prometheus URL은 비밀 아님(M1 기존). 실패 시 안전 귀결(거짓 "여유" 금지) |
| US4 정직성 | no-data·GPU없음 = 판정불가(추정 금지) |

## 3. 메트릭 & PromQL (실측 확인됨 2026-06-29)
인스턴스 매칭은 `node.exporters`(node=ip:9100, dcgm=ip:9400)로 — `status.ts`와 동일.

| 축 | PromQL | 비고 |
|---|---|---|
| CPU busy% | `100*(1 - avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])))` | 0~100 |
| Mem 가용% | `100*node_memory_MemAvailable_bytes/node_memory_MemTotal_bytes` | 0~100 |
| GPU util% | `DCGM_FI_DEV_GPU_UTIL` | per-GPU(노드당 복수) |
| GPU 가용 VRAM% | `100*DCGM_FI_DEV_FB_FREE/(DCGM_FI_DEV_FB_FREE+DCGM_FI_DEV_FB_USED)` | per-GPU |

**핵심(실측):** GPU는 **util=0이어도 VRAM이 가득**일 수 있다(모델 로드됨, 연산만 idle) — 예 data05 gpu0 free 8.7%. 따라서 **"GPU 작업 받을 수 있나"의 binding 제약은 가용 VRAM**(모델이 들어갈 자리). util은 "지금 바쁜가"의 보조 신호. 노드의 GPU 여유 = **가장 여유한 GPU(max 가용 VRAM%)** 기준.

## 4. 판정식 (이산 등급 — ADR-0013, 임계는 정책)
노드별로 두 축을 각각 등급화(`free`/`busy`/`full`/`unknown`):

- **GPU축**(DCGM 보유 시): `best = max GPU 가용VRAM%`, `bestUtil = 그 GPU util`.
  - `free`  : best ≥ `GPU_VRAM_FREE`(기본 50) **AND** bestUtil ≤ `GPU_UTIL_BUSY`(기본 30)
  - `full`  : best < `GPU_VRAM_FULL`(기본 15) **OR** 모든 GPU util ≥ `GPU_UTIL_FULL`(기본 85)
  - else `busy`. DCGM 없으면 `gpu=null`(해당 없음).
- **일반축**(CPU+Mem): `cpuBusy%`, `memAvail%`.
  - `free` : cpuBusy ≤ `CPU_BUSY`(기본 50) AND memAvail ≥ `MEM_FREE`(기본 40)
  - `full` : cpuBusy ≥ `CPU_FULL`(기본 85) OR memAvail < `MEM_FULL`(기본 15)
  - else `busy`.
- **데이터 없음**(매칭 series 0) → 해당 축 `unknown`. 노드 전체 메트릭 없으면 `hasData=false`.
- **배치 추천**: GPU축 `free` 노드를 `best 가용 VRAM% 내림차순` 정렬 → 1위를 "지금 GPU 작업은 dataX (VRAM N% 여유)"로. GPU free 없으면 "여유 GPU 없음".

## 5. 타입 (`types/fleet.ts` 또는 `types/capacity.ts`)
```ts
type Verdict = "free" | "busy" | "full" | "unknown";
type GpuCapacity = { present: true; bestVramFreePct: number; bestUtilPct: number; gpuCount: number; verdict: Verdict };
type NodeCapacity = {
  id: string;
  hasData: boolean;
  general: { cpuBusyPct?: number; memAvailPct?: number; verdict: Verdict };
  gpu: GpuCapacity | null;   // null = GPU 없음(해당 없음)
};
```

## 6. 산출물 (apps/console)
- `lib/prometheus.ts` — `queryCapacity()`: 위 4개 PromQL을 질의해 인스턴스별 원시값 반환(서버 전용). 실패 throw.
- `lib/capacity.ts` — `resolveFleetCapacity(nodes, raw)`(순수) + `getFleetCapacity()`(오케스트레이터, 실패→전부 unknown).
- `lib/capacity.test.ts` — 순수 판정 단위 테스트(free/busy/full/unknown, GPU없음, VRAM-binding 케이스).
- `config/capacity-policy.ts`(또는 capacity.ts 상수) — 임계 8개(ADR-0013). 선택적 env override.
- `app/overview/page.tsx` — `getFleetCapacity()`를 `getFleetStatus()`와 병렬 fetch → FleetStrip·추천 배너에 전달.
- `components/fleet/` — 카드에 **여유 배지**(GPU·일반), 상단 **PlacementHint**(추천 한 줄). 드릴다운은 기존 유지.

## 7. UI/UX (KRDS·접근성)
- 배지: 색+텍스트(색 단독 금지) — `free`=성공(초록), `busy`=경고(노랑), `full`=위험(빨강), `unknown`=중립("판정불가"). System 색(color.spec) 재사용.
- 배치 추천 배너: "🟢 GPU 작업은 **data04** 추천 (VRAM 78% 여유)". 여유 없으면 "여유 GPU 없음 — 전체 바쁨".
- 임계 노출(UR4): 배지 툴팁 또는 추천 옆 "기준: VRAM≥50%·util≤30%".
- 정직성: `unknown`은 회색·"데이터 없음/해당 없음", 절대 "여유" 아님.

## 8. 단계
| Phase | 산출 | 상태 |
|---|---|---|
| 1 스펙 | spec.md | ✅ |
| 2 설계 | plan + ADR-0013(임계 정책) | 진행 |
| 3 데이터 | prometheus.queryCapacity + capacity.resolve/get + 테스트 | ⬜ |
| 4 UI | Overview 통합(배지·추천), 드릴다운 재사용 | ⬜ |
| 5 검증 | verify + 단위테스트 + Playwright(라이트/다크) + 실데이터(data04 GPU여유) | ⬜ |

## 9. 검증 전략
- `lib/capacity.test.ts`: 순수 판정 경계값(임계 전후), GPU없음→null, no-data→unknown, VRAM가득+util0→full(여유 아님).
- `npm run verify`(타입·린트·테스트·빌드).
- 실데이터: data04=GPU free(VRAM~78%), data05=GPU full/busy(VRAM~9% best), CPU/메모리 여유.
- Playwright 스크린샷(라이트·다크) 공유([[visual-qa-at-task-end]]).

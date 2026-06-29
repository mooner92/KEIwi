# 0013. 여유 리소스 판정 정책 (메트릭·임계·표현)

- 상태: 채택 (2026-06-29)
- 관련: [M3 spec](../../specs/M3-resources/spec.md) · [plan](../../specs/M3-resources/plan.md) · [ADR-0012](0012-roadmap-m3-m4-pivot.md)(M3 흡수).

## 맥락

M3 여유 리소스 뷰가 "어느 서버가 free인지"를 판정하려면 **어떤 메트릭으로, 어떤 임계로, 어떻게 표현**할지 정해야 한다. 추정으로 "여유"라 하면 오배치(OOM·경합)를 부르므로 정책에 근거가 필요하다(헌장 §8).

**실측 인사이트(2026-06-29 Prometheus):** GPU는 `util=0`이어도 VRAM이 가득일 수 있다 — data05 gpu0은 util 0%인데 가용 VRAM 8.7%(vLLM 모델 상주). 반대로 data04는 VRAM 78% 여유 + util 0 = 진짜 여유. → **"GPU 작업을 받을 수 있나"의 결정 제약은 가용 VRAM**(모델이 들어갈 자리)이지 util이 아니다.

## 결정

**(1) 이산 등급으로 표현:** `free` · `busy` · `full` · `unknown`. 연속 점수(0~100)보다 운영자가 즉시 결정하기 쉽다("초록이면 돌려라").

**(2) 두 축 분리 판정:** **GPU축**(DCGM)과 **일반축**(CPU+메모리)을 따로 등급화한다. GPU 작업은 GPU축, jupyter/웹/연산은 일반축을 본다. 노드 특성(GPU 유무)을 반영.

**(3) GPU 판정의 binding = 가용 VRAM, util은 보조:** 노드의 GPU 여유 = **가장 여유한 GPU의 가용 VRAM%**.
- `free`: 최고 가용 VRAM ≥ **50%** AND 그 GPU util ≤ **30%**
- `full`: 최고 가용 VRAM < **15%** OR 모든 GPU util ≥ **85%**
- else `busy`. (DCGM 없으면 `null` = 해당 없음.)

**(4) 일반축 판정:**
- `free`: CPU busy ≤ **50%** AND 메모리 가용 ≥ **40%**
- `full`: CPU busy ≥ **85%** OR 메모리 가용 < **15%**
- else `busy`.

**(5) 임계는 정책 상수(조정 가능):** 위 8개 값은 `config/capacity-policy.ts` 상수로 두고, 필요 시 env로 override. 기본값은 **보수적**(여유를 쉽게 선언하지 않음 — 오배치 비용 > 미배치 비용).

**(6) 무데이터·실패 = `unknown`:** 매칭 series 0(no-data) 또는 Prometheus 불가 시 해당 축 `unknown`("판정 불가"). **절대 거짓 "여유" 금지**(US4). 배치 추천도 `free`가 확실한 노드에서만 한다.

## 고려한 대안

- **연속 여유 점수(0~100)** — 정밀하나 운영자가 "몇 점이면 돌려도 되나" 또 판단해야 함 → 이산 등급이 결정 친화.
- **util만으로 GPU 판정** — VRAM 가득(모델 상주)인데 "여유"로 오판(data05 사례) → 기각, VRAM이 binding.
- **단일 종합 등급(축 합산)** — GPU 여유 vs 일반 여유 정보가 섞여 손실. 작업 종류별 결정 불가 → 두 축 분리.
- **평균 GPU 기준** — 노드에 여유 GPU 1장만 있어도 그걸 쓰면 되므로 max(가장 여유한 GPU)가 결정에 맞다.

## 결과

- data04=GPU `free`(VRAM~78%), data05=GPU `full`/`busy`(best VRAM~32%) 처럼 실측과 일치하는 판정.
- 임계가 정책 상수라 운영 중 조정(연구 패턴 따라). 근거는 본 ADR.
- 판정 로직은 순수 함수(`lib/capacity.ts`)로 단위 테스트(경계값·VRAM-binding·no-data).
- 참조: [plan §3·4](../../specs/M3-resources/plan.md), 헌장 §6/§8, US4 정직성.

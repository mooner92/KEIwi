# KEIwi에 AI를 넣는 방식 — 챗 어시스턴트 너머 (결정 보고서)

| 항목 | 내용 |
|---|---|
| 상태 | 리서치 확정 — 착수는 사용자 선택 후 |
| 작성일 | 2026-07-06 |
| 입력 | 리서치 4건: ① 통계·고전 ML 이상탐지 ② 로그 마이닝·패턴 지능 ③ 비대화형 LLM 운영 패턴 ④ 창의적·신흥 AIOps |
| 범위 | 대화형 어시스턴트를 **제외한** AI의 인프라 관리 투입 방식 결정 |
| 전제(기보유, 재추천 아님) | 로컬 vLLM(Qwen3-Coder-30B)+BM25 RAG 로그 어시스턴트(서버검증 인용) · Prometheus+DCGM · OpenSearch(RCF 내장·미활성) · Grafana · predict_linear · Ansible |
| 제약 | egress 0(외부 API 금지) · §11(AI는 생성만, 적용은 사람) · §12(라이브 직접수정 금지) · SRE 1인 |

**결론 요약** — 4개 리서치가 독립적으로 같은 곳에 수렴했다.

1. **숫자 이상탐지는 LLM이 아니라 통계·결정적 룰이 정석**이다. LLM을 이상탐지기로 쓰는 성공 사례는 조사 전체에서 없었다. LLM의 자리는 그 위의 **설명·문장화·코드 초안** 레이어다.
2. KEIwi의 첫 수는 신규 도입이 아니라 **잠자는 자산 활성화**다: OpenSearch RCF(미활성), DCGM(수집 중이나 전조 룰 없음), predict_linear(선형 한계 보완).
3. KEIwi의 구조적 엣지는 **유휴 GPU = 배치 LLM·임베딩 한계비용 0**이며, 이를 현금화하는 지점은 대화가 아니라 **야간 배치 파이프라인**(다이제스트·라벨링·임베딩)이다.
4. 단, 라벨 없는 비지도 탐지를 페이저에 직결하면 1인 운영은 소음에 익사한다. **"이상탐지 → 다이제스트, 페이징 → 결정적 룰만"** 이 모든 것의 전제 게이트다.

---

## 1. 지형도 — AI 활용 4상한

축: **가로 = 기술 요건**(LLM 불필요 ↔ LLM/임베딩 필요), **세로 = 역할**(탐지·분석 ↔ 생성·제안).

| | **탐지·분석** | **생성·제안** |
|---|---|---|
| **LLM 불필요**<br>(통계·고전 ML·결정적 룰) | · promql-anomaly-detection 밴드(z-score+MAD+계절 오프셋)[^1]<br>· OpenSearch RCF 이상탐지(미활성 자산)[^5]<br>· GPU 전조 룰: XID·ECC DBE·row-remap[^3][^28]<br>· SMART 핵심 5속성 0→비0 전이[^7][^8]<br>· Drain3 템플릿 마이닝 + 신규성·빈도·소멸 감지[^10]<br>· changepoint(ruptures/CUSUM) 레짐 변화[^14]<br>· Chronos-Bolt zero-shot 시계열 예측(LLM 아님)[^12] | · 주간 dcgmi diag 배치 리포트[^4]<br>· 유휴 GPU 창 예측 → 배치 스케줄 제안[^12]<br>· GPU 전력캡 파레토 추천 리포트[^25]<br>· predict_linear류 용량 예측(기존) |
| **LLM·임베딩 필요** | · 템플릿 임베딩 시맨틱 레이어(bge-m3+k-NN)[^15][^16]<br>· 인시던트 메모리: 유사 과거 사건 검색·첨부[^17][^22]<br>· RCF/밴드 이상치의 야간 LLM 판정(노이즈 필터)<br>· 시맨틱 알림 클러스터링<br>· Qwen2.5-VL 차트 해설(수치는 PromQL 병행)[^23][^24] | · 아침 플릿 다이제스트(structure-then-generate)<br>· 알림 조사 패키지(가설 서술만)[^18][^19][^20]<br>· 신규 템플릿 배치 라벨링(카테고리·심각도·한국어 설명)<br>· 포스트모템 초안·런북 diff PR<br>· Ansible 변경 자문 리뷰(생성 아님)[^21]<br>· 합성 로그 주입(모니터링 유닛테스트)[^26]<br>· 탐지 룰 코드 초안(CodeAD식)[^27]<br>· 관측 갭 감사·드리프트 의미 해석 |

지형도가 말하는 것 세 가지:

- **좌상단이 탐지의 본진이다.** 문헌 근거: 딥러닝 로그 이상탐지(DeepLog/LogBERT류)는 실증 연구에서 단순 템플릿+빈도 기법과 동급이거나 열세이며 라벨·재학습 부담만 크다[^11]. 실무(Grafana·Datadog·IBM)도 전부 Drain류 템플릿 마이닝+통계로 수렴했다. 하드웨어 전조(GPU·디스크)는 ML조차 불필요 — 대규모 실측이 증류된 결정적 임계값이 정답이다[^3][^8].
- **LLM의 역할은 우측 열에 격리된다.** 감지 정확도에 LLM이 관여하는 항목은 하나도 없다. LLM이 틀려도 좌측(원시 증거·통계 산출물)의 가치는 유지되는 구조가 전 항목의 설계 원칙이다.
- **"행동(적용)" 상한은 존재하지 않는다.** §11에 의해 적용은 전 항목에서 사람 전담이며, 산출물은 리포트·어노테이션·PR까지만이다.

---

## 2. Tier 표 — 기존 자산 위에 얹는 순서

평가 기준: 가치 × KEIwi 적합(유휴 GPU 이점 · egress 0 · 1인 유지비) × effort(S≤1주 / M 1~3주 / L 3주+) × 오탐·환각 risk. **수렴도** = 4개 리서치 중 독립 추천 수.

### Tier 1 — 즉시 (신규 데몬 0~1개, 전부 기존 스택 위)

| # | 항목 | 무엇 | 얹는 자산 | Effort | Risk | 수렴 |
|---|---|---|---|---|---|---|
| 1-0 | **운영 원칙 게이트 문서화** | 비지도 출력(RCF grade·밴드 이탈)은 페이징 금지, 다이제스트·대시보드만. 페이징은 결정적 룰(predict_linear 임계, ECC DBE>0, SMART 전이, 서비스 다운)만. 알림 승격은 2주 섀도에서 정탐 확인된 것만 | 게이트형 SDD 문화 | S | 없음 | 4/4 (함정으로 공통 지적) |
| 1-1 | **GPU 고장 전조 결정적 룰** | 즉시 페이징: `DCGM_FI_DEV_ECC_DBE_VOL_TOTAL > 0`, row-remap failure/pending, XID 48/63/79. 추세: XID 94 일 10회↑, XID 63 누적. dmesg XID → textfile collector. 주간 `dcgmi diag -r 2` Ansible 배치(결과 리포트만)[^3][^4][^28] | DCGM(수집 중) | S | 낮음 | 1/4 (단독 축이나 자산가치 최대) |
| 1-2 | **promql-anomaly-detection 도입** | Apache-2.0 recording rule 모음. adaptive(평균±σ)·robust(중앙값+MAD) 2전략, 24h 오프셋 밴드로 일일 주기 학습, 변동계수 필터로 오탐 억제. node CPU/mem/net + DCGM util·temp·power에 라벨 태깅, Grafana 밴드 오버레이[^1][^2] | Prometheus+Grafana, predict_linear의 자연 확장 | S | 낮음 (직접 페이징 금지 조건) | 1/4 |
| 1-3 | **OpenSearch RCF 활성화 (관찰 모드)** | 카테고리·호스트별 HC 디텍터(피처 2~3개: 로그량·에러율), 2.17+ suppression rule로 오탐 억제. 첫 48h 튜닝 금지, 첫 2~4주 알림 미연결 — 대시보드·다이제스트만[^5][^6] | OpenSearch(내장·미활성) | S~M | 중간 (억제 룰 미튜닝 시 소음원 1순위) | **4/4** |
| 1-4 | **smartctl_exporter 배포** | SMART 5·187·188·197·198의 0→비0 전이 알림 + increase() 추세를 predict_linear 디스크 예측과 한 대시보드에[^7][^8]. Scrutiny는 보류(스프롤) | Prometheus+Ansible 5노드 일괄 | S | 낮음 | 1/4 |

선행 과제: **data04 GPU exporter 미배포 갭 해소**(B04 §11 기지 이슈) — 1-1의 전제.

### Tier 2 — 핵심 (LLM·임베딩을 "항시 파이프라인"에 넣는 단계)

| # | 항목 | 무엇 | 얹는 자산 | Effort | Risk | 수렴 |
|---|---|---|---|---|---|---|
| 2-1 | **Drain3 템플릿 마이닝 기반층** | OpenSearch 인입/주기 쿼리에 Drain3(순수 Python·CPU) → 신규 템플릿 즉시 검출, 템플릿 레지스트리 인덱스(first_seen/count). 부산물로 템플릿 빈도 시계열 → 급증 + **소멸(silence) 감지**(하트비트 사라짐 = 기존 스택의 완전 사각지대)[^10] | M2 통합 로그, 기존 알림 체계 | M | 낮음 (마스킹 튜닝 필요) | 3/4 (모든 LLM 아이디어의 전처리층) |
| 2-2 | **야간 배치 LLM 다이제스트 (아침 브리핑)** | cron: 지난 24h 사실을 **결정적으로 집계**(신규 템플릿, 급증/소멸, RCF 이상, 알림, predict_linear 위반 후보, GPU 가동률) → vLLM이 한국어 서술만. RCF 이상치의 "주목 N건/노이즈 M건(사유)" 판정 레이어 포함. 각 주장에 doc_id 인용 — 기존 서버검증 인용 검증기 재사용. 내용 없으면 발송 생략 | vLLM+인용검증 자산, 야간 유휴 GPU | M | 중간 (환각 — 사실·서술 분리로 통제) | **3/4 top3** |
| 2-3 | **신규 템플릿 LLM 배치 라벨링** | 신규 템플릿 발생 시에만 1회 호출 → {카테고리, 심각도, 한국어 한줄 설명, 의심 원인}을 레지스트리 메타데이터로. M2 category 분류를 정적 규칙에서 자기확장형으로. 사람이 레지스트리에서 수정 우선권, 저신뢰는 unclassified | vLLM, M2 category 체계 | S (2-1 이후) | 낮음 | 2/4 |
| 2-4 | **알림 조사 패키지 자동 생성** | Alertmanager webhook → 알림 타입별 **결정적 수집기**(±30분 메트릭 스냅샷, 해당 host 로그, Ansible 최근 커밋, Grafana annotation) → vLLM이 가설 서술('후보' 표기) + BM25 유사 과거 알림 + 런북 링크 첨부. Datadog Bits·incident.io·HolmesGPT의 공통 구조를 §11 준수형(조사만)으로 축소[^18][^19][^20] | Alertmanager, 기존 RAG 코드 재사용 | M | 중간 (앵커링 편향) | 1/4 top3 |
| 2-5 | **임베딩 시맨틱 레이어 + 인시던트 메모리** | bge-m3 self-host(수 GB VRAM) → **원시 로그가 아닌 템플릿만** 임베딩 → OpenSearch k-NN(별도 벡터DB 불필요). 용도: 시맨틱 중복제거, "이 에러 본 적 있나" 검색, 인시던트·조치기록 임베딩 → 새 알림에 유사 과거 사건 top-3+당시 조치 자동 첨부(유사도 하한 미달 시 생략)[^15][^16][^17][^22]. 파생: 기존 BM25 RAG의 하이브리드(BM25+k-NN) 업그레이드 | OpenSearch k-NN, 365d 보존, RAG 자산 | M | 중간 (초기 코퍼스 빈약 — 시간에 비례해 복리) | 3/4 |

### Tier 3 — 야심·조건부 (Tier 2 안착 후)

| # | 항목 | 조건/시점 | Effort | Risk |
|---|---|---|---|---|
| 3-1 | Chronos-Bolt 야간 예측 (용량성 메트릭 7일 예측 + 유휴 GPU 창 예측)[^12][^13] | 2~4주 섀도 검증 후 신뢰. 모델 가중치 1회 오프라인 반입 | M | 중간 |
| 3-2 | 주간 changepoint 리포트 (ruptures) — "언제부터 베이스라인이 달라졌나" + git log·Ansible 이력 병기[^14] | 리포트 전용이라 오탐 부담 0. 다이제스트 채널 재사용 | M | 낮음 |
| 3-3 | Qwen2.5-VL 주간 차트 해설·스크린샷 진단 — **PromQL raw 수치 병행 주입 필수**(VLM 차트 수치 오독은 문헌 확인된 실재 위험)[^23][^24] | grafana-image-renderer 배포 후 | M | 중간 |
| 3-4 | 포스트모템 초안 + 런북 diff 자동 PR (PR 자체가 §11 게이트) | 인시던트 기록 규율 정착 후 | S~M | 낮음 |
| 3-5 | Ansible 변경 자문 리뷰어 — 린터(ansible-lint/KICS)가 권위, LLM은 "참고의견" 라벨 고정. IaC **생성**은 성공률 27%로 기각[^21] | CI 훅 정비 후 | M | 중간 (거짓 안심) |
| 3-6 | 합성 로그 주입 = 모니터링 유닛테스트 — 별도 스테이징 인덱스만, 라이브 주입 방지 가드 필수(§12)[^26] | M2 알림·분류 회귀 테스트 수요 시 | M | 중간 |
| 3-7 | 관측 갭 감사(분기) · 드리프트 의미 해석기(`ansible --check --diff` 주간 + LLM 해석) | 저비용, 다이제스트 안착 후 | S~M | 낮음 |
| 3-8 | CodeAD식 탐지 룰 초안 생성 → git PR → 사람 머지[^27] | 월 1회 저빈도로 시작 | L | 중간 |

### 보류·기각 (근거 명시)

| 항목 | 판정 | 근거 |
|---|---|---|
| text-to-PromQL/DSL | 후순위 보류 | 최고 성적 GPT-4-Turbo+전용 RAG로 69.1%, 30B 로컬은 그 이하. 조용히 틀린 쿼리가 최악 시나리오. 도입 시 "쿼리 원문+원시 결과 강제 병기" 없이는 금지 수준[^29] |
| Netdata 전면 도입 | 기각 (1노드 파일럿만 조건부) | 모니터링 스택 중복·관리 표면적 증가가 1인 운영 실익 상쇄 |
| DeepLog/LogBERT류 딥러닝 로그 탐지 | 기각 | 실증 연구에서 단순 기법 대비 우위 없음 + 라벨·재학습·드리프트 부담[^11] |
| 자체 ML 학습(디스크 고장 분류기 등) | 기각 | 5노드 표본으로 극단적 클래스 불균형 학습 불가(Backblaze도 13만 대로 학습)[^8] |
| VictoriaMetrics vmanomaly | 기각 | v1.5.0부터 라이선스 키 필수(엔터프라이즈) |
| GPU job 소요시간 예측기 | 보류 | 스케줄러 부재로 job 경계 데이터 자체가 없음. 유휴 창 예측(3-1) 먼저 |
| TTS 아침 브리핑(Piper) | 후순위 | 다른 브리핑이 먼저 있어야 의미. 한국어 보이스 품질 미검증 |

---

## 3. KEIwi만의 엣지 — API 비용 장벽 때문에 남들이 못 하는 것 3가지

**① 로그 "전수" LLM 처리 — 템플릿 단위 트릭.** Drain3가 수백만 라인을 수천 템플릿으로 압축하면, LLM 라벨링·요약·트리아지가 **템플릿당 1회**로 끝난다. 총 호출량 수천 건 — 유휴 GPU에서 한계비용 0. 타사는 라인당 API 과금 때문에 이 설계 자체가 성립하지 않는다. 야간 순찰(2-2)+라벨링(2-3)이 이 엣지의 직접 현금화다.

**② 상시 임베딩 메모리 — Cleric의 operational memory를 0원으로.** 전 로그 템플릿·알림 이력·인시던트·런북을 로컬 임베딩(bge-m3)으로 상시 벡터화하고 이미 보유한 OpenSearch를 k-NN 벡터DB로 재활용. AI SRE 스타트업(Cleric·Traversal)이 파는 "매 조사가 다음 조사를 빠르게" 핵심 가치의 self-host 재현이며[^17][^22], 365d 보존 정책과 결합해 시간이 갈수록 복리로 성장. 1인 SRE의 지식이 개인 기억에 갇히는 구조적 위험을 시스템 기억으로 대체한다.

**③ 로컬 멀티모달·시계열 파운데이션 모델.** (a) Qwen2.5-VL이 이미 로컬에 있으므로 Grafana 렌더 이미지 해설·스크린샷 진단이 가능 — 남들이 못 하는 이유(비전 API 비용 + 스크린샷 외부 전송 불가)가 KEIwi엔 없다[^23]. (b) Chronos-Bolt(48~205M, self-host)로 TimeGPT류 API 없이 zero-shot 계절성 예측 — predict_linear의 선형 한계(계절성 무시)를 유휴 GPU 야간 배치로 보완[^12][^13].

---

## 4. 환각·오탐 가드레일 — §11 정합과 서버검증 인용 원칙의 확장

공통 원칙 3개 (기존 "서버검증 인용"의 확장):

1. **사실·서술 분리**: 숫자·집계는 전부 결정적 코드(PromQL/OpenSearch 쿼리)가 계산하고, LLM은 문장화만 담당한다. LLM이 산출한 수치는 어떤 산출물에도 실리지 않는다.
2. **인용 강제**: 모든 LLM 주장에 로그 doc_id·실행 쿼리·원시 이벤트 인용을 붙이고 기존 검증기로 서버 검증한다. 원시 증거 테이블을 LLM 서술과 항상 분리 병기한다(LLM이 틀려도 바닥값 보장).
3. **페이징 격리**: 비지도 출력(RCF grade, 밴드 이탈, novelty)은 다이제스트·대시보드 전용. 페이징은 결정적 룰만. 승격은 2주 섀도 정탐 확인 후.

항목별 실패 모드:

| 항목 | 실패 모드 | 가드레일 | §11·§12 정합 |
|---|---|---|---|
| 1-1 GPU 전조 룰 | dcgmi diag 상위 레벨이 vLLM 서빙 GPU 점유 / XID 파싱 드라이버별 포맷 차이 | diag는 -r 2·유휴 시간 조율, 파싱 버전 고정 테스트 | 룰·리포트만, 워크로드 배제 결정은 사람 |
| 1-2 promql 밴드 | 학습 초기 24~26h 과민 / 비정규 메트릭 오탐 | 초기 관찰 모드, 스파이키 메트릭은 robust 전략 수동 지정, 페이징 미연결 | 읽기전용 recording rule — §12 무관 |
| 1-3 RCF | 기본 민감도가 2~5% 변화도 탐지 → 소음 폭주 / 워크로드 변화(실험 시작)마다 오탐 | suppression rule 필수 튜닝, 첫 2~4주 알림 미연결, 클러스터 메모리 모니터링 | 대시보드·다이제스트만 |
| 1-4 SMART | NVMe는 노출 속성 적어 판정력 제한 | 0→비0 전이 중심, Scrutiny 확장은 보류 | 알림만, 교체는 사람 |
| 2-1 Drain3 | 마스킹 미흡 시 템플릿 폭발 / 희귀·정상 로그 novelty 오탐 | 유사도·depth 튜닝, LRU 캡, 카테고리별 화이트리스트 | 읽기전용 consumer |
| 2-2 야간 다이제스트 | 서술 환각 / 다이제스트 피로 | 공통 원칙 1·2 + 내용 없으면 발송 생략 | push형 읽기전용 리포트 |
| 2-3 템플릿 라벨링 | 오라벨이 대시보드 그룹핑 오염 | 사람 수정 우선권, 저신뢰 unclassified 유지 | 조언성 메타데이터 |
| 2-4 조사 패키지 | 잘못된 가설의 앵커링 편향 | 가설 '후보' 표기, 원시 증거 분리 표시, 수집부는 결정적(알림 타입별 핸들러 — RCACopilot 4년 운영 검증 패턴[^20]) | 조사만·조치 없음, read-only |
| 2-5 인시던트 메모리 | 코퍼스 부족 시 무의미·오도성 매칭 | 유사도 하한 미달 시 첨부 생략, '참고' 라벨, 조용히 축적 | 검색·첨부만 — 환각 여지 최소 |

---

## 5. 다음 1~2스텝 — 지금 스택에서 최소 비용 착수

**Step 1 (이번 주, 신규 소프트웨어 0): "잠자는 자산 깨우기 + 게이트 문서"**

1. 운영 원칙 게이트 문서(1-0)를 specs에 1페이지로 확정 — 이후 모든 탐지기의 전제.
2. OpenSearch RCF 활성화(1-3): host×category 디텍터 2~3개, suppression rule 기본 적용, **알림 미연결·신호우선 대시보드 패널만**. 첫 48h 무튜닝.
3. GPU 전조 룰(1-1): ECC DBE·row-remap·XID 페이징 룰 + dmesg XID textfile collector. 선행으로 data04 GPU exporter 갭 해소.
4. (여유 시) promql-anomaly-detection 룰 파일 추가(1-2) — recording rule뿐이라 리스크 0.

게이트: RCF 2주 관찰에서 suppression 튜닝 완료 + GPU 룰 발화 테스트 통과.

**Step 2 (다음 2~4주): "LLM 파이프라인의 기반층 + 첫 현금화"**

1. Drain3 consumer(2-1) + 템플릿 레지스트리 + 빈도/소멸 시계열 — 이후 라벨링·임베딩·다이제스트 전부의 전처리층이라 최우선.
2. 야간 배치 다이제스트 스켈레톤(2-2): 결정적 집계 스크립트(RCF 이상 + 신규 템플릿 + 알림 요약) → vLLM 한국어 서술 → 콘솔/Grafana text 패널 게시. 기존 인용 검증기 재사용.
3. Drain3 안착 직후 신규 템플릿 라벨링(2-3)을 2~3일 증분으로 얹기.

게이트: 다이제스트 2주 운영에서 "환각 0건(인용 검증 통과율 100%) + 읽을 가치" 자가 평가 후 → Tier 2 후반(조사 패키지 2-4, 임베딩 레이어 2-5) 착수 여부 결정.

이 순서의 논리: Step 1은 탐지(통계)를 세우고, Step 2는 그 출력을 소비하는 LLM 레이어를 얹는다 — "감지는 통계, 설명은 LLM" 원칙이 착수 순서 자체에 반영된다.

---

[^1]: https://github.com/grafana/promql-anomaly-detection
[^2]: https://grafana.com/blog/2024/10/03/how-to-use-prometheus-to-efficiently-detect-anomalies-at-scale/
[^3]: https://docs.nvidia.com/deploy/gpu-debug-guidelines/index.html , https://www.abhik.ai/articles/nvidia-xid-errors
[^4]: https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/dcgm-diagnostics.html
[^5]: https://docs.opensearch.org/latest/observing-your-data/ad/index/
[^6]: https://opensearch.org/blog/ad-rule-cx-success/
[^7]: https://github.com/prometheus-community/smartctl_exporter
[^8]: https://www.backblaze.com/blog/hard-drive-smart-stats/
[^10]: https://github.com/logpai/Drain3 , https://grafana.com/docs/grafana/latest/explore/simplified-exploration/logs/patterns/
[^11]: "How Far Are We?" https://arxiv.org/pdf/2202.04301 (+ 기업 로그 실증 2310.20492)
[^12]: https://github.com/amazon-science/chronos-forecasting , https://huggingface.co/amazon/chronos-bolt-base
[^13]: https://arxiv.org/pdf/2412.19286
[^14]: https://arxiv.org/pdf/1801.00826 (changepoint survey), ruptures
[^15]: bge-m3: https://arxiv.org/pdf/2402.05672
[^16]: https://docs.opensearch.org/latest/vector-search/ai-search/semantic-search/
[^17]: Microsoft 인시던트 유사 검색: https://arxiv.org/pdf/2204.11598
[^18]: https://www.datadoghq.com/blog/building-bits-ai-sre/ , https://incident.io/ai-sre
[^19]: https://github.com/robusta-dev/holmesgpt
[^20]: RCACopilot: https://yinfangchen.github.io/assets/pdf/rcacopilot_paper.pdf
[^21]: IaC 생성 성공률 27%/62.7%: https://arxiv.org/html/2601.08734v1
[^22]: https://cleric.ai/
[^23]: https://qwen.ai/blog?id=qwen2.5-vl
[^24]: VLM 차트 오독: https://arxiv.org/pdf/2504.05445
[^25]: Zeus(전력캡): https://arxiv.org/pdf/2208.06102
[^26]: AnomalyGen: https://arxiv.org/pdf/2504.12250
[^27]: CodeAD: https://arxiv.org/pdf/2510.22986
[^28]: XID 조기경보: https://arxiv.org/pdf/2503.11901
[^29]: text-to-PromQL 벤치마크: https://arxiv.org/pdf/2503.03114
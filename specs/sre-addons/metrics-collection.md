# KEIwi 메트릭 수집 확장 — 추천 (sysadmin + SRE)

> 2026-07-06. 4각도 웹 리서치(하드웨어·GPU/ML·Grafana·수집아키텍처) 종합. 성격: 후보/우선순위 문서 — 착수는 [platform-roadmap](./platform-roadmap.md) Tier 1(알림 루프)과 병행. 기존 [backlog #1~16](./backlog.md)과 중복 없이 "새 수집 역량"만.
> 제약: 온프렘·k8s 없음·SRE 1인·egress 0(self-host만)·단일 콘솔=Grafana(§I-2)·에이전트 생성/사람 적용(§11)·라이브 직접수정 금지(§12).

## 1. 지금 수집에서 비어있는 7축
| 축 | 현 상태 | 사각지대 |
|---|---|---|
| 하드웨어 건강(쇠) | node-exporter는 파일시스템 '사용률'만 | 디스크 SMART·팬·PSU·ECC = OS 밖은 안 보임 |
| 전원 | inventory에 UPS/PDU/BMC 필드 없음 | 정전=유일한 플릿 동시 SEV1인데 '겪고서야' 앎 |
| OS 위생 | systemd·textfile collector 미활성 | 리부트대기·미적용 보안패치·죽은 서비스·inode/conntrack 포화 |
| 단명 job 계정 | 수집 계층 전무 | SSH 수동·단명 GPU job은 pull 스크레이프 원천 불가 → GPU-시간 낭비 유실 |
| GPU 효율 | DCGM 기본(util·VRAM·온도·전력)만 | util은 워프 하나에도 100% = '바쁨'만, '잘 쓰나(MFU)'는 모름 |
| 에너지/탄소 | 없음 | #12 showback이 '시간'뿐 → 실제 kWh·요금·탄소 없음 |
| 장기보존·이상탐지 | 30d·recording rule 0 | 용량계획 히스토리·예측 알림 없음 |

## 2. Tier 표
**분류:** Tier 1=신규 인프라 0/순수 SW, 즉시(S). Tier 2=컴포넌트 1개 or 하드웨어 발견 선행(M). Tier 3=대형/전략(L) 또는 헌장 충돌로 평가만.

### Tier 1 — 즉시 고ROI (S) "이미 있는 걸 켠다"
| # | 후보 | 채우는 축 | 백로그 관계 |
|---|---|---|---|
| T1-1 | **node_exporter textfile+systemd 심화**(보안패치·reboot·백업·서비스 up/down·inode·conntrack) | OS 위생 | 신규, 수집 인프라 0 |
| T1-2 | **smartctl_exporter**(디스크/NVMe SMART·고장 예측) | HW 건강 | 신규. data05(관제+로그 365d) 급소 |
| T1-3 | **process-exporter**(프로세스 CPU/mem/FD) | 자원 점유자 | #9 유휴/#8 귀속 보완 |
| T1-4 | **단명 job 계정 계층**(node-exporter textfile 기본, Pushgateway 대안) | 단명 job | #12 showback·#9 입력 공급 |
| T1-5/6 | **GPU 스로틀 원인 디코드 + PCIe/NVLink replay**(DCP CSV 필드만) | GPU 진단 | #1과 CSV 공유 |
| T1-7 | **Prometheus recording rules**(rule_files 현재 0) | 사전집계 | #7 SLO·#12의 미충족 전제 |
| T1-8 | **Annotations**(alert→타임라인·정비창·배포 웹훅) | 인시던트 타임라인 | #4 포스트모템·#6과 짝 |
| T1-9 | **예측 self-host**(predict_linear 디스크full + OpenSearch RCF) | 용량 예측 | 신규(Grafana ML=Cloud→배제) |
| T1-10 | **Grafana Metrics Drilldown**(queryless, 이미 번들) | ad-hoc triage | 활성화만 |
| T1-11 | **inventory file_sd**(Ansible 생성 SD, prometheus.yml 수기편집 제거) | 수집 위생 | #5 CMDB 다리 |
| T1-12 | **카디널리티·스크레이프 가드레일** | 안전 전제 | Netdata/VM 도입 세트 전제 |

### Tier 2 — 핵심 확장 (M)
| # | 후보 | 비고 |
|---|---|---|
| T2-1 | **GPU 효율 MFU/OFU + 효율 대시보드**(tensor active/SM클럭 보정) | 'util 100% 거짓말' 교정. #1 CSV 전환과 묶음 |
| T2-2 | **에너지·전기요금·탄소 showback**(DCGM energy + node RAPL) | #12를 '시간→kWh'로 보완 |
| T2-3 | **실험 지표 파이프**(prometheus_client→textfile/Pushgateway) | #10이 못 잡는 학습(training) 측. MLflow와 경계 |
| T2-4 | **VictoriaMetrics 단일노드**(장기보존 1~3년, remote_write 한 줄·무중단) | Thanos/Mimir는 5노드엔 과함 |
| T2-5 | **Netdata**(심층 노드+엣지 ML 이상탐지, /allmetrics 선별 스크레이프) | T1-12 가드레일과 세트 필수 |
| T2-6 | **Pyroscope eBPF 연속 프로파일링**(Grafana 네이티브 datasource) | vLLM/로그파이프 근본원인 |
| T2-7 | **Grafana Correlations**(메트릭→로그 원클릭, exemplar 대체) | roadmap §1 '공통 병목' 실현 |
| T2-8 | ⚠️ **ipmi/redfish_exporter**(BMC 센서) | **발견 선행** — Quadro라 BMC 없을 수 있음 |
| T2-9 | ⚠️ **snmp_exporter**(스위치/PDU) | **발견 선행** — 관리형 장비 존재 불명 |
| T1★ | ⚠️ **nut_exporter/apcupsd**(UPS·정전) | 소프트웨어 S지만 UPS 존재·연결노드 **발견 선행** |

### Tier 3 / 착수 금지
- T3-1 **Grafana Alloy**(OTel 수집기): 전략 가치 크나 파이프라인 churn(§12) → PoC만.
- T3-2 **Coroot**(eBPF 자동 o11y): 자체 웹 UI가 본체 → §I-2 충돌. 평가만(대체=Pyroscope+Netdata+service-map).
- **금지(egress 0 위배)**: Grafana ML app·Sift·Grafana Incident = 전부 Cloud 전용. 대체=T1-9(predict_linear/RCF)·T1-8(annotations)·#4.

## 3. 연구실 관점 급소 3
- **(a) 단명 job 계정(T1-4)** — SSH 수동·단명 GPU job은 15s pull로 원천 불가. **textfile collector**는 job이 죽어도 `.prom`이 남아 사후집계+상태저장 불필요(§11/§12/egress 0 무충돌). #12 입력을 '시간 추정'→**job 단위 실측**(gpu_hours·final_loss·exit_code)으로.
- **(b) GPU 효율 MFU(T2-1)** — DCGM util은 워프 하나에도 100%. `DCGM_FI_PROF_PIPE_TENSOR_ACTIVE`를 SM클럭비로 보정한 OFU를 recording rule로 → FP32-only·dataloader 병목 식별. 6GPU 공유에서 효율 1%p=예산.
- **(c) 에너지·탄소 showback(T2-2)** — `DCGM_FI_DEV_TOTAL_ENERGY_CONSUMPTION` + node RAPL join → kWh×단가×탄소계수로 user/모델별 리포트(연구비·기관 탄소보고). 캐비앗: RAPL은 신커널 권한 이슈로 누락 가능→노드별 확인.

## 4. Grafana를 더 쓰는 법 (이미 12+ = 켜는 것)
`grafana:latest`(12+)라 **Scenes·Metrics Drilldown·Correlations가 이미 설치**됐으나 미사용, `prometheus.yml`엔 `rule_files` 전무.
- **Recording rules(T1-7)**: `rule_files:`+`rules/*.yml`을 기존 바인드마운트로 커밋(=Git=PR=Observability-as-Code). 네이티브 rule_files는 remote-write 불요.
- **Annotations(T1-8)**: alert→자동 애너테이션·정비창 region·배포 웹훅. #6 silence와 짝.
- **예측(T1-9)**: `predict_linear(node_filesystem_avail_bytes[6h],86400)<0` = 디스크 24h후 full 예측. outlier=보유 중인 OpenSearch RCF.
- **Correlations(T2-7)**: Prom 패널값→OpenSearch 로그 `host·시간·category` 점프. 트레이스 없는 KEIwi의 exemplar 대체. authed Explore(익명 임베드와 별개 화면).
- **VictoriaMetrics(T2-4)**: Prometheus는 15s+30d 유지, VM에 remote_write 위임(무중단), Grafana엔 datasource 추가만(PromQL 하위호환→KRDS 대시보드 그대로).
- **Netdata(T2-5)**: 자체 UI 대신 `/allmetrics?format=prometheus`를 선별 스크레이프. T1-12 가드레일 필수.
> 인터랙티브 앱(Correlations·Drilldown)은 익명 임베드 아닌 **authed 진입점** — 콘솔 임베드(§I-2)는 그대로.

## 5. 다음 1~2 스텝 (로드맵 Tier 1 알림 루프와 병행·무충돌)
> platform-roadmap은 **알림 루프(#6·#1/2·#3)가 최우선**. 본 수집 확장은 그걸 대체 않고 **알림이 발화할 대상 신호를 넓히는 병렬 트랙**.

- **스텝 1(S) "켜기"**: T1-1(textfile+systemd) · T1-2(smartctl, data05 우선) · T1-7(recording rules). 셋 다 신규 컨테이너 0·크레덴셜 0·§11/egress 0. mixin 규칙(`NodeSystemdServiceFailed`·`NodeFilesystemFilesFillingUp`·`NodeHighNumberConntrackEntriesUsed`)을 커밋 → #6 켜지면 즉시 발화.
- **스텝 2(S~M) 연구실 급소 + Grafana 활성화**: T1-4(단명 job 계정) · T2-1(GPU 효율, #1 CSV 전환과 묶음, T1-5/6 동봉) · T1-8+T1-10(annotations+Drilldown, #6과 짝).
- **병행 발견(저비용)**: 각 노드 **BMC·UPS·관리형 스위치/PDU 유무**를 확인해 #5 CMDB에 기록 → T2-8/9/T1★ 언블록 or '전원·HW out-of-band 무가시성'을 리스크로 문서화. (Quadro라 GPU 노드 BMC 부재 가능성 실재 — 발견 선행.)

## 출처
node_exporter/textfile-collector-scripts/monitoring.mixins · smartctl_exporter · process-exporter · prometheus pushgateway/textfile · DCGM dcp-metrics(TENSOR_ACTIVE·THROTTLE·PCIE/NVLINK·TOTAL_ENERGY)·OFU(arxiv 2605.20799) · node RAPL · recording rules/annotations/correlations/metrics-drilldown(grafana docs) · predict_linear/holt_winters · VictoriaMetrics single-node · Netdata /allmetrics · Pyroscope eBPF · ipmi/redfish/idrac_exporter · snmp_exporter · nut_exporter/apcupsd. (전체 URL: tasks/wsm6tzox7.output)

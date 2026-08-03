# 알림 보강 — Tasks

> 권위: [spec.md](./spec.md) / [README](./README.md). `[x]`=완료, `[ ]`=잔여, `[~]`=진행 중.
> **`[server]` = 사람이 라이브에 적용(§11).** 표시 없는 항목은 에이전트가 레포에 산출물을 **생성**하는 것까지다.
> 크기: **S**=반나절 이내 · **M**=1~3일 · **L**=1주+. 라이브 파일 직접 편집 금지(§12) — 레포에서 고치고 사람이 복사한다.

## 진행 현황

| 단계 | 내용 | 태스크 | 완료 | AC |
|---|---|---|---|---|
| E1 | 알림 메시지 수리 (이스케이프+현재값+템플릿 그룹) | 6 | 0 | 7 |
| E2 | 딥링크 (annotation 3종 + 콘솔 소보수) | 5 | 0 | 5 |
| E3 | 스레드 보강 (alert-relay) | 8 | 0 | 7 |
| E4 | 귀속 (0단계 수집기 + 의도 요약) | 8 | 0 | 6 |
| **합계** | | **27** | **0** | **25** |

## 권장 파동

| 파동 | 태스크 | 왜 이 순서 |
|---|---|---|
| **W-E1 (오늘)** | T-E1-1 ~ T-E1-5 | 이번 사건의 직접 원인 봉합. 전부 프로비저닝 파일 수정 + 복사 1회 — 신규 컴포넌트 0 |
| **W-E2 (이번 주)** | T-E2-1 ~ T-E2-5 · T-E1-6 | E1 위에 annotation만 얹음. 콘솔 소보수 포함 |
| **W-E3 (섀도 2주 포함)** | T-E3-1 ~ T-E3-6 → 관찰 → T-E3-7·T-E3-8 | 유일한 신규 서비스. 섀도 게이트(README §2) 통과 전 컷오버 금지 |
| **W-E4 (E3와 병행 가능)** | T-E4-1 ~ T-E4-8 | 수집기는 CLI 단독으로도 유효(E3 없이 수동 30분→수동 30초). relay 연동 부분(T-E4-4)만 E3 의존 |

> [!WARNING]
> **T-E1-1은 W1 브랜치(chore/gate-toolchain)와 충돌 경로다.** 같은 파일(alert-rules.yaml)을 W1 축3가 9→14규칙으로 확장 중 — 이스케이프 픽스를 **양쪽에 모두** 커밋하고(T-E1-6), 재발은 게이트(AC-E1-7)가 막는다. 병합 순서와 무관하게 `{{ $labels` 0건이 불변 조건이다.

> [!NOTE]
> **data05 특권**: E4의 data05 수집은 `sudo -n` 실패로 축소 수집(`partial: true`)이다. sudoers 교정은 hardware-ops T0-6 `[server]` 소관 — 여기서 재정의하지 않는다(fleet-hardening README §4.2.1 정본).

---

## E1 — 알림 메시지 수리

- [x] **T-E1-1** (S) `alert-rules.yaml` `$labels` 16곳(dev) `$$` 이스케이프 — spec §1.2 D1-1의 sed 한 줄 + 육안 diff 확인. `$__env{}`는 건드리지 않는다(§0.2). **선행: 없음.** 검증: AC-E1-1
- [x] **T-E1-2** (S) summary 4규칙 현재값 렌더로 교체(DiskUsageHigh·GpuTempHigh·MemoryLow·DiskFillPredicted — spec §1.2 D1-2 문안 그대로) + GpuTempHigh "85°C" 오기 92로 교정(dev만 — W1은 교정됨). 결정적 실패 4종은 이스케이프만. **선행: T-E1-1.** 검증: AC-E1-4
- [x] **T-E1-3** (M) `templates.yaml` 신설(keiwi.title/alert/text — `$` 문자 0개 형태 유지) + `contact-points.yaml` title/text를 `{{ template … }}` 호출로 교체(2채널 중복 제거). 로컬 Grafana 컨테이너 프로비저닝 스모크 포함(기동 실패 전례 — inhibitionRules). **선행: T-E1-1.** 검증: AC-E1-5
- [x] **T-E1-4** (S) `notification-policies.yaml` warning 라우트 group_by `[alertname]`→`[alertname, node]` + 파일 상단 "스레딩 불가" 주석에 E3 예고 각주. 되돌리기 조건(2주 리뷰에서 메시지 수 과다) 주석 명기. **선행: T-E1-1.** 검증: AC-E1-2와 함께 적용 후 확인
- [ ] **T-E1-5** `[server]` (S) 라이브 적용 — 4파일 복사(§11) → Grafana 프로비저닝 리로드 → AC-E1-2(API 실측)·AC-E1-3(미리보기, [검증 필요] 3건 일괄 확정)·AC-E1-6(테스트 발화 스크린샷). 미리보기 실패 항목은 spec §1.2 폴백 표기로 수정 후 재커밋. **선행: T-E1-1~4.** 검증: AC-E1-2·3·5·6
- [x] **T-E1-6** (S) 게이트 `scripts/gates/check-alerting-escapes.sh` 작성(spec §0.2) + W1 브랜치(chore/gate-toolchain)에 이스케이프 픽스 반영(24곳) + fleet-hardening 축5 게이트 레지스트리 등록 제안 노트. **선행: T-E1-1.** 검증: AC-E1-1(W1분)·AC-E1-7

## E2 — 딥링크

- [x] **T-E2-1** (S) 전 규칙에 annotation 3종 추가 — `__dashboardUid__`(system-v3/gpu-v3/logs-v3 규칙별 배정), `drilldown_url`(var 후보 3종 미러링), `console_url`(`alert=·node=·mount=·from=` 파라미터, 한국어 없음). spec §2.2 D2-1. **선행: T-E1-1.** 검증: AC-E2-1
- [ ] **T-E2-2** (S) 콘솔 `/incidents` 소보수 — `alert`(프리셋 질문 테이블)·`mount`·`from` searchParams 수용 + node 정규화 유틸(`data04`|IP|IP:port → fleetNode, `types/fleet.ts` 매핑 재사용 여부 구현 시 확인). **선행: 없음(E1과 독립).** 검증: AC-E2-3·AC-E2-4
- [ ] **T-E2-3** (S) `/logs` searchParams 주입(useState 초기값 배선) — **선택(P2)**, E2 게이트에 불필요. **선행: 없음.** 검증: 수동
- [ ] **T-E2-4** `[server]` (S) 적용 + 실클릭 검증 — drilldown_url이 var-instance만으로 노드 전환되는지(3a35dd8 경위상 의심 지점). 실패 시 spec D2-1 폴백(노드명 매핑 E3 이관) 발동 기록. `__panelId__`는 이때 패널 ID 확정해 채움(열린 질문 3). **선행: T-E2-1·T-E2-2.** 검증: AC-E2-2
- [ ] **T-E2-5** (S) 콘솔 변경분 Playwright 시각 QA + 스크린샷 공유(기존 관례 `docs/testing.md`). **선행: T-E2-2.** 검증: AC-E2-3 부속

## E3 — 스레드 보강 (alert-relay)

- [ ] **T-E3-1** (M) relay 스켈레톤 — `POST /webhook`(공유 시크릿 검증) → 렌더된 title/message로 `chat.postMessage` → 200. `GET /healthz`. Python3 stdlib 전용·pip 0. systemd unit + `EnvironmentFile=/data/alert-relay/env`(§13) 파일 초안(레포엔 예시 `.env.example`만). **선행: T-E1-3(메시지 정본).** 검증: AC-E3-1
- [ ] **T-E3-2** (S) fingerprint→thread_ts sqlite 저장 + resolved 웹훅을 같은 스레드에 "✅ 해결" 답글 + TTL 30일 정리. **선행: T-E3-1.** 검증: AC-E3-3
- [ ] **T-E3-3** (S) 프로비저닝 — webhook contact point(+HMAC/시크릿 헤더) + 섀도 미러 라우트(`#keiwi-relay-test`). continue 매칭 미지원 시 테스트 전용 라벨 우회(열린 질문 2). **선행: T-E3-1.** 검증: 섀도 배포 시
- [ ] **T-E3-4** (M) 어시스턴트 연동 — 직렬 큐·타임아웃 120s·429/502 백오프 3회·최종 실패 조용히 생략. 2차 답글 포맷(근거 번호 필수·원문 로그 미포함·콘솔 절대시간창 딥링크). 알림별 프리셋 질문은 콘솔 프리셋 테이블(T-E2-2)과 공유. **선행: T-E3-1.** 검증: AC-E3-4·AC-E3-7
- [ ] **T-E3-5** (S) ADR 작성 — "웹훅 중계 도입: contact-points의 '값어치 없다' 판단 갱신 근거 + 되돌리기 조건(섀도 실패·유지 부담 초과 시 직송 복귀)". 번호는 `docs/decisions/` 최신 확인(0023·0024는 fleet-hardening 예약). **선행: 없음.** 검증: 문서 존재
- [ ] **T-E3-6** `[server]` (S) data05 섀도 배포 — systemd 기동, env 배선(값은 §13 경로), external-watchdog에 `/healthz` 등록, kill 테스트(재기동 중 발화 유실 관찰 — Grafana 재시도 [가설] 실측). **선행: T-E3-1~4.** 검증: AC-E3-2·AC-E3-5
- [ ] **T-E3-7** `[server]` (S) 섀도 2주 게이트 판정(README §2: 유실 0·p95<5s·유용성) → 통과 시 컷오버: slack-infra를 relay 경유로 교체 + `contact-points.fallback.yaml`·롤백 런북 커밋. **선행: T-E3-6 + 2주.** 검증: 게이트 기록
- [ ] **T-E3-8** `[server]` (S) 롤백 리허설 — relay 정지→fallback 복사+리로드→테스트 발화 도착, 소요 시간 기록. **컷오버 전 필수.** **선행: T-E3-6.** 검증: AC-E3-6

## E4 — 귀속 (0단계)

- [ ] **T-E4-1** (M) disk-attribution collector — df/du/find/owner SSH read-only + 스냅샷 저장·diff + JSON 스키마(spec §4.2 D4-1). CLI 단독 실행 지원(E3 무관). 쓰기 명령 0 게이트 내장. **선행: 없음.** 검증: AC-E4-1
- [ ] **T-E4-2** (S) OpenSearch COMMAND 검색 모듈 — `keiwi-logs-*` 노드·시간창·`COMMAND=` 필터(read-only). `raw`는 로컬 전용 필드. **선행: T-E4-1(스키마).** 검증: AC-E4-1 부속
- [ ] **T-E4-3** (M) redaction·카테고리화(결정적) + vLLM 의도 요약 프롬프트("~로 보인다" 서술 강제·원문 인용 금지) + LLM 출력 이중 redaction 게이트. **선행: T-E4-1.** 검증: AC-E4-3·AC-E4-4
- [ ] **T-E4-4** (S) relay 연동 — DiskUsageHigh·DiskFillPredicted 수신 시 답글 #1(결정적)·#2(요약) 게시. **선행: T-E3-1·T-E4-1·T-E4-3.** 검증: AC-E3-7과 합동
- [ ] **T-E4-5** (S) 8-03 사건 리플레이 픽스처 + 유닛테스트 — 기대 출력: 소유자 sunakang·카테고리 "Python 환경"·시간창 17:45~48. **선행: T-E4-1~3.** 검증: AC-E4-2(픽스처분)
- [ ] **T-E4-6** (S) data05 폴백(`partial: true`) + 일일 스냅샷 cron 정의(03:00, systemd timer 초안). **선행: T-E4-1.** 검증: AC-E4-5
- [ ] **T-E4-7** `[server]` (S) 배포 — data03·04 실행 검증 + data04 실환경 리플레이 + cron 활성. **선행: T-E4-1~6.** 검증: AC-E4-1·2·5·6
- [ ] **T-E4-8** (S) 단계 게이트 문서화 — psacct(1단계)·auditd/eBPF(2단계)의 게이트 질문·판정 절차를 이 폴더에 명문화(README §2 표 참조). **지금 psacct를 켜지 않는다.** **선행: 없음.** 검증: 문서 존재

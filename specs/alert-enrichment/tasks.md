# 알림 보강 — Tasks

> 권위: [spec.md](./spec.md) / [README](./README.md). `[x]`=완료, `[ ]`=잔여, `[~]`=진행 중.
> **`[server]` = 사람이 라이브에 적용(§11).** 표시 없는 항목은 에이전트가 레포에 산출물을 **생성**하는 것까지다.
> 크기: **S**=반나절 이내 · **M**=1~3일 · **L**=1주+. 라이브 파일 직접 편집 금지(§12) — 레포에서 고치고 사람이 복사한다.

## 진행 현황

| 단계 | 내용 | 태스크 | 완료 | AC |
|---|---|---|---|---|
| E1 | 알림 메시지 수리 (이스케이프+현재값+템플릿 그룹) | 6 | 5 | 7 |
| E2 | 딥링크 (annotation 3종 + 콘솔 소보수) | 5 | 3 | 5 |
| E3 | 스레드 보강 (alert-relay) | 8 | 5 | 7 |
| E4 | 귀속 (0단계 수집기 + 의도 요약) | 8 | 6 | 6 |
| **합계** | | **27** | **13** | **25** |

> 잔여 14건 중 **8건이 `[server]`**(사람이 라이브에 적용)다: T-E1-5 · T-E2-4 · T-E3-6·7·8 · T-E4-7.
> 에이전트가 레포에서 더 만들 수 있는 것은 T-E2-3(P2, 선택) · T-E4-1~6·8이다.

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
- [x] **T-E2-2** (S) 콘솔 `/incidents` 소보수 — `alert`(프리셋 질문 테이블)·`mount`·`from` searchParams 수용 + node 정규화 유틸(`data04`|IP|IP:port → fleetNode, `types/fleet.ts` 매핑 재사용 여부 구현 시 확인). **선행: 없음(E1과 독립).** 검증: AC-E2-3·AC-E2-4
- [ ] **T-E2-3** (S) `/logs` searchParams 주입(useState 초기값 배선) — **선택(P2)**, E2 게이트에 불필요. **선행: 없음.** 검증: 수동
- [ ] **T-E2-4** `[server]` (S) 적용 + 실클릭 검증 — drilldown_url이 var-instance만으로 노드 전환되는지(3a35dd8 경위상 의심 지점). 실패 시 spec D2-1 폴백(노드명 매핑 E3 이관) 발동 기록. `__panelId__`는 이때 패널 ID 확정해 채움(열린 질문 3). **선행: T-E2-1·T-E2-2.** 검증: AC-E2-2
- [x] **T-E2-5** (S) 콘솔 변경분 Playwright 시각 QA + 스크린샷 공유(기존 관례 `docs/testing.md`). **선행: T-E2-2.** 검증: AC-E2-3 부속

## E3 — 스레드 보강 (alert-relay)

- [x] **T-E3-1** (M) relay 스켈레톤 — `POST /webhook`(공유 시크릿 검증) → 렌더된 title/message로 `chat.postMessage` → 200. `GET /healthz`. Python3 stdlib 전용·pip 0. systemd unit + `EnvironmentFile=/data/alert-relay/env`(§13) 파일 초안(레포엔 예시 `env.example`만). **선행: T-E1-3(메시지 정본).** 검증: AC-E3-1 → `infra/alert-relay/{alert_relay.py,keiwi-alert-relay.service,env.example,README.md}`
- [x] **T-E3-2** (S) fingerprint→thread_ts sqlite 저장 + resolved 웹훅을 같은 스레드에 "✅ 해결" 답글 + TTL 30일 정리. **선행: T-E3-1.** 검증: AC-E3-3(유닛분 통과 — 라이브분은 T-E3-6) · 스레드 없는 해결은 최상위 폴백(유실 금지)
- [x] **T-E3-3** (S) 프로비저닝 — webhook contact point(+HMAC/시크릿 헤더) + 섀도 미러 라우트(`#keiwi-relay-test`). continue 매칭 미지원 시 테스트 전용 라벨 우회(열린 질문 2). **선행: T-E3-1.** 검증: 섀도 배포 시 → `infra/alert-relay/provisioning/contact-points.relay.yaml`(프로비저닝 디렉터리 **밖** — env 배선 전에 두면 기동 실패) + `notification-policies.yaml` 첫 routes 항목에 **주석 상태의** 미러 라우트
- [x] **T-E3-4** (M) 어시스턴트 연동 — 직렬 큐·타임아웃 120s·429/502 백오프 3회·최종 실패 조용히 생략. 2차 답글 포맷(근거 번호 필수·원문 로그 미포함·콘솔 절대시간창 딥링크). 알림별 프리셋 질문은 콘솔 프리셋 테이블(T-E2-2)과 공유(게이트 P2가 키 집합 정합을 기계 판정). **선행: T-E3-1.** 검증: AC-E3-4·AC-E3-7 통과
- [x] **T-E3-5** (S) ADR 작성 — "웹훅 중계 도입: contact-points의 '값어치 없다' 판단 갱신 근거 + 되돌리기 조건(섀도 실패·유지 부담 초과 시 직송 복귀)". **선행: 없음.** 검증: [ADR-0025](../../docs/decisions/0025-alert-relay-webhook.md) 존재 + `contact-points.yaml` 원 주석에 갱신 각주
- [ ] **T-E3-6** `[server]` (S) data05 섀도 배포 — systemd 기동, env 배선(값은 §13 경로), external-watchdog에 `/healthz` 등록, kill 테스트(재기동 중 발화 유실 관찰 — Grafana 재시도 [가설] 실측). **선행: T-E3-1~4(완료).** 절차: `infra/alert-relay/README.md` "설치". 이때 확정할 것 3가지 — ① 컨테이너→호스트 도달 주소(`host.docker.internal` vs `172.17.0.1`) ② 라우트 `continue` 실지원 여부(미지원 시 테스트 라벨 우회) ③ HMAC 서명 대상 문자열([검증 필요] — 헤더 실측 후 하나로 좁힘). 검증: AC-E3-2·AC-E3-5
- [ ] **T-E3-7** `[server]` (S) 섀도 2주 게이트 판정(README §2: 유실 0·p95<5s·유용성) → 통과 시 컷오버: slack-infra를 relay 경유로 교체 + `contact-points.fallback.yaml`·롤백 런북 커밋. **선행: T-E3-6 + 2주.** 검증: 게이트 기록
- [ ] **T-E3-8** `[server]` (S) 롤백 리허설 — relay 정지→fallback 복사+리로드→테스트 발화 도착, 소요 시간 기록. **컷오버 전 필수.** **선행: T-E3-6.** 검증: AC-E3-6
- [x] **T-E3-9** (M) 🩹 적대적 검증 반려분 수리[2026-08-04] — ① **저장 실패 → Slack 도배** 차단: 저장소가 예외를 올리지 않고(메모리 티어), `do_POST`가 어떤 예외에도 응답하며, 배달 멱등키(`DeliveryLedger`, 메모리)가 재시도를 삼킨다. *게시 전 sqlite 예약은 기각* — 디스크가 차면 알림이 사라진다(ADR-0025 보강 ①) ② **redaction 동등화**: 세탁 규칙을 `infra/alert-relay/keiwi_redaction.py` 한 곳으로 모아 E4 `attribution_export`와 **공유**(복제 금지). relay가 통과시키던 4종(URL 우회·`~/`·허용목록 밖 절대경로·하드 거부 부재)이 막힌다 ③ `templates.yaml`의 죽은 `.DashboardURL` 분기 제거 ④ 게이트 self-test가 **본체 탐지기**를 태우도록 수정 + 별칭·변수 키 우회 적발 + 못 잡는 것 명시. **선행: T-E3-1~4.** 검증: AC-E3-8·9·10 + 기존 AC-E3-1·3·4·7 회귀 없음(유닛 47건) → `infra/alert-relay/{keiwi_redaction.py,alert_relay.py,test_alert_relay.py}` · `scripts/gates/check-alert-relay.sh`

## E4 — 귀속 (0단계)

- [x] **T-E4-1** (M) disk-attribution collector — `scripts/collectors/disk-attribution.sh`(원격 read-only 3종: df·du·find) + `attribution_lib.py`(파싱·카테고리화·스냅샷 diff·스키마). CLI 단독 실행 + relay 계약(`--node/--mount/--since/--json`) 양쪽 지원. 게이트 `scripts/gates/check-collector-readonly.sh`(파괴적 명령 0·리다이렉션 0·원격 명령 화이트리스트·쓰기는 write_snapshot 한정, 역증명 4종 내장). data03·data04·data05 **실행 검증 완료**. 검증: AC-E4-1
- [x] **T-E4-2** (S) OpenSearch COMMAND 검색 모듈 — `attribution_lib.search_sudo_commands()`(`fleet_node` term + `COMMAND=` match_phrase + `@timestamp` range, UTC 변환). `raw`는 로컬 전용. 실패 시 `partial_reasons`에 남기고 파일 증거만으로 계속한다(조용한 실패 금지). 검증: AC-E4-1 부속
- [x] **T-E4-3** (M) redaction·카테고리화 — 결정적 4카테고리(+`.ollama`·HF 캐시 실측 확장) · `attribution_export.py`가 반출 **유일 경로**(`public_view()`로 raw 재귀 제거 → `redact_text()` → `assert_no_leak()` 예외 차단) · vLLM 의도 요약(어조 계약 `_enforce_hedge()`, 실패 시 None) + LLM 출력 재-redaction. 게이트 `check-attribution-redaction.sh`(R1~R6, **변이 검사** 포함). 검증: AC-E4-3·AC-E4-4
- [~] **T-E4-4** (S) relay 연동 — 수집기 쪽 계약 이행 완료(`--json`·`--since` 별칭, mtime RFC3339, `top_dirs` 정렬 고정). **실제 relay 렌더러로 종단 확인**: 우리 JSON → `drop_local_only_fields` → `render_attribution_reply` → 누출 0 · user6·Python 환경 도출(게이트 R6가 회귀 감시). 잔여는 relay `[server]` 배포(T-E3-6)뿐. 검증: AC-E3-7과 합동
- [x] **T-E4-5** (S) 8-03 사건 리플레이 — `fixtures/incident-2026-08-03-data04.raw`(**19:55 KST data04 실수집 원문**, 합성 아님) + `test_attribution.py` 25건(네트워크 0). 재현 확인: 소유자 user6 · 카테고리 "Python 환경" · 1.1GiB ×2 · **17:45/17:48**. 검증: AC-E4-2
- [x] **T-E4-6** (S) data05 폴백 — `sudo -n` 실패 시 비특권 축소 수집 + `partial: true`·사유 명시(data05 실행 rc=0 확인). 일일 베이스라인 `infra/collectors/keiwi-disk-baseline.{service,timer}`(03:00·Persistent·`-`접두사로 노드별 실패 격리·ProtectSystem=strict). 검증: AC-E4-5
- [ ] **T-E4-7** `[server]` (S) 배포 — 수집기를 `/opt/keiwi/scripts/collectors/`로 복사 + 타이머 활성 + `/data/alert-relay/snapshots` 생성(§11). **read-only 실행 검증은 이미 끝났다**(data03·04·05, 2026-08-03) — 남은 것은 배치·타이머·relay `RELAY_COLLECTOR` 배선. **선행: T-E4-1~6.** 검증: AC-E4-1·2·5·6
- [x] **T-E4-8** (S) 단계 게이트 문서화 — [attribution-stages.md](./attribution-stages.md): 단계 비교표 · 게이트 A/B 통과 조건과 **판정 기록 양식** · 명시적 거부 목록 · "단계 상승이 아니라 0단계 미완성인 실패" 감별표. **psacct·auditd 코드는 만들지 않았다.** 검증: 문서 존재

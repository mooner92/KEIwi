# 알림 상관 — TASKS

크기: S(≤2h) · M(반나절) · L(1일+). `[server]`는 노드 접근·sudo가 필요해 **사람이 실행**한다.

> ⚠️ **선행: `alert-enrichment` T-E3-6(E3 컷오버).** relay가 섀도라 아래 전부가 구현되어도
> 실채널 효과는 0이다(spec §7). 구현은 선행 없이 가능하다 — 가치 발생 시점만 미뤄진다.

## P0 — 재발화 강등 (spec C1)

- [x] **T0-1** (S) ~~`CooldownStore`~~ → **신규 스토어가 필요 없었다.** `threads` 테이블에
      `last_seen` 이 이미 있어 억제창 판정에 그대로 쓰고, 컬럼 하나(`repeat_count`)만 더했다.
      `ThreadStore` 의 sqlite+메모리 2티어가 그대로 적용된다(DB 죽어도 발송 지속). 검증: AC-5
- [x] **T0-2** (S) 강등 분기 — 억제창 안이면 새 메시지 대신 스레드 답글. 답글 본문에
      **"N회째 (최초 HH:MM)"** — 5회째와 1회째는 다른 정보다. 검증: AC-1
- [x] **T0-3** (S) `severity: critical` 예외 — 억제창 무시. 검증: AC-4
- [x] **T0-4** (S) `RELAY_COOLDOWN_SEC`(기본 1800) env + README §설정 표 갱신.
      **`RELAY_DEDUP_WINDOW_SEC`(배달 중복, 300초)와 혼동 금지** — 이름이 비슷하고 의미가
      다르므로 README에 두 줄을 나란히 놓고 차이를 적는다
- [x] **T0-5** (S) 유닛 — 억제창 경계(창 안/밖/정확히 경계), critical 예외, DB 부재 폴백 — 6건(AC-1·4 · 창 만료 · 스위치 off · DB 실패 · 혼합 그룹)

## P1 — 사건 상관 (spec C2·C3)

- [ ] **T1-1** (S) `infra/alert-relay/correlation.yaml` 신설 — 규칙 1건(`disk-pressure-cascade`)만
      담아 시작한다. 규칙을 늘리는 것은 실제 사건을 겪은 뒤다
- [ ] **T1-2** (M) 로더 + 매칭기 — `when.node: same` · `within`. **인과 추론 없음**(선언된
      조합 + 같은 노드 + 시간창). stdlib only(relay 계약)
- [ ] **T1-3** (M) `incidents`·`incident_alerts` 테이블 + 사건 개폐 — 구성 알림 전부 해소 시
      `resolved`. 검증: AC-2
- [ ] **T1-4** (S) fail-open 경로 — 매칭 실패·로더 예외·YAML 파손 시 **낱개 발송**.
      검증: AC-3 (유실 0이 이 스펙의 최상위 불변식이다)
- [ ] **T1-5** (S) Slack 표기 — "추정 연결 — 규칙 `<id>`" + 사건 요약 1줄. 원문은 스레드에
      그대로 남긴다(spec C4-2)
- [ ] **T1-6** (M) 픽스처 — 2026-08-14 data04 사건(DiskUsageHigh·DiskFillPredicted·OOM·
      WORKER TIMEOUT) 리플레이. **실제 사건을 픽스처로 쓴다** — 합성 데이터는 우리가
      상상한 모양만 검증한다

## P2 — 게이트 · 콘솔 (spec AC-6·7)

- [ ] **T2-1** (S) `scripts/gates/check-correlation-rules.py` — `correlation.yaml`의 alertname이
      `alert-rules.yaml`에 실존하는가. **파서 게이트**로 만든다(grep은 필드 문맥을 못 본다 —
      2026-08-15 `$$` 사고의 교훈). 검증: AC-6
- [ ] **T2-2** (S) 게이트 자기검증(`--self-test`) — 없는 alertname을 심어 실제로 무는지.
      검증: AC-7
- [ ] **T2-3** (S) CI 배선(`.github/workflows/ci.yml` repo-gates 잡) + `check-ci-coverage` 통과
- [ ] **T2-4** (M) `/incidents` 확장 — 사건 목록·상세. **신규 라우트 금지**(기존 어시스턴트
      딥링크 대상 재사용). 상태는 URL이 소유(`?incident=`) — 하이드레이션 사고 3회의 교훈
- [ ] **T2-5** (S) `[server]` relay 재배포(`/opt/keiwi/alert-relay/`) + 실채널 1건 육안 확인

## P3 — 보류

- [ ] **B01** `auto-remediation` 연결 — L1 제안 단위를 알림 1건 → 사건 1건으로.
      **재개 조건: L2 파일럿(T2-9) 무사고 완료.** 그 전에는 착수하지 않는다
- [ ] **B02** 상관 규칙 확장 — 실제 사건을 겪은 뒤에만 추가한다. 겪지 않은 조합을 미리
      선언하면 검증할 수 없는 규칙이 쌓인다
- [ ] **B03** 억제창 자동 조정(발화 빈도 기반) — P0 운영 2주 관찰 후 필요성 재평가

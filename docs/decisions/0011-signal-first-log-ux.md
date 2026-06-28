# 0011. 신호 우선(signal-first) 로그 UX · 노이즈 정책

- 상태: 채택 (2026-06-28)
- 후속: [ADR-0008](0008-log-pipeline.md)(파이프라인) · [ADR-0010](0010-log-taxonomy.md)(분류·보존). 관련 [spec](../../specs/M2-logs/spec.md) · [런북](../runbooks/rsyslog-omfile-flood.md).

## 맥락

M2 로그가 콘솔 `/logs`까지 라이브됐으나, 첫 화면이 **모든 로그를 날것으로 tail하는 firehose**였다. 운영자(사용자)가 "raw 로그가 너무 많아 보기 어렵다"고 지적 — 정작 봐야 할 신호가 노이즈에 묻힌다.

**실측(2026-06-28, last 1h, OpenSearch 직접 질의):**
- 전체 3,466건 중 `error`+`warn` = 1,221건. 그 **99%가 `rsyslog.service`의 `omfile suspended` 도배**(priority=4 warn, source=priority).
- 나머지 `info` 홍수: `[GIN]` HTTP 접근로그, `(APIServer) /metrics` Prometheus 스크레이프, `[devbooth-sync]` 하트비트, cron 세션, `[UFW BLOCK]` ICMPv6 멀티캐스트.
- 노이즈 제거 후 **실제 신호 = 0~소수**(예: `docker.service` "ShouldRestart failed … hasBeenManuallyStopped=true" 양성 경고 1건). 즉 fleet는 대체로 건강한데 화면만 시끄러웠다.

사용자에게 3개 범위를 제시(대시보드만 / +파이프라인 log_class 분류 / +수집단계 drop)했고 **"대시보드 재구성만"**(파이프라인 무변경, 즉시·무위험)을 선택했다.

## 결정

**(1) 신호 우선 대시보드(`logs.json`, uid `keiwi-logs`).** 레이아웃을 "문제 먼저":
- **레벨 변수 기본값 = `error,warn`** → `info` 홍수(접근로그·스크레이프·하트비트)가 기본 화면에서 자동 제외. 사용자가 드롭다운으로 `All`/`info` 추가 가능.
- 위→아래: **에러 우선 stat**(에러·경고 카운트+스파크라인) → **추세 timeseries** + **상위 서비스 table**(장애 주체 추적, spec UL6) → **문제 로그(메인)** → **전체 raw 스트림은 접힌 행**(`collapsed row` — 평소 숨김, 클릭해 펼침, 모든 레벨·노이즈 포함).
- 메인 로그 패널 `dedupStrategy: signature` — 반복 로그를 구조 기준으로 접어 "같은 메시지 ×N"로 표시.

**(2) 노이즈 정책 = 대시보드 쿼리 제외.** 신호 패널 쿼리에 `AND NOT service:"rsyslog.service" AND NOT message:"UFW BLOCK"`를 추가. 파이프라인 단계의 체계적 분류(`log_class`)는 **보류**(과설계 — 단일 서비스 노이즈에 새 필드·필터를 도입하는 비용 > 효용). 노이즈가 늘면 그때 ADR로 `log_class` 재검토.

**(3) 제외는 `service`(keyword) 기준으로.** `message`는 분석된 `text`라 토큰화에 의존 — `message:"omfile"`은 토큰이 안 잡혀 매칭 실패(실측 확인: `match_phrase omfile`=0, `wildcard *omfile*`=25,375). 신뢰 가능한 제외는 **keyword 필드**(`service`)의 정확 매칭. 메시지 기반 제외는 토큰 존재를 `_analyze`로 확인한 경우에만.

**(4) rsyslog 도배는 근본 수정(호스트).** band-aid(대시보드 제외)와 별개로, **data04의 rsyslog를 비활성**(`systemctl disable --now rsyslog`)했다. 근본 원인은 `/etc/rsyslog.d/50-default.conf`의 **상대경로 오타**(`var/log/auth.log` 등 — 앞 `/` 누락)로 omfile이 못 써 무한 재시도. journald+Filebeat가 로그를 이미 받으므로 rsyslog 파일 출력은 중복 → 비활성이 정답. 절차·진단은 [런북](../runbooks/rsyslog-omfile-flood.md). 기존 노이즈 328,538건은 `_delete_by_query`로 정리.

## 고려한 대안

- **파이프라인 `log_class` 분류(app·access·scrape·heartbeat·housekeeping)** — 어디서나 노이즈를 체계적으로 숨기고 토글 복원. 근본적이나 `logs.conf`·템플릿 변경 + 단일-서비스 노이즈엔 과설계 → **보류**(노이즈 다양해지면 채택).
- **수집 단계 drop(Filebeat/Logstash)** — `/metrics` 접근로그 등 진단가치 0을 아예 안 받아 볼륨↓. drop은 비가역(과차단 위험) → **보류**, 확실한 것만 선별 시 채택.
- **그대로 두기** — 운영 불가(firehose) → 기각.

## 결과

- 콘솔 `/logs` 첫 화면이 **신호만**(에러·경고·문제 서비스). 평소 0~소수, 장애 시 즉시 부각. raw는 접힌 행에서 opt-in.
- 노이즈 추가 제외 = `logs.json` 쿼리에 `NOT service:"..."` 한 줄(사람이 import). 한계: 단일 대시보드에 누적되는 whack-a-mole — 임계 넘으면 ADR로 `log_class` 전환.
- rsyslog 근본 해소로 **저장의 ~65%(노이즈) 제거** + 데몬 오류 종결. data04 호스트 상태 변경은 [memory/m2-logs-live] 및 런북에 기록.
- 산출물: `infra/monitoring/dashboards/logs.json`(v3, 신호우선), [README §대시보드·트러블슈팅](../../infra/logging/README.md).
- 참조: 헌장 §I-2(단일 콘솔)·§6(지루한 기술)·§11(사람 적용).

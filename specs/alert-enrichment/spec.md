# 알림 보강 — SPEC (E1~E4 상세 설계)

> 권위: [README](./README.md)가 왜·순서·게이트를, 이 문서가 무엇·어떻게·AC를 담는다.
> 표기: **[실측]** = 2026-08-03 사건·같은 날 조사값. **[검증 필요]** = 문법·동작을 Grafana UI/실기에서 확인 후 확정. **[가설]** = 추정.

---

## 0. 공통 규약

### 0.1 대상 평면 3개 — 어디를 고치고 어디에 반영하나

| 평면 | 경로 | 상태 [실측] |
|---|---|---|
| dev 레포 | `/KEIwi/infra/monitoring/grafana/provisioning/alerting/` | 라이브와 3파일 byte-identical. `$labels` 미이스케이프 **16곳**(node 라벨 8: 행 59·163·202·235·277·309·343·378 + summary 8) |
| W1 브랜치 | keiwi-design `chore/gate-toolchain` (4c8b709) — 규칙 9→14, GpuTempHigh 92 교정, runbook_url 교체 | `$labels` **24곳**(필드) + 주석 1곳. **버그 그대로** |
| 라이브 | `/data/monitoring/grafana/provisioning/alerting/` | 사람이 복사(§11·§12). 이 스펙의 산출물은 전부 레포에서 만들고 복사만 한다 |

병합 규약: 이스케이프 픽스는 **두 브랜치 모두**에 커밋한다(T-E1-6). 어느 쪽이 먼저 머지되든 `{{ $labels`가 0건이어야 한다는 게이트(AC-E1-7)가 재발을 막는다.

### 0.2 프로비저닝 `$` 이스케이프 규약 — 이 스펙의 근본 규칙

Grafana는 프로비저닝 YAML 전체에서 `$VAR`/`${VAR}`를 환경변수로 보간한다. Go 템플릿 변수(`$labels`·`$values`·`$v` 등)는 **반드시 `$$`로 이스케이프**한다. 예외 2가지:

1. `$__env{VAR}` — 의도된 명시적 env 보간(contact-points의 `$__env{SLACK_BOT_TOKEN}`). **이스케이프하지 않는다.**
2. `$` 없는 템플릿(`.`, `range`, `index`, `template` 호출만) — 이스케이프 불필요. **notification 템플릿(D1-3)은 이 형태로만 짠다**(가장 안전).

[출처: grafana.com/docs/…/file-provisioning/ "escape the $variable with $$variable" · github.com/grafana/grafana/issues/78118]

게이트(레포, fleet-hardening 축5 레지스트리에 등록 후보):

```bash
# scripts/gates/check-alerting-escapes.sh — alerting 프로비저닝 4파일 대상
# 통과: 이스케이프 안 된 `$영문` 0건 ($$·$__env 제외)
grep -nE '\$[a-zA-Z]' infra/monitoring/grafana/provisioning/alerting/*.yaml \
  | grep -v '\$\$' | grep -v '\$__env{' && exit 1 || exit 0
```

### 0.3 검증 헬퍼

- Grafana API: `curl -s -H "Authorization: Bearer $GRAFANA_SA_TOKEN" http://localhost:3000/api/v1/provisioning/alert-rules` — 토큰은 `/data/monitoring/.env`(§13, 레포 밖).
- 어시스턴트: `curl -s -X POST http://localhost:3105/api/assistant -H 'content-type: application/json' -d '{"fleetNode":"data04","question":"..."}'` — 라이브, 인증 없음, 동시 1(초과 429) [실측 `route.ts:10-11`].
- 노드 SSH(read-only): data03 `mooner92@192.168.1.103 -p 764` · data04 `mhchoi@192.168.1.104 -p 764` — 둘 다 `sudo -n` OK. **data05만 실패** [실측].

---

## 1. E1 — 알림 메시지 수리 (오늘 배포 가능)

### 1.1 문제 [실측]

- Slack 제목: `🔴 [WARNING] DiskUsageHigh · {{ .instance }}` — 리터럴.
- 본문: `*DiskUsageHigh* — {{ .instance }} {{ .mountpoint }} 사용률 90% 초과` — 리터럴 + 현재값·시작시각 없음.
- 원인: §0.2(env 보간). 파생: `node` 라벨이 전 인스턴스 동일 리터럴 → `group_by:[alertname,node]` 무력.
- GpuTempHigh summary가 임계 92인데 "85°C 초과"라고 말한다(dev `alert-rules.yaml:204`; W1은 교정됨).

### 1.2 설계

#### D1-1. 이스케이프 — `alert-rules.yaml` 16곳(dev) / 24곳(W1)

```bash
sed -i 's/{{ \$labels\./{{ $$labels./g' infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml
```

`node: '{{ $labels.instance }}'` → `node: '{{ $$labels.instance }}'`. 라벨 값은 인스턴스 식별자로 **안정적**이라 허용 패턴이고 group_by에 필요하므로 유지한다. 단 **라벨에 `$values`를 넣는 확장은 금지** — 값이 바뀔 때마다 알럿 인스턴스가 분열·stale 처리된다 [출처: grafana.com/docs/…/alerting-rules/templates/ 공식 경고].

`node` 라벨에 `stripPort`를 붙이지 않는다(판단 §1.3-①).

#### D1-2. summary에 현재값·마운트·임계·지속 — 규칙 annotation에서 렌더

값 포맷팅 함수(`printf`·`humanize` 계열)는 **규칙 annotation에만 있고 notification 템플릿에는 없다.** 값은 발화 시점에 annotation에서 확정하고, notification은 조립만 한다(정석) [출처: grafana.com/docs/…/alerting-rules/templates/reference/ + template-notifications/reference/]. KEIwi 규칙은 전부 threshold 표현식(refId A 쿼리 + C 판정)이라 `$labels`·`$values`가 정상 동작한다(classic condition이면 비는 함정 — 해당 없음).

```yaml
# DiskUsageHigh (dev 행 165 교체) — 사건 재현 시 기대 출력:
#   "192.168.1.104 / 사용률 95.2% (임계 90% · 15m 지속)"
summary: '{{ $$labels.instance | stripPort }} {{ $$labels.mountpoint }} 사용률 {{ printf "%.1f" $$values.A.Value }}% (임계 90% · 15m 지속)'

# GpuTempHigh (행 204 — "85°C 초과" 오기도 함께 종결)
summary: 'GPU 과열 {{ $$labels.instance | stripPort }} GPU{{ $$labels.gpu }} — {{ printf "%.0f" $$values.A.Value }}°C (임계 92°C · 10m 지속)'

# MemoryLow (행 237)
summary: '{{ $$labels.instance | stripPort }} 가용 메모리 {{ printf "%.1f" $$values.A.Value }}% (임계 5% · 15m 지속)'

# DiskFillPredicted (행 380)
summary: '{{ $$labels.instance | stripPort }} {{ $$labels.mountpoint }} — 현재 추세로 4시간 내 가득 참 (예측 여유 {{ humanize1024 $$values.A.Value }}B)'
```

- `stripPort`는 규칙 템플릿 함수 목록에 있다 [출처: templates/reference]. 파이프 문법 `| stripPort`는 **[검증 필요]** — UI 미리보기에서 실패하면 `{{ stripPort $$labels.instance }}` 전치 표기로 폴백.
- 결정적 실패 4종(XID·OOM·SMART·NodeDown)은 값보다 발생 자체가 정보라 현행 문구 유지 + 이스케이프만.
- NodeDown은 `noDataState: Alerting`이라 NoData 발화 시 `$labels`가 빌 수 있다 — 기존 문구가 라벨 없이도 성립하므로 유지(위험 §1.5-②).
- DiskFillPredicted의 예측 여유는 음수가 나올 수 있다(추세 소진 후) — 음수 표기 그대로 둔다(정보 손실 없음).

#### D1-3. notification 템플릿 그룹 — 신규 `templates.yaml`

`templates:`는 파일 프로비저닝 허용 키다 [실측: notification-policies.yaml:68-71 허용 키 목록]. **`$` 문자를 아예 쓰지 않는 형태**로 짠다(§0.2-②).

```yaml
# infra/monitoring/grafana/provisioning/alerting/templates.yaml (신규)
apiVersion: 1
templates:
  - orgId: 1
    name: keiwi-slack
    template: |
      {{ define "keiwi.title" -}}
      {{ if eq .Status "firing" }}🔴{{ else }}✅{{ end }} [{{ .CommonLabels.severity | toUpper }}] {{ .CommonLabels.alertname }}{{ if .CommonLabels.node }} · {{ .CommonLabels.node }}{{ end }}{{ if gt (len .Alerts.Firing) 1 }} ×{{ len .Alerts.Firing }}{{ end }}
      {{- end }}

      {{ define "keiwi.alert" -}}
      *{{ .Labels.alertname }}*{{ if .Labels.node }} · {{ .Labels.node }}{{ end }} — {{ .Annotations.summary }}
      시작 {{ .StartsAt | tz "Asia/Seoul" | date "01-02 15:04" }} KST
      {{ if .Annotations.console_url }}<{{ .Annotations.console_url }}|콘솔 분석>{{ end }}{{ if .Annotations.drilldown_url }} · <{{ .Annotations.drilldown_url }}|드릴다운>{{ end }}{{ if .DashboardURL }} · <{{ .DashboardURL }}|대시보드>{{ end }}{{ if .SilenceURL }} · <{{ .SilenceURL }}|침묵>{{ end }}{{ if .Annotations.runbook_url }} · <{{ .Annotations.runbook_url }}|런북>{{ end }}
      {{- end }}

      {{ define "keiwi.text" -}}
      {{ range .Alerts.Firing }}{{ template "keiwi.alert" . }}
      {{ end }}{{ range .Alerts.Resolved }}✅ 해결: {{ .Labels.alertname }}{{ if .Labels.node }} · {{ .Labels.node }}{{ end }} ({{ .EndsAt | tz "Asia/Seoul" | date "15:04" }} KST)
      {{ end }}
      {{- end }}
```

- `.StartsAt | tz "Asia/Seoul" | date "01-02 15:04"` 파이프 순서는 **[검증 필요]** — Grafana UI 템플릿 미리보기로 확인, 실패 시 `.StartsAt` 원시 출력으로 폴백하고 KST 표기는 E3의 relay가 담당.
- 본문이 알림별 `.Labels.node`를 찍으므로 warning 라우트(group_by `[alertname]`)에서 다중 노드 동시 발화 시 `.CommonLabels.node`가 탈락해도 노드가 보인다 [출처: template-notifications/reference — CommonLabels는 그룹 내 전 알림 공유 라벨만].
- Slack 링크는 `<url|라벨>` mrkdwn 문법.

#### D1-4. contact-points 교체 — 2채널 중복 로직을 템플릿 호출로

```yaml
# contact-points.yaml — slack-infra·slack-web 공통 (settings 발췌)
title: '{{ template "keiwi.title" . }}'
text: '{{ template "keiwi.text" . }}'
```

`$__env{SLACK_BOT_TOKEN}`·`endpointUrl: https://api.slack.com/...`은 그대로 둔다(§0.2-①, SNI 차단 우회 실측 주석 유지).

#### D1-5. warning 라우트 group_by 재설계 — `[alertname]` → `[alertname, node]`

현재는 두 노드가 같은 warning을 동시 발화하면 한 메시지로 묶이고 제목에서 노드가 사라진다. 5노드 규모라 노드별 분리로 인한 도배 위험이 낮고, "어느 노드가 해결됐나" 추적이 명확해진다. D1-3의 본문 노드 표기가 이미 보완하므로 **선택 사항** — 채택하되 2주 리뷰에서 메시지 수 증가가 거슬리면 되돌린다(파일 1줄).

### 1.3 주요 판단

| # | 판단 | 근거 |
|---|---|---|
| ① | `node` 라벨에 `stripPort` 안 붙임 | 라벨 값 변경 = 알럿 인스턴스 재정의 → 기존 silence·그룹핑 연속성 단절. 오늘 핫픽스는 의미 불변(이스케이프)만. 포트 제거는 표시 계층(summary·title)에서 |
| ② | 값 렌더는 annotation, notification은 조립만 | humanize 계열이 notification 쪽에 없음 + 발화 시점 1회 평가가 정확 [출처: templates/reference] |
| ③ | 규칙 라벨 템플릿 유지(제거 안 함) | group_by `[alertname,node]` 라우팅에 필요. 값이 안정적이라 공식 허용 패턴 |
| ④ | plan B 명시 | 만약 `$$` 적용 후에도 라벨이 리터럴이면(=렌더 자체가 안 되는 경우) node 라벨을 포기하고 notification의 `.Labels.instance`로 전환 + group_by를 `[alertname, instance]`로. #78118 재현 사례상 가능성 낮음 [가설] |

### 1.4 수용 기준 (AC)

| AC | 검증 (기계) | 기대 |
|---|---|---|
| **AC-E1-1** | `grep -cF '{{ $labels' alert-rules.yaml` / `grep -cF '{{ $$labels'` | 0 / **16**(dev) · 0 / **24**(W1, 주석 제외) |
| **AC-E1-2** `[server]` | 적용 후 `curl …/api/v1/provisioning/alert-rules \| jq -r '.[].labels.node'` | 전 규칙 `{{ $labels.instance }}` 포함, `{{ .instance }}` 0건 (API는 보간 후 저장값을 반환하므로 이게 원인 확정 실측이다) |
| **AC-E1-3** `[server]` | Grafana UI에서 DiskUsageHigh 열어 annotation 미리보기 | summary에 숫자 %가 렌더됨 (스크린샷 캡처) |
| **AC-E1-4** | `grep -c '92°C' alert-rules.yaml` + `grep -c '85°C'` | ≥1 / 0 (dev 기준) |
| **AC-E1-5** `[server]` | templates.yaml 복사 후 `docker logs grafana 2>&1 \| grep -i 'provision.*err'` + `curl …/api/v1/provisioning/templates` | 에러 0 + `keiwi-slack` 존재 (기동 실패 전례: inhibitionRules 사고 [실측]) |
| **AC-E1-6** `[server]` | 테스트 발화(임계 임시 하향 또는 Test notification) → Slack 실메시지 | ① 현재값 % ② 마운트 ③ 시작 KST ④ 침묵 링크 4종 확인 + 스크린샷 |
| **AC-E1-7** | `bash scripts/gates/check-alerting-escapes.sh` (§0.2) | rc=0 — 4파일 전체, 재발 방지 게이트 |

### 1.5 위험

1. **templates.yaml 문법 오류 → Grafana 기동 실패** (inhibitionRules 전례). 완화: 라이브 복사 전 로컬 Grafana 컨테이너로 프로비저닝 스모크(AC-E1-5를 로컬 먼저) + 적용 직후 3000 포트 리스닝 확인.
2. NodeDown NoData 발화 시 라벨 공백 — 제목이 노드 없이 나감. 기존 동작과 동일(악화 아님), E3에서 relay가 payload의 `generatorURL`로 보완 [가설].
3. `tz`/`date`/`stripPort` 파이프 문법 [검증 필요] 3건 — 전부 UI 미리보기로 확정 후 커밋. 실패해도 메시지가 깨지는 게 아니라 해당 조각만 원시 출력.

---

## 2. E2 — 딥링크 (알림 → 클릭 1번 → 그 노드·그 시간창)

### 2.1 문제와 실측된 착지점

- 현재 알림에는 런북 링크뿐, 그마저 낡은 문서(fleet-hardening 축3가 교체 중 — 재정의 금지).
- 콘솔 착지점 [실측]: `/incidents?service=&node=&q=` **수신 + 자동 분석 1회**(`incidents/page.tsx:17-25`, `assistant-panel.tsx:71-79`) — 최적 타깃. `/overview?node=` 수신. `/logs`는 searchParams 전무.
- 빈 곳 [실측]: ① `/incidents`가 시간창(`from`)을 URL로 안 받음(`ErrorContext.from`은 API에 존재) ② node 파라미터가 `data04` 형태를 기대하나 Grafana 템플릿은 `192.168.1.104:9100`만 만들 수 있음(라벨→노드명 매핑 함수 없음).

### 2.2 설계

#### D2-1. 규칙 annotation 3종 (전 규칙, E1 위에 얹음)

```yaml
# 노드 계열 규칙(NodeDown·DiskUsageHigh·MemoryLow·DiskFillPredicted·OOM) 예 — DiskUsageHigh:
annotations:
  __dashboardUid__: 'keiwi-system-v3'          # → .DashboardURL/.PanelURL 자동 생성(시간범위 포함)
  __panelId__: '<디스크 패널 ID>'               # 선택 — 패널 ID 확정 후
  drilldown_url: 'https://grafana.excusa.uk/d/keiwi-system-v3?orgId=1&var-instance={{ $$labels.instance }}&var-node={{ $$labels.instance }}&var-host={{ $$labels.instance }}&from=now-6h&to=now'
  console_url: 'https://keiwi.excusa.uk/incidents?alert=DiskUsageHigh&node={{ $$labels.instance }}&mount={{ $$labels.mountpoint }}&from=now-6h'
# GPU 계열(GpuTempHigh·GpuXidErrorNew): __dashboardUid__: keiwi-gpu-v3
# LogIngestStalled: __dashboardUid__: keiwi-logs-v3 (노드 무관 — var-* 없이)
```

- `__dashboardUid__`→`.DashboardURL`·`.SilenceURL`(Grafana-managed면 무조건, 라벨 matcher 프리필)은 공짜 [출처: grafana.com/docs/…/annotation-label/ + create-silence/]. DashboardURL엔 var-*를 못 실으므로 `drilldown_url`을 별도로 만든다.
- var 후보 3종 동시 주입은 콘솔의 기존 전략을 미러링한 것(`grafana-tabs.tsx:50-60` — 대시보드에 없는 변수는 Grafana가 무시). **[검증 필요]**: system-v3가 `var-nodename` 없이 instance만으로 전환되는지 — 커밋 3a35dd8("Instance만으론 전환 안 됨")·e61c23b(후보 확장)의 경위가 있으므로 클릭 실측(AC-E2-2) 필수. 안 되면 노드명 매핑은 E3 relay(정적 5노드 맵)로 이관하고 annotation은 콘솔 링크만 유지.
- 시간창은 상대형(`now-6h`)을 쓴다 — annotation은 발화 시점 1회 평가라 절대 epoch을 못 만든다. "발화 직후 클릭" 시나리오에선 상대형이 정확하고, 정확한 절대창은 E3 relay가 `startsAt`으로 계산해 스레드 링크에 넣는다.
- 한국어 프리셋 질문을 URL에 넣지 않는다(인코딩 지옥) — `alert=<이름>` 파라미터를 콘솔이 받아 **콘솔 코드의 프리셋 테이블**이 질문을 만든다(D2-2). 프리셋이 코드로 버전관리되는 부수 이득.

#### D2-2. 콘솔 소보수 (`apps/console`)

1. `/incidents`: `alert`·`mount`·`from` searchParams 수용 — `alert`→프리셋 질문 테이블(예: DiskUsageHigh → "최근 6시간 {node} {mount} 디스크 사용 급증의 원인 후보를 로그에서 찾아줘"), `from`→`ErrorContext.from` 배선(`assistant-panel.tsx:20-24`에 이미 자리 있음).
2. **node 정규화 유틸**: `data04` | `192.168.1.104` | `192.168.1.104:9100` 모두 수용 → fleetNode id로. 콘솔 `types/fleet.ts`에 노드↔IP 매핑이 있으면 재사용, 없으면 5-ent리 맵 추가 [검증 필요 — 구현 시 확인].
3. `/logs` searchParams 주입(`logs-workbench.tsx:114-115`의 useState 초기값으로) — **선택**(P2). `/incidents`가 주 착지점이라 없어도 E2 게이트는 통과 가능.

### 2.3 수용 기준 (AC)

| AC | 검증 | 기대 |
|---|---|---|
| **AC-E2-1** | `grep -c '__dashboardUid__' alert-rules.yaml` / `grep -c 'console_url'` | 규칙 수와 일치 — 9(dev)/14(W1). LogIngestStalled 등 노드 무관 규칙은 console_url에 node 파라미터 없음 허용 |
| **AC-E2-2** `[server]` | drilldown_url 실클릭 (사건 재현 파라미터: `var-instance=192.168.1.104:9100`) | system-v3가 data04로 필터된 상태로 열림 (스크린샷). 실패 시 D2-1 폴백 경로 발동 기록 |
| **AC-E2-3** | Playwright: `/incidents?alert=DiskUsageHigh&node=192.168.1.104:9100&mount=/&from=now-6h` | 200 + 노드가 data04로 정규화 표시 + 자동 분석 1회 발화(요청 1건 관측) |
| **AC-E2-4** | 같은 Playwright에서 assistant 요청 body 검사 | `from` 반영 확인 |
| **AC-E2-5** | runbook_url 무결성 | fleet-hardening 축3 게이트 재사용(교차 참조 — 이 스펙은 재정의하지 않음) |

### 2.4 위험

- 콘솔 자동 분석은 GPU(vLLM)를 1회 소비한다 — 딥링크 클릭이 몰리면 429. 기존 동시 1 제한이 자연 방어하고, 실패해도 페이지는 뜬다(분석만 재시도 버튼).
- 시각 QA: 콘솔 변경분은 작업 끝에 Playwright 스크린샷 공유(기존 관례, `docs/testing.md`).

---

## 3. E3 — 스레드 보강: alert-relay (유일한 신규 서비스)

### 3.1 왜 중계인가

Grafana 13 Slack 알림기에 `thread_ts`가 없다 [실측 `/api/alert-notifiers`]. 그러나 **중계가 원 메시지를 직접 게시하면 응답으로 `ts`를 쥔다** — 같은 bot token으로 `chat.postMessage`에 `thread_ts`만 넘기면 스레드 답글이 되고 추가 스코프도 불필요하다 [출처: api.slack.com/methods/chat.postMessage]. 이 구조 하나로 ① 스레딩 ② LLM 분석 답글 ③ 귀속 답글 ④ 발생→해결 한 스레드가 전부 풀린다. 업계 표준 흐름과 동일하다(Robusta: 알림 선게시 → 조사 결과는 스레드 답글, 지연 15~20분·비용 $0.04/건 사례 — KEIwi는 로컬 vLLM이라 비용 0) [출처: cncf.io/blog/2026/04/21/…holmesgpt…].

### 3.2 아키텍처

```
Grafana ──webhook(JSON: labels·annotations·values·fingerprint·startsAt·
        │         title/message는 E1 템플릿으로 렌더된 상태)
        ▼
alert-relay (data05, 신규 — Python3 stdlib 전용, systemd)
  1. 서명/토큰 검증 → 즉시 chat.postMessage(#keiwi-infra, E1 렌더된 title+message)
     → 응답 ts를 fingerprint와 함께 sqlite 저장 → Grafana에 200  [여기까지 동기, LLM 무관]
  2. (비동기) E4 결정적 수집기 실행 → 스레드 답글 #1 (수 초)
  3. (비동기) POST :3105/api/assistant (프리셋 질문+수집 요약) → 스레드 답글 #2 (1~3분 목표)
  4. resolved 웹훅 → 같은 fingerprint의 ts로 "✅ 해결" 답글
egress: api.slack.com 하나 그대로. LLM은 로컬 vLLM. 신규 외부 통신 0.
```

- 웹훅 payload에 알림별 labels·annotations·values·fingerprint·startsAt·generatorURL이 전부 온다 + HMAC-SHA256 서명 옵션 [출처: grafana.com/docs/…/webhook-notifier/]. 인증은 공유 시크릿 헤더(양쪽 env, §13 — `/data/alert-relay/env` root:root 0600, systemd `EnvironmentFile`).
- 기본 게시 메시지는 **payload의 렌더된 title/message를 그대로 쓴다** — 메시지 포맷의 정본이 E1 템플릿 한 곳으로 유지된다.
- relay만이 할 수 있는 보강을 스레드 #1에 추가: `startsAt` 기반 **절대 시간창** 드릴다운 링크(`from/to` epoch ms), IP→노드명 정적 맵(5노드)으로 `data04` 표기.

### 3.3 relay 구현 규약

| 항목 | 결정 |
|---|---|
| 언어/의존성 | Python 3 stdlib만(http.server·urllib·sqlite3·hmac). pip 0개 — egress 최소·감사 용이·1인 유지보수 |
| 배치 | data05, systemd unit(`Restart=always`), 포트 예시 :8130(배포 시 확정) |
| 엔드포인트 | `POST /webhook`(Grafana) · `GET /healthz`(watchdog — sqlite 접근성·마지막 처리 시각 포함) |
| 스레드 저장 | sqlite `threads(fingerprint TEXT PK, channel, ts, alertname, started_at, last_seen)` — TTL 30일 정리 |
| 어시스턴트 호출 | 직렬 큐(동시 1 — :3105 계약과 정합), 타임아웃 120s, 429/502 → 지수 백오프 3회, 최종 실패 시 **조용히 생략**(Slack에 실패 도배 금지, relay 로그에만) |
| 귀속 검색 | OpenSearch `localhost:9200/keiwi-logs-*/_search` 직접(read-only) — 콘솔 `answerError`가 levels error/warn 고정이라 sudo COMMAND(info)를 놓치는 실측 제약의 우회 |
| 프라이버시 | Slack payload 빌더는 단일 함수 경로 — E4 redaction 게이트(AC-E4-3)가 이 함수를 검사한다 |

### 3.4 트레이드오프 — 정직하게: 알림 경로가 relay에 의존하게 된다

컷오버 후 relay가 죽으면 Slack 알림이 멈춘다. 이것은 "전달은 어떤 부가 시스템에도 의존하지 않는다" 제약과 긴장 관계다. 판단: **LLM 의존(금지)과 소형 결정적 중계 의존(관리 가능)은 다르다** — 업계도 알림 게시 주체가 중계(Robusta OSS)인 구조를 표준으로 쓴다. 대신 4중 완화를 의무로 한다:

1. **섀도 2주** — 기존 Grafana→Slack 직송을 건드리지 않고, 별도 webhook contact point + 라우트 사본으로 relay는 `#keiwi-relay-test`에만 게시. 실채널 무영향으로 유실·지연·품질을 관찰.
2. **감시** — external-watchdog에 `/healthz` 등록(감시자를 감시하는 기존 축). relay 다운 = watchdog 경보(별도 경로).
3. **롤백 1파일** — 직송 설정을 `contact-points.fallback.yaml`로 레포 보존. 롤백 = 파일 1개 복사 + 프로비저닝 리로드(<5분). **컷오버 전에 리허설한다**(AC-E3-6).
4. Grafana 내장 Alertmanager는 실패한 통지를 재시도한다 [출처: Alertmanager notification retry — 세부 백오프는 [검증 필요]]. relay 재기동(수 초) 동안의 웹훅은 재시도로 흡수될 것 [가설 — 섀도 기간에 kill 테스트로 실측].

### 3.5 섀도 → 컷오버

| 단계 | 내용 |
|---|---|
| S1 | `contact-points.yaml`에 webhook 수신처 추가 + `notification-policies.yaml`에 **미러 라우트**(continue 매칭으로 기존 라우트 유지 [검증 필요 — Grafana 라우트 트리의 continue 지원 확인, 안 되면 테스트 규칙 전용 라벨로 우회]) → relay는 테스트 채널에만 |
| S2 | 2주 관찰: 유실 0 · 기본 게시 p95<5s · kill 테스트(relay 재기동 중 발화 유실 여부) · 2차 답글 유용성 |
| S3 | 게이트 통과 시 컷오버: slack-infra를 webhook→relay로 교체, relay가 `#keiwi-infra` 게시. fallback 파일·롤백 런북 동시 커밋 |

### 3.6 수용 기준 (AC)

| AC | 검증 | 기대 |
|---|---|---|
| **AC-E3-1** | 유닛: Grafana webhook 픽스처 POST → mock Slack | postMessage 1회 + 200 응답, LLM 미개입 경로 p95 < 2s |
| **AC-E3-2** `[server]` | vLLM(:8003) 정지 상태에서 테스트 발화 | 기본 메시지 정상 도착, 스레드 #2만 생략 — **실패 격리 증명** |
| **AC-E3-3** `[server]` | firing→resolved 시나리오(임계 토글) | 같은 fingerprint → 같은 thread_ts 답글 (sqlite row + Slack 스레드 확인) |
| **AC-E3-4** | 유닛: 동시 2건 알림 픽스처 | 어시스턴트 호출 직렬화, 2차 답글 2건 모두 게시(유실 0), 429 재시도 로그 |
| **AC-E3-5** `[server]` | `curl :8130/healthz` + watchdog 설정 diff | 200 + 등록 확인 |
| **AC-E3-6** `[server]` | 롤백 리허설: relay 정지 → fallback 복사+리로드 → 테스트 발화 | Slack 도착 + 소요 시간 <5분 기록 |
| **AC-E3-7** | 유닛: 2차 답글 payload 검사 | 근거 번호 `[n]` ≥1 포함(어시스턴트 계약 재사용 — evidence는 서버 검증), **원문 로그 라인 미포함**(정규식 게이트) |

### 3.7 위험

- Qwen3-Coder-30B는 조사 에이전트급 다단계 추론에 못 미칠 수 있다 — **자율 ReAct 루프를 만들지 않는다.** 수집은 결정적(E4), LLM은 단발 해석. CNCF 사례의 교훈("런북 제외 규칙이 모델 교체보다 품질 개선")대로 알림별 프리셋 질문·제외 규칙을 콘솔 프리셋 테이블(D2-2)과 공유한다.
- 스레드 답글도 반출이다 — 요약·근거 번호·링크까지만. 원문 로그·경로는 콘솔(Zero Trust 뒤)에서.

---

## 4. E4 — 귀속: "누가·언제·어떤 의도로" (단계적, 프라이버시 우선)

### 4.1 프라이버시 원칙 (불변)

1. **원문 명령어·전체 파일 경로는 Slack에 나가지 않는다.** 나가는 것: 계정명·시각·크기 델타·카테고리·로컬 LLM의 "~ 의도의 명령으로 보인다" 요약.
2. 원문(du 스냅샷·find 결과·COMMAND 라인)은 data05 `/data/alert-relay/` 밖으로 나가지 않는다. 상세 열람은 콘솔(Zero Trust 뒤)로만.
3. 로컬 vLLM이 원문을 보는 것은 허용(egress 0) — 제약은 **반출**이지 로컬 처리가 아니다.
4. 키로깅성 수집(풀 auditd·bash history 수집) 금지. 업계 귀속도 change-event 상관 수준이다 [출처: support.pagerduty.com/main/docs/aiops — Change Events].

### 4.2 0단계 — 파일시스템 증거 + 기존 로그 (데이터가 이미 있다)

수동 30분 추적(df→du→find→소유자)을 그대로 스크립트화한다. 이번 사건 기준으로 이 4단계만으로 "sunakang · 17:45~48 · tensorflow venv 2개(각 1.1G)"가 재현된다 [실측].

#### D4-1. disk-attribution collector (`scripts/collectors/disk-attribution.sh` + 파서)

트리거: relay(DiskUsageHigh·DiskFillPredicted 수신 시) 또는 **CLI 단독 실행**(E3 없이도 유효 — 독립 배포 요건). SSH read-only:

```bash
# 노드별(§0.3 계정): 전부 읽기 전용 명령
df -B1 --output=target,size,used,avail,pcent <mount>
sudo -n du -x -B1 -d 2 /home | sort -rn | head -30          # 사용자별 홈 용량
sudo -n find <mount> -xdev -type f -size +100M -mmin -360 \
  -printf '%s|%TY-%Tm-%TdT%TH:%TM|%u|%p\n' | sort -rn | head -50   # 최근 6h 대형 파일+소유자
```

- **스냅샷 diff**: 실행 결과를 `/data/alert-relay/snapshots/<node>/<ts>.tsv`로 저장. 일일 cron(03:00, data05→SSH) 베이스라인과 diff → "지난 24h 어떤 디렉터리가 얼마나 늘었나". 베이스라인 없는 첫 실행도 `-mmin` 기반 최근 파일로 성립한다.
- **journald COMMAND 검색**(수집기 추가 없이 지금 됨 [실측]): OpenSearch `keiwi-logs-*`에서 해당 노드·발화 전 6h·`message: COMMAND=` — sudo 경유 명령의 유저·PWD·argv. 비sudo 활동은 저널에 없다 — 이 한계가 파일시스템 증거(위)와 상호 보완이고, 파일을 안 남기는 원인(로그 폭주 등)은 OpenSearch 로그 검색이 보완재다. **한계는 스레드 답글에 명시한다**("sudo 경유 + 파일 증거 기반 — 전체가 아님").
- 출력 JSON 스키마: `{node, mount, usage_pct, collected_at, top_dirs[{path_category,owner,bytes,delta_bytes?}], recent_files[{bytes,mtime,owner,category}], sudo_commands[{ts,user,cwd_category,raw}] , partial:bool}` — `raw`는 로컬 전용 필드로 Slack 빌더에 절대 전달 금지.

#### D4-2. redaction·카테고리화 → LLM 의도 요약

1. **결정적 카테고리화**(LLM 이전): 경로 패턴 → 카테고리. `*/venv*|*/site-packages/*`→"Python 환경(패키지명)", `*.ckpt|*.safetensors|*.pt|*.pth`→"모델 가중치", `*.tar|*.zip|데이터 확장자`→"데이터/아카이브", 기타→"대형 파일". 사용자 홈 하위 상세 경로는 카테고리로 대체.
2. **vLLM 의도 요약**(비동기, 실패 시 생략): 입력 = 수집 JSON(원문 포함, 로컬) + 지시("원문 명령·경로를 인용하지 말고 의도만 한 문장으로. 불확실하면 불확실하다고"). 출력 예: *"sunakang이 17:45경 tensorflow 가상환경 2개를 설치한 것으로 보인다(합 ~2.2G) [1][2]"*.
3. **이중 게이트**: LLM 출력에도 redaction 정규식(`/home/[^ ]+/` 경로·`COMMAND=` 패턴) 적용 후 게시 — 환각·지시 불이행 방어.

스레드 답글 #1(결정적, LLM 무관) 예 — 이번 사건이라면:

```
📎 디스크 귀속(자동 수집, read-only) — data04 /
현재 95.2% · /home 303G (jhkim 134G · mhchoi 76G · sunakang 30G)
최근 6h 신규 대형: Python 환경 ×2, 합 2.2G (소유 sunakang, 17:45~17:48)
근거: sudo 이력 + 파일 증거 기반(비sudo 활동은 미포함) · 상세 → 콘솔 링크
```

#### D4-3. data05 폴백 · 선행조건

- data05는 `sudo -n` 실패 [실측] → sudo 구간 생략, 읽을 수 있는 범위 du + node_exporter 파일시스템 메트릭 + OpenSearch로 축소 수집, 출력에 `partial: true` 명시(조용한 실패 금지). 교정은 hardware-ops T0-6 `[server]` **재정의 금지**(fleet-hardening README §4.2.1 정본).

### 4.3 1·2단계 — 게이트 뒤 (기본은 하지 않는다)

| 단계 | 내용 | 게이트 |
|---|---|---|
| 1단계 psacct | 프로세스 계정(CPU 1~2%, **인자 미기록이 프라이버시 장점**) — 비sudo 활동의 "누가 언제 무엇을 실행"까지 | 실사건 **2건 이상**에서 0단계 귀속 불충분 판정 시에만. 충분하면 영구 보류 |
| 2단계 auditd 조사모드/eBPF | 무거움(auditd CPU 5~15%, 100MB~5GB+/일) | psacct로도 불충분 + 성능·프라이버시 근거 ADR 통과 시에만. 상시 활성 금지 — 조사 모드(한시 활성) 한정 |

### 4.4 수용 기준 (AC)

| AC | 검증 | 기대 |
|---|---|---|
| **AC-E4-1** `[server]` | data03·data04 대상 collector 실행 | rc=0 + JSON 스키마 유효(jq 검사) + 전 명령 read-only(스크립트 내 쓰기 명령 grep 게이트: `rm\|mv\|chmod\|>` 0건) |
| **AC-E4-2** `[server]` | 8-03 사건 리플레이(data04, 사건 시간창 픽스처) | recent_files 상위에 사건 실소유자(sunakang)·카테고리 "Python 환경" 도출 — 수동 30분과 동일 결론 |
| **AC-E4-3** | 유닛: 원문 경로·COMMAND 포함 픽스처 → Slack payload 빌더 | 출력에 `/home/<user>/…` 전체 경로 0건 · `COMMAND=` 원문 0건 (정규식 게이트, LLM 출력 경로 포함) |
| **AC-E4-4** | 유닛: vLLM mock 실패 시나리오 | 답글 #1(결정적)만으로 성립 — 의도 요약은 있으면 더하는 것 |
| **AC-E4-5** `[server]` | data05 대상 실행 | rc=0 + `partial: true` 명시 (sudo 없이 죽지 않음) |
| **AC-E4-6** | 코드 검사: Slack 반출 경로 단일 함수 + `raw` 필드 미참조 | 게이트 테스트 통과 — 원문이 `/data/alert-relay/` 밖으로 나가는 경로 부재 |

### 4.5 위험

- 계정명 자체도 개인정보다 — 단, 귀속이 이 기능의 존재 이유(사용자 요구 d)이고 Slack 채널은 운영자 전용이다. 계정명+카테고리+요약까지를 반출 상한으로 명문화(§4.1)하고, 2주 리뷰에서 재점검.
- du는 대형 트리에서 느릴 수 있다 — `-d 2` 제한 + timeout 60s + 캐시(일일 스냅샷 재사용). 알림 스레드 #1 목표는 "수 초", 안 되면 "수집 중" 없이 완료 후 게시(중간 상태 도배 금지).
- find `-mmin -360`은 mtime 조작·과거 파일 이동에 속는다 — 귀속은 "후보 제시"까지이고 단정 표현을 금지한다("~로 보인다" 서술 강제, AC-E4-4의 어조 계약).

---

## 5. 열린 질문

1. E1 [검증 필요] 3건(`stripPort` 파이프·`tz|date` 순서·`urlquery` 가용성)은 UI 미리보기에서 일괄 확정 — T-E1-5에 포함.
2. 라우트 미러링(S1)의 continue 매칭 지원 — 안 되면 섀도는 테스트 전용 알림 규칙(별도 라벨)로 우회.
3. `__panelId__` 부여할 패널 ID — system-v3 대시보드에서 디스크·메모리 패널 확정 후(E2 적용 시).
4. hardware-ops T2-2(`node: dataNN` 스크레이프 라벨)가 적용되면 IP→노드명 매핑(relay·콘솔 정규화)이 단순화된다 — 적용 시 규칙 주석에 단순화 포인트를 남긴다(재정의 금지, 관찰만).

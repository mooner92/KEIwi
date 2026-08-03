# 디스크 귀속 수집기 (E4 0단계)

> 권위: [specs/alert-enrichment/spec.md §4](../../specs/alert-enrichment/spec.md) — 이 폴더는 그 §4.2(0단계)의 구현이다.
> 1·2단계(psacct·auditd)는 [단계 게이트 문서](../../specs/alert-enrichment/attribution-stages.md) 뒤에 있고 **지금 코드가 없다**.

2026-08-03 DiskUsageHigh(data04) 사건에서 사람이 30분 걸려 손으로 한 추적
(`df` → `du` → `find` → 소유자 → journald)을 한 번의 실행으로 재현한다.

## 30초 사용법

```bash
# 사건 그대로 재현(실측 20초 — find 가 대부분)
scripts/collectors/disk-attribution.sh --node data04 --out slack

# 발화 시각 기준으로 창을 옮겨서
scripts/collectors/disk-attribution.sh --node data04 --fired-at 2026-08-03T17:59:00+09:00 --out slack

# 로컬 전용 상세(전체 경로·sudo 원문 포함 — 절대 반출 금지)
scripts/collectors/disk-attribution.sh --node data04 --out json

# 2026-08-03 사건 리플레이(네트워크 불필요)
scripts/collectors/disk-attribution.sh --replay scripts/collectors/fixtures/incident-2026-08-03-data04.raw \
  --out slack --no-llm --no-journal
```

`--out` 4종: `raw`(원문 봉투) · `json`(로컬 상세) · `public`(raw 제거) · `slack`(반출본) · `validate`(스키마 1줄).

## 파일 지도 — 역할이 곧 프라이버시 경계다

| 파일 | 역할 | 원문을 보나 |
|---|---|---|
| `disk-attribution.sh` | 노드에서 **읽기만**(df·du·find). 파괴적 명령·리다이렉션 0건 | 만든다 |
| `attribution_lib.py` | 파싱·카테고리화·스냅샷 diff·OpenSearch 상관·로컬 vLLM 요약 | **본다**(로컬 허용) |
| `attribution_export.py` | Slack 반출본을 만드는 **유일한** 경로 | **모른다**(`raw` 미참조) |
| `infra/alert-relay/keiwi_redaction.py` | 세탁 규칙(정규식·허용목록·하드 거부)의 **정본**. E3 relay 와 **공유**한다 — 사본이 아니다 | 문자열만 |
| `test_attribution.py` | 사건 리플레이·redaction 유닛(25건, 네트워크 불필요) | 픽스처로 본다 |
| `fixtures/incident-2026-08-03-data04.raw` | 2026-08-03 19:55 KST data04 **실수집** 원문 | 담고 있다 ⚠️ |

> ⚠️ **픽스처는 §4.1-2의 경계 사례다 — 사람 판단이 필요하다.** Slack 반출은 아니지만
> 레포에 계정명 + 전체 경로(연구 프로젝트 디렉터리명 포함)가 커밋된다. 원문이 실제로
> 들어 있어야 redaction 게이트의 역증명이 성립하므로 합성으로 바꾸면 게이트가 허수아비를
> 때린다. 허용하지 않기로 하면 홈 하위 프로젝트명만 치환하면 되고 **유닛 25건은 그대로 통과**한다
> (파일 머리말에 절차를 적어 뒀다).

## 반출 상한 (spec §4.1 불변)

나가는 것: **계정명 · 시각 · 크기 · 카테고리 · "~로 보인다" 요약 · 콘솔 링크**
나가지 않는 것: **전체 파일 경로 · sudo `COMMAND=` 원문 · 홈 하위 디렉터리 이름**

경계를 지키는 장치가 셋이다 — ① `public_view()`가 `raw` 키를 재귀 제거,
② `redact_text()`가 LLM 출력에 재적용(모델이 지시를 어겨도 지운다),
③ `assert_no_leak()`가 게시 직전 하드 규칙을 걸고 위반이면 **예외로 멈춘다**(조용히 통과 없음).
게이트 `scripts/gates/check-attribution-redaction.sh`가 이 셋을 정적·런타임·변이 검사로 확인한다.

②③의 구현은 `infra/alert-relay/keiwi_redaction.py` **한 곳**에 있고 E3 relay 가 같은 객체를
쓴다[2026-08-04]. 각자 정규식을 들고 있던 동안 relay 쪽이 URL 우회·`~/`·허용목록 밖 절대경로·
하드 거부 부재 4종에서 더 약했고, 그 비대칭 자체가 결함이었다 — 같은 위협이면 같은 방어다.
그래서 이 모듈은 배포에서도 두 컴포넌트가 **같은 파일**을 본다(`/opt/keiwi/alert-relay/`).

## 결과 예 (2026-08-03 data04 실행)

```
📎 디스크 귀속(자동 수집, read-only) — data04 /
현재 95.0% · /home 302.9G (user2 133.4G · user5 75.0G · user6 29.6G · user1 23.2G)
최근 6h 변경된 대형 파일(소유·카테고리별, 시각은 노드 로컬 UTC+9):
  · Python 환경 ×4, 합 14.1G (소유 user6, 17:42~17:51)
  · 데이터/아카이브 ×1, 합 6.6G (소유 user6, 17:40~17:40)
sudo 이력 13건(시간창 내) · 근거: 파일 증거 + sudo 로그
추정: user6 계정이 17:40경 대용량 머신러닝 라이브러리를 설치한 것으로 보인다(합 5.2G).
한계: sudo 경유 + 파일 증거 기반 — 비sudo 활동은 미포함(0단계 한계) · …
상세(원문은 data05·콘솔에만) → <…/incidents?alert=DiskUsageHigh&node=data04&mount=%2F&from=now-360m|콘솔 분석>
```

## 알아둘 함정 (전부 실측)

1. **플릿 타임존이 균일하지 않다.** data04=KST(+09:00), data03·data05=UTC(+00:00).
   `find` 의 mtime 은 노드 로컬 벽시계라 창 비교를 노드 오프셋으로 옮겨서 한다.
   Slack 표기에도 `시각은 노드 로컬 UTC±N` 을 붙인다 — 안 붙이면 9시간을 잘못 읽는다.
2. **data05는 `sudo -n` 이 안 된다**(sudoers 마지막 규칙). 비특권으로 축소 수집하고
   `partial: true` 를 명시한다 — 죽지 않는다. 교정은 hardware-ops T0-6 소관(**여기서 재정의하지 않는다**).
3. **stderr 를 숨기지 않는다.** 리다이렉션 금지 규약(AC-E4-1) 때문이기도 하고, 조용한 실패를
   만들지 않기 위해서다. data05 비특권 실행은 `Permission denied` 가 150줄 넘게 나온다 —
   stdout(보고서)은 깨끗하므로 **호출자가** 필요하면 stderr 를 버려라(수집기는 안 버린다).
   같은 이유로 **인자 오류 메시지도 stdout 으로** 나간다 — 파싱 전에 종료코드를 먼저 봐라.
4. **`-mmin` 은 "변경된" 파일이지 "새로 생긴" 파일이 아니다.** 베이스라인이 없으면 합계는
   증가량이 아니라 "창 안에 mtime 이 갱신된 파일의 총 크기"다. 출력의 `limits[]` 가 이걸 말한다.
   `keiwi-disk-baseline.timer`(03:00)가 쌓이면 `delta_bytes` 로 대체된다.
5. **비sudo 활동은 journald 에 없다.** 2026-08-03 사건이 정확히 그 경우였다 —
   user6 의 venv 설치는 sudo 를 안 탔고, 귀속의 근거는 100% 파일시스템 증거였다.
   이 한계는 스레드 답글에 항상 함께 나간다.

## 배포 (사람이 한다 — 헌장 §11)

```bash
sudo install -m 0644 infra/collectors/keiwi-disk-baseline.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now keiwi-disk-baseline.timer
```

## 검증

```bash
python3 scripts/collectors/test_attribution.py           # 25건, 네트워크 불필요
bash scripts/gates/check-collector-readonly.sh           # AC-E4-1
bash scripts/gates/check-attribution-redaction.sh        # AC-E4-3·E4-6
```

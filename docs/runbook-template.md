# 최소 골격 — 알림 런북 30초 템플릿

> 새 알림을 만들면 **같은 PR에서** 이 골격을 복사해 `docs/runbooks/<id>.md`로 채운다.
> 30초면 채울 수 있게 만든 이유는, 런북 작성이 부담이면 사람들은 대신 **runbook_url을 아무
> 문서에나 붙이기** 때문이다(그 결과가 이 스펙이 고친 9건 중 8건이다).
>
> ⚠️ **이 파일은 `docs/runbooks/` 밖에 둔다.** 안에 두면 게이트(`check-runbooks.sh`)와
> 콘솔 어시스턴트가 이것을 실제 런북으로 인덱싱한다.

## 규약 (게이트가 검사하는 것)

| 규칙 | 요구 |
| --- | --- |
| `id` | **파일 stem과 정확히 일치**(`gpu-xid.md` → `id: gpu-xid`) |
| `kind` | `alert` \| `procedure` \| `incident`. **생략 시 `alert`로 간주**된다 |
| `category` | 전 문서 필수. 로그 category 어휘와 맞춘다: `gpu`·`web`·`infra`·`system`·`user-session` |
| `alerts`·`severity` | `kind: alert`에만 필수. 알림이 아직 없으면 `alerts: []`(게이트는 **WARN**, 통과) |
| **`tier`** | 전 문서 필수. `0`~`3` — 이 런북의 `actions`가 도달 가능한 **최대** 자율 레벨. **모르겠으면 0**을 적는다(올리는 것은 언제든 되지만, 잘못 올린 것은 사고다) |
| **`actions`** | 전 문서 필수(빈 목록 허용). 항목마다 6키: `id`(kebab·유일)·`title`·`risk`(`low`\|`medium`\|`high`)·`reversible`·`idempotent`·`command`. 조치가 없으면 **`actions: []` + `tier: 0`**(게이트 A8) |
| **tier ↔ risk 정합** | `risk: high`나 `reversible: false`가 하나라도 있으면 **tier ≤ 1**, `idempotent: false`면 tier ≤ 2 (게이트 A5). 위험 조치를 숨기지 말고 **정직하게 적어라** — 게이트가 상한을 알아서 내린다 |
| **명령 근거성** | `command`는 그 런북 **본문 코드블록에 실재**해야 한다(게이트 A7). 화이트리스트는 문서의 사본이지 별도 진실이 아니다 |
| `last_verified` | `actions`가 비어 있지 않으면 **필수**(게이트 A10). 180일 초과면 WARN |
| 경로 | 알림의 `runbook_url`은 `https://github.com/mooner92/KEIwi/blob/main/docs/runbooks/<id>.md` |
| **`<…>` 자리표시자** | **따옴표 안에 둔다** — `ssh -p <SSH_PORT> "<user>@<ip>"`. 벗기면 bash가 `<`를 리다이렉션으로 파싱해 게이트 R10(`bash -n`)이 실패한다 |
| ` ```bash ` 블록 | **블록마다 독립적으로** `bash -n`을 통과해야 한다(블록 간 변수 이어받기 금지) |
| `docs/README.md` | 런북 표에 한 줄 추가(게이트 R9) |

## 골격 (아래를 복사)

```markdown
---
id: <파일-stem>
kind: alert
alerts: [<AlertName>]
service: <익스포터·서비스명>
category: infra
severity: warning
last_verified: <YYYY-MM-DD>
tier: 0                       # 확신이 없으면 0. 올리려면 아래 actions가 4조건을 만족해야 한다
actions:                      # L1 어시스턴트가 **고를 수 있는 것의 전부**. 없으면 []
  - id: <kebab-조치-id>
    title: <사람이 읽는 조치 이름>
    risk: low                 # low | medium | high — 파괴 동사는 반드시 high
    reversible: true          # 되돌릴 수 있는가
    idempotent: true          # 두 번 돌려도 같은가(§16)
    command: >-               # 본문 코드블록에 **그대로 있는** 명령(게이트 A7)
      <정확한 실행 명령>
---

# 런북 · <사람이 읽는 제목> (<AlertName>)

> 한 줄 요약 — 이 알림이 뜨면 실제로 무엇이 일어난 것인가.

## 1. 이 알림이 말하는 것 / 말하지 않는 것
- 발화식과 지속 시간(`for`), 그리고 그 식이 **보지 못하는 것**.
- 임계 근거와 현재 여유(실측값). 근거 없는 임계는 다음 사람이 마음대로 올린다.

## 2. 30초 판별 (복붙 가능한 명령만)
- Prometheus/OpenSearch 한 줄 쿼리 + **판독표**(무엇이 보이면 무슨 뜻인가).
- 함정이 있으면 여기서 명시한다(라벨 부재, service=unknown, 시간창 등).

## 3. 원인 분기표
| 관찰 | 1차 판정 | 첫 조치 |
| --- | --- | --- |

## 4. 조치 (파괴 강도 순 · 소유자 확인 게이트)
1. 소유자 확인 — 연구 잡을 죽이기 전에 통보한다(헌장 §11).
2. 되돌릴 수 있는 조치부터.
3. 파괴적 조치는 마지막, 그리고 사람이.
**하지 말 것**: (특히 임계를 올려 알림을 끄는 것)

## 5. 사후·재발방지
- 판정 근거 한 줄을 남긴다 — 다음 사람이 같은 조사를 반복하지 않게.
- 반복되면 임계가 아니라 **구조**를 고친다.

## 관련
- 관련 런북 · 스펙 링크
```

## 채우기 전 확인

1. **그 알림이 정말 새 런북을 필요로 하나?** 조치 경로가 같은 알림은 한 파일로 묶는다
   (예: `MemoryLow`+`OomKillOccurred` → `memory-pressure.md`). **런북 수가 곧 유지보수 부채다.**
2. **실측값을 넣었나?** "충분한 여유가 있다"가 아니라 "30일 최대 90°C, 여유 2°C".
3. **명령을 실제로 돌려봤나?** 복붙해서 안 돌아가는 명령은 없느니만 못하다.

## 검사

```bash
bash scripts/gates/check-runbooks.sh          # R1~R11 (exit 0 통과 / 1 위반 / 2 환경부족)
```

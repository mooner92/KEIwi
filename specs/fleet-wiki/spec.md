# 플릿 지식 위키(fleet-wiki) — 서버·계정·프로젝트 문서 그래프

> 상태: **초안 (사용자 리뷰 대기 — §8 Q1~Q5 결정 필요)** · 2026-08-13
> 권위: [Constitution.md](../../Constitution.md) §7·§11·§13 → 이 spec.
> 발단: 사용자 아이디어 — *"열린 포트를 역추적해 디렉터리·git repo를 찾고, 서버·계정·프로젝트
> 단위 md 문서 그래프(LLM wiki)를 만들자. 서비스 탭 고도화이자 이상탐지·정합성의 기반."*

---

## 1. 목적 — 서비스 탭이 못 답하는 질문

서비스 탭(service-map v2.1)은 **"지금 무엇이 떠 있나"**(실시간 사실)를 답한다. 그러나 운영에서
실제로 던지는 질문은 그 다음이다:

- 이 포트의 프로세스는 **무슨 프로젝트**인가? 코드가 어디 살고, git은 어디에 연결돼 있나?
- 이 계정은 이 서버에서 **무엇을 몇 개** 운영 중인가? 마지막으로 손댄 게 언제인가?
- 새로 열린 이 포트는 **아는 것인가 모르는 것인가?** (이상탐지의 1차 질문)

지금 이 질문들의 답은 관리자의 기억과 `ss`/`ls` 수작업에 있다. fleet-wiki는 그 답을
**서버 → 계정 → 프로젝트 3계층 md 문서 그래프**로 만들고 콘솔에서 서빙한다.

## 2. 문서 모델 — 3계층 + 정형 frontmatter

문서 규약은 검증된 LLM-wiki 패턴을 차용한다: **YAML frontmatter(기계용) + 본문(사람용) +
`[[위키링크]]`(그래프 간선) + 자동 색인 + lint**. 그래프의 간선은 임베딩이 아니라 명시적
링크다 — 결정론적으로 파싱·검증 가능하다.

```
servers/data03.md          ← 허브 노드(연결점 최다): 하드웨어·역할·운영 중 서비스 전체
accounts/data03--user2.md  ← 계정 노드: 권한 수준·운영 서비스 목록·활성 수·경로·최종 활동
projects/data03--user2--<project>.md ← 잎 노드: 포트·유닛·경로·git remote·README 요약
```

frontmatter는 **수집기가 관찰한 사실만** 담는다(사람 편집 금지 — 재생성 시 덮어씀).
본문 하단에 `<!-- manual -->` 구획을 두어 사람 주석은 보존한다.

```yaml
# projects/data03--user2--example.md
---
kind: project
node: data03
owner: user2            # OS 계정 (콘솔 표시용 — 외부 반출 없음)
ports: [8188]
unit: null              # systemd 유닛이면 이름, 세션 기동이면 null(= tmux 취약 신호)
cwd: /home/user2/…      # /proc/<pid>/cwd 실측
git_remote: <url|null>
git_head: <sha> (<날짜>)
readme: true
last_seen: 2026-08-13T02:00Z
first_seen: 2026-07-01T…
---
[[data03]] · [[data03--user2]]
## 무엇인가 (README 1줄 + LLM 요약은 P3)
```

## 3. 수집 파이프라인 — "포트에서 거꾸로"

핵심 아이디어 그대로: **열린 포트 → PID → cwd → git → README**. 기존 자산 위에 얹는다 —
port-exporter가 이미 포트↔프로세스↔PID↔소유자를 갖고 있고(ownership-attribution v1),
빠진 것은 **cwd·git 역추적**뿐이다.

| 단계 | 무엇 | 방식 |
|---|---|---|
| ① scout 수집기 | 노드별, **읽기 전용**: `ss -tlnp` → `/proc/<pid>/{cwd,exe,cmdline}` → uid→계정 → `git -C <cwd> remote/HEAD/log -1` → README·docs 목록 | port-exporter 패턴 복제(stdlib py, root, systemd timer 1h). **메트릭이 아니라 JSON 문서 출력** — 경로·URL은 Prometheus 라벨 카디널리티에 부적합 |
| ② 중앙화 | 노드별 JSON을 data05로 | Q2(§8) — 후보: 기존 SSH 경로로 pull(터널 재사용) |
| ③ 생성기 | JSON → md 3계층. **결정론·멱등**(내용 diff 시에만 재작성, `<!-- manual -->` 보존). 색인·고아·깨진 링크 lint 포함 | data05, cron |
| ④ LLM 보강 | README+하위 docs → 프로젝트 "무엇인가" 요약 | **P3로 미룸**(measure-first) — 로컬 LLM만, 현재 qwen3.5 한계는 Q5 |
| ⑤ 그래프 | `[[링크]]` 결정론 파싱 → 노드·간선 JSON → `/graph`와 같은 임베드 문법으로 `/wiki` 그래프 뷰 | graphify 문서 모드는 LLM이 필요하므로 쓰지 않는다 — 위키는 간선이 이미 명시적이다 |

## 4. 저장 위치 — 레포에 넣을 수 없다 (설계 제약 1호)

위키 내용은 **실계정·홈 경로·프로젝트명**이다. 이 레포는 PUBLIC이고 게이트(P2·P3)가 정확히
그것들을 차단한다 — 즉 **위키 산출물은 이 레포에 커밋 불가능**하다(게이트가 막는 게 옳다).

v1: `/data/keiwi/wiki/`(data05, 레포 밖) + 콘솔이 파일시스템에서 직접 읽기(코드 그래프
`CODE_GRAPH_PATH`와 동일 패턴). 이력·백업이 필요하면 **사설 원격 없는 로컬 git**으로
버전만 남긴다. 사설 GitHub repo 승격은 Q1.

## 5. 콘솔 통합 — 서비스 탭 고도화

- **포트 행 → 위키 링크**: `keiwi_listening_port_info`의 (node, port)가 위키 프로젝트
  문서와 매칭되면 행에서 문서로 진입. 매칭 실패면 —
- **"미등록" 배지 = 이상탐지 신호**: 위키에 없는 리스닝 포트는 형태로 드러낸다(점선 배지).
  "새 포트가 열렸는데 아무 문서도 없다"가 지금은 침묵이지만, 위키가 있으면 **기준선 대비
  diff**가 된다. orphan-port-holder 런북·alert-relay 보강의 컨텍스트 소스로도 쓴다.
- **`/wiki` 페이지**: 그래프 뷰(서버=허브) + 문서 뷰. 서버 렌더 — 클라이언트 상태에 걸지
  않는다(탭·테마 사고의 교훈).
- 어시스턴트: 위키 md를 LightRAG 코퍼스에 편입(P3) — "이 포트 뭐야?"에 문서 근거로 답한다.

## 6. 무엇을 흡수·대체하나

- **sre-addons #5(경량 CMDB)**: owner·purpose 필드를 inventory에 넣자던 안 — fleet-wiki가
  상위 호환으로 흡수한다(inventory는 노드 SoT로 유지, 계정·프로젝트는 위키가 소유).
- 경로·문서 규칙(사용자 언급): 연구자에게 규약을 **강제하지 않는다** — 위키는 "관찰된
  사실"을 적고, README가 있으면 인용한다. 표준 frontmatter는 **권장 템플릿**으로만 제공
  (지키면 위키 품질이 올라가는 인센티브 구조).

## 7. 단계 (각 단계가 독립 가치)

| 단계 | 내용 | 크기 |
|---|---|---|
| **P0** | scout 수집기 + JSON 스키마 + data05 1노드 PoC(§11: 배포는 사람) | S |
| **P1** | 위키 생성기(3계층 md·색인·lint) + 콘솔 `/wiki` 문서 뷰 | M |
| **P2** | 서비스 탭 포트 행 링크 + **미등록 배지** + 그래프 뷰 | M |
| **P3** | LLM 요약(README+docs) + LightRAG 편입 | M |
| **P4** | 활동 고도화 — 최종 수정·세션 연결·토큰 사용량(Q3 결정 후에만) | L |

## 8. 열린 질문 (사용자 결정)

- **Q1 저장·이력**: 로컬 git(v1 제안)으로 충분한가, 사설 GitHub repo로 승격하나?
- **Q2 중앙화 경로**: data05가 SSH pull(기존 터널·키 재사용, 제안) vs 노드가 push?
- **Q3 세션·토큰 추적 범위**: 사용자가 언급한 "연결된 세션, claude token usage"는 **개인
  활동 감시로 읽힐 수 있다.** 어디까지가 운영 정보이고 어디부터가 감시인가 — 대상자 합의
  없이 진행하지 않는 것을 제안(수집은 기술적으로 쉬우나 신뢰 비용이 크다).
- **Q4 README 규약**: 권장 템플릿 배포 방식(공지? 스캐폴드 스크립트?).
- **Q5 요약 LLM**: 현재 qwen3.5는 reasoning 전용 경로 문제(lib/vllm.ts) — P3 시점의 모델
  선정과 함께 결정(model-ops Q와 합류).

## 9. 수용 기준 (기계 검증, P0~P2 기준)

| # | 검증 |
|---|---|
| AC-W-1 | scout JSON에 리스닝 포트 전건의 pid·owner·cwd 존재(권한 실패는 `cwd: null` + 사유 — 침묵 금지) |
| AC-W-2 | git 프로젝트면 remote·HEAD 존재, 아니면 명시적 null(추측 금지) |
| AC-W-3 | 생성기 멱등 — 같은 JSON 2회 실행 시 mtime 외 diff 0 · `<!-- manual -->` 구획 보존 |
| AC-W-4 | lint — 고아 문서·깨진 `[[링크]]` 0 (색인 자동 갱신) |
| AC-W-5 | 서비스 탭: 위키 매칭 포트는 링크, 비매칭은 "미등록" 배지(둘 다 실측 스크린샷) |
| AC-W-6 | 레포 게이트 — 위키 산출물이 레포 트리에 존재하지 않음(public-safety 통과 유지) |

## 10. 의존 관계

[service-map](../service-map/spec.md)(포트 데이터) · [ownership-attribution](../ownership-attribution/spec.md)(owner 라벨) ·
[model-ops](../model-ops/spec.md)(GPU 워크로드 문서화 합류점) · sre-addons #5(흡수) ·
docs/graphify.md(`/graph` 임베드 문법 재사용) · 런북 orphan-port-holder(미등록 신호 소비자)

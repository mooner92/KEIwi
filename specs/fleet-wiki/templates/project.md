<!--
  fleet-wiki 프로젝트 정리본 템플릿 (내부 전용 — 연구자 배포용 아님, spec §5.6/Q4)

  사용 주체: ① 위키 생성기(frontmatter·관찰 사실 절 — 결정론) ② 칸반 요약 워커("무엇인가"
  절만 — LLM). 자리표시자 {{...}}는 생성기가 scout JSON 값으로 치환한다.
  이 파일 자체는 자리표시자만 담으므로 PUBLIC 레포에 안전하다 — **실값이 채워진 산출물은
  절대 레포에 커밋하지 않는다**(spec §4, AC-W-6).
-->
---
kind: project
node: {{node}}
owner: {{owner}}
ports: [{{ports}}]
proto: [{{protos}}]
unit: {{unit_or_null}}          # systemd 유닛명. null = 세션 기동(재부팅에 취약 — 신호다)
cwd: {{cwd_or_null}}            # /proc/<pid>/cwd 실측. 접근 실패 시 null + reason
cwd_reason: {{null_or_reason}}  # cwd가 null일 때만 — "권한 없음" 등. 침묵 금지(AC-W-1)
git_remote: {{url_or_null}}     # 추측 금지 — git이 아니면 명시적 null(AC-W-2)
git_head: {{sha_and_date_or_null}}
readme: {{true_or_false}}
docs: [{{doc_paths}}]           # README가 가리키는 하위 문서(상대경로)
first_seen: {{iso8601}}
last_seen: {{iso8601}}
last_activity: {{iso8601_or_null}}  # cwd 내 최근 mtime — "살아있는 프로젝트인가"
---

[[{{node}}]] · [[{{node}}--{{owner}}]]

# {{project_name}}

## 무엇인가
<!-- llm-summary:start — 요약 워커만 이 구획을 쓴다. README·docs·파일 트리 근거로 3~6문장:
     ① 무슨 목적의 프로젝트인가 ② 어떻게 기동되나(유닛/세션·포트) ③ 무엇에 의존하나
     (GPU·다른 서비스·외부 API). 근거 없는 추측 금지 — 모르면 "코드에서 확인 불가"라고 쓴다. -->
{{summary_or_pending}}
<!-- llm-summary:end -->

## 관찰된 사실 (생성기 소유 — 수집 시점 실측)
| 항목 | 값 |
|---|---|
| 리스닝 | {{port_proto_process_rows}} |
| 기동 방식 | {{unit_or_session}} |
| 코드 위치 | `{{cwd}}` |
| git | {{git_remote_or_없음}} |
| 최근 활동 | {{last_activity}} |

## 이력·메모
<!-- manual — 이 구획만 사람이 편집한다. 재생성 시에도 보존된다(AC-W-3). -->

<!--
  fleet-wiki 계정 정리본 템플릿 (내부 전용 — spec §5.6/Q4)
  생성기가 scout JSON을 노드×계정으로 집계해 치환한다. Q3(세션·토큰 추적)는 보류 확정 —
  이 템플릿에 세션·토큰 필드를 추가하지 않는다(추가하려면 spec §8 Q3의 선행 조건부터).
-->
---
kind: account
node: {{node}}
account: {{owner}}
privilege: {{sudo_summary}}     # 예: "sudo 전체" / "sudo 없음" — sudoers 실측(읽기 전용)
projects_total: {{n}}
projects_active: {{n_active}}   # last_activity 30일 이내
last_activity: {{iso8601_or_null}}
---

[[{{node}}]]

# {{node}} · {{owner}}

## 운영 중인 프로젝트
<!-- 생성기 소유 — 프로젝트 문서로의 링크 목록. 활성/비활성 구분 표기 -->
| 프로젝트 | 포트 | 활성 | 문서 |
|---|---|---|---|
| {{name}} | {{ports}} | {{active_badge}} | [[{{node}}--{{owner}}--{{name}}]] |

## 관찰된 사실
- 홈 사용량: {{home_size_or_null}} (디스크 통보 폼의 상위 사용과 같은 소스)
- 상주 세션: {{tmux_count_or_null}}개 <!-- 세션 "존재 수"까지만 — 내용 추적은 Q3 보류 -->

## 이력·메모
<!-- manual -->

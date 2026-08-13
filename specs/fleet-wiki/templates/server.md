<!--
  fleet-wiki 서버 정리본 템플릿 (내부 전용 — spec §5.6/Q4)
  허브 노드 — 그래프에서 연결점이 가장 많다. 하드웨어 사실은 inventory.yaml(SoT)을 인용만
  한다(재정의 금지 — 두 곳이 다르면 어느 쪽이 진실인지 모르게 된다).
-->
---
kind: server
node: {{node}}
inventory_ref: docs/inventory.yaml   # 하드웨어·exporter SoT — 여기 값 복사 금지
accounts: {{n_accounts}}
projects: {{n_projects}}
listening_ports: {{n_ports}}
unregistered_ports: {{n_unmatched}}  # 위키에 문서 없는 포트 수 — 이상탐지 1차 신호(spec §5)
last_scan: {{iso8601}}
---

# {{node}}

## 무엇인가
<!-- llm-summary:start — 이 서버의 역할 한 단락(계정·프로젝트 구성에서 도출) -->
{{summary_or_pending}}
<!-- llm-summary:end -->

## 계정
| 계정 | 프로젝트 | 활성 | 문서 |
|---|---|---|---|
| {{owner}} | {{n}} | {{n_active}} | [[{{node}}--{{owner}}]] |

## 미등록 포트 (문서 없음 — 확인 필요)
<!-- 생성기 소유. 비어 있는 것이 정상 상태다 — 여기 항목이 남아 있으면 조사 대상 -->
| 포트 | 프로세스 | 소유자 | 첫 관찰 |
|---|---|---|---|
| {{port}} | {{process}} | {{owner}} | {{first_seen}} |

## 이력·메모
<!-- manual -->

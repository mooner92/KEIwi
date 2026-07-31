---
name: "버그 리포트"
about: "관제 스택·콘솔·수집 파이프라인의 오작동을 보고합니다 (KEI 내부 전용)"
title: "fix: "
labels: ["bug"]
assignees: ["mooner92"]
---

<!-- KEIwi 내부 전용. 재현 가능한 사실만 적는다 — "잘 안 됨" 대신 "이 명령이 이 출력을 낸다"(헌장 §9). -->

## 증상

<!-- 무엇이 잘못 보이는가. 화면·알림·로그에서 실제로 관찰된 것. -->

## 재현 절차

1.
2.
3.

## 기대 결과

<!-- 정상이라면 무엇이 나와야 하는가. -->

## 실측 결과

<!-- 실제로 나온 것. 관련 curl/명령과 그 출력을 그대로 붙인다. -->

```bash
# 예: 콘솔 헬스
curl -s http://192.168.1.105:3105/api/health
# 예: Prometheus 타깃 up 여부
curl -s 'http://192.168.1.105:9090/api/v1/query?query=up'
# 예: 로그 수집(OpenSearch) 최근 인입 확인
```

```text
# 위 명령의 출력
```

## 영향 노드

> [!NOTE]
> 플릿 단일 기준: [`docs/inventory.yaml`](../../docs/inventory.yaml).

- [ ] data01 (192.168.1.101 · Ubuntu 16.04 · Tesla M4)
- [ ] data02 (192.168.1.102 · Windows)
- [ ] data03 (192.168.1.103 · Ubuntu · Quadro RTX 6000 x2)
- [ ] data04 (192.168.1.104 · Ubuntu · Quadro RTX 6000 x2)
- [ ] data05 (192.168.1.105 · Ubuntu · 관제 스택 호스트 · A40 x2)
- [ ] 노드 무관(콘솔/스택 자체)

## 영향 범위 · 긴급도

- **영향**: <!-- 관제 불가 / 일부 패널 오류 / 알림 노이즈 / 표시상 문제 ... -->
- **긴급도**: <!-- 라이브 관제 중단(높음) / 저하(중간) / 사소(낮음) -->
- **관련 런북**: <!-- 있으면 링크. 예: docs/runbooks/log-ingestion-stopped.md -->

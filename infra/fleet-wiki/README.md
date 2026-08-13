# fleet-wiki — scout 수집기 (P0)

> 정본: [specs/fleet-wiki/spec.md](../../specs/fleet-wiki/spec.md). 이 디렉터리는 §8 Q1 결정
> (v1은 KEIwi 안, 분리 가능하게)에 따라 **fleet-wiki 코드 전체를 격리**한다 — 분리 시 이
> 디렉터리째 들어낸다.

## 무엇을 하나

열린 포트에서 거꾸로 프로젝트를 찾는다: `ss -tulnp` → `/proc/<pid>/{cwd,cgroup,status}` →
`.git` **파일 직접 읽기**(subprocess 없음) → README·docs 목록 → JSON 스냅샷 한 파일.

- **read-only 규율**: 노드에서는 읽기만. 쓰기는 `write_snapshot()` 한 함수의 원자적
  tmp+rename뿐(E4 수집기와 같은 계약).
- **정직성**: cwd를 못 읽으면 null + 사유(`권한 없음(root 아님)` 등), 스냅샷에
  `partial`·`unresolved_listeners` 명시 — "측정 못 함"이 "없음"으로 보이지 않는다(AC-W-1).
- **⚠️ 자격증명 제거(실측 사건)**: 2026-08-13 data05 PoC에서 한 프로젝트의 remote URL에
  **GitHub PAT가 평문으로** 박혀 있는 것을 수집기가 그대로 실어올렸다. `redact_remote_url()`이
  http(s) userinfo를 무조건 벗긴다(회귀 테스트 고정). **수집 경로에 새 필드를 추가할 때는
  "이 값에 비밀이 섞일 수 있는가"를 먼저 물을 것.**

## 산출 스키마 (schema=1)

```jsonc
{
  "schema": 1, "node": "dataNN", "collected_at": "ISO8601",
  "partial": true,               // 미해결 리스너 존재 여부(비root·경합)
  "unresolved_listeners": 31,
  "listeners": [{ "proto","port","process","pid","owner","cwd","cwd_reason" }],
  "projects":  [{ "cwd","name","owners","ports","unit",       // unit null = 세션 기동(취약 신호)
                  "git_remote",                               // 자격증명 제거됨
                  "git_head","git_head_ref_mtime",            // mtime은 커밋일 아님(근사)
                  "readme","docs","last_activity" }]
}
```

## PoC 실행 (아무 노드, 비root 가능)

```bash
KEIWI_SCOUT_NODE=data05 KEIWI_SCOUT_OUT=/tmp/scout.json python3 scout.py
python3 -m unittest test_scout   # 14 tests
```

실측(2026-08-13, data05 비root): 리스너 40(미해결 31 — 타 계정), 프로젝트 5건 역추적
(systemd 유닛·git remote·README 판별 포함). root로 돌리면 미해결이 0에 수렴한다.

## 배포 (사람, §11)

```bash
sudo mkdir -p /opt/keiwi/fleet-wiki /var/lib/keiwi-scout
sudo cp scout.py /opt/keiwi/fleet-wiki/
sudo cp keiwi-scout.service keiwi-scout.timer /etc/systemd/system/
sudo sed -i 's/CHANGEME/dataNN/' /etc/systemd/system/keiwi-scout.service   # 노드 id
sudo systemctl daemon-reload && sudo systemctl enable --now keiwi-scout.timer
```

중앙화(P1): data05가 각 노드의 `/var/lib/keiwi-scout/scout.json`을 **SSH pull**(spec Q2 확정)
→ 생성기가 `/data/keiwi/wiki/` md로 변환. 콘솔 `/wiki`는 P1.

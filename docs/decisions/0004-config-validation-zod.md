# 0004. 환경설정 · 스키마 검증 — zod

- 상태: 채택
- 날짜: 2026-06-22

## 맥락

헌장 §8은 **모든 의존성 선택을 ADR로** 기록하라고 한다. 프롬프트 §3.2는 `config/env.ts`에서 **zod로 env를 검증**(누락 시 어떤 키가 빠졌는지 명시하며 fail-fast throw)하라고 명시하므로, zod 의존성의 근거를 여기 남긴다. 같은 라이브러리를 [0003](0003-inventory-yaml-parser.md)의 inventory 스키마 검증에도 재사용한다.

## 결정

- **`zod`(v4.x)**를 두 곳에 쓴다:
  1. **env 검증** — `config/env.ts`가 `GRAFANA_URL`, `GRAFANA_DASHBOARD_UID`, `PROMETHEUS_URL`, `INVENTORY_PATH`, `PORT`를 한 곳에서 검증. 누락/형식 오류 시 빠진 키를 명시하며 **fail-fast throw**. 컴포넌트·route handler는 `process.env`를 직접 읽지 않고 이 모듈을 통한다.
  2. **inventory 스키마 검증** — `yaml` 파싱 결과를 노드 스키마로 검증([0003](0003-inventory-yaml-parser.md)).
- 서버 전용 경계 유지: `PROMETHEUS_URL` 등 서버 전용 값은 클라이언트 번들에 노출되지 않게 한다(spec §보강 검증).

## 고려한 대안

- **수동 검증(`if (!process.env.X) throw …`)** — 의존성 0이지만 반복적·누락 위험·에러 메시지 비일관. env 키가 늘수록 비용↑. → 기각.
- **valibot / @t3-oss/env** — valibot은 더 가볍지만 §6(보편성)에서 zod가 압도적으로 널리 쓰이고 학습데이터·생태계가 두텁다. t3-env은 추상화 추가. → 기각.
- **타입만(TypeScript)으로 충분** — 타입은 런타임 env/파일을 검증하지 못한다(빌드 후 사라짐). 런타임 fail-fast 필요. → 기각.

## 결과

- 안정·보편 의존성 1개(`zod`)로 env·inventory 두 경계를 일관 검증.
- 잘못된 배포 설정(빠진 env)·깨진 inventory를 **부팅/빌드 시점에 즉시** 실패시켜 런타임 미스터리 제거.
- 후속: `types/fleet.ts`의 타입을 zod 스키마에서 `z.infer`로 파생해 단일 소스 유지.

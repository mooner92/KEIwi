# 0002. Grafana 임베드 방식

- 상태: 채택
- 날짜: 2026-06-22

## 맥락

Overview 페이지는 시스템·GPU 메트릭 대시보드를 보여줘야 한다. 헌장 §2는 **단일 콘솔 = Grafana**이며 **Grafana 재구현을 금지**한다. 프롬프트 §4.3은 `GRAFANA_URL` + `GRAFANA_DASHBOARD_UID`로 임베드 URL을 만들어 표시하라고 한다. 인증은 헌장 §14에 따라 **Cloudflare Access**가 담당한다(콘솔은 자체 인증 없음).

## 결정

- **`<iframe>`으로 Grafana 대시보드를 임베드**한다. 임베드 URL은 `${GRAFANA_URL}/d/${GRAFANA_DASHBOARD_UID}` 형태로 구성하고, Grafana 크롬을 줄이기 위해 `?kiosk` 파라미터를 붙인다(선택적으로 `&theme=`·`&from=`·`&to=` 등 표시 옵션).
- URL 조립은 전용 컴포넌트 `components/grafana/grafana-embed.tsx`에서 수행하고, env 값은 `config/env.ts`(zod 검증)를 통해서만 읽는다.
- `GRAFANA_URL`은 iframe `src`로 클라이언트 HTML에 노출된다 — 내부망·Cloudflare Access 뒤이므로 허용(헌장 §13, 프롬프트 §3.2). 실값은 `.env.local`에서만 주입.
- 콘솔은 Grafana에 **자격증명/토큰을 주입하지 않는다.** iframe 로드 시 브라우저의 Cloudflare Access 세션이 그대로 사용된다.

## 고려한 대안

- **Grafana 패널을 React로 재구현 / Grafana HTTP API로 데이터를 받아 직접 차트** — 헌장 §2(재구현 금지) 정면 위배. 막대한 비용·중복. → 기각.
- **`@grafana/*` 임베드 SDK 또는 grafana-react** — 의존성·복잡도 증가. 헌장 §6(지루한 기술) 대비 과함. iframe이 가장 단순·안정. → 기각.
- **서버에서 Grafana render API로 패널 이미지 생성** — 상호작용 상실, 이미지 렌더러 플러그인 필요. → 기각.

## 결과

- 재구현 0, 의존성 0 — 순수 `<iframe>`.
- **감수 사항(iframe 고유 약점):** iframe 높이/반응형 제어가 까다롭고(고정 높이·스크롤 조정 필요), 실제 임베드 표시는 아래 보안 헤더(`allow_embedding`/`frame-ancestors`)·Access 세션에 의존하며, 콘솔↔Grafana 간 딥링크/상태 동기화는 불가하다. M1은 단순 임베드로 충분하므로 이를 수용한다.
- **외부(콘솔 범위 밖) 선결 조건 — 사람이 적용(헌장 §11):** Grafana가 iframe 임베드를 허용하도록 `allow_embedding = true`(필요 시 `security.x_frame_options` 및 reverse-proxy의 CSP `frame-ancestors`가 콘솔 도메인을 허용)로 설정되어야 한다. 또한 콘솔 도메인과 `GRAFANA_URL` 도메인이 **동일 Cloudflare Access** 정책 뒤에 있어 iframe 내 세션이 유지되어야 한다. 이 설정은 `infra/`·Cloudflare 측이며 콘솔이 건드리지 않는다.
- 수용 기준(spec §8): `/overview`의 iframe `src`가 `GRAFANA_URL` 값으로 시작하는지로 검증(임베드 동작 자체는 위 선결 조건에 의존).
- 후속: 대시보드 UID는 `GRAFANA_DASHBOARD_UID`(`.env.local`)에서 확정.

/**
 * 알림 → 어시스턴트 프리셋 질문 테이블 (specs/alert-enrichment §2 D2-2).
 *
 * 딥링크는 한국어 질문을 URL에 싣지 않는다 — 인코딩 지옥을 피하고, 질문을
 * 코드로 버전관리하기 위해 `alert=<알림이름>`만 받고 여기서 질문을 만든다.
 * 알림 목록의 정본: infra/monitoring/grafana/provisioning/alerting/alert-rules.yaml (14종).
 */

/** {node}·{mount} 자리표시자를 갖는 질문 템플릿. 노드 무관 알림은 자리표시자 없음. */
const PRESET_QUESTIONS: Record<string, string> = {
  NodeDown: "{node} 응답 중단(node-exporter 다운) 직전의 로그에서 원인 후보를 찾아줘",
  LogIngestStalled:
    "통합 로그 인입이 중단됐다. 로그 파이프라인(filebeat·logstash·opensearch) 관련 최근 에러를 찾아줘",
  DiskUsageHigh: "최근 6시간 {node} {mount} 디스크 사용 급증의 원인 후보를 로그에서 찾아줘",
  GpuTempHigh: "{node} GPU 과열 시점 전후의 GPU 관련 로그를 분석해줘",
  MemoryLow: "{node} 가용 메모리 급감 시점 전후의 로그에서 원인 프로세스 후보를 찾아줘",
  GpuXidErrorNew: "{node} GPU 하드웨어 에러(XID) 발생 전후의 GPU·커널 로그를 분석해줘",
  OomKillOccurred: "{node} OOM kill 발생 전후의 로그에서 어떤 프로세스가 죽었는지 찾아줘",
  SmartHealthFailed: "{node} 디스크 SMART 헬스 실패와 관련된 디스크 I/O·커널 로그를 찾아줘",
  DiskFillPredicted:
    "{node} {mount} 디스크가 현재 추세로 곧 가득 찬다. 최근 사용 급증의 원인 후보를 로그에서 찾아줘",
  NodeHygieneCoverageGap:
    "위생 수집기가 없는 노드가 있다. 수집기(node-hygiene) 배포·실행 관련 로그를 찾아줘",
  NodeHygieneStale:
    "{node} 위생 수집기가 90분 이상 미실행이다. 타이머·수집기 실행 관련 로그를 찾아줘",
  DiskGrownDefectsGrowing:
    "{node} 디스크 불량섹터가 늘고 있다. smartd·디스크 I/O 에러 로그를 찾아줘",
  DiskUncorrectedErrorsGrowing:
    "{node} 디스크 미교정 I/O 오류 증가 전후의 커널·smartd 로그를 찾아줘",
  PhysicalDiskDisappeared:
    "{node} 물리 디스크 인식 소실 전후의 커널·스토리지 컨트롤러 로그를 찾아줘",
};

/**
 * alertname → 어시스턴트 초기 질문. 테이블에 없는 알림은 일반형으로 폴백(링크가 깨지지 않게).
 * node/mount가 없으면 해당 자리표시자만 지우고 공백을 정돈한다.
 */
export function buildAlertQuestion(
  alert: string,
  opts: { node?: string; mount?: string } = {},
): string {
  const template =
    PRESET_QUESTIONS[alert] ?? `{node} ${alert} 알림 발생 시점 전후의 관련 로그에서 원인 후보를 찾아줘`;
  return template
    .replaceAll("{node}", opts.node ?? "")
    .replaceAll("{mount}", opts.mount ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 프리셋 보유 알림명 목록 — 테스트가 alert-rules.yaml 14종과 대조한다. */
export const PRESET_ALERT_NAMES: readonly string[] = Object.keys(PRESET_QUESTIONS);

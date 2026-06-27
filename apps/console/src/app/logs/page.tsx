import { PlaceholderPanel } from "@/components/ui/placeholder-panel";
import { Breadcrumb } from "@/components/shell/breadcrumb";

export default function LogsPage() {
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb />
      <PlaceholderPanel milestone="M2" title="통합 로그">
        플릿 전체의 로그를 ELK로 모아 Grafana 단일 콘솔에서 탐색합니다. 지금은 준비 중이며,
        M2에서 이 화면에 추가됩니다.
      </PlaceholderPanel>
    </div>
  );
}

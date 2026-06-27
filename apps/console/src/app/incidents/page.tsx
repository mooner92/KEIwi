import { PlaceholderPanel } from "@/components/ui/placeholder-panel";
import { Breadcrumb } from "@/components/shell/breadcrumb";

export default function IncidentsPage() {
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb />
      <PlaceholderPanel milestone="M4" title="장애 추적">
        장애를 기록하고 타임라인으로 시각화합니다. incident 기록·해결과 annotation은 M4에서 이
        화면에 추가됩니다.
      </PlaceholderPanel>
    </div>
  );
}

import { PlaceholderPanel } from "@/components/ui/placeholder-panel";
import { Breadcrumb } from "@/components/shell/breadcrumb";

export default function ResourcesPage() {
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb />
      <PlaceholderPanel milestone="M3" title="여유 리소스">
        어느 서버가 지금 여유 있는지 한눈에 보고 작업을 배치합니다. &quot;free&quot; 판정과 가용 서버
        뷰는 M3에서 이 화면에 추가됩니다.
      </PlaceholderPanel>
    </div>
  );
}

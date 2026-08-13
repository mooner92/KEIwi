import { Breadcrumb } from "@/components/shell/breadcrumb";
import { PageHeader } from "@/components/shell/page-header";
import { WikiView } from "@/components/wiki/wiki-view";

// 위키 산출물을 매 요청 읽는다(재생성하면 새로고침만으로 반영) — 정적 캐시 금지.
export const dynamic = "force-dynamic";

export default async function WikiPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-col gap-1">
        <Breadcrumb />
        <PageHeader
          title="플릿 위키"
          description="서버 → 계정 → 프로젝트 — 열린 포트에서 역추적한 문서 그래프입니다."
        />
      </div>
      <WikiView pageSlug={params.page} />
    </div>
  );
}

import { BrandMark } from "./brand-mark";
import { UtilBar } from "./util-bar";

// 상단바 — 48px. 본문 14px에 맞춘 액자 높이로, 안의 컨트롤(32px)이 8px 여백에 앉는다.
// 그림자 없음: 콘텐츠와의 분리는 1px 보더 하나로 충분하다(v3 §깊이).
export function TopBar() {
  return (
    <header className="border-b border-border bg-chrome text-ink">
      <div className="flex h-12 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark className="h-6 w-6 shrink-0" />
          <span className="text-md font-semibold tracking-tight">KEIwi</span>
          {/* 제품 설명은 워드마크를 이기면 안 된다 — 계조를 한 단 낮춰 붙인다 */}
          <span className="hidden border-l border-border pl-2 text-xs text-ink-subtle sm:inline">
            관제 콘솔
          </span>
        </div>
        <UtilBar />
      </div>
    </header>
  );
}

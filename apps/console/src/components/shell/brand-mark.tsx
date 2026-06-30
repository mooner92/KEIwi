// KEIwi 시그니처 마크 — 좌상 녹색(모니터링 노드 네트워크) / 우하 파랑(회로 트레이스).
// "Korea Environment Institute Wired Interface": 그래프 허브-스포크 + PCB 트레이스 은유.
// 색은 전부 토큰 유틸(fill-*/stroke-*)로 — raw hex 없음(브랜드 green/blue + white).
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label="KEIwi" className={className}>
      {/* 원형 분할: 좌상 녹색 · 우하 파랑 · 흰 대각 트레이스 */}
      <defs>
        <clipPath id="keiwi-mark-clip">
          <circle cx="50" cy="50" r="48" />
        </clipPath>
      </defs>
      <g clipPath="url(#keiwi-mark-clip)">
        <rect x="0" y="0" width="100" height="100" className="fill-green-500" />
        <path d="M82,14 L32,98 L100,100 L100,14 Z" className="fill-blue-500" />
        <path
          d="M84,10 L28,100"
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          className="stroke-white"
        />
      </g>

      {/* 녹색 측 — 허브-스포크 노드 네트워크 */}
      <g fill="none" strokeWidth="4" strokeLinecap="round" className="stroke-white">
        <line x1="43" y1="49" x2="43" y2="26" />
        <line x1="43" y1="49" x2="26" y2="37" />
        <line x1="43" y1="49" x2="22" y2="55" />
      </g>
      <circle cx="43" cy="26" r="5" className="fill-white" />
      <circle cx="26" cy="37" r="4.5" className="fill-white" />
      <circle cx="22" cy="55" r="4.5" className="fill-white" />
      <circle cx="43" cy="49" r="10" className="fill-white" />
      <circle cx="43" cy="49" r="5" className="fill-green-500" />

      {/* 파랑 측 — 회로 트레이스 + 노드(채움 + 링) */}
      <g fill="none" strokeWidth="4" strokeLinecap="round" className="stroke-white">
        <path d="M76,30 L63,64" />
        <path d="M63,64 L52,74" />
      </g>
      <circle cx="76" cy="30" r="6.5" className="fill-white" />
      <circle cx="63" cy="64" r="6.5" className="fill-white" />
      <circle cx="63" cy="64" r="3" className="fill-blue-500" />
    </svg>
  );
}

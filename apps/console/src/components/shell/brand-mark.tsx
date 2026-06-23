// 키위 단면 시그니처 마크 (브랜드 §5: 팔레트 + 단 하나의 시그니처 요소).
// 색은 전부 토큰 유틸(fill-*)로 — raw hex 없음.
const SEEDS: ReadonlyArray<readonly [number, number]> = [
  [23.5, 16],
  [21.3, 21.3],
  [16, 23.5],
  [10.7, 21.3],
  [8.5, 16],
  [10.7, 10.7],
  [16, 8.5],
  [21.3, 10.7],
];

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="KEIwi" className={className}>
      <circle cx="16" cy="16" r="15" className="fill-green-700" />
      <circle cx="16" cy="16" r="12.5" className="fill-green-100" />
      <circle cx="16" cy="16" r="2.6" className="fill-green-500" />
      {SEEDS.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="0.9" className="fill-gray-800" />
      ))}
    </svg>
  );
}

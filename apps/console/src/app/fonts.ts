import localFont from "next/font/local";

// Pretendard GOV — 한글 서체. KRDS 원칙은 폐기했으나(design v3) 서체는 유지한다:
// 국문 관제 화면용 대체재가 마땅치 않고 tabular 숫자 품질이 좋다.
// 출처: PretendardGOV-1.3.9 릴리스의 web/static/woff2-subset (4개 파일 모두 동일 서브셋 범위).
//
// weight 4단(400/500/600/700) — v3의 위계는 "색이 아니라 굵기"로 만든다(specs/design 타이포 §).
// Medium/SemiBold 실파일이 없으면 브라우저가 합성(faux bold)해 한글 자소가 뭉개지므로 필수.
export const pretendardGov = localFont({
  src: [
    { path: "./fonts/PretendardGOV-Regular.subset.woff2", weight: "400", style: "normal" },
    { path: "./fonts/PretendardGOV-Medium.subset.woff2", weight: "500", style: "normal" },
    { path: "./fonts/PretendardGOV-SemiBold.subset.woff2", weight: "600", style: "normal" },
    { path: "./fonts/PretendardGOV-Bold.subset.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-pretendard-gov",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

import localFont from "next/font/local";

// Pretendard GOV — KRDS 기본 서체(krds-uiux 동봉 서브셋). weight 400/700만(KRDS 2단계).
// 패키지에 @font-face가 없어 next/font/local이 생성한다 (typography.spec §1).
export const pretendardGov = localFont({
  src: [
    { path: "./fonts/PretendardGOV-Regular.subset.woff2", weight: "400", style: "normal" },
    { path: "./fonts/PretendardGOV-Bold.subset.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-pretendard-gov",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

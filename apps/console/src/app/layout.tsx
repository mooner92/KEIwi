import type { Metadata } from "next";
import "krds-uiux/resources/css/token/krds_tokens.css"; // L0 primitive(--krds-*) — KRDS 소유
import "./globals.css";
import { pretendardGov } from "./fonts";
import { AppShell } from "@/components/shell/app-shell";

export const metadata: Metadata = {
  metadataBase: new URL("https://keiwi.excusa.uk"),
  applicationName: "KEIwi",
  title: {
    default: "KEIwi — 관제 콘솔",
    template: "%s · KEIwi",
  },
  description:
    "KEI 연구 서버 플릿(data01~05) 모니터링·로깅·진단 온프레미스 관제 콘솔 — 메트릭·통합 로그·로그 어시스턴트.",
  // 링크 언퍼(노션 북마크 등). 이미지는 app/opengraph-image.tsx 자동 사용.
  // ※ 사이트가 Cloudflare Zero Trust 뒤라 외부 크롤러는 Access에 막힐 수 있음(README 참고).
  openGraph: {
    type: "website",
    siteName: "KEIwi 관제 콘솔",
    title: "KEIwi — 관제 콘솔",
    description: "KEI 연구 서버 플릿 모니터링·로깅·진단 온프레미스 관제 콘솔.",
    url: "https://keiwi.excusa.uk",
    locale: "ko_KR",
  },
};

// 다크 FOUC 방지 — 페인트 전 동기 실행: 쿠키 → localStorage → 시스템 선호 (layout.spec §5b)
const THEME_INIT = `(function(){try{` +
  `var m=document.cookie.match(/(?:^|; )keiwi-theme=(light|dark)/);` +
  `var t=m?m[1]:(localStorage.getItem('keiwi-theme')||` +
  `(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));` +
  `var e=document.documentElement;e.dataset.theme=t;e.style.colorScheme=t;` +
  `}catch(_){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ko"
      data-theme="light"
      suppressHydrationWarning
      className={`${pretendardGov.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

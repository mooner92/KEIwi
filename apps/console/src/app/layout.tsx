import type { Metadata } from "next";
import "krds-uiux/resources/css/token/krds_tokens.css"; // L0 primitive(--krds-*) — KRDS 소유
import "./globals.css";
import { pretendardGov } from "./fonts";
import { AppShell } from "@/components/shell/app-shell";

export const metadata: Metadata = {
  title: "KEIwi — 관제 콘솔",
  description: "KEI 연구 서버 플릿 모니터링 콘솔",
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

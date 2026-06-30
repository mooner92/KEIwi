import { ImageResponse } from "next/og";

// 링크 언퍼(노션 북마크 등)용 미리보기 이미지. 마크 + 타이틀.
// 텍스트는 영문(Satori 기본 폰트가 한글 미지원 → tofu 방지). 색은 브랜드 hex(이 라우트는 컴포넌트 아님).
export const alt = "KEIwi — Fleet Monitoring Console";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><clipPath id="c"><circle cx="50" cy="50" r="48"/></clipPath></defs>
<g clip-path="url(#c)"><rect width="100" height="100" fill="#38b38d"/>
<path d="M82,14 L32,98 L100,100 L100,14 Z" fill="#3ca2df"/>
<path d="M84,10 L28,100" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/></g>
<g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round">
<line x1="43" y1="49" x2="43" y2="26"/><line x1="43" y1="49" x2="26" y2="37"/><line x1="43" y1="49" x2="22" y2="55"/></g>
<circle cx="43" cy="26" r="5" fill="#fff"/><circle cx="26" cy="37" r="4.5" fill="#fff"/><circle cx="22" cy="55" r="4.5" fill="#fff"/>
<circle cx="43" cy="49" r="10" fill="#fff"/><circle cx="43" cy="49" r="5" fill="#38b38d"/>
<g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"><path d="M76,30 L63,64"/><path d="M63,64 L52,74"/></g>
<circle cx="76" cy="30" r="6.5" fill="#fff"/><circle cx="63" cy="64" r="6.5" fill="#fff"/><circle cx="63" cy="64" r="3" fill="#3ca2df"/></svg>`;

export default function Image() {
  const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(MARK)}`;
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 56,
          background: "#f4f5f6",
        }}
      >
        <img src={dataUri} width={300} height={300} alt="" />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 132, fontWeight: 800, color: "#1e2124", lineHeight: 1 }}>
            KEIwi
          </div>
          <div style={{ fontSize: 40, color: "#256ef4", marginTop: 18 }}>
            Fleet Monitoring Console
          </div>
          <div style={{ fontSize: 28, color: "#464c53", marginTop: 8 }}>
            KEI · on-prem servers · metrics · logs · assistant
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

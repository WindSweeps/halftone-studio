import type { Metadata } from "next";
import "./globals.css";

const title = "HALFTONE — 半调图案生成器";
const description = "在浏览器中生成可印刷的半调图案，导出 SVG 矢量图与 300 ppi PNG。";
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://halftone-lab-zh.azzzzaka.chatgpt.site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    description,
    title,
    type: "website",
    url: siteUrl,
    images: [
      {
        url: `${siteUrl}/og.png`,
        width: 1536,
        height: 1024,
        alt: "HALFTONE / LAB 半调图案生成器",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [`${siteUrl}/og.png`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

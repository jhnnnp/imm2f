import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ONLY US — 우리의 공간", template: "%s — ONLY US" },
  description: "둘의 계획부터 추억까지 이어지는 프라이빗 커플 공간",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" data-scroll-behavior="smooth"><body>{children}</body></html>;
}

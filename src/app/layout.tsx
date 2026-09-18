import type { Metadata } from "next";
import localFont from "next/font/local";
import { Nanum_Pen_Script } from "next/font/google";
import { SessionProvider } from "@/features/auth/components/SessionProvider";
import "./globals.css";
import "./map-polish.css";

const accentScript = Nanum_Pen_Script({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-accent-script",
  display: "swap",
});

const hand = localFont({
  src: [
    {
      path: "../../node_modules/@kfonts/nanum-barun-pen-otf/NanumBarunpenR.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@kfonts/nanum-barun-pen-otf/NanumBarunpenB.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-hand",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "ONLY US — 우리의 공간", template: "%s — ONLY US" },
  description: "우리의계획부터 추억까지 이어지는 프라이빗 커플 공간",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={`${hand.variable} ${accentScript.variable}`} data-scroll-behavior="smooth">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Gowun_Batang, Nanum_Pen_Script, Noto_Sans_KR } from "next/font/google";
import { SessionProvider } from "@/features/auth/components/SessionProvider";
import { getAppSession } from "@/features/auth/session";
import "./globals.css";
import "./map-polish.css";

const sans = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const serif = Gowun_Batang({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-serif",
  display: "swap",
});

const hand = Nanum_Pen_Script({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-hand",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "ONLY US — 우리의 공간", template: "%s — ONLY US" },
  description: "우리의계획부터 추억까지 이어지는 프라이빗 커플 공간",
  icons: { icon: "/favicon.svg" },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getAppSession();
  return (
    <html lang="ko" className={`${sans.variable} ${serif.variable} ${hand.variable}`} data-scroll-behavior="smooth">
      <body>
        <SessionProvider initialSession={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}

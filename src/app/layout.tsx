import type { Metadata } from "next";
import { SessionProvider } from "@/features/auth/components/SessionProvider";
import { getAppSession } from "@/features/auth/session";
import "./globals.css";
import "./map-polish.css";

export const metadata: Metadata = {
  title: { default: "ONLY US — 우리의 공간", template: "%s — ONLY US" },
  description: "둘의 계획부터 추억까지 이어지는 프라이빗 커플 공간",
  icons: { icon: "/favicon.svg" },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getAppSession();
  return (
    <html lang="ko" data-scroll-behavior="smooth">
      <body>
        <SessionProvider initialSession={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}

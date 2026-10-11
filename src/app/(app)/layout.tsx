import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageLoading } from "@/components/layout/PageLoading";
import { SessionProvider } from "@/features/auth/components/SessionProvider";
import { getAppSession } from "@/features/auth/session";
import { appSessionIdentity } from "@/features/auth/types";
import { redirect } from "next/navigation";

export default function AppWorkspaceLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}><AuthenticatedWorkspace>{children}</AuthenticatedWorkspace></Suspense>;
}

async function AuthenticatedWorkspace({ children }: { children: ReactNode }) {
  const session = await getAppSession();
  if (session.mode === "guest") redirect("/login");
  if (session.mode === "setup_error") throw new Error("계정 공간을 준비하지 못했어요. 다시 불러와 주세요.");
  const key = appSessionIdentity(session);
  return <SessionProvider key={key} initialSession={session}><AppShell>{children}</AppShell></SessionProvider>;
}

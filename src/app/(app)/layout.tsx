import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";

export default function AppWorkspaceLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

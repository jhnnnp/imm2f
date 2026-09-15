import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ActivityPanel } from "@/features/collaboration/components/ActivityPanel";

export function AppShell({ children, context }: { children: ReactNode; context?: ReactNode }) {
  return <div className="app-shell">
    <Sidebar />
    <main className="workspace"><Topbar />{children}</main>
    <aside className="context-panel" aria-label="상세 정보">{context ?? <ActivityPanel />}</aside>
  </div>;
}

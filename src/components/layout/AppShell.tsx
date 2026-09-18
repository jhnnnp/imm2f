import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ActivityPanel } from "@/features/collaboration/components/ActivityPanel";
import { NavigationProgress } from "./NavigationProgress";
import { PageStage } from "./PageStage";

export function AppShell({ children, context }: { children: ReactNode; context?: ReactNode }) {
  return (
    <div className="app-shell">
      <NavigationProgress />
      <Sidebar />
      <main className="workspace">
        <Topbar />
        <PageStage>{children}</PageStage>
      </main>
      <aside className="context-panel" aria-label="상세 정보">
        <div id="context-panel-slot" />
        <div id="context-panel-default">{context ?? <ActivityPanel />}</div>
      </aside>
    </div>
  );
}

import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ActivityPanel } from "@/features/collaboration/components/ActivityPanel";
import { NavigationProgress } from "./NavigationProgress";
import { PageStage } from "./PageStage";
import { ContextPanelDrawer } from "./ContextPanelDrawer";

export function AppShell({ children, context }: { children: ReactNode; context?: ReactNode }) {
  return (
    <div className="app-shell">
      <NavigationProgress />
      <Sidebar />
      <main className="workspace">
        <Topbar />
        <PageStage>{children}</PageStage>
      </main>
      <ContextPanelDrawer fallback={context ?? <ActivityPanel />} />
    </div>
  );
}

import type { ReactNode } from "react";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ActivityPanel } from "@/features/collaboration/components/ActivityPanel";
import { ActivityPanelServer } from "@/features/collaboration/components/ActivityPanelServer";

export default function AppWorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      context={(
        <Suspense fallback={<ActivityPanel initialItems={[]} />}>
          <ActivityPanelServer />
        </Suspense>
      )}
    >
      {children}
    </AppShell>
  );
}

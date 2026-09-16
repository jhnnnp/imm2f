import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { InsightsPanel } from "@/features/ai/components/InsightsPanel";

export const metadata: Metadata = { title: "Insights" };

export default function InsightsPage() {
  return (
    <AppShell>
      <InsightsPanel initial={null} />
    </AppShell>
  );
}

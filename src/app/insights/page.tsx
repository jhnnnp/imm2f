import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { InsightsPanel } from "@/features/ai/components/InsightsPanel";
import { loadLatestCoupleInsight } from "@/features/ai/actions";

export const metadata: Metadata = { title: "Insights" };

export default async function InsightsPage() {
  const initial = await loadLatestCoupleInsight();
  return (
    <AppShell>
      <InsightsPanel initial={initial} />
    </AppShell>
  );
}

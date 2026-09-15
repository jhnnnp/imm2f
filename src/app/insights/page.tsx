import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { InsightsPanel } from "@/features/ai/components/InsightsPanel";
import { analyzeCouplePreferences } from "@/features/ai/actions";

export const metadata: Metadata = { title: "Insights" };

export default async function InsightsPage() {
  const result = await analyzeCouplePreferences();
  const initial = "error" in result ? null : result;
  return (
    <AppShell>
      <InsightsPanel initial={initial} />
    </AppShell>
  );
}

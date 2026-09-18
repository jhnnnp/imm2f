import type { Metadata } from "next";
import { loadTasteSeed } from "@/features/taste/actions";
import { DatePlanner } from "@/features/date/components/DatePlanner";
import { listArchivedDatePlans, listDateDrafts, loadCouplePlan } from "@/features/planning/actions";
import { seoulTodayIso } from "@/lib/dates";

export const metadata: Metadata = { title: "Date" };

export default async function DatePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const params = await searchParams;
  const [plan, archives, drafts, tasteSeed] = await Promise.all([
    loadCouplePlan("date"),
    listArchivedDatePlans(),
    listDateDrafts(),
    params.from === "taste" ? loadTasteSeed() : Promise.resolve(null),
  ]);

  return <DatePlanner today={seoulTodayIso()} initialPlan={plan} initialArchives={archives.dates} initialDrafts={drafts} tasteSeed={tasteSeed} />;
}

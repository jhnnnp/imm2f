import type { Metadata } from "next";
import { DatePlanner } from "@/features/date/components/DatePlanner";
import { listArchivedDatePlans, listDateDrafts, loadCouplePlan } from "@/features/planning/actions";
import { seoulTodayIso } from "@/lib/dates";

export const metadata: Metadata = { title: "Date" };

export default async function DatePage() {
  const [plan, archives, drafts] = await Promise.all([
    loadCouplePlan("date"),
    listArchivedDatePlans(),
    listDateDrafts(),
  ]);

  return <DatePlanner today={seoulTodayIso()} initialPlan={plan} initialArchives={archives.dates} initialDrafts={drafts} />;
}

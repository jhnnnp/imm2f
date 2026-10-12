import type { Metadata } from "next";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { loadTasteSeed } from "@/features/taste/actions";
import { DatePlanner } from "@/features/date/components/DatePlanner";
import { readDateWorkspace } from "@/features/collaboration/workspaceReads";
import { isIsoDate, seoulTodayIso } from "@/lib/dates";
import { candidateExplorationMode } from "@/features/ai/candidateExplorationMode";

export const metadata: Metadata = { title: "Date" };

export default function DatePage({ searchParams }: { searchParams: Promise<{ from?: string; day?: string }> }) {
  return (
    <RouteSuspense>
      <DatePageContent searchParams={searchParams} />
    </RouteSuspense>
  );
}

async function DatePageContent({ searchParams }: { searchParams: Promise<{ from?: string; day?: string }> }) {
  const params = await searchParams;
  const [{ plan, archives, drafts, tripDays, tripSyncError }, tasteSeed] = await Promise.all([
    readDateWorkspace(),
    params.from === "taste" ? loadTasteSeed() : Promise.resolve(null),
  ]);

  return (
    <DatePlanner
      key={params.day ?? "today"}
      today={params.day === "" || isIsoDate(params.day) ? params.day : seoulTodayIso()}
      initialPlan={plan}
      initialArchives={archives}
      initialDrafts={drafts}
      initialTripDays={tripDays ?? []}
      initialTripSyncError={tripSyncError}
      tasteSeed={tasteSeed}
      candidateExplorationActive={candidateExplorationMode() === "active"}
    />
  );
}

import type { Metadata } from "next";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { TripPlanner } from "@/features/trip/components/TripPlanner";
import { readTripWorkspace } from "@/features/collaboration/workspaceReads";
import { candidateExplorationMode } from "@/features/ai/candidateExplorationMode";
import { isIsoDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Trip" };

type TripSearchParams = Promise<{ day?: string; date?: string; archive?: string }>;
export default function TripPage({ searchParams }: { searchParams: TripSearchParams }) {
  return (
    <RouteSuspense>
      <TripPageContent searchParams={searchParams} />
    </RouteSuspense>
  );
}

async function TripPageContent({ searchParams }: { searchParams: TripSearchParams }) {
  const params = await searchParams;
  const selectedDate = params.date !== undefined && (params.date === "" || isIsoDate(params.date)) ? params.date : undefined;
  const { plan: active, archives, drafts: allDrafts } = await readTripWorkspace(selectedDate);
  const archive = archives.find(journey => journey.id === params.archive);
  const plan = archive ? { ...active, ...archive, notes: archive.notes ?? "" }
    : active;
  return <TripPlanner key={`${params.archive ?? ""}:${params.date ?? "active"}:${params.day ?? "0"}`} initialDay={Number(params.day) || 0} initialPlan={plan}
    initialArchives={archives} initialDrafts={allDrafts} initialArchiveId={archive?.id}
    candidateExplorationActive={candidateExplorationMode() === "active"} />;
}

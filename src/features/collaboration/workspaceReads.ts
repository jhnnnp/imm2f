"use server";

import { listArchivedDatePlans, listArchivedTripPlans, listDateDrafts, loadCouplePlan, readTripDate } from "@/features/planning/actions";
import { listMemories, listMemoryCalendarMarks } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";
import { withWorkspaceRead } from "@/lib/supabase/readContext";

// Browser-dispatched Server Actions are queued. Fan out reads inside one action instead.
export async function readDateWorkspace() {
  return withWorkspaceRead(async () => {
    const [plan, drafts, archives] = await Promise.all([loadCouplePlan("date"), listDateDrafts(), listArchivedDatePlans()]);
    return { plan, drafts, archives: archives.dates };
  });
}

export async function readCalendarWorkspace() {
  return withWorkspaceRead(async () => {
    const [travel, date, drafts, memories, archives] = await Promise.all([
      readTripDate(), loadCouplePlan("date"), listDateDrafts(), listMemoryCalendarMarks(), listArchivedTripPlans(),
    ]);
    return { trip: travel.plan, date, drafts, memories, tripDrafts: travel.drafts, archives };
  });
}

export async function readMapWorkspace() {
  return withWorkspaceRead(async () => {
    const [places, trip, archives, memories] = await Promise.all([
      listPlaces(), loadCouplePlan("trip"), listArchivedTripPlans(), listMemories({ photos: "cover" }),
    ]);
    return { places: places.places, trip, archives, memories: memories.memories };
  });
}

export async function readTripWorkspace(startDate?: string | null) {
  return withWorkspaceRead(async () => {
    const [current, archives] = await Promise.all([readTripDate(startDate), listArchivedTripPlans()]);
    return { ...current, archives };
  });
}

export async function readPlacesWorkspace(tripDate?: string) {
  return withWorkspaceRead(async () => {
    const [places, trip, archives] = await Promise.all([listPlaces(), tripDate === undefined ? loadCouplePlan("trip") : readTripDate(tripDate).then(result => result.plan), listArchivedTripPlans()]);
    return { places, trip, archives };
  });
}

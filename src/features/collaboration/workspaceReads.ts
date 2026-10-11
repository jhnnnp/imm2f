"use server";

import { listArchivedDatePlans, listArchivedTripPlans, listDateDrafts, loadCouplePlan } from "@/features/planning/actions";
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
    const [trip, date, drafts, memories] = await Promise.all([
      loadCouplePlan("trip"), loadCouplePlan("date"), listDateDrafts(), listMemoryCalendarMarks(),
    ]);
    return { trip, date, drafts, memories };
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

export async function readTripWorkspace() {
  return withWorkspaceRead(async () => {
    const [plan, archives] = await Promise.all([loadCouplePlan("trip"), listArchivedTripPlans()]);
    return { plan, archives };
  });
}

export async function readPlacesWorkspace() {
  return withWorkspaceRead(async () => {
    const [places, trip, archives] = await Promise.all([listPlaces(), loadCouplePlan("trip"), listArchivedTripPlans()]);
    return { places, trip, archives };
  });
}

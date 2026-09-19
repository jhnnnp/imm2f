"use server";

import { listDateDrafts, loadCouplePlan } from "@/features/planning/actions";
import { listMemoryCalendarMarks } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";

// Browser-dispatched Server Actions are queued. Fan out reads inside one action instead.
export async function readDateWorkspace() {
  const [plan, drafts] = await Promise.all([loadCouplePlan("date"), listDateDrafts()]);
  return { plan, drafts };
}

export async function readCalendarWorkspace() {
  const [trip, date, drafts, memories] = await Promise.all([
    loadCouplePlan("trip"), loadCouplePlan("date"), listDateDrafts(), listMemoryCalendarMarks(),
  ]);
  return { trip, date, drafts, memories };
}

export async function readMapWorkspace() {
  const [places, trip] = await Promise.all([listPlaces(), loadCouplePlan("trip")]);
  return { places: places.places, trip };
}

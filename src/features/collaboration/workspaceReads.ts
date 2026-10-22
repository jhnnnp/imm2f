"use server";

import { listArchivedDatePlans, listArchivedTripPlans, listDateDrafts, loadCouplePlan, readTripDate } from "@/features/planning/actions";
import { listMemories, listMemoryCalendarMarks } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";
import { withWorkspaceRead } from "@/lib/supabase/readContext";
import { readCoupleKeyDates } from "@/features/couple/keyDateActions";
import { projectTripDayPlans } from "@/features/date/tripDayPlans";

// Browser-dispatched Server Actions are queued. Fan out reads inside one action instead.
export async function readDateWorkspace() {
  return withWorkspaceRead(async () => {
    // A trip revision may advance while it is read. Keep Date usable and let
    // its retry refresh the journey; never present a partial trip as empty.
    const travel = Promise.all([readTripDate(), listArchivedTripPlans()])
      .then(([current, archives]) => ({ tripDays: projectTripDayPlans(current.plan, current.drafts, archives), tripSyncError: "" }))
      .catch(() => ({ tripDays: null, tripSyncError: "여행 일정을 확인하지 못했어요. 데이트는 볼 수 있으며, 여행은 다시 조회해 주세요." }));
    const [plan, drafts, archives, journeys] = await Promise.all([
      loadCouplePlan("date"), listDateDrafts(), listArchivedDatePlans(), travel,
    ]);
    return { plan, drafts, archives: archives.dates, ...journeys };
  });
}

export async function readCalendarWorkspace() {
  return withWorkspaceRead(async () => {
    const [travel, date, drafts, memories, archives, dates] = await Promise.all([
      readTripDate(), loadCouplePlan("date"), listDateDrafts(), listMemoryCalendarMarks(), listArchivedTripPlans(), readCoupleKeyDates(),
    ]);
    return { trip: travel.plan, date, drafts, memories, tripDrafts: travel.drafts, archives, keyDates: dates.dates };
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

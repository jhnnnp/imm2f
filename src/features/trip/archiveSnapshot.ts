import type { PlanItem } from "@/features/planning/types/plan";

type TripSnapshot = { title: string; startDate: string; dayCount: number; notes?: string; items: PlanItem[] };

function signature(snapshot: TripSnapshot) {
  return JSON.stringify([snapshot.title, snapshot.startDate, snapshot.dayCount, snapshot.notes ?? "",
    [...snapshot.items].sort((a, b) => a.dayIndex - b.dayIndex || a.order - b.order).map(item => [
      item.id, item.placeId, item.placeName, item.category, item.startTime, item.durationMinutes,
      item.expectedCost, item.order, item.memo, item.dayIndex,
    ]),
  ]);
}

/** Coordinate lookup does not turn an already recorded trip into a new journey. */
export function tripSnapshotRecorded(snapshot: TripSnapshot, archives: TripSnapshot[]) {
  const key = signature(snapshot);
  return archives.some(archive => signature(archive) === key);
}

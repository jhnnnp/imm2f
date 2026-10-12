import type { ArchivedTripPlan } from "@/features/planning/actions";
import type { CouplePlan, PlanItem } from "@/features/planning/types/plan";
import { tripSnapshotRecorded } from "@/features/trip/archiveSnapshot";
import { tripDraftsWithActive, type TripDateSnapshot } from "@/features/trip/tripDates";
import { addDays, isIsoDate } from "@/lib/dates";

/** A view of one real travel day; its items remain owned by the journey. */
export type TripDayPlan = {
  id: string;
  title: string;
  startDate: string;
  dayIndex: number;
  dayCount: number;
  items: PlanItem[];
  recorded: boolean;
  href: string;
};

/** Project shared trips onto Date without copying them into date plans/drafts. */
export function projectTripDayPlans(active: CouplePlan, drafts: TripDateSnapshot[], archives: ArchivedTripPlan[]): TripDayPlan[] {
  const recordedByStart = new Map<string, ArchivedTripPlan[]>();
  const recorded = archives.filter(archive => {
    if (!isIsoDate(archive.startDate)) return false;
    const sameStart = recordedByStart.get(archive.startDate) ?? [];
    if (tripSnapshotRecorded(archive, sameStart)) return false;
    sameStart.push(archive);
    recordedByStart.set(archive.startDate, sameStart);
    return true;
  });
  const planned = tripDraftsWithActive(drafts, active).filter(trip => isIsoDate(trip.startDate)
    && !tripSnapshotRecorded(trip, recordedByStart.get(trip.startDate) ?? []));
  const journeys = [
    ...planned.map(trip => ({ ...trip, id: `draft:${trip.startDate}`, recorded: false })),
    ...recorded.map(trip => ({ ...trip, id: `archive:${trip.id}`, archiveId: trip.id, recorded: true })),
  ];

  return journeys.flatMap(trip => {
    const dayCount = Math.max(1, Math.min(7, Number.isInteger(trip.dayCount) ? trip.dayCount : 1));
    // Include days with no places so the middle of a trip is still discoverable.
    return Array.from({ length: dayCount }, (_, dayIndex): TripDayPlan => ({
      id: `${trip.id}:day:${dayIndex}`,
      title: trip.title,
      startDate: trip.startDate,
      dayIndex,
      dayCount,
      items: trip.items.filter(item => (item.dayIndex ?? 0) === dayIndex).sort((a, b) => a.order - b.order),
      recorded: trip.recorded,
      href: "archiveId" in trip
        ? `/trip?archive=${encodeURIComponent(trip.archiveId)}&day=${dayIndex}`
        : `/trip?date=${trip.startDate}&day=${dayIndex}`,
    }));
  }).sort((a, b) => addDays(a.startDate, a.dayIndex).localeCompare(addDays(b.startDate, b.dayIndex))
    || Number(a.recorded) - Number(b.recorded) || a.id.localeCompare(b.id));
}

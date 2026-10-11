import type { ArchivedTripPlan } from "@/features/planning/actions";
import type { CouplePlan } from "@/features/planning/types/plan";
import { tripSnapshotRecorded } from "@/features/trip/archiveSnapshot";
import { hasTripContent, tripDayOffset, tripDraftsWithActive, type TripDateSnapshot } from "@/features/trip/tripDates";
import { isIsoDate } from "@/lib/dates";

export type CalendarTrip = TripDateSnapshot & { id: string; archived: boolean };

export function calendarTrips(active: CouplePlan, drafts: TripDateSnapshot[], archives: ArchivedTripPlan[]): CalendarTrip[] {
  const recorded = archives.filter(archive => isIsoDate(archive.startDate)).map(archive => ({ ...archive, notes: archive.notes ?? "", archived: true }));
  const planned = tripDraftsWithActive(drafts, active).filter(trip => isIsoDate(trip.startDate) && hasTripContent(trip) && !tripSnapshotRecorded(trip, recorded));
  return [...planned.map(trip => ({ ...trip, id: `draft:${trip.startDate}`, archived: false })), ...recorded];
}

export function tripsOnDate(trips: CalendarTrip[], date: string) {
  return trips.flatMap(trip => {
    const day = tripDayOffset(trip.startDate, trip.dayCount, date);
    return day < 0 ? [] : [{ trip, day,
      href: trip.archived ? `/trip?archive=${encodeURIComponent(trip.id)}&day=${day}` : `/trip?date=${trip.startDate}&day=${day}`,
      items: [...trip.items].filter(item => (item.dayIndex ?? 0) === day).sort((a, b) => a.order - b.order),
    }];
  });
}

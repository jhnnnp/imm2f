import type { PlanItem } from "@/features/planning/types/plan";
import type { DateCourseRow } from "@/features/ai/dateCourse";

/** Map data is derived from the itinerary. A day never borrows another day's stops. */
export type DayRoute = { dayIndex: number; stops: Array<{
  candidateId: string; order: number; lat: number; lng: number; item: PlanItem;
}>; route?: { polyline: Array<[number, number]>; distanceMeters?: number;
  durationMinutes?: number; verificationLevel?: string } };

export function dayRoutes(items: PlanItem[]): DayRoute[] {
  const days = [...new Set(items.map(item => item.dayIndex))].sort((a, b) => a - b);
  return days.map(dayIndex => ({ dayIndex,
    stops: items.filter(item => item.dayIndex === dayIndex)
      .sort((a, b) => a.order - b.order)
      .filter(item => item.coordinates && Number.isFinite(item.coordinates[0])
        && Number.isFinite(item.coordinates[1]))
      .map((item, index) => ({ candidateId: item.placeId,
        order: index + 1, lng: item.coordinates![0], lat: item.coordinates![1], item })),
  }));
}

/** P4.5 boundary: the visible day tabs and numbered markers must represent
 * exactly the planned venue IDs in planned order, with no cross-day leg. */
export function itineraryOrderMatchesItems(rows: DateCourseRow[], items: PlanItem[]): boolean {
  if (rows.length !== items.length) return false;
  const expected = rows.map(row => `${row.day_index ?? 0}:${row.id}`);
  const actual = dayRoutes(items).flatMap(route => route.stops.map(stop =>
    `${route.dayIndex}:${stop.candidateId.replace(/^discover:/, "")}`));
  return expected.length === actual.length && expected.every((value, index) => value === actual[index]);
}

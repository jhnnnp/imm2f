import type { PlanItem } from "@/features/planning/types/plan";

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

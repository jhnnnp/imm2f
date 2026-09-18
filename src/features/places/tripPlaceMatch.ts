import { parseDiscoverPlaceId } from "./discover";
import type { Place } from "./types/place";
import type { PlanItem } from "@/features/planning/types/plan";
import type { ArchivedTripPlan } from "@/features/planning/actions";

export type TripScheduleStop = {
  key: string;
  item: PlanItem;
  scope: "live" | "archive";
  planTitle: string;
  planId?: string;
  startDate?: string;
};

export function planItemMatchesPlace(item: PlanItem, place: Place): boolean {
  if (item.placeId === place.id) return true;
  const parsed = parseDiscoverPlaceId(item.placeId);
  if (
    parsed
    && place.externalPlaceId
    && place.externalSource === parsed.source
    && place.externalPlaceId === parsed.externalPlaceId
  ) {
    return true;
  }
  return false;
}

export function tripItemsForPlace(items: PlanItem[], place: Place): PlanItem[] {
  return items.filter(item => planItemMatchesPlace(item, place));
}

export function placeIsOnTrip(items: PlanItem[], place: Place): boolean {
  return tripItemsForPlace(items, place).length > 0;
}

export function tripScheduleStopsForPlace(
  liveItems: PlanItem[],
  liveTitle: string,
  archives: ArchivedTripPlan[],
  place: Place,
): TripScheduleStop[] {
  const stops: TripScheduleStop[] = [];
  for (const item of tripItemsForPlace(liveItems, place)) {
    stops.push({
      key: `live-${item.id}`,
      item,
      scope: "live",
      planTitle: liveTitle.trim() || "진행 중인 여행",
    });
  }
  for (const archive of archives) {
    for (const item of tripItemsForPlace(archive.items, place)) {
      stops.push({
        key: `archive-${archive.id}-${item.id}`,
        item,
        scope: "archive",
        planTitle: archive.title,
        planId: archive.id,
        startDate: archive.startDate,
      });
    }
  }
  return stops;
}

export function placeIsOnAnyTrip(
  liveItems: PlanItem[],
  archives: ArchivedTripPlan[],
  place: Place,
): boolean {
  return tripScheduleStopsForPlace(liveItems, "", archives, place).length > 0;
}

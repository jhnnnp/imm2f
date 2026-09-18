import { describe, expect, it } from "vitest";
import { discoverPlaceId } from "./discover";
import type { Place } from "./types/place";
import type { PlanItem } from "@/features/planning/types/plan";
import { placeIsOnAnyTrip, placeIsOnTrip, planItemMatchesPlace, tripScheduleStopsForPlace } from "./tripPlaceMatch";

const basePlace: Place = {
  id: "uuid-1",
  name: "한일옥",
  category: "restaurant",
  categoryLabel: "음식점",
  district: "군산",
  address: "",
  roadAddress: "",
  mapUrl: "",
  phone: "",
  description: "",
  durationMinutes: 60,
  expectedCostTwo: null,
  coordinates: [126.7, 35.9],
  image: null,
  visualTone: "brown",
  userStatus: "want",
  partnerStatus: "neutral",
  userFit: 0,
  partnerFit: 0,
  externalSource: "kakao",
  externalPlaceId: "kakao-123",
};

function planItem(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    id: "plan-1",
    placeId: "uuid-1",
    placeName: "한일옥",
    category: "음식점",
    startTime: "12:00",
    durationMinutes: 60,
    expectedCost: 0,
    order: 0,
    memo: "육회비빔밥",
    dayIndex: 0,
    ...overrides,
  };
}

describe("tripPlaceMatch", () => {
  it("matches by saved place id", () => {
    expect(planItemMatchesPlace(planItem(), basePlace)).toBe(true);
  });

  it("matches discover plan id to saved external place", () => {
    const discoverId = discoverPlaceId("kakao", "kakao-123");
    expect(planItemMatchesPlace(planItem({ placeId: discoverId }), basePlace)).toBe(true);
  });

  it("does not match unrelated places", () => {
    expect(planItemMatchesPlace(planItem({ placeId: "other" }), basePlace)).toBe(false);
    expect(placeIsOnTrip([planItem({ placeId: "other" })], basePlace)).toBe(false);
  });

  it("includes archived trip stops", () => {
    const archives = [{
      id: "mem-1",
      title: "군산 여행",
      startDate: "2025-03-01",
      dayCount: 2,
      status: "completed" as const,
      items: [planItem({ id: "arch-1", memo: "아침 일정" })],
    }];
    const stops = tripScheduleStopsForPlace([], "", archives, basePlace);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.scope).toBe("archive");
    expect(stops[0]?.planTitle).toBe("군산 여행");
    expect(placeIsOnAnyTrip([], archives, basePlace)).toBe(true);
  });
});

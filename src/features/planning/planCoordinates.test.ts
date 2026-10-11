import { describe, expect, it } from "vitest";
import { discoverPlaceId, parseDiscoverPlaceId } from "@/features/places/discover";
import type { PlanItem } from "./types/plan";
import {
  asPlanCoordinates,
  isUuidPlaceId,
  pickResolvedCoordinates,
  placeCoordinateLookup,
  regionHintFromTitle,
  withLookedUpCoordinates,
  mergeHydratedPlanCoordinates,
  planCoordinateHydrateKey,
} from "./planCoordinates";

function item(placeId: string, extras: Partial<PlanItem> = {}): PlanItem {
  return {
    id: extras.id ?? placeId,
    placeId,
    placeName: extras.placeName ?? "어느덧오늘",
    category: extras.category ?? "카페",
    startTime: extras.startTime ?? "11:00",
    durationMinutes: extras.durationMinutes ?? 60,
    expectedCost: extras.expectedCost ?? 0,
    order: extras.order ?? 0,
    memo: extras.memo ?? "앞에서 470m",
    dayIndex: extras.dayIndex ?? 0,
    coordinates: extras.coordinates,
  };
}

describe("plan coordinates", () => {
  it("parses chatbot discover ids", () => {
    expect(parseDiscoverPlaceId("discover:kakao:18577297")).toEqual({ source: "kakao", externalPlaceId: "18577297" });
    expect(parseDiscoverPlaceId("discover:tourapi:123")).toEqual({ source: "tourapi", externalPlaceId: "123" });
    expect(parseDiscoverPlaceId("550e8400-e29b-41d4-a716-446655440000")).toBeNull();
  });

  it("does not treat discover ids as saved place uuids", () => {
    expect(isUuidPlaceId("discover:kakao:18577297")).toBe(false);
    expect(isUuidPlaceId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("hydrates chatbot stops from a saved kakao place", () => {
    const lookup = placeCoordinateLookup([
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        lng: 127.204,
        lat: 37.896,
        external_source: "kakao",
        external_place_id: "18577297",
      },
    ]);
    const [hydrated] = withLookedUpCoordinates(
      [item(discoverPlaceId("kakao", "18577297"))],
      lookup,
    );
    expect(hydrated.coordinates).toEqual([127.204, 37.896]);
  });

  it("keeps stored plan-item coordinates even without a places row", () => {
    const [hydrated] = withLookedUpCoordinates(
      [item("discover:kakao:1", { coordinates: [127.1, 37.8] })],
      new Map(),
    );
    expect(hydrated.coordinates).toEqual([127.1, 37.8]);
  });

  it("rejects swapped lat/lng that would fail the map", () => {
    expect(asPlanCoordinates(37.8, 127.2)).toBeNull();
    expect(asPlanCoordinates(127.2, 37.8)).toEqual([127.2, 37.8]);
  });

  it("does not turn missing coordinates into a pin at the equator", () => {
    for (const value of [null, undefined, "", " ", false, true, [], {}]) {
      expect(asPlanCoordinates(value, value)).toBeNull();
    }
    expect(asPlanCoordinates("127.2", "37.8")).toEqual([127.2, 37.8]);
    expect(asPlanCoordinates(0, 0)).toEqual([0, 0]);
    expect(placeCoordinateLookup([{ id: "missing", lng: null, lat: null }]).size).toBe(0);
  });

  it("prefers the kakao id when resolving a search result", () => {
    const coords = pickResolvedCoordinates(item("discover:kakao:2", { placeName: "봄스커피" }), [
      { externalPlaceId: "9", name: "봄스커피", coordinates: [127.1, 37.8] },
      { externalPlaceId: "2", name: "봄스커피 포천점", coordinates: [127.2, 37.9] },
    ]);
    expect(coords).toEqual([127.2, 37.9]);
  });

  it("does not pin a stop to an unrelated first search result", () => {
    expect(pickResolvedCoordinates(item("manual", { placeName: "우리 카페" }), [
      { externalPlaceId: "9", name: "다른 카페", coordinates: [127.1, 37.8] },
    ])).toBeNull();
    expect(pickResolvedCoordinates(item("manual", { placeName: "우리 카페" }), [
      { externalPlaceId: "9", name: "우리카페", coordinates: [127.1, 37.8] },
    ])).toEqual([127.1, 37.8]);
  });

  it("reads the city out of a trip title for search", () => {
    expect(regionHintFromTitle("포천 여행")).toBe("포천");
    expect(regionHintFromTitle("성수 데이트")).toBe("성수");
  });

  it("fills invalid locations without overwriting edits made during the lookup", () => {
    const current = [item("a", { id: "same", coordinates: [NaN, NaN], memo: "새 메모" }), item("b", { coordinates: [128, 38] })];
    const hydrated = [item("a", { id: "same", coordinates: [127, 37], memo: "이전 메모" }), item("b", { coordinates: [126, 36] })];
    const result = mergeHydratedPlanCoordinates(current, hydrated);
    expect(result[0].coordinates).toEqual([127, 37]);
    expect(result[0].memo).toBe("새 메모");
    expect(result[1]).toBe(current[1]);
  });

  it("ignores a stale location for a replaced stop or a removed stop", () => {
    const current = [item("new", { id: "same" })];
    const hydrated = [item("old", { id: "same", coordinates: [127, 37] }), item("removed", { coordinates: [127, 37] })];
    expect(mergeHydratedPlanCoordinates(current, hydrated)).toEqual(current);
  });

  it("looks up a replacement place even when the itinerary reuses its item ID", () => {
    const old = item("old-place", { id: "same-stop", placeName: "이전 카페" });
    const replacement = { ...old, placeId: "new-place", placeName: "새 카페" };
    expect(planCoordinateHydrateKey("trip", [old])).not.toBe(planCoordinateHydrateKey("trip", [replacement]));
  });

  it("does not repeat a location lookup for order or memo changes", () => {
    const first = item("a"), second = item("b");
    const key = planCoordinateHydrateKey("trip", [first, second]);
    expect(planCoordinateHydrateKey("trip", [{ ...second, order: 0 }, { ...first, order: 1, memo: "새 메모" }])).toBe(key);
    expect(planCoordinateHydrateKey("trip", [{ ...first, coordinates: [127, 37] }, { ...second, coordinates: [128, 38] }])).toBe("");
  });
});

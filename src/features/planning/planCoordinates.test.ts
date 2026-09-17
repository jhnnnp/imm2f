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

  it("prefers the kakao id when resolving a search result", () => {
    const coords = pickResolvedCoordinates(item("discover:kakao:2", { placeName: "봄스커피" }), [
      { externalPlaceId: "9", name: "봄스커피", coordinates: [127.1, 37.8] },
      { externalPlaceId: "2", name: "봄스커피 포천점", coordinates: [127.2, 37.9] },
    ]);
    expect(coords).toEqual([127.2, 37.9]);
  });

  it("reads the city out of a trip title for search", () => {
    expect(regionHintFromTitle("포천 여행")).toBe("포천");
    expect(regionHintFromTitle("성수 데이트")).toBe("성수");
  });
});

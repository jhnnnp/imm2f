import { afterEach, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { fetchFootRoute } from "@/lib/routing/footRoute";
import { footRouteForDays, routeLegsFitSchedule } from "./recommendDatePlan";

vi.mock("@/lib/routing/footRoute", () => ({ fetchFootRoute: vi.fn() }));
afterEach(() => vi.mocked(fetchFootRoute).mockReset());

function stop(id: string, x: number): DiscoverCandidate {
  return { externalSource: "kakao", externalPlaceId: id, name: id, category: "tourist",
    categoryLabel: "관광지", district: "군산", address: "", roadAddress: "", phone: "", mapUrl: "",
    coordinates: [x, 35.97] };
}

it("assembles pedestrian legs separately for each travel day", async () => {
  const candidates = [stop("a", 126.7), stop("b", 126.71), stop("c", 126.75), stop("d", 126.76)];
  const byId = new Map(candidates.map(candidate => [`kakao:${candidate.externalPlaceId}`, candidate]));
  vi.mocked(fetchFootRoute).mockResolvedValueOnce({ provider: "osm_foot", meters: 900, seconds: 720,
    legs: [{ meters: 900, seconds: 720 }] }).mockResolvedValueOnce({ provider: "osm_foot", meters: 1100, seconds: 850,
      legs: [{ meters: 1100, seconds: 850 }] });
  const rows = candidates.map((candidate, index) => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: index < 2 ? 0 : 1 }));
  const route = await footRouteForDays(rows, byId, 2, 6500);
  expect(vi.mocked(fetchFootRoute)).toHaveBeenCalledTimes(2);
  expect(route?.meters).toBe(2000);
  expect(route?.legs.map(leg => leg.meters)).toEqual([900, 0, 1100]);
});

it("rejects a timed course when the actual walking leg misses the next stop", () => {
  const rows = [
    { id: "kakao:a", day_index: 0, start_time: "17:00", duration_minutes: 60 },
    { id: "kakao:b", day_index: 0, start_time: "18:30", duration_minutes: 60 },
  ];
  expect(routeLegsFitSchedule(rows, [{ meters: 900, seconds: 1200 }])).toBe(true);
  expect(routeLegsFitSchedule(rows, [{ meters: 3000, seconds: 2400 }])).toBe(false);
});

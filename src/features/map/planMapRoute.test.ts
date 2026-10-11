import { expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { planItemsWithCoordinates, syncPlanMapRoadRoute, syncPlanMapRoute } from "@/features/trip/components/planMapRoute";
import type { PlanItem } from "@/features/planning/types/plan";

it("updates route sources while basemap tiles are still loading", () => {
  const setData = vi.fn();
  const map = { isStyleLoaded: () => false, getSource: () => ({ setData }) } as unknown as MapLibreMap;
  syncPlanMapRoute(map, [[127, 37], [127.01, 37.01]]);
  expect(setData).toHaveBeenCalledTimes(7);
  expect(setData.mock.calls[0][0].features[0].geometry.type).toBe("LineString");
  setData.mockClear();
  syncPlanMapRoadRoute(map, [[127, 37], [127.01, 37.01]]);
  expect(setData).toHaveBeenCalledTimes(7);
  expect(setData.mock.calls[0][0].features[0].geometry.coordinates).toEqual([[127, 37], [127.01, 37.01]]);
});

it("does not write to sources before the style has installed them", () => {
  const map = { getSource: () => undefined } as unknown as MapLibreMap;
  expect(() => syncPlanMapRoute(map, [[127, 37], [128, 38]])).not.toThrow();
  expect(() => syncPlanMapRoadRoute(map, [[127, 37], [128, 38]])).not.toThrow();
});

it("excludes missing coordinates instead of inventing a map pin at zero", () => {
  const items = [{ id: "missing", coordinates: [null, null] }, { id: "valid", coordinates: [127, 37] }] as unknown as PlanItem[];
  expect(planItemsWithCoordinates(items).map(item => item.id)).toEqual(["valid"]);
});

it("preserves itinerary numbers across missing and overlapping locations", () => {
  const items = [
    { id: "first", coordinates: [127, 37] },
    { id: "missing", coordinates: null },
    { id: "third", coordinates: [127, 37] },
  ] as unknown as PlanItem[];
  expect(planItemsWithCoordinates(items).map(item => [item.id, item.mapOrder])).toEqual([["first", 1], ["third", 3]]);
});

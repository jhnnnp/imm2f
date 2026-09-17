import { describe, expect, it } from "vitest";
import { buildPlanRoute, cinematicBearing, curveRoute, densifyRoute, hopBox, ribbonWidthMeters, routePlanks, routeRibbon, stopDisc } from "./planRoute";

const seoul: [number, number] = [126.978, 37.5665];
const nearby: [number, number] = [127.01, 37.58];
const farther: [number, number] = [127.04, 37.55];

describe("densifyRoute", () => {
  it("keeps a single point", () => {
    expect(densifyRoute([seoul])).toEqual([seoul]);
  });

  it("inserts in-between points on a segment", () => {
    const path = densifyRoute([seoul, nearby], 4);
    expect(path).toHaveLength(5);
    expect(path[0]).toEqual(seoul);
    expect(path.at(-1)).toEqual(nearby);
    expect(path[2][0]).toBeGreaterThan(seoul[0]);
    expect(path[2][0]).toBeLessThan(nearby[0]);
  });
});

describe("curveRoute", () => {
  it("arcs a two-stop hop instead of drawing a straight cut", () => {
    const path = curveRoute([seoul, nearby]);
    expect(path.length).toBeGreaterThan(8);
    expect(path[0]).toEqual(seoul);
    expect(path.at(-1)).toEqual(nearby);
    const mid = path[Math.floor(path.length / 2)];
    const straightLng = (seoul[0] + nearby[0]) / 2;
    const straightLat = (seoul[1] + nearby[1]) / 2;
    expect(Math.abs(mid[0] - straightLng) + Math.abs(mid[1] - straightLat)).toBeGreaterThan(0.0004);
  });

  it("passes through each waypoint on a longer course", () => {
    const path = curveRoute([seoul, nearby, farther], 8);
    expect(path[0]).toEqual(seoul);
    expect(path.at(-1)).toEqual(farther);
    const nearHit = path.some(point => Math.abs(point[0] - nearby[0]) < 1e-8 && Math.abs(point[1] - nearby[1]) < 1e-8);
    expect(nearHit).toBe(true);
  });
});

describe("routeRibbon", () => {
  it("returns a closed polygon wider than the path", () => {
    const ribbon = routeRibbon(curveRoute([seoul, nearby]), 80);
    expect(ribbon?.type).toBe("Polygon");
    const ring = ribbon?.coordinates[0] ?? [];
    expect(ring.length).toBeGreaterThan(8);
    expect(ring[0]).toEqual(ring.at(-1));
  });
});

describe("cinematicBearing", () => {
  it("turns the camera across the longest hop instead of along it", () => {
    const along = (Math.atan2(nearby[0] - seoul[0], nearby[1] - seoul[1]) * 180) / Math.PI;
    const bearing = cinematicBearing([seoul, nearby]);
    const delta = Math.abs(((bearing - along + 540) % 360) - 180);
    expect(delta).toBeGreaterThan(70);
    expect(delta).toBeLessThan(110);
  });
});

describe("ribbonWidthMeters", () => {
  it("clamps city-scale hops into a readable tube", () => {
    expect(ribbonWidthMeters([seoul])).toBe(48);
    expect(ribbonWidthMeters([seoul, nearby])).toBeGreaterThan(55);
    expect(ribbonWidthMeters([seoul, nearby])).toBeLessThan(221);
  });
});

describe("hopBox", () => {
  it("builds a simple 4-corner corridor between two stops", () => {
    const box = hopBox(seoul, nearby, 120);
    expect(box.coordinates[0]).toHaveLength(5);
    expect(box.coordinates[0][0]).toEqual(box.coordinates[0].at(-1));
    const lngs = box.coordinates[0].map(point => point[0]);
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeGreaterThan(0.001);
  });
});

describe("routePlanks", () => {
  it("builds overlapping boxes along a curved path", () => {
    const planks = routePlanks(curveRoute([seoul, nearby]), 90);
    expect(planks.length).toBeGreaterThan(6);
    expect(planks[0].coordinates[0]).toHaveLength(5);
    expect(planks[0].coordinates[0][0]).toEqual(planks[0].coordinates[0].at(-1));
  });
});

describe("stopDisc", () => {
  it("closes a circular footprint around the pin", () => {
    const disc = stopDisc(seoul, 20, 12);
    expect(disc.coordinates[0]).toHaveLength(13);
    expect(disc.coordinates[0][0]).toEqual(disc.coordinates[0].at(-1));
  });
});

describe("buildPlanRoute", () => {
  it("stacks aura, body, core, and a disc per stop", () => {
    const route = buildPlanRoute([seoul, nearby, farther]);
    expect(route.body.features).toHaveLength(2);
    expect(route.aura.features).toHaveLength(2);
    expect(route.core.features).toHaveLength(2);
    expect(route.stops.features).toHaveLength(3);
    expect(route.nodes.features).toHaveLength(3);
    expect(route.line.features[0]?.geometry.type).toBe("LineString");
    expect(route.segments.features).toHaveLength(2);
    expect(route.body.features[0]?.properties.height).toBeGreaterThan(100);
  });
});

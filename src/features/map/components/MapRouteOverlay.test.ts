import { describe, expect, it } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { buildScreenPath, type RouteAnchor } from "./MapRouteOverlay";

function mockMap(project: (coord: [number, number]) => { x: number; y: number }) {
  return { project: (coord: [number, number]) => project(coord) } as MapLibreMap;
}

describe("buildScreenPath", () => {
  it("snaps segment ends to anchor screen positions including offsets", () => {
    const anchors: RouteAnchor[] = [
      { coordinates: [127, 37], screenOffset: [4, -2], tipOffset: [0, -2] },
      { coordinates: [127.01, 37.01], screenOffset: [-4, 2], tipOffset: [0, -2] },
    ];
    const map = mockMap(coord => ({ x: coord[0] * 1000, y: coord[1] * 1000 }));
    const path = buildScreenPath(map, anchors);
    const first = path.split(" ")[0];
    const last = path.split(" ").at(-1);
    expect(first).toBe(`${127 * 1000 + 4},${37 * 1000 - 2 - 2}`);
    expect(last).toBe(`${127.01 * 1000 - 4},${37.01 * 1000 + 2 - 2}`);
  });

  it("returns empty path for fewer than two anchors", () => {
    const map = mockMap(() => ({ x: 0, y: 0 }));
    expect(buildScreenPath(map, [{ coordinates: [127, 37] }])).toBe("");
  });
});

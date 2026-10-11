import { describe, expect, it } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { buildScreenPath, type RouteAnchor } from "./MapRouteOverlay";

function mockMap(project: (coord: [number, number]) => { x: number; y: number }) {
  return { project: (coord: [number, number]) => project(coord) } as MapLibreMap;
}

describe("buildScreenPath", () => {
  it("keeps segment ends on the actual geographic pin projection", () => {
    const anchors: RouteAnchor[] = [
      { coordinates: [127, 37] },
      { coordinates: [127.01, 37.01] },
    ];
    const map = mockMap(coord => ({ x: coord[0] * 1000, y: coord[1] * 1000 }));
    const path = buildScreenPath(map, anchors);
    const first = path.split(" ")[0];
    const last = path.split(" ").at(-1);
    expect(first).toBe(`${127 * 1000},${37 * 1000}`);
    expect(last).toBe(`${127.01 * 1000},${37.01 * 1000}`);
  });

  it("keeps close and repeated stops attached through camera projection changes", () => {
    const anchors: RouteAnchor[] = [{ coordinates: [127, 37] }, { coordinates: [127.001, 37.001] }, { coordinates: [127, 37] }];
    for (const camera of [{ scale: 20, pan: 0 }, { scale: 2000, pan: -42.15 }, { scale: 150, pan: 19.37 }]) {
      const map = mockMap(coord => ({ x: (coord[0] - 127) * camera.scale + camera.pan, y: (coord[1] - 37) * camera.scale - camera.pan }));
      const points = buildScreenPath(map, anchors).split(" ");
      const first = points[0];
      const middle = points[Math.floor(points.length / 2)];
      const last = points.at(-1);
      const shared = map.project(anchors[0].coordinates);
      const close = map.project(anchors[1].coordinates);
      expect(first).toBe(`${Number(shared.x.toFixed(2))},${Number(shared.y.toFixed(2))}`);
      expect(last).toBe(first);
      expect(middle).toBe(`${Number(close.x.toFixed(2))},${Number(close.y.toFixed(2))}`);
    }
  });

  it("returns empty path for fewer than two anchors", () => {
    const map = mockMap(() => ({ x: 0, y: 0 }));
    expect(buildScreenPath(map, [{ coordinates: [127, 37] }])).toBe("");
  });
});

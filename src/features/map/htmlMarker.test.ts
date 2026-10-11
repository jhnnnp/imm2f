import { describe, expect, it } from "vitest";
import { htmlMarkerPlacement, screenOffsetForStackedPins, screenOffsetsForNearbyPins } from "./htmlMarker";

describe("htmlMarkerPlacement", () => {
  it("keeps HTML markers viewport-aligned with subpixel positioning", () => {
    expect(htmlMarkerPlacement).toEqual({
      anchor: "bottom",
      pitchAlignment: "viewport",
      rotationAlignment: "viewport",
      subpixelPositioning: true,
    });
  });
});

describe("screenOffsetForStackedPins", () => {
  it("does not offset unique coordinates", () => {
    expect(screenOffsetForStackedPins([[126.9, 37.5], [127.0, 37.6]], 0)).toBeUndefined();
  });

  it("fans overlapping pins around the shared point", () => {
    const coordinates: Array<[number, number]> = [
      [126.978, 37.5665],
      [126.978, 37.5665],
      [126.978, 37.5665],
    ];
    const first = screenOffsetForStackedPins(coordinates, 0);
    const second = screenOffsetForStackedPins(coordinates, 1);
    const third = screenOffsetForStackedPins(coordinates, 2);
    expect(first).toEqual([0, -10]);
    expect(second).not.toEqual(first);
    expect(third).not.toEqual(first);
    expect(new Set([first, second, third].map(point => point?.join(","))).size).toBe(3);
  });
});

describe("screenOffsetsForNearbyPins", () => {
  const viewport = { width: 390, height: 680 };
  const positions = (points: { x: number; y: number }[], bounds?: { width: number; height: number }) => {
    const offsets = screenOffsetsForNearbyPins(points, bounds);
    return points.map((point, index) => ({ x: point.x + offsets[index][0], y: point.y + offsets[index][1] }));
  };
  const expectSeparated = (points: { x: number; y: number }[]) => {
    points.forEach((point, index) => points.slice(index + 1).forEach(other => {
      expect(Math.hypot(point.x - other.x, point.y - other.y)).toBeGreaterThanOrEqual(51.99);
    }));
  };

  it("keeps unique projected positions unchanged", () => {
    expect(screenOffsetsForNearbyPins([])).toEqual([]);
    expect(screenOffsetsForNearbyPins([{ x: 100, y: 100 }], viewport)).toEqual([[0, 0]]);
    expect(screenOffsetsForNearbyPins([{ x: 60, y: 100 }, { x: 200, y: 280 }], viewport)).toEqual([[0, 0], [0, 0]]);
  });

  it("separates identical markers around their shared map position", () => {
    const spread = positions([{ x: 180, y: 220 }, { x: 180, y: 220 }], viewport);
    expectSeparated(spread);
    expect((spread[0].x + spread[1].x) / 2).toBe(180);
    expect(spread[0].y).toBe(220);
    expect(spread[1].y).toBe(220);
  });

  it("separates nearby places at low zoom without moving an unrelated place", () => {
    const points = [{ x: 140, y: 180 }, { x: 144, y: 181 }, { x: 320, y: 420 }];
    const offsets = screenOffsetsForNearbyPins(points, viewport);
    expectSeparated(positions(points, viewport));
    expect(offsets[2]).toEqual([0, 0]);
    expect(offsets.slice(0, 2).every(offset => offset.some(value => value !== 0))).toBe(true);
  });

  it("removes spreading once zoom already separates the same places", () => {
    const lowZoom = [{ x: 140, y: 180 }, { x: 144, y: 181 }];
    const highZoom = [{ x: 110, y: 180 }, { x: 230, y: 185 }];
    expect(screenOffsetsForNearbyPins(lowZoom, viewport)).not.toEqual([[0, 0], [0, 0]]);
    expect(screenOffsetsForNearbyPins(highZoom, viewport)).toEqual([[0, 0], [0, 0]]);
  });

  it("keeps a vertically adjacent pair distinguishable", () => {
    const spread = positions([{ x: 180, y: 220 }, { x: 181, y: 224 }], viewport);
    expectSeparated(spread);
    expect(Math.abs(spread[0].y - spread[1].y)).toBe(60);
  });

  it("spreads an entire chained cluster, including points not directly adjacent", () => {
    expectSeparated(positions([{ x: 140, y: 220 }, { x: 180, y: 220 }, { x: 220, y: 220 }], viewport));
  });

  it("keeps clustered marker artwork inside the viewport near its edge", () => {
    const spread = positions([{ x: 3, y: 10 }, { x: 7, y: 12 }, { x: 5, y: 14 }], viewport);
    expectSeparated(spread);
    spread.forEach(point => {
      expect(point.x).toBeGreaterThanOrEqual(28);
      expect(point.x).toBeLessThanOrEqual(viewport.width - 28);
      expect(point.y).toBeGreaterThanOrEqual(58);
      expect(point.y).toBeLessThanOrEqual(viewport.height - 12);
    });
  });

  it("avoids placing a spread cluster over a previously separated marker", () => {
    const points = [{ x: 100, y: 220 }, { x: 104, y: 220 }, { x: 160, y: 220 }];
    expectSeparated(positions(points, viewport));
    expect(screenOffsetsForNearbyPins(points, viewport)[2]).toEqual([0, 0]);
  });

  it("does not pull distant off-screen places into the visible city", () => {
    const points = [{ x: -2000, y: 200 }, { x: -1996, y: 201 }, { x: 4000, y: 1000 }, { x: 4004, y: 1001 }, { x: 180, y: 220 }, { x: 184, y: 220 }];
    const offsets = screenOffsetsForNearbyPins(points, viewport);
    expect(offsets.slice(0, 4)).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
    expectSeparated(positions(points.slice(4), viewport));
  });

  it("fits larger identical clusters into a mobile viewport", () => {
    const points = Array.from({ length: 12 }, () => ({ x: 190, y: 240 }));
    const spread = positions(points, viewport);
    expectSeparated(spread);
    expect(spread.every(point => point.x >= 28 && point.x <= viewport.width - 28 && point.y >= 58 && point.y <= viewport.height - 12)).toBe(true);
  });
});

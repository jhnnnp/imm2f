import { describe, expect, it } from "vitest";
import { htmlMarkerPlacement, screenOffsetForStackedPins } from "./htmlMarker";

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

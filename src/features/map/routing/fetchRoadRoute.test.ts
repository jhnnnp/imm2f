import { describe, expect, it } from "vitest";
import { encodeRouteCoords, parseOsrmRoute } from "./fetchRoadRoute";

describe("encodeRouteCoords", () => {
  it("joins lng,lat pairs with pipe", () => {
    expect(encodeRouteCoords([[127.01, 37.02], [127.03, 37.04]])).toBe("127.01,37.02|127.03,37.04");
  });
});

describe("parseOsrmRoute", () => {
  it("reads geojson coordinates from osrm payload", () => {
    const path = parseOsrmRoute({
      code: "Ok",
      routes: [{ geometry: { coordinates: [[127, 37], [127.01, 37.01]] } }],
    });
    expect(path).toEqual([[127, 37], [127.01, 37.01]]);
  });

  it("returns null when route missing", () => {
    expect(parseOsrmRoute({ code: "NoRoute" })).toBeNull();
  });
});

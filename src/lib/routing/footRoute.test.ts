import { expect, it } from "vitest";
import { parseFootRoute } from "./footRoute";

const coordinates: Array<[number, number]> = [[127.04, 37.56], [127.045, 37.56], [127.05, 37.56]];

it("uses provider legs to report the actual route rather than direct distance", () => {
  const route = parseFootRoute({ code: "Ok", routes: [{ legs: [
    { distance: 620, duration: 510 }, { distance: 580, duration: 480 },
  ] }] }, coordinates);
  expect(route).toMatchObject({ meters: 1200, seconds: 990, provider: "osm_foot" });
  expect(route?.legs.map(leg => leg.meters)).toEqual([620, 580]);
});

it("rejects missing or implausible route legs", () => {
  expect(parseFootRoute({ code: "Ok", routes: [{ legs: [{ distance: 100, duration: 30 }] }] }, coordinates)).toBeNull();
  expect(parseFootRoute({ code: "Ok", routes: [{ legs: [
    { distance: 100, duration: 30 }, { distance: 580, duration: 480 },
  ] }] }, coordinates)).toBeNull();
});

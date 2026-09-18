import { describe, expect, it } from "vitest";
import { isLegacyDemoPlace } from "./legacyDemoPlaces";

describe("legacy demo places", () => {
  it("matches the leftover Gunsan seed rows", () => {
    expect(isLegacyDemoPlace({
      name: "카페 라파르",
      lng: 126.7086,
      lat: 35.9879,
      external_source: "manual",
      external_place_id: null,
    })).toBe(true);
  });

  it("keeps a real place with the same name but different coordinates", () => {
    expect(isLegacyDemoPlace({
      name: "카페 라파르",
      lng: 127.0,
      lat: 37.5,
      external_source: "manual",
      external_place_id: null,
    })).toBe(false);
  });

  it("keeps Kakao-imported places", () => {
    expect(isLegacyDemoPlace({
      name: "초원사진관",
      lng: 126.7108,
      lat: 35.9892,
      external_source: "kakao",
      external_place_id: "abc",
    })).toBe(false);
  });
});

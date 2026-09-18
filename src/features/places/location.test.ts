import { describe, expect, it } from "vitest";
import { locationQueries, pickKakaoLocationHit } from "./location";
import type { KakaoPlaceCandidate } from "./types/place";

function hit(name: string, address: string): KakaoPlaceCandidate {
  return {
    externalSource: "kakao",
    externalPlaceId: name,
    name,
    category: "tourist",
    categoryLabel: "관광지",
    district: "군산시 경암동",
    address,
    roadAddress: address,
    phone: "",
    mapUrl: "",
    coordinates: [126.72, 35.98],
  };
}

describe("pickKakaoLocationHit", () => {
  it("prefers a place whose name matches the saved title", () => {
    const places = [
      hit("군산역", "전북 군산시 해망로 30"),
      hit("경암동 철길마을", "전북 군산시 경촌4길 14"),
    ];
    expect(pickKakaoLocationHit(places, "경암동 철길마을")?.address).toBe("전북 군산시 경촌4길 14");
  });

  it("falls back to the first Kakao hit", () => {
    expect(pickKakaoLocationHit([hit("다른곳", "서울 성수동")], "경암동 철길마을")?.name).toBe("다른곳");
  });
});

describe("locationQueries", () => {
  it("tries the typed address with the place name first", () => {
    expect(locationQueries("경암동 철길마을", "전북 군산시 경촌4길 14")).toEqual([
      "경암동 철길마을 전북 군산시 경촌4길 14",
      "전북 군산시 경촌4길 14",
      "경암동 철길마을",
    ]);
  });
});

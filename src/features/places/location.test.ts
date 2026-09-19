import { describe, expect, it } from "vitest";
import { geocodableAddressVariants, koreanAddressVariants, locationQueries, pickKakaoLocationHit } from "./location";
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

  it("rejects a same-name place in a different province", () => {
    expect(pickKakaoLocationHit(
      [hit("남도밥상", "경남 양산시 용당길 14")], "남도밥상", "전북 군산시 옥도면 선유북길 79 1층",
    )).toBeNull();
  });

  it("accepts an official province name for a short province alias", () => {
    const place = hit("남도밥상", "전북특별자치도 군산시 옥도면 선유북길 79");
    expect(pickKakaoLocationHit([place], "남도밥상", "전북 군산시 옥도면 선유북길 79 1층")).toBe(place);
  });

  it("rejects a different road or building number in the same city", () => {
    const places = [hit("남도밥상", "전북특별자치도 군산시 옥도면 다른길 14")];
    expect(pickKakaoLocationHit(places, "남도밥상", "전북 군산시 옥도면 선유북길 79 1층")).toBeNull();
  });
});

describe("locationQueries", () => {
  it("tries the typed address with the place name first", () => {
    const queries = locationQueries("경암동 철길마을", "전북 군산시 경촌4길 14");
    expect(queries).toContain("경암동 철길마을 전북특별자치도 군산시 경촌4길 14");
    expect(queries).toContain("전라북도 군산시 경촌4길 14");
    expect(queries).not.toContain("경암동 철길마을");
  });
});

describe("koreanAddressVariants", () => {
  it.each([
    ["서울 강남구", "서울특별시 강남구"],
    ["강원도 춘천시", "강원특별자치도 춘천시"],
    ["전라북도 군산시", "전북특별자치도 군산시"],
    ["제주도 제주시", "제주특별자치도 제주시"],
    ["세종시 나성동", "세종특별자치시 나성동"],
  ])("treats %s and %s as equivalent searches", (shortAddress, officialAddress) => {
    expect(koreanAddressVariants(shortAddress)).toContain(officialAddress);
  });
});

describe("geocodableAddressVariants", () => {
  it("retries a detailed address without floor and room information", () => {
    const variants = geocodableAddressVariants("전북 군산시 옥도면 선유북길 79 1층");
    expect(variants).toContain("전북특별자치도 군산시 옥도면 선유북길 79");
    expect(variants).toContain("전라북도 군산시 옥도면 선유북길 79");
  });
});

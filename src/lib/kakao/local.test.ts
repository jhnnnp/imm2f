import { describe, expect, it } from "vitest";
import { isKakaoUtilityGroupCode, mapKakaoCategory } from "./local";

describe("mapKakaoCategory", () => {
  it("maps chip categories from Kakao group codes", () => {
    expect(mapKakaoCategory("CE7", "음식점 > 카페")).toEqual({ id: "cafe", label: "카페" });
    expect(mapKakaoCategory("FD6", "음식점 > 한식")).toEqual({ id: "restaurant", label: "음식점" });
    expect(mapKakaoCategory("AD5", "여행 > 숙박 > 호텔")).toEqual({ id: "stay", label: "숙박" });
    expect(mapKakaoCategory("CT1", "문화,예술 > 미술관")).toEqual({ id: "photo", label: "사진" });
    expect(mapKakaoCategory("", "문화,예술 > 서점")).toEqual({ id: "book", label: "책방" });
  });

  it("splits AT4 into nature versus tourist spots", () => {
    expect(mapKakaoCategory("AT4", "여행 > 관광,명소 > 공원")).toEqual({ id: "nature", label: "자연" });
    expect(mapKakaoCategory("AT4", "여행 > 관광,명소 > 고궁")).toEqual({ id: "tourist", label: "관광지" });
  });
});

describe("isKakaoUtilityGroupCode", () => {
  it("drops convenience, medical, transit, and similar POIs", () => {
    expect(isKakaoUtilityGroupCode("CS2")).toBe(true);
    expect(isKakaoUtilityGroupCode("PM9")).toBe(true);
    expect(isKakaoUtilityGroupCode("SW8")).toBe(true);
    expect(isKakaoUtilityGroupCode("HP8")).toBe(true);
    expect(isKakaoUtilityGroupCode("CE7")).toBe(false);
    expect(isKakaoUtilityGroupCode("AT4")).toBe(false);
  });
});

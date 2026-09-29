import { describe, expect, it } from "vitest";
import { isKakaoUtilityGroupCode, mapKakaoCategory, searchKakaoPlacesRemote } from "./local";

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

describe("shopping discovery", () => {
  it("admits a provider shopping complex only for an explicit shopping search", async () => {
    const previous = process.env.KAKAO_REST_API_KEY;
    process.env.KAKAO_REST_API_KEY = "test-key";
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(JSON.stringify({ documents: [{ id: "101", place_name: "엔터식스 왕십리역점",
      category_name: "가정,생활 > 쇼핑 > 쇼핑몰", category_group_code: "MT1",
      address_name: "서울 성동구 행당동 168-1", x: "127.038", y: "37.561",
      place_url: "https://place.map.kakao.com/101" }], meta: { is_end: true, total_count: 1 } }),
      { status: 200 });
    try {
      const ordinary = await searchKakaoPlacesRemote({ region: "왕십리", query: "쇼핑몰" });
      const shopping = await searchKakaoPlacesRemote({ region: "왕십리", query: "쇼핑몰", includeShopping: true });
      expect(ordinary.ok && ordinary.places).toHaveLength(0);
      expect(shopping.ok && shopping.places.map(place => place.name)).toEqual(["엔터식스 왕십리역점"]);
    } finally {
      global.fetch = originalFetch;
      if (previous === undefined) delete process.env.KAKAO_REST_API_KEY;
      else process.env.KAKAO_REST_API_KEY = previous;
    }
  });
});

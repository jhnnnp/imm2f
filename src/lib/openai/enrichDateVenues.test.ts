import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { acceptVenueObservation, matchesResearchIdentity, conciseVenueObservation, venueResearchTargets } from "./enrichDateVenues";

function candidate(id: string, category: "cafe" | "restaurant"): DiscoverCandidate {
  return { externalSource: "kakao", externalPlaceId: id, name: `${category}${id}`, category,
    categoryLabel: category === "cafe" ? "카페" : "음식점", detailedCategory: category === "cafe" ? "카페 > 커피전문점" : "음식점 > 한식",
    kakaoCategoryGroupCode: category === "cafe" ? "CE7" : "FD6", district: "성동구", address: "", roadAddress: "", phone: "", mapUrl: "", coordinates: [127.04, 37.56] };
}

describe("venue research allocation", () => {
  const venue = { ...candidate("branch", "cafe"), name: "할리스 소월아트홀점", roadAddress: "서울 성동구 왕십리로 281" };
  const fact = { text: "통창 옆 좌석에서 바깥 풍경을 볼 수 있습니다.", sourceUrl: "https://example.com/branch",
    sourceVenueName: venue.name, sourceAddress: venue.roadAddress, sourceExcerpt: "통창 옆으로 마련된 좌석에서 바깥 풍경을 볼 수 있습니다." };
  it("rejects a cafe named after the requested performance venue", () => {
    expect(matchesResearchIdentity({ ...venue, name: "소월아트홀" }, venue.name, venue.roadAddress)).toBe(false);
  });
  it("rejects another branch and similar building numbers", () => {
    expect(matchesResearchIdentity(venue, venue.name, "서울 성동구 왕십리로 2810")).toBe(false);
    expect(matchesResearchIdentity(venue, "할리스 다른지점", venue.roadAddress)).toBe(false);
    expect(matchesResearchIdentity(venue, venue.name, "성동구")).toBe(false);
  });
  it("allows floor numbers without merging them into the building number", () => {
    expect(matchesResearchIdentity(venue, venue.name, "서울특별시 성동구 왕십리로 281 1층")).toBe(true);
    expect(matchesResearchIdentity(venue, venue.name, "서울 성동구 왕십리로 281-1")).toBe(false);
    expect(matchesResearchIdentity({ ...venue, roadAddress: "서울 성동구 무학봉15다길 4" }, venue.name,
      "서울특별시 성동구 무학봉 15다길 4 1층")).toBe(true);
  });
  it("accepts an English parenthetical name but never removes a Korean branch qualifier", () => {
    const cafe = { ...venue, name: "포레드뮤" };
    expect(matchesResearchIdentity(cafe, "포레드뮤(FORET DE MU)", venue.roadAddress)).toBe(true);
    expect(matchesResearchIdentity(cafe, "포레드뮤(성수점)", venue.roadAddress)).toBe(false);
  });
  it("accepts supported branch metadata without claiming independent verification", () => {
    expect(acceptVenueObservation(venue, fact, [fact.sourceUrl])).toMatchObject({ verification: "search_report", sourceExcerpt: fact.sourceExcerpt });
  });
  it("rejects fabricated URLs, missing excerpts and identity mismatches", () => {
    expect(acceptVenueObservation(venue, fact, [])).toBeNull();
    expect(acceptVenueObservation(venue, { ...fact, sourceExcerpt: "" }, [fact.sourceUrl])).toBeNull();
    expect(acceptVenueObservation(venue, { ...fact, sourceVenueName: "소월아트홀" }, [fact.sourceUrl])).toBeNull();
  });
  it("researches six distinct cafes for an aesthetic-cafe request when the pool supports it", () => {
    const meals = Array.from({ length: 20 }, (_, index) => candidate(`m${index}`, "restaurant"));
    const cafes = Array.from({ length: 8 }, (_, index) => candidate(`c${index}`, "cafe"));
    const targets = venueResearchTargets([...meals, ...cafes], { ...emptyDateBrief(), userRequests: ["왕십리에서 예쁜 카페를 가고 싶어"] });
    expect(targets).toHaveLength(12);
    expect(targets.filter(item => item.category === "cafe").length).toBeGreaterThanOrEqual(6);
    expect(new Set(targets.map(item => item.externalPlaceId)).size).toBe(12);
  });

  it("reserves cold-request research capacity for every requested experience", () => {
    const meals = Array.from({ length: 10 }, (_, index) => candidate(`m${index}`, "restaurant"));
    const cafes = Array.from({ length: 10 }, (_, index) => candidate(`c${index}`, "cafe"));
    const exhibits = Array.from({ length: 3 }, (_, index) => ({ ...candidate(`e${index}`, "cafe"),
      name: `전시관${index}`, category: "photo" as const, categoryLabel: "전시관", detailedCategory: "문화시설 > 전시관", kakaoCategoryGroupCode: "CT1" }));
    const state = { ...emptyDateBrief(), activities: ["cafe", "meal", "exhibit"] as Array<"cafe" | "meal" | "exhibit">,
      userRequests: ["예쁜 카페와 저녁 먹고 전시 데이트"] };
    const targets = venueResearchTargets([...cafes, ...meals, ...exhibits], state, 8);
    expect(targets).toHaveLength(8);
    expect(targets.filter(item => item.category === "cafe")).toHaveLength(4);
    expect(targets.some(item => item.category === "restaurant")).toBe(true);
    expect(targets.some(item => item.category === "photo")).toBe(true);
  });

  it("researches destination experiences before filling an overnight trip with cafes", () => {
    const cafes = Array.from({ length: 8 }, (_, index) => candidate(`c${index}`, "cafe"));
    const attractions = Array.from({ length: 5 }, (_, index) => ({ ...candidate(`t${index}`, "cafe"),
      category: "tourist" as const, categoryLabel: "관광명소", detailedCategory: "관광명소", kakaoCategoryGroupCode: "AT4" }));
    const state = { ...emptyDateBrief(), stayKind: "overnight" as const, nights: 1 };
    const targets = venueResearchTargets([...cafes, ...attractions], state, 8);
    expect(targets.filter(item => item.category === "tourist").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps one useful sentence instead of a paragraph inside a compact stop card", () => {
    expect(conciseVenueObservation("한옥 공간에서 차 도구로 직접 차를 우려 마십니다. 누구나 편하게 올 수 있습니다."))
      .toBe("한옥 공간에서 차 도구로 직접 차를 우려 마십니다.");
  });
});

import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { conciseVenueObservation, venueResearchTargets } from "./enrichDateVenues";

function candidate(id: string, category: "cafe" | "restaurant"): DiscoverCandidate {
  return { externalSource: "kakao", externalPlaceId: id, name: `${category}${id}`, category,
    categoryLabel: category === "cafe" ? "카페" : "음식점", detailedCategory: category === "cafe" ? "카페 > 커피전문점" : "음식점 > 한식",
    kakaoCategoryGroupCode: category === "cafe" ? "CE7" : "FD6", district: "성동구", address: "", roadAddress: "", phone: "", mapUrl: "", coordinates: [127.04, 37.56] };
}

describe("venue research allocation", () => {
  it("researches six distinct cafes for an aesthetic-cafe request when the pool supports it", () => {
    const meals = Array.from({ length: 20 }, (_, index) => candidate(`m${index}`, "restaurant"));
    const cafes = Array.from({ length: 8 }, (_, index) => candidate(`c${index}`, "cafe"));
    const targets = venueResearchTargets([...meals, ...cafes], { ...emptyDateBrief(), userRequests: ["왕십리에서 예쁜 카페를 가고 싶어"] });
    expect(targets).toHaveLength(16);
    expect(targets.filter(item => item.category === "cafe").length).toBeGreaterThanOrEqual(6);
    expect(new Set(targets.map(item => item.externalPlaceId)).size).toBe(16);
  });

  it("keeps one useful sentence instead of a paragraph inside a compact stop card", () => {
    expect(conciseVenueObservation("한옥 공간에서 차 도구로 직접 차를 우려 마십니다. 누구나 편하게 올 수 있습니다."))
      .toBe("한옥 공간에서 차 도구로 직접 차를 우려 마십니다.");
  });
});

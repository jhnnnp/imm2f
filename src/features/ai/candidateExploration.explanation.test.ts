import { describe, expect, it } from "vitest";
import type { DiscoverCandidate, VenueObservation } from "@/features/places/types/place";
import { candidateCardExplanation, candidateProviderType, explorationResearchPlan,
  groupExplorationCandidates, type CandidateExplorationPreferences } from "./candidateExploration";

const preferences = (activity: CandidateExplorationPreferences["activities"][number]): CandidateExplorationPreferences => ({
  activities: [activity], cafeQualities: [], cuisines: [], shoppingKinds: [], cultureKinds: [],
  additionalDetails: "", pace: "balanced", provenance: {},
});
const venue: DiscoverCandidate = {
  externalSource: "kakao", externalPlaceId: "taejongdae", name: "태종대 전망대",
  category: "tourist", categoryLabel: "관광명소", detailedCategory: "여행 > 관광,명소 > 전망대",
  district: "부산 영도구", address: "부산 영도구 동삼동 산 29-1", roadAddress: "",
  phone: "", mapUrl: "https://place.map.kakao.com/taejongdae", coordinates: [129.08, 35.05],
};
const fact = (text: string, overrides: Partial<VenueObservation> = {}): VenueObservation => ({
  id: text, text, url: "https://example.com/taejongdae", checkedAt: new Date().toISOString(),
  venueId: "kakao:taejongdae", verification: "source_checked", attribute: "experience", ...overrides,
});

describe("decision-useful candidate descriptions", () => {
  it("explains a lookout's location and unknown night conditions rather than repeating its category", () => {
    const need = explorationResearchPlan(null, preferences("nightview"), "부산").needs[0];
    const result = candidateCardExplanation(venue, need);
    expect(result.label).toBe("분류 기반 후보 · 확인할 점");
    expect(result.text).toContain("부산 영도구");
    expect(result.text).toContain("전망대 분류");
    expect(result.text).toContain("요청한 야경");
    expect(result.text).toContain("야간 개방과 조망 방향");
    expect(result.text).toContain("보장할 수 없어요");
    expect(result.text).not.toMatch(/최고|인기|야경이 아름다운|야간 개방합니다/);
  });

  it("preserves cuisine and food subtype without inventing signature dishes or ratings", () => {
    const meal = { ...venue, name: "부산 갈비집", category: "restaurant" as const,
      categoryLabel: "음식점", detailedCategory: "음식점 > 한식 > 갈비" };
    const plan = explorationResearchPlan(null, preferences("meal"), "부산");
    const result = groupExplorationCandidates({ plan, preferences: preferences("meal"),
      candidates: [meal], session: null })[0].cards[0];
    expect(candidateProviderType(meal)).toBe("한식 · 갈비");
    expect(result.category).toBe("음식점 · 한식 · 갈비");
    expect(result.reason).toContain("대표 메뉴와 가격");
    expect(result.reason).toContain("대기·예약 여부");
    expect(result.reason).not.toMatch(/대표 메뉴는|유명한|맛있는|\d[.]\d점/);
  });

  it("shows two different fresh checked observations instead of losing the second distinguishing feature", () => {
    const need = explorationResearchPlan(null, preferences("nightview"), "부산").needs[0];
    const result = candidateCardExplanation({ ...venue, evidence: [
      fact("해안 절벽을 바라보는 전망 공간이 있습니다."),
      fact("전망 공간 앞에서 해안 산책로가 이어집니다."),
    ] }, need);
    expect(result.label).toBe("확인된 정보");
    expect(result.text).toContain("해안 절벽");
    expect(result.text).toContain("해안 산책로");
    expect(result.text).toContain("야간 개방");
  });

  it("keeps search-reported observations explicitly unconfirmed", () => {
    const need = explorationResearchPlan(null, preferences("nightview"), "부산").needs[0];
    const result = candidateCardExplanation({ ...venue, evidence: [fact("해안 절벽이 보이는 전망 공간입니다.", {
      verification: "search_report", sourceExcerpt: "해안 절벽이 보이는 전망 공간입니다.",
      sourceVenueName: venue.name, sourceAddress: venue.address,
    })] }, need);
    expect(result.label).toBe("검색 자료 · 확인 필요");
    expect(result.text).toContain("해안 절벽");
  });

  it("does not reuse stale or another venue's description", () => {
    const need = explorationResearchPlan(null, preferences("nightview"), "부산").needs[0];
    const result = candidateCardExplanation({ ...venue, evidence: [
      fact("넓은 루프탑이 있습니다.", { checkedAt: "2020-01-01T00:00:00.000Z" }),
      fact("한옥 정원이 있습니다.", { venueId: "kakao:other" }),
    ] }, need);
    expect(result.text).not.toContain("루프탑");
    expect(result.text).not.toContain("한옥 정원");
    expect(result.label).toContain("분류 기반");
  });

  it("does not label an aesthetic or spacious cafe as confirmed merely from its category", () => {
    const options = { ...preferences("cafe"), cafeQualities: ["aesthetic", "spacious"] as const };
    const plan = explorationResearchPlan(null, { ...options, cafeQualities: [...options.cafeQualities] }, "부산");
    const cafe = { ...venue, name: "도시 카페", category: "cafe" as const, categoryLabel: "카페",
      detailedCategory: "음식점 > 카페 > 커피전문점" };
    const result = candidateCardExplanation(cafe, plan.needs[0]);
    expect(result.text).toContain("예쁜 공간·넓은 공간 조건은 아직 확인되지 않았어요");
    expect(result.text).not.toContain("공간이 예쁜 카페예요");
  });

  it("does not turn the requested search area into a verified venue location", () => {
    const need = explorationResearchPlan(null, preferences("nightview"), "부산").needs[0];
    const result = candidateCardExplanation({ ...venue, district: "", address: "", roadAddress: "" }, need);
    expect(result.text).toContain("세부 지역은 확인 전");
    expect(result.text).not.toContain("부산의");
    expect(result.text).not.toContain("부산 권역");
  });

  it("does not repeat a long first fact as its own second observation", () => {
    const need = explorationResearchPlan(null, preferences("nightview"), "부산").needs[0];
    const description = "전망대 안에 해안 절벽이 보이는 공간이 있습니다. "
      + "해안 산책로의 풍경을 볼 수 있는 방문 구간이 이어집니다. ".repeat(5);
    const result = candidateCardExplanation({ ...venue, evidence: [fact(description)] }, need);
    expect(result.text.match(/전망대 안에/g)?.length).toBe(1);
    expect(result.text.length).toBeLessThanOrEqual(650);
  });
});

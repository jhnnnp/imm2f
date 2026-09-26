import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief, isExclusiveCrawl } from "./dateBrief";
import { candidateActivitySlot } from "./dateCourse";
import { courseSelectionScore, decisionUsefulVenueObservation, discoveryCatalog, evaluateCourse, feasibleCourseSeeds, hardCourseProblems, hasRequestedVenueEvidence, usefulVenueEvidence, venueQuality } from "./courseDesign";

function venue(id: string, name: string, category: DiscoverCandidate["category"], x: number): DiscoverCandidate {
  return {
    externalSource: "kakao", externalPlaceId: id, name, category,
    categoryLabel: category === "cafe" ? "카페" : "음식점", district: "성동구",
    address: "", roadAddress: "", phone: "", mapUrl: "", coordinates: [x, 37.56],
    detailedCategory: category === "cafe" ? "카페 > 커피전문점" : "음식점 > 한식",
    kakaoCategoryGroupCode: category === "cafe" ? "CE7" : "FD6",
  };
}

describe("course design", () => {
  it("rejects seafood venues even if an itinerary model selects them", () => {
    const meal = { ...venue("sea", "해물 파스타", "restaurant", 127.039), dishes: "봉골레 파스타" };
    const cafe = venue("c", "동네 카페", "cafe", 127.04);
    const state = { ...emptyDateBrief(), excludedFoods: ["해산물"] };
    const proposal = { theme: "", rows: [meal, cafe].map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    expect(hardCourseProblems(evaluateCourse(proposal, [meal, cafe], state, new Set()).problems))
      .toContain("제외 음식이 포함된 장소");
  });

  it("rejects a course whose known costs exceed the explicit budget", () => {
    const meal = { ...venue("m", "식당", "restaurant", 127.039), expectedCostTwo: 80000 };
    const cafe = { ...venue("c", "카페", "cafe", 127.04), expectedCostTwo: 30000 };
    const proposal = { theme: "", rows: [meal, cafe].map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    expect(hardCourseProblems(evaluateCourse(proposal, [meal, cafe], { ...emptyDateBrief(), budgetWon: 100000 }, new Set()).problems))
      .toContain("확인된 비용이 예산 초과");
  });

  it("keeps concrete dish evidence but does not treat menus as cafe space evidence", () => {
    const cafe = { ...venue("c", "동네 카페", "cafe", 127.04), evidence: [
      { id: "menu", text: "플랫화이트와 수제 티라미수를 제공합니다.", url: "https://example.com/menu", checkedAt: "2026-09-24" },
    ] };
    expect(decisionUsefulVenueObservation(cafe, "플랫화이트와 크루아상을 제공합니다.")).toBe(true);
    expect(hasRequestedVenueEvidence(cafe, { ...emptyDateBrief(), userRequests: ["예쁜 카페"] })).toBe(false);
    expect(hasRequestedVenueEvidence(cafe, emptyDateBrief())).toBe(true);
  });
  it("does not recommend a summer-only dish as the reason for an October meal", () => {
    const meal = { ...venue("m", "청신리", "restaurant", 127.04), evidence: [
      { id: "summer", text: "서대회 무침은 여름 제철 메뉴로 표기되어 있다.", url: "https://example.com/summer", checkedAt: "2026-09-24" },
      { id: "regular", text: "궁중 소갈비찜과 연저육 보쌈을 메뉴로 제시한다.", url: "https://example.com/menu", checkedAt: "2026-09-24" },
    ] };
    expect(usefulVenueEvidence(meal, { ...emptyDateBrief(), dateLabel: "2026-10-09" })?.id).toBe("regular");
  });
  it("counts evidence-covered stops rather than repeated citations for one stop", () => {
    const meal = venue("m", "식당", "restaurant", 127.039);
    const cafe = { ...venue("c", "카페", "cafe", 127.04), evidence: [0, 1, 2].map(index => ({
      id: `e${index}`, text: "정원과 야외 테라스 좌석이 있습니다.", url: `https://example.com/${index}`, checkedAt: "2026-09-24",
    })) };
    const result = evaluateCourse({ theme: "", rows: [meal, cafe].map(place => ({ id: `kakao:${place.externalPlaceId}`, day_index: 0 })) },
      [meal, cafe], emptyDateBrief(), new Set());
    expect(result.evidenceCount).toBe(1);
  });
  it("does not call a hall visit a dated performance without a matching showtime", () => {
    const meal = venue("m", "식당", "restaurant", 127.039);
    const hall = { ...venue("h", "소월아트홀", "photo", 127.04), categoryLabel: "공연장",
      detailedCategory: "문화,예술 > 공연장", kakaoCategoryGroupCode: "CT1" };
    const state = { ...emptyDateBrief(), activities: ["meal", "performance"] as Array<"meal" | "performance">,
      dateLabel: "2026-09-26", userRequests: ["내일 공연 보고 저녁 먹고 싶어"] };
    const proposal = { theme: "", rows: [meal, hall].map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    expect(hardCourseProblems(evaluateCourse(proposal, [meal, hall], state, new Set()).problems))
      .toContain("방문일 공연 회차 미확인");
    expect(evaluateCourse(proposal, [meal, hall], { ...state, userRequests: ["내일 공연장 구경하고 저녁 먹고 싶어"] }, new Set()).problems)
      .not.toContain("방문일 공연 회차 미확인");
  });
  it("keeps scarce performance and cafe candidates in a restaurant-heavy discovery pool", () => {
    const meals = Array.from({ length: 28 }, (_, index) => venue(`m${index}`, `식당${index}`, "restaurant", 127.02 + index * 0.0001));
    const cafes = Array.from({ length: 4 }, (_, index) => venue(`c${index}`, `카페${index}`, "cafe", 127.04 + index * 0.0001));
    const hall = { ...venue("hall", "소월아트홀", "photo", 127.041), categoryLabel: "공연장", detailedCategory: "문화,예술 > 공연장", kakaoCategoryGroupCode: "CT1" };
    const state = { ...emptyDateBrief(), activities: ["meal", "cafe", "performance"] as Array<"meal" | "cafe" | "performance"> };
    const catalog = discoveryCatalog([...meals, ...cafes, hall], state, new Set(), 12);
    expect(catalog.some(candidate => candidate.externalPlaceId === "hall")).toBe(true);
    expect(catalog.filter(candidate => candidate.category === "cafe").length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a generic added stop when it creates a second cafe", () => {
    const candidates = [
      venue("m", "소문난맛함흥냉면전문점", "restaurant", 127.039),
      venue("c1", "봉순이네다락방", "cafe", 127.04),
      venue("c2", "할리스 소월아트홀점", "cafe", 127.041),
    ];
    const state = { ...emptyDateBrief(), preserveExistingPlaces: true, addStop: true, pinOrder: candidates.slice(0, 2).map(candidate => candidate.name), requiredPlaces: candidates.slice(0, 2).map(candidate => candidate.name) };
    const proposal = { theme: "", rows: candidates.map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    const result = evaluateCourse(proposal, candidates, state, new Set());
    expect(hardCourseProblems(result.problems)).toContain("카페 중복");
  });

  it("does not let a model-authored cafe-tour note authorize an extra cafe", () => {
    const meal = venue("m", "냉면집", "restaurant", 127.039);
    const cafe = venue("c1", "봉순이네다락방", "cafe", 127.04);
    const extra = venue("c2", "케이크숲", "cafe", 127.041);
    const state = { ...emptyDateBrief(), conversationNotes: ["카페 투어 중심"],
      userRequests: ["왕십리에서 예쁜 카페와 공연장 데이트", "일정추가"],
      preserveExistingPlaces: true, addStop: true, pinOrder: [meal.name, cafe.name], requiredPlaces: [meal.name, cafe.name] };
    const proposal = { theme: "", rows: [meal, cafe, extra].map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    expect(isExclusiveCrawl(state)).toBe(false);
    expect([meal, cafe, extra].map(candidateActivitySlot)).toEqual(["meal", "cafe", "cafe"]);
    expect(evaluateCourse(proposal, [meal, cafe, extra], state, new Set()).problems).toContain("카페 중복");
  });

  it("rejects a second meal as a generic addition, even when both restaurants are nearby", () => {
    const candidates = [
      venue("m1", "꿩칼국수와 오리전문점", "restaurant", 127.039),
      venue("c", "봉순이네다락방", "cafe", 127.04),
      venue("m2", "소문난맛함흥냉면전문점", "restaurant", 127.0405),
    ];
    const state = { ...emptyDateBrief(), conversationNotes: ["일정 추가"], preserveExistingPlaces: true, addStop: true,
      pinOrder: candidates.slice(0, 2).map(candidate => candidate.name), requiredPlaces: candidates.slice(0, 2).map(candidate => candidate.name) };
    const proposal = { theme: "", rows: candidates.map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    expect(hardCourseProblems(evaluateCourse(proposal, candidates, state, new Set()).problems)).toContain("식사 중복");
  });

  it("prefers a cafe with a sourced space detail, but permits an honest unknown when none exists", () => {
    const meal = venue("m", "파스타 식당", "restaurant", 127.039);
    const cafe = venue("c", "동네 카페", "cafe", 127.04);
    const state = { ...emptyDateBrief(), conversationNotes: ["예쁜 카페에서 쉬고 싶어"] };
    const proposal = { theme: "", rows: [meal, cafe].map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    expect(hardCourseProblems(evaluateCourse(proposal, [meal, cafe], state, new Set()).problems)).not.toContain("카페 공간 근거 부족");
    const withSpace = { ...cafe, externalPlaceId: "c2", name: "테라스 카페", evidence: [{ id: "space", text: "이 지점에는 통창과 테라스 좌석이 있습니다.", url: "https://example.com/cafe", checkedAt: "2026-09-23" }] };
    expect(hardCourseProblems(evaluateCourse(proposal, [meal, cafe, withSpace], state, new Set()).problems)).toContain("카페 공간 근거 부족");
    const better = { theme: "", rows: [meal, withSpace].map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    expect(hardCourseProblems(evaluateCourse(better, [meal, cafe, withSpace], state, new Set()).problems)).not.toContain("카페 공간 근거 부족");
  });

  it("rejects an unrequested repeat of the existing activity when adding a stop", () => {
    const meal = venue("m", "파스타 식당", "restaurant", 127.039);
    const cafe = venue("c", "정원 카페", "cafe", 127.04);
    const hall = { ...venue("h", "소월아트홀", "photo", 127.041), categoryLabel: "공연장", detailedCategory: "문화,예술 > 공연장", kakaoCategoryGroupCode: "CT1" };
    const otherHall = { ...hall, externalPlaceId: "h2", name: "근처 소극장" };
    const candidates = [meal, cafe, hall, otherHall];
    const state = { ...emptyDateBrief(), conversationNotes: ["일정추가"], preserveExistingPlaces: true, addStop: true,
      pinOrder: [meal.name, cafe.name, hall.name], requiredPlaces: [meal.name, cafe.name, hall.name] };
    const proposal = { theme: "", rows: candidates.map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    expect(hardCourseProblems(evaluateCourse(proposal, candidates, state, new Set()).problems)).toContain("추가 경험 중복");
  });

  it("adds a new exhibit experience while preserving the existing meal, cafe and hall", () => {
    const meal = venue("m", "파스타 식당", "restaurant", 127.039);
    const cafe = venue("c", "정원 카페", "cafe", 127.04);
    const hall = { ...venue("h", "소월아트홀", "photo", 127.041), categoryLabel: "공연장", detailedCategory: "문화,예술 > 공연장", kakaoCategoryGroupCode: "CT1" };
    const exhibit = { ...venue("e", "근처 전시관", "photo", 127.042), categoryLabel: "전시관", detailedCategory: "문화,예술 > 전시관", kakaoCategoryGroupCode: "CT1" };
    const state = { ...emptyDateBrief(), conversationNotes: ["일정 추가"], preserveExistingPlaces: true, addStop: true,
      pinOrder: [meal.name, cafe.name, hall.name], requiredPlaces: [meal.name, cafe.name, hall.name],
      discovery: { themes: [], priorities: [], queries: [], transport: "walk" as const,
        requiredActivities: ["meal", "cafe", "performance"] as Array<"meal" | "cafe" | "performance">,
        activityOrder: [], minStops: 4, maxStops: 4 } };
    const seeds = feasibleCourseSeeds([meal, cafe, hall, exhibit], state, new Set());
    expect(evaluateCourse({ theme: "", rows: [meal, cafe, hall, exhibit].map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) }, [meal, cafe, hall, exhibit], state, new Set()).problems).toEqual([]);
    expect(seeds[0]?.rows.map(row => row.id)).toEqual(expect.arrayContaining(["kakao:m", "kakao:c", "kakao:h", "kakao:e"]));
    expect(seeds[0]?.problems).toEqual([]);
  });

  it("prefers venue-specific evidence and rejects an unsupported chain cafe when a local cafe is nearby", () => {
    const meal = venue("m", "냉면집", "restaurant", 127.039);
    const chain = venue("chain", "할리스 소월아트홀점", "cafe", 127.04);
    const local = venue("local", "정원 다락", "cafe", 127.0405);
    const state = emptyDateBrief();
    const proposal = { theme: "", rows: [meal, chain].map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    expect(hardCourseProblems(evaluateCourse(proposal, [meal, chain, local], state, new Set()).problems))
      .toContain("매력 근거 없는 프랜차이즈 카페");
    const researched = { ...chain, evidence: [
      { id: "generic", text: "전국에 500개 매장을 운영하는 프랜차이즈입니다.", url: "https://example.com/brand", checkedAt: "2026-09-23" },
      { id: "branch", text: "이 지점에는 야외 테라스 좌석이 있습니다.", url: "https://example.com/branch", checkedAt: "2026-09-23" },
    ] };
    expect(usefulVenueEvidence(researched, state)?.id).toBe("branch");
  });

  it("does not present addresses, volatile visiting claims or category restatements as recommendation reasons", () => {
    const cafe = venue("c", "케이크숲", "cafe", 127.04);
    expect(decisionUsefulVenueObservation(cafe, "케이크숲은 카페로, 다양한 케이크와 음료를 제공하는 카페입니다.")).toBe(false);
    expect(decisionUsefulVenueObservation(cafe, "서울 성동구에 위치한 카페로 예약 가능하며 12:00부터 운영합니다.")).toBe(false);
    expect(decisionUsefulVenueObservation(cafe, "마당 정원과 야외 테라스 좌석이 있습니다.")).toBe(true);
  });

  it("ignores an observation attributed to a different provider venue", () => {
    const cafe = { ...venue("c", "정원 카페", "cafe", 127.04), evidence: [
      { id: "foreign", venueId: "kakao:other", text: "야외 정원과 통창 좌석이 있습니다.", url: "https://example.com/other", checkedAt: "2026-09-23" },
    ] };
    expect(usefulVenueEvidence(cafe, emptyDateBrief())).toBeUndefined();
  });

  it("does not sacrifice local cohesion for a distant researched cafe on a short neighborhood date", () => {
    const meal = venue("m", "왕십리 식당", "restaurant", 127.039);
    const distant = { ...venue("c", "멀리 있는 한옥 카페", "cafe", 127.064), evidence: [
      { id: "space", text: "한옥 공간에 정원 좌석이 있습니다.", url: "https://example.com/cafe", checkedAt: "2026-09-23" },
    ] };
    const state = { ...emptyDateBrief(), userRequests: ["왕십리에서 저녁 먹고 예쁜 카페"] };
    const proposal = { theme: "", rows: [meal, distant].map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    expect(hardCourseProblems(evaluateCourse(proposal, [meal, distant], state, new Set()).problems)).toContain("한 구간의 이동 부담이 너무 큼");
  });

  it("scores distinctive sourced cafe features above weak or negative space descriptions", () => {
    const state = { ...emptyDateBrief(), userRequests: ["왕십리에서 예쁜 카페"] };
    const base = venue("base", "카페", "cafe", 127.04);
    const source = (text: string) => ({ id: text, text, attribute: "space" as const,
      url: "https://example.com/cafe", checkedAt: "2026-09-24" });
    const strong = { ...base, evidence: [source("통창과 테라스에서 정원이 보이는 공간입니다.")] };
    const weak = { ...base, evidence: [source("안쪽의 좌석 공간이 좁게 느껴졌습니다.")] };
    expect(venueQuality(strong, state)).toBeGreaterThan(venueQuality(weak, state));
    expect(venueQuality(strong, state)).toBeGreaterThan(venueQuality(base, state));
  });

  it("keeps a stable feasible seed unless a model course is materially better", () => {
    const seed = { theme: "", rows: [], score: 50, meters: 600, longestHop: 300, evidenceCount: 2, problems: [] };
    const nearModel = { ...seed, score: 53 };
    const betterModel = { ...seed, score: 60 };
    expect(courseSelectionScore(seed, 800, true)).toBeGreaterThan(courseSelectionScore(nearModel, 800));
    expect(courseSelectionScore(betterModel, 800)).toBeGreaterThan(courseSelectionScore(seed, 800, true));
  });

  it("rejects a different neighborhood even when each individual hop is short", () => {
    const meal = { ...venue("m", "왕십리 식당", "restaurant", 127.039), distanceMeters: 200 };
    const cafe = { ...venue("c", "창신동 카페", "cafe", 127.051), distanceMeters: 1950 };
    const hall = { ...venue("h", "창신동 소극장", "photo", 127.057), distanceMeters: 2350, categoryLabel: "공연장", detailedCategory: "문화,예술 > 공연장", kakaoCategoryGroupCode: "CT1" };
    const state = { ...emptyDateBrief(), areas: ["왕십리"], userRequests: ["왕십리에서 식당 카페 공연장 데이트"] };
    const proposal = { theme: "", rows: [meal, cafe, hall].map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    expect(hardCourseProblems(evaluateCourse(proposal, [meal, cafe, hall], state, new Set()).problems)).toContain("기준 동네에서 먼 장소");
  });
});

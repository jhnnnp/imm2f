import { describe, expect, it } from "vitest";
import {
  DATE_AREA_OPTIONS,
  applyDateDefaults,
  areaScopeMeters,
  courseSize,
  discoveryActivities,
  emptyDateBrief,
  extractAreasFromText,
  extractActivitiesFromText,
  extractCuisine,
  extractStay,
  extractTimeWindow,
  groundedActivities,
  inferSituationActivities,
  isExclusiveCrawl,
  dateSpine,
  isSimpleLocalRequest,
  rescueSearchQueries,
  isTravelPlan,
  matchesIndoorType,
  missingSlot,
  expandedSearchRegions,
  searchIntents,
  withAreas,
} from "./dateBrief";
import type { DiscoverCandidate } from "@/features/places/types/place";

function candidate(overrides: Partial<DiscoverCandidate> = {}): DiscoverCandidate {
  return {
    externalSource: "kakao",
    externalPlaceId: "1",
    name: "코드케이 성수",
    category: "tourist",
    categoryLabel: "문화시설",
    district: "성수",
    address: "",
    roadAddress: "",
    phone: "",
    mapUrl: "",
    coordinates: [127.056, 37.544],
    detailedCategory: "문화,예술 > 방탈출카페",
    ...overrides,
  };
}

describe("dateBrief", () => {
  it("does not force cafe+meal+walk onto an empty brief", () => {
    const next = applyDateDefaults(emptyDateBrief());
    expect(next.activities).toEqual([]);
    expect(next.areaScope).toBe("nearby");
  });

  it("opens a mixed discovery pool when activities are empty", () => {
    const state = applyDateDefaults(withAreas(emptyDateBrief(), ["성수"]));
    expect(state.activities).toEqual([]);
    expect(discoveryActivities(state)).toEqual(["cafe", "meal", "walk", "exhibit"]);
    expect(searchIntents(state).some(intent => intent.category === "cafe")).toBe(true);
    expect(searchIntents(state).some(intent => intent.category === "photo")).toBe(true);
    expect(searchIntents(state).some(intent => intent.category === "nature")).toBe(true);
    expect(searchIntents(state).some(intent => intent.category === "restaurant")).toBe(true);
  });

  it("treats a cafe preference as an anchor, not a cafe-only day", () => {
    const state = applyDateDefaults({
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date",
      activities: ["cafe"],
    });
    expect(isExclusiveCrawl(state)).toBe(false);
    expect(discoveryActivities(state)).toEqual(expect.arrayContaining(["cafe", "meal", "walk"]));
    expect(searchIntents(state).some(intent => intent.category === "restaurant")).toBe(true);
  });

  it("locks search to cafe only on an explicit cafe tour", () => {
    const state = applyDateDefaults({
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date",
      activities: ["cafe"],
      conversationNotes: ["성수 카페 투어"],
    });
    expect(isExclusiveCrawl(state)).toBe(true);
    expect(discoveryActivities(state)).toEqual(["cafe"]);
  });

  it("infers a mix from the situation instead of one global template", () => {
    expect(inferSituationActivities({ message: "성수에서 데이트하고 싶어", areas: ["성수"], stayKind: "date" })).toEqual(["cafe", "walk", "exhibit"]);
    expect(inferSituationActivities({ areas: ["을지로"], stayKind: "date", timeWindow: "evening" })).toEqual(["meal", "cafe"]);
    expect(inferSituationActivities({ areas: ["강남"], stayKind: "date" })).toEqual(["meal", "cafe"]);
    expect(inferSituationActivities({ areas: ["포천"], stayKind: "overnight" })).toEqual(["walk", "meal"]);
    expect(inferSituationActivities({ message: "카페 투어 하고 싶어", areas: ["성수"] })).toEqual(["cafe"]);
    expect(groundedActivities("성수에서 데이트하고 싶어", undefined, ["cafe", "walk", "exhibit"])).toEqual([]);
    expect(groundedActivities("성수에서 데이트하고 싶어", undefined, ["cafe"])).toEqual([]);
    expect(groundedActivities("성수에서 데이트하고 싶어", undefined, ["meal", "walk", "exhibit"])).toEqual([]);
    expect(groundedActivities("강남에서 데이트하고 싶어", undefined, ["meal", "walk", "exhibit"])).toEqual([]);
    expect(groundedActivities("강남에서 데이트하고 싶어", undefined, ["meal", "cafe"])).toEqual([]);
    expect(groundedActivities("성수에서 전시 보고 싶어", undefined, ["exhibit", "cafe"])).toEqual(["exhibit"]);
    expect(groundedActivities("카페 변경 해줘", undefined, ["cafe"])).toEqual([]);
    expect(rescueSearchQueries("성수", ["cafe", "walk", "exhibit"]).some(query => query.includes("맛집"))).toBe(false);
    expect(rescueSearchQueries("강남", ["meal", "cafe"]).some(query => query.includes("공원"))).toBe(false);
  });

  it("extracts dish-based cuisine and known neighborhoods outside the old whitelist", () => {
    expect(extractCuisine("파스타 먹고 싶어")).toBe("양식");
    expect(extractCuisine("라멘 먹자")).toBe("일식");
    expect(extractAreasFromText("판교에서 데이트하고 싶어")).toContain("판교");
    expect(extractAreasFromText("문래 한 바퀴")).toContain("문래");
  });

  it("does not treat dinner food talk as an evening time window", () => {
    expect(extractTimeWindow("저녁 먹고 싶어")).toBeNull();
    expect(extractTimeWindow("저녁부터 시작하고 싶어")).toBe("evening");
  });

  it("asks stay length before planning, not the clock", () => {
    const withArea = withAreas(emptyDateBrief(), ["을지로"]);
    expect(missingSlot(withArea)).toBe("span");
    expect(extractStay("성수에서 데이트하고 싶어")).toEqual({ stayKind: "date", nights: 0 });
    expect(extractStay("성수 갈래")).toEqual({ stayKind: "date", nights: 0 });
    expect(extractStay("제주 갈래")).toBeNull();
    expect(missingSlot({ ...withArea, stayKind: "date" })).toBeNull();
    expect(extractStay("군산 1박2일")).toEqual({ stayKind: "overnight", nights: 1 });
    expect(courseSize({ ...withArea, stayKind: "date", timeWindow: "evening" }).min).toBe(2);
    expect(courseSize({
      ...withArea,
      stayKind: "date",
      timeWindow: "evening",
      pinOrder: ["레온갤러리 성수커넥트", "언더스탠드에비뉴 아트스탠드"],
      preserveExistingPlaces: true,
      addStop: true,
    }).min).toBe(3);
    expect(courseSize({ ...withArea, stayKind: "date", timeWindow: "afternoon" }).min).toBe(2);
    expect(courseSize({ ...withArea, stayKind: "date", timeWindow: "afternoon" }).max).toBe(4);
    expect(courseSize({ ...withArea, stayKind: "date", timeWindow: "evening" }).max).toBe(3);
    expect(courseSize({ ...withAreas(emptyDateBrief(), ["강남"]), stayKind: "date", timeWindow: "afternoon", activities: ["meal", "cafe"] }).min).toBe(2);
    expect(courseSize({ ...withArea, stayKind: "overnight", nights: 1 }).min).toBe(4);
  });

  it("keeps 을지로 as the keyword hub and searches date-like meals", () => {
    const state = applyDateDefaults(withAreas(emptyDateBrief(), ["을지로"]));
    expect(expandedSearchRegions(state)).toEqual(expect.arrayContaining(["을지로", "청계천", "충무로", "명동"]));
    expect(searchIntents(state).every(intent => intent.region === "을지로")).toBe(true);
    expect(searchIntents(state).some(intent => intent.category === "restaurant")).toBe(true);
    expect(searchIntents(state).some(intent => intent.query === "파스타")).toBe(false);
    expect(searchIntents(state).some(intent => intent.category === "restaurant" && !intent.query)).toBe(true);
    expect(searchIntents(state).some(intent => intent.category === "photo")).toBe(true);
    expect([...DATE_AREA_OPTIONS]).toContain("을지로");
  });

  it("matches indoor venues by category path, not shop name", () => {
    expect(matchesIndoorType(candidate(), "방탈출")).toBe(true);
    expect(matchesIndoorType(candidate({ name: "레드버튼", detailedCategory: "레저 > 보드게임카페" }), "보드게임")).toBe(true);
    expect(matchesIndoorType(candidate(), "볼링")).toBe(false);
  });

  it("treats 포천 여행 as a wide attraction search, not a cafe crawl", () => {
    expect(extractAreasFromText("포천 여행 짜줘")).toContain("포천");
    expect(isSimpleLocalRequest("포천 여행 짜줘")).toBe(true);
    expect(isSimpleLocalRequest("포천 산정호수 가고싶어")).toBe(false);
    const state = applyDateDefaults({
      ...withAreas(emptyDateBrief(), ["포천"]),
      stayKind: "overnight",
      nights: 1,
    });
    expect(isTravelPlan(state)).toBe(true);
    expect(areaScopeMeters(state)).toBe(15000);
    expect(discoveryActivities(state)).toEqual(["walk", "meal"]);
    expect(searchIntents(state).some(intent => intent.query === "관광지")).toBe(true);
    expect(searchIntents(state).some(intent => intent.category === "tourist")).toBe(true);
  });

  it("opens indoor-friendly discovery on a rainy day without locking to cafe", () => {
    const state = applyDateDefaults({
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date",
      conversationNotes: ["비 오는 날 실내 데이트"],
    });
    expect(extractActivitiesFromText("비 오는 날 실내 데이트")).toEqual([]);
    expect(discoveryActivities(state)).toEqual(["indoor", "exhibit", "cafe", "meal"]);
  });

  it("fixes the date spine from situation instead of named activities alone", () => {
    const afternoon = applyDateDefaults({
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date",
      timeWindow: "afternoon",
    });
    expect(dateSpine(afternoon)).toEqual(["meal", "cafe", "walk"]);
    const evening = applyDateDefaults({
      ...withAreas(emptyDateBrief(), ["왕십리"]),
      stayKind: "date",
      timeWindow: "evening",
    });
    expect(dateSpine(evening)).toEqual(["meal", "cafe"]);
    const cafeTour = applyDateDefaults({
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date",
      activities: ["cafe"],
      conversationNotes: ["성수 카페 투어"],
    });
    expect(dateSpine(cafeTour)).toEqual(["cafe"]);
    const rain = applyDateDefaults({
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date",
      conversationNotes: ["비 오는 날 실내 데이트"],
    });
    expect(dateSpine(rain)).toEqual(["indoor", "cafe", "meal"]);
    const namedCafe = applyDateDefaults({
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date",
      timeWindow: "afternoon",
      activities: ["cafe"],
    });
    expect(dateSpine(namedCafe)).toEqual(["meal", "cafe", "walk"]);
    const gangnam = applyDateDefaults({
      ...withAreas(emptyDateBrief(), ["강남"]),
      stayKind: "date",
      timeWindow: "afternoon",
    });
    expect(dateSpine(gangnam)).toEqual(["meal", "cafe"]);
  });
});

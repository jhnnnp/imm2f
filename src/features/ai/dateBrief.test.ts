import { describe, expect, it } from "vitest";
import {
  DATE_AREA_OPTIONS,
  applyDateDefaults,
  areaScopeMeters,
  courseSize,
  discoveryActivities,
  emptyDateBrief,
  extractAreasFromText,
  extractRequestedAreasFromText,
  extractActivitiesFromText,
  extractCuisine,
  extractPlacesFromText,
  extractStay,
  extractTimeWindow,
  groundedActivities,
  groundedAreas,
  inferSituationActivities,
  isExclusiveCrawl,
  dateSpine,
  isSimpleLocalRequest,
  rescueSearchQueries,
  isTravelPlan,
  matchesIndoorType,
  matchesActivity,
  matchesCuisine,
  matchesTerm,
  planDayYmd,
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
  it("classifies an official restaurant's cuisine from its sourced menu even with a generic provider category", () => {
    const meal = candidate({ externalSource: "tourapi", category: "restaurant", categoryLabel: "음식점",
      name: "성수 식당", detailedCategory: "음식점", dishes: "대표 메뉴: 파스타, 리조또" });
    expect(matchesCuisine(meal, "양식")).toBe(false);
    expect(matchesCuisine({ ...meal, factSourceUrl: "https://www.data.go.kr/data/15101578/openapi.do" }, "양식")).toBe(true);
    expect(matchesCuisine({ ...meal, factSourceUrl: "https://www.data.go.kr/data/15101578/openapi.do" }, "일식")).toBe(false);
  });
  it.each([
    ["서울역에서 출발해서 부산 1박2일 여행", ["부산"]],
    ["성수에서 출발해서 강릉 여행 갈래", ["강릉"]],
    ["출발지는 홍대, 부산 2박3일", ["부산"]],
    ["대전역에서 출발해 제주 여행", ["제주"]],
    ["부산 여행은 서울역에서 출발", ["부산"]],
    ["성수에서 출발해 홍대 갔다가 성수 카페도 들러줘", ["홍대", "성수"]],
  ])("keeps departure locations separate from requested destinations: %s", (message, areas) => {
    expect(extractRequestedAreasFromText(message as string)).toEqual(expect.arrayContaining(areas as string[]));
    expect(extractRequestedAreasFromText(message as string)).toHaveLength(areas.length);
  });
  it.each(["조용한 여행 일정 짜줘", "대중교통으로 여행 갈래", "자가용으로 여행", "도보로 이동"])
  ("does not treat route choices or adjectives as a destination: %s", message => {
    expect(extractRequestedAreasFromText(message)).toEqual([]);
  });
  it("removes rejected destinations from searches while retaining an explicitly added destination", () => {
    expect(extractRequestedAreasFromText("부산 말고 제주로 변경해줘")).toEqual(["제주"]);
    expect(extractRequestedAreasFromText("부산이 아니라 제주로 바꿔줘")).toEqual(["제주"]);
    expect(extractRequestedAreasFromText("부산 아니고 제주로 변경해줘")).toEqual(["제주"]);
    expect(extractRequestedAreasFromText("성수동은 제외하고 홍대로 바꿔줘")).toEqual(["홍대"]);
    expect(extractRequestedAreasFromText("부산도 좋고 제주도 좋아")).toEqual(expect.arrayContaining(["부산", "제주"]));
    expect(groundedAreas("부산은 빼고 제주도 추가해줘", { ...emptyDateBrief(), areas: ["부산"] }, ["부산", "제주"]))
      .toEqual(["제주"]);
    expect(groundedAreas("제주도 추가해줘", { ...emptyDateBrief(), areas: ["부산"] }, ["부산", "제주"]))
      .toEqual(["부산", "제주"]);
  });
  it("uses the newly requested cuisine rather than the earlier rejected one", () => {
    expect(extractCuisine("한식 말고 양식으로 바꿔줘")).toBe("양식");
    expect(extractCuisine("양식은 빼고 일식으로 골라줘")).toBe("일식");
    expect(extractCuisine("음식 종류는 상관없어. 한식이나 양식도 좋아")).toBe("any");
    expect(extractCuisine("라멘은 못 먹어")).toBeNull();
  });

  it("retains every explicitly named landmark instead of cutting the fifth place", () => {
    expect(extractPlacesFromText("청계천 한강 남산 광화문 덕수궁 경복궁 북촌 모두 넣어줘"))
      .toEqual(expect.arrayContaining(["청계천", "한강", "남산", "광화문", "덕수궁", "경복궁", "북촌"]));
  });

  it("uses the latest requested trip length after an explicit replacement", () => {
    expect(extractStay("부산 2박3일 말고 1박2일로 바꿔줘")).toEqual({ stayKind: "overnight", nights: 1 });
    expect(extractStay("부산 2박3일은 취소하고 당일치기로")).toEqual({ stayKind: "daytrip", nights: 0 });
  });
  it("normalizes Korean dates with single digit months or days for event matching", () => {
    expect(planDayYmd({ dateLabel: "2026년 10월 3일" })).toBe("20261003");
    expect(planDayYmd({ dateLabel: "2026-10-03" })).toBe("20261003");
  });
  it("does not read colloquial travel wording as a second district", () => {
    expect(extractAreasFromText("부산 여행가려구")).toEqual(["부산"]);
    expect(extractAreasFromText("부산여행가려구")).toEqual(["부산"]);
    expect(extractAreasFromText("부산여행갈래")).toEqual(["부산"]);
    expect(extractAreasFromText("목포 가려구")).toEqual(["목포"]);
    expect(extractAreasFromText("서울 강남구에서 데이트")).toContain("강남구");
  });

  it("keeps the actual neighborhood when an itinerary connects activity nouns", () => {
    const message = "로우키커피 헤이그라운드점을 포함해서 성수에서 식사, 카페, 산책으로 이어지는 여유로운 데이트 코스를 만들어줘";
    expect(extractAreasFromText(message)).toEqual(["성수"]);
    expect(extractRequestedAreasFromText(message)).toEqual(["성수"]);
    expect(groundedAreas(message, undefined, ["성수", "산책"])).toEqual(["성수"]);
  });

  it.each(["산책으로", "카페에서", "전시에서", "실내 활동으로", "보드게임으로", "식사는 양식으로", "체험으로", "쇼핑으로"])
  ("does not interpret an experience as an additional area: %s", experience => {
    expect(extractAreasFromText(`성수에서 ${experience} 이어지는 코스를 만들어줘`)).toEqual(["성수"]);
  });

  it.each(["조용한 분위기로 카페 추천해줘", "로맨틱한느낌으로 데이트하고 싶어", "조용한곳으로 가고 싶어",
    "근처에서 데이트", "야외에서 산책", "실내로 여행", "도시로 여행", "당일치기로 떠날래", "데이트하고싶어", "여행가려구", "추천해줘", "안녕", "고마워", "상관없어"])
  ("does not turn conversational preferences into a destination: %s", message => {
    expect(extractAreasFromText(message)).toEqual([]);
    expect(groundedAreas(message, undefined, ["분위기", "서울"])).toEqual([]);
    expect(groundedAreas(message, withAreas(emptyDateBrief(), ["증평"]), ["분위기", "서울"])).toEqual(["증평"]);
  });

  it("keeps a real destination when preferences use the same destination particles", () => {
    const message = "성수에서 여유로운 분위기로 카페에 가고 싶어";
    expect(extractRequestedAreasFromText(message)).toEqual(["성수"]);
    expect(groundedAreas(message, undefined, ["성수", "분위기"])).toEqual(["성수"]);
  });

  it.each(["증평", "대전", "목포", "남해", "영도", "식사동", "영화동", "봉화", "구로", "세종로"])
  ("keeps an explicitly named custom destination outside the catalogue: %s", destination => {
    expect(extractRequestedAreasFromText(`${destination}에서 조용한 분위기로 여행하고 싶어`)).toEqual([destination]);
    expect(extractRequestedAreasFromText(destination)).toEqual([destination]);
  });

  it("retains an independently mentioned shorter locality alongside a custom destination", () => {
    expect(extractRequestedAreasFromText("세종로에서 시작해서 종로도 가자")).toEqual(expect.arrayContaining(["세종로", "종로"]));
  });

  it("preserves unknown localities whose names include an activity word", () => {
    expect(extractRequestedAreasFromText("식사동에서 카페와 산책으로 이어지는 코스")).toEqual(["식사동"]);
    expect(extractRequestedAreasFromText("영화동에서 전시와 실내 활동으로 이어지는 코스")).toEqual(["영화동"]);
    expect(extractRequestedAreasFromText("증평에서 식사와 산책으로 이어지는 코스")).toEqual(["증평"]);
    expect(extractAreasFromText("산책카페에서 시작하고 증평으로 이동해줘")).toEqual(["산책카페", "증평"]);
  });

  it("keeps a theater distinct from a cafe named after the theater", () => {
    const theater = candidate({ name: "소월아트홀", category: "photo", categoryLabel: "공연장", detailedCategory: "문화시설 > 공연장" });
    const cafe = candidate({ name: "할리스 소월아트홀", category: "cafe", categoryLabel: "카페", kakaoCategoryGroupCode: "CE7", detailedCategory: "카페 > 커피전문점" });
    expect(matchesActivity(theater, "performance")).toBe(true);
    expect(matchesActivity(cafe, "performance")).toBe(false);
    expect(matchesTerm(cafe, "소월아트홀")).toBe(false);
    expect(matchesTerm(theater, "소월아트홀")).toBe(true);
  });
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
    expect(groundedActivities("왕십리에서 저녁 먹고 예쁜 카페에 들른 뒤 실제 공연을 보고 싶어", undefined, ["meal", "cafe"]))
      .toEqual(expect.arrayContaining(["meal", "cafe", "performance"]));
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

  it("asks stay length only for travel destinations, never the clock", () => {
    const withArea = withAreas(emptyDateBrief(), ["을지로"]);
    expect(missingSlot(withArea)).toBeNull();
    expect(missingSlot(withAreas(emptyDateBrief(), ["제주"]))).toBe("span");
    expect(missingSlot({ ...withAreas(emptyDateBrief(), ["제주"]), stayKind: "daytrip" })).toBeNull();
    expect(extractStay("성수에서 데이트하고 싶어")).toEqual({ stayKind: "date", nights: 0 });
    expect(extractStay("성수 갈래")).toEqual({ stayKind: "date", nights: 0 });
    expect(extractStay("제주 갈래")).toBeNull();
    expect(missingSlot({ ...withArea, stayKind: "date" })).toBeNull();
    expect(extractStay("군산 1박2일")).toEqual({ stayKind: "overnight", nights: 1 });
    expect(extractStay("부산 3박4일 여행")).toEqual({ stayKind: "overnight", nights: 3 });
    expect(extractStay("부산 5박 6일 여행")).toEqual({ stayKind: "overnight", nights: 5 });
    expect(courseSize({ ...withArea, stayKind: "overnight", nights: 6 }).days).toBe(7);
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
    expect(dateSpine({ ...evening, activities: ["meal", "cafe", "performance"],
      userRequests: ["저녁 먹고 예쁜 카페에 들른 뒤 실제 공연을 보고 싶어"] }))
      .toEqual(expect.arrayContaining(["meal", "cafe", "performance"]));
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

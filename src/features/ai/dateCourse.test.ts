import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief, withAreas } from "./dateBrief";
import {
  allowsHarshDateMeal,
  applyCourseDelta,
  claimContradictsPlace,
  courseQuickReplyMessage,
  courseSuggestions,
  diversifyDateCatalog,
  groundedStopReason,
  isOffDateVenue,
  isSwapRequest,
  orderByRoute,
  proximityToAreaScore,
  capLongHops,
  scoreDateCandidate,
  spreadConsecutiveStops,
  validateModelRows,
} from "./dateCourse";

function candidate(overrides: Partial<DiscoverCandidate> = {}): DiscoverCandidate {
  return {
    externalSource: "kakao",
    externalPlaceId: overrides.externalPlaceId ?? "1",
    name: "성수 카페",
    category: "cafe",
    categoryLabel: "카페",
    district: "성수",
    address: "",
    roadAddress: "",
    phone: "",
    mapUrl: "",
    coordinates: [127.056, 37.544],
    detailedCategory: "음식점 > 카페",
    kakaoCategoryGroupCode: "CE7",
    ...overrides,
  };
}

const cafe = candidate({ externalPlaceId: "c1", name: "성수 카페", coordinates: [127.056, 37.544] });
const meal = candidate({
  externalPlaceId: "m1",
  name: "성수 식당",
  category: "restaurant",
  categoryLabel: "맛집",
  kakaoCategoryGroupCode: "FD6",
  detailedCategory: "음식점 > 한식",
  coordinates: [127.057, 37.545],
});
const park = candidate({
  externalPlaceId: "p1",
  name: "서울숲",
  category: "nature",
  categoryLabel: "자연",
  kakaoCategoryGroupCode: "AT4",
  detailedCategory: "여행 > 공원",
  coordinates: [127.037, 37.544],
});
const otherCafe = candidate({
  externalPlaceId: "c2",
  name: "성수 다른 카페",
  coordinates: [127.058, 37.546],
});

describe("dateCourse", () => {
  it("keeps geographic order instead of cafe-then-meal", () => {
    const ordered = orderByRoute([park, meal, cafe], emptyDateBrief());
    expect(ordered[0]?.name).toBe("서울숲");
    expect(ordered.map(item => item.name)).not.toEqual(["성수 카페", "성수 식당", "서울숲"]);
  });

  it("does not fill missing activities as a checklist", () => {
    const state = {
      ...withAreas(emptyDateBrief(), ["성수"]),
      activities: ["cafe", "meal", "walk"] as Array<"cafe" | "meal" | "walk">,
      stayKind: "date" as const,
      timeWindow: "evening" as const,
    };
    const rows = validateModelRows(
      [{ id: "kakao:c1", reasons: ["카페"] }, { id: "kakao:m1", reasons: ["식사"] }],
      [cafe, meal, park],
      state,
    );
    expect(rows.some(row => row.id === "kakao:p1")).toBe(false);
    expect(rows.map(row => row.id)).toEqual(["kakao:c1", "kakao:m1"]);
  });

  it("drops a restaurant when meal was not requested", () => {
    const state = { ...withAreas(emptyDateBrief(), ["성수"]), activities: ["cafe" as const] };
    const rows = validateModelRows(
      [{ id: "kakao:c1" }, { id: "kakao:m1" }],
      [cafe, meal, otherCafe],
      state,
    );
    expect(rows.map(row => row.id)).toEqual(["kakao:c1", "kakao:c2"]);
  });

  it("shows compact course action chips in one row", () => {
    expect(courseSuggestions(emptyDateBrief(), [
      { name: "성수 카페", category: "카페" },
      { name: "성수 식당", category: "맛집" },
    ])).toEqual(["식당변경", "카페변경", "일정추가", "일정제외"]);
    expect(courseQuickReplyMessage("카페변경")).toBe("카페 변경 해줘");
    expect(courseQuickReplyMessage("일정제외")).toBe("한 곳 빼줘");
  });

  it("excludes the current cafe on a swap request", () => {
    const state = applyCourseDelta({
      message: "카페 변경 해줘",
      state: withAreas(emptyDateBrief(), ["성수"]),
      previousStops: [
        { name: "성수 카페", category: "카페" },
        { name: "성수 식당", category: "맛집" },
      ],
    });
    expect(isSwapRequest("카페 변경 해줘")).toBe(true);
    expect(isSwapRequest("식당 변경 해줘")).toBe(true);
    expect(state.excludedPlaces).toContain("성수 카페");
    expect(state.requiredPlaces).toContain("성수 식당");
    expect(state.requiredPlaces).not.toContain("성수 카페");
  });

  it("penalizes recently visited places in ranking", () => {
    const ctx = {
      savedPositive: new Set<string>(),
      recentlyVisited: new Set(["성수 카페"]),
      commonTastes: [] as string[],
      activities: [],
    };
    expect(scoreDateCandidate(otherCafe, ctx)).toBeGreaterThan(scoreDateCandidate(cafe, ctx));
  });

  it("does not rank a next-door shop above a short walk in the same neighborhood", () => {
    expect(proximityToAreaScore(800)).toBeGreaterThan(proximityToAreaScore(40));
    expect(proximityToAreaScore(800)).toBeGreaterThan(proximityToAreaScore(3000));
  });

  it("routes to a walkable hop instead of the closest storefront", () => {
    const nextDoor = candidate({ externalPlaceId: "c3", name: "바로 옆 카페", coordinates: [127.05605, 37.54402] });
    const walk = candidate({
      externalPlaceId: "p2",
      name: "조금 떨어진 공원",
      category: "nature",
      categoryLabel: "자연",
      kakaoCategoryGroupCode: "AT4",
      detailedCategory: "여행 > 공원",
      coordinates: [127.061, 37.544],
    });
    const ordered = orderByRoute([cafe, nextDoor, walk], emptyDateBrief());
    expect(ordered[0]?.name).toBe("성수 카페");
    expect(ordered[1]?.name).toBe("조금 떨어진 공원");
  });

  it("keeps farther neighborhood venues in the catalog", () => {
    const close = Array.from({ length: 20 }, (_, index) => candidate({
      externalPlaceId: `close-${index}`,
      name: `가까운 ${index}`,
      distanceMeters: 40 + index,
    }));
    const stretch = candidate({
      externalPlaceId: "stretch",
      name: "익선동 카페",
      distanceMeters: 1100,
    });
    const catalog = diversifyDateCatalog([...close, stretch], 12);
    expect(catalog.some(item => item.name === "익선동 카페")).toBe(true);
  });

  it("replaces a next-door stop with a short walk", () => {
    const nextDoor = candidate({ externalPlaceId: "c3", name: "바로 옆 카페", coordinates: [127.05605, 37.54402] });
    const walkCafe = candidate({ externalPlaceId: "c4", name: "산책 후 카페", coordinates: [127.061, 37.544] });
    const rows = spreadConsecutiveStops(
      [{ id: "kakao:c1" }, { id: "kakao:c3" }],
      [cafe, nextDoor, walkCafe],
    );
    expect(rows.map(row => row.id)).toEqual(["kakao:c1", "kakao:c4"]);
  });

  it("replaces a far landmark hop with a walkable stop", () => {
    const tower = candidate({
      externalPlaceId: "t1",
      name: "남산타워",
      category: "tourist",
      categoryLabel: "전망대",
      coordinates: [126.988, 37.551],
    });
    const walkExhibit = candidate({
      externalPlaceId: "e1",
      name: "청계천 전시",
      category: "tourist",
      categoryLabel: "전시관",
      coordinates: [127.06, 37.544],
    });
    const rows = capLongHops(
      [{ id: "kakao:c1" }, { id: "kakao:t1" }],
      [cafe, tower, walkExhibit],
    );
    expect(rows.map(row => row.id)).toEqual(["kakao:c1", "kakao:e1"]);
  });

  it("drops extra exhibits on an open date and prefers cafe or meal", () => {
    const exhibit = (id: string, name: string): DiscoverCandidate => candidate({
      externalPlaceId: id,
      name,
      category: "tourist",
      categoryLabel: "전시관",
      kakaoCategoryGroupCode: "CT1",
      detailedCategory: "문화,예술 > 전시관",
      coordinates: [127.056, 37.544],
    });
    const state = {
      ...withAreas(emptyDateBrief(), ["을지로"]),
      stayKind: "date" as const,
      timeWindow: "afternoon" as const,
    };
    const rows = validateModelRows(
      [{ id: "kakao:e1" }, { id: "kakao:e2" }, { id: "kakao:e3" }],
      [exhibit("e1", "전시1"), exhibit("e2", "전시2"), exhibit("e3", "전시3"), cafe, meal],
      state,
    );
    const ids = rows.map(row => row.id);
    expect(ids.filter(id => id.startsWith("kakao:e")).length).toBe(1);
    expect(ids.some(id => id === "kakao:c1" || id === "kakao:m1")).toBe(true);
  });

  it("treats 남산 as N서울타워 and rebuilds when asked to redo", () => {
    const state = applyCourseDelta({
      message: "남산 빼고 익선동에서만 다시 짜줘",
      state: withAreas(emptyDateBrief(), ["을지로"]),
      previousStops: [
        { name: "KF XR 갤러리", category: "전시관" },
        { name: "N서울타워", category: "전망대" },
      ],
    });
    expect(state.excludedPlaces.some(name => /서울타워|남산/.test(name))).toBe(true);
    expect(state.preserveExistingPlaces).toBe(false);
    expect(state.requiredPlaces).toEqual([]);
    expect(state.areas).toEqual(expect.arrayContaining(["익선동"]));
  });

  it("does not describe pizza as Korean food", () => {
    const pizza = candidate({
      externalPlaceId: "pz",
      name: "경일옥핏제리아",
      category: "restaurant",
      categoryLabel: "맛집",
      kakaoCategoryGroupCode: "FD6",
      detailedCategory: "음식점 > 양식 > 피자",
    });
    expect(claimContradictsPlace("한식으로 저녁을 기대하게 만드는 맛집이에요.", pizza)).toBe(true);
    expect(groundedStopReason({ candidate: pizza, previous: cafe, meters: 749 })).toContain("749");
    expect(groundedStopReason({ candidate: pizza, previous: cafe, meters: 749 })).not.toContain("한식");
  });

  it("keeps gallery and cafe order when only the restaurant is swapped", () => {
    const gallery = candidate({
      externalPlaceId: "g1",
      name: "KF XR 갤러리",
      category: "photo",
      categoryLabel: "문화시설",
      kakaoCategoryGroupCode: "CT1",
      detailedCategory: "문화,예술 > 전시관",
    });
    const otherMeal = candidate({
      externalPlaceId: "m2",
      name: "경일옥핏제리아",
      category: "restaurant",
      categoryLabel: "맛집",
      kakaoCategoryGroupCode: "FD6",
      detailedCategory: "음식점 > 양식 > 피자",
      coordinates: [127.059, 37.546],
    });
    const swapped = applyCourseDelta({
      message: "식당 변경 해줘",
      state: withAreas(emptyDateBrief(), ["을지로"]),
      previousStops: [
        { name: "KF XR 갤러리", category: "문화시설" },
        { name: "성수 카페", category: "카페" },
        { name: "성수 식당", category: "맛집" },
      ],
    });
    const rows = validateModelRows(
      [
        { id: "kakao:g1" },
        { id: "kakao:m2" },
        { id: "kakao:c1" },
      ],
      [gallery, cafe, meal, otherMeal],
      swapped,
    );
    expect(swapped.pinOrder).toEqual(["KF XR 갤러리", "성수 카페", "성수 식당"]);
    expect(rows.map(row => row.id)).toEqual(["kakao:g1", "kakao:c1", "kakao:m2"]);
  });

  it("uses festival dates as the stop reason", () => {
    const festival = candidate({
      externalPlaceId: "f1",
      name: "청계천 축제",
      category: "festival",
      categoryLabel: "축제",
      externalSource: "tourapi",
      openingHours: "2026.09.18 – 2026.09.21",
      image: "https://example.com/fest.jpg",
    });
    expect(groundedStopReason({ candidate: festival })).toContain("2026.09.18");
    expect(scoreDateCandidate(festival, {
      savedPositive: new Set(),
      recentlyVisited: new Set(),
      commonTastes: [],
      activities: [],
    })).toBeGreaterThan(scoreDateCandidate(cafe, {
      savedPositive: new Set(),
      recentlyVisited: new Set(),
      commonTastes: [],
      activities: [],
    }));
  });

  it("drops hoe houses and pocha unless the couple asked for them", () => {
    const hoe = candidate({
      externalPlaceId: "hoe",
      name: "남대문막내회집",
      category: "restaurant",
      categoryLabel: "맛집",
      kakaoCategoryGroupCode: "FD6",
      detailedCategory: "음식점 > 한식 > 회",
    });
    const pasta = candidate({
      externalPlaceId: "pasta",
      name: "을지로 파스타",
      category: "restaurant",
      categoryLabel: "맛집",
      kakaoCategoryGroupCode: "FD6",
      detailedCategory: "음식점 > 양식 > 파스타",
    });
    const ctx = {
      savedPositive: new Set<string>(),
      recentlyVisited: new Set<string>(),
      commonTastes: [] as string[],
      activities: [] as Array<"cafe" | "meal" | "walk" | "exhibit" | "indoor" | "nightview">,
    };
    expect(isOffDateVenue(hoe)).toBe(true);
    expect(isOffDateVenue(pasta)).toBe(false);
    expect(isOffDateVenue(hoe, { allowHarsh: allowsHarshDateMeal("회 먹고 싶어") })).toBe(false);
    expect(scoreDateCandidate(pasta, ctx)).toBeGreaterThan(scoreDateCandidate(hoe, ctx));
  });

  it("rejects tarot cafes and keeps only one festival per day", () => {
    const tarot = candidate({
      externalPlaceId: "tarot",
      name: "길잡이사주타로",
      detailedCategory: "음식점 > 테마카페 > 사주카페",
    });
    const festival = (id: string, name: string): DiscoverCandidate => candidate({
      externalPlaceId: id,
      name,
      category: "festival",
      categoryLabel: "축제",
      externalSource: "tourapi",
      detailedCategory: "축제",
      openingHours: "2026.09.18 – 2026.09.21",
    });
    expect(isOffDateVenue(tarot)).toBe(true);
    const state = {
      ...withAreas(emptyDateBrief(), ["을지로"]),
      stayKind: "date" as const,
      timeWindow: "afternoon" as const,
    };
    const rows = validateModelRows(
      [{ id: "kakao:tarot" }, { id: "tourapi:f1" }, { id: "tourapi:f2" }],
      [tarot, festival("f1", "덕수궁 축제"), festival("f2", "미디어 전시"), cafe, meal],
      state,
    );
    const ids = rows.map(row => row.id);
    expect(ids.filter(id => id.startsWith("tourapi:")).length).toBe(1);
    expect(ids).not.toContain("kakao:tarot");
    expect(ids.some(id => id === "kakao:c1" || id === "kakao:m1")).toBe(true);
  });
});

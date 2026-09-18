import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { courseSize, emptyDateBrief, withAreas } from "./dateBrief";
import {
  allowsHarshDateMeal,
  applyCourseDelta,
  claimContradictsPlace,
  courseQuickReplyMessage,
  courseOrderMessage,
  pickCourseMessage,
  courseSuggestions,
  curatorSlotCatalog,
  diversifyDateCatalog,
  groundedStopReason,
  heuristicRows,
  isOffDateVenue,
  isSoftReroll,
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

  it("keeps a meal next to a cafe even when cafe was the only named preference", () => {
    const state = { ...withAreas(emptyDateBrief(), ["성수"]), activities: ["cafe" as const] };
    const rows = validateModelRows(
      [{ id: "kakao:c1" }, { id: "kakao:m1" }],
      [cafe, meal, otherCafe],
      state,
    );
    expect(rows.map(row => row.id)).toEqual(["kakao:c1", "kakao:m1"]);
  });

  it("shows compact course action chips in one row", () => {
    expect(courseSuggestions(emptyDateBrief(), [
      { name: "성수 카페", category: "카페" },
      { name: "성수 식당", category: "맛집" },
    ])).toEqual(["식당변경", "카페변경", "일정추가", "일정제외"]);
    expect(courseQuickReplyMessage("카페변경")).toBe("카페 변경 해줘");
    expect(courseQuickReplyMessage("일정추가")).toBe("한 곳 더 추가해줘");
    expect(courseQuickReplyMessage("일정제외")).toBe("한 곳 빼줘");
  });

  it("appends a new stop onto a pinned evening course instead of returning the same two", () => {
    const galleryA = candidate({
      externalPlaceId: "g1",
      name: "레온갤러리 성수커넥트",
      category: "photo",
      categoryLabel: "문화시설",
      kakaoCategoryGroupCode: "CT1",
      detailedCategory: "문화,예술 > 전시관",
    });
    const galleryB = candidate({
      externalPlaceId: "g2",
      name: "언더스탠드에비뉴 아트스탠드",
      category: "photo",
      categoryLabel: "문화시설",
      kakaoCategoryGroupCode: "CT1",
      detailedCategory: "문화,예술 > 전시관",
      coordinates: [127.057, 37.545],
    });
    const nearbyCafe = candidate({
      externalPlaceId: "c9",
      name: "왕십리 카페",
      coordinates: [127.0575, 37.5452],
    });
    const state = applyCourseDelta({
      message: "한 곳 더 추가해줘",
      state: {
        ...withAreas(emptyDateBrief(), ["왕십리"]),
        stayKind: "date",
        timeWindow: "evening",
        addStop: true,
      },
      previousStops: [
        { name: galleryA.name, category: "전시관" },
        { name: galleryB.name, category: "전시관" },
      ],
    });
    expect(state.pinOrder).toEqual([galleryA.name, galleryB.name]);
    expect(state.requiredPlaces).toEqual(expect.arrayContaining([galleryA.name, galleryB.name]));
    expect(courseSize(state).min).toBe(3);
    const rows = validateModelRows(
      [{ id: "kakao:g1" }, { id: "kakao:g2" }],
      [galleryA, galleryB, nearbyCafe, meal],
      state,
    );
    expect(rows.map(row => row.id).slice(0, 2)).toEqual(["kakao:g1", "kakao:g2"]);
    expect(rows).toHaveLength(3);
    expect(rows[2]?.id).not.toBe("kakao:g1");
    expect(rows[2]?.id).not.toBe("kakao:g2");
  });

  it("pins the live course on a follow-up so the judge can add a stop", () => {
    const state = applyCourseDelta({
      message: "밥 먹을 데도 있으면 좋겠어",
      state: {
        ...withAreas(emptyDateBrief(), ["왕십리"]),
        stayKind: "date",
        timeWindow: "evening",
        addStop: true,
        intent: "modify",
      },
      previousStops: [
        { name: "레온갤러리 성수커넥트", category: "전시관" },
        { name: "언더스탠드에비뉴 아트스탠드", category: "전시관" },
      ],
    });
    expect(state.pinOrder).toHaveLength(2);
    expect(state.addStop).toBe(true);
    expect(courseSize(state).min).toBe(3);
  });

  it("does not pin the current shops when asked for a different course", () => {
    const state = applyCourseDelta({
      message: "조금 다르게",
      state: {
        ...withAreas(emptyDateBrief(), ["왕십리"]),
        stayKind: "date",
        timeWindow: "evening",
        preserveExistingPlaces: true,
      },
      previousStops: [
        { name: "레온갤러리 성수커넥트", category: "전시관" },
        { name: "언더스탠드에비뉴 아트스탠드", category: "전시관" },
      ],
    });
    expect(isSoftReroll("조금 다르게")).toBe(true);
    expect(state.pinOrder).toEqual([]);
    expect(state.preserveExistingPlaces).toBe(false);
    expect(state.requiredPlaces).toEqual([]);
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

  it("does not boost a generic cafe over a generic restaurant", () => {
    const ctx = {
      savedPositive: new Set<string>(),
      recentlyVisited: new Set<string>(),
      commonTastes: [] as string[],
      activities: [] as Array<"cafe" | "meal" | "walk" | "exhibit" | "indoor" | "nightview">,
    };
    const genericMeal = candidate({
      externalPlaceId: "gm",
      name: "성수 식당",
      category: "restaurant",
      kakaoCategoryGroupCode: "FD6",
      detailedCategory: "음식점",
    });
    expect(scoreDateCandidate(cafe, ctx)).toBe(scoreDateCandidate(genericMeal, ctx));
    const seongsu = { ...ctx, activities: ["cafe", "walk", "exhibit"] as Array<"cafe" | "meal" | "walk" | "exhibit" | "indoor" | "nightview"> };
    expect(scoreDateCandidate(cafe, seongsu)).toBeGreaterThan(scoreDateCandidate(genericMeal, seongsu));
  });

  it("interleaves meals and walks into a cafe-heavy catalog", () => {
    const cafes = Array.from({ length: 12 }, (_, index) => candidate({
      externalPlaceId: `crowd-${index}`,
      name: `카페${index}`,
      distanceMeters: 400 + index,
    }));
    const catalog = diversifyDateCatalog([...cafes, meal, park], 6);
    expect(catalog.some(item => item.category === "restaurant")).toBe(true);
    expect(catalog.some(item => item.category === "nature")).toBe(true);
    expect(catalog.filter(item => item.category === "cafe").length).toBeLessThan(catalog.length);
  });

  it("builds a Seongsu day from cafe, walk, and exhibit instead of three cafes", () => {
    const thirdCafe = candidate({ externalPlaceId: "c3", name: "세 번째 카페", coordinates: [127.059, 37.547] });
    const state = {
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date" as const,
      timeWindow: "afternoon" as const,
    };
    const rows = heuristicRows([cafe, otherCafe, thirdCafe, meal, park], "14:00", state);
    const ids = rows.map(row => row.id);
    expect(ids).toContain("kakao:p1");
    expect(ids.filter(id => id === "kakao:c1" || id === "kakao:c2" || id === "kakao:c3").length).toBeLessThanOrEqual(2);
    expect(ids).toContain("kakao:m1");
  });

  it("allows lunch and dinner on an unlocked date", () => {
    const dinner = candidate({
      externalPlaceId: "m2",
      name: "성수 저녁",
      category: "restaurant",
      categoryLabel: "맛집",
      kakaoCategoryGroupCode: "FD6",
      detailedCategory: "음식점 > 한식",
      coordinates: [127.058, 37.546],
    });
    const state = {
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date" as const,
      timeWindow: "afternoon" as const,
    };
    const rows = validateModelRows(
      [{ id: "kakao:m1" }, { id: "kakao:c1" }, { id: "kakao:m2" }],
      [cafe, meal, dinner, park],
      state,
    );
    const ids = rows.map(row => row.id);
    expect(ids.filter(id => id === "kakao:m1" || id === "kakao:m2").length).toBe(2);
    expect(ids).toContain("kakao:c1");
  });

  it("allows two cafes on an open date instead of cutting down to one", () => {
    const thirdCafe = candidate({ externalPlaceId: "c3", name: "세 번째 카페", coordinates: [127.059, 37.547] });
    const state = {
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date" as const,
      timeWindow: "afternoon" as const,
    };
    const rows = validateModelRows(
      [{ id: "kakao:c1" }, { id: "kakao:c2" }, { id: "kakao:c3" }],
      [cafe, otherCafe, thirdCafe, meal, park],
      state,
    );
    const ids = rows.map(row => row.id);
    expect(ids.filter(id => id === "kakao:c1" || id === "kakao:c2" || id === "kakao:c3").length).toBe(2);
    expect(ids).toContain("kakao:m1");
  });

  it("does not force a meal onto an explicit cafe tour", () => {
    const thirdCafe = candidate({ externalPlaceId: "c3", name: "세 번째 카페", coordinates: [127.059, 37.547] });
    const state = {
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date" as const,
      timeWindow: "afternoon" as const,
      activities: ["cafe" as const],
      conversationNotes: ["성수 카페 투어"],
    };
    const rows = validateModelRows(
      [{ id: "kakao:c1" }, { id: "kakao:c2" }],
      [cafe, otherCafe, thirdCafe, meal, park],
      state,
    );
    expect(rows.some(row => row.id === "kakao:m1")).toBe(false);
    expect(rows.every(row => row.id === "kakao:c1" || row.id === "kakao:c2" || row.id === "kakao:c3")).toBe(true);
  });

  it("keeps trip attractions instead of filling overnight with cafes", () => {
    const lake = candidate({
      externalPlaceId: "lake",
      name: "산정호수",
      category: "nature",
      categoryLabel: "자연",
      kakaoCategoryGroupCode: "AT4",
      detailedCategory: "여행 > 호수",
      coordinates: [127.32, 38.07],
    });
    const market = candidate({
      externalPlaceId: "mkt",
      name: "포천시장",
      category: "tourist",
      categoryLabel: "관광지",
      detailedCategory: "여행 > 시장",
      coordinates: [127.21, 37.90],
    });
    const mealTwo = candidate({
      externalPlaceId: "m2",
      name: "포천 식당",
      category: "restaurant",
      categoryLabel: "맛집",
      kakaoCategoryGroupCode: "FD6",
      detailedCategory: "음식점 > 한식",
      coordinates: [127.205, 37.894],
    });
    const state = {
      ...withAreas(emptyDateBrief(), ["포천"]),
      stayKind: "overnight" as const,
      nights: 1,
    };
    const rows = heuristicRows([cafe, otherCafe, meal, mealTwo, park, lake, market], "11:00", state);
    const ids = rows.map(row => row.id);
    expect(ids.some(id => id === "kakao:lake" || id === "kakao:p1" || id === "kakao:mkt")).toBe(true);
    expect(ids.filter(id => id === "kakao:c1" || id === "kakao:c2").length).toBeLessThanOrEqual(2);
    expect(ids.length).toBeGreaterThanOrEqual(4);
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

  it("keeps two galleries on a date, not an exhibit crawl", () => {
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
    expect(ids.filter(id => id.startsWith("kakao:e")).length).toBe(2);
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
    expect(groundedStopReason({ candidate: pizza, previous: cafe, meters: 749 })).toContain("피자");
    expect(groundedStopReason({ candidate: pizza, previous: cafe, meters: 749 })).not.toContain("한식");
    expect(groundedStopReason({ candidate: pizza, previous: cafe, meters: 749 })).not.toContain("맛집");
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

  it("drops kimbap and theme cafes, but keeps a sit-down barbecue", () => {
    const kimbap = candidate({
      externalPlaceId: "kb",
      name: "김밥천국 성수",
      category: "restaurant",
      kakaoCategoryGroupCode: "FD6",
      detailedCategory: "음식점 > 분식 > 김밥",
    });
    const bbq = candidate({
      externalPlaceId: "bbq",
      name: "성수 고깃집",
      category: "restaurant",
      kakaoCategoryGroupCode: "FD6",
      detailedCategory: "음식점 > 한식 > 고깃집",
    });
    expect(isOffDateVenue(kimbap)).toBe(true);
    expect(isOffDateVenue(bbq)).toBe(false);
  });

  it("drops cheap takeout coffee chains but keeps independent and sit-down cafes", () => {
    const mega = candidate({ externalPlaceId: "mega", name: "메가MGC커피 서울숲공원점" });
    const compose = candidate({ externalPlaceId: "cmp", name: "컴포즈커피 성수점" });
    const paik = candidate({ externalPlaceId: "paik", name: "빽다방 성수역점" });
    const venti = candidate({ externalPlaceId: "venti", name: "더벤티 왕십리점" });
    const starbucks = candidate({ externalPlaceId: "sb", name: "스타벅스 서울숲점" });
    const twosome = candidate({
      externalPlaceId: "ts",
      name: "투썸플레이스 성수점",
      detailedCategory: "음식점 > 카페 > 디저트",
    });
    expect(isOffDateVenue(mega)).toBe(true);
    expect(isOffDateVenue(compose)).toBe(true);
    expect(isOffDateVenue(paik)).toBe(true);
    expect(isOffDateVenue(venti)).toBe(true);
    expect(isOffDateVenue(starbucks)).toBe(false);
    expect(isOffDateVenue(twosome)).toBe(false);
    expect(isOffDateVenue(cafe)).toBe(false);
    const state = {
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date" as const,
      timeWindow: "afternoon" as const,
    };
    const rows = validateModelRows(
      [{ id: "kakao:mega" }, { id: "kakao:m1" }],
      [mega, cafe, meal, park],
      state,
    );
    expect(rows.some(row => row.id === "kakao:mega")).toBe(false);
    expect(rows.some(row => row.id === "kakao:c1")).toBe(true);
  });

  it("anchors dinner at 18:00 on an afternoon date", () => {
    const state = {
      ...withAreas(emptyDateBrief(), ["강남"]),
      stayKind: "date" as const,
      timeWindow: "afternoon" as const,
      activities: ["meal", "cafe"] as Array<"meal" | "cafe">,
    };
    const rows = heuristicRows([cafe, meal], "14:00", state);
    expect(rows.find(row => row.id === "kakao:m1")?.start_time).toBe("18:00");
  });

  it("says both partners wanted a stop instead of only the hop", () => {
    expect(groundedStopReason({
      candidate: meal,
      previous: cafe,
      meters: 180,
      saved: true,
      bothWant: true,
    })).toContain("둘이 가고 싶다고 한 곳");
  });

  it("keeps five candidates per wanted slot for the curator", () => {
    const meals = Array.from({ length: 8 }, (_, index) => candidate({
      externalPlaceId: `meal-${index}`,
      name: `식당${index}`,
      category: "restaurant",
      kakaoCategoryGroupCode: "FD6",
      detailedCategory: "음식점 > 한식",
    }));
    const cafes = Array.from({ length: 8 }, (_, index) => candidate({
      externalPlaceId: `cafe-${index}`,
      name: `카페${index}`,
      category: "cafe",
      kakaoCategoryGroupCode: "CE7",
    }));
    const catalog = curatorSlotCatalog([...cafes, ...meals], ["meal", "cafe"]);
    expect(catalog.filter(item => item.category === "restaurant")).toHaveLength(5);
    expect(catalog.filter(item => item.category === "cafe")).toHaveLength(5);
  });

  it("explains the walking order with stop names", () => {
    expect(courseOrderMessage([
      { name: "성수 식당" },
      { name: "성수 카페" },
      { name: "서울숲" },
    ], "성수")).toBe("성수에서 성수 식당 다음에 성수 카페, 이어서 서울숲 순으로 이어가요.");
    expect(pickCourseMessage(
      "성수에서 맛있는 일식과 카페를 즐기고, 산책도 해보세요. 코스는 메시, 메가MGC커피, 그리고 서울숲입니다.",
      [{ name: "메시" }, { name: "메가MGC커피 서울숲공원점" }, { name: "뚝섬유수지체육공원 정수식물원" }],
      "성수",
    )).toBe("성수에서 메시 다음에 메가MGC커피 서울숲공원점, 이어서 뚝섬유수지체육공원 정수식물원 순으로 이어가요.");
    expect(pickCourseMessage(
      "성수에서 메시 다음에 서울숲 순으로 이어가요.",
      [{ name: "메시" }, { name: "서울숲" }],
      "성수",
    )).toBe("성수에서 메시 다음에 서울숲 순으로 이어가요.");
  });
});

import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { PlaceAsk } from "@/features/planning/types/plan";
import {
  buildPlaceCard,
  filterPlaceCandidates,
  heuristicPlacePicks,
  matchesPlaceKind,
  placeAskHarshAllow,
  placeSearchPlans,
  placeTourSearch,
  rankPlaceCandidates,
  sanitizePlacePicks,
} from "./placeRecommend";

function candidate(overrides: Partial<DiscoverCandidate> & Pick<DiscoverCandidate, "externalPlaceId" | "name">): DiscoverCandidate {
  return {
    externalSource: "kakao",
    category: "restaurant",
    categoryLabel: "음식점",
    kakaoCategoryGroupCode: "FD6",
    detailedCategory: "음식점 > 양식 > 이탈리안",
    district: "성동구 성수동",
    address: "서울 성동구 성수동",
    roadAddress: "서울 성동구 연무장길 1",
    phone: "",
    mapUrl: `https://place.map.kakao.com/${overrides.externalPlaceId}`,
    coordinates: [127.056, 37.544],
    ...overrides,
  };
}

const pastaAsk: PlaceAsk = { kind: "restaurant", query: "파스타", area: "성수" };
const noAllow = { hoe: false, meat: false, bar: false };
const ctx = { savedPositive: new Set<string>(), recentlyVisited: new Set<string>(), commonTastes: [], activities: [] as never[] };

describe("placeRecommend", () => {
  it("builds Kakao searches from the ask", () => {
    const plans = placeSearchPlans(pastaAsk);
    expect(plans[0]).toMatchObject({ region: "성수", query: "파스타", category: "restaurant", page: 1 });
    expect(plans.some(plan => plan.page === 2)).toBe(true);
    expect(placeSearchPlans({ kind: "restaurant", query: "맛집", area: "을지로" })[0]).toMatchObject({ category: "restaurant", page: 1 });
    expect(placeSearchPlans({ kind: "bar", query: "와인", area: "연남" })[0].query).toBe("와인");
  });

  it("pairs direct requests with matching TourAPI content types", () => {
    expect(placeTourSearch({ kind: "shopping", query: "쇼핑", area: "전주" })).toMatchObject({
      region: "전주", tourContentTypeId: "38", query: "", page: 1,
    });
    expect(placeTourSearch({ kind: "festival", query: "축제", area: "부산" })).toMatchObject({
      region: "부산", tourContentTypeId: "15", query: "축제", page: 1,
    });
    expect(placeTourSearch({ kind: "activity", query: "체험", area: "전주" })?.tourContentTypeId).toBe("28");
    expect(placeTourSearch({ kind: "exhibit", query: "전시", area: "전주" })?.tourContentTypeId).toBe("14");
    expect(placeTourSearch(pastaAsk)).toBeNull();
  });

  it("keeps source-classified shopping and events separate from unrelated venues", () => {
    const mall = candidate({ externalPlaceId: "shop", name: "엔터식스 왕십리", category: "tourist",
      kakaoCategoryGroupCode: "MT1", detailedCategory: "가정,생활 > 쇼핑 > 쇼핑몰" });
    const department = candidate({ externalPlaceId: "department", name: "롯데백화점 전주점",
      category: "tourist", categoryLabel: "롯데백화점", kakaoCategoryGroupCode: "",
      detailedCategory: "가정,생활 > 백화점 > 롯데백화점" });
    const market = candidate({ externalSource: "tourapi", externalPlaceId: "market", name: "전주남부시장",
      category: "tourist", categoryLabel: "쇼핑", detailedCategory: "쇼핑", tourContentTypeId: "38" });
    const restaurant = candidate({ externalPlaceId: "food", name: "시장국밥" });
    const festival = candidate({ externalSource: "tourapi", externalPlaceId: "fest", name: "전주문화축제",
      category: "festival", categoryLabel: "축제·행사", tourContentTypeId: "15", openingHours: "2026.10.01 ~ 2026.10.03" });
    expect(filterPlaceCandidates([mall, department, market, restaurant, festival],
      { kind: "shopping", query: "쇼핑", area: "전주" },
      { allowHarsh: noAllow, exclude: [], violatesAvoid: () => false }).map(item => item.name))
      .toEqual(["엔터식스 왕십리", "롯데백화점 전주점", "전주남부시장"]);
    expect(filterPlaceCandidates([mall, market, restaurant, festival],
      { kind: "festival", query: "축제", area: "전주" },
      { allowHarsh: noAllow, exclude: [], violatesAvoid: () => false }).map(item => item.name))
      .toEqual(["전주문화축제"]);
  });

  it("keeps only date-worthy venues of the asked kind", () => {
    const pool = [
      candidate({ externalPlaceId: "1", name: "파스타집 A" }),
      candidate({ externalPlaceId: "2", name: "메가MGC커피 성수점", category: "cafe", kakaoCategoryGroupCode: "CE7", detailedCategory: "음식점 > 카페 > 커피전문점" }),
      candidate({ externalPlaceId: "3", name: "성수 포차", detailedCategory: "음식점 > 술집 > 실내포차" }),
      candidate({ externalPlaceId: "4", name: "김밥천국", detailedCategory: "음식점 > 분식" }),
      candidate({ externalPlaceId: "5", name: "카페 온", category: "cafe", kakaoCategoryGroupCode: "CE7", detailedCategory: "음식점 > 카페" }),
      candidate({ externalPlaceId: "1", name: "파스타집 A" }),
    ];
    const restaurants = filterPlaceCandidates(pool, pastaAsk, { allowHarsh: noAllow, exclude: [], violatesAvoid: () => false });
    expect(restaurants.map(item => item.name)).toEqual(["파스타집 A"]);
    const bars = filterPlaceCandidates(pool, { kind: "bar", query: "술집", area: "성수" }, { allowHarsh: { ...noAllow, bar: true }, exclude: [], violatesAvoid: () => false });
    expect(bars.map(item => item.name)).toContain("성수 포차");
    const cafes = filterPlaceCandidates(pool, { kind: "cafe", query: "카페", area: "성수" }, { allowHarsh: noAllow, exclude: ["카페 온"], violatesAvoid: () => false });
    expect(cafes).toEqual([]);
  });

  it("ranks query matches and public facts higher", () => {
    const pool = [
      candidate({ externalPlaceId: "1", name: "국밥집", detailedCategory: "음식점 > 한식 > 국밥" }),
      candidate({ externalPlaceId: "2", name: "파스타 바 B", rating: 4.5, ratingCount: 320 }),
      candidate({ externalPlaceId: "3", name: "이탈리안 C" }),
    ];
    const ranked = rankPlaceCandidates(pool, pastaAsk, ctx);
    expect(ranked[0].name).toBe("파스타 바 B");
    expect(ranked.at(-1)?.name).toBe("국밥집");
  });

  it("unlocks harsher venues only when the user asks", () => {
    expect(placeAskHarshAllow("성수 맛집 추천해줘", pastaAsk, noAllow)).toEqual(noAllow);
    expect(placeAskHarshAllow("연남 와인바 알려줘", { kind: "bar", query: "와인", area: "연남" }, noAllow).bar).toBe(true);
    expect(placeAskHarshAllow("삼겹살 맛있는 집", { kind: "restaurant", query: "삼겹", area: "홍대" }, noAllow).meat).toBe(true);
  });

  it("matches kinds from Kakao categories", () => {
    expect(matchesPlaceKind(candidate({ externalPlaceId: "1", name: "갤러리 X", category: "photo", kakaoCategoryGroupCode: "CT1", detailedCategory: "문화,예술 > 전시 > 갤러리" }), "exhibit")).toBe(true);
    expect(matchesPlaceKind(candidate({ externalPlaceId: "2", name: "빵집", category: "cafe", kakaoCategoryGroupCode: "CE7", detailedCategory: "음식점 > 카페 > 베이커리" }), "dessert")).toBe(true);
    expect(matchesPlaceKind(candidate({ externalPlaceId: "3", name: "파스타집" }), "cafe")).toBe(false);
  });

  it("sanitizes model picks to known ids and sourced facts", () => {
    const allowed = new Set(["kakao:1", "kakao:2"]);
    const picks = sanitizePlacePicks([
      { id: "kakao:1", why: "트러플 파스타가 대표 메뉴예요.", rating: 4.4, ratingCount: 120, food: "트러플 파스타", sourceUrl: "https://place.map.kakao.com/1" },
      { id: "kakao:2", why: "평점 4.9", rating: 4.9, ratingCount: 50 },
      { id: "kakao:9", why: "없는 곳" },
      { id: "kakao:1", why: "중복" },
    ], allowed);
    expect(picks).toHaveLength(2);
    expect(picks[0]).toMatchObject({ id: "kakao:1", rating: 4.4, ratingCount: 120, food: "트러플 파스타" });
    expect(picks[1].rating).toBeUndefined();
  });

  it("turns picks into a tappable card with follow-ups", () => {
    const a = candidate({ externalPlaceId: "1", name: "파스타집 A", rating: 4.4, ratingCount: 120, dishes: "트러플 파스타", factSourceUrl: "https://place.map.kakao.com/1" });
    const card = buildPlaceCard({
      ask: pastaAsk,
      picks: [{ candidate: a, why: "트러플 파스타가 유명해요." }],
      intro: "성수에서 파스타라면 여기부터 봐요.",
      savedNames: new Set(["파스타집 A"]),
    });
    expect(card.headline).toBe("성수 파스타");
    expect(card.stops?.[0]).toMatchObject({ name: "파스타집 A", isSaved: true, rating: 4.4, reason: "트러플 파스타가 유명해요." });
    expect(card.suggestions).toContain("이 중에서 코스 짜줘");
    expect(heuristicPlacePicks([a, candidate({ externalPlaceId: "2", name: "파스타집 B" })], 1)).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { applyPlaceWebFacts, publicPlaceFactLine, sanitizePlaceWebFact, sanitizePlaceWebFacts } from "./placeWebFacts";

describe("placeWebFacts", () => {
  const allowed = new Set(["kakao:1", "kakao:2"]);

  it("keeps a sourced rating and drops a guessed vibe note", () => {
    const fact = sanitizePlaceWebFact({
      id: "kakao:1",
      rating: 4.4,
      ratingCount: 128,
      food: "파스타",
      sourceUrl: "https://map.naver.com/p/entry/place/1",
      note: "분위기 좋은 데이트 맛집",
    }, allowed);
    expect(fact).toMatchObject({ id: "kakao:1", rating: 4.4, food: "파스타" });
    expect(fact?.note).toBeUndefined();
    expect(publicPlaceFactLine(fact!)).toBe("4.4점 · 후기 128 · 파스타");
  });

  it("keeps food when rating is null instead of storing 0점", () => {
    const fact = sanitizePlaceWebFact({
      id: "kakao:1",
      rating: null,
      ratingCount: null,
      food: "소금빵",
      sourceUrl: "https://map.naver.com/p/entry/place/1",
    }, allowed);
    expect(fact).toMatchObject({ id: "kakao:1", food: "소금빵" });
    expect(fact?.rating).toBeUndefined();
    expect(fact?.ratingCount).toBeUndefined();
  });

  it("drops category-as-food and a bare kakao map homepage", () => {
    expect(sanitizePlaceWebFact({
      id: "kakao:1",
      food: "전시",
      sourceUrl: "https://map.kakao.com/",
    }, allowed)).toBeNull();
    expect(sanitizePlaceWebFact({
      id: "kakao:1",
      food: "식사",
      sourceUrl: "https://place.map.kakao.com/1",
    }, allowed)?.food).toBeUndefined();
  });

  it("rejects unknown ids and invented 10-point scores that cannot be scaled", () => {
    expect(sanitizePlaceWebFact({ id: "kakao:9", rating: 4.2 }, allowed)).toBeNull();
    expect(sanitizePlaceWebFact({ id: "kakao:1", rating: 94 }, allowed)).toBeNull();
    expect(sanitizePlaceWebFacts([{ id: "kakao:1", rating: 8.2, sourceUrl: "https://place.map.kakao.com/1" }], allowed)[0]?.rating).toBe(4.1);
  });

  it("copies search facts onto matching kakao ids only", () => {
    const next = applyPlaceWebFacts([
      {
        externalSource: "kakao",
        externalPlaceId: "1",
        name: "성수 식당",
        category: "restaurant",
        categoryLabel: "음식점",
        district: "성수",
        address: "",
        roadAddress: "",
        phone: "",
        mapUrl: "",
        coordinates: [127, 37],
      },
    ], [{ id: "kakao:1", rating: 4.2, food: "한식" }]);
    expect(next[0]?.rating).toBe(4.2);
    expect(next[0]?.dishes).toBe("한식");
  });

  it("does not copy food onto a park", () => {
    const next = applyPlaceWebFacts([
      {
        externalSource: "kakao",
        externalPlaceId: "3",
        name: "서울숲",
        category: "nature",
        categoryLabel: "공원",
        district: "성수",
        address: "",
        roadAddress: "",
        phone: "",
        mapUrl: "",
        coordinates: [127, 37],
      },
    ], [{ id: "kakao:3", rating: 4.2, food: "샐러드", sourceUrl: "https://place.map.kakao.com/3" }]);
    expect(next[0]?.rating).toBe(4.2);
    expect(next[0]?.dishes).toBeUndefined();
  });
});

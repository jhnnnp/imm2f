import { describe, expect, it } from "vitest";
import type { KakaoPlaceCandidate } from "../types/place";
import {
  discoverSearchCategories,
  isAllowedKakaoDiscoverPlace,
  KAKAO_DISCOVER_GROUP_CODES,
} from "./kakaoCategories";
import { PLACE_CATEGORIES } from "./placeCategories";

function candidate(overrides: Partial<KakaoPlaceCandidate> = {}): KakaoPlaceCandidate {
  return {
    externalSource: "kakao",
    externalPlaceId: "1",
    name: "성수 카페",
    category: "cafe",
    categoryLabel: "카페",
    district: "성수",
    address: "",
    roadAddress: "",
    phone: "",
    mapUrl: "",
    coordinates: [127.056, 37.544],
    kakaoCategoryGroupCode: "CE7",
    ...overrides,
  };
}

describe("kakao discover categories", () => {
  it("expands all into the place chips", () => {
    expect(discoverSearchCategories({ category: "all" })).toEqual(PLACE_CATEGORIES.map(item => item.id));
    expect(discoverSearchCategories({})).toEqual(PLACE_CATEGORIES.map(item => item.id));
  });

  it("keeps a single selected chip", () => {
    expect(discoverSearchCategories({ category: "cafe" })).toEqual(["cafe"]);
    expect(discoverSearchCategories({ categories: ["cafe", "book", "cafe"] })).toEqual(["cafe", "book"]);
  });

  it("admits only Kakao group codes that belong to the chips", () => {
    expect([...KAKAO_DISCOVER_GROUP_CODES].sort()).toEqual(["AD5", "AT4", "CE7", "CT1", "FD6"]);
    expect(isAllowedKakaoDiscoverPlace(candidate())).toBe(true);
    expect(isAllowedKakaoDiscoverPlace(candidate({
      name: "성수 약국",
      category: "tourist",
      categoryLabel: "약국",
      kakaoCategoryGroupCode: "PM9",
    }))).toBe(false);
    expect(isAllowedKakaoDiscoverPlace(candidate({
      name: "볼링장",
      category: "tourist",
      categoryLabel: "볼링장",
      detailedCategory: "스포츠,레저 > 볼링장",
      kakaoCategoryGroupCode: "",
    }))).toBe(false);
  });

  it("keeps ungrouped bookstores and TourAPI rows", () => {
    expect(isAllowedKakaoDiscoverPlace(candidate({
      name: "독립 책방",
      category: "book",
      categoryLabel: "책방",
      detailedCategory: "문화,예술 > 서점",
      kakaoCategoryGroupCode: "",
    }))).toBe(true);
    expect(isAllowedKakaoDiscoverPlace(candidate({
      externalSource: "tourapi",
      name: "청계천 축제",
      category: "festival",
      categoryLabel: "축제",
      kakaoCategoryGroupCode: undefined,
    }))).toBe(true);
  });
});

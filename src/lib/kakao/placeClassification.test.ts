import { describe, expect, it } from "vitest";
import { classifyKakaoPlace, classifyPlaceExperiences, isShoppingSearch } from "./placeClassification";

describe("shared Kakao place classification", () => {
  it.each([
    ["서전주아울렛", "가정,생활 > 상설할인매장", "outlet"],
    ["롯데백화점 전주점", "가정,생활 > 백화점 > 롯데백화점", "department"],
    ["전주남부시장", "가정,생활 > 시장", "market"],
    ["엔터식스 왕십리역점", "가정,생활 > 상가,아케이드 > 엔터식스", "mall"],
  ] as const)("classifies %s from provider taxonomy", (name, detailedCategory, shoppingKind) => {
    expect(classifyKakaoPlace({ name, detailedCategory }).shoppingKind).toBe(shoppingKind);
  });

  it.each([
    ["아파트 상가동", "가정,생활 > 상가,아케이드 > 아파트상가"],
    ["고객센터", "가정,생활 > 쇼핑몰"],
    ["무지개쇼핑", "가정,생활 > 슈퍼마켓"],
    ["온라인쇼핑몰", "가정,생활 > 통신판매 > 인터넷쇼핑몰"],
    ["전북쇼핑트래블라운지", "여행 > 관광,명소 > 관광안내소"],
  ])("does not turn %s into a shopping destination", (name, detailedCategory) => {
    expect(classifyKakaoPlace({ name, detailedCategory }).shoppingKind).toBeNull();
  });

  it("distinguishes a shopping query from unrelated activity", () => {
    expect(isShoppingSearch("전주 아울렛")).toBe(true);
    expect(isShoppingSearch("부산 해변")).toBe(false);
  });
});

describe("experience search signals", () => {
  it.each([
    ["해운대해수욕장", "여행 > 관광,명소 > 해수욕장", "coast", "provider_category"],
    ["전주한옥마을 전망대", "여행 > 관광,명소", "nightview", "place_name"],
    ["동백공원", "여행 > 관광,명소 > 공원", "nature", "provider_category"],
  ] as const)("classifies %s with its source", (name, detailedCategory, kind, source) => {
    expect(classifyPlaceExperiences({ name, detailedCategory })).toContainEqual({ kind, source });
  });

  it("does not infer an experience from the search query or unrelated venue", () => {
    expect(classifyPlaceExperiences({ name: "해운대 식당", detailedCategory: "음식점 > 한식" }))
      .toEqual([]);
    expect(classifyPlaceExperiences({ name: "왕십리 쇼핑몰", detailedCategory: "가정,생활 > 쇼핑몰" }))
      .toEqual([]);
  });
});

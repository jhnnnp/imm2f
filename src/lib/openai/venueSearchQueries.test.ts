import { describe, expect, it } from "vitest";
import { emptyDateBrief, withAreas } from "@/features/ai/dateBrief";
import type { CouplePersonalizationContext } from "@/features/ai/couplePersonalization";
import { buildVenueSearchBrief, normalizeProviderSearchQuery } from "./venueSearchQueries";

const state = () => withAreas(emptyDateBrief(), ["성수"]);
const queries = (message: string, extras: Partial<Parameters<typeof buildVenueSearchBrief>[0]> = {}) =>
  buildVenueSearchBrief({ message, state: state(), taste: [], ...extras });
const shared: CouplePersonalizationContext = {
  you: null, partner: null,
  shared: { activities: ["exhibit", "cafe"], cuisines: ["한식"], crowd: "quiet", setting: "indoor", dateFlow: "flex" },
  differences: [], savedFeedback: { preferredIds: [], bothWantIds: [], avoidedIds: [], visitedIds: [] },
};

describe("source query design", () => {
  it("reserves exact cuisine and space searches even when the model returns a generic template", () => {
    const result = queries("성수에서 파스타 먹고 정원 카페 갈래", { modelQueries: [
      { region: "성수", query: "데이트 맛집" }, { region: "성수", query: "예쁜 카페" },
    ] });
    expect(result.queries).toContainEqual({ region: "성수", query: "파스타" });
    expect(result.queries).toContainEqual({ region: "성수", query: "정원 카페" });
    expect(result.queries).toContainEqual({ region: "성수", query: "카페" });
    expect(result.queries.length).toBeLessThanOrEqual(4);
  });

  it.each([
    ["조용하게 대화할 수 있는 카페", "조용한 카페"], ["한옥에서 차 마실래", "한옥 카페"],
    ["바다가 보이는 카페", "오션뷰 카페"], ["한강뷰를 보고 싶어", "리버뷰 카페"],
    ["비가 와서 실내로 데이트", "실내 전시"], ["도자기 공방 체험", "공방 체험"],
  ])("turns requested experience into a focused source search: %s", (message, expected) => {
    expect(queries(message).queries.some(row => row.query === expected)).toBe(true);
  });

  it("uses recent user corrections and ignores assistant-authored preferences", () => {
    const result = queries("정원 말고 한옥 카페로 바꿔줘", { state: { ...state(),
      userRequests: ["파스타와 정원 카페", "파스타 말고 초밥"], activities: ["meal", "cafe"] },
      conversation: [{ role: "assistant", text: "오션뷰 카페를 선호하시는군요" }],
      modelQueries: [{ region: "성수", query: "정원 카페" }, { region: "성수", query: "파스타" }] });
    expect(result.queries.map(row => row.query)).toContain("초밥");
    expect(result.queries.map(row => row.query)).toContain("한옥 카페");
    expect(result.queries.map(row => row.query)).not.toContain("정원 카페");
    expect(result.queries.map(row => row.query)).not.toContain("파스타");
    expect(result.queries.map(row => row.query)).not.toContain("오션뷰 카페");
  });

  it("allows an explicit later reversal rather than deduplicating away its order", () => {
    const result = queries("파스타로 갈래", { state: { ...state(),
      userRequests: ["파스타로 갈래", "파스타 말고 초밥"] } });
    expect(result.queries[0].query).toBe("파스타");
  });
  it("keeps a clearly additive dish and removes a replaced space from profile/model hints", () => {
    const added = queries("파스타도 가고 싶어", { state: { ...state(), userRequests: ["초밥 먹을래"] } });
    expect(added.queries.map(row => row.query)).toEqual(expect.arrayContaining(["초밥", "파스타"]));
    const replaced = queries("이번에는 한옥 카페로", { state: { ...state(), userRequests: ["정원 카페"] },
      taste: ["정원"], modelQueries: [{ region: "성수", query: "정원 카페" }] });
    expect(replaced.queries.map(row => row.query)).not.toContain("정원 카페");
  });
  it("adapts outdoor research to current rain without creating a hard exhibition requirement", () => {
    const sourceState = { ...state(), activities: ["walk"] as ["walk"] };
    const result = queries("비가 와서 실내 데이트로 바꿔줘", { state: sourceState,
      modelQueries: [{ region: "성수", query: "산책 공원" }] });
    expect(result.queries.some(row => row.query === "실내 전시")).toBe(true);
    expect(result.queries.some(row => /산책|공원/.test(row.query))).toBe(false);
    expect(sourceState.activities).toEqual(["walk"]);
  });

  it("does not reintroduce rejected activities from saved preferences or model searches", () => {
    const result = queries("카페는 빼고 전시와 독립서점만 가자", { taste: ["조용한 카페", "디저트"],
      modelQueries: [{ region: "성수", query: "정원 카페" }] });
    expect(result.queries.some(row => /카페|티룸/.test(row.query))).toBe(false);
    expect(result.queries.some(row => /미술관/.test(row.query))).toBe(true);
  });
  it("does not treat a later space or weather cue as permission to restore a rejected kind", () => {
    const result = queries("카페 빼고 정원 산책", { taste: ["정원 카페"] });
    expect(result.queries.some(row => /카페|티룸/.test(row.query))).toBe(false);
    const indoor = queries("전시 말고 실내 공방으로", { modelQueries: [{ region: "성수", query: "실내 전시" }] });
    expect(indoor.queries.some(row => /전시|미술관/.test(row.query))).toBe(false);
    expect(indoor.queries.some(row => /공방/.test(row.query))).toBe(true);
  });

  it("keeps a cafe-only tour free of profile meals and novelty activities", () => {
    const sourceState = { ...state(), activities: ["cafe"] as ["cafe"], cuisine: "한식" as const,
      userRequests: ["카페 투어만 할래"], preferences: { vibe: [], novelty: 0.9, crowdTolerance: 0.2 } };
    const result = queries("카페 투어만 할래", { state: sourceState, taste: ["한식", "공방"],
      couplePersonalization: shared, modelQueries: [{ region: "성수", query: "식당" }] });
    expect(result.queries.every(row => /카페|티룸/.test(row.query))).toBe(true);
    expect(sourceState.activities).toEqual(["cafe"]);
  });
  it("attaches requested quietness to a meal-only search instead of imposing a cafe", () => {
    const result = queries("조용한 식당 위주로 가고 싶어", { state: { ...state(), activities: ["meal"] } });
    expect(result.queries.map(row => row.query)).toContain("조용한 레스토랑");
    expect(result.queries.some(row => /카페|티룸/.test(row.query))).toBe(false);
  });

  it("uses shared couple hints softly for an open request and keeps the requested destination", () => {
    const result = queries("둘이 새로운 데이트 코스 추천해줘", { couplePersonalization: shared });
    expect(result.queries.some(row => /전시|미술관/.test(row.query))).toBe(true);
    expect(result.queries.every(row => row.region === "성수")).toBe(true);
    expect(state().activities).toEqual([]);
  });
  it("uses model-designed experiences for an open request before generic fallback categories", () => {
    const result = queries("성수에서 색다른 하루를 보내고 싶어", { modelQueries: [
      { region: "성수", query: "향수 공방" }, { region: "성수", query: "건축 전시" },
      { region: "제주", query: "바다" },
    ] });
    expect(result.queries).toContainEqual({ region: "성수", query: "향수 공방" });
    expect(result.queries).toContainEqual({ region: "성수", query: "건축 전시" });
    expect(result.queries.every(row => row.region === "성수")).toBe(true);
  });

  it("does not override an explicit dish with the couple's habitual cuisine", () => {
    const result = queries("초밥과 한옥 카페로 해줘", { couplePersonalization: shared, taste: ["한식"] });
    expect(result.queries.map(row => row.query)).toContain("초밥");
    expect(result.queries.some(row => /한식/.test(row.query))).toBe(false);
  });

  it("covers all supplied destinations within eight source queries", () => {
    const result = queries("각 지역에서 파스타와 정원 카페를 보고 싶어", {
      state: withAreas(emptyDateBrief(), ["부산", "제주", "군산"]), limit: 8,
    });
    expect(new Set(result.queries.map(row => row.region))).toEqual(new Set(["부산", "제주", "군산"]));
    expect(result.queries).toHaveLength(8);
    for (const region of ["부산", "제주", "군산"]) expect(result.queries).toContainEqual({ region, query: "파스타" });
  });

  it("keeps a food prohibition authoritative over a positive query hint", () => {
    const result = queries("식사와 카페", { state: { ...state(), excludedFoods: ["해산물"] }, taste: ["초밥"] });
    expect(result.queries.some(row => /초밥/.test(row.query))).toBe(false);
  });
});

describe("provider query normalization", () => {
  it.each([
    ["둘이 조용하게 대화하기 좋은 카페 방문 경험", "cafe", "조용한 카페"],
    ["오션뷰를 보며 오래 머물 수 있는 카페 방문 경험", "cafe", "오션뷰 카페"],
    ["둘이 파스타를 먹고 대화할 수 있는 레스토랑 방문 경험", "restaurant", "파스타"],
    ["조용하게 대화하기 좋은 식당 방문 경험", "restaurant", "조용한 레스토랑"],
    ["달빛정원 성수본점", "cafe", "달빛정원 성수본점"],
    ["용담포구", "tourist", "용담포구"],
  ] as const)("normalizes prose while preserving a short custom noun: %s", (query, category, expected) => {
    expect(normalizeProviderSearchQuery(query, category)).toBe(expected);
  });
});

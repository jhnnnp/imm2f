import { describe, expect, it } from "vitest";
import { needsDateResearch, validateDateResearchCalls } from "./dateResearchAgent";
import { emptyDateBrief } from "@/features/ai/dateBrief";

describe("date research tool gate", () => {
  it("checks strong soft preferences even with a full candidate pool", () => {
    const state = { ...emptyDateBrief(), preferences: { vibe: ["사진 찍기 좋은"], novelty: 0.8 } };
    expect(needsDateResearch(state, 20, [], 0)).toBe(true);
    expect(needsDateResearch(state, 20, [], 1)).toBe(false);
    expect(needsDateResearch(emptyDateBrief(), 20, [], 0)).toBe(false);
    expect(needsDateResearch(emptyDateBrief(), 20, ["exhibit"], 0)).toBe(true);
  });
  it("allows only new place searches in user-approved regions", () => {
    const calls = validateDateResearchCalls({ calls: [
      { tool: "search_places", region: "잠실", query: "잠실 전시" },
      { tool: "search_places", region: "잠실", query: "잠실 전시" },
      { tool: "search_places", region: "강남", query: "강남 전시" },
      { tool: "search_web", region: "잠실", query: "secret" },
      { tool: "search_places", region: "잠실", query: "송리단길 실내 데이트" },
    ] }, ["잠실"], new Set(["잠실:잠실 전시"]));
    expect(calls).toEqual([{ tool: "search_places", region: "잠실", query: "송리단길 실내 데이트" }]);
  });

  it("allows event verification only for a discovered venue with a date-capable tool", () => {
    const raw = { calls: [
      { tool: "verify_performance", venueId: "kakao:hall-1" },
      { tool: "verify_performance", venueId: "kakao:hall-2" },
      { tool: "verify_performance", venueId: "kakao:hall-1" },
    ] };
    expect(validateDateResearchCalls(raw, ["잠실"], new Set(), ["kakao:hall-1"]))
      .toEqual([{ tool: "verify_performance", venueId: "kakao:hall-1" }]);
    expect(validateDateResearchCalls(raw, ["잠실"], new Set(), [])).toEqual([]);
  });

  it("allows detail reads only for exact candidate IDs", () => {
    const raw = { calls: [
      { tool: "get_place_details", venueId: "kakao:known" },
      { tool: "get_place_details", venueId: "kakao:unknown" },
    ] };
    expect(validateDateResearchCalls(raw, ["잠실"], new Set(), [], ["kakao:known"]))
      .toEqual([{ tool: "get_place_details", venueId: "kakao:known" }]);
  });
});

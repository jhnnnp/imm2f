import { describe, expect, it } from "vitest";
import { profileFacets } from "./profileFacets";
import type { TasteProfile } from "./types";

function sampleProfile(overrides: Partial<TasteProfile> = {}): TasteProfile {
  return {
    areas: ["북촌", "부산"],
    pace: "linger",
    activities: ["walk", "exhibit"],
    cuisines: ["한식"],
    avoidFoods: ["고기집"],
    setting: "indoor",
    crowd: "mix",
    budget: "comfortable",
    timeWindow: "night",
    areaScope: "walkable",
    dateFlow: "flex",
    drink: "any",
    indoorPlay: "",
    note: "",
    ...overrides,
  };
}

describe("profileFacets", () => {
  it("maps saved fields into display facets", () => {
    const facets = profileFacets(sampleProfile({ note: "메모" }));
    expect(facets.find(f => f.label === "자주 가는 동네")?.items).toEqual(["북촌", "부산"]);
    expect(facets.find(f => f.label === "하고 싶은 것")?.items).toEqual(["산책", "전시"]);
    expect(facets.find(f => f.label === "음식·술")?.items).toEqual(["한식"]);
    expect(facets.find(f => f.label === "코스에서 빼는 것")?.kind).toBe("avoid");
  });

  it("does not duplicate labels when crowd mix and date flow flex overlap", () => {
    const rhythm = profileFacets(sampleProfile({ crowd: "mix", dateFlow: "flex" }))
      .find(f => f.label === "하루")?.items ?? [];
    const flexCount = rhythm.filter(item => item === "그때그때").length;
    expect(flexCount).toBeLessThanOrEqual(1);
    expect(rhythm).toContain("분위기는 유연하게");
  });

  it("includes indoor play when activity is indoor", () => {
    const rhythm = profileFacets(sampleProfile({
      activities: ["indoor", "walk"],
      indoorPlay: "보드게임",
    })).find(f => f.label === "하루")?.items ?? [];
    expect(rhythm).toContain("보드게임");
  });
});

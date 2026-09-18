import { describe, expect, it } from "vitest";
import { applyTasteFallback, compareTasteProfiles, plannerStateFromSeed, seedFromProfile, violatesTasteAvoid } from "./compare";
import { parseTasteInput, parseTasteProfile } from "./parse";
import type { TasteProfile } from "./types";

function profile(overrides: Partial<TasteProfile> = {}): TasteProfile {
  return {
    areas: ["성수"],
    pace: "linger",
    activities: ["meal", "cafe"],
    cuisines: ["한식"],
    avoidFoods: [],
    setting: "mix",
    crowd: "quiet",
    budget: "comfortable",
    timeWindow: "evening",
    areaScope: "walkable",
    dateFlow: "flex",
    drink: "any",
    indoorPlay: "",
    note: "",
    ...overrides,
  };
}

describe("parseTasteProfile", () => {
  it("rejects an incomplete row", () => {
    expect(parseTasteProfile({ areas: ["성수"], pace: "linger" })).toBeNull();
  });

  it("canonicalizes 성수동 and caps lists", () => {
    const parsed = parseTasteProfile({
      areas: ["성수동", "성수", "홍대", "연남", "한남"],
      pace: "mixed",
      activities: ["meal", "walk", "cafe"],
      cuisines: ["한식", "any"],
      avoid_foods: ["매운 음식"],
      setting: "outdoor",
      crowd: "quiet",
      budget: "modest",
      time_window: "afternoon",
      area_scope: "core",
      date_flow: "meal_first",
      drink: "light",
      indoor_play: "",
      note: "천천히",
    });
    expect(parsed?.areas).toEqual(["성수", "홍대", "연남", "한남"]);
    expect(parsed?.avoidFoods).toEqual(["매운 음식"]);
  });

  it("returns a Korean error for a blank form", () => {
    const result = parseTasteInput({
      areas: [],
      pace: "",
      activities: [],
      cuisines: [],
      avoidFoods: [],
      setting: "",
      crowd: "",
      budget: "",
      timeWindow: "",
      areaScope: "",
      dateFlow: "",
      drink: "any",
      indoorPlay: "",
      note: "",
    });
    expect("error" in result).toBe(true);
  });
});

describe("compareTasteProfiles", () => {
  it("does not invent a match percentage", () => {
    const compare = compareTasteProfiles(profile(), profile({ areas: ["성수", "홍대"], activities: ["walk", "cafe"] }));
    expect(JSON.stringify(compare)).not.toMatch(/%/);
    expect(compare.seed.stayKind).toBe("date");
  });

  it("unions avoid foods as hard constraints", () => {
    const compare = compareTasteProfiles(
      profile({ avoidFoods: ["매운 음식"] }),
      profile({ avoidFoods: ["회"], areas: ["성수"] }),
    );
    expect(compare.constraints).toEqual(["매운 음식", "회"]);
    expect(compare.datePrompt).toContain("빼줘");
  });

  it("uses overlapping area for the date seed", () => {
    const compare = compareTasteProfiles(
      profile({ areas: ["성수", "을지로"] }),
      profile({ areas: ["홍대", "성수"] }),
    );
    expect(compare.seed.areas).toEqual(["성수"]);
  });

  it("builds a linger vs walk bridge instead of a score", () => {
    const compare = compareTasteProfiles(
      profile({ pace: "linger" }),
      profile({ pace: "walk" }),
    );
    expect(compare.differences.some(item => item.topic === "페이스")).toBe(true);
    expect(compare.seed.pace).toBe("balanced");
  });

  it("can seed a date from one person before the partner answers", () => {
    const seed = seedFromProfile(profile({ areas: ["한남", "성수"], avoidFoods: ["술"] }));
    expect(seed.areas[0]).toBe("한남");
    expect(seed.avoidFoods).toEqual(["술"]);
    expect(seed.stayKind).toBe("date");
  });
});

describe("taste seed", () => {
  it("fills empty planner slots and keeps user areas", () => {
    const seed = compareTasteProfiles(profile(), profile({ areas: ["성수"] })).seed;
    const filled = applyTasteFallback({ ...plannerStateFromSeed(seed), areas: [], regions: [], region: "", activities: [] }, seed);
    expect(filled.areas).toEqual(["성수"]);
    const kept = applyTasteFallback({ ...plannerStateFromSeed(seed), areas: ["한남"], activities: ["exhibit"] }, seed);
    expect(kept.areas).toEqual(["한남"]);
    expect(kept.activities).toEqual(["exhibit"]);
  });

  it("flags spicy and raw-fish venues from avoid labels", () => {
    expect(violatesTasteAvoid("엽기떡볶이 성수", ["매운 음식"])).toBe(true);
    expect(violatesTasteAvoid("성수 카페", ["매운 음식"])).toBe(false);
    expect(violatesTasteAvoid("모둠회 맛집", ["회"])).toBe(true);
  });
});

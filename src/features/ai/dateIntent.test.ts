import { describe, expect, it } from "vitest";
import { applyInterpretPatch, fallbackPatch } from "@/lib/openai/interpretDateRequest";
import { candidateFoodConflict, deriveDateUnderstanding, explicitFoodExclusions, releasedFoodExclusions, sanitizeInferredPreferences } from "./dateIntent";

describe("date goal and food constraints", () => {
  it("keeps implied date qualities soft and the location hard", () => {
    const message = "성수에서 여자친구랑 오랜만에 만나는데 뻔한 건 싫고 조용하게 놀고 싶어";
    const state = applyInterpretPatch({ message, patch: fallbackPatch(message) }).state;
    expect(state.areas).toContain("성수");
    expect(state.activities).toEqual([]);
    expect(state.preferences?.novelty).toBeGreaterThan(0.8);
    expect(state.preferences?.crowdTolerance).toBeLessThan(0.3);
    expect(state.objective).toContain("오랜만");
    expect(state.inferredPreferences?.every(item => message.includes(item.evidence))).toBe(true);
  });

  it("grounds model hypotheses in the latest user turn", () => {
    expect(sanitizeInferredPreferences([{ value: "quiet", confidence: 0.8, evidence: "조용하게" },
      { value: "luxury", confidence: 0.9, evidence: "고급 호텔" }], "조용하게 놀고 싶어"))
      .toEqual([{ value: "quiet", confidence: 0.8, evidence: "조용하게" }]);
    expect(deriveDateUnderstanding("사진 찍는 걸 좋아해").preferences.vibe).toContain("사진 찍기 좋은");
    expect(deriveDateUnderstanding("맛집 위주로, 많이 걷는 건 싫어").preferences)
      .toEqual(expect.objectContaining({ foodImportance: 0.85, walkingTolerance: 0.2 }));
  });

  it("removes a disliked activity from an earlier required mix", () => {
    const previous = applyInterpretPatch({ message: "성수에서 카페 가자", patch: fallbackPatch("성수에서 카페 가자") }).state;
    const message = "카페는 별로 안 좋아하는데 다른 걸 하고 싶어";
    const next = applyInterpretPatch({ message, previousState: previous, patch: fallbackPatch(message) }).state;
    expect(previous.activities).toContain("cafe");
    expect(next.activities).not.toContain("cafe");
  });

  it("replaces a rejected night-view activity while retaining the other selected experiences", () => {
    const previous = applyInterpretPatch({ message: "부산 2박3일 식사와 카페 야경 넣어줘",
      patch: fallbackPatch("부산 2박3일 식사와 카페 야경 넣어줘") }).state;
    const next = applyInterpretPatch({ message: "야경은 빼고 전시를 추가해줘", previousState: previous,
      patch: fallbackPatch("야경은 빼고 전시를 추가해줘") }).state;
    expect(next.activities).toEqual(expect.arrayContaining(["meal", "cafe", "exhibit"]));
    expect(next.activities).not.toContain("nightview");
    expect(next.nights).toBe(2);
  });

  it("treats an explicit food prohibition as a course filter", () => {
    const message = "잠실에서 전시 보고 싶어. 해산물 못 먹어";
    const state = applyInterpretPatch({ message, patch: fallbackPatch(message) }).state;
    expect(state.excludedFoods).toContain("해산물");
    expect(candidateFoodConflict("봉골레 파스타", state.excludedFoods ?? [])).toBe(true);
    expect(candidateFoodConflict("토마토 파스타", state.excludedFoods ?? [])).toBe(false);
    expect(explicitFoodExclusions("해산물 좋아해")).toEqual([]);
  });

  it("separates allergies from positive food preferences and negated allergies", () => {
    expect(explicitFoodExclusions("새우 알레르기가 있어, 치즈는 좋아해")).toEqual(["새우"]);
    expect(explicitFoodExclusions("새우 알레르기는 없고 치즈는 못 먹어")).toEqual(["치즈"]);
    expect(explicitFoodExclusions("해산물을 못 먹는 건 아니야")).toEqual([]);
    expect(explicitFoodExclusions("새우랑 땅콩 알레르기가 있어")).toEqual(["새우", "땅콩"]);
    expect(explicitFoodExclusions("회는 못 먹어")).toEqual(["회"]);
    expect(candidateFoodConflict("문화회관 카페", ["회"])).toBe(false);
    expect(candidateFoodConflict("활어회 전문 횟집", ["회"])).toBe(true);
  });

  it("releases only an explicitly corrected food restriction, keeping the other allergies", () => {
    const previous = applyInterpretPatch({ message: "새우와 땅콩 알레르기가 있어", patch: fallbackPatch("새우와 땅콩 알레르기가 있어") }).state;
    const next = applyInterpretPatch({ message: "새우 알레르기는 없어, 땅콩만 못 먹어", previousState: previous,
      patch: fallbackPatch("새우 알레르기는 없어, 땅콩만 못 먹어") }).state;
    expect(next.excludedFoods).toEqual(["땅콩"]);
    expect(next.foodAllergy).toBe(true);
    expect(releasedFoodExclusions("새우 먹어도 될까?")).toEqual([]);
    expect(releasedFoodExclusions("새우 먹어도 돼")).toEqual(["새우"]);
  });

  it("keeps separately stated meeting and return times as hard limits", () => {
    const message = "이번 토요일 잠실에서 3시쯤 만나. 10시 전에는 집 가야 하고 둘이 예산 15만원";
    const state = applyInterpretPatch({ message, patch: fallbackPatch(message) }).state;
    expect(state.startTime).toBe("15:00");
    expect(state.endTime).toBe("22:00");
    expect(state.budgetWon).toBeNull();
  });
});

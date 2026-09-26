import { describe, expect, it } from "vitest";
import { applyInterpretPatch, fallbackPatch } from "@/lib/openai/interpretDateRequest";
import { candidateFoodConflict, deriveDateUnderstanding, explicitFoodExclusions, sanitizeInferredPreferences } from "./dateIntent";

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

  it("treats an explicit food prohibition as a course filter", () => {
    const message = "잠실에서 전시 보고 싶어. 해산물 못 먹어";
    const state = applyInterpretPatch({ message, patch: fallbackPatch(message) }).state;
    expect(state.excludedFoods).toContain("해산물");
    expect(candidateFoodConflict("봉골레 파스타", state.excludedFoods ?? [])).toBe(true);
    expect(candidateFoodConflict("토마토 파스타", state.excludedFoods ?? [])).toBe(false);
    expect(explicitFoodExclusions("해산물 좋아해")).toEqual([]);
  });

  it("keeps separately stated meeting and return times as hard limits", () => {
    const message = "이번 토요일 잠실에서 3시쯤 만나. 10시 전에는 집 가야 하고 둘이 예산 15만원";
    const state = applyInterpretPatch({ message, patch: fallbackPatch(message) }).state;
    expect(state.startTime).toBe("15:00");
    expect(state.endTime).toBe("22:00");
    expect(state.budgetWon).toBe(150000);
  });
});

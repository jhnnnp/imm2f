import { describe, expect, it } from "vitest";
import { buildDateContext } from "./dateContext";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { toDateIntent } from "./dateIntent";
import { buildExperiencePlanInput, compareExperiencePlanToLegacy, validateExperiencePlan,
  type ExperienceBlock, type ExperiencePlan, type ExperienceQuality } from "./experiencePlan";
import type { AIPlannerState } from "@/features/planning/types/plan";

const state = (message: string, nights = 0): AIPlannerState => ({
  ...withAreas(emptyDateBrief(), [nights ? "부산" : "익선동"]),
  stayKind: nights ? "overnight" : "date", nights, userRequests: [message],
});
const inputFor = (message: string, current = state(message)) =>
  buildExperiencePlanInput(message, current, buildDateContext({ state: current,
    observedAt: "2026-09-27T00:00:00Z" }));
const block = (primaryExperience: string, visitContext: string, supportingNeeds: ExperienceBlock["supportingNeeds"] = [],
  qualitativeNeeds: ExperienceQuality[] = []): ExperienceBlock => ({
    purpose: "이 권역의 주된 경험", primaryExperience, visitContext,
    supportingNeeds, qualitativeNeeds, repeatJustification: null,
  });
const rawPlan = (days: Array<{ focus: string; density: "light" | "balanced" | "full";
  blocks: ExperienceBlock[] }>, qualities: ExperienceQuality[] = []): ExperiencePlan => ({
  objective: "커플 여행", overallPace: "balanced",
  tripStrategy: { geographicApproach: "날짜별 권역을 묶어 이동", experienceProgression: "첫날 메인, 마지막 날 가볍게",
    avoidRepeatedVisitContexts: true },
  days: days.map((day, dayIndex) => ({ dayIndex, purpose: `${day.focus} 경험`, density: day.density,
    geographicFocus: day.focus, experienceBlocks: day.blocks })),
  requiredElements: [], optionalElements: [], qualitativeNeeds: qualities, uncertainties: [],
});

describe("P2 experience plan golden fixtures", () => {
  it("normalizes a consistently one-based model day index without weakening other validation", () => {
    const request = "부산 1박2일 여행";
    const planningInput = inputFor(request, state(request, 1));
    const generated = rawPlan([
      { focus: "기장", density: "balanced", blocks: [block("쇼핑 경험", "기장 권역")] },
      { focus: "해운대", density: "light", blocks: [block("해변 산책", "해운대 권역")] },
    ]);
    generated.days.forEach(day => { day.dayIndex += 1; });
    expect(validateExperiencePlan(generated, planningInput)?.days.map(day => day.dayIndex)).toEqual([0, 1]);
    generated.days[1].dayIndex = 9;
    expect(validateExperiencePlan(generated, planningInput)).toBeNull();
  });
  it("A: keeps an aesthetic cafe request as a qualitative need", () => {
    const request = "익선동에서 이쁜 카페 데이트";
    const planningInput = inputFor(request);
    expect(planningInput.qualitativeNeeds).toContainEqual({ category: "cafe", dimension: "aesthetic", source: "explicit_user" });
    const plan = rawPlan([{ focus: "익선동", density: "light",
      blocks: [block("감성 카페에서 대화", "익선동 골목", [], planningInput.qualitativeNeeds)] }], planningInput.qualitativeNeeds);
    expect(validateExperiencePlan(plan, planningInput)?.qualitativeNeeds).toEqual(planningInput.qualitativeNeeds);
    expect(validateExperiencePlan({ ...plan, qualitativeNeeds: [] }, planningInput)).toBeNull();
    const ungroundedBlock = structuredClone(plan);
    ungroundedBlock.days[0].experienceBlocks[0].qualitativeNeeds = [];
    expect(validateExperiencePlan(ungroundedBlock, planningInput)).toBeNull();
  });

  it("B: expresses a whole Busan trip and meals within visit blocks", () => {
    const planningInput = inputFor("부산 1박2일 여행 짜줘", state("부산 1박2일 여행 짜줘", 1));
    const plan = rawPlan([
      { focus: "동부산/기장", density: "balanced",
        blocks: [block("동부산 문화·쇼핑", "동부산 복합시설", ["meal"]) ] },
      { focus: "해운대/광안리", density: "light",
        blocks: [block("해변 산책", "해운대 해변", ["cafe"]) ] },
    ]);
    expect(validateExperiencePlan(plan, planningInput)).not.toBeNull();
    expect(plan.days[0].experienceBlocks[0].supportingNeeds).toContain("meal");
    expect(plan.days[0].experienceBlocks).toHaveLength(1);
    const repeated = structuredClone(plan);
    repeated.days[1].experienceBlocks[0].visitContext = "동부산 복합시설";
    expect(validateExperiencePlan(repeated, planningInput)).toBeNull();
    const comparison = compareExperiencePlanToLegacy(plan, state("부산 1박2일 여행 짜줘", 1));
    expect(comparison.legacySpine).toEqual(["walk", "meal"]);
    expect(comparison.supportingMealOrCafeCount).toBe(2);
    expect(comparison.supportingSlotConflict).toBe(true);
    expect(comparison.potentialRewriteConflicts).toContain("legacy_activity_spine");
  });

  it("C: a relaxed three-day trip can have distinct day densities", () => {
    const request = "부산 2박3일 여유롭게";
    const plan = rawPlan([
      { focus: "도착 권역", density: "light", blocks: [block("가벼운 동네 경험", "도착 권역")] },
      { focus: "동부산", density: "balanced", blocks: [block("메인 관광", "동부산 해안")] },
      { focus: "출발 권역", density: "light", blocks: [block("출발 전 산책", "부산역 인근")] },
    ]);
    const current = { ...state(request, 2), pace: "relaxed" as const };
    plan.overallPace = "relaxed";
    expect(validateExperiencePlan(plan, inputFor(request, current))).not.toBeNull();
    expect(compareExperiencePlanToLegacy(plan, current).plannedDensities).toEqual(["light", "balanced", "light"]);
    expect(compareExperiencePlanToLegacy(plan, current).legacyMinStops).toBe(8);
  });

  it("D: late arrival requires a light first day", () => {
    const request = "부산 1박2일, 첫날 오후 7시 도착";
    const planningInput = inputFor(request, state(request, 1));
    const plan = rawPlan([
      { focus: "도착 권역", density: "light", blocks: [block("도착 후 휴식", "도착 지역", ["meal"])] },
      { focus: "해안 권역", density: "balanced", blocks: [block("해안 관광", "해변")] },
    ]);
    expect(planningInput.timeWindow.dayWindows[0]?.start).toBe("19:00");
    expect(validateExperiencePlan(plan, planningInput)).not.toBeNull();
    plan.days[0].density = "full";
    expect(validateExperiencePlan(plan, planningInput)).not.toBeNull();
    expect(compareExperiencePlanToLegacy(plan, state(request, 1)).densityWindowWarnings).toEqual([0]);
    expect(inputFor(request, { ...state("", 1), userRequests: [] }).timeWindow.dayWindows[0]?.start).toBe("19:00");
  });

  it("E: early departure requires a light final day", () => {
    const request = "부산 1박2일, 마지막 날 오전 10시 출발";
    const planningInput = inputFor(request, state(request, 1));
    const plan = rawPlan([
      { focus: "동부산", density: "balanced", blocks: [block("문화 경험", "동부산")] },
      { focus: "출발 권역", density: "light", blocks: [block("출발 준비", "역 인근")] },
    ]);
    expect(planningInput.timeWindow.dayWindows[1]?.end).toBe("10:00");
    expect(validateExperiencePlan(plan, planningInput)).not.toBeNull();
    plan.days[1].density = "balanced";
    expect(validateExperiencePlan(plan, planningInput)).not.toBeNull();
    expect(compareExperiencePlanToLegacy(plan, state(request, 1)).densityWindowWarnings).toEqual([1]);
  });

  it("F: a short evening date needs no forced meal-cafe-activity spine", () => {
    const request = "익선동에서 짧게 저녁 데이트";
    const current = { ...state(request), timeWindow: "evening" as const,
      startTime: "19:00", endTime: "21:00" };
    const plan = rawPlan([{ focus: "익선동", density: "light",
      blocks: [block("저녁 산책", "익선동 골목")] }]);
    expect(validateExperiencePlan(plan, inputFor(request, current))).not.toBeNull();
    expect(compareExperiencePlanToLegacy(plan, current).potentialSpineConflict).toBe(true);
  });

  it("G: cafe-only request creates no meal or walk requirement", () => {
    const request = "익선동에서 카페만 가고 싶어";
    const current = { ...state(request), activities: ["cafe" as const] };
    const planningInput = inputFor(request, current);
    expect(planningInput.activitySignals.map(item => item.activity)).toEqual(["cafe"]);
    expect(planningInput.hardConstraints.requiredActivities).toEqual(["cafe"]);
    const plan = rawPlan([{ focus: "익선동", density: "light",
      blocks: [block("카페에서 대화", "익선동 카페 권역")] }]);
    plan.requiredElements = ["cafe"];
    expect(validateExperiencePlan(plan, planningInput)).not.toBeNull();
    expect(plan.days[0].experienceBlocks[0].supportingNeeds).toEqual([]);
    expect(inputFor(request, { ...current, userRequests: [] }).hardConstraints.requiredActivities).toEqual(["cafe"]);
  });

  it("never promotes a default or inferred activity to DateIntent hard constraints", () => {
    const current = { ...state("부산 여행", 1), activities: ["meal" as const],
      memorySuggestions: { activities: ["meal" as const], cuisine: null } };
    expect(toDateIntent(current).hardConstraints.requiredActivities).toEqual([]);
    expect(inputFor("부산 여행", current).activitySignals).toContainEqual({
      activity: "meal", origin: "inferred_preference", explicit: false });
  });

  it("rejects fabricated venue IDs, venue names and model-added hard activities", () => {
    const planningInput = inputFor("익선동 데이트");
    const plan = rawPlan([{ focus: "익선동", density: "light",
      blocks: [block("카페", "kakao:123")] }]);
    expect(validateExperiencePlan(plan, planningInput)).toBeNull();
    plan.days[0].experienceBlocks[0].visitContext = "익선동";
    plan.requiredElements = ["meal"];
    expect(validateExperiencePlan(plan, planningInput)).toBeNull();
    plan.requiredElements = [];
    planningInput.hardConstraints.requiredPlaces = ["실제 지정 카페"];
    plan.days[0].experienceBlocks[0].primaryExperience = "실제 지정 카페 방문";
    expect(validateExperiencePlan(plan, planningInput)).toBeNull();
    const extraId = { ...rawPlan([{ focus: "익선동", density: "light",
      blocks: [block("카페", "익선동")] }]), candidateId: "made-up" };
    expect(validateExperiencePlan(extraId, inputFor("익선동 데이트"))).toBeNull();
  });
});

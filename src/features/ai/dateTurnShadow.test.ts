import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIPlannerReply, AIPlannerState, AIPlaceRecommendation, PlanItem } from "@/features/planning/types/plan";
import { emptyDateBrief } from "./dateBrief";
import { buildDateContext } from "./dateContext";
import { buildDateTurnUnderstanding } from "./dateTurnUnderstanding";
import {
  compareDateTurnUnderstanding, mergeDateTurnUnderstanding, normalizeDateTurnPayload,
  validateDateTurnPayload, type DateTurnPayload,
} from "./dateTurnShadow";
import { runDateTurnShadow } from "@/lib/openai/dateTurnShadowRunner";

const today = "2026-09-26";
const state = (): AIPlannerState => ({ ...emptyDateBrief(), areas: ["성수"], region: "성수", regions: ["성수"] });
const venue = (id: string, name: string, activitySlot: "meal" | "cafe"): AIPlaceRecommendation => ({
  id: `kakao:${id}`, placeId: `discover:kakao:${id}`, name, activitySlot,
  category: activitySlot === "meal" ? "식당" : "카페", district: "성동구", address: "", phone: "",
  mapUrl: "", coordinates: [127.04, 37.56], durationMinutes: 60, expectedCost: 0,
  reasons: [], isSaved: false, distanceFromPreviousMeters: null,
});
const planItem = (id: string, name: string, order: number): PlanItem => ({
  id, placeId: `discover:kakao:${id}`, placeName: name, category: order ? "카페" : "식당",
  startTime: order ? "17:00" : "15:00", durationMinutes: 60, expectedCost: 0, order, memo: "", dayIndex: 0,
});
const plan = (): AIPlannerReply => ({
  status: "plan", message: "현재 코스", card: { headline: "성수", lines: ["현재 코스"] },
  condition: { dateLabel: today, startTime: "15:00", endTime: "21:00", budget: null, region: "성수", timeSpecified: true },
  recommendations: [venue("1", "저녁 식당", "meal"), venue("2", "정원 카페", "cafe")],
  items: [planItem("1", "저녁 식당", 0), planItem("2", "정원 카페", 1)],
  candidateCount: 2, source: "fallback", state: state(),
});
const payload = (patch: Partial<DateTurnPayload> = {}): DateTurnPayload => {
  const base: DateTurnPayload = {
    goals: [], references: [], semanticPreferences: [], requestedChanges: [], feedback: [],
    constraintClaims: { areas: [], date: null, startTime: null, endTime: null, budgetWon: null,
      requiredPlaces: [], excludedPlaces: [], excludedFoods: [], requiredActivities: [] },
    ambiguities: [], confidence: 0.8,
  };
  return { ...base, ...patch, constraintClaims: { ...base.constraintClaims, ...patch.constraintClaims } };
};
const goal = (type: DateTurnPayload["goals"][number]["type"], targetText: string | null = null,
  attribute: string | null = null): DateTurnPayload["goals"][number] =>
  ({ type, targetText, attribute, confidence: 0.9 });
const legacy = (message: string, currentPlan: AIPlannerReply | null = null) =>
  buildDateTurnUnderstanding({ message, today, state: state(), currentPlan });
const normalize = (message: string, model: DateTurnPayload, currentPlan: AIPlannerReply | null = null) =>
  normalizeDateTurnPayload(model, { message, currentPlan, legacy: legacy(message, currentPlan) });

afterEach(() => vi.unstubAllEnvs());

describe("shadow turn understanding", () => {
  it("keeps a deterministic area while accepting a place recommendation goal", () => {
    const message = "성수에서 파스타 맛집 추천해줘";
    const existing = legacy(message);
    const model = payload({ goals: [goal("recommend_places")], constraintClaims: { ...payload().constraintClaims, areas: ["홍대"] } });
    const merged = mergeDateTurnUnderstanding(existing, normalize(message, model));
    expect(merged.goals.map(item => item.type)).toContain("recommend_places");
    expect(merged.explicitConstraints.areas).toEqual(["성수"]);
    expect(compareDateTurnUnderstanding(existing, normalize(message, model), model.constraintClaims).constraintConflicts).toContain("areas");
  });

  it("keeps the deterministic date and time range for a course request", () => {
    const message = "토요일 3시부터 9시까지 데이트 코스 짜줘";
    const existing = legacy(message);
    const model = payload({ goals: [goal("create_itinerary")], constraintClaims: {
      ...payload().constraintClaims, date: "2026-10-01", startTime: "12:00", endTime: "18:00",
    } });
    const merged = mergeDateTurnUnderstanding(existing, normalize(message, model));
    expect(merged.explicitConstraints).toMatchObject({ date: today, startTime: "15:00", endTime: "21:00" });
    expect(compareDateTurnUnderstanding(existing, normalize(message, model), model.constraintClaims).constraintConflicts)
      .toEqual(expect.arrayContaining(["date", "startTime", "endTime"]));
  });

  it("preserves multiple semantic goals and reports a more detailed goal set", () => {
    const message = "저녁만 바꿔줘. 그리고 지금 카페 주차 돼?";
    const existing = legacy(message, plan());
    const model = payload({ goals: [goal("modify_itinerary", "저녁"), goal("ask_venue", "지금 카페", "parking")],
      references: [
        { text: "저녁", kind: "category_slot", proposedName: "저녁 식당", proposedId: null, ordinal: null, confidence: 0.9 },
        { text: "지금 카페", kind: "category_slot", proposedName: "정원 카페", proposedId: null, ordinal: null, confidence: 0.9 },
      ] });
    const llm = normalize(message, model, plan());
    expect(llm.goals.map(item => item.type)).toEqual(["modify_itinerary", "ask_venue"]);
    expect(llm.goals[1].target?.resolvedName).toBe("정원 카페");
    const summary = compareDateTurnUnderstanding(existing, llm, model.constraintClaims);
    expect(summary.goalAgreement.shared).toContain("modify_itinerary");
    const courseOnly = { ...existing, goals: existing.goals.filter(item => item.type === "modify_itinerary") };
    const refined = compareDateTurnUnderstanding(courseOnly, llm, model.constraintClaims);
    expect(refined.goalAgreement).toMatchObject({ refinement: true, llmOnly: ["ask_venue"] });
  });

  it("treats relaxed pacing and novelty as semantic preferences", () => {
    const message = "좀 더 여유롭고 안 뻔하게";
    const model = payload({ semanticPreferences: [
      { dimension: "pace", value: "relaxed", sentiment: "positive", strength: 0.8, confidence: 0.9, evidenceText: "여유롭고" },
      { dimension: "novelty", value: "less_cliche", sentiment: "positive", strength: 0.8, confidence: 0.9, evidenceText: "안 뻔하게" },
    ] });
    const merged = mergeDateTurnUnderstanding(legacy(message), normalize(message, model));
    expect(merged.semanticPreferences.map(item => item.dimension)).toEqual(expect.arrayContaining(["pace", "novelty"]));
    expect(merged.explicitConstraints.startTime).toBeUndefined();
    expect(merged.explicitConstraints.budgetWon).toBeUndefined();
  });

  it("uses the actual second plan item despite a wrong proposed venue ID and ordinal", () => {
    const message = "두 번째 장소 빼줘";
    const model = payload({ references: [{ text: "두 번째 장소", kind: "ordinal_place", proposedName: "가짜 카페",
      proposedId: "hallucinated-id", ordinal: 1, confidence: 0.9 }],
    goals: [goal("modify_itinerary", "두 번째 장소")],
    requestedChanges: [{ operation: "remove", targetText: "두 번째 장소", replacementPreference: null,
      explicitValue: null, confidence: 0.9 }] });
    const result = normalize(message, model, plan());
    expect(result.references[0]).toMatchObject({ resolvedName: "정원 카페", resolvedId: "discover:kakao:2" });
    expect(result.references[0].resolvedId).not.toBe("hallucinated-id");
    expect(compareDateTurnUnderstanding(legacy(message, plan()), result, model.constraintClaims, model.references)
      .invalidReferenceProposals).toBe(1);
  });

  it("checks ordinal references against displayed plan item order", () => {
    const currentPlan = plan();
    currentPlan.items = [{ ...currentPlan.items[0], order: 1 }, { ...currentPlan.items[1], order: 0 }];
    const message = "두 번째 장소 빼줘";
    const model = payload({ references: [{ text: "두 번째 장소", kind: "ordinal_place",
      proposedName: "정원 카페", proposedId: "discover:kakao:2", ordinal: 2, confidence: 0.9 }] });
    const result = normalize(message, model, currentPlan);
    expect(result.references[0]).toMatchObject({ resolvedName: "저녁 식당", resolvedId: "discover:kakao:1" });
  });

  it("leaves a deictic reference unresolved when multiple places are visible", () => {
    const message = "거기 말고 다른 데";
    const model = payload({ references: [{ text: "거기", kind: "current_place", proposedName: "정원 카페",
      proposedId: "invented", ordinal: null, confidence: 0.9 }] });
    const result = normalize(message, model, plan());
    expect(result.references[0].kind).toBe("unresolved");
    expect(result.references[0].resolvedId).toBeUndefined();
    expect(result.ambiguities).toContain("거기");
    expect(result.confidence).toBeLessThanOrEqual(0.54);
  });

  it("keeps aesthetic praise and noise criticism as separate feedback", () => {
    const message = "여기는 예쁜데 너무 시끄러워";
    const model = payload({ feedback: [
      { targetText: null, attribute: "aesthetic", sentiment: "positive", strength: 0.8,
        evidenceText: "예쁜데", confidence: 0.9 },
      { targetText: null, attribute: "noise", sentiment: "negative", strength: 0.9,
        evidenceText: "시끄러워", confidence: 0.9 },
    ] });
    const result = normalize(message, model);
    expect(result.feedback.map(item => [item.attribute, item.sentiment])).toEqual([
      ["aesthetic", "positive"], ["noise", "negative"],
    ]);
  });

  it("never lets a model budget claim override the explicit amount", () => {
    const message = "예산 10만원 넘기지 마";
    const model = payload({ constraintClaims: { ...payload().constraintClaims, budgetWon: 200000 } });
    const existing = legacy(message);
    const merged = mergeDateTurnUnderstanding(existing, normalize(message, model));
    expect(merged.explicitConstraints.budgetWon).toBe(100000);
    expect(compareDateTurnUnderstanding(existing, normalize(message, model), model.constraintClaims).constraintConflicts).toContain("budgetWon");
  });

  it("rejects malformed payloads and unknown goals without changing legacy understanding", async () => {
    const message = "저녁만 바꿔줘";
    const existing = legacy(message, plan());
    const malformed = { ...payload(), goals: [{ ...goal("modify_itinerary"), type: "invented_goal" }] };
    expect(validateDateTurnPayload(malformed)).toBeNull();
    vi.stubEnv("DATE_TURN_INTERPRETER_SHADOW", "true");
    const result = await runDateTurnShadow({ message, state: state(), currentPlan: plan(), legacyUnderstanding: existing },
      async () => validateDateTurnPayload(malformed));
    expect(result).toBeNull();
    expect(existing.goals).toContainEqual(expect.objectContaining({ type: "modify_itinerary" }));
  });

  it("isolates a model timeout or API failure", async () => {
    const message = "저녁만 바꿔줘";
    const existing = legacy(message, plan());
    vi.stubEnv("DATE_TURN_INTERPRETER_SHADOW", "true");
    const result = await runDateTurnShadow({ message, state: state(), currentPlan: plan(), legacyUnderstanding: existing },
      async () => { throw new Error("timeout"); });
    expect(result).toBeNull();
    expect(existing.goals).toContainEqual(expect.objectContaining({ type: "modify_itinerary" }));
  });

  it("makes no provider call when shadow mode is off and stores only a summary when on", async () => {
    const message = "저녁만 바꿔줘";
    const existing = legacy(message, plan());
    const interpret = vi.fn(async () => payload({ goals: [goal("modify_itinerary")] }));
    vi.stubEnv("DATE_TURN_INTERPRETER_SHADOW", "false");
    expect(await runDateTurnShadow({ message, state: state(), legacyUnderstanding: existing }, interpret)).toBeNull();
    expect(interpret).not.toHaveBeenCalled();
    vi.stubEnv("DATE_TURN_INTERPRETER_SHADOW", "true");
    const result = await runDateTurnShadow({ message, state: state(), legacyUnderstanding: existing }, interpret);
    expect(result?.observation.type).toBe("understanding_comparison");
    expect(JSON.stringify(result?.observation)).not.toContain(message);
    const context = buildDateContext({ state: state(), currentUnderstanding: existing,
      shadowUnderstanding: result?.shadowUnderstanding, understandingComparison: result?.comparison,
      observations: result ? [result.observation] : [], observedAt: `${today}T00:00:00Z` });
    expect(context.currentUnderstanding).toBe(existing);
    expect(context.shadowUnderstanding?.goals[0].type).toBe("modify_itinerary");
    expect(context.observations).toContain(result?.observation);
  });
});

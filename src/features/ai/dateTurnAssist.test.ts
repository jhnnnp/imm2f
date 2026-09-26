import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIPlannerReply, AIPlannerState } from "@/features/planning/types/plan";
import { emptyDateBrief } from "./dateBrief";
import { buildDateContext } from "./dateContext";
import { toDateIntent } from "./dateIntent";
import type { DateFeedback, DateTurnUnderstanding, SemanticPreference } from "./dateTurnUnderstanding";
import { buildDateTurnUnderstanding } from "./dateTurnUnderstanding";
import { buildEffectiveDateTurnUnderstanding, MIN_ASSIST_CONFIDENCE, SEMANTIC_AUTHORITY_ORDER } from "./dateTurnAssist";
import { getDateTurnInterpreterMode, runDateTurnShadow } from "@/lib/openai/dateTurnShadowRunner";
import type { DateTurnPayload } from "./dateTurnShadow";

const today = "2026-09-26";
const state = (): AIPlannerState => ({ ...emptyDateBrief(), areas: ["성수"], region: "성수", regions: ["성수"] });
const legacy = (message: string) => buildDateTurnUnderstanding({ message, today, state: state() });
const modelTurn = (message: string, patch: Partial<DateTurnUnderstanding> = {}): DateTurnUnderstanding => ({
  ...legacy(message), goals: [], references: [], explicitConstraints: {}, semanticPreferences: [],
  requestedChanges: [], feedback: [], ambiguities: [], provenance: [], ...patch,
});
const preference = (dimension: string, value: string, evidenceText: string,
  confidence = 0.9): SemanticPreference => ({ dimension, value, sentiment: "positive",
  strength: 0.8, confidence, evidenceText, source: "llm" });
const feedback = (attribute: string, sentiment: DateFeedback["sentiment"], evidenceText: string,
  target?: DateFeedback["target"]): DateFeedback => ({ attribute, sentiment, evidenceText, target,
  strength: 0.8, confidence: 0.9, explicit: true });
const apply = (message: string, patch: Partial<DateTurnUnderstanding>, previous = state(), currentPlan?: AIPlannerReply) => {
  const original = buildDateTurnUnderstanding({ message, today, state: previous, currentPlan });
  return buildEffectiveDateTurnUnderstanding({ legacy: original, llm: modelTurn(message, patch),
    hardConstraints: toDateIntent(previous).hardConstraints, currentPlan });
};
const payload = (patch: Partial<DateTurnPayload> = {}): DateTurnPayload => ({
  goals: [], references: [], semanticPreferences: [], requestedChanges: [], feedback: [],
  constraintClaims: { areas: [], date: null, startTime: null, endTime: null, budgetWon: null,
    requiredPlaces: [], excludedPlaces: [], excludedFoods: [], requiredActivities: [] },
  ambiguities: [], confidence: 0.9, ...patch,
});
const plan = (): AIPlannerReply => ({
  status: "plan", message: "현재 코스", card: { headline: "성수", lines: [] },
  condition: { dateLabel: today, startTime: "15:00", endTime: "21:00", budget: null,
    region: "성수", timeSpecified: true },
  recommendations: [{ id: "kakao:1", placeId: "discover:kakao:1", name: "정원 카페",
    activitySlot: "cafe", category: "카페", district: "성동구", address: "", phone: "", mapUrl: "",
    coordinates: [127.04, 37.56], durationMinutes: 60, expectedCost: 0, reasons: [], isSaved: false,
    distanceFromPreviousMeters: null }],
  items: [{ id: "1", placeId: "discover:kakao:1", placeName: "정원 카페", category: "카페",
    startTime: "17:00", durationMinutes: 60, expectedCost: 0, order: 0, memo: "", dayIndex: 0 }],
  candidateCount: 1, source: "fallback", state: state(),
});

afterEach(() => vi.unstubAllEnvs());

describe("assist semantic approval", () => {
  it("promotes a grounded relaxed pace in assist", () => {
    const result = apply("좀 더 여유롭게 해줘", { semanticPreferences: [preference("pace", "relaxed", "여유롭게")] });
    expect(result.effectiveUnderstanding.semanticPreferences[0]).toMatchObject({ dimension: "pace", value: "relaxed", source: "llm" });
    expect(result.semanticSignals).toContainEqual(expect.objectContaining({ accepted: true, dimension: "pace" }));
    expect(result.effectiveUnderstanding.explicitConstraints.startTime).toBeUndefined();
  });

  it("promotes novelty when the current turn asks for something less familiar", () => {
    const result = apply("이번에는 뻔하지 않게", { semanticPreferences: [preference("novelty", "less_cliche", "뻔하지 않게")] });
    expect(result.effectiveUnderstanding.semanticPreferences[0].dimension).toBe("novelty");
  });

  it("supports crowd, noise and atmosphere without making hard constraints", () => {
    const message = "조용하고 분위기 있게";
    const result = apply(message, { semanticPreferences: [
      preference("crowd", "low", "조용하고"), preference("noise", "quiet", "조용하고"),
      preference("atmosphere", "warm", "분위기 있게"),
    ] });
    expect(result.semanticSignals.filter(item => item.accepted)).toHaveLength(3);
    expect(result.effectiveUnderstanding.explicitConstraints).toEqual(legacy(message).explicitConstraints);
  });

  it("keeps current-turn preference ahead of inferred memory without modifying memory", () => {
    const previous: AIPlannerState = { ...state(), inferredPreferences: [
      { value: "활동적인 데이트 선호", evidence: "지난 대화", confidence: 0.7 },
    ] };
    const result = apply("오늘은 여유롭게", { semanticPreferences: [preference("pace", "relaxed", "여유롭게")] }, previous);
    const context = buildDateContext({ state: previous, currentUnderstanding: legacy("오늘은 여유롭게"),
      effectiveUnderstanding: result.effectiveUnderstanding, observedAt: `${today}T00:00:00Z` });
    expect(context.effectiveUnderstanding?.semanticPreferences[0].value).toBe("relaxed");
    expect(context.inferredPreferences[0].value).toBe("활동적인 데이트 선호");
    expect(SEMANTIC_AUTHORITY_ORDER.indexOf("current_semantic_preference"))
      .toBeLessThan(SEMANTIC_AUTHORITY_ORDER.indexOf("inferred_memory_preference"));
  });

  it("promotes positive aesthetics and negative noise independently", () => {
    const result = apply("여긴 예쁜데 너무 시끄러워", { feedback: [
      feedback("aesthetic", "positive", "예쁜데"), feedback("noise", "negative", "시끄러워"),
    ] });
    expect(result.effectiveUnderstanding.feedback).toEqual(expect.arrayContaining([
      expect.objectContaining({ attribute: "aesthetic", sentiment: "positive" }),
      expect.objectContaining({ attribute: "noise", sentiment: "negative" }),
    ]));
    expect(result.acceptedFeedbackCount).toBe(2);
  });

  it("removes an unverified feedback venue ID but retains the attribute feedback", () => {
    const result = apply("이 카페 너무 시끄러워", { feedback: [feedback("noise", "negative", "시끄러워",
      { text: "이 카페", kind: "current_place", resolvedId: "invented", resolvedName: "없는 카페", confidence: 0.9 })] },
    state(), plan());
    const item = result.effectiveUnderstanding.feedback.find(entry => entry.attribute === "noise");
    expect(item?.target).toMatchObject({ kind: "unresolved" });
    expect(item?.target?.resolvedId).toBeUndefined();
    expect(result.unresolvedFeedbackCount).toBeGreaterThan(0);
  });

  it("retains a feedback venue ID only when it matches the current plan", () => {
    const result = apply("정원 카페는 시끄러워", { feedback: [feedback("noise", "negative", "시끄러워",
      { text: "정원 카페", kind: "current_plan_item", resolvedId: "discover:kakao:1",
        resolvedName: "정원 카페", confidence: 0.9 })] }, state(), plan());
    expect(result.effectiveUnderstanding.feedback.find(item => item.attribute === "noise")?.target?.resolvedId)
      .toBe("discover:kakao:1");
  });

  it("rejects low-confidence and unsupported signals with reasons", () => {
    const result = apply("여유롭게 가고 싶어", { semanticPreferences: [
      preference("pace", "relaxed", "여유롭게", MIN_ASSIST_CONFIDENCE - 0.01),
      preference("astrology", "lucky", "가고 싶어"),
    ] });
    expect(result.semanticSignals.map(item => item.rejectionReason)).toEqual([
      "unsupported_dimension", "insufficient_confidence",
    ]);
    expect(result.semanticSignals[0].dimension).toBe("unsupported");
    expect(result.semanticSignals.every(item => !item.accepted)).toBe(true);
    expect(result.effectiveUnderstanding.semanticPreferences.some(item => item.source === "llm")).toBe(false);
  });

  it("rejects an ungrounded preference even when confidence is high", () => {
    const result = apply("여유롭게 해줘", { semanticPreferences: [preference("food_focus", "seafood", "해산물")] });
    expect(result.semanticSignals[0].rejectionReason).toBe("not_grounded");
    const unrelated = apply("여유롭게 해줘", { semanticPreferences: [preference("food_focus", "seafood", "여유롭게")] });
    expect(unrelated.semanticSignals[0].rejectionReason).toBe("not_grounded");
  });

  it("protects deterministic budget from a model budget signal", () => {
    const previous = { ...state(), budgetWon: 100000 };
    const result = apply("예산 10만원 안에서", { semanticPreferences: [preference("budget", "200000원", "예산 10만원")] }, previous);
    expect(result.semanticSignals[0].rejectionReason).toBe("hard_constraint_conflict");
    expect(result.effectiveUnderstanding.explicitConstraints.budgetWon).toBe(100000);
    expect(previous.budgetWon).toBe(100000);
  });

  it("rejects a semantic claim that names a different area", () => {
    const result = apply("분위기 있게 해줘", { semanticPreferences: [
      preference("atmosphere", "홍대 분위기", "분위기 있게"),
    ] });
    expect(result.semanticSignals[0].rejectionReason).toBe("hard_constraint_conflict");
    expect(result.effectiveUnderstanding.semanticPreferences.some(item => item.source === "llm")).toBe(false);
  });

  it("protects excluded foods from a conflicting positive food preference", () => {
    const previous = { ...state(), excludedFoods: ["해산물"] };
    const result = apply("해산물 먹고 싶어", { semanticPreferences: [preference("food_focus", "seafood", "해산물 먹고")] }, previous);
    expect(result.semanticSignals[0].rejectionReason).toBe("hard_constraint_conflict");
    expect(toDateIntent(previous).hardConstraints.excludedFoods).toEqual(["해산물"]);
  });

  it("never promotes LLM goals, references, changes or any hard-constraint field", () => {
    const previous: AIPlannerState = { ...state(), dateLabel: today, startTime: "15:00", endTime: "21:00",
      budgetWon: 100000, requiredPlaces: ["정원 카페"], excludedPlaces: ["혼잡 식당"],
      excludedFoods: ["해산물"], activities: ["cafe"] };
    const hard = toDateIntent(previous).hardConstraints;
    const original: DateTurnUnderstanding = { ...legacy("여유롭게 해줘"), explicitConstraints: structuredClone(hard) };
    const model = modelTurn("여유롭게 해줘", { goals: [{ type: "save_itinerary", confidence: 0.99 }],
      references: [{ text: "여기", kind: "current_place", resolvedId: "invented", confidence: 0.99 }],
      requestedChanges: [{ operation: "remove", confidence: 0.99 }],
      explicitConstraints: { areas: ["홍대"], date: "2026-10-01", startTime: "10:00", endTime: "11:00",
        budgetWon: 200000, requiredPlaces: ["가짜 장소"], excludedPlaces: [], excludedFoods: [], requiredActivities: [] },
      semanticPreferences: [preference("pace", "relaxed", "여유롭게")] });
    const snapshot = structuredClone(previous);
    const result = buildEffectiveDateTurnUnderstanding({ legacy: original, llm: model, hardConstraints: hard });
    expect(result.effectiveUnderstanding.explicitConstraints).toEqual(hard);
    expect(result.effectiveUnderstanding.goals).toEqual(original.goals);
    expect(result.effectiveUnderstanding.references).toEqual(original.references);
    expect(result.effectiveUnderstanding.requestedChanges).toEqual(original.requestedChanges);
    expect(previous).toEqual(snapshot);
  });

  it("maps the old boolean flag to shadow while explicit off wins", () => {
    vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "");
    vi.stubEnv("DATE_TURN_INTERPRETER_SHADOW", "true");
    expect(getDateTurnInterpreterMode()).toBe("shadow");
    vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "off");
    expect(getDateTurnInterpreterMode()).toBe("off");
    vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "assist");
    expect(getDateTurnInterpreterMode()).toBe("assist");
  });

  it("makes no interpreter call in explicit OFF mode", async () => {
    vi.stubEnv("DATE_TURN_INTERPRETER_SHADOW", "true");
    vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "off");
    const interpret = vi.fn(async () => payload());
    const result = await runDateTurnShadow({ message: "여유롭게", state: state(),
      legacyUnderstanding: legacy("여유롭게") }, interpret);
    expect(result).toBeNull();
    expect(interpret).not.toHaveBeenCalled();
  });

  it("keeps shadow effective understanding legacy-owned", async () => {
    vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "shadow");
    const message = "좀 더 여유롭게 해줘";
    const original = legacy(message);
    const result = await runDateTurnShadow({ message, state: state(), legacyUnderstanding: original }, async () => payload({
      semanticPreferences: [{ dimension: "pace", value: "relaxed", sentiment: "positive",
        strength: 0.8, confidence: 0.9, evidenceText: "여유롭게" }],
    }));
    expect(result?.effectiveUnderstanding).toBe(original);
    expect(result?.assist).toBeNull();
    expect(result?.observations.map(item => item.type)).toEqual(["understanding_comparison"]);
  });

  it("promotes only semantics, feedback and ambiguity in assist", async () => {
    vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "assist");
    const message = "저녁은 바꾸고 좀 더 여유롭게. 이 카페는 너무 시끄러워";
    const original = legacy(message);
    const result = await runDateTurnShadow({ message, state: state(), legacyUnderstanding: original }, async () => payload({
      goals: [{ type: "save_itinerary", targetText: null, attribute: null, confidence: 0.9 }],
      semanticPreferences: [{ dimension: "pace", value: "relaxed", sentiment: "positive",
        strength: 0.8, confidence: 0.9, evidenceText: "여유롭게" }],
      feedback: [{ targetText: null, attribute: "noise", sentiment: "negative", strength: 0.9,
        confidence: 0.9, evidenceText: "시끄러워" }],
      ambiguities: ["정확한 새 저녁 장소는 미정"],
    }));
    expect(result?.effectiveUnderstanding.goals).toEqual(original.goals);
    expect(result?.effectiveUnderstanding.requestedChanges).toEqual(original.requestedChanges);
    expect(result?.effectiveUnderstanding.explicitConstraints).toEqual(original.explicitConstraints);
    expect(result?.effectiveUnderstanding.semanticPreferences[0].dimension).toBe("pace");
    expect(result?.effectiveUnderstanding.feedback).toContainEqual(expect.objectContaining({ attribute: "noise" }));
    expect(result?.effectiveUnderstanding.ambiguities).toContain("정확한 새 저녁 장소는 미정");
    expect(result?.observations.map(item => item.type)).toContain("semantic_signal");
    expect(JSON.stringify(result?.observations)).not.toContain(message);
    const context = buildDateContext({ state: state(), currentUnderstanding: original,
      shadowUnderstanding: result?.shadowUnderstanding,
      effectiveUnderstanding: result?.effectiveUnderstanding, interpreterMode: "assist",
      semanticSignalDiagnostics: result?.assist?.semanticSignals, observations: result?.observations,
      observedAt: `${today}T00:00:00Z` });
    expect(context.currentUnderstanding?.goals).toEqual(original.goals);
    expect(context.effectiveUnderstanding?.semanticPreferences[0].source).toBe("llm");
    expect(context.semanticSignalDiagnostics[0].accepted).toBe(true);
  });

  it("falls back to legacy when the assist interpreter fails", async () => {
    vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "assist");
    const message = "좀 더 여유롭게 해줘";
    const original = legacy(message);
    const result = await runDateTurnShadow({ message, state: state(), legacyUnderstanding: original },
      async () => { throw new Error("timeout"); });
    expect(result).toBeNull();
    const context = buildDateContext({ state: state(), interpreterMode: "assist", currentUnderstanding: original,
      observedAt: `${today}T00:00:00Z` });
    expect(context.effectiveUnderstanding).toBe(original);
  });
});

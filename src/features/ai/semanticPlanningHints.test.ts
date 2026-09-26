import { describe, expect, it } from "vitest";
import { emptyDateBrief } from "./dateBrief";
import { buildEffectiveDateTurnUnderstanding } from "./dateTurnAssist";
import { toDateIntent } from "./dateIntent";
import { buildDateTurnUnderstanding, type DateFeedback, type SemanticPreference } from "./dateTurnUnderstanding";
import { buildSemanticPlanningHints, semanticPlanningHintsForContext } from "./semanticPlanningHints";

const state = () => ({ ...emptyDateBrief(), areas: ["성수"], region: "성수", regions: ["성수"] });
const signal = (dimension: string, value: string, evidenceText: string, confidence = 0.9): SemanticPreference => ({
  dimension, value, evidenceText, confidence, sentiment: "positive", strength: 0.8, source: "llm",
});
function approved(message: string, preferences: SemanticPreference[], feedback: DateFeedback[] = [], ambiguities: string[] = []) {
  const current = state();
  const legacy = buildDateTurnUnderstanding({ message, today: "2026-09-26", state: current });
  return buildEffectiveDateTurnUnderstanding({ legacy,
    llm: { ...legacy, semanticPreferences: preferences, feedback, ambiguities },
    hardConstraints: toDateIntent(current).hardConstraints }).effectiveUnderstanding;
}

describe("semantic course hint boundary", () => {
  it("keeps no-signal ASSIST, OFF, and SHADOW free of proposal hints", () => {
    const effective = approved("성수 데이트 코스", []);
    expect(buildSemanticPlanningHints(effective)).toEqual({});
    expect(semanticPlanningHintsForContext({ interpreterMode: "assist", effectiveUnderstanding: effective })).toEqual({});
    const withSignal = approved("여유롭게", [signal("pace", "relaxed", "여유롭게")]);
    expect(semanticPlanningHintsForContext({ interpreterMode: "off", effectiveUnderstanding: withSignal })).toEqual({});
    expect(semanticPlanningHintsForContext({ interpreterMode: "shadow", effectiveUnderstanding: withSignal })).toEqual({});
  });

  it("maps approved pace, activity and novelty without changing hard constraints", () => {
    const effective = approved("여유롭고 활동적이고 뻔하지 않게", [
      signal("pace", "relaxed", "여유롭고"),
      signal("activity_level", "high", "활동적이고"),
      signal("novelty", "less_cliche", "뻔하지 않게"),
    ]);
    expect(semanticPlanningHintsForContext({ interpreterMode: "assist", effectiveUnderstanding: effective }))
      .toMatchObject({ pace: "relaxed", activityLevel: "high", novelty: "high" });
    expect(effective.explicitConstraints).toEqual(buildDateTurnUnderstanding({
      message: "여유롭고 활동적이고 뻔하지 않게", today: "2026-09-26", state: state(),
    }).explicitConstraints);
  });

  it("keeps unknown values, rejected signals, legacy heuristics and ambiguities out", () => {
    const effective = approved("여유롭게 하자. 시작 시간은 나중에 정해", [
      signal("pace", "unrelated", "여유롭게"),
      signal("noise", "quiet", "여유롭게", 0.5),
      signal("astrology", "lucky", "나중에"),
    ], [], ["정확한 시작 시간 미정"]);
    expect(buildSemanticPlanningHints(effective)).toEqual({});
  });

  it("uses approved current feedback without inventing a target or long-term preference", () => {
    const feedback: DateFeedback[] = [
      { attribute: "aesthetic", sentiment: "positive", strength: 0.8, confidence: 0.9,
        evidenceText: "예쁜데", explicit: true },
      { attribute: "noise", sentiment: "negative", strength: 0.8, confidence: 0.9,
        evidenceText: "시끄러워", explicit: true, target: { text: "거기", kind: "unresolved", confidence: 0.3 } },
    ];
    const hints = buildSemanticPlanningHints(approved("예쁜데 너무 시끄러워", [], feedback));
    expect(hints.sessionFeedback).toEqual([
      { attribute: "aesthetic", sentiment: "positive" }, { attribute: "noise", sentiment: "negative" },
    ]);
    expect(JSON.stringify(hints)).not.toContain("거기");
    expect(JSON.stringify(hints)).not.toContain("resolvedId");
    const effective = approved("예쁜데 너무 시끄러워", [], feedback);
    effective.feedback.push({ ...feedback[1], sentiment: "positive", source: undefined });
    expect(buildSemanticPlanningHints(effective).sessionFeedback).toEqual(hints.sessionFeedback);
  });

  it("does not convert budget or excluded-food claims to hints", () => {
    const current = { ...state(), budgetWon: 100000, excludedFoods: ["해산물"] };
    const message = "10만원 안에서 해산물은 빼고 여유롭게";
    const legacy = buildDateTurnUnderstanding({ message, today: "2026-09-26", state: current });
    const effective = buildEffectiveDateTurnUnderstanding({ legacy,
      llm: { ...legacy, semanticPreferences: [signal("budget", "200000원", "10만원"),
        signal("food_focus", "seafood", "해산물"), signal("pace", "relaxed", "여유롭게")] },
      hardConstraints: toDateIntent(current).hardConstraints }).effectiveUnderstanding;
    expect(buildSemanticPlanningHints(effective)).toEqual({ pace: "relaxed" });
    expect(current.budgetWon).toBe(100000);
    expect(current.excludedFoods).toEqual(["해산물"]);
  });
});

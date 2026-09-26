import { describe, expect, it } from "vitest";
import type { AIPlannerReply, AIPlannerState, AIPlaceRecommendation, PlanItem } from "@/features/planning/types/plan";
import { emptyDateBrief } from "./dateBrief";
import { buildDateContext } from "./dateContext";
import { buildDateTurnUnderstanding } from "./dateTurnUnderstanding";
import { toDateIntent } from "./dateIntent";

const today = "2026-09-26";
const state = (): AIPlannerState => ({ ...emptyDateBrief(), areas: ["성수"], region: "성수", regions: ["성수"] });
const recommendation = (id: string, name: string, activitySlot: "meal" | "cafe"): AIPlaceRecommendation => ({
  id: `kakao:${id}`, placeId: `discover:kakao:${id}`, name, activitySlot,
  category: activitySlot === "meal" ? "식당" : "카페", district: "성동구", address: "", phone: "",
  mapUrl: "", coordinates: [127.04, 37.56], durationMinutes: 60, expectedCost: 0,
  reasons: [], isSaved: false, distanceFromPreviousMeters: null,
});
const item = (id: string, name: string, order: number): PlanItem => ({
  id, placeId: `discover:kakao:${id}`, placeName: name, category: order ? "카페" : "식당",
  startTime: order ? "17:00" : "15:00", durationMinutes: 60, expectedCost: 0, order, memo: "", dayIndex: 0,
});
const plan = (): AIPlannerReply => ({
  status: "plan", message: "현재 코스", card: { headline: "성수", lines: ["현재 코스"] },
  condition: { dateLabel: today, startTime: "15:00", endTime: "21:00", budget: null,
    region: "성수", timeSpecified: true },
  recommendations: [recommendation("1", "저녁 식당", "meal"), recommendation("2", "정원 카페", "cafe")],
  items: [item("1", "저녁 식당", 0), item("2", "정원 카페", 1)], candidateCount: 2,
  source: "fallback", state: state(),
});
const understand = (message: string, currentPlan: AIPlannerReply | null = null) =>
  buildDateTurnUnderstanding({ message, today, state: state(), currentPlan });

describe("date turn understanding", () => {
  it("recognizes a standalone place recommendation goal", () => {
    const turn = understand("성수에서 파스타 맛집 추천해줘");
    expect(turn.goals.map(goal => goal.type)).toContain("recommend_places");
    expect(turn.goals.map(goal => goal.type)).not.toContain("create_itinerary");
  });

  it("separates an itinerary goal from explicit date, time and area constraints", () => {
    const turn = understand("토요일 3시부터 9시까지 성수 데이트 코스 짜줘");
    expect(turn.goals.map(goal => goal.type)).toContain("create_itinerary");
    expect(turn.explicitConstraints).toEqual(expect.objectContaining({
      date: today, startTime: "15:00", endTime: "21:00", areas: ["성수"],
    }));
    expect(turn.provenance).toContainEqual({ field: "explicitConstraints", key: "startTime", source: "deterministic" });
  });

  it("recognizes a dinner replacement and resolves the unique current meal", () => {
    const turn = understand("저녁만 다른 곳으로 바꿔줘", plan());
    expect(turn.goals.map(goal => goal.type)).toContain("modify_itinerary");
    expect(turn.requestedChanges[0]).toEqual(expect.objectContaining({ operation: "replace",
      target: expect.objectContaining({ kind: "category_slot", resolvedName: "저녁 식당" }) }));
    expect(turn.explicitConstraints.excludedPlaces).toBeUndefined();
  });

  it("keeps an edit and a parking question as two goals in one turn", () => {
    const turn = understand("저녁만 바꿔줘. 그리고 지금 카페 주차 돼?", plan());
    expect(turn.goals.map(goal => goal.type)).toEqual(expect.arrayContaining(["modify_itinerary", "ask_venue"]));
    expect(turn.goals.find(goal => goal.type === "ask_venue")).toEqual(expect.objectContaining({
      attribute: "parking", target: expect.objectContaining({ resolvedName: "정원 카페" }),
    }));
  });

  it("keeps relaxed pacing semantic rather than a hard time constraint", () => {
    const turn = understand("좀 더 여유롭게 해줘", plan());
    expect(turn.semanticPreferences).toContainEqual(expect.objectContaining({ dimension: "pace", value: "relaxed" }));
    expect(turn.explicitConstraints.startTime).toBeUndefined();
    expect(turn.explicitConstraints.endTime).toBeUndefined();
  });

  it("records positive space and negative crowd feedback separately", () => {
    const turn = understand("이 카페는 예쁜데 사람이 너무 많아", plan());
    expect(turn.feedback).toEqual(expect.arrayContaining([
      expect.objectContaining({ attribute: "space", sentiment: "positive", explicit: true }),
      expect.objectContaining({ attribute: "crowd", sentiment: "negative", explicit: true }),
    ]));
  });

  it("resolves a numbered plan item before representing its removal", () => {
    const turn = understand("두 번째 장소 빼줘", plan());
    expect(turn.references).toContainEqual(expect.objectContaining({ kind: "ordinal_place", resolvedName: "정원 카페" }));
    expect(turn.requestedChanges).toContainEqual(expect.objectContaining({ operation: "remove" }));
  });

  it("leaves a previous-plan reference unresolved while preserving feedback", () => {
    const turn = understand("아까 게 더 나았어", plan());
    expect(turn.references).toContainEqual(expect.objectContaining({ kind: "unresolved", targetType: "plan" }));
    expect(turn.feedback).toContainEqual(expect.objectContaining({ sentiment: "positive", attribute: "overall" }));
    expect(turn.ambiguities).toContain("아까 게");
  });

  it("extracts an explicit budget with deterministic provenance", () => {
    const turn = understand("예산 10만원 넘기지 마");
    expect(turn.explicitConstraints.budgetWon).toBe(100000);
    expect(turn.provenance).toContainEqual({ field: "explicitConstraints", key: "budgetWon", source: "deterministic" });
  });

  it("keeps an explicitly disliked food separate from preferences", () => {
    const turn = understand("회는 싫어");
    expect(turn.explicitConstraints.excludedFoods).toContain("회");
    expect(turn.semanticPreferences).not.toContainEqual(expect.objectContaining({ value: "회" }));
  });

  it("still builds and links an understanding without legacy or LLM output", () => {
    const previousState = state();
    const understanding = buildDateTurnUnderstanding({ message: "안녕하세요", today,
      state: previousState, legacyRoute: null, interpretedIntent: null });
    const context = buildDateContext({ state: previousState, currentUnderstanding: understanding, observedAt: `${today}T00:00:00Z` });
    expect(understanding.goals.map(goal => goal.type)).toContain("general_chat");
    expect(context.currentUnderstanding).toBe(understanding);
  });

  it("keeps a legacy route as provenance when only the route indicates a goal", () => {
    const turn = buildDateTurnUnderstanding({ message: "좋아", today, state: state(), currentPlan: plan(),
      legacyRoute: { mode: "course", confident: true } });
    expect(turn.goals).toContainEqual(expect.objectContaining({ type: "modify_itinerary" }));
    expect(turn.provenance).toContainEqual({ field: "goals", key: "modify_itinerary", source: "legacy_route" });
  });

  it("accepts only message-grounded preferences from an interpreted intent", () => {
    const interpreted = toDateIntent({ ...state(), inferredPreferences: [
      { value: "대화 중심의 데이트 선호", evidence: "조용하게", confidence: 0.8 },
      { value: "비 오는 날 선호", evidence: "비 오는 날", confidence: 0.9 },
    ] });
    const turn = buildDateTurnUnderstanding({ message: "조용하게 해줘", today, state: state(),
      interpretedIntent: interpreted, interpretedSource: "unknown" });
    expect(turn.semanticPreferences).toContainEqual(expect.objectContaining({ value: "대화 중심의 데이트 선호" }));
    expect(turn.semanticPreferences).not.toContainEqual(expect.objectContaining({ value: "비 오는 날 선호" }));
    expect(turn.provenance).toContainEqual({ field: "semanticPreferences", key: "대화 중심의 데이트 선호", source: "unknown" });
  });
});

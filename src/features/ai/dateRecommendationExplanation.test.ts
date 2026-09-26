import { describe, expect, it, vi } from "vitest";
import type { AIPlannerReply, AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief } from "./dateBrief";
import { buildDateCandidatePool } from "./dateCandidatePool";
import type { DateExecutionPlan, DateExecutionTask } from "./dateExecutionPlan";
import { buildDateExecutionPlan } from "./dateExecutionPlan";
import type { DateMutationExecutionResult } from "./dateMutationExecution";
import { executeLimitedMutation } from "./dateMutationExecution";
import { appendRecommendationExplanation, buildRecommendationExplanationContext,
  executeLimitedExplanation, explainRejectedCandidate, explainSessionRejectedCandidate,
  renderRecommendationExplanation } from "./dateRecommendationExplanation";
import { buildDateTurnUnderstanding } from "./dateTurnUnderstanding";
import { buildDateContext } from "./dateContext";
import { mergeSessionCandidates } from "./sessionCandidates";

const state: AIPlannerState = { ...emptyDateBrief(), region: "성수", regions: ["성수"], areas: ["성수"] };
const candidate = (id: string, name: string, category: "restaurant" | "cafe"): DiscoverCandidate => ({
  externalSource: "kakao", externalPlaceId: id, name, category,
  categoryLabel: category === "cafe" ? "카페" : "식당", district: "성동구",
  address: "성수", roadAddress: "성수", phone: "", mapUrl: "", coordinates: [127.04, 37.56],
});
const currentPlan = (): AIPlannerReply => ({ status: "plan", message: "성수 코스",
  card: { headline: "성수 코스", lines: ["성수 코스"] },
  condition: { dateLabel: "2026-09-26", startTime: "15:00", endTime: "21:00", budget: 100000,
    region: "성수", timeSpecified: true },
  items: [
    { id: "meal-item", placeId: "discover:kakao:meal", placeName: "성수 식당", category: "식당",
      startTime: "15:00", durationMinutes: 60, expectedCost: 20000, order: 0, dayIndex: 0, memo: "" },
    { id: "cafe-item", placeId: "discover:kakao:cafe", placeName: "성수 카페", category: "카페",
      startTime: "17:00", durationMinutes: 60, expectedCost: 10000, order: 1, dayIndex: 0, memo: "" },
  ],
  recommendations: [
    { id: "kakao:meal", placeId: "discover:kakao:meal", name: "성수 식당", activitySlot: "meal",
      category: "식당", district: "성동구", address: "성수", phone: "", mapUrl: "",
      coordinates: [127.04, 37.56], durationMinutes: 60, expectedCost: 20000,
      reasons: ["근거 없는 로맨틱 식당"], isSaved: false, distanceFromPreviousMeters: null },
    { id: "kakao:cafe", placeId: "discover:kakao:cafe", name: "성수 카페", activitySlot: "cafe",
      category: "카페", district: "성동구", address: "성수", phone: "", mapUrl: "",
      coordinates: [127.0405, 37.56], durationMinutes: 60, expectedCost: 10000,
      reasons: ["조용한 카페"], isSaved: false, distanceFromPreviousMeters: 100 },
  ], candidateCount: 2, source: "fallback", state,
});
const task = (target?: DateExecutionTask["target"], overrides: Partial<DateExecutionTask> = {}): DateExecutionTask => ({
  id: "task-1", type: "explain_recommendation", goal: "explain_recommendation", target,
  dependencies: [], executionOrder: 1, confidence: 0.9, status: "planned", source: "llm", ...overrides,
});
const executionPlan = (entry: DateExecutionTask): DateExecutionPlan => ({ tasks: [entry],
  unresolved: [], executable: true, source: "shadow_understanding" });
const input = (entry: DateExecutionTask, message: string, overrides: Record<string, unknown> = {}) => ({
  plan: executionPlan(entry), route: { mode: "course" as const, confident: true },
  primary: { status: "chat" as const, message: "기존 응답", card: { headline: "", lines: ["기존 응답"] }, state },
  currentPlan: currentPlan(), resultAfterMutation: currentPlan(),
  interpreterMode: "assist" as const, executionMode: "limited" as const,
  userMessage: message, ...overrides,
});
const cafe = { kind: "plan_item" as const, placeId: "discover:kakao:cafe", name: "성수 카페" };

describe("verified recommendation explanation", () => {
  it("explains a uniquely referenced historical rejection from its recorded reason", async () => {
    const rejected = buildDateCandidatePool([candidate("old", "지난 카페", "cafe")],
      { ...state, excludedPlaces: ["지난 카페"] }).records;
    const session = mergeSessionCandidates(null, rejected, { sessionId: "session-a", turnId: "turn-1",
      observedAt: "2026-09-26T10:00:00Z" });
    const message = "왜 아까 지난 카페 안 넣었어?";
    const understanding = buildDateTurnUnderstanding({ message, today: "2026-09-26", state,
      currentPlan: currentPlan(), sessionCandidates: session,
      legacyRoute: { mode: "question", confident: true } });
    expect(understanding.references[0]).toMatchObject({ kind: "previous_place",
      resolvedId: "kakao:old", resolvedName: "지난 카페" });
    const plan = buildDateExecutionPlan({ understanding, currentPlan: currentPlan(),
      sessionCandidates: session });
    expect(plan.executable).toBe(true);
    expect(plan.tasks[0].target).toEqual({ kind: "place", placeId: "kakao:old", name: "지난 카페" });
    const context = buildDateContext({ state, currentPlan: currentPlan(), sessionCandidates: session,
      observedAt: "2026-09-26T10:00:00Z" });
    const executed = await executeLimitedExplanation(input(plan.tasks[0], message, { plan, context }));
    expect(executed.result?.status).toBe("success");
    expect(executed.result?.explanation).toContain("제외 요청한 장소");
    expect(executed.result?.explanation).toContain("당시 후보에서 제외했어요");
  });

  it("keeps an ambiguous historical reference unresolved and invents no rejection reason", async () => {
    const session = mergeSessionCandidates(null,
      buildDateCandidatePool([candidate("a", "A 카페", "cafe"), candidate("b", "B 카페", "cafe")], state).records,
      { sessionId: "session-a", turnId: "turn-1", observedAt: "2026-09-26T10:00:00Z",
        shownPlaces: [{ name: "A 카페" }, { name: "B 카페" }] });
    const understanding = buildDateTurnUnderstanding({ message: "왜 아까 거 안 넣었어?",
      today: "2026-09-26", state, currentPlan: currentPlan(), sessionCandidates: session });
    expect(understanding.references[0].kind).toBe("unresolved");
    const plan = buildDateExecutionPlan({ understanding, currentPlan: currentPlan(),
      sessionCandidates: session });
    expect(plan.executable).toBe(false);
    expect(session.records.every(record => record.rejectedReasons.length === 0)).toBe(true);
    expect(explainSessionRejectedCandidate(session.records[0])).toBeNull();
  });

  it("uses the session's displayed ordinal rather than a current-plan ordinal", () => {
    const session = mergeSessionCandidates(null,
      buildDateCandidatePool([candidate("a", "A 카페", "cafe"), candidate("b", "B 카페", "cafe")], state).records,
      { sessionId: "session-a", turnId: "turn-1", observedAt: "2026-09-26T10:00:00Z",
        shownPlaces: [{ name: "B 카페" }, { name: "A 카페" }] });
    const understood = buildDateTurnUnderstanding({ message: "아까 보여준 첫 번째 카페는 왜 안 넣었어?",
      today: "2026-09-26", state, currentPlan: currentPlan(), sessionCandidates: session });
    expect(understood.references[0]).toMatchObject({ kind: "previous_place", resolvedId: "kakao:b" });
  });
  it("explains the whole current plan from selected stops", async () => {
    const result = await executeLimitedExplanation(input(task(), "왜 이 코스로 추천했어?"));
    expect(result.result).toMatchObject({ status: "success", target: { kind: "entire_plan" } });
    expect(result.result?.explanation).toContain("성수 식당 → 성수 카페");
    expect(result.observation?.data).not.toHaveProperty("explanation");
  });

  it("explains only a verified cafe and never repeats an unsupported quiet claim", async () => {
    const result = await executeLimitedExplanation(input(task(cafe), "왜 이 카페 넣었어?"));
    expect(result.result).toMatchObject({ status: "success", target: { kind: "specific_place",
      itemId: "cafe-item", venueId: "discover:kakao:cafe" } });
    expect(result.result?.explanation).toContain("카페 역할을 맡는");
    expect(result.result?.explanation).not.toContain("조용한 카페");
    expect(result.result?.explanation).toContain("근거는 아직 확인되지");
  });

  it("uses a relaxed pace hint only when the actual course is compact", async () => {
    const withHint = await executeLimitedExplanation(input(task(), "왜 이 코스로 추천했어?",
      { semanticHints: { pace: "relaxed" } }));
    expect(withHint.result?.explanation).toContain("여유로운 구성 요청");
    expect(withHint.result?.factTypesUsed).toContain("semantic_preference");
    const noHint = await executeLimitedExplanation(input(task(), "왜 이 코스로 추천했어?"));
    expect(noHint.result?.explanation).not.toContain("여유로운 구성 요청");
  });

  it("explains a pool rejection directly without invoking any model", () => {
    const excluded = buildDateCandidatePool([candidate("x", "제외 식당", "restaurant")],
      { ...state, excludedPlaces: ["제외 식당"] }).records[0];
    expect(explainRejectedCandidate(excluded)).toContain("제외 요청한 장소");
  });

  it("uses only source-checked evidence for venue characteristics", async () => {
    const venue = { ...candidate("cafe", "성수 카페", "cafe"), evidence: [
      { id: "noise-lead", text: "조용하다고 추측", url: "https://example.com/lead",
        checkedAt: "2026-09-26T00:00:00Z", attribute: "space" as const, verification: "search_report" as const },
      { id: "space-fact", text: "정원 좌석을 소개한다", url: "https://example.com/fact",
        checkedAt: "2026-09-26T00:00:00Z", attribute: "space" as const, verification: "source_checked" as const },
    ] };
    const context = buildRecommendationExplanationContext({ plan: currentPlan(),
      target: { kind: "specific_place", venueId: cafe.placeId, name: cafe.name, itemId: "cafe-item" },
      records: buildDateCandidatePool([venue], state).records });
    expect(context.relevantEvidence).toHaveLength(1);
    expect(renderRecommendationExplanation(context)).toContain("정원 좌석");
    expect(renderRecommendationExplanation(context)).not.toContain("조용하다고 추측");
    const records = buildDateCandidatePool([venue], state).records;
    const executed = await executeLimitedExplanation(input(task(cafe), "왜 이 카페 넣었어?",
      { candidateRecords: records }));
    expect(executed.result).toMatchObject({ evidenceCount: 1,
      sources: [{ url: "https://example.com/fact" }] });
  });

  it("distinguishes ordering and timing without inventing optimization claims", async () => {
    const order = await executeLimitedExplanation(input(task(cafe), "왜 카페를 먼저 가?"));
    expect(order.result?.target?.kind).toBe("ordering");
    expect(order.result?.explanation).toContain("비교 근거는 확인되지 않았어요");
    const timing = await executeLimitedExplanation(input(task(cafe), "왜 여기서 2시간 잡았어?"));
    expect(timing.result?.target?.kind).toBe("timing");
    expect(timing.result?.explanation).toContain("60분");
    expect(timing.result?.explanation).not.toContain("2시간 머무르도록");
  });

  it("skips an unresolved or disappeared target", async () => {
    expect((await executeLimitedExplanation(input(task(), "왜 이 카페 넣었어?"))).result)
      .toMatchObject({ status: "skipped", failureCode: "unresolved_target" });
    expect((await executeLimitedExplanation(input(task({ kind: "plan_item", name: "없는 카페",
      placeId: "invented" }), "왜 없는 카페 넣었어?"))).result)
      .toMatchObject({ status: "skipped", failureCode: "invalid_plan" });
  });

  it("deduplicates only when a question response actually covers the target", async () => {
    const covered = await executeLimitedExplanation(input(task(cafe), "왜 이 카페 넣었어?", {
      route: { mode: "question", confident: true }, primary: { status: "chat", state,
        message: "성수 카페를 고른 이유", card: { headline: "성수 카페", lines: ["카페로 골랐어요."] } },
    }));
    expect(covered.result).toMatchObject({ status: "skipped", failureCode: "legacy_answer_covered" });
    const generic = await executeLimitedExplanation(input(task(cafe), "왜 이 카페 넣었어?", {
      route: { mode: "question", confident: true }, primary: { status: "chat", state,
        message: "확인 중", card: { headline: "", lines: ["확인 중이에요."] } },
    }));
    expect(generic.result?.status).toBe("success");
    const hours = await executeLimitedExplanation(input(task(cafe), "왜 이 카페 넣었어?", {
      route: { mode: "question", confident: true }, primary: { status: "chat", state,
        message: "영업시간", card: { headline: "성수 카페", lines: ["영업시간은 확인 중이에요."] } },
    }));
    expect(hours.result?.status).toBe("success");
  });

  it("models a verified replacement output dependency and explains the new venue only after success", async () => {
    const before = currentPlan();
    const understanding = buildDateTurnUnderstanding({ message: "저녁 바꿔주고 왜 새 장소가 좋은지도 알려줘",
      today: "2026-09-26", state, currentPlan: before });
    const plan = buildDateExecutionPlan({ understanding: { ...understanding,
      goals: [{ type: "modify_itinerary", confidence: 0.9, target: {
        text: "저녁", kind: "category_slot", resolvedId: "discover:kakao:meal", resolvedName: "성수 식당",
        targetType: "plan_item", confidence: 0.9 } },
      { type: "explain_recommendation", confidence: 0.9, target: {
        text: "새 장소", kind: "unresolved", confidence: 0.3 } }],
      requestedChanges: [{ operation: "replace", target: { text: "저녁", kind: "category_slot",
        resolvedId: "discover:kakao:meal", resolvedName: "성수 식당", targetType: "plan_item",
        confidence: 0.9 }, confidence: 0.9 }] }, currentPlan: before });
    expect(plan.tasks[1].deferredTarget).toEqual({ kind: "mutation_output", sourceTaskId: plan.tasks[0].id });
    expect(plan.executable).toBe(true);
    const after: AIPlannerReply = { ...before,
      items: before.items.map((item, index) => index === 0 ? { ...item, id: "new-meal-item",
        placeId: "discover:kakao:new-meal", placeName: "새 식당" } : item),
      recommendations: before.recommendations.map((place, index) => index === 0
        ? { ...place, id: "kakao:new-meal", placeId: "discover:kakao:new-meal", name: "새 식당" } : place) };
    const mutationResult: DateMutationExecutionResult = { taskId: plan.tasks[0].id,
      taskType: "modify_itinerary", source: "existing_mutation_engine", operation: "replace",
      status: "success", changedItemIds: ["meal-item", "new-meal-item"], preservedItemIds: [],
      coveredByLegacyRoute: true, verifiedTarget: true, verificationPassed: true };
    const request = input(plan.tasks[1], understanding.rawMessage,
      { plan, currentPlan: before, resultAfterMutation: after, mutationResult });
    const success = await executeLimitedExplanation(request);
    expect(success.result).toMatchObject({ status: "success", target: { name: "새 식당",
      venueId: "discover:kakao:new-meal" } });
    expect(success.result?.explanation).toContain("새 식당");
    const failure = await executeLimitedExplanation({ ...request,
      mutationResult: { ...mutationResult, status: "failed" } });
    expect(failure.result).toMatchObject({ status: "skipped", failureCode: "mutation_failed" });
    const verifiedMutation = await executeLimitedMutation({ plan, currentPlan: before, primary: after,
      route: { mode: "course", confident: true }, interpreterMode: "assist", executionMode: "limited",
      userMessage: understanding.rawMessage, state, understanding },
    async () => ({ legs: [{ meters: 100, seconds: 300 }], meters: 100, seconds: 300,
      provider: "osm_foot" }));
    expect(verifiedMutation.taskResult?.status).toBe("success");
    const following = await executeLimitedExplanation({ ...request,
      mutationResult: verifiedMutation.taskResult, resultAfterMutation: verifiedMutation.result });
    expect(following.result?.target?.name).toBe("새 식당");
  });

  it("keeps independent cafe explanation available when mutation fails", async () => {
    const modify: DateExecutionTask = { ...task(undefined, { id: "task-1", type: "modify_itinerary",
      goal: "modify_itinerary", changes: [{ operation: "replace", target: {
        kind: "plan_item", placeId: "discover:kakao:meal", name: "성수 식당" }, confidence: 0.9 }] }) };
    const explain = task(cafe, { id: "task-2", executionOrder: 2 });
    const plan: DateExecutionPlan = { tasks: [modify, explain], unresolved: [], executable: true,
      source: "shadow_understanding" };
    const result = await executeLimitedExplanation(input(explain,
      "저녁 바꿔줘. 그리고 왜 이 카페 넣었어?", { plan,
        mutationResult: { taskId: "task-1", taskType: "modify_itinerary",
          source: "existing_mutation_engine", operation: "replace", status: "failed",
          changedItemIds: [], preservedItemIds: [], coveredByLegacyRoute: false,
          verifiedTarget: true, verificationPassed: false, failureCode: "replacement_unavailable" } }));
    expect(result.result?.status).toBe("success");
  });

  it("does not explain an old item as if it survived a successful mutation", async () => {
    const before = currentPlan();
    const after: AIPlannerReply = { ...before,
      items: before.items.filter(item => item.id !== "cafe-item"),
      recommendations: before.recommendations.filter(place => place.placeId !== cafe.placeId) };
    const mutation: DateMutationExecutionResult = { taskId: "task-2",
      taskType: "modify_itinerary", source: "existing_mutation_engine", operation: "remove",
      status: "success", changedItemIds: ["cafe-item"], preservedItemIds: [],
      coveredByLegacyRoute: true, verifiedTarget: true, verificationPassed: true };
    const result = await executeLimitedExplanation(input(task(cafe), "왜 이 카페 넣었어?",
      { resultAfterMutation: after, mutationResult: mutation }));
    expect(result.result).toMatchObject({ status: "skipped", failureCode: "target_disappeared" });
  });

  it("isolates renderer failure and keeps the existing response contract", async () => {
    const original = input(task(), "왜 이 코스로 추천했어?");
    const failed = await executeLimitedExplanation(original, vi.fn(() => { throw Error("formatter failed"); }));
    expect(failed.result).toMatchObject({ status: "failed", failureCode: "explanation_failed" });
    expect(appendRecommendationExplanation(original.primary, failed.result)).toEqual(original.primary);
    const success = await executeLimitedExplanation(original);
    expect(appendRecommendationExplanation(original.primary, success.result).card.lines.at(-1))
      .toContain("추천 이유:");
  });

  it("gates off, shadow, and limited execution independently", async () => {
    for (const mode of [
      { interpreterMode: "off", executionMode: "limited" },
      { interpreterMode: "shadow", executionMode: "limited" },
      { interpreterMode: "assist", executionMode: "shadow" },
    ] as const) {
      const result = await executeLimitedExplanation(input(task(), "왜 이 코스로 추천했어?", mode));
      expect(result.result?.status).toBe("skipped");
    }
    expect((await executeLimitedExplanation(input(task(), "왜 이 코스로 추천했어?"))).result?.status)
      .toBe("success");
  });
});

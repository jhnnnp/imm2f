import { describe, expect, it, vi } from "vitest";
import type { AIPlannerReply, AIPlannerResult } from "@/features/planning/types/plan";
import { emptyDateBrief } from "./dateBrief";
import type { DateExecutionPlan, DateExecutionTask, DateExecutionTaskType } from "./dateExecutionPlan";
import type { DateMutationExecutionResult } from "./dateMutationExecution";
import type { VenueInspectionTaskExecutionResult } from "./dateVenueInspection";
import type { ExplanationTaskExecutionResult } from "./dateRecommendationExplanation";
import type { PlaceRecommendationTaskExecutionResult } from "./datePlaceRecommendationExecution";
import type { PlaceComparisonExecutionResult } from "./datePlaceComparisonExecution";
import type { FeedbackTaskExecutionResult } from "./dateFeedbackExecution";
import { appendVenueInspectionResults } from "./dateVenueInspection";
import { appendRecommendationExplanation } from "./dateRecommendationExplanation";
import { dispatchLimitedDateTasks, MAX_LIMITED_TASK_EXECUTIONS, mergeTaskExecutionResults,
  orderLimitedTasks, type DateTaskExecutionContext, type LimitedTaskExecutors } from "./dateTaskDispatcher";

const primary: AIPlannerResult = { status: "chat", message: "기존 응답", card: {
  headline: "기존", lines: ["기존 응답"], sources: [{ label: "기존", url: "https://example.com/old" }],
}, state: emptyDateBrief() };
const goal: Record<DateExecutionTaskType, DateExecutionTask["goal"]> = {
  create_itinerary: "create_itinerary", modify_itinerary: "modify_itinerary",
  recommend_places: "recommend_places", inspect_venue: "ask_venue", compare_places: "compare_places",
  explain_recommendation: "explain_recommendation", save_itinerary: "save_itinerary",
  record_feedback: "provide_feedback", respond_chat: "general_chat",
};
const task = (type: DateExecutionTaskType, id = type, dependencies: string[] = [],
  executionOrder = 1): DateExecutionTask => ({ id, type, goal: goal[type], dependencies,
  executionOrder, confidence: 0.9, status: "planned", source: "llm" });
const context = (...tasks: DateExecutionTask[]): DateTaskExecutionContext => ({
  plan: { tasks, executable: true, unresolved: [], source: "effective_understanding" }, primary,
  mutation: { currentPlan: null, route: { mode: "course", confident: true }, interpreterMode: "assist",
    executionMode: "limited", userMessage: "요청", state: emptyDateBrief() },
  inspection: { currentPlan: null, route: { mode: "course", confident: true }, interpreterMode: "assist",
    executionMode: "limited", visiblePlaces: [], courseStops: [], userMessage: "요청",
    state: emptyDateBrief(), coupleTaste: { summary: "", commonTastes: [], avoidFoods: [] } },
  explanation: { currentPlan: null, route: { mode: "course", confident: true }, interpreterMode: "assist",
    executionMode: "limited", userMessage: "요청" },
  recommendation: { route: { mode: "course", confident: true }, interpreterMode: "assist",
    executionMode: "limited", state: emptyDateBrief(), message: "카페 추천해줘",
    recommend: async () => primary },
  comparison: { route: { mode: "course", confident: true }, interpreterMode: "assist",
    executionMode: "limited", state: emptyDateBrief(), userMessage: "A랑 B 비교",
    currentPlan: null, visiblePlaces: [] },
  feedback: { interpreterMode: "assist", executionMode: "limited", currentPlan: null,
    visiblePlaces: [], understanding: null, userMessage: "피드백", turnId: "s:1" },
});
const mutationResult = (status: DateMutationExecutionResult["status"] = "success"):
  DateMutationExecutionResult => ({ taskId: "modify_itinerary", taskType: "modify_itinerary",
    source: "existing_mutation_engine", operation: "remove", status,
    changedItemIds: status === "success" ? ["item-1"] : [], preservedItemIds: [],
    coveredByLegacyRoute: false, verifiedTarget: true, verificationPassed: status === "success",
    ...(status === "failed" ? { failureCode: "engine_failed" as const } : {}) });
const inspectResult = (id = "inspect_venue", status: VenueInspectionTaskExecutionResult["status"] = "success"):
  VenueInspectionTaskExecutionResult => ({ taskId: id, taskType: "inspect_venue", source: "existing_venue_question",
    status, coveredByLegacyRoute: status === "skipped", evidenceFound: status === "success",
    ...(status === "skipped" ? { failureCode: "legacy_question_covered" as const } : {}),
    ...(status === "success" ? { data: { request: { venueId: "venue-1", venueName: "카페",
      targetSource: "current_plan" as const, questionType: "parking" as const,
      requestedFacts: ["parking" as const], sourceTaskId: id },
      card: { headline: "주차", lines: ["주차 가능"], suggestions: [],
        sources: [{ label: "근거", url: "https://example.com/parking" }] } } } : {}) });
const explanationResult = (status: ExplanationTaskExecutionResult["status"] = "success"):
  ExplanationTaskExecutionResult => ({ taskId: "explain_recommendation", taskType: "explain_recommendation",
    source: "verified_plan_facts", status, coveredByLegacyRoute: status === "skipped",
    factTypesUsed: ["candidate_fact"], evidenceCount: status === "success" ? 1 : 0,
    ...(status === "success" ? { explanation: "실제 후보 근거가 있어요.",
      sources: [{ label: "근거", url: "https://example.com/explain" }] }
      : { failureCode: "legacy_answer_covered" as const }) });
const placeResult = (): PlaceRecommendationTaskExecutionResult => ({
  taskId: "recommend_places", taskType: "recommend_places", status: "success",
  source: "existing_place_recommendation", coveredByLegacyRoute: false,
  reusedCount: 2, searched: true, selectedCandidateIds: ["kakao:new"],
  card: { headline: "카페", lines: ["새 카페"], stops: [{ name: "새 카페", meta: "카페" }] },
});
const comparisonResult = (): PlaceComparisonExecutionResult => ({
  taskId: "compare_places", taskType: "compare_places", status: "success",
  source: "verified_candidate_facts", candidateIds: ["kakao:a", "kakao:b"],
  comparedFactTypes: ["price"], unknownFactTypes: [], evidenceCount: 0,
  coveredByLegacyRoute: false, lines: ["가격: A 1만원 / B 2만원"], sources: [],
});
const feedbackResult = (): FeedbackTaskExecutionResult => ({
  taskId: "record_feedback", taskType: "record_feedback", status: "success",
  source: "verified_turn_feedback", coveredByLegacyRoute: false, unresolvedTargetCount: 0,
  entries: [{ target: { kind: "place", name: "A", candidateId: "kakao:a" },
    attribute: "noise", sentiment: "negative", strength: 0.9, confidence: 0.9,
    sourceTurn: "s:1", observedAt: "2026-09-26T10:00:00Z", source: "llm" }],
});

function executors(options: { mutationStatus?: DateMutationExecutionResult["status"];
  inspectStatus?: VenueInspectionTaskExecutionResult["status"];
  explainStatus?: ExplanationTaskExecutionResult["status"] } = {}) {
  const modify = vi.fn(async () => ({ result: primary, taskResult: mutationResult(options.mutationStatus),
    observation: null }));
  const inspect = vi.fn(async (input: { plan: DateExecutionPlan | null }) => ({
    results: input.plan!.tasks.filter(row => row.type === "inspect_venue")
      .map(row => inspectResult(row.id, options.inspectStatus)), observations: [],
  }));
  const explain = vi.fn(async () => ({ result: explanationResult(options.explainStatus), observation: null }));
  const recommend = vi.fn(async () => ({ result: placeResult(), observation: {
    type: "task_execution" as const, source: "date_place_recommendation" as const,
    timestamp: "2026-09-26T10:00:00Z", data: { taskType: "recommend_places" as const,
      status: "success" as const, coveredByLegacyRoute: false, reusedCount: 2,
      searched: true, selectedCount: 1, failureCode: null } } }));
  const compare = vi.fn(async () => ({ result: comparisonResult(), observation: {
    type: "task_execution" as const, source: "date_place_comparison" as const,
    timestamp: "2026-09-26T10:00:00Z", data: { taskType: "compare_places" as const,
      status: "success" as const, targetCount: 2, comparedFactTypes: ["price"],
      unknownFactTypes: [], evidenceCount: 0, coveredByLegacyRoute: false, failureCode: null } } }));
  const feedback = vi.fn(async () => ({ result: feedbackResult(), observation: {
    type: "task_execution" as const, source: "date_feedback_execution" as const,
    timestamp: "2026-09-26T10:00:00Z", data: { taskType: "record_feedback" as const,
      status: "success" as const, entryCount: 1, unresolvedTargetCount: 0, failureCode: null } } }));
  return { modify, inspect, explain, recommend, compare, feedback, adapters: {
    modify: { execute: modify }, inspect: { execute: inspect }, explain: { execute: explain },
    recommend: { execute: recommend }, compare: { execute: compare }, feedback: { execute: feedback },
  } as LimitedTaskExecutors };
}

describe("limited task dispatcher", () => {
  it("runs independent comparison when mutation is unresolved and ignores the stale plan-wide flag", async () => {
    const mock = executors();
    const input = context(task("modify_itinerary", "modify", [], 1),
      task("compare_places", "compare", [], 2));
    input.plan.executable = false;
    input.plan.unresolved = [{ code: "unverified_reference", taskId: "modify" }];
    const output = await dispatchLimitedDateTasks(input, mock.adapters);
    expect(mock.modify).not.toHaveBeenCalled();
    expect(mock.compare).toHaveBeenCalledTimes(1);
    expect(output.taskResults.find(row => row.taskId === "modify"))
      .toMatchObject({ status: "skipped", failureCode: "task_invalid" });
    expect(output.taskResults.some(row => row.taskType === "compare_places"
      && row.status === "success")).toBe(true);
    expect(output.observations.at(-1)).toMatchObject({ data: {
      executableTaskCount: 1, blockedTaskCount: 1, independentlyExecutedCount: 1 } });
  });

  it("runs independent recommendation when inspection is unresolved", async () => {
    const mock = executors();
    const input = context(task("inspect_venue", "inspect", [], 1),
      task("recommend_places", "recommend", [], 2));
    input.plan.unresolved = [{ code: "missing_target", taskId: "inspect" }];
    const output = await dispatchLimitedDateTasks(input, mock.adapters);
    expect(mock.inspect).not.toHaveBeenCalled();
    expect(mock.recommend).toHaveBeenCalledTimes(1);
    expect(output.result.card.lines).toContain("새 카페");
  });

  it("blocks only a dependent chain and runs an independent explanation", async () => {
    const mock = executors();
    const input = context(task("recommend_places", "recommend", [], 1),
      task("modify_itinerary", "modify", ["recommend"], 2),
      task("explain_recommendation", "explain", [], 3));
    input.plan.unresolved = [{ code: "missing_target", taskId: "recommend" }];
    const output = await dispatchLimitedDateTasks(input, mock.adapters);
    expect(mock.recommend).not.toHaveBeenCalled();
    expect(mock.modify).not.toHaveBeenCalled();
    expect(mock.explain).toHaveBeenCalledTimes(1);
    expect(output.taskResults.find(row => row.taskId === "modify"))
      .toMatchObject({ status: "skipped", failureCode: "dependency_blocked" });
  });

  it("isolates a missing dependency ID to its chain", async () => {
    const mock = executors();
    const input = context(task("modify_itinerary", "modify", ["absent"], 1),
      task("inspect_venue", "inspect", [], 2));
    const output = await dispatchLimitedDateTasks(input, mock.adapters);
    expect(mock.modify).not.toHaveBeenCalled();
    expect(mock.inspect).toHaveBeenCalledTimes(1);
    expect(output.taskResults.find(row => row.taskId === "modify"))
      .toMatchObject({ status: "skipped", failureCode: "task_invalid" });
  });

  it("blocks cycle members while allowing an unrelated task", async () => {
    const mock = executors();
    const input = context(task("recommend_places", "recommend", ["modify"], 1),
      task("modify_itinerary", "modify", ["recommend"], 2),
      task("compare_places", "compare", [], 3));
    const output = await dispatchLimitedDateTasks(input, mock.adapters);
    expect(mock.recommend).not.toHaveBeenCalled();
    expect(mock.modify).not.toHaveBeenCalled();
    expect(mock.compare).toHaveBeenCalledTimes(1);
    expect(output.taskResults.filter(row => row.status === "skipped")).toHaveLength(2);
  });

  it("preserves the primary response when every task is blocked", async () => {
    const mock = executors();
    const input = context(task("inspect_venue", "inspect", [], 1));
    input.plan.unresolved = [{ code: "missing_target", taskId: "inspect" }];
    const output = await dispatchLimitedDateTasks(input, mock.adapters);
    expect(mock.inspect).not.toHaveBeenCalled();
    expect(output.result).toBe(primary);
  });
  it.each(["inspect_venue", "modify_itinerary", "explain_recommendation"] as const)(
    "calls only the %s executor", async type => {
      const mock = executors();
      const output = await dispatchLimitedDateTasks(context(task(type)), mock.adapters);
      expect(mock.inspect).toHaveBeenCalledTimes(type === "inspect_venue" ? 1 : 0);
      expect(mock.modify).toHaveBeenCalledTimes(type === "modify_itinerary" ? 1 : 0);
      expect(mock.explain).toHaveBeenCalledTimes(type === "explain_recommendation" ? 1 : 0);
      expect(output.taskResults[0].status).toBe("success");
    });

  it("runs independent inspection and mutation in the plan's execution order", async () => {
    const calls: string[] = [];
    const mock = executors();
    mock.modify.mockImplementation(async () => { calls.push("modify"); return {
      result: primary, taskResult: mutationResult(), observation: null }; });
    mock.inspect.mockImplementation(async input => { calls.push("inspect"); return {
      results: input.plan!.tasks.filter(row => row.type === "inspect_venue").map(row => inspectResult(row.id)),
      observations: [] }; });
    const output = await dispatchLimitedDateTasks(context(task("inspect_venue", "inspect_venue", [], 1),
      task("modify_itinerary", "modify_itinerary", [], 2)), mock.adapters);
    expect(calls).toEqual(["inspect", "modify"]);
    expect(output.taskResults.filter(row => row.status === "success")).toHaveLength(2);
  });

  it("runs an explanation after successful mutation and passes its result", async () => {
    const mock = executors();
    await dispatchLimitedDateTasks(context(task("explain_recommendation", "explain_recommendation",
      ["modify_itinerary"], 2), task("modify_itinerary", "modify_itinerary", [], 1)), mock.adapters);
    expect(mock.explain).toHaveBeenCalledTimes(1);
    expect(mock.explain.mock.calls[0][0].mutationResult?.status).toBe("success");
  });

  it("passes the changed plan to a dependent explanation and merges all three task outputs", async () => {
    const changed: AIPlannerReply = { status: "plan", message: "변경된 코스", card: {
      headline: "변경", lines: ["변경된 코스"] }, condition: { dateLabel: "2026-09-26",
      startTime: "15:00", endTime: "21:00", budget: null, region: "성수", timeSpecified: true },
      recommendations: [], items: [], candidateCount: 0, source: "fallback", state: emptyDateBrief() };
    const mock = executors();
    mock.modify.mockResolvedValue({ result: changed, taskResult: mutationResult(), observation: null });
    const output = await dispatchLimitedDateTasks(context(task("modify_itinerary", "modify_itinerary", [], 1),
      task("inspect_venue", "inspect_venue", [], 2),
      task("explain_recommendation", "explain_recommendation", ["modify_itinerary"], 3)), mock.adapters);
    expect(mock.explain.mock.calls[0][0].resultAfterMutation).toMatchObject({ status: "plan",
      message: "변경된 코스 카페: 주차 가능" });
    expect(output.result).toMatchObject({ status: "plan",
      message: "변경된 코스 카페: 주차 가능 추천 이유: 실제 후보 근거가 있어요." });
    expect(output.workingPlan?.message).toBe(output.result.message);
    expect(output.result.card.lines).toEqual(["변경된 코스", "카페: 주차 가능", "추천 이유: 실제 후보 근거가 있어요."]);
  });

  it("skips a dependent explanation when mutation fails", async () => {
    const mock = executors({ mutationStatus: "failed" });
    const output = await dispatchLimitedDateTasks(context(task("modify_itinerary", "modify_itinerary", [], 1),
      task("explain_recommendation", "explain_recommendation", ["modify_itinerary"], 2)), mock.adapters);
    expect(mock.explain).not.toHaveBeenCalled();
    expect(output.taskResults.find(row => row.taskType === "explain_recommendation"))
      .toMatchObject({ status: "skipped", failureCode: "dependency_failed" });
    expect(output.observations.at(-1)?.type).toBe("task_dispatch");
  });

  it("continues independent mutation after inspection failure", async () => {
    const mock = executors({ inspectStatus: "failed" });
    const output = await dispatchLimitedDateTasks(context(task("inspect_venue", "inspect_venue", [], 1),
      task("modify_itinerary", "modify_itinerary", [], 2)), mock.adapters);
    expect(mock.modify).toHaveBeenCalledTimes(1);
    expect(output.taskResults.find(row => row.taskType === "modify_itinerary")?.status).toBe("success");
  });

  it("runs recommendation beside mutation and merges its card within the existing result", async () => {
    const mock = executors();
    const output = await dispatchLimitedDateTasks(context(task("modify_itinerary", "modify_itinerary", [], 1),
      task("recommend_places", "recommend_places", [], 2)), mock.adapters);
    expect(mock.modify).toHaveBeenCalledTimes(1);
    expect(mock.recommend).toHaveBeenCalledTimes(1);
    expect(output.result.card.lines).toEqual(["기존 응답", "추가 장소 추천", "새 카페"]);
    expect(output.result.card.stops?.map(stop => stop.name)).toEqual(["새 카페"]);
  });

  it("continues independent recommendation when mutation fails", async () => {
    const mock = executors({ mutationStatus: "failed" });
    const output = await dispatchLimitedDateTasks(context(task("modify_itinerary", "modify_itinerary", [], 1),
      task("recommend_places", "recommend_places", [], 2)), mock.adapters);
    expect(mock.recommend).toHaveBeenCalledTimes(1);
    expect(output.taskResults.find(row => row.taskType === "recommend_places")?.status).toBe("success");
  });

  it("records feedback before an independent recommendation and forwards only session soft signals", async () => {
    const mock = executors();
    const output = await dispatchLimitedDateTasks(context(task("record_feedback", "record_feedback", [], 1),
      task("recommend_places", "recommend_places", [], 2)), mock.adapters);
    expect(mock.feedback).toHaveBeenCalledTimes(1);
    expect(mock.recommend.mock.calls[0][0].sessionFeedback?.entries).toMatchObject([
      { attribute: "noise", sentiment: "negative", target: { candidateId: "kakao:a" } },
    ]);
    expect(output.taskResults.map(row => row.status)).toEqual(["success", "success"]);
    expect(output.result.card.lines).toEqual(["기존 응답", "추가 장소 추천", "새 카페"]);
  });

  it("keeps independent feedback when comparison throws", async () => {
    const mock = executors();
    mock.compare.mockRejectedValueOnce(new Error("comparison failed"));
    const output = await dispatchLimitedDateTasks(context(task("compare_places", "compare_places", [], 1),
      task("record_feedback", "record_feedback", [], 2)), mock.adapters);
    expect(output.taskResults.find(row => row.taskType === "compare_places"))
      .toMatchObject({ status: "failed", failureCode: "executor_threw" });
    expect(output.taskResults.find(row => row.taskType === "record_feedback")?.status).toBe("success");
    expect(output.result).toBe(primary);
  });

  it("appends a comparison within the existing result contract", async () => {
    const mock = executors();
    const output = await dispatchLimitedDateTasks(context(task("compare_places")), mock.adapters);
    expect(mock.compare).toHaveBeenCalledTimes(1);
    expect(output.result).toMatchObject({ status: "chat",
      card: { lines: ["기존 응답", "장소 비교: 가격: A 1만원 / B 2만원"] } });
    expect(output.result.message).toContain("장소 비교:");
  });

  it("shows independent recommendation and comparison in the user's requested order", async () => {
    const mock = executors();
    const output = await dispatchLimitedDateTasks(context(task("compare_places", "compare_places", [], 1),
      task("recommend_places", "recommend_places", [], 2)), mock.adapters);
    expect(output.result.card.lines).toEqual(["기존 응답",
      "장소 비교: 가격: A 1만원 / B 2만원", "추가 장소 추천", "새 카페"]);
  });

  it("keeps three-goal mutation, inspection and comparison as distinct response sections", async () => {
    const mock = executors();
    const output = await dispatchLimitedDateTasks(context(
      task("modify_itinerary", "modify_itinerary", [], 1),
      task("inspect_venue", "inspect_venue", [], 2),
      task("compare_places", "compare_places", [], 3)), mock.adapters);
    expect(output.taskResults.filter(row => row.status === "success")).toHaveLength(3);
    expect(output.result.card.lines).toEqual(["기존 응답", "카페: 주차 가능",
      "장소 비교: 가격: A 1만원 / B 2만원"]);
    expect(output.result.card.sources?.map(source => source.url)).toEqual([
      "https://example.com/old", "https://example.com/parking"]);
  });

  it("suppresses an exact primary fact repeated by a supplementary inspection", () => {
    const alreadyAnswered = { ...primary, message: "기존 응답 카페: 주차 가능",
      card: { ...primary.card, lines: ["기존 응답", "카페: 주차 가능"] } };
    const merged = mergeTaskExecutionResults(alreadyAnswered, null, [inspectResult()], null);
    expect(merged.message).toBe(alreadyAnswered.message);
    expect(merged.card.lines).toEqual(alreadyAnswered.card.lines);
    expect(merged.card.sources?.map(row => row.url)).toEqual([
      "https://example.com/old", "https://example.com/parking"]);
  });

  it("does not append a place card already shown by the primary answer", () => {
    const withPlace = { ...primary, card: { ...primary.card,
      stops: [{ name: "새 카페", meta: "카페" }] } };
    const merged = mergeTaskExecutionResults(withPlace, null, [], null, placeResult());
    expect(merged).toBe(withPlace);
    expect(merged.card.stops).toHaveLength(1);
  });

  it("keeps unsupported task types in shadow", async () => {
    const mock = executors();
    const output = await dispatchLimitedDateTasks(context(task("create_itinerary")), mock.adapters);
    expect(output.result).toBe(primary);
    expect(output.taskResults[0]).toMatchObject({ status: "skipped", failureCode: "shadow_task" });
    expect(mock.modify).not.toHaveBeenCalled();
    expect(mock.inspect).not.toHaveBeenCalled();
    expect(mock.explain).not.toHaveBeenCalled();
  });

  it("preserves the existing executor's legacy coverage decision", async () => {
    const mock = executors({ inspectStatus: "skipped" });
    const output = await dispatchLimitedDateTasks(context(task("inspect_venue")), mock.adapters);
    expect(output.result).toBe(primary);
    expect(output.taskResults[0]).toMatchObject({ coveredByLegacyRoute: true,
      failureCode: "legacy_question_covered" });
  });

  it("keeps the three-inspection cap and five-execution cap", async () => {
    const mock = executors();
    mock.inspect.mockImplementation(async input => ({ results: input.plan!.tasks.filter(row => row.type === "inspect_venue")
      .map(row => inspectResult(row.id)), observations: [] }));
    const tasks = [task("modify_itinerary", "modify_itinerary", [], 1),
      ...Array.from({ length: 5 }, (_, i) => task("inspect_venue", `inspect-${i}`, [], i + 2)),
      task("explain_recommendation", "explain_recommendation", [], 7)];
    const output = await dispatchLimitedDateTasks(context(...tasks), mock.adapters);
    expect(mock.inspect).toHaveBeenCalledTimes(1);
    expect(output.taskResults.filter(row => row.status === "success")).toHaveLength(MAX_LIMITED_TASK_EXECUTIONS);
    expect(output.taskResults.filter(row => row.failureCode === "limit_reached")).toHaveLength(2);
  });

  it("isolates an unexpected executor throw", async () => {
    const mock = executors();
    mock.modify.mockRejectedValueOnce(new Error("unexpected"));
    const output = await dispatchLimitedDateTasks(context(task("modify_itinerary", "modify_itinerary", [], 1),
      task("inspect_venue", "inspect_venue", [], 2)), mock.adapters);
    expect(output.taskResults.find(row => row.taskType === "modify_itinerary"))
      .toMatchObject({ status: "failed", failureCode: "executor_threw" });
    expect(mock.inspect).toHaveBeenCalledTimes(1);
    expect(output.result.message).toContain("카페: 주차 가능");
  });

  it("merges the same message, card, and sources as the previous sequential append path", () => {
    const inspections = [inspectResult()];
    const explanation = explanationResult();
    const expected = appendRecommendationExplanation(appendVenueInspectionResults(primary, inspections), explanation);
    expect(mergeTaskExecutionResults(primary, primary, inspections, explanation)).toEqual(expected);
    expect(expected.card.sources?.map(source => source.url)).toEqual([
      "https://example.com/old", "https://example.com/parking", "https://example.com/explain",
    ]);
  });

  it("sorts by dependencies before task-kind priority and execution order", () => {
    const ordered = orderLimitedTasks([task("explain_recommendation", "explain", ["inspect"], 3),
      task("inspect_venue", "inspect", [], 2), task("modify_itinerary", "modify", [], 1)]);
    expect(ordered.map(row => row.id)).toEqual(["modify", "inspect", "explain"]);
  });
});

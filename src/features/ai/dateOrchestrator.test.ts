import { describe, expect, it, vi } from "vitest";
import type { AIPlannerResult } from "@/features/planning/types/plan";
import { emptyDateBrief } from "./dateBrief";
import type { DateExecutionPlan, DateExecutionTask, DateExecutionTaskType } from "./dateExecutionPlan";
import { dispatchLimitedDateTasks, type DateTaskDispatchOutput,
  type DateTaskExecutionContext, type LimitedTaskExecutors } from "./dateTaskDispatcher";
import { orchestrateDateTurn, type DateOrchestrationRequest } from "./dateOrchestrator";

const primary: AIPlannerResult = { status: "chat", message: "기존 응답",
  card: { headline: "기존", lines: ["기존 응답"] }, state: emptyDateBrief() };
const task = (id: string, type: DateExecutionTaskType, dependencies: string[] = [],
  executionOrder = 1): DateExecutionTask => ({ id, type,
  goal: type === "inspect_venue" ? "ask_venue" : type === "record_feedback"
    ? "provide_feedback" : type,
  dependencies, executionOrder, confidence: 0.9, status: "planned", source: "llm" });
const plan = (...tasks: DateExecutionTask[]): DateExecutionPlan => ({ tasks, unresolved: [],
  executable: true, source: "effective_understanding" });
const context = (executionPlan: DateExecutionPlan): DateTaskExecutionContext => ({
  plan: executionPlan, primary,
  mutation: {} as DateTaskExecutionContext["mutation"],
  inspection: {} as DateTaskExecutionContext["inspection"],
  explanation: {} as DateTaskExecutionContext["explanation"],
});
const request = (executionPlan: DateExecutionPlan | null,
  changes: Partial<DateOrchestrationRequest> = {}): DateOrchestrationRequest => ({
  executePrimary: () => primary, legacyRoute: { mode: "course", confident: true },
  executionMode: "limited", executionPlan,
  taskContext: () => context(executionPlan!), ...changes,
});
const dispatchOutput = (finalResult: AIPlannerResult, taskResults: DateTaskDispatchOutput["taskResults"]):
  DateTaskDispatchOutput => ({ result: finalResult, taskResults, observations: [],
    workingPlan: finalResult.status === "plan" ? finalResult : null });
const fakeDispatch = (output: DateTaskDispatchOutput) =>
  vi.fn(async () => output) as unknown as typeof dispatchLimitedDateTasks;

describe("date orchestration boundary", () => {
  it("returns the primary result alone when execution is off or no plan exists", async () => {
    const executePrimary = vi.fn(() => primary);
    const dispatch = fakeDispatch(dispatchOutput(primary, []));
    const off = await orchestrateDateTurn(request(plan(task("inspect", "inspect_venue")),
      { executePrimary, executionMode: "off" }), dispatch);
    const noPlan = await orchestrateDateTurn(request(null, { executePrimary }), dispatch);
    expect(executePrimary).toHaveBeenCalledTimes(2);
    expect(dispatch).not.toHaveBeenCalled();
    expect(off.finalResult).toBe(primary);
    expect(noPlan.executionSummary).toMatchObject({ plannedTaskCount: 0, executedTaskCount: 0 });
  });

  it("executes primary before dispatch and returns both results with a summary", async () => {
    const sequence: string[] = [];
    const executionPlan = plan(task("inspect", "inspect_venue"));
    const finalResult = { ...primary, message: "기존 응답 카페 주차 정보" };
    const dispatch = vi.fn(async () => {
      sequence.push("supplementary");
      return dispatchOutput(finalResult, [{ taskId: "inspect", taskType: "inspect_venue",
        status: "success", source: "limited_task_dispatcher", coveredByLegacyRoute: false,
        evidenceFound: true } as DateTaskDispatchOutput["taskResults"][number]]);
    }) as unknown as typeof dispatchLimitedDateTasks;
    const result = await orchestrateDateTurn(request(executionPlan, { executePrimary: () => {
      sequence.push("primary"); return primary;
    } }), dispatch);
    expect(sequence).toEqual(["primary", "supplementary"]);
    expect(result.primaryResult).toBe(primary);
    expect(result.finalResult).toBe(finalResult);
    expect(result.executionSummary).toMatchObject({ primaryRoute: "course",
      plannedTaskCount: 1, executableTaskCount: 1, executedTaskCount: 1,
      successCount: 1, failedCount: 0 });
  });

  it("keeps independent comparison executable beside an unresolved mutation", async () => {
    const executionPlan = plan(task("modify", "modify_itinerary", [], 1),
      task("compare", "compare_places", [], 2));
    executionPlan.executable = false; // Older callers may still carry a stale plan-wide flag.
    executionPlan.unresolved = [{ code: "unverified_reference", taskId: "modify" }];
    const result = await orchestrateDateTurn(request(executionPlan), fakeDispatch(dispatchOutput(primary, [
      { taskId: "modify", taskType: "modify_itinerary", status: "skipped",
        source: "limited_task_dispatcher", coveredByLegacyRoute: false, failureCode: "task_invalid" },
      { taskId: "compare", taskType: "compare_places", status: "success",
        source: "limited_task_dispatcher", coveredByLegacyRoute: false },
    ])));
    expect(result.executionSummary).toMatchObject({ executableTaskCount: 1,
      successCount: 1, skippedCount: 1 });
  });

  it("reports a dependency-blocked chain without losing an independent task", async () => {
    const executionPlan = plan(task("recommend", "recommend_places", [], 1),
      task("modify", "modify_itinerary", ["recommend"], 2),
      task("inspect", "inspect_venue", [], 3));
    executionPlan.unresolved = [{ code: "missing_target", taskId: "recommend" }];
    const result = await orchestrateDateTurn(request(executionPlan), fakeDispatch(dispatchOutput(primary, [
      { taskId: "recommend", taskType: "recommend_places", status: "skipped",
        source: "limited_task_dispatcher", coveredByLegacyRoute: false, failureCode: "task_invalid" },
      { taskId: "modify", taskType: "modify_itinerary", status: "skipped",
        source: "limited_task_dispatcher", coveredByLegacyRoute: false, failureCode: "dependency_blocked" },
      { taskId: "inspect", taskType: "inspect_venue", status: "success",
        source: "limited_task_dispatcher", coveredByLegacyRoute: false },
    ])));
    expect(result.executionSummary).toMatchObject({ executableTaskCount: 1,
      dependencyBlockedCount: 1, successCount: 1 });
  });

  it("carries session feedback and shown recommendations without persisting memory", async () => {
    const session = { feedbackEntries: [] as Array<{ attribute: string }> ,
      supplementaryShown: [] as Array<{ name: string; address?: string }> };
    const executionPlan = plan(task("feedback", "record_feedback", [], 1),
      task("recommend", "recommend_places", [], 2));
    const result = await orchestrateDateTurn(request(executionPlan, { session: session as DateOrchestrationRequest["session"] }),
      fakeDispatch(dispatchOutput(primary, [
        { taskId: "feedback", taskType: "record_feedback", status: "success",
          source: "verified_turn_feedback", coveredByLegacyRoute: false,
          unresolvedTargetCount: 0, entries: [{ target: { kind: "place", name: "A" },
            attribute: "noise", sentiment: "negative", strength: 0.9, confidence: 0.9,
            sourceTurn: "session:1", observedAt: "2026-09-26T10:00:00Z", source: "llm" }] },
        { taskId: "recommend", taskType: "recommend_places", status: "success",
          source: "existing_place_recommendation", coveredByLegacyRoute: false,
          reusedCount: 1, searched: false, selectedCandidateIds: ["cafe-b"],
          card: { headline: "추천", lines: ["카페 B"], stops: [{ name: "카페 B", meta: "카페" }] } },
      ])));
    expect(session.feedbackEntries.map(row => row.attribute)).toEqual(["noise"]);
    expect(session.supplementaryShown).toEqual([{ name: "카페 B" }]);
    expect(result.finalResult).toBe(primary);
  });

  it("isolates an unexpected dispatcher failure after primary completion", async () => {
    const dispatch: typeof dispatchLimitedDateTasks = vi.fn(async () => {
      throw new Error("executor failure");
    });
    const result = await orchestrateDateTurn(request(plan(task("inspect", "inspect_venue"))), dispatch);
    expect(result.finalResult).toBe(primary);
    expect(result.taskResults).toEqual([]);
  });

  it("matches the existing dispatcher output for the same inspection fixture", async () => {
    const executionPlan = plan(task("inspect_venue", "inspect_venue"));
    const input = context(executionPlan);
    const executors = { inspect: { execute: async () => ({ results: [{
      taskId: "inspect_venue", taskType: "inspect_venue", status: "success",
      source: "existing_venue_question", coveredByLegacyRoute: false, evidenceFound: true,
      data: { request: { venueId: "venue-1", venueName: "카페",
        targetSource: "current_plan", questionType: "parking", requestedFacts: ["parking"],
        sourceTaskId: "inspect_venue" },
        card: { headline: "주차", lines: ["주차 가능"], suggestions: [], sources: [] } },
    }], observations: [] }) } } as unknown as LimitedTaskExecutors;
    const before = await dispatchLimitedDateTasks(input, executors);
    const after = await orchestrateDateTurn(request(executionPlan,
      { taskContext: () => input }), dispatchLimitedDateTasks, executors);
    expect(after.finalResult).toEqual(before.result);
    expect(after.taskResults).toEqual(before.taskResults);
    expect(after.finalResult.message).toContain("주차 가능");
  });

  it("coordinates mutation, independent inspection and dependent explanation through the dispatcher", async () => {
    const calls: string[] = [];
    const executionPlan = plan(task("modify_itinerary", "modify_itinerary", [], 1),
      task("inspect_venue", "inspect_venue", [], 2),
      task("explain_recommendation", "explain_recommendation", ["modify_itinerary"], 3));
    const executors = {
      modify: { execute: async () => {
        calls.push("modify");
        return { result: primary, taskResult: { taskId: "modify_itinerary",
          taskType: "modify_itinerary", status: "success", source: "existing_mutation_engine",
          operation: "remove", changedItemIds: ["old"], preservedItemIds: [],
          coveredByLegacyRoute: false, verifiedTarget: true, verificationPassed: true }, observation: null };
      } },
      inspect: { execute: async () => {
        calls.push("inspect");
        return { results: [{ taskId: "inspect_venue", taskType: "inspect_venue",
          status: "success", source: "existing_venue_question", coveredByLegacyRoute: false,
          evidenceFound: true, data: { request: { venueId: "cafe", venueName: "카페",
            targetSource: "current_plan", questionType: "parking", requestedFacts: ["parking"],
            sourceTaskId: "inspect_venue" }, card: { headline: "주차", lines: ["주차 가능"],
            suggestions: [], sources: [{ label: "근거", url: "https://example.com/fact" }] } } }],
          observations: [] };
      } },
      explain: { execute: async () => {
        calls.push("explain");
        return { result: { taskId: "explain_recommendation", taskType: "explain_recommendation",
          status: "success", source: "verified_plan_facts", coveredByLegacyRoute: false,
          factTypesUsed: ["candidate_fact"], evidenceCount: 1,
          explanation: "근거가 확인됐어요.",
          sources: [{ label: "근거", url: "https://example.com/fact" }] }, observation: null };
      } },
    } as unknown as LimitedTaskExecutors;
    const output = await orchestrateDateTurn(request(executionPlan),
      dispatchLimitedDateTasks, executors);
    expect(calls).toEqual(["modify", "inspect", "explain"]);
    expect(output.taskResults.map(row => row.status)).toEqual(["success", "success", "success"]);
    expect(output.finalResult.card.lines).toEqual(["기존 응답", "카페: 주차 가능", "추천 이유: 근거가 확인됐어요."]);
    expect(output.finalResult.card.sources).toHaveLength(1);
  });
});

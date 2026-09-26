import { describe, expect, it, vi } from "vitest";
import type { AIChatStop, AIPlannerReply } from "@/features/planning/types/plan";
import { emptyDateBrief } from "./dateBrief";
import type { DateExecutionPlan, DateExecutionTask } from "./dateExecutionPlan";
import { appendVenueInspectionResults, executeSupplementaryInspections, getDateExecutionMode,
  inspectCoverage, inspectEligibility, venueQuestionType } from "./dateVenueInspection";

const state = { ...emptyDateBrief(), region: "성수", regions: ["성수"], areas: ["성수"] };
const cafe: AIChatStop = { name: "정원 카페", meta: "카페", address: "서울 성동구 성수동" };
const currentPlan: AIPlannerReply = {
  status: "plan", message: "현재 코스", card: { headline: "성수", lines: ["현재 코스"], stops: [cafe] },
  condition: { dateLabel: "2026-09-26", startTime: "15:00", endTime: "21:00", budget: null,
    region: "성수", timeSpecified: true },
  recommendations: [{ id: "kakao:cafe", placeId: "discover:kakao:cafe", name: cafe.name,
    activitySlot: "cafe", category: "카페", district: "성동구", address: cafe.address!, phone: "", mapUrl: "",
    coordinates: [127.04, 37.56], durationMinutes: 60, expectedCost: 0, reasons: [], isSaved: false,
    distanceFromPreviousMeters: null }],
  items: [{ id: "item-1", placeId: "discover:kakao:cafe", placeName: cafe.name,
    category: "카페", startTime: "17:00", durationMinutes: 60, expectedCost: 0, order: 0,
    memo: "", dayIndex: 0 }], candidateCount: 1, source: "fallback", state,
};
const route = { mode: "course" as const, confident: true };
const inspect = (overrides: Partial<DateExecutionTask> = {}): DateExecutionTask => ({
  id: "task-2", type: "inspect_venue", goal: "ask_venue", target: {
    kind: "plan_item", placeId: "discover:kakao:cafe", name: cafe.name },
  question: { attribute: "parking" }, dependencies: [], executionOrder: 2, confidence: 0.9,
  status: "planned", source: "llm", ...overrides,
});
const modify: DateExecutionTask = { id: "task-1", type: "modify_itinerary", goal: "modify_itinerary",
  target: { kind: "plan_item", placeId: "discover:kakao:cafe", name: cafe.name },
  changes: [{ operation: "replace", target: { kind: "plan_item", placeId: "discover:kakao:cafe", name: cafe.name } }],
  dependencies: [], executionOrder: 1, confidence: 0.9, status: "planned", source: "llm" };
const plan = (tasks: DateExecutionTask[] = [modify, inspect()]): DateExecutionPlan => ({
  tasks, unresolved: [], executable: true, source: "shadow_understanding",
});
const input = (overrides: Partial<Parameters<typeof executeSupplementaryInspections>[0]> = {}) => ({
  plan: plan(), route, interpreterMode: "assist" as const, executionMode: "limited" as const,
  currentPlan, visiblePlaces: [] as AIChatStop[], courseStops: [cafe],
  userMessage: "저녁 바꿔줘. 그리고 지금 카페 주차 돼?", state,
  coupleTaste: { summary: "", commonTastes: [], avoidFoods: [] }, ...overrides,
});
const answer = vi.fn(async () => ({ headline: cafe.name, lines: ["주차 정보를 확인했어요."],
  sources: [{ label: "place.example", url: "https://place.example/cafe" }], suggestions: [] }));

describe("limited venue inspection", () => {
  it("keeps the separate execution flag off by default", () => {
    vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "");
    expect(getDateExecutionMode()).toBe("off");
    vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "shadow");
    expect(getDateExecutionMode()).toBe("shadow");
    vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "limited");
    expect(getDateExecutionMode()).toBe("limited");
    vi.unstubAllEnvs();
  });

  it("treats the existing question route as covered", async () => {
    expect(inspectCoverage({ mode: "question", confident: true }).coveredByLegacyRoute).toBe(true);
    expect(inspectCoverage({ mode: "places", confident: true }).shouldExecuteSupplementary).toBe(true);
    expect(inspectCoverage({ mode: "chat", confident: true }).shouldExecuteSupplementary).toBe(true);
    answer.mockClear();
    const result = await executeSupplementaryInspections(input({ route: { mode: "question", confident: true } }), answer);
    expect(result.results[0]).toMatchObject({ status: "skipped", failureCode: "legacy_question_covered" });
    expect(answer).not.toHaveBeenCalled();
  });

  it("executes only verified inspect; the modify task remains untouched", async () => {
    answer.mockClear();
    const result = await executeSupplementaryInspections(input(), answer);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ status: "success", evidenceFound: true,
      data: { request: { venueId: "discover:kakao:cafe", venueName: cafe.name, questionType: "parking" } } });
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ message: "정원 카페 주차 가능 여부 알려줘",
      stops: [cafe] }));
    expect(result.observations[0]).toMatchObject({ type: "task_execution",
      data: { taskType: "inspect_venue", status: "success", evidenceFound: true } });
  });

  it("rejects an invented target ID, unresolved target, low confidence and unsupported condition", () => {
    const check = (task: DateExecutionTask) => inspectEligibility({ ...input({ plan: plan([task]) }), task });
    expect(check(inspect({ id: "task-1", executionOrder: 1,
      target: { kind: "plan_item", name: cafe.name, placeId: "invented" } })))
      .toMatchObject({ failureCode: "invalid_plan" });
    expect(check(inspect({ id: "task-1", executionOrder: 1, target: undefined, status: "unresolved" })))
      .toMatchObject({ failureCode: "invalid_plan" });
    expect(check(inspect({ id: "task-1", executionOrder: 1, confidence: 0.4 })))
      .toMatchObject({ failureCode: "low_confidence" });
    expect(check(inspect({ id: "task-1", executionOrder: 1, condition: {
      kind: "unsupported_predicate", afterTaskId: "task-0", expected: "unavailable" } })))
      .toMatchObject({ failureCode: "invalid_plan" });
  });

  it("requires assist plus limited mode and a grounded supported question", async () => {
    answer.mockClear();
    for (const variant of [input({ interpreterMode: "shadow" }), input({ interpreterMode: "off" }),
      input({ executionMode: "off" }), input({ executionMode: "shadow" })]) {
      const result = await executeSupplementaryInspections(variant, answer);
      expect(result.results[0].status).toBe("skipped");
    }
    expect(answer).not.toHaveBeenCalled();
    expect(venueQuestionType("parking", "지금 카페 어때?")).toBe("general");
    expect(venueQuestionType("hours", "카페 영업시간 알려줘")).toBe("opening_hours");
    expect(venueQuestionType("made_up", "주차 돼?")).toBe("general");
  });

  it("keeps a source-free parking answer unknown and does not guess", async () => {
    const ungrounded = vi.fn(async () => ({ headline: cafe.name, lines: ["주차 가능해요."], suggestions: [] }));
    const result = await executeSupplementaryInspections(input(), ungrounded);
    expect(result.results[0]).toMatchObject({ status: "success", evidenceFound: false });
    expect(result.results[0].data?.card.lines[0]).toContain("아직 확인하지 못했어요");
    expect(result.results[0].data?.card.lines[0]).not.toContain("주차 가능해요");
  });

  it("isolates a failed lookup and preserves the primary result", async () => {
    const failed = vi.fn(async (): Promise<never> => { throw new Error("lookup_failed"); });
    const result = await executeSupplementaryInspections(input(), failed);
    expect(result.results[0]).toMatchObject({ status: "failed", failureCode: "lookup_failed" });
    expect(appendVenueInspectionResults(currentPlan, result.results)).toBe(currentPlan);
  });

  it("deduplicates matching venue and question while preserving both task records", async () => {
    const tasks = [inspect({ id: "task-1", executionOrder: 1 }), inspect({ id: "task-2", executionOrder: 2 })];
    answer.mockClear();
    const result = await executeSupplementaryInspections(input({ plan: plan(tasks) }), answer);
    expect(result.results.map(item => item.status)).toEqual(["success", "skipped"]);
    expect(result.results[1].failureCode).toBe("duplicate");
    expect(answer).toHaveBeenCalledTimes(1);
  });

  it("accepts a uniquely visible place without inventing a venue ID", async () => {
    const visible = { ...cafe, name: "다른 카페" };
    const task = inspect({ id: "task-1", executionOrder: 1,
      target: { kind: "place", name: visible.name } });
    const result = await executeSupplementaryInspections(input({ plan: plan([task]),
      visiblePlaces: [visible], courseStops: [] }), answer);
    expect(result.results[0].data?.request).toMatchObject({ venueId: null,
      targetSource: "visible_places", venueName: visible.name });
  });

  it("bounds distinct inspections to three while retaining every task outcome", async () => {
    const visible = [1, 2, 3, 4].map(index => ({ ...cafe, name: `카페 ${index}` }));
    const tasks = visible.map((stop, index) => inspect({ id: `task-${index + 1}`,
      executionOrder: index + 1, target: { kind: "place", name: stop.name } }));
    answer.mockClear();
    const result = await executeSupplementaryInspections(input({ plan: plan(tasks),
      visiblePlaces: visible, courseStops: [] }), answer);
    expect(result.results.map(item => item.status)).toEqual(["success", "success", "success", "skipped"]);
    expect(result.results[3].failureCode).toBe("limit_reached");
    expect(answer).toHaveBeenCalledTimes(3);
  });
});

import { describe, expect, it } from "vitest";
import type { AIPlannerReply, AIPlannerState, AIPlaceRecommendation, PlanItem } from "@/features/planning/types/plan";
import { emptyDateBrief } from "./dateBrief";
import { buildDateContext } from "./dateContext";
import { buildDateTurnUnderstanding, type DateGoal, type DateReference, type DateTurnUnderstanding } from "./dateTurnUnderstanding";
import { buildDateExecutionPlan, compareDateExecutionPlan, executionPlanObservation,
  observeDateExecutionPlan, validateDateExecutionPlan, validateDateExecutionTasks,
  validateDateExecutionStructure, type DateExecutionPlan } from "./dateExecutionPlan";

const today = "2026-09-26";
const state = (): AIPlannerState => ({ ...emptyDateBrief(), region: "성수", regions: ["성수"], areas: ["성수"] });
const rec = (id: string, name: string, slot: "meal" | "cafe"): AIPlaceRecommendation => ({
  id: `kakao:${id}`, placeId: `discover:kakao:${id}`, name, activitySlot: slot,
  category: slot === "meal" ? "식당" : "카페", district: "성동구", address: "", phone: "", mapUrl: "",
  coordinates: [127.04, 37.56], durationMinutes: 60, expectedCost: 0, reasons: [], isSaved: false,
  distanceFromPreviousMeters: null,
});
const item = (id: string, name: string, order: number): PlanItem => ({
  id, placeId: `discover:kakao:${id}`, placeName: name, category: order ? "카페" : "식당",
  startTime: order ? "17:00" : "15:00", durationMinutes: 60, expectedCost: 0,
  order, memo: "", dayIndex: 0,
});
const currentPlan = (): AIPlannerReply => ({
  status: "plan", message: "현재 코스", card: { headline: "성수", lines: ["현재 코스"] },
  condition: { dateLabel: today, startTime: "15:00", endTime: "21:00", budget: null,
    region: "성수", timeSpecified: true },
  recommendations: [rec("1", "저녁 식당", "meal"), rec("2", "정원 카페", "cafe")],
  items: [item("1", "저녁 식당", 0), item("2", "정원 카페", 1)],
  candidateCount: 2, source: "fallback", state: state(),
});
const understand = (message: string, plan: AIPlannerReply | null = null) =>
  buildDateTurnUnderstanding({ message, today, state: state(), currentPlan: plan });
const goal = (type: DateGoal["type"], target?: DateReference, attribute?: string): DateGoal =>
  ({ type, target, attribute, confidence: 0.9 });
const planFor = (understanding: DateTurnUnderstanding, plan: AIPlannerReply | null = null) =>
  buildDateExecutionPlan({ understanding, currentPlan: plan, source: "shadow_understanding" });

describe("shadow execution planning", () => {
  it("separates a task's unresolved target from a verified independent inspection", () => {
    const plan: DateExecutionPlan = { source: "effective_understanding", executable: false,
      unresolved: [{ code: "unverified_reference", taskId: "modify" }], tasks: [
        { id: "modify", type: "modify_itinerary", goal: "modify_itinerary", dependencies: [],
          executionOrder: 1, confidence: 0.9, status: "unresolved", source: "llm" },
        { id: "inspect", type: "inspect_venue", goal: "ask_venue",
          target: { kind: "plan_item", name: "정원 카페", placeId: "discover:kakao:2" },
          dependencies: [], executionOrder: 2, confidence: 0.9, status: "planned", source: "llm" },
      ] };
    const checks = validateDateExecutionTasks(plan, currentPlan());
    expect(checks[0]).toMatchObject({ valid: false, executable: false });
    expect(checks[1]).toMatchObject({ valid: true, executable: true,
      blockingIssues: [] });
  });

  it("marks only cycle members and their dependents, not an independent task", () => {
    const plan: DateExecutionPlan = { source: "effective_understanding", executable: false,
      unresolved: [], tasks: [
        { id: "a", type: "recommend_places", goal: "recommend_places", dependencies: ["b"],
          executionOrder: 1, confidence: 0.9, status: "planned", source: "llm" },
        { id: "b", type: "recommend_places", goal: "recommend_places", dependencies: ["a"],
          executionOrder: 2, confidence: 0.9, status: "planned", source: "llm" },
        { id: "dependent", type: "modify_itinerary", goal: "modify_itinerary", dependencies: ["b"],
          executionOrder: 3, confidence: 0.9, status: "planned", source: "llm" },
        { id: "independent", type: "recommend_places", goal: "recommend_places", dependencies: [],
          executionOrder: 4, confidence: 0.9, status: "planned", source: "llm" },
      ] };
    const checks = validateDateExecutionStructure(plan);
    expect(checks.find(row => row.taskId === "a")?.blockingIssues.map(row => row.code))
      .toContain("dependency_cycle");
    expect(checks.find(row => row.taskId === "b")?.blockingIssues.map(row => row.code))
      .toContain("dependency_cycle");
    expect(checks.find(row => row.taskId === "dependent")?.blockingIssues.map(row => row.code))
      .toContain("dependency_blocked");
    expect(checks.find(row => row.taskId === "dependent"))
      .toMatchObject({ valid: true, executable: false });
    expect(checks.find(row => row.taskId === "independent")?.executable).toBe(true);
  });
  it("maps a single itinerary goal", () => {
    const result = planFor(understand("성수 데이트 코스 짜줘"));
    expect(result.tasks.map(task => task.type)).toEqual(["create_itinerary"]);
    expect(result.executable).toBe(true);
  });

  it("maps a place recommendation without turning it into a course", () => {
    const result = planFor(understand("성수 파스타 맛집 추천해줘"));
    expect(result.tasks.map(task => task.type)).toEqual(["recommend_places"]);
  });

  it("keeps a modification and its requested change as a plan only", () => {
    const result = planFor(understand("저녁만 다른 곳으로 바꿔줘", currentPlan()), currentPlan());
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ type: "modify_itinerary", status: "planned",
      target: { kind: "plan_item", placeId: "discover:kakao:1" },
      changes: [{ operation: "replace", target: { placeId: "discover:kakao:1" } }] });
  });

  it("keeps modification and parking inspection as separate tasks and reports route coverage", () => {
    const result = planFor(understand("저녁만 바꿔줘. 그리고 지금 카페 주차 돼?", currentPlan()), currentPlan());
    expect(result.tasks.map(task => task.type)).toEqual(["modify_itinerary", "inspect_venue"]);
    expect(result.tasks[1]).toMatchObject({ target: { placeId: "discover:kakao:2" },
      question: { attribute: "parking" } });
    const comparison = compareDateExecutionPlan(result, { mode: "course", confident: true });
    expect(comparison).toMatchObject({ routeCoverage: "partial", coveredTasks: ["modify_itinerary"],
      additionalTasks: ["inspect_venue"] });
  });

  it("preserves modify then recommend without an invented dependency", () => {
    const message = "두 번째 장소 빼고 근처 카페 하나 추천해줘";
    const base = understand(message, currentPlan());
    const ordinal = base.references.find(reference => reference.kind === "ordinal_place")!;
    const result = planFor({ ...base, goals: [goal("modify_itinerary", ordinal), goal("recommend_places")],
      requestedChanges: [{ operation: "remove", target: ordinal, confidence: 0.9 }] }, currentPlan());
    expect(result.tasks.map(task => task.type)).toEqual(["modify_itinerary", "recommend_places"]);
    expect(result.tasks[0].changes?.[0].target?.placeId).toBe("discover:kakao:2");
    expect(result.tasks[1].dependencies).toEqual([]);
  });

  it("models recommend then add as a dependency without inventing the new venue ID", () => {
    const message = "카페 하나 추천해주고 그걸 코스에 넣어줘";
    const reference: DateReference = { text: "그걸", kind: "unresolved", confidence: 0.3 };
    const base = understand(message, currentPlan());
    const result = planFor({ ...base, goals: [goal("recommend_places"), goal("modify_itinerary", reference)],
      references: [reference], requestedChanges: [{ operation: "add", target: reference, confidence: 0.9 }] }, currentPlan());
    expect(result.tasks.map(task => task.type)).toEqual(["recommend_places", "modify_itinerary"]);
    expect(result.tasks[1].dependencies).toEqual([result.tasks[0].id]);
    expect(result.tasks[1].changes?.[0].target).toBeUndefined();
    expect(result.tasks[1].status).toBe("planned");
    expect(result.executable).toBe(true);
  });

  it("does not resolve an ambiguous pronoun or hallucinated venue ID", () => {
    const reference: DateReference = { text: "거기", kind: "unresolved", resolvedId: "invented",
      resolvedName: "없는 장소", confidence: 0.9 };
    const base = understand("거기 빼줘", currentPlan());
    const result = planFor({ ...base, goals: [goal("modify_itinerary", reference)],
      references: [reference], requestedChanges: [{ operation: "remove", target: reference, confidence: 0.9 }] }, currentPlan());
    expect(result.tasks[0].target).toBeUndefined();
    expect(result.tasks[0].status).toBe("unresolved");
    expect(result.unresolved.map(item => item.code)).toContain("unverified_reference");
    expect(JSON.stringify(result)).not.toContain("invented");
  });

  it("revalidates the actual second plan item even when the proposed ordinal ID is wrong", () => {
    const reference: DateReference = { text: "두 번째 장소", kind: "ordinal_place",
      resolvedId: "invented", resolvedName: "없는 장소", confidence: 0.9 };
    const base = understand("두 번째 장소 빼줘", currentPlan());
    const result = planFor({ ...base, goals: [goal("modify_itinerary", reference)],
      requestedChanges: [{ operation: "remove", target: reference, confidence: 0.9 }] }, currentPlan());
    expect(result.tasks[0].target?.placeId).toBe("discover:kakao:2");
    expect(result.executable).toBe(true);
  });

  it("carries both verified ordinal items for a reorder without trusting proposed IDs", () => {
    const first: DateReference = { text: "첫 번째", kind: "ordinal_place", resolvedId: "invented",
      resolvedName: "없는 장소", confidence: 0.9 };
    const second: DateReference = { text: "두 번째", kind: "ordinal_place", resolvedId: "invented",
      resolvedName: "없는 장소", confidence: 0.9 };
    const base = understand("첫 번째랑 두 번째 순서 바꿔줘", currentPlan());
    const result = planFor({ ...base, goals: [goal("modify_itinerary", first)], references: [first, second],
      requestedChanges: [{ operation: "reorder", target: first, confidence: 0.9 }] }, currentPlan());
    expect(result.tasks[0].targets?.map(target => target.placeId))
      .toEqual(["discover:kakao:1", "discover:kakao:2"]);
    expect(result.tasks[0].changes?.[0].confidence).toBe(0.9);
    expect(result.executable).toBe(true);
  });

  it("keeps explicit feedback separate from a recommendation", () => {
    const message = "정원 카페 너무 시끄러워. 다른 카페 보여줘";
    const base = understand(message, currentPlan());
    const target: DateReference = { text: "정원 카페", kind: "current_plan_item",
      resolvedId: "discover:kakao:2", resolvedName: "정원 카페", confidence: 0.9 };
    const result = planFor({ ...base, goals: [goal("provide_feedback", target), goal("recommend_places")],
      feedback: [{ target, attribute: "noise", sentiment: "negative", strength: 0.9,
        confidence: 0.9, evidenceText: "시끄러워", explicit: true }] }, currentPlan());
    expect(result.tasks.map(task => task.type)).toEqual(["record_feedback", "recommend_places"]);
    expect(result.tasks[0].feedback?.[0].target?.placeId).toBe("discover:kakao:2");
  });

  it("requires two verified places to compare and a current plan to save", () => {
    const first: DateReference = { text: "저녁 식당", kind: "current_plan_item",
      resolvedId: "discover:kakao:1", resolvedName: "저녁 식당", confidence: 0.9 };
    const second: DateReference = { text: "정원 카페", kind: "current_plan_item",
      resolvedId: "discover:kakao:2", resolvedName: "정원 카페", confidence: 0.9 };
    const base = understand("두 장소 비교해줘", currentPlan());
    const comparison = planFor({ ...base, goals: [goal("compare_places")], references: [first, second] }, currentPlan());
    expect(comparison.tasks[0].type).toBe("compare_places");
    expect(comparison.tasks[0].targets?.map(target => target.placeId))
      .toEqual(["discover:kakao:1", "discover:kakao:2"]);
    expect(comparison.executable).toBe(true);
    const save = planFor({ ...base, goals: [goal("save_itinerary")], references: [] });
    expect(save.tasks[0].status).toBe("blocked");
    expect(save.unresolved.map(item => item.code)).toContain("missing_current_plan");
  });

  it("leaves an unverified previous-plan reference unresolved", () => {
    const message = "아까 코스가 더 나았어";
    const reference: DateReference = { text: "아까 코스", kind: "previous_place",
      targetType: "plan", confidence: 0.4 };
    const base = understand(message, currentPlan());
    const result = planFor({ ...base, goals: [goal("provide_feedback", reference)], references: [reference],
      feedback: [{ target: reference, attribute: "overall", sentiment: "positive",
        strength: 0.8, confidence: 0.9, evidenceText: "더 나았어", explicit: true }] }, currentPlan());
    expect(result.tasks[0].type).toBe("record_feedback");
    expect(result.tasks[0].target).toBeUndefined();
    expect(result.tasks[0].status).toBe("unresolved");
  });

  it("represents conditional inspection then recommendation without executing the branch", () => {
    const message = "지금 카페 주차 되는지 보고 안 되면 다른 곳 추천해줘";
    const reference: DateReference = { text: "지금 카페", kind: "category_slot",
      resolvedId: "discover:kakao:2", resolvedName: "정원 카페", confidence: 0.9 };
    const base = understand(message, currentPlan());
    const result = planFor({ ...base, goals: [goal("ask_venue", reference, "parking"), goal("recommend_places")],
      references: [reference] }, currentPlan());
    expect(result.tasks[1].dependencies).toEqual([result.tasks[0].id]);
    expect(result.tasks[1].condition).toMatchObject({ kind: "unsupported_predicate", attribute: "parking" });
    expect(result.tasks[1].status).toBe("blocked");
    expect(result.executable).toBe(true);
    expect(result.status).toBe("partially_executable");
    expect(result.taskValidation?.map(task => task.executable)).toEqual([true, false]);
  });

  it("does not block an itinerary merely because optional start time is ambiguous", () => {
    const base = understand("성수 데이트 코스 짜줘");
    const result = planFor({ ...base, ambiguities: ["정확한 시작 시간 미정"] });
    expect(result.tasks[0].status).toBe("planned");
    expect(result.executable).toBe(true);
  });

  it("rejects dependency cycles, unknown dependencies and fabricated targets", () => {
    const base = planFor(understand("안녕"));
    const first = { ...base.tasks[0], id: "a", executionOrder: 1, dependencies: ["b"] };
    const second = { ...base.tasks[0], id: "b", executionOrder: 2, dependencies: ["a"] };
    const cycle: DateExecutionPlan = { ...base, tasks: [first, second] };
    expect(validateDateExecutionPlan(cycle).map(item => item.code)).toContain("dependency_cycle");
    expect(validateDateExecutionPlan({ ...base, tasks: [{ ...first, dependencies: ["absent"] }] })
      .map(item => item.code)).toContain("missing_dependency");
    expect(validateDateExecutionPlan({ ...base, tasks: [{ ...first, type: "inspect_venue",
      target: { kind: "plan_item", name: "가짜", placeId: "invented" }, dependencies: [] }] }, currentPlan())
      .map(item => item.code)).toContain("unverified_reference");
    expect(validateDateExecutionPlan({ ...base, tasks: [first, { ...second, id: "a", dependencies: [] }] })
      .map(item => item.code)).toContain("duplicate_task_id");
    expect(validateDateExecutionPlan({ ...base, tasks: [{ ...first, executionOrder: 0, dependencies: [] }] })
      .map(item => item.code)).toContain("inconsistent_order");
    expect(validateDateExecutionPlan({ ...base, tasks: [{ ...first, dependencies: [],
      condition: { kind: "unsupported_predicate", afterTaskId: "missing", expected: "unavailable" } }] })
      .map(item => item.code)).toContain("missing_dependency");
  });

  it("isolates planner failure and stores only aggregate observation data", () => {
    const understanding = understand("성수 데이트 코스 짜줘");
    const context = buildDateContext({ state: state(), currentUnderstanding: understanding,
      effectiveUnderstanding: understanding, interpreterMode: "assist", observedAt: `${today}T00:00:00Z` });
    const input = { context, route: { mode: "course" as const, confident: true },
      timestamp: `${today}T00:00:00Z` };
    expect(observeDateExecutionPlan(input, () => { throw new Error("planner failed"); })).toBeNull();
    const observed = observeDateExecutionPlan(input)!;
    expect(observed.observation).toEqual(executionPlanObservation(observed.plan, observed.comparison, input.timestamp));
    expect(observed.comparison.routeCoverage).toBe("full");
    expect(JSON.stringify(observed.observation)).not.toContain(understanding.rawMessage);
    const linked = buildDateContext({ state: state(), currentUnderstanding: understanding,
      executionPlan: observed.plan, executionPlanComparison: observed.comparison,
      observations: [observed.observation], observedAt: input.timestamp });
    expect(linked.executionPlan).toEqual(observed.plan);
    expect(linked.observations.map(item => item.type)).toContain("execution_plan");
  });
});

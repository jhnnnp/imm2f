import { afterEach, expect, it, vi } from "vitest";
import { emptyDateBrief } from "./dateBrief";
import { recommendDatePlan } from "./actions";
import { interpretDateTurnWithOpenAi } from "@/lib/openai/dateTurnInterpreter";
import * as executionPlanner from "./dateExecutionPlan";

vi.mock("@/lib/openai/dateTurnInterpreter", () => ({ interpretDateTurnWithOpenAi: vi.fn() }));
vi.mock("@/features/taste/actions", () => ({ loadTasteBoard: vi.fn(async () => ({})) }));
vi.mock("@/lib/openai/routeDateChat", () => ({ routeDateChat: vi.fn(async () => ({ mode: "chat", confident: true })) }));
afterEach(() => { vi.unstubAllEnvs(); vi.mocked(interpretDateTurnWithOpenAi).mockReset(); });

it("returns the same AIPlannerResult for a greeting with shadow OFF and ON", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const input = { message: "안녕", previousState: emptyDateBrief() };
  vi.stubEnv("DATE_TURN_INTERPRETER_SHADOW", "false");
  const withoutShadow = await recommendDatePlan(input);
  expect(interpretDateTurnWithOpenAi).not.toHaveBeenCalled();

  vi.mocked(interpretDateTurnWithOpenAi).mockResolvedValue({
    goals: [{ type: "general_chat", targetText: null, attribute: null, confidence: 0.9 }],
    references: [], semanticPreferences: [], requestedChanges: [], feedback: [],
    constraintClaims: { areas: [], date: null, startTime: null, endTime: null, budgetWon: null,
      requiredPlaces: [], excludedPlaces: [], excludedFoods: [], requiredActivities: [] },
    ambiguities: [], confidence: 0.9,
  });
  vi.stubEnv("DATE_TURN_INTERPRETER_SHADOW", "true");
  const withShadow = await recommendDatePlan(input);
  expect(interpretDateTurnWithOpenAi).toHaveBeenCalledTimes(1);
  expect(withShadow).toEqual(withoutShadow);
});

it("preserves the routed chat AIPlannerResult when shadow interpretation fails", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const input = { message: "음... 생각 중이야", previousState: emptyDateBrief() };
  vi.stubEnv("DATE_TURN_INTERPRETER_SHADOW", "false");
  const withoutShadow = await recommendDatePlan(input);
  vi.mocked(interpretDateTurnWithOpenAi).mockRejectedValue(new Error("timeout"));
  vi.stubEnv("DATE_TURN_INTERPRETER_SHADOW", "true");
  const withShadow = await recommendDatePlan(input);
  expect(interpretDateTurnWithOpenAi).toHaveBeenCalledTimes(1);
  expect(withShadow).toEqual(withoutShadow);
});

it("returns the same AIPlannerResult in OFF, SHADOW and ASSIST with a semantic signal", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const input = { message: "오늘은 여유롭게", previousState: emptyDateBrief() };
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "off");
  const off = await recommendDatePlan(input);
  expect(interpretDateTurnWithOpenAi).not.toHaveBeenCalled();
  vi.mocked(interpretDateTurnWithOpenAi).mockResolvedValue({
    goals: [{ type: "modify_itinerary", targetText: null, attribute: null, confidence: 0.9 }],
    references: [], semanticPreferences: [{ dimension: "pace", value: "relaxed", sentiment: "positive",
      strength: 0.8, confidence: 0.9, evidenceText: "여유롭게" }],
    requestedChanges: [], feedback: [], constraintClaims: { areas: [], date: null, startTime: null,
      endTime: null, budgetWon: null, requiredPlaces: [], excludedPlaces: [], excludedFoods: [],
      requiredActivities: [] }, ambiguities: [], confidence: 0.9,
  });
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "shadow");
  const shadow = await recommendDatePlan(input);
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "assist");
  const assist = await recommendDatePlan(input);
  expect(interpretDateTurnWithOpenAi).toHaveBeenCalledTimes(2);
  expect(shadow).toEqual(off);
  expect(assist).toEqual(off);
});

it("keeps the legacy AIPlannerResult when execution-plan diagnostics fail", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const input = { message: "안녕", previousState: emptyDateBrief() };
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "off");
  const baseline = await recommendDatePlan(input);
  vi.mocked(interpretDateTurnWithOpenAi).mockResolvedValue({
    goals: [{ type: "general_chat", targetText: null, attribute: null, confidence: 0.9 }],
    references: [], semanticPreferences: [], requestedChanges: [], feedback: [],
    constraintClaims: { areas: [], date: null, startTime: null, endTime: null, budgetWon: null,
      requiredPlaces: [], excludedPlaces: [], excludedFoods: [], requiredActivities: [] },
    ambiguities: [], confidence: 0.9,
  });
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "assist");
  const failing = vi.spyOn(executionPlanner, "observeDateExecutionPlan").mockImplementation(() => {
    throw new Error("diagnostic planner unavailable");
  });
  try {
    const result = await recommendDatePlan(input);
    expect(failing).toHaveBeenCalled();
    expect(result).toEqual(baseline);
  } finally {
    failing.mockRestore();
  }
});

import { afterEach, expect, it, vi } from "vitest";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { dateTurnPromptContext, interpretDateTurnWithOpenAi } from "./dateTurnInterpreter";
import { completeJson } from "./client";

vi.mock("./client", () => ({ completeJson: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.mocked(completeJson).mockReset(); });

it("sends a minimal turn context and a strict schema without serializing the whole DateContext", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.mocked(completeJson).mockResolvedValue({ goals: [], references: [], semanticPreferences: [],
    requestedChanges: [], feedback: [], constraintClaims: { areas: [], date: null,
      startTime: null, endTime: null, budgetWon: null, requiredPlaces: [], excludedPlaces: [],
      excludedFoods: [], requiredActivities: [] }, ambiguities: [], confidence: 0.8 });
  const state = { ...emptyDateBrief(), areas: ["성수"], region: "성수", regions: ["성수"] };
  const context = { hardConstraints: { areas: ["성수"], date: null, startTime: null, endTime: null,
    budgetWon: null }, relevantMemories: { privateNote: "do-not-send" }, observations: [{ raw: "do-not-send" }] };
  const input = { message: "여유롭게 해줘", state, context: context as never,
    conversation: [{ role: "user" as const, text: "어제 카페 어땠어?" }] };
  const prompt = dateTurnPromptContext(input);
  expect(JSON.stringify(prompt)).not.toContain("do-not-send");
  expect(prompt.currentContext.areas).toEqual(["성수"]);
  expect(await interpretDateTurnWithOpenAi(input)).not.toBeNull();
  const request = vi.mocked(completeJson).mock.calls[0][0];
  expect(request.jsonSchema).toMatchObject({ name: "date_turn_understanding_v1", strict: true });
  expect(request.messages[0].content).toContain("pace, novelty, atmosphere");
  expect(request.messages[0].content).toContain("aesthetic, noise, crowd");
  expect(request.messages[1].content).not.toContain("do-not-send");
});

it("rejects malformed provider output after the structured response", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.mocked(completeJson).mockResolvedValue({ goals: "wrong" });
  expect(await interpretDateTurnWithOpenAi({ message: "안녕", state: emptyDateBrief() })).toBeNull();
});

it("keeps every selected venue and distinguishes trip days in turn context", () => {
  const names = Array.from({ length: 18 }, (_, index) => `장소 ${index + 1}`);
  const input = {
    message: "3일차 두 번째 장소를 설명해줘",
    state: { ...emptyDateBrief(), stayKind: "overnight" as const, nights: 2,
      requiredPlaces: names, excludedPlaces: names.map(name => `제외 ${name}`) },
    currentPlan: { items: names.map((name, index) => ({ placeName: name, placeId: `place-${index}`,
      dayIndex: Math.floor(index / 6), order: index % 6, category: "tourist", startTime: "10:00" })),
      recommendations: [] } as never,
    visiblePlaces: names,
  };
  const prompt = dateTurnPromptContext(input);
  expect(prompt.currentPlan).toHaveLength(18);
  expect(prompt.visiblePlaces).toHaveLength(18);
  expect(prompt.currentContext.requiredPlaces).toEqual(names);
  expect(prompt.currentContext.excludedPlaces).toHaveLength(18);
  expect(prompt.currentContext.stayKind).toBe("overnight");
  expect(prompt.currentContext.nights).toBe(2);
  expect(prompt.currentPlan[13]).toMatchObject({ name: "장소 14", position: 14, day: 3, dayPosition: 2 });
});

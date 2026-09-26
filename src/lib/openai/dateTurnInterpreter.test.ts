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

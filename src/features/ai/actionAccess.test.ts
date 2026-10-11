import { beforeEach, expect, it, vi } from "vitest";
import { getAppSession } from "@/features/auth/session";
import { proposePlanEditsWithOpenAi } from "@/lib/openai/editPlan";
import { generatePlanOptionsWithOpenAi } from "@/lib/openai/generatePlan";
import { analyzePreferencesWithOpenAi } from "@/lib/openai/analyzePreferences";
import { interpretDateRequest } from "@/lib/openai/interpretDateRequest";
import { analyzeCouplePreferences, generatePlanOptions, proposePlanEdits,
  recommendDatePlan, recommendDatePlanWithSession } from "./actions";
import { exploreCandidateGroups, prepareCandidateExploration,
  replaceRejectedCandidateFromSession, updateCandidateExplorationChoices } from "./candidateExplorationActions";
import { emptyDateBrief } from "./dateBrief";
import type { CandidateExplorationPreferences } from "./candidateExploration";

vi.mock("@/features/auth/session", () => ({ getAppSession: vi.fn() }));
vi.mock("@/lib/openai/editPlan", () => ({ proposePlanEditsWithOpenAi: vi.fn() }));
vi.mock("@/lib/openai/generatePlan", () => ({ generatePlanOptionsWithOpenAi: vi.fn() }));
vi.mock("@/lib/openai/analyzePreferences", () => ({ analyzePreferencesWithOpenAi: vi.fn() }));
vi.mock("@/lib/openai/interpretDateRequest", () => ({ interpretDateRequest: vi.fn() }));
const preferences: CandidateExplorationPreferences = { activities: ["cafe"], cafeQualities: [],
  cuisines: [], shoppingKinds: [], cultureKinds: [], additionalDetails: "", pace: "balanced", provenance: {} };

beforeEach(() => vi.clearAllMocks());

it.each(["guest", "setup_error"] as const)("blocks every AI action for a %s session before provider work", async mode => {
  vi.mocked(getAppSession).mockResolvedValue(mode === "guest" ? { mode } : { mode, userId: "u", displayName: "나" });
  const input = { message: "성수 카페", previousState: emptyDateBrief() };
  expect(await proposePlanEdits({ kind: "date", prompt: "수정", items: [] })).toHaveProperty("error");
  expect(await generatePlanOptions({ kind: "date", prompt: "추천", places: [] })).toHaveProperty("error");
  expect(await analyzeCouplePreferences()).toHaveProperty("error");
  expect(await recommendDatePlan(input)).toHaveProperty("error");
  const sessionResult = await recommendDatePlanWithSession({ ...input, planningSessionId: "test-session" });
  expect(sessionResult.result).toHaveProperty("error");
  expect(sessionResult.sessionCandidates.signature).toBeUndefined();
  expect(await prepareCandidateExploration(input)).toHaveProperty("error");
  expect(await exploreCandidateGroups({ message: input.message, state: emptyDateBrief(), preferences,
    planningSessionId: "test-session" })).toHaveProperty("error");
  expect(await updateCandidateExplorationChoices({ planningSessionId: "test-session",
    sessionCandidates: null, selectedIds: [], rejectedIds: [] })).toBeNull();
  expect(await replaceRejectedCandidateFromSession({ state: emptyDateBrief(), preferences,
    researchPlan: { needs: [] } as never, planningSessionId: "test-session",
    sessionCandidates: null, groupId: "cafe", selectedIds: [], rejectedIds: [] })).toHaveProperty("error");
  expect(proposePlanEditsWithOpenAi).not.toHaveBeenCalled();
  expect(generatePlanOptionsWithOpenAi).not.toHaveBeenCalled();
  expect(analyzePreferencesWithOpenAi).not.toHaveBeenCalled();
  expect(interpretDateRequest).not.toHaveBeenCalled();
});

it("keeps authenticated editing available", async () => {
  vi.mocked(getAppSession).mockResolvedValue({ mode: "authenticated", userId: "u", coupleId: "c", displayName: "나", partner: null });
  vi.mocked(proposePlanEditsWithOpenAi).mockResolvedValue({ changes: [], summary: "완료" });
  expect(await proposePlanEdits({ kind: "date", prompt: "수정", items: [] })).toEqual({ changes: [], summary: "완료" });
  expect(proposePlanEditsWithOpenAi).toHaveBeenCalledTimes(1);
});

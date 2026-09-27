import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDateContext } from "@/features/ai/dateContext";
import { emptyDateBrief, withAreas } from "@/features/ai/dateBrief";
import type { AIPlannerState } from "@/features/planning/types/plan";
import { observeExperiencePlan } from "./experiencePlan";

afterEach(() => vi.unstubAllEnvs());

const current = (): AIPlannerState => ({ ...withAreas(emptyDateBrief(), ["익선동"]),
  userRequests: ["익선동에서 이쁜 카페 데이트"], activities: ["cafe"] });
const context = (state: AIPlannerState) => buildDateContext({ state, observedAt: "2026-09-27T00:00:00Z" });
const payload = { objective: "예쁜 카페에서 대화", overallPace: "relaxed",
  tripStrategy: { geographicApproach: "익선동 중심", experienceProgression: "카페 중심",
    avoidRepeatedVisitContexts: true },
  days: [{ dayIndex: 0, purpose: "차분한 데이트", density: "light", geographicFocus: "익선동",
    experienceBlocks: [{ purpose: "카페에서 대화", primaryExperience: "감성 카페 경험",
      visitContext: "익선동 골목", supportingNeeds: [],
      qualitativeNeeds: [{ category: "cafe", dimension: "aesthetic", source: "explicit_user" }],
      repeatJustification: null }] }],
  requiredElements: ["cafe"], optionalElements: [],
  qualitativeNeeds: [{ category: "cafe", dimension: "aesthetic", source: "explicit_user" }],
  uncertainties: [],
};

describe("opt-in experience plan observation", () => {
  it("adds no OpenAI call when the flag is off", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only-not-used");
    const complete = vi.fn().mockResolvedValue(payload);
    expect(await observeExperiencePlan({ message: "익선동에서 이쁜 카페 데이트",
      state: current(), context: context(current()) }, complete)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("requests strict structured output with a narrow prompt and returns diagnostics", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only-not-used");
    vi.stubEnv("DATE_EXPERIENCE_PLAN_SHADOW", "true");
    const complete = vi.fn().mockResolvedValue(payload);
    const result = await observeExperiencePlan({ message: "익선동에서 이쁜 카페 데이트",
      state: current(), context: context(current()) }, complete);
    expect(result?.plan.qualitativeNeeds).toEqual(payload.qualitativeNeeds);
    expect(result?.comparison.legacySpine).toContain("meal");
    const request = complete.mock.calls[0][0];
    expect(request.jsonSchema).toMatchObject({ name: "date_experience_plan_v1", strict: true });
    const prompt = JSON.parse(request.messages[1].content);
    expect(prompt.qualitativeNeeds).toEqual(payload.qualitativeNeeds);
    expect(prompt).not.toHaveProperty("candidatePool");
    expect(prompt).not.toHaveProperty("currentPlan");
  });

  it("isolates malformed output and OpenAI failures", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only-not-used");
    vi.stubEnv("DATE_EXPERIENCE_PLAN_SHADOW", "true");
    const args = { message: "익선동에서 이쁜 카페 데이트", state: current(), context: context(current()) };
    expect(await observeExperiencePlan(args, vi.fn().mockResolvedValue({ ...payload, days: [] }))).toBeNull();
    expect(await observeExperiencePlan(args, vi.fn().mockRejectedValue(new Error("timeout")))).toBeNull();
  });
});

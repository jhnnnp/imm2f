import { beforeEach, expect, it, vi } from "vitest";
import { recommendDatePlan, recommendDatePlanWithSession, proposePlanEdits, generatePlanOptions, loadLatestCoupleInsight } from "./actions";
import { completeJson } from "@/lib/openai/client";
import { proposePlanEditsWithOpenAi } from "@/lib/openai/editPlan";
import { generatePlanOptionsWithOpenAi } from "@/lib/openai/generatePlan";
import { calculatePreferenceInsight } from "@/lib/openai/preferenceInsight";
import type { Place } from "@/features/places/types/place";
import { emptyDateBrief } from "./dateBrief";
import { emptySessionCandidates, sealSessionCandidates } from "./sessionCandidates";

const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }));
vi.mock("@/features/auth/session", () => ({ getAppSession: vi.fn(async () => ({ mode: "authenticated", userId: "viewer", coupleId: "couple", displayName: "나", partner: null })) }));
vi.mock("@/features/places/actions", () => ({ listPlaces: vi.fn(async () => ({ places: [] })) }));
vi.mock("@/lib/openai/client", () => ({ completeJson: vi.fn(), completeJsonWithWebSearch: vi.fn(), completeFunctionCalls: vi.fn() }));
vi.mock("@/lib/openai/editPlan", () => ({ proposePlanEditsWithOpenAi: vi.fn() }));
vi.mock("@/lib/openai/generatePlan", () => ({ generatePlanOptionsWithOpenAi: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => {
  const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, maybeSingle };
  return { from: () => query };
}) }));
beforeEach(() => vi.clearAllMocks());

it.each([null, { message: 5 }, { message: "x".repeat(801) }, { previousState: {} }, { currentPlan: { status: "plan", items: [] } }])(
  "returns action errors before any model calls for authenticated malformed payload %j", async input => {
    expect(await recommendDatePlan(input as never)).toHaveProperty("error");
    expect((await recommendDatePlanWithSession(input as never)).result).toHaveProperty("error");
    expect(completeJson).not.toHaveBeenCalled();
  });

it("guards the other AI action inputs before dereferencing them", async () => {
  expect(await proposePlanEdits(null as never)).toHaveProperty("error");
  expect(await generatePlanOptions({ kind: "date", prompt: false, places: {} } as never)).toHaveProperty("error");
  expect(proposePlanEditsWithOpenAi).not.toHaveBeenCalled();
  expect(generatePlanOptionsWithOpenAi).not.toHaveBeenCalled();
});

it("excludes either partner's negative preference from saved-place options", async () => {
  const place = { id: "good", name: "카페", categoryLabel: "카페", district: "성수", userStatus: "want", partnerStatus: "want", durationMinutes: 60, expectedCostTwo: null } as Place;
  vi.mocked(generatePlanOptionsWithOpenAi).mockResolvedValue({ options: [], note: "없어요" });
  await generatePlanOptions({ kind: "date", prompt: "저장 장소로 추천", places: [place, { ...place, id: "partner-no", partnerStatus: "dislike" }, { ...place, id: "user-no", userStatus: "not_interested" }] });
  expect(vi.mocked(generatePlanOptionsWithOpenAi).mock.lastCall?.[0].places.map(place => place.id)).toEqual(["good"]);
});

it("rejects corrupted cached differences without crashing during viewer reversal", async () => {
  const result = { ...calculatePreferenceInsight([]), perspectiveUserId: "partner", differences: [null] };
  maybeSingle.mockResolvedValue({ data: { result }, error: null });
  expect(await loadLatestCoupleInsight()).toBeNull();
  expect(maybeSingle).toHaveBeenCalledTimes(2);
});

it("keeps a valid percentage confidence and swaps cached partner perspective", async () => {
  const result = { ...calculatePreferenceInsight([]), confidence: 75, perspectiveUserId: "partner",
    differences: [{ you: "커피", partner: "산책", bridge: "같이해요" }] };
  maybeSingle.mockResolvedValue({ data: { result }, error: null });
  expect(await loadLatestCoupleInsight()).toMatchObject({ confidence: 75, perspectiveUserId: "viewer",
    differences: [{ you: "산책", partner: "커피", bridge: "같이해요" }] });
});

it("does not reuse another actor's signed candidate session", async () => {
  vi.stubEnv("SESSION_CANDIDATE_SIGNING_KEY", "mock-signing-key");
  try {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const previous = sealSessionCandidates({ ...emptySessionCandidates(id), turnCount: 50 }, { actorId: "previous-user", coupleId: "couple" });
    const next = await recommendDatePlanWithSession({ message: "고마워요", previousState: emptyDateBrief(), planningSessionId: id, sessionCandidates: previous });
    expect(next.sessionCandidates.scope).toEqual({ actorId: "viewer", coupleId: "couple" });
    expect(next.sessionCandidates.turnCount).toBe(1);
  } finally { vi.unstubAllEnvs(); }
});

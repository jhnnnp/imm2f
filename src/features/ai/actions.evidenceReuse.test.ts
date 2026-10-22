import { afterEach, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { AIPlannerReply } from "@/features/planning/types/plan";
import type { DateQualityAssessment } from "./dateQualityCritic";
import { emptyDateBrief, withAreas } from "./dateBrief";

vi.mock("@/features/auth/session", () => ({ getAppSession: vi.fn(async () => ({
  mode: "authenticated", userId: "user", coupleId: "couple", displayName: "나", partner: null,
})) }));
vi.mock("@/features/places/actions", () => ({ listPlaces: vi.fn(async () => ({ places: [] })) }));
vi.mock("@/features/planning/actions", () => ({ listArchivedDatePlans: vi.fn(async () => ({ dates: [] })) }));
vi.mock("@/features/taste/actions", () => ({ loadTasteBoard: vi.fn(async () => ({
  you: null, partner: null, youName: "나", partnerName: "파트너", partnerConnected: false, compare: null,
})) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => null), createServiceClient: vi.fn(() => null) }));
vi.mock("@/lib/openai/routeDateChat", () => ({ routeDateChat: vi.fn(async () => ({ mode: "course", confident: true })) }));
vi.mock("@/lib/openai/interpretDateRequest", () => ({ interpretDateRequest: vi.fn() }));
vi.mock("@/lib/openai/designDateDiscovery", () => ({ designDateDiscovery: vi.fn(async () => ({
  themes: [], priorities: [], queries: [], transport: "transit", requiredActivities: ["meal", "cafe"],
  activityOrder: ["meal", "cafe"], minStops: 2, maxStops: 3,
})) }));
vi.mock("@/lib/openai/discoverVenueLeads", () => ({ discoverVenueLeads: vi.fn(async () => []), leadMatchesCandidate: vi.fn(() => false) }));
vi.mock("@/lib/openai/dateTaskPlanner", () => ({ dateTaskObjectives: vi.fn(() => []), runDateTaskPlanner: vi.fn(async () => ({
  objectives: [], steps: [], stopReason: "satisfied", unresolvedActivities: [],
})) }));
vi.mock("@/lib/openai/venueEvidenceStore", () => ({ readVenueEvidence: vi.fn(async () => new Map()) }));
vi.mock("@/lib/places/detailCache", () => ({ hydrateDateCandidates: vi.fn(async rows => rows) }));
vi.mock("@/lib/kopis/client", () => ({ attachKopisPerformances: vi.fn(async rows => rows) }));
vi.mock("@/lib/kakao/local", () => ({ searchKakaoPlacesRemote: vi.fn() }));
vi.mock("@/lib/tourapi/env", () => ({ isTourApiConfigured: vi.fn(() => false) }));
vi.mock("@/lib/openai/enrichDateVenues", () => ({
  enrichDateVenues: vi.fn(async rows => rows), enrichResearchNeedEvidence: vi.fn(),
}));
vi.mock("@/lib/openai/recommendDatePlan", () => ({ recommendDatePlanWithOpenAi: vi.fn() }));
vi.mock("@/lib/openai/dateAgentOrchestrator", () => ({ runDateAgentCourse: vi.fn() }));

import { recommendDatePlan } from "./actions";
import { interpretDateRequest } from "@/lib/openai/interpretDateRequest";
import { searchKakaoPlacesRemote } from "@/lib/kakao/local";
import { recommendDatePlanWithOpenAi } from "@/lib/openai/recommendDatePlan";
import { enrichResearchNeedEvidence } from "@/lib/openai/enrichDateVenues";
import { runDateAgentCourse } from "@/lib/openai/dateAgentOrchestrator";
import { runDateTaskPlanner } from "@/lib/openai/dateTaskPlanner";
import { hydrateDateCandidates } from "@/lib/places/detailCache";
import { attachKopisPerformances } from "@/lib/kopis/client";

function venue(id: string, category: DiscoverCandidate["category"], x: number): DiscoverCandidate {
  return { externalSource: "kakao", externalPlaceId: id, name: "성수 장소 " + id, category,
    categoryLabel: category === "restaurant" ? "식당" : "카페", district: "성동구",
    detailedCategory: category === "restaurant" ? "음식점 > 양식" : "카페 > 커피전문점",
    kakaoCategoryGroupCode: category === "restaurant" ? "FD6" : "CE7",
    address: "서울 성동구 성수이로 10", roadAddress: "서울 성동구 성수이로 10",
    phone: "", mapUrl: "https://place.map.kakao.com/" + id, coordinates: [x, 37.56] };
}
const initial = [venue("initial-meal", "restaurant", 127.04), venue("initial-cafe", "cafe", 127.0404)];
const newAttempted = venue("repair-attempted", "cafe", 127.0408);
const newUntouched = venue("repair-untouched", "cafe", 127.0412);
const assessment: DateQualityAssessment = { needsRepair: true, warnings: [], repairIssues: ["조용한 환경 근거 미확인"],
  requirements: [{ id: "quiet", dimension: "quiet", category: "cafe", origin: "explicit_constraint", status: "unknown",
    candidateIds: ["kakao:initial-cafe"], supportingCandidateIds: [], contradictedCandidateIds: [],
    alternativeCandidateIds: [], evidenceIds: [], sourceUrls: [], message: "조용한 환경 근거 미확인" }],
  researchNeeds: [{ id: "quality-repair-0", kind: "evidence", category: "cafe", purpose: "조용한 환경 확인",
    qualities: ["quiet"], evidenceNeeded: ["noise", "crowd"], priority: "important" }] };

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it("reuses exact attempted repair IDs on the second design while leaving untouched new venues eligible for research", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "off");
  vi.stubEnv("DATE_RESEARCH_PLAN_MODE", "off");
  const state = { ...withAreas(emptyDateBrief(), ["성수"]), stayKind: "date" as const, activities: ["meal", "cafe"] as Array<"meal" | "cafe"> };
  vi.mocked(interpretDateRequest).mockResolvedValue({ state, slot: null, reply: "" });
  vi.mocked(searchKakaoPlacesRemote).mockImplementation(async input => ({ ok: true,
    places: input.query === "조용한 카페" ? [newAttempted, newUntouched] : initial, isEnd: true, page: 1, totalCount: 2 }));
  vi.mocked(recommendDatePlanWithOpenAi).mockImplementation(async input => ({
    status: "plan", message: "후보 일정", card: { headline: "성수", lines: ["후보 일정"] }, state: input.state,
    condition: input.condition, source: "fallback", candidateCount: input.candidates.length,
    items: [], recommendations: [],
  } satisfies AIPlannerReply));
  vi.mocked(enrichResearchNeedEvidence).mockImplementation(async (rows, _state, _needs, _limit, _signal, _force, onAttempted) => {
    expect(rows.some(row => row.externalPlaceId === newAttempted.externalPlaceId)).toBe(true);
    expect(rows.some(row => row.externalPlaceId === newUntouched.externalPlaceId)).toBe(true);
    // Even a failed quality search is an attempt, not proof of a supported fact.
    // Report exactly one requested entity; unrelated and untouched IDs stay out.
    onAttempted?.(["kakao:repair-attempted", "kakao:outside-this-catalog"]);
    return rows;
  });
  vi.mocked(runDateAgentCourse).mockImplementation(async input => {
    await input.propose(input.candidates);
    const repair = await input.researchAfterFailure(assessment.repairIssues, input.candidates, assessment);
    const candidates = [...input.candidates, ...repair];
    const reply = await input.propose(candidates, assessment);
    return { reply, candidates, attempts: 2, newCandidatesOnRepair: 2, verifierIssues: [] };
  });
  await recommendDatePlan({ message: "성수 데이트 코스 짜줘", previousState: state });
  expect(recommendDatePlanWithOpenAi).toHaveBeenCalledTimes(2);
  const [first, second] = vi.mocked(recommendDatePlanWithOpenAi).mock.calls.map(([input]) => input);
  expect(first.venueResearchPreparedIds).toEqual(expect.arrayContaining(["kakao:initial-meal", "kakao:initial-cafe"]));
  expect(first.venueResearchPreparedIds).not.toContain("kakao:repair-attempted");
  expect(second.venueResearchPreparedIds).toContain("kakao:repair-attempted");
  expect(second.venueResearchPreparedIds).not.toContain("kakao:repair-untouched");
  expect(second.venueResearchPreparedIds).not.toContain("kakao:outside-this-catalog");
  expect(enrichResearchNeedEvidence).toHaveBeenCalledOnce();
});

it.each([
  { count: 8, includeCafe: true, plannerCalls: 0 },
  { count: 7, includeCafe: true, plannerCalls: 1 },
  { count: 8, includeCafe: false, plannerCalls: 1 },
])("runs initial task planning only when the pool still needs candidates or a required activity ($count places, cafe=$includeCafe)", async ({ count, includeCafe, plannerCalls }) => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "off");
  vi.stubEnv("DATE_RESEARCH_PLAN_MODE", "off");
  const state = { ...withAreas(emptyDateBrief(), ["성수"]), stayKind: "date" as const,
    activities: ["meal", "cafe"] as Array<"meal" | "cafe">, vibes: ["quiet"] };
  const rows = Array.from({ length: count }, (_, index) => venue("pool-" + index,
    includeCafe && index % 2 === 1 ? "cafe" : "restaurant", 127.04 + index * 0.0001));
  // Raw Kakao candidates intentionally have no opening hours or quiet evidence.
  vi.mocked(interpretDateRequest).mockResolvedValue({ state, slot: null, reply: "" });
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true, places: rows, isEnd: true, page: 1, totalCount: count });
  vi.mocked(recommendDatePlanWithOpenAi).mockImplementation(async input => ({
    status: "plan", message: "후보 일정", card: { headline: "성수", lines: ["후보 일정"] }, state: input.state,
    condition: input.condition, source: "fallback", candidateCount: input.candidates.length,
    items: [], recommendations: [],
  } satisfies AIPlannerReply));
  vi.mocked(runDateAgentCourse).mockImplementation(async input => ({
    reply: await input.propose(input.candidates), candidates: input.candidates,
    attempts: 1, newCandidatesOnRepair: 0, verifierIssues: [],
  }));
  await recommendDatePlan({ message: "성수에서 조용하게 데이트 코스 짜줘", previousState: state });
  expect(runDateTaskPlanner).toHaveBeenCalledTimes(plannerCalls);
  expect(hydrateDateCandidates).toHaveBeenCalled();
  expect(attachKopisPerformances).toHaveBeenCalled();
  expect(runDateAgentCourse).toHaveBeenCalledOnce();
  expect(recommendDatePlanWithOpenAi).toHaveBeenCalledOnce();
  expect(vi.mocked(recommendDatePlanWithOpenAi).mock.calls[0][0]).toMatchObject({
    state: { routeOnly: true, startTime: null, endTime: null, budgetWon: null },
    condition: { timeSpecified: false, budget: null },
  });
});

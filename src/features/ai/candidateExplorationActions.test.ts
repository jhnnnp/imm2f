import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { buildDateCandidatePool } from "./dateCandidatePool";
import { mergeSessionCandidates, sealSessionCandidates } from "./sessionCandidates";
import type { CandidateExplorationPreferences } from "./candidateExploration";

vi.mock("@/lib/openai/interpretDateRequest", () => ({ interpretDateRequest: vi.fn() }));
vi.mock("@/lib/kakao/local", () => ({ searchKakaoPlacesRemote: vi.fn() }));
vi.mock("@/lib/tourapi/client", () => ({ searchTourPlacesRemote: vi.fn() }));
vi.mock("@/lib/tourapi/env", () => ({ isTourApiConfigured: () => false }));
vi.mock("@/lib/openai/experiencePlan", () => ({ observeExperiencePlan: vi.fn(async () => null) }));
vi.mock("@/lib/openai/enrichDateVenues", () => ({ enrichResearchNeedEvidence: vi.fn(async (rows: DiscoverCandidate[]) => rows) }));
vi.mock("@/features/places/actions", () => ({ listPlaces: vi.fn(async () => ({ places: [] })) }));

import { interpretDateRequest } from "@/lib/openai/interpretDateRequest";
import { searchKakaoPlacesRemote } from "@/lib/kakao/local";
import { enrichResearchNeedEvidence } from "@/lib/openai/enrichDateVenues";
import { exploreCandidateGroups, prepareCandidateExploration,
  updateCandidateExplorationChoices } from "./candidateExplorationActions";
import { candidateExplorationMode } from "./candidateExplorationMode";

const state = withAreas(emptyDateBrief(), ["부산"]);
const prefs: CandidateExplorationPreferences = { activities: ["cafe"], cafeQualities: [], cuisine: null,
  shoppingKind: null, cultureKind: null, pace: "balanced", provenance: { cafe: "user_selected" } };
const sessionId = "123e4567-e89b-12d3-a456-426614174000";
const venue = (id: number): DiscoverCandidate => ({ externalSource: "kakao", externalPlaceId: String(id),
  name: `카페 ${id}`, category: "cafe", categoryLabel: "카페", district: "부산 해운대구",
  address: `부산 해운대구 ${id}번지`, roadAddress: "", phone: "",
  mapUrl: `https://place.map.kakao.com/${id}`, coordinates: [129.16, 35.16], kakaoCategoryGroupCode: "CE7" });

beforeEach(() => {
  process.env.DATE_CANDIDATE_EXPLORATION_MODE = "active";
  process.env.SESSION_CANDIDATE_SIGNING_KEY = "candidate-exploration-test-secret";
  vi.mocked(interpretDateRequest).mockResolvedValue({ state, slot: null, reply: "" });
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true,
    places: Array.from({ length: 5 }, (_, index) => venue(index + 1)), isEnd: true, page: 1, totalCount: 5 });
});
afterEach(() => {
  delete process.env.DATE_CANDIDATE_EXPLORATION_MODE;
  delete process.env.SESSION_CANDIDATE_SIGNING_KEY;
  vi.clearAllMocks();
});

it("enables candidate exploration by default for both planners", () => {
  delete process.env.DATE_CANDIDATE_EXPLORATION_MODE;
  expect(candidateExplorationMode()).toBe("active");
});

it("keeps an explicit off switch and does not interpret or search", async () => {
  process.env.DATE_CANDIDATE_EXPLORATION_MODE = "off";
  expect(candidateExplorationMode()).toBe("off");
  expect(await prepareCandidateExploration({ message: "부산 카페" })).toEqual({ error: "candidate_exploration_disabled" });
  expect(interpretDateRequest).not.toHaveBeenCalled();
  expect(searchKakaoPlacesRemote).not.toHaveBeenCalled();
});

it("prepares known region and activity, then shows only the five eligible provider candidates", async () => {
  const prepared = await prepareCandidateExploration({ message: "부산 2박3일 카페" });
  expect("error" in prepared).toBe(false);
  if ("error" in prepared) return;
  expect(prepared.needsArea).toBe(false);
  expect(prepared.state.stayKind).toBe("overnight");
  expect(prepared.state.nights).toBe(2);
  expect(prepared.preferences.activities).toContain("cafe");
  const result = await exploreCandidateGroups({ message: "부산 2박3일 카페", state,
    preferences: prefs, planningSessionId: sessionId });
  expect("error" in result).toBe(false);
  if ("error" in result) return;
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0].cards).toHaveLength(5);
  expect(result.sessionCandidates.shownCandidateIds).toHaveLength(5);
  expect(result.researchPlan.needs.filter(need => need.kind === "venue")).toHaveLength(1);
});

it("reuses eight unseen eligible session candidates before issuing a provider search", async () => {
  const now = new Date().toISOString();
  const records = buildDateCandidatePool(Array.from({ length: 10 }, (_, index) => venue(index + 1)), state).records;
  const session = sealSessionCandidates(mergeSessionCandidates(null, records, {
    sessionId, observedAt: now, turnId: `${sessionId}:1` }));
  const result = await exploreCandidateGroups({ message: "부산 카페", state, preferences: prefs,
    planningSessionId: sessionId, sessionCandidates: session });
  expect("error" in result).toBe(false);
  if ("error" in result) return;
  expect(result.groups[0].cards).toHaveLength(8);
  expect(result.searchedGroups).toEqual([]);
  expect(searchKakaoPlacesRemote).not.toHaveBeenCalled();
  expect(enrichResearchNeedEvidence).toHaveBeenCalled();
});

it("records selected and rejected candidates in the signed session without persistent memory", async () => {
  const first = await exploreCandidateGroups({ message: "부산 카페", state,
    preferences: prefs, planningSessionId: sessionId });
  if ("error" in first) throw new Error(first.error);
  const updated = await updateCandidateExplorationChoices({ planningSessionId: sessionId,
    sessionCandidates: first.sessionCandidates,
    selectedIds: ["kakao:1"], rejectedIds: ["kakao:2"] });
  expect(updated?.selectedCandidateIds).toContain("kakao:1");
  expect(updated?.rejectedCandidateIds).toContain("kakao:2");
  expect(updated?.records.find(row => row.candidateId === "kakao:2")?.events.at(-1)?.reason)
    .toBe("exploration_rejected");
  expect(updated?.feedback?.entries).toEqual([]);
});

it("refines only the cafe group and keeps shown candidates out of the next batch", async () => {
  const first = await exploreCandidateGroups({ message: "부산 카페", state,
    preferences: prefs, planningSessionId: sessionId });
  if ("error" in first) throw new Error(first.error);
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true,
    places: Array.from({ length: 10 }, (_, index) => venue(index + 1)), isEnd: true, page: 1, totalCount: 10 });
  const next = await exploreCandidateGroups({ message: "부산 카페", state, preferences: prefs,
    planningSessionId: sessionId, sessionCandidates: first.sessionCandidates,
    experiencePlan: first.experiencePlan, researchPlan: first.researchPlan,
    groupId: "cafe", refinement: "좀 더 바다 보이는 카페" });
  if ("error" in next) throw new Error(next.error);
  expect(next.groups[0].cards.map(card => card.candidateId).sort()).toEqual([
    "kakao:6", "kakao:7", "kakao:8", "kakao:9", "kakao:10",
  ].sort());
  expect(next.researchPlan.needs.find(need => need.id === "explore-cafe")?.qualities).toContain("view");
});

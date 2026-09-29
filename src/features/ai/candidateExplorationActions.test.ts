import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { buildDateCandidatePool } from "./dateCandidatePool";
import { mergeSessionCandidates, sealSessionCandidates } from "./sessionCandidates";
import type { CandidateExplorationPreferences } from "./candidateExploration";

vi.mock("@/lib/openai/interpretDateRequest", () => ({ interpretDateRequest: vi.fn() }));
vi.mock("@/lib/kakao/local", () => ({ searchKakaoPlacesRemote: vi.fn(), geocodeKakaoAddressRemote: vi.fn(async () => null) }));
vi.mock("@/lib/tourapi/client", () => ({ searchTourPlacesRemote: vi.fn() }));
vi.mock("@/lib/tourapi/env", () => ({ isTourApiConfigured: () => false }));
vi.mock("@/lib/openai/experiencePlan", () => ({ observeExperiencePlan: vi.fn(async () => null) }));
vi.mock("@/lib/openai/enrichDateVenues", () => ({ enrichResearchNeedEvidence: vi.fn(async (rows: DiscoverCandidate[]) => rows) }));
vi.mock("@/features/places/actions", () => ({ listPlaces: vi.fn(async () => ({ places: [] })) }));

import { interpretDateRequest } from "@/lib/openai/interpretDateRequest";
import { geocodeKakaoAddressRemote, searchKakaoPlacesRemote } from "@/lib/kakao/local";
import { observeExperiencePlan } from "@/lib/openai/experiencePlan";
import { enrichResearchNeedEvidence } from "@/lib/openai/enrichDateVenues";
import { exploreCandidateGroups, prepareCandidateExploration,
  replaceRejectedCandidateFromSession, updateCandidateExplorationChoices } from "./candidateExplorationActions";
import { candidateExplorationMode } from "./candidateExplorationMode";

const state = withAreas(emptyDateBrief(), ["부산"]);
const prefs: CandidateExplorationPreferences = { activities: ["cafe"], cafeQualities: [], cuisines: [],
  shoppingKinds: [], cultureKinds: [], additionalDetails: "", pace: "balanced",
  provenance: { cafe: "user_selected" } };
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
  vi.unstubAllEnvs();
  delete process.env.DATE_CANDIDATE_EXPLORATION_MODE;
  delete process.env.SESSION_CANDIDATE_SIGNING_KEY;
  vi.clearAllMocks();
});

it("stops exploration before model work when no signing key is configured", async () => {
  vi.stubEnv("SESSION_CANDIDATE_SIGNING_KEY", "");
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  expect(await prepareCandidateExploration({ message: "부산 카페" }))
    .toEqual({ error: "candidate_session_unavailable" });
  expect(interpretDateRequest).not.toHaveBeenCalled();
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

it("asks for a travel span before candidate exploration unless the user supplied one", async () => {
  const missing = await prepareCandidateExploration({ message: "부산 여행가려고" });
  if ("error" in missing) throw new Error(missing.error);
  expect(missing.needsArea).toBe(false);
  expect(missing.needsSpan).toBe(true);
  expect(searchKakaoPlacesRemote).not.toHaveBeenCalled();

  const completed = await prepareCandidateExploration({ message: "부산 여행가려고 2박3일" });
  if ("error" in completed) throw new Error(completed.error);
  expect(completed.needsSpan).toBe(false);
  expect(completed.state.nights).toBe(2);
  expect(completed.state.stayKind).toBe("overnight");

  const previous = await prepareCandidateExploration({ message: "부산 카페 여행",
    previousState: { ...state, stayKind: "daytrip", nights: 0 } });
  if ("error" in previous) throw new Error(previous.error);
  expect(previous.needsSpan).toBe(true);
  expect(previous.state.nights).toBe(0);

  const compact = await prepareCandidateExploration({ message: "부산여행",
    previousState: { ...state, stayKind: "daytrip", nights: 0 } });
  if ("error" in compact) throw new Error(compact.error);
  expect(compact.needsSpan).toBe(true);

  const longer = await prepareCandidateExploration({ message: "부산 3박4일 여행",
    previousState: { ...state, stayKind: "daytrip", nights: 0 } });
  if ("error" in longer) throw new Error(longer.error);
  expect(longer.needsSpan).toBe(false);
  expect(longer.state.nights).toBe(3);
});

it("asks for duration when the interpreter understands a trip without a trip keyword", async () => {
  vi.mocked(interpretDateRequest).mockResolvedValueOnce({ state, slot: null, reply: "", journeyType: "trip" });
  const prepared = await prepareCandidateExploration({ message: "부산에서 며칠 쉬고 싶어" });
  if ("error" in prepared) throw new Error(prepared.error);
  expect(prepared.needsSpan).toBe(true);
  expect(prepared.state.stayKind).toBe("date");
});

it("finds provider-identified Wangsimni shopping complexes with broad shopping searches", async () => {
  const shoppingState = withAreas(emptyDateBrief(), ["왕십리"]);
  const shopping = { ...prefs, activities: ["shopping" as const], provenance: { shopping: "user_selected" as const } };
  vi.mocked(searchKakaoPlacesRemote).mockImplementation(async input => ({ ok: true,
    places: input.query === "쇼핑몰" ? [{ ...venue(501), name: "엔터식스 왕십리역점", category: "tourist",
      categoryLabel: "쇼핑몰", detailedCategory: "쇼핑 > 쇼핑몰", kakaoCategoryGroupCode: "MT1",
      district: "서울 성동구 왕십리", address: "서울 성동구 왕십리광장로 17" }] : [],
    isEnd: true, page: input.page ?? 1, totalCount: 1 }));
  const result = await exploreCandidateGroups({ message: "왕십리 쇼핑", state: shoppingState,
    preferences: shopping, planningSessionId: sessionId });
  if ("error" in result) throw new Error(result.error);
  expect(result.groups[0].cards.map(card => card.name)).toContain("엔터식스 왕십리역점");
  expect(searchKakaoPlacesRemote).toHaveBeenCalledWith(expect.objectContaining({
    region: "왕십리", query: "쇼핑몰", includeShopping: true, category: undefined }));
});

it("uses a citywide scope and provider outlet taxonomy for Jeonju shopping", async () => {
  const jeonjuState = withAreas(emptyDateBrief(), ["전주"]);
  const shopping = { ...prefs, activities: ["shopping" as const],
    shoppingKinds: ["outlet" as const], provenance: { shopping: "user_selected" as const } };
  vi.mocked(geocodeKakaoAddressRemote).mockResolvedValueOnce({
    address: "전북특별자치도 전주시", roadAddress: "", district: "전북특별자치도 전주시",
    coordinates: [127.148, 35.824],
  });
  vi.mocked(searchKakaoPlacesRemote).mockImplementation(async input => ({ ok: true,
    places: input.query === "아울렛" ? [{ ...venue(511), name: "서전주아울렛",
      category: "tourist", categoryLabel: "장소", detailedCategory: "가정,생활 > 상설할인매장",
      kakaoCategoryGroupCode: "", district: "전주시 완산구",
      address: "전북특별자치도 전주시 완산구 효자동", coordinates: [127.09, 35.80] }] : [],
    isEnd: true, page: input.page ?? 1, totalCount: 1 }));
  const result = await exploreCandidateGroups({ message: "전주 아울렛", state: jeonjuState,
    preferences: shopping, planningSessionId: sessionId });
  if ("error" in result) throw new Error(result.error);
  expect(result.groups[0].cards.map(card => card.name)).toContain("서전주아울렛");
  expect(searchKakaoPlacesRemote).not.toHaveBeenCalledWith(expect.objectContaining({ query: "전주역 상가" }));
});

it("combines agreement across research queries when ranking any eligible group", async () => {
  const beaches = Array.from({ length: 9 }, (_, index) => ({ ...venue(index + 701),
    name: `${String.fromCharCode(65 + index)} 해수욕장`, category: "nature" as const,
    categoryLabel: "관광명소", detailedCategory: "여행 > 관광,명소 > 해수욕장,해변",
    kakaoCategoryGroupCode: "AT4" }));
  vi.mocked(searchKakaoPlacesRemote).mockImplementation(async input => ({ ok: true,
    places: input.query === "해변" ? [beaches[8]]
      : input.query.includes("해수욕장") && (input.page ?? 1) === 1 ? beaches : [],
    isEnd: true, page: input.page ?? 1, totalCount: beaches.length }));
  const preferences = { ...prefs, activities: ["beach" as const],
    provenance: { beach: "user_selected" as const } };
  const result = await exploreCandidateGroups({ message: "부산 바다", state,
    preferences, planningSessionId: sessionId });
  if ("error" in result) throw new Error(result.error);
  expect(result.groups[0].cards).toHaveLength(8);
  expect(result.groups[0].cards[0].name).toBe(beaches[8].name);
  expect(result.groups[0].cards.map(card => card.name)).not.toContain(beaches[7].name);
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

it("fills a rejected card from signed unseen inventory without another search", async () => {
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true,
    places: Array.from({ length: 10 }, (_, index) => venue(index + 1)),
    isEnd: true, page: 1, totalCount: 10 });
  const first = await exploreCandidateGroups({ message: "부산 카페", state,
    preferences: prefs, planningSessionId: sessionId });
  if ("error" in first) throw new Error(first.error);
  const rejectedId = first.groups[0].cards[0].candidateId;
  const shown = new Set(first.groups[0].cards.map(card => card.candidateId));
  vi.mocked(searchKakaoPlacesRemote).mockClear();
  const next = await replaceRejectedCandidateFromSession({ state, preferences: prefs,
    researchPlan: first.researchPlan, planningSessionId: sessionId,
    sessionCandidates: first.sessionCandidates, groupId: "cafe",
    selectedIds: [], rejectedIds: [rejectedId] });
  if ("error" in next) throw new Error(next.error);
  expect(next.card).not.toBeNull();
  expect(shown.has(next.card!.candidateId)).toBe(false);
  expect(next.sessionCandidates.shownCandidateIds).toContain(next.card!.candidateId);
  expect(next.sessionCandidates.rejectedCandidateIds).toContain(rejectedId);
  expect(searchKakaoPlacesRemote).not.toHaveBeenCalled();
});

it("leaves a rejected slot empty when signed inventory has no eligible replacement", async () => {
  const first = await exploreCandidateGroups({ message: "부산 카페", state,
    preferences: prefs, planningSessionId: sessionId });
  if ("error" in first) throw new Error(first.error);
  vi.mocked(searchKakaoPlacesRemote).mockClear();
  const next = await replaceRejectedCandidateFromSession({ state, preferences: prefs,
    researchPlan: first.researchPlan, planningSessionId: sessionId,
    sessionCandidates: first.sessionCandidates, groupId: "cafe",
    selectedIds: [], rejectedIds: [first.groups[0].cards[0].candidateId] });
  if ("error" in next) throw new Error(next.error);
  expect(next.card).toBeNull();
  expect(searchKakaoPlacesRemote).not.toHaveBeenCalled();
});

it("bounds total provider searches when every exploration category is selected", async () => {
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true, places: [],
    isEnd: true, page: 1, totalCount: 0 });
  const allCategories = { ...prefs, activities: ["beach", "culture", "shopping", "meal",
    "cafe", "nightview", "experience", "nature"] as CandidateExplorationPreferences["activities"] };
  const result = await exploreCandidateGroups({ message: "부산에서 여러 장소 보고 싶어", state,
    preferences: allCategories, planningSessionId: sessionId });
  if ("error" in result) throw new Error(result.error);
  expect(result.groups).toHaveLength(8);
  expect(searchKakaoPlacesRemote).toHaveBeenCalled();
  expect(vi.mocked(searchKakaoPlacesRemote).mock.calls.length).toBeLessThanOrEqual(32);
});

it("returns candidate groups in batches and reuses the first research plan", async () => {
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true, places: [],
    isEnd: true, page: 1, totalCount: 0 });
  const preferences = { ...prefs, activities: ["beach", "culture", "shopping", "meal",
    "cafe", "nightview"] as CandidateExplorationPreferences["activities"] };
  const first = await exploreCandidateGroups({ message: "부산 여행", state, preferences,
    planningSessionId: sessionId, groupIds: ["beach", "culture", "shopping"] });
  if ("error" in first) throw new Error(first.error);
  expect(first.groups.map(group => group.id)).toEqual(["beach", "culture", "shopping"]);
  const second = await exploreCandidateGroups({ message: "부산 여행", state, preferences,
    planningSessionId: sessionId, sessionCandidates: first.sessionCandidates,
    experiencePlan: first.experiencePlan, researchPlan: first.researchPlan,
    groupIds: ["meal", "cafe", "nightview"] });
  if ("error" in second) throw new Error(second.error);
  expect(second.groups.map(group => group.id)).toEqual(["meal", "cafe", "nightview"]);
  expect(observeExperiencePlan).toHaveBeenCalledTimes(1);
  expect(vi.mocked(searchKakaoPlacesRemote).mock.calls.length).toBeLessThanOrEqual(32);
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
  const cleared = await updateCandidateExplorationChoices({ planningSessionId: sessionId,
    sessionCandidates: updated, selectedIds: ["kakao:1"], rejectedIds: [] });
  expect(cleared?.rejectedCandidateIds).not.toContain("kakao:2");
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

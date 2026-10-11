import { afterEach, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { AIPlannerReply } from "@/features/planning/types/plan";
import { emptyDateBrief } from "./dateBrief";
import { markExplorationCandidates, mergeSessionCandidates, sealSessionCandidates } from "./sessionCandidates";
import { buildDateCandidatePool } from "./dateCandidatePool";
import { explorationResearchPlan, initialExplorationPreferences } from "./candidateExploration";
import { designDateDiscovery } from "@/lib/openai/designDateDiscovery";
import { recommendDatePlan, recommendDatePlanWithSession } from "./actions";
import { searchKakaoPlacesRemote } from "@/lib/kakao/local";
import { recommendDatePlanWithOpenAi } from "@/lib/openai/recommendDatePlan";
import { interpretDateTurnWithOpenAi } from "@/lib/openai/dateTurnInterpreter";
import { answerDateQuestion } from "@/lib/openai/answerDateQuestion";
import { routeDateChat } from "@/lib/openai/routeDateChat";

vi.mock("@/features/auth/session", () => ({ getAppSession: vi.fn(async () => ({ mode: "authenticated", userId: "user", coupleId: "couple", displayName: "나", partner: null })) }));
vi.mock("@/features/places/actions", () => ({ listPlaces: vi.fn(async () => ({ places: [] })) }));
vi.mock("@/features/planning/actions", () => ({ listArchivedDatePlans: vi.fn(async () => ({ dates: [] })) }));
vi.mock("@/features/taste/actions", () => ({ loadTasteBoard: vi.fn(async () => ({})) }));
vi.mock("@/lib/openai/routeDateChat", () => ({ routeDateChat: vi.fn(async () => ({ mode: "course", confident: true })) }));
vi.mock("@/lib/openai/interpretDateRequest", () => ({ interpretDateRequest: vi.fn(async () => ({
  state: { ...emptyDateBrief(), region: "성수", regions: ["성수"], areas: ["성수"],
    activities: ["meal", "cafe"], pendingSlot: null }, slot: null, reply: "",
})) }));
vi.mock("@/lib/openai/designDateDiscovery", () => ({ designDateDiscovery: vi.fn(async () => ({
  themes: [], priorities: [], queries: [], transport: "walk", requiredActivities: ["meal", "cafe"],
  activityOrder: ["meal", "cafe"], minStops: 2, maxStops: 3,
})) }));
vi.mock("@/lib/openai/discoverVenueLeads", () => ({ discoverVenueLeads: vi.fn(async () => []),
  leadMatchesCandidate: vi.fn(() => false) }));
vi.mock("@/lib/openai/dateTaskPlanner", () => ({ dateTaskObjectives: vi.fn(() => []), runDateTaskPlanner: vi.fn(async () => ({
  objectives: [], observation: { candidates: [], missingActivities: [] }, steps: [],
  stopReason: "planner_done", unresolvedActivities: [],
})) }));
vi.mock("@/lib/openai/venueEvidenceStore", () => ({ readVenueEvidence: vi.fn(async () => new Map()) }));
vi.mock("@/lib/places/detailCache", () => ({ hydrateDateCandidates: vi.fn(async (pool: DiscoverCandidate[]) => pool) }));
vi.mock("@/lib/kopis/client", () => ({ attachKopisPerformances: vi.fn(async (pool: DiscoverCandidate[]) => pool) }));
vi.mock("@/lib/kakao/local", () => ({ searchKakaoPlacesRemote: vi.fn() }));
vi.mock("@/lib/openai/recommendDatePlan", () => ({ recommendDatePlanWithOpenAi: vi.fn() }));
vi.mock("@/lib/openai/dateTurnInterpreter", () => ({ interpretDateTurnWithOpenAi: vi.fn() }));
vi.mock("@/lib/openai/answerDateQuestion", () => ({ answerDateQuestion: vi.fn(),
  fallbackQuestionCard: vi.fn((message: string, stops: Array<{ name: string }>) => ({
    headline: stops[0]?.name ?? "", lines: ["주차 가능 여부는 아직 확인하지 못했어요."], suggestions: [],
  })) }));

const candidates: DiscoverCandidate[] = [
  { externalSource: "kakao", externalPlaceId: "meal", name: "성수 식당", category: "restaurant",
    categoryLabel: "식당", district: "성동구", address: "성수", roadAddress: "성수", phone: "", mapUrl: "",
    coordinates: [127.04, 37.56] },
  { externalSource: "kakao", externalPlaceId: "cafe", name: "성수 카페", category: "cafe",
    categoryLabel: "카페", district: "성동구", address: "성수", roadAddress: "성수", phone: "", mapUrl: "",
    coordinates: [127.0405, 37.56] },
];

it("uses the signed exploration inventory without another search or research pass", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("SESSION_CANDIDATE_SIGNING_KEY", "test-only-signing-key");
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "off");
  const state = { ...emptyDateBrief(), region: "성수", regions: ["성수"], areas: ["성수"],
    stayKind: "date" as const, timeWindow: "afternoon" as const, cuisine: "any" as const, pendingSlot: null,
    userRequests: ["도보로만 이동하고 오후 3시부터 성수 식사와 카페"] };
  const preferences = initialExplorationPreferences("성수 식사와 카페", state);
  const planningSessionId = "123e4567-e89b-12d3-a456-426614174000";
  const selectedIds = candidates.map(candidate => `kakao:${candidate.externalPlaceId}`);
  const researchPlan = explorationResearchPlan(null, preferences, "성수", state);
  const oldObservedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const oldCandidates = candidates.map(candidate => ({ ...candidate, openingHours: "09:00-22:00", expectedCostTwo: 50000 }));
  const sessionCandidates = sealSessionCandidates(markExplorationCandidates(mergeSessionCandidates(null,
    buildDateCandidatePool(oldCandidates, state).records, { sessionId: planningSessionId, turnId: "found", observedAt: oldObservedAt }),
    { selectedIds, turnId: "chosen", observedAt: new Date().toISOString() }), { actorId: "user", coupleId: "couple" });
  vi.mocked(recommendDatePlanWithOpenAi).mockImplementationOnce(async input => ({
    status: "plan", state: input.state, condition: input.condition, source: "openai", candidateCount: input.candidates.length,
    message: "성수 코스", card: { headline: "성수", lines: ["성수 코스"] },
    recommendations: input.candidates.map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, placeId: `kakao:${candidate.externalPlaceId}`,
      name: candidate.name, category: candidate.categoryLabel, district: candidate.district, address: candidate.address,
      phone: candidate.phone, mapUrl: candidate.mapUrl, coordinates: candidate.coordinates,
      durationMinutes: 60, expectedCost: 0, reasons: [], isSaved: false, distanceFromPreviousMeters: null })),
    items: input.candidates.map((candidate, order) => ({ id: `i-${order}`, placeId: `kakao:${candidate.externalPlaceId}`,
      placeName: candidate.name, category: candidate.categoryLabel, startTime: order ? "17:00" : "15:00",
      durationMinutes: 60, expectedCost: 0, order, memo: "", dayIndex: 0 })),
  }));
  const result = await recommendDatePlanWithSession({ message: "선택한 장소로 일정 짜줘", planKind: "date", previousState: state,
    planningSessionId, sessionCandidates, planningInput: { experiencePlan: null, researchPlan, preferences,
      candidatePool: sessionCandidates, selectedCandidateIds: selectedIds, rejectedCandidateIds: [] } });
  expect(result.result).toMatchObject({ status: "plan", items: [{ placeName: "성수 식당" }, { placeName: "성수 카페" }] });
  expect(searchKakaoPlacesRemote).not.toHaveBeenCalled();
  expect(vi.mocked(designDateDiscovery).mock.lastCall?.[0].useExistingBrief).toBe(true);
  expect(vi.mocked(recommendDatePlanWithOpenAi).mock.lastCall?.[0]).toMatchObject({ anchorCandidateIds: selectedIds, researchPlanActive: true });
  expect(vi.mocked(recommendDatePlanWithOpenAi).mock.lastCall?.[0].state.userRequests)
    .toEqual([...state.userRequests, "선택한 장소로 일정 짜줘"]);
  const reused = vi.mocked(recommendDatePlanWithOpenAi).mock.lastCall?.[0].candidates ?? [];
  expect(reused).toHaveLength(2);
  expect(reused.every(candidate => candidate.openingHours === undefined && candidate.expectedCostTwo === undefined)).toBe(true);
});

it("asks a trip's duration even for a local city instead of silently creating a date", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const result = await recommendDatePlan({ message: "성수에서 놀고 싶어", planKind: "trip", previousState: emptyDateBrief() });
  expect(result).toMatchObject({ status: "clarification", slot: "span", state: { stayKind: null } });
  expect(searchKakaoPlacesRemote).not.toHaveBeenCalled();
});

afterEach(() => { vi.unstubAllEnvs(); vi.mocked(searchKakaoPlacesRemote).mockReset();
  vi.mocked(recommendDatePlanWithOpenAi).mockReset(); vi.mocked(interpretDateTurnWithOpenAi).mockReset();
  vi.mocked(answerDateQuestion).mockReset(); });

it("keeps fixed-pool searches and the course AIPlannerResult identical with shadow execution planning", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true, places: candidates });
  vi.mocked(recommendDatePlanWithOpenAi).mockImplementation(async input => {
    const recommendations = input.candidates.slice(0, 2).map(candidate => ({
      id: `kakao:${candidate.externalPlaceId}`, placeId: `discover:kakao:${candidate.externalPlaceId}`,
      name: candidate.name, activitySlot: candidate.category === "cafe" ? "cafe" as const : "meal" as const,
      category: candidate.categoryLabel, district: candidate.district, address: candidate.address,
      phone: candidate.phone, mapUrl: candidate.mapUrl, coordinates: candidate.coordinates,
      durationMinutes: 60, expectedCost: 0, reasons: [], isSaved: false, distanceFromPreviousMeters: null,
    }));
    return { status: "plan", message: "성수 코스", card: { headline: "성수", lines: ["성수 코스"] },
      condition: input.condition, recommendations,
      items: recommendations.map((place, index) => ({ id: `item-${index}`, placeId: place.placeId,
        placeName: place.name, category: place.category, startTime: index ? "17:00" : "15:00",
        durationMinutes: 60, expectedCost: 0, order: index, memo: "", dayIndex: 0 })),
      candidateCount: input.candidates.length, source: "fallback", state: input.state,
    } satisfies AIPlannerReply;
  });
  vi.mocked(interpretDateTurnWithOpenAi).mockResolvedValue({
    goals: [{ type: "create_itinerary", targetText: null, attribute: null, confidence: 0.9 }],
    references: [], semanticPreferences: [], requestedChanges: [], feedback: [],
    constraintClaims: { areas: [], date: null, startTime: null, endTime: null, budgetWon: null,
      requiredPlaces: [], excludedPlaces: [], excludedFoods: [], requiredActivities: [] },
    ambiguities: [], confidence: 0.9,
  });
  const input = { message: "성수 데이트 코스 짜줘", previousState: emptyDateBrief() };
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "off");
  const before = await recommendDatePlan(input);
  const searchesBefore = vi.mocked(searchKakaoPlacesRemote).mock.calls.map(([query]) => query);
  const proposalBefore = vi.mocked(recommendDatePlanWithOpenAi).mock.lastCall?.[0];
  vi.mocked(searchKakaoPlacesRemote).mockClear();
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "assist");
  const after = await recommendDatePlan(input);
  const searchesAfter = vi.mocked(searchKakaoPlacesRemote).mock.calls.map(([query]) => query);
  const proposalAfter = vi.mocked(recommendDatePlanWithOpenAi).mock.lastCall?.[0];
  expect(searchesAfter).toEqual(searchesBefore);
  expect(proposalAfter?.candidates.map(candidate => `kakao:${candidate.externalPlaceId}`))
    .toEqual(proposalBefore?.candidates.map(candidate => `kakao:${candidate.externalPlaceId}`));
  expect(proposalAfter?.semanticPlanningHints).toBeUndefined();
  expect(after).toEqual(before);
  vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "limited");
  const limitedWithoutInspect = await recommendDatePlan(input);
  expect(limitedWithoutInspect).toEqual(before);
  expect(answerDateQuestion).not.toHaveBeenCalled();
});

it("carries candidate records across turns beside an unchanged AIPlannerResult", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("SESSION_CANDIDATE_SIGNING_KEY", "action-test-signing-key");
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true, places: candidates });
  vi.mocked(recommendDatePlanWithOpenAi).mockImplementation(async input => {
    const recommendations = input.candidates.slice(0, 2).map(candidate => ({
      id: `kakao:${candidate.externalPlaceId}`, placeId: `discover:kakao:${candidate.externalPlaceId}`,
      name: candidate.name, activitySlot: candidate.category === "cafe" ? "cafe" as const : "meal" as const,
      category: candidate.categoryLabel, district: candidate.district, address: candidate.address,
      phone: candidate.phone, mapUrl: candidate.mapUrl, coordinates: candidate.coordinates,
      durationMinutes: 60, expectedCost: 0, reasons: [], isSaved: false,
      distanceFromPreviousMeters: null,
    }));
    return { status: "plan", message: "성수 코스", card: { headline: "성수", lines: ["성수 코스"] },
      condition: input.condition, recommendations,
      items: recommendations.map((place, index) => ({ id: `item-${index}`, placeId: place.placeId,
        placeName: place.name, category: place.category, startTime: index ? "17:00" : "15:00",
        durationMinutes: 60, expectedCost: 0, order: index, memo: "", dayIndex: 0 })),
      candidateCount: input.candidates.length, source: "fallback", state: input.state,
    } satisfies AIPlannerReply;
  });
  const input = { message: "성수 데이트 코스 짜줘", previousState: emptyDateBrief() };
  const legacy = await recommendDatePlan(input);
  const legacyQueries = vi.mocked(searchKakaoPlacesRemote).mock.calls.map(([query]) => query);
  vi.mocked(searchKakaoPlacesRemote).mockClear();
  const sessionInput = { ...input, planningSessionId: "123e4567-e89b-42d3-a456-426614174000" };
  const first = await recommendDatePlanWithSession(sessionInput);
  expect(vi.mocked(searchKakaoPlacesRemote).mock.calls.map(([query]) => query)).toEqual(legacyQueries);
  const second = await recommendDatePlanWithSession({ ...sessionInput,
    sessionCandidates: first.sessionCandidates });
  expect(first.result).toEqual(legacy);
  expect(second.result).toEqual(legacy);
  expect(first.sessionCandidates.records.length).toBeGreaterThan(0);
  expect(second.sessionCandidates.records).toHaveLength(first.sessionCandidates.records.length);
  expect(second.sessionCandidates.turnCount).toBe(2);
  const invalid = await recommendDatePlanWithSession({ ...sessionInput,
    sessionCandidates: { ...first.sessionCandidates, signature: "bad" } });
  expect(invalid.result).toEqual(legacy);
  expect(invalid.sessionCandidates.turnCount).toBe(1);

  const rejected = sealSessionCandidates(markExplorationCandidates(first.sessionCandidates, {
    rejectedIds: ["kakao:cafe"], selectedIds: [], turnId: "reject:cafe",
    observedAt: new Date().toISOString(),
  }));
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true, places: [
    { ...candidates[0], kakaoCategoryGroupCode: "FD6" },
    { ...candidates[1], kakaoCategoryGroupCode: "CE7" },
    { ...candidates[1], externalPlaceId: "cafe-duplicate", kakaoCategoryGroupCode: "CE7" },
    { ...candidates[1], externalPlaceId: "cafe-2", name: "다른 성수 카페",
      kakaoCategoryGroupCode: "CE7" }] });
  await recommendDatePlanWithSession({ ...sessionInput, sessionCandidates: rejected,
    rejectedCandidateIds: ["kakao:cafe"] });
  expect(vi.mocked(recommendDatePlanWithOpenAi).mock.lastCall?.[0].candidates
    .map(candidate => `kakao:${candidate.externalPlaceId}`)).not.toContain("kakao:cafe");
  expect(vi.mocked(recommendDatePlanWithOpenAi).mock.lastCall?.[0].candidates
    .map(candidate => `kakao:${candidate.externalPlaceId}`)).not.toContain("kakao:cafe-duplicate");
});

it("keeps the course route primary and appends one verified cafe inspection only in limited assist", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true, places: [...candidates,
    { ...candidates[0], externalPlaceId: "meal2", name: "새 식당",
      coordinates: [127.041, 37.56] }] });
  vi.mocked(recommendDatePlanWithOpenAi).mockImplementation(async input => {
    const recommendations = input.candidates.slice(0, 2).map(candidate => ({
      id: `kakao:${candidate.externalPlaceId}`, placeId: `discover:kakao:${candidate.externalPlaceId}`,
      name: candidate.name, activitySlot: candidate.category === "cafe" ? "cafe" as const : "meal" as const,
      category: candidate.categoryLabel, district: candidate.district, address: candidate.address,
      phone: candidate.phone, mapUrl: candidate.mapUrl, coordinates: candidate.coordinates,
      durationMinutes: 60, expectedCost: 0, reasons: [], isSaved: false, distanceFromPreviousMeters: null,
    }));
    return { status: "plan", message: "새 성수 코스", card: { headline: "성수", lines: ["새 성수 코스"] },
      condition: input.condition, recommendations,
      items: recommendations.map((place, index) => ({ id: `item-${index}`, placeId: place.placeId,
        placeName: place.name, category: place.category, startTime: index ? "17:00" : "15:00",
        durationMinutes: 60, expectedCost: 0, order: index, memo: "", dayIndex: 0 })),
      candidateCount: input.candidates.length, source: "fallback", state: input.state,
    } satisfies AIPlannerReply;
  });
  const oldPlan: AIPlannerReply = {
    status: "plan", message: "기존 코스", card: { headline: "성수", lines: ["기존 코스"] },
    condition: { dateLabel: "2026-09-26", startTime: "15:00", endTime: "21:00", budget: null,
      region: "성수", timeSpecified: true },
    recommendations: [
      { id: "kakao:old", placeId: "discover:kakao:old", name: "기존 식당", activitySlot: "meal",
        category: "식당", district: "성동구", address: "성수", phone: "", mapUrl: "",
        coordinates: [127.04, 37.56], durationMinutes: 60, expectedCost: 0, reasons: [], isSaved: false,
        distanceFromPreviousMeters: null },
      { id: "kakao:cafe", placeId: "discover:kakao:cafe", name: "성수 카페", activitySlot: "cafe",
        category: "카페", district: "성동구", address: "성수", phone: "", mapUrl: "",
        coordinates: [127.0405, 37.56], durationMinutes: 60, expectedCost: 0, reasons: [], isSaved: false,
        distanceFromPreviousMeters: null },
    ],
    items: [{ id: "old-meal", placeId: "discover:kakao:old", placeName: "기존 식당", category: "식당",
      startTime: "15:00", durationMinutes: 60, expectedCost: 0, order: 0, memo: "", dayIndex: 0 },
    { id: "old-cafe", placeId: "discover:kakao:cafe", placeName: "성수 카페", category: "카페",
      startTime: "17:00", durationMinutes: 60, expectedCost: 0, order: 1, memo: "", dayIndex: 0 }],
    candidateCount: 2, source: "fallback", state: emptyDateBrief(),
  };
  vi.mocked(interpretDateTurnWithOpenAi).mockResolvedValue({
    goals: [{ type: "create_itinerary", targetText: null, attribute: null, confidence: 0.9 },
      { type: "ask_venue", targetText: "지금 카페", attribute: "parking", confidence: 0.9 }],
    references: [{ text: "지금 카페", kind: "category_slot", proposedName: "성수 카페", proposedId: "invented",
      ordinal: null, confidence: 0.9 }],
    semanticPreferences: [], requestedChanges: [], feedback: [],
    constraintClaims: { areas: [], date: null, startTime: null, endTime: null, budgetWon: null,
      requiredPlaces: [], excludedPlaces: [], excludedFoods: [], requiredActivities: [] },
    ambiguities: [], confidence: 0.9,
  });
  vi.mocked(answerDateQuestion).mockResolvedValue({ headline: "성수 카페",
    lines: ["주차 안내를 확인했어요."], sources: [{ label: "example", url: "https://example.com/cafe" }],
    suggestions: [] });
  const input = { message: "성수 데이트 코스 짜줘. 그리고 지금 카페 주차 돼?",
    previousState: emptyDateBrief(), currentPlan: oldPlan,
    previousStops: [{ name: "기존 식당", category: "식당", activitySlot: "meal" as const },
      { name: "성수 카페", category: "카페", activitySlot: "cafe" as const }],
    courseStops: [{ name: "기존 식당", meta: "식당" }, { name: "성수 카페", meta: "카페" }],
  };
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "assist");
  vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "off");
  const baseline = await recommendDatePlan(input);
  vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "limited");
  const supplemented = await recommendDatePlan(input);
  expect(baseline).toMatchObject({ status: "plan" });
  expect(supplemented).toMatchObject({ status: "plan" });
  expect(answerDateQuestion).toHaveBeenCalledTimes(1);
  expect(vi.mocked(answerDateQuestion).mock.calls[0][0].message).toBe("성수 카페 주차 가능 여부 알려줘");
  expect(vi.mocked(answerDateQuestion).mock.calls[0][0].stops).toHaveLength(1);
  expect(supplemented).toMatchObject({ status: baseline.status,
    card: { lines: [...("card" in baseline ? baseline.card.lines : []), "성수 카페: 주차 안내를 확인했어요."] } });
  if ("status" in baseline && baseline.status === "plan" && "status" in supplemented && supplemented.status === "plan") {
    expect(supplemented.items).toEqual(baseline.items);
    expect(supplemented.recommendations).toEqual(baseline.recommendations);
  }
  vi.mocked(answerDateQuestion).mockRejectedValueOnce(new Error("external API failure"));
  const failedInspection = await recommendDatePlan(input);
  expect(failedInspection).toEqual(baseline);
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "shadow");
  const shadow = await recommendDatePlan(input);
  expect(shadow).toEqual(baseline);
  expect(answerDateQuestion).toHaveBeenCalledTimes(2);
});

it("uses the existing question route once when it already covers the venue question", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "assist");
  vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "limited");
  vi.mocked(routeDateChat).mockResolvedValueOnce({ mode: "question", confident: true });
  vi.mocked(interpretDateTurnWithOpenAi).mockResolvedValue({
    goals: [{ type: "ask_venue", targetText: "성수 카페", attribute: "parking", confidence: 0.9 }],
    references: [{ text: "성수 카페", kind: "current_place", proposedName: "성수 카페",
      proposedId: "invented", ordinal: null, confidence: 0.9 }],
    semanticPreferences: [], requestedChanges: [], feedback: [],
    constraintClaims: { areas: [], date: null, startTime: null, endTime: null, budgetWon: null,
      requiredPlaces: [], excludedPlaces: [], excludedFoods: [], requiredActivities: [] },
    ambiguities: [], confidence: 0.9,
  });
  vi.mocked(answerDateQuestion).mockResolvedValue({ headline: "성수 카페", lines: ["주차는 확인 중이에요."], suggestions: [] });
  const result = await recommendDatePlan({ message: "성수 카페 주차 돼?", previousState: emptyDateBrief(),
    shownStops: [{ name: "성수 카페", meta: "카페" }] });
  expect(result).toMatchObject({ status: "chat", card: { lines: ["주차는 확인 중이에요."] } });
  expect(answerDateQuestion).toHaveBeenCalledTimes(1);
});

it("keeps a failed limited replacement independent from a verified cafe inspection", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "assist");
  vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "limited");
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true, places: [] });
  const currentPlan: AIPlannerReply = {
    status: "plan", message: "기존 코스", card: { headline: "성수", lines: ["기존 코스"] },
    condition: { dateLabel: "2026-09-26", startTime: "15:00", endTime: "21:00", budget: null,
      region: "성수", timeSpecified: true },
    recommendations: [
      { ...candidates[0], id: "kakao:meal", placeId: "discover:kakao:meal", activitySlot: "meal",
        durationMinutes: 60, expectedCost: 0, reasons: [], isSaved: false, distanceFromPreviousMeters: null },
      { ...candidates[1], id: "kakao:cafe", placeId: "discover:kakao:cafe", activitySlot: "cafe",
        durationMinutes: 60, expectedCost: 0, reasons: [], isSaved: false, distanceFromPreviousMeters: null },
    ],
    items: [
      { id: "old-meal", placeId: "discover:kakao:meal", placeName: "성수 식당", category: "식당",
        startTime: "15:00", durationMinutes: 60, expectedCost: 0, order: 0, memo: "", dayIndex: 0 },
      { id: "old-cafe", placeId: "discover:kakao:cafe", placeName: "성수 카페", category: "카페",
        startTime: "17:00", durationMinutes: 60, expectedCost: 0, order: 1, memo: "", dayIndex: 0 },
    ],
    candidateCount: 2, source: "fallback", state: emptyDateBrief(),
  };
  vi.mocked(interpretDateTurnWithOpenAi).mockResolvedValue({
    goals: [
      { type: "modify_itinerary", targetText: "저녁", attribute: null, confidence: 0.9 },
      { type: "ask_venue", targetText: "지금 카페", attribute: "parking", confidence: 0.9 },
    ],
    references: [
      { text: "저녁", kind: "category_slot", proposedName: "성수 식당", proposedId: "invented-meal",
        ordinal: null, confidence: 0.9 },
      { text: "지금 카페", kind: "category_slot", proposedName: "성수 카페", proposedId: "invented-cafe",
        ordinal: null, confidence: 0.9 },
    ],
    semanticPreferences: [], requestedChanges: [
      { operation: "replace", targetText: "저녁", replacementPreference: null,
        explicitValue: null, confidence: 0.9 },
    ], feedback: [],
    constraintClaims: { areas: [], date: null, startTime: null, endTime: null, budgetWon: null,
      requiredPlaces: [], excludedPlaces: [], excludedFoods: [], requiredActivities: [] },
    ambiguities: [], confidence: 0.9,
  });
  vi.mocked(answerDateQuestion).mockResolvedValue({ headline: "성수 카페",
    lines: ["주차 안내를 확인했어요."], sources: [{ label: "example", url: "https://example.com/cafe" }],
    suggestions: [] });
  const result = await recommendDatePlan({ message: "저녁 바꿔줘. 그리고 지금 카페 주차 돼?",
    previousState: emptyDateBrief(), currentPlan,
    previousStops: [{ name: "성수 식당", category: "식당", activitySlot: "meal" },
      { name: "성수 카페", category: "카페", activitySlot: "cafe" }],
    courseStops: [{ name: "성수 식당", meta: "식당" }, { name: "성수 카페", meta: "카페" }],
  });
  expect(answerDateQuestion).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ status: "chat", state: currentPlan.state });
  expect(result.card.lines[0]).toContain("교체할 새 장소를 확인하지 못해");
  expect(result.card.lines).toContain("성수 카페: 주차 안내를 확인했어요.");
  if (result.status === "plan") expect(result.items.map(item => item.placeId))
    .toEqual(currentPlan.items.map(item => item.placeId));
  expect(recommendDatePlanWithOpenAi).not.toHaveBeenCalled();
});

it("adds an independent cafe explanation when the primary dinner replacement cannot complete", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "assist");
  vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "limited");
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true, places: [] });
  const oldPlan: AIPlannerReply = { status: "plan", message: "기존 코스",
    card: { headline: "성수 코스", lines: ["기존 코스"] },
    condition: { dateLabel: "2026-09-26", startTime: "15:00", endTime: "21:00",
      budget: null, region: "성수", timeSpecified: true },
    recommendations: candidates.map((place, index) => ({ id: `kakao:${place.externalPlaceId}`,
      placeId: `discover:kakao:${place.externalPlaceId}`, name: place.name,
      activitySlot: index ? "cafe" as const : "meal" as const, category: place.categoryLabel,
      district: place.district, address: place.address, phone: "", mapUrl: "",
      coordinates: place.coordinates, durationMinutes: 60, expectedCost: 0,
      reasons: [], isSaved: false, distanceFromPreviousMeters: null })),
    items: candidates.map((place, index) => ({ id: `item-${index}`,
      placeId: `discover:kakao:${place.externalPlaceId}`, placeName: place.name,
      category: place.categoryLabel, startTime: index ? "17:00" : "15:00",
      durationMinutes: 60, expectedCost: 0, order: index, memo: "", dayIndex: 0 })),
    candidateCount: 2, source: "fallback", state: emptyDateBrief() };
  vi.mocked(interpretDateTurnWithOpenAi).mockResolvedValue({
    goals: [
      { type: "modify_itinerary", targetText: "저녁", attribute: null, confidence: 0.9 },
      { type: "explain_recommendation", targetText: "지금 카페", attribute: null, confidence: 0.9 },
    ],
    references: [
      { text: "저녁", kind: "category_slot", proposedName: "성수 식당", proposedId: null,
        ordinal: null, confidence: 0.9 },
      { text: "지금 카페", kind: "category_slot", proposedName: "성수 카페", proposedId: null,
        ordinal: null, confidence: 0.9 },
    ],
    semanticPreferences: [], requestedChanges: [{ operation: "replace", targetText: "저녁",
      replacementPreference: null, explicitValue: null, confidence: 0.9 }], feedback: [],
    constraintClaims: { areas: [], date: null, startTime: null, endTime: null, budgetWon: null,
      requiredPlaces: [], excludedPlaces: [], excludedFoods: [], requiredActivities: [] },
    ambiguities: [], confidence: 0.9,
  });
  const request = { message: "저녁 바꿔줘. 그리고 왜 지금 카페 넣었어?",
    previousState: emptyDateBrief(), currentPlan: oldPlan,
    previousStops: [{ name: "성수 식당", category: "식당", activitySlot: "meal" as const },
      { name: "성수 카페", category: "카페", activitySlot: "cafe" as const }],
    courseStops: [{ name: "성수 식당", meta: "식당" }, { name: "성수 카페", meta: "카페" }],
  };
  vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "off");
  const baseline = await recommendDatePlan(request);
  vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "limited");
  const explained = await recommendDatePlan(request);
  expect(explained.status).toBe(baseline.status);
  expect(explained).toMatchObject({ status: "chat", state: oldPlan.state });
  expect(explained.card.lines[0]).toContain("교체할 새 장소를 확인하지 못해");
  expect(explained.card.lines.at(-1)).toContain("추천 이유: 성수 카페");
  expect(explained.card.lines.at(-1)).not.toContain("조용해서");
  expect(answerDateQuestion).not.toHaveBeenCalled();
  expect(recommendDatePlanWithOpenAi).not.toHaveBeenCalled();
});

it("does not generate an addition from the retained venue alone", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "off");
  vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "off");
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true, places: [] });
  const cafe = candidates[1];
  const oldPlan: AIPlannerReply = { status: "plan", message: "기존 코스",
    card: { headline: "성수", lines: ["기존 코스"] },
    condition: { dateLabel: "2026-09-26", startTime: "15:00", endTime: "21:00",
      budget: null, region: "성수", timeSpecified: true },
    recommendations: [{ id: "kakao:cafe", placeId: "discover:kakao:cafe", name: cafe.name,
      category: "카페", activitySlot: "cafe", district: cafe.district, address: cafe.address,
      phone: "", mapUrl: "", coordinates: cafe.coordinates, durationMinutes: 60,
      expectedCost: 0, reasons: [], isSaved: false, distanceFromPreviousMeters: null }],
    items: [{ id: "old-cafe", placeId: "discover:kakao:cafe", placeName: cafe.name,
      category: "카페", startTime: "17:00", durationMinutes: 60, expectedCost: 0,
      order: 0, memo: "", dayIndex: 0 }],
    candidateCount: 1, source: "fallback", state: emptyDateBrief(),
  };
  const result = await recommendDatePlan({ message: "한 곳 더 추가해줘", currentPlan: oldPlan,
    previousState: oldPlan.state, previousStops: [{ name: cafe.name, category: "카페", activitySlot: "cafe" }] });
  expect(result).toMatchObject({ status: "chat", state: oldPlan.state });
  expect(result.card.lines[0]).toContain("기존 장소와 다른 추가 후보를 확인하지 못해");
  expect(recommendDatePlanWithOpenAi).not.toHaveBeenCalled();
});

it("still allows an initial itinerary from one available venue", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "off");
  vi.stubEnv("DATE_EXECUTION_PLAN_MODE", "off");
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true, places: [
    { ...candidates[1], kakaoCategoryGroupCode: "CE7", detailedCategory: "음식점 > 카페" },
  ] });
  vi.mocked(recommendDatePlanWithOpenAi).mockImplementationOnce(async input => {
    const cafe = input.candidates[0];
    return { status: "plan", message: "성수 카페", card: { headline: "성수", lines: ["성수 카페"] },
      condition: input.condition, state: input.state, source: "fallback", candidateCount: 1,
      recommendations: [{ id: "kakao:cafe", placeId: "discover:kakao:cafe", name: cafe.name,
        category: "카페", activitySlot: "cafe", district: cafe.district, address: cafe.address,
        phone: "", mapUrl: "", coordinates: cafe.coordinates, durationMinutes: 60,
        expectedCost: 0, reasons: [], isSaved: false, distanceFromPreviousMeters: null }],
      items: [{ id: "cafe", placeId: "discover:kakao:cafe", placeName: cafe.name,
        category: "카페", startTime: "17:00", durationMinutes: 60, expectedCost: 0,
        order: 0, memo: "", dayIndex: 0 }],
    } satisfies AIPlannerReply;
  });
  const result = await recommendDatePlan({ message: "성수 카페 한 곳에서 데이트", previousState: emptyDateBrief() });
  expect(result).toMatchObject({ status: "plan", items: [{ placeName: "성수 카페" }] });
  expect(recommendDatePlanWithOpenAi).toHaveBeenCalledTimes(1);
  expect(vi.mocked(recommendDatePlanWithOpenAi).mock.lastCall?.[0].candidates).toHaveLength(1);
});

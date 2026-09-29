"use server";

import { randomUUID } from "node:crypto";
import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { interpretDateRequest } from "@/lib/openai/interpretDateRequest";
import { geocodeKakaoAddressRemote, searchKakaoPlacesRemote } from "@/lib/kakao/local";
import { searchTourPlacesRemote } from "@/lib/tourapi/client";
import { listPlaces } from "@/features/places/actions";
import { placeToCandidate } from "@/features/places/discover";
import { isTourApiConfigured } from "@/lib/tourapi/env";
import { observeExperiencePlan } from "@/lib/openai/experiencePlan";
import { enrichResearchNeedEvidence } from "@/lib/openai/enrichDateVenues";
import { applyDateDefaults, extractAreasFromText, extractStay, selectedAreas, withAreas } from "./dateBrief";
import { explicitDateConstraints } from "./dateConstraints";
import { explicitFoodExclusions } from "./dateIntent";
import { buildDateContext } from "./dateContext";
import { buildDateCandidatePool } from "./dateCandidatePool";
import { dateCandidateKey } from "./dateCourse";
import { currentSessionVenue } from "./datePlaceRecommendationExecution";
import { isDateCourseCandidate, looksLikeNonVenue } from "@/lib/kakao/dateCandidate";
import { groupExplorationCandidates, initialExplorationPreferences,
  explorationPrompt, explorationResearchPlan, explorationStateForActivities,
  explorationGroupMatch, explorationSearchQueries, isBroadExplorationArea,
  refineExplorationNeed, validExplorationPreferences,
  type CandidateExplorationPreferences, type ExplorationActivity,
  type ExplorationCard, type ExplorationRetrievalSignal } from "./candidateExploration";
import { providerCategoryForResearchIntent, researchSearchIntents,
  validateResearchPlan, type ResearchPlan } from "./researchPlan";
import { emptySessionCandidates, markExplorationCandidates, mergeSessionCandidates,
  sealSessionCandidates, sessionCandidateSigningReady, verifiedSessionCandidates,
  type SessionCandidateContext } from "./sessionCandidates";
import type { ExperiencePlan } from "./experiencePlan";
import { candidateExplorationMode } from "./candidateExplorationMode";

function requestLimiter(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(run: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>(resolve => waiting.push(resolve));
    active++;
    try { return await run(); }
    finally { active--; waiting.shift()?.(); }
  };
}

const MAX_EXPLORATION_PROVIDER_CALLS = 32;
const MAX_EXPLORATION_EVIDENCE_TARGETS = 12;

export async function prepareCandidateExploration(input: { message: string; previousState?: AIPlannerState }) {
  if (candidateExplorationMode() !== "active") return { error: "candidate_exploration_disabled" } as const;
  if (!sessionCandidateSigningReady()) return { error: "candidate_session_unavailable" } as const;
  const message = input.message.trim().slice(0, 800);
  if (!message) return { error: "empty_request" } as const;
  const startedAt = performance.now();
  const interpreted = await interpretDateRequest({ message, previousState: input.previousState,
    previousPlaceNames: [] });
  console.info("candidate_exploration_intake", JSON.stringify({
    interpretationMs: Math.round(performance.now() - startedAt),
  }));
  const explicitStay = extractStay(message);
  const travelRequested = interpreted.journeyType === "trip" || /여행|휴가|관광|놀러\s*가/.test(message);
  const previousSpan = !travelRequested && (input.previousState?.stayKind === "overnight" || input.previousState?.stayKind === "daytrip")
    ? { stayKind: input.previousState.stayKind, nights: input.previousState.nights } : null;
  const groundedAreas = extractAreasFromText(message);
  const state = applyDateDefaults(withAreas({ ...interpreted.state,
    ...(travelRequested && !explicitStay ? { stayKind: null, nights: 0 } : explicitStay ?? previousSpan),
    userRequests: [...(interpreted.state.userRequests ?? []), message].slice(-8) },
    groundedAreas.length ? groundedAreas : selectedAreas(interpreted.state)));
  const tripIntent = travelRequested || interpreted.state.stayKind === "overnight" || interpreted.state.stayKind === "daytrip";
  return { state, preferences: initialExplorationPreferences(message, state),
    needsArea: selectedAreas(state).length === 0,
    needsSpan: tripIntent && !explicitStay && !previousSpan };
}

export async function updateCandidateExplorationChoices(input: {
  planningSessionId: string; sessionCandidates: SessionCandidateContext | null;
  selectedIds: string[]; rejectedIds: string[];
}): Promise<SessionCandidateContext | null> {
  if (candidateExplorationMode() !== "active") return null;
  const previous = verifiedSessionCandidates(input.sessionCandidates, input.planningSessionId);
  if (!previous) return null;
  const updated = markExplorationCandidates(previous, {
    selectedIds: input.selectedIds.slice(0, 32), rejectedIds: input.rejectedIds.slice(0, 64),
    turnId: `${input.planningSessionId}:choice:${randomUUID()}`, observedAt: new Date().toISOString(),
  });
  return sealSessionCandidates(updated);
}

/** Fill one rejected slot from the signed, unseen inventory without another provider or model call. */
export async function replaceRejectedCandidateFromSession(input: {
  state: AIPlannerState; preferences: CandidateExplorationPreferences; researchPlan: ResearchPlan;
  planningSessionId: string; sessionCandidates: SessionCandidateContext | null;
  groupId: ExplorationActivity; selectedIds: string[]; rejectedIds: string[];
}): Promise<{ card: ExplorationCard | null; sessionCandidates: SessionCandidateContext } | { error: string }> {
  if (candidateExplorationMode() !== "active") return { error: "candidate_exploration_disabled" };
  if (!validExplorationPreferences(input.preferences) || !input.preferences.activities.includes(input.groupId)
    || !validateResearchPlan(input.researchPlan)
    || !input.researchPlan.needs.some(need => need.id === `explore-${input.groupId}`)
    || !Array.isArray(input.selectedIds) || !Array.isArray(input.rejectedIds))
    return { error: "invalid_group" };
  const session = verifiedSessionCandidates(input.sessionCandidates, input.planningSessionId);
  if (!session) return { error: "invalid_candidate_session" };
  const now = new Date().toISOString();
  const selectedIds = input.selectedIds.slice(0, 32);
  const rejectedIds = input.rejectedIds.slice(0, 64);
  const marked = markExplorationCandidates(session, { selectedIds, rejectedIds,
    turnId: `${session.sessionId}:reject:${randomUUID()}`, observedAt: now });
  const state = explorationStateForActivities(input.state, input.preferences);
  const candidates = marked.records.filter(row => row.currentState === "eligible" && !row.shownCount
    && !row.rejectedReasons.length)
    .map(row => currentSessionVenue(row, now, state))
    .filter((venue): venue is DiscoverCandidate => Boolean(venue))
    .filter(venue => explorationGroupMatch(venue, input.groupId));
  const pool = buildDateCandidatePool(candidates, state, undefined,
    venue => isDateCourseCandidate(venue, state.requiredPlaces)
      || input.groupId === "shopping" && venue.externalSource === "kakao"
        && Boolean(venue.externalPlaceId) && venue.coordinates.every(Number.isFinite)
        && !looksLikeNonVenue(venue) && explorationGroupMatch(venue, "shopping"));
  const group = groupExplorationCandidates({ plan: input.researchPlan,
    preferences: { ...input.preferences, activities: [input.groupId] },
    candidates: pool.eligible, records: pool.records, session: marked,
    candidateIdsByGroup: { [input.groupId]: pool.eligible.map(dateCandidateKey) } })[0];
  const card = group?.cards[0] ?? null;
  const updated = card ? markExplorationCandidates(marked, { shownIds: [card.candidateId],
    selectedIds, rejectedIds, turnId: `${session.sessionId}:replacement:${randomUUID()}`,
    observedAt: now }) : marked;
  return { card, sessionCandidates: sealSessionCandidates(updated) };
}

export async function exploreCandidateGroups(input: {
  message: string; state: AIPlannerState; preferences: CandidateExplorationPreferences;
  planningSessionId: string; sessionCandidates?: SessionCandidateContext | null;
  experiencePlan?: ExperiencePlan | null; researchPlan?: ResearchPlan | null;
  groupId?: ExplorationActivity; groupIds?: ExplorationActivity[]; refinement?: string;
  selectedIds?: string[]; rejectedIds?: string[];
}) {
  const startedAt = performance.now();
  const limitedProviderCall = requestLimiter(6);
  let providerCalls = 0;
  if (candidateExplorationMode() !== "active") return { error: "candidate_exploration_disabled" } as const;
  if (!sessionCandidateSigningReady()) return { error: "candidate_session_unavailable" } as const;
  if (!validExplorationPreferences(input.preferences) || !input.preferences.activities.length)
    return { error: "choose_activity" } as const;
  const area = selectedAreas(input.state)[0];
  if (!area) return { error: "missing_area" } as const;
  const groupIds = input.groupId ? [input.groupId] : input.groupIds ?? input.preferences.activities;
  if (!groupIds.length || new Set(groupIds).size !== groupIds.length
    || groupIds.some(id => !input.preferences.activities.includes(id))) return { error: "invalid_group" } as const;
  const shoppingGeocodeNeeded = groupIds.includes("shopping") && !isBroadExplorationArea(area);
  const providerBudgetPerGroup = Math.floor((MAX_EXPLORATION_PROVIDER_CALLS - Number(shoppingGeocodeNeeded))
    / input.preferences.activities.length);
  const shoppingLocationPromise = shoppingGeocodeNeeded
    ? limitedProviderCall(() => { providerCalls++; return geocodeKakaoAddressRemote(area); })
      .catch(() => null) : Promise.resolve(null);
  const savedPromise = listPlaces().then(result => result.places).catch(() => []);
  const sessionId = /^[0-9a-f-]{36}$/i.test(input.planningSessionId)
    ? input.planningSessionId : randomUUID();
  const now = new Date().toISOString();
  const previous = verifiedSessionCandidates(input.sessionCandidates, sessionId);
  const session = previous ? markExplorationCandidates(previous, {
    selectedIds: input.selectedIds, rejectedIds: input.rejectedIds,
    turnId: `${sessionId}:choices:${randomUUID()}`, observedAt: now,
  }) : emptySessionCandidates(sessionId);
  const state = explorationStateForActivities({ ...input.state,
    ...explicitDateConstraints(input.message, input.state),
    excludedFoods: [...new Set([...(input.state.excludedFoods ?? []), ...explicitFoodExclusions(input.message)])],
  }, input.preferences);
  const message = explorationPrompt(input.message, input.preferences);
  const context = buildDateContext({ state, observedAt: now, sessionCandidates: session });
  const suppliedPlan = input.experiencePlan && Array.isArray(input.experiencePlan.days) ? input.experiencePlan : null;
  const suppliedResearch = input.researchPlan && validateResearchPlan(input.researchPlan)
    ? input.researchPlan : null;
  const experienceStartedAt = performance.now();
  const observed = suppliedPlan || suppliedResearch || input.groupId ? null
    : await observeExperiencePlan({ message, state, context, explorationEnabled: true });
  const experienceMs = Math.round(performance.now() - experienceStartedAt);
  const experiencePlan = suppliedPlan ?? observed?.plan ?? null;
  let researchPlan = suppliedResearch ?? explorationResearchPlan(
    experiencePlan ? (await import("./researchPlan")).tryBuildResearchPlan(experiencePlan) : null,
    input.preferences, area);
  if (input.groupId && input.refinement?.trim())
    researchPlan = refineExplorationNeed(researchPlan, input.groupId, input.refinement.slice(0, 160));
  if (!validateResearchPlan(researchPlan) || groupIds.some(id => !researchPlan.needs.some(need =>
    need.id === `explore-${id}` && need.kind === "venue")))
    return { error: "invalid_research_plan" } as const;
  const activeNeeds = researchPlan.needs.filter(need => groupIds.some(id => need.id === `explore-${id}`
    || need.id === `explore-${id}-evidence`));
  const evidenceGroupCount = input.preferences.activities.filter(id => researchPlan.needs.some(need =>
    need.id === `explore-${id}-evidence` && need.evidenceNeeded.length > 0)).length;
  const evidenceLimitPerGroup = Math.min(4, Math.max(1,
    Math.floor(MAX_EXPLORATION_EVIDENCE_TARGETS / Math.max(1, evidenceGroupCount))));
  const shoppingLocation = await shoppingLocationPromise;
  // A city is often entered without its "시" suffix. Geocoding reveals its
  // administrative scope so a citywide request is not cut to a small radius.
  const citywideShopping = isBroadExplorationArea(area)
    || isBroadExplorationArea(shoppingLocation?.address ?? "");
  const shoppingCenter = citywideShopping ? null : shoppingLocation?.coordinates ?? null;
  const saved = await savedPromise;
  const work = await Promise.all(groupIds.map(async groupId => {
    const groupStartedAt = performance.now();
    const need = activeNeeds.find(item => item.id === `explore-${groupId}`)!;
    const alreadyPresented = new Set([...(session.shownCandidateIds ?? []),
      ...(session.selectedCandidateIds ?? []), ...(session.rejectedCandidateIds ?? []),
      ...(input.selectedIds ?? []), ...(input.rejectedIds ?? [])]);
    const reusable = session.records.filter(row => row.currentState === "eligible" && !row.shownCount
      && !row.rejectedReasons.length)
      .map(row => currentSessionVenue(row, now, state)).filter((venue): venue is DiscoverCandidate => Boolean(venue));
    const candidates = new Map(reusable.filter(venue => explorationGroupMatch(venue, groupId))
      .map(venue => [dateCandidateKey(venue), venue]));
    const retrieval = new Map<string, { queries: Set<string>; primaryRank?: number; bestRank: number }>();
    const recordRetrieval = (venue: DiscoverCandidate, query: string, primary: boolean, rank: number) => {
      const id = dateCandidateKey(venue);
      const signal = retrieval.get(id) ?? { queries: new Set<string>(), bestRank: Number.MAX_SAFE_INTEGER };
      signal.queries.add(query);
      signal.bestRank = Math.min(signal.bestRank, rank);
      if (primary) signal.primaryRank = Math.min(signal.primaryRank ?? Number.MAX_SAFE_INTEGER, rank);
      retrieval.set(id, signal);
    };
    for (const place of saved) {
      if (!`${place.district} ${place.address ?? ""}`.includes(area)) continue;
      const venue = placeToCandidate(place);
      if (venue && explorationGroupMatch(venue, groupId) && !alreadyPresented.has(dateCandidateKey(venue))) candidates.set(dateCandidateKey(venue), { ...venue,
        // Persisted operational details have no session freshness guarantee.
        openingHours: undefined, expectedCostTwo: undefined });
    }
    let searched = false;
    // Search only this need when its current, unseen inventory is insufficient.
    if ([...candidates.keys()].filter(id => !alreadyPresented.has(id)).length < 8) {
      searched = true;
      const intents = researchSearchIntents({ needs: [need], unresolved: [], source: researchPlan.source }, area);
      const tourEligible = isTourApiConfigured() && ["tourist", "nature", "photo"].includes(need.category ?? "");
      const tourBudget = tourEligible ? Math.min(2, Math.max(0, providerBudgetPerGroup - 3)) : 0;
      const kakaoBudget = providerBudgetPerGroup - tourBudget;
      const searches = intents.flatMap(intent => {
        const queries = explorationSearchQueries(groupId, intent.query,
          groupId === "shopping" && citywideShopping ? undefined : area);
        return [...queries.map((query, index) => ({ intent, query, primary: index === 0, page: 1 })),
          ...(queries[0] ? [{ intent, query: queries[0], primary: true, page: 2 }] : [])];
      }).slice(0, kakaoBudget);
      const responses = await Promise.all(searches.map(async search => ({ search,
        response: await limitedProviderCall(() => {
          providerCalls++;
          return searchKakaoPlacesRemote({
          region: search.intent.region, query: search.query,
          category: ["shopping", "nightview", "beach", "nature"].includes(groupId)
            ? undefined : providerCategoryForResearchIntent(search.intent),
          includeShopping: groupId === "shopping", page: search.page,
          });
        }).catch(() => null),
      })));
      for (const { search, response } of responses) if (response?.ok)
        for (const [index, venue] of response.places.entries())
          if (explorationGroupMatch(venue, groupId, true)) {
            candidates.set(dateCandidateKey(venue), venue);
            recordRetrieval(venue, `${search.intent.region}:${search.query}`,
              search.primary, (search.page - 1) * 15 + index);
          }
      if (tourBudget && [...candidates.keys()].filter(id => !alreadyPresented.has(id)).length < 8) {
        const tour = await Promise.all(intents.slice(0, tourBudget).map(intent => limitedProviderCall(() => {
          providerCalls++;
          return searchTourPlacesRemote({
          region: intent.region, query: intent.query, category: intent.category, page: 1,
          });
        }).catch(() => null)));
        for (const [intentIndex, response] of tour.entries()) if (response?.ok)
          for (const [index, venue] of response.places.entries())
            if (explorationGroupMatch(venue, groupId, true)) {
              candidates.set(dateCandidateKey(venue), venue);
              recordRetrieval(venue, `tour:${intents[intentIndex].region}:${intents[intentIndex].query}`,
                true, index);
            }
      }
    }
    const fresh = [...candidates.values()];
    // Choose a small evidence shortlist from several search variants before
    // quality facts can affect final ranking.
    const evidenceShortlist = [...fresh].sort((a, b) => {
      const left = retrieval.get(dateCandidateKey(a));
      const right = retrieval.get(dateCandidateKey(b));
      return (right?.queries.size ?? 0) - (left?.queries.size ?? 0)
        || (left?.primaryRank ?? Number.MAX_SAFE_INTEGER) - (right?.primaryRank ?? Number.MAX_SAFE_INTEGER)
        || (left?.bestRank ?? Number.MAX_SAFE_INTEGER) - (right?.bestRank ?? Number.MAX_SAFE_INTEGER);
    }).slice(0, 12);
    const enriched = await enrichResearchNeedEvidence(evidenceShortlist, state,
      activeNeeds.filter(item => item.id === `${need.id}-evidence`), evidenceLimitPerGroup)
      .catch(() => evidenceShortlist);
    const byId = new Map(enriched.map(venue => [dateCandidateKey(venue), venue]));
    const checked = fresh.map(venue => byId.get(dateCandidateKey(venue)) ?? venue);
    const pool = buildDateCandidatePool(checked, state, undefined,
      venue => isDateCourseCandidate(venue, state.requiredPlaces)
        || groupId === "shopping" && venue.externalSource === "kakao"
          && Boolean(venue.externalPlaceId) && venue.coordinates.every(Number.isFinite)
          && !looksLikeNonVenue(venue)
          && explorationGroupMatch(venue, "shopping"));
    const retrievalSignals: Record<string, ExplorationRetrievalSignal> = Object.fromEntries(
      [...retrieval].map(([id, signal]) => [id, { matchedQueries: signal.queries.size,
        primaryRank: signal.primaryRank, bestRank: signal.bestRank }]));
    return { groupId, records: pool.records, eligible: pool.eligible, searched, retrievalSignals,
      elapsedMs: Math.round(performance.now() - groupStartedAt) };
  }));
  const allRecords = work.flatMap(item => item.records);
  const eligible = [...new Map(work.flatMap(item => item.eligible).map(venue =>
    [dateCandidateKey(venue), venue])).values()];
  const grouped = groupExplorationCandidates({ plan: researchPlan, preferences: input.preferences,
    candidates: eligible, session, rejectedIds: input.rejectedIds, records: allRecords,
    searchCenter: shoppingCenter,
    candidateIdsByGroup: Object.fromEntries(work.map(item => [item.groupId,
      item.eligible.map(dateCandidateKey)])),
    retrievalSignalsByGroup: Object.fromEntries(work.map(item => [item.groupId,
      item.retrievalSignals])) });
  const groups = grouped.filter(group => groupIds.includes(group.id));
  const shownIds = groups.flatMap(group => group.cards.map(card => card.candidateId));
  const merged = mergeSessionCandidates(session, allRecords, {
    sessionId, observedAt: now, turnId: `${sessionId}:${session.turnCount + 1}`,
  });
  const resultSession = markExplorationCandidates(merged, { shownIds,
    selectedIds: input.selectedIds, rejectedIds: input.rejectedIds,
    turnId: `${sessionId}:shown:${merged.turnCount}`, observedAt: now });
  console.info("candidate_exploration_search", JSON.stringify({
    groups: groupIds, providerCalls, searchedGroups: work.filter(item => item.searched).length,
    shown: shownIds.length, experienceMs, evidenceLimitPerGroup,
    groupMs: Object.fromEntries(work.map(item => [item.groupId, item.elapsedMs])),
    elapsedMs: Math.round(performance.now() - startedAt),
  }));
  return { experiencePlan, researchPlan, groups, sessionCandidates: sealSessionCandidates(resultSession),
    searchedGroups: work.filter(item => item.searched).map(item => item.groupId) };
}

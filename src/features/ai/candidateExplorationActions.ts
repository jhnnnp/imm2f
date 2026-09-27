"use server";

import { randomUUID } from "node:crypto";
import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { interpretDateRequest } from "@/lib/openai/interpretDateRequest";
import { searchKakaoPlacesRemote } from "@/lib/kakao/local";
import { searchTourPlacesRemote } from "@/lib/tourapi/client";
import { listPlaces } from "@/features/places/actions";
import { placeToCandidate } from "@/features/places/discover";
import { isTourApiConfigured } from "@/lib/tourapi/env";
import { observeExperiencePlan } from "@/lib/openai/experiencePlan";
import { enrichResearchNeedEvidence } from "@/lib/openai/enrichDateVenues";
import { applyDateDefaults, extractStay, selectedAreas } from "./dateBrief";
import { explicitDateConstraints } from "./dateConstraints";
import { explicitFoodExclusions } from "./dateIntent";
import { buildDateContext } from "./dateContext";
import { buildDateCandidatePool } from "./dateCandidatePool";
import { dateCandidateKey } from "./dateCourse";
import { currentSessionVenue } from "./datePlaceRecommendationExecution";
import { isDateCourseCandidate } from "@/lib/kakao/dateCandidate";
import { groupExplorationCandidates, initialExplorationPreferences,
  explorationPrompt, explorationResearchPlan, explorationStateForActivities,
  refineExplorationNeed, validExplorationPreferences,
  type CandidateExplorationPreferences, type ExplorationActivity } from "./candidateExploration";
import { providerCategoryForResearchIntent, researchSearchIntents,
  validateResearchPlan, type ResearchPlan } from "./researchPlan";
import { emptySessionCandidates, markExplorationCandidates, mergeSessionCandidates,
  sealSessionCandidates, verifiedSessionCandidates, type SessionCandidateContext } from "./sessionCandidates";
import type { ExperiencePlan } from "./experiencePlan";
import { candidateExplorationMode } from "./candidateExplorationMode";

export async function prepareCandidateExploration(input: { message: string; previousState?: AIPlannerState }) {
  if (candidateExplorationMode() !== "active") return { error: "candidate_exploration_disabled" } as const;
  const message = input.message.trim().slice(0, 800);
  if (!message) return { error: "empty_request" } as const;
  const interpreted = await interpretDateRequest({ message, previousState: input.previousState,
    previousPlaceNames: [] });
  const state = applyDateDefaults({ ...interpreted.state, ...extractStay(message),
    userRequests: [...(interpreted.state.userRequests ?? []), message].slice(-8) });
  return { state, preferences: initialExplorationPreferences(message, state),
    needsArea: selectedAreas(state).length === 0 };
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

export async function exploreCandidateGroups(input: {
  message: string; state: AIPlannerState; preferences: CandidateExplorationPreferences;
  planningSessionId: string; sessionCandidates?: SessionCandidateContext | null;
  experiencePlan?: ExperiencePlan | null; researchPlan?: ResearchPlan | null;
  groupId?: ExplorationActivity; refinement?: string;
  selectedIds?: string[]; rejectedIds?: string[];
}) {
  if (candidateExplorationMode() !== "active") return { error: "candidate_exploration_disabled" } as const;
  if (!validExplorationPreferences(input.preferences) || !input.preferences.activities.length)
    return { error: "choose_activity" } as const;
  const area = selectedAreas(input.state)[0];
  if (!area) return { error: "missing_area" } as const;
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
  const observed = suppliedPlan || input.groupId ? null
    : await observeExperiencePlan({ message, state, context, explorationEnabled: true });
  const experiencePlan = suppliedPlan ?? observed?.plan ?? null;
  const suppliedResearch = input.researchPlan && validateResearchPlan(input.researchPlan)
    ? input.researchPlan : null;
  let researchPlan = suppliedResearch ?? explorationResearchPlan(
    experiencePlan ? (await import("./researchPlan")).tryBuildResearchPlan(experiencePlan) : null,
    input.preferences, area);
  if (input.groupId && input.refinement?.trim())
    researchPlan = refineExplorationNeed(researchPlan, input.groupId, input.refinement.slice(0, 160));
  if (!validateResearchPlan(researchPlan)) return { error: "invalid_research_plan" } as const;
  const groupIds = input.groupId ? [input.groupId] : input.preferences.activities;
  if (groupIds.some(id => !input.preferences.activities.includes(id))) return { error: "invalid_group" } as const;
  const activeNeeds = researchPlan.needs.filter(need => groupIds.some(id => need.id === `explore-${id}`
    || need.id === `explore-${id}-evidence`));
  const saved = await listPlaces().then(result => result.places).catch(() => []);
  const work = await Promise.all(groupIds.map(async groupId => {
    const need = activeNeeds.find(item => item.id === `explore-${groupId}`)!;
    const alreadyPresented = new Set([...(session.shownCandidateIds ?? []),
      ...(session.selectedCandidateIds ?? []), ...(session.rejectedCandidateIds ?? []),
      ...(input.selectedIds ?? []), ...(input.rejectedIds ?? [])]);
    const reusable = session.records.filter(row => row.currentState === "eligible" && !row.shownCount
      && !row.rejectedReasons.length && row.category === need.category)
      .map(row => currentSessionVenue(row, now, state)).filter((venue): venue is DiscoverCandidate => Boolean(venue));
    const candidates = new Map(reusable.map(venue => [dateCandidateKey(venue), venue]));
    for (const place of saved) {
      if (place.category !== need.category || !`${place.district} ${place.address ?? ""}`.includes(area)) continue;
      const venue = placeToCandidate(place);
      if (venue && !alreadyPresented.has(dateCandidateKey(venue))) candidates.set(dateCandidateKey(venue), { ...venue,
        // Persisted operational details have no session freshness guarantee.
        openingHours: undefined, expectedCostTwo: undefined });
    }
    let searched = false;
    // Search only this need when its current, unseen inventory is insufficient.
    if ([...candidates.keys()].filter(id => !alreadyPresented.has(id)).length < 8) {
      searched = true;
      const intents = researchSearchIntents({ needs: [need], unresolved: [], source: researchPlan.source }, area);
      const responses = await Promise.all(intents.flatMap(intent => [1, 2].map(page =>
        searchKakaoPlacesRemote({ region: intent.region, query: intent.query,
          category: providerCategoryForResearchIntent(intent), page }).catch(() => null))));
      for (const response of responses) if (response?.ok) for (const venue of response.places)
        candidates.set(dateCandidateKey(venue), venue);
      if (isTourApiConfigured() && ["tourist", "nature", "photo"].includes(need.category ?? "")) {
        const tour = await Promise.all(intents.slice(0, 2).map(intent => searchTourPlacesRemote({
          region: intent.region, query: intent.query, category: intent.category, page: 1,
        }).catch(() => null)));
        for (const response of tour) if (response?.ok) for (const venue of response.places)
          candidates.set(dateCandidateKey(venue), venue);
      }
    }
    const fresh = [...candidates.values()];
    const enriched = await enrichResearchNeedEvidence(fresh.slice(0, 24), state,
      activeNeeds.filter(item => item.id === `${need.id}-evidence`)).catch(() => fresh.slice(0, 24));
    const byId = new Map(enriched.map(venue => [dateCandidateKey(venue), venue]));
    const checked = fresh.map(venue => byId.get(dateCandidateKey(venue)) ?? venue);
    const pool = buildDateCandidatePool(checked, state, undefined,
      venue => isDateCourseCandidate(venue, state.requiredPlaces));
    return { groupId, records: pool.records, eligible: pool.eligible, searched };
  }));
  const allRecords = work.flatMap(item => item.records);
  const eligible = [...new Map(work.flatMap(item => item.eligible).map(venue =>
    [dateCandidateKey(venue), venue])).values()];
  const grouped = groupExplorationCandidates({ plan: researchPlan, preferences: input.preferences,
    candidates: eligible, session, rejectedIds: input.rejectedIds, records: allRecords });
  const groups = grouped.filter(group => groupIds.includes(group.id));
  const shownIds = groups.flatMap(group => group.cards.map(card => card.candidateId));
  const merged = mergeSessionCandidates(session, allRecords, {
    sessionId, observedAt: now, turnId: `${sessionId}:${session.turnCount + 1}`,
  });
  const resultSession = markExplorationCandidates(merged, { shownIds,
    selectedIds: input.selectedIds, rejectedIds: input.rejectedIds,
    turnId: `${sessionId}:shown:${merged.turnCount}`, observedAt: now });
  return { experiencePlan, researchPlan, groups, sessionCandidates: sealSessionCandidates(resultSession),
    searchedGroups: work.filter(item => item.searched).map(item => item.groupId) };
}

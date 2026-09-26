"use server";

import { createHash, randomUUID } from "node:crypto";
import { getAppSession } from "@/features/auth/session";
import { listPlaces } from "@/features/places/actions";
import { analyzePreferencesWithOpenAi, type PreferenceInsight } from "@/lib/openai/analyzePreferences";
import { getOpenAiModel } from "@/lib/openai/env";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { proposePlanEditsWithOpenAi } from "@/lib/openai/editPlan";
import { generatePlanOptionsWithOpenAi } from "@/lib/openai/generatePlan";
import { recommendDatePlanWithOpenAi } from "@/lib/openai/recommendDatePlan";
import { semanticPlanningHintsForContext, hasSemanticPlanningHints } from "./semanticPlanningHints";
import { orchestrateDateTurn, prepareDateExecutionPlan } from "./dateOrchestrator";
import type { observeDateExecutionPlan } from "./dateExecutionPlan";
import { getDateExecutionMode } from "./dateVenueInspection";
import { legacyPlacesReuseEnabled, sessionPlaceRecommendationInputs } from "./datePlaceRecommendationExecution";
import { mergeSessionFeedback, placeSessionFeedbackSignals,
  type PlaceSessionFeedbackSignal, type SessionFeedbackEntry } from "./sessionFeedback";
import { interpretDateRequest } from "@/lib/openai/interpretDateRequest";
import { getDateTurnInterpreterMode, runDateTurnShadow, type DateTurnShadowResult } from "@/lib/openai/dateTurnShadowRunner";
import { loadTasteBoard } from "@/features/taste/actions";
import { applyTasteFallback, applyTasteHarshAllow, seedFromProfile, violatesTasteAvoid } from "@/features/taste/compare";
import { applyRanking } from "@/lib/openai/rank";
import { searchKakaoPlacesRemote } from "@/lib/kakao/local";
import { searchTourPlacesRemote } from "@/lib/tourapi/client";
import { isTourApiConfigured } from "@/lib/tourapi/env";
import { festivalPeriodCoversYmd } from "@/lib/tourapi/festivalSchedule";
import { attachKopisPerformances } from "@/lib/kopis/client";
import { isDateCourseCandidate } from "@/lib/kakao/dateCandidate";
import { distanceMeters } from "@/features/places/geo";
import { placeToCandidate } from "@/features/places/discover";
import { listArchivedDatePlans } from "@/features/planning/actions";
import {
  areaScopeMeters,
  assumedTimeWindow,
  applyDateDefaults,
  expandedSearchRegions,
  matchesActivity,
  matchesTerm,
  missingSlot,
  nearbyAreaSuggestions,
  emptyDateBrief,
  withAreas,
  courseSize,
  tripDayYmd,
  activitySearchIntents,
  searchIntents,
  type DateSearchIntent,
  selectedAreas,
  slotQuestion,
  uniqueStrings,
  isTravelPlan,
  dateSpine,
  discoveryActivities,
  rescueSearchQueries,
  missingWantedSlots,
  fitsWantedActivities,
  isExclusiveCrawl,
  extractAreasFromText,
} from "@/features/ai/dateBrief";
import { allowsHarshDateMeal, applyCourseDelta, bothWantNames, candidateActivitySlot, dateCandidateKey, isOffDateVenue, preferredSavedNames, recentPlaceNames, toDateRanking } from "@/features/ai/dateCourse";
import { chatSituationFromMessage, composeDateChat, dateChatCard, cardToText } from "@/lib/openai/composeDateChat";
import { hydrateDateCandidates } from "@/lib/places/detailCache";
import { routeDateChat } from "@/lib/openai/routeDateChat";
import { editCurrentCourse } from "./editCurrentCourse";
import { designDateDiscovery } from "@/lib/openai/designDateDiscovery";
import { readVenueEvidence } from "@/lib/openai/venueEvidenceStore";
import { candidateFoodConflict, toDateIntent } from "@/features/ai/dateIntent";
import { runDateTaskPlanner } from "@/lib/openai/dateTaskPlanner";
import { planNextDateResearch, dateResearchCallKey } from "@/lib/openai/dateResearchAgent";
import { runDateAgentCourse } from "@/lib/openai/dateAgentOrchestrator";
import { applyDateMemory, collectDateMemory } from "@/features/ai/dateMemory";
import { discoveryCatalog } from "./courseDesign";
import { buildDateCandidatePool, type DateCandidateRecord } from "./dateCandidatePool";
import { buildDateContext, type DateContext } from "./dateContext";
import { mergeSessionCandidates, sealSessionCandidates, sessionShownPlaces,
  verifiedSessionCandidates, type SessionCandidateContext } from "./sessionCandidates";
import { candidateSessionObservation } from "./dateObservation";
import { buildDateTurnUnderstanding } from "./dateTurnUnderstanding";
import { tripLocalWindows, unsupportedCourseRequest } from "./planningSupport";
import { courseMutationProblems } from "./courseMutation";
import type { ChatRoute } from "./chatRoute";
import { recommendPlacesWithOpenAi } from "@/lib/openai/recommendPlaces";
import { discoverVenueLeads, leadMatchesCandidate } from "@/lib/openai/discoverVenueLeads";
import { answerDateQuestion, type QuestionContextStop } from "@/lib/openai/answerDateQuestion";
import { PLACE_KIND_LABEL, isMoreRequest } from "@/features/ai/chatRoute";
import {
  PLACE_PICK_MIN,
  filterPlaceCandidates,
  matchesPlaceKind,
  placeAskHarshAllow,
  placeSearchPlans,
  rankPlaceCandidates,
} from "@/features/ai/placeRecommend";
import type { AIChatCard, AIChatStop, AIPlannerClarification, AIPlannerResult, AIPlannerState, DateChatTurn, DateIntakeSlot, DatePreviousStop, PlaceAsk, PlanChange, PlanItem, PlanKind, PlanOption } from "@/features/planning/types/plan";
import type { DiscoverCandidate, Place } from "@/features/places/types/place";

const INSIGHT_VERSION = "couple-taste-v2";

function analysisPlaces(places: Place[]) {
  return places.map(place => ({
    name: place.name,
    categoryLabel: place.categoryLabel,
    district: place.district,
    durationMinutes: place.durationMinutes,
    userStatus: place.userStatus,
    partnerStatus: place.partnerStatus,
    userRated: place.userRated,
    partnerRated: place.partnerRated,
  }));
}

function analysisInputHash(places: Place[], userId: string, partnerUserId: string | null) {
  const members = [userId, partnerUserId].filter((value): value is string => Boolean(value)).sort();
  const canonical = places.map(place => {
    const byUser = new Map([
      [userId, { rated: Boolean(place.userRated), status: place.userStatus }],
      ...(partnerUserId ? [[partnerUserId, { rated: Boolean(place.partnerRated), status: place.partnerStatus }] as const] : []),
    ]);
    return {
      id: place.id,
      name: place.name,
      category: place.categoryLabel,
      district: place.district,
      durationMinutes: place.durationMinutes,
      preferences: members.map(id => ({ id, ...(byUser.get(id) ?? { rated: false, status: "unrated" }) })),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify({ version: INSIGHT_VERSION, places: canonical })).digest("hex");
}

function forViewer(insight: PreferenceInsight, viewerUserId: string) {
  if (!insight.perspectiveUserId || insight.perspectiveUserId === viewerUserId) return insight;
  return {
    ...insight,
    perspectiveUserId: viewerUserId,
    youHighlights: insight.partnerHighlights,
    partnerHighlights: insight.youHighlights,
    differences: insight.differences.map(item => ({ ...item, you: item.partner, partner: item.you })),
  };
}

function isPreferenceInsight(value: unknown): value is PreferenceInsight {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PreferenceInsight>;
  return typeof item.summary === "string"
    && typeof item.matchScore === "number"
    && typeof item.confidence === "number"
    && Array.isArray(item.youHighlights)
    && Array.isArray(item.partnerHighlights)
    && Array.isArray(item.commonTastes)
    && Array.isArray(item.differences)
    && Array.isArray(item.recommendations)
    && Boolean(item.evidence);
}

export async function loadLatestCoupleInsight(): Promise<PreferenceInsight | null> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return null;
  const { places } = await listPlaces();
  const supabase = await createClient();
  if (!supabase) return null;
  const inputHash = analysisInputHash(places, session.userId, session.partner?.userId ?? null);
  const { data, error } = await supabase
    .from("couple_insights")
    .select("input_hash, analysis_version, result")
    .eq("couple_id", session.coupleId)
    .eq("input_hash", inputHash)
    .eq("analysis_version", INSIGHT_VERSION)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!error && data && isPreferenceInsight(data.result)) return forViewer(data.result, session.userId);

  // Deployments created before couple_insights existed can still persist a
  // shared analysis in the already-deployed activity JSON column.
  const fallback = await supabase
    .from("activities")
    .select("after_value")
    .eq("couple_id", session.coupleId)
    .eq("entity_type", "couple_insight")
    .eq("entity_id", inputHash)
    .eq("action", "INSIGHT_GENERATED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const payload = fallback.data?.after_value;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const stored = "result" in payload ? payload.result : null;
  if (!isPreferenceInsight(stored)) return null;
  return forViewer(stored, session.userId);
}

export async function proposePlanEdits(input: {
  kind: PlanKind;
  prompt: string;
  items: PlanItem[];
}): Promise<{ changes: PlanChange[]; summary: string } | { error: string }> {
  return proposePlanEditsWithOpenAi({
    kind: input.kind,
    prompt: input.prompt,
    items: input.items.map(item => ({
      id: item.id,
      placeName: item.placeName,
      category: item.category,
      startTime: item.startTime,
      durationMinutes: item.durationMinutes,
      expectedCost: item.expectedCost,
    })),
  });
}

export async function generatePlanOptions(input: {
  kind: PlanKind;
  prompt: string;
  places?: Place[];
}): Promise<{ options: PlanOption[]; note: string } | { error: string }> {
  const places = input.places ?? (await listPlaces()).places;
  const usable = places.filter(place => !["dislike", "not_interested"].includes(place.userStatus));
  return generatePlanOptionsWithOpenAi({
    kind: input.kind,
    prompt: input.prompt,
    places: usable.map(place => ({
      id: place.id,
      name: place.name,
      categoryLabel: place.categoryLabel,
      district: place.district,
      durationMinutes: place.durationMinutes,
      expectedCostTwo: place.expectedCostTwo,
      userStatus: place.userStatus,
      partnerStatus: place.partnerStatus,
    })),
  });
}

export async function analyzeCouplePreferences(): Promise<PreferenceInsight | { error: string }> {
  const session = await getAppSession();
  const { places } = await listPlaces();
  const youName = session.mode === "authenticated" ? session.displayName : "나";
  const partnerName = session.mode === "authenticated"
    ? session.partner?.displayName ?? "파트너"
    : "파트너";

  const result = await analyzePreferencesWithOpenAi({
    youName,
    partnerName,
    places: analysisPlaces(places),
  });
  if ("error" in result || session.mode !== "authenticated") return result;

  const persisted = { ...result, perspectiveUserId: session.userId };
  const supabase = await createClient();
  if (supabase) {
    const inputHash = analysisInputHash(places, session.userId, session.partner?.userId ?? null);
    const { error } = await supabase.from("couple_insights").insert({
      couple_id: session.coupleId,
      input_hash: inputHash,
      analysis_version: INSIGHT_VERSION,
      model: getOpenAiModel(),
      result: persisted as unknown as Json,
      created_by: session.userId,
    });
    if (error) {
      const fallback = await supabase.from("activities").insert({
        couple_id: session.coupleId,
        actor_user_id: session.userId,
        entity_type: "couple_insight",
        entity_id: inputHash,
        action: "INSIGHT_GENERATED",
        title: "우리의 취향을 분석했어요",
        detail: `장소 ${result.sourceCount}곳의 응답을 함께 분석했어요`,
        after_value: {
          analysisVersion: INSIGHT_VERSION,
          inputHash,
          result: persisted,
        } as unknown as Json,
      });
      if (fallback.error) console.error("Failed to persist couple insight fallback", fallback.error);
    }
  }
  return persisted;
}

function presentCandidateName(name: string, requiredPlaces: string[]) {
  const park = requiredPlaces.find(place => place.endsWith("공원") && name.replace(/\s/g, "").includes(place.replace(/\s/g, "")));
  if (!park || !name.includes("진출입로")) return name;
  const access = name.match(/(옥수|금호)[가-힣]*(?:나들목|경사로)/)?.[0];
  return access ? `${park} ${access}` : park;
}

function clarificationReply(slot: DateIntakeSlot, state: AIPlannerState, card: AIChatCard): AIPlannerClarification {
  const question = slotQuestion(slot, state);
  return {
    status: "clarification",
    message: cardToText(card),
    card: { ...card, suggestions: card.suggestions ?? question.options.slice(0, 4) },
    state: { ...state, pendingSlot: slot },
    options: question.options,
    multiple: slot === "area" ? false : question.multiple,
    slot,
  };
}

type CoupleTasteBrief = { summary: string; commonTastes: string[]; avoidFoods: string[] };

const MAX_CONVERSATION_NOTES = 12;
const MAX_SHOWN_PLACES = 12;
const PLACE_SEARCH_RADIUS_METERS = 1500;
const PLACE_RESULTS_PER_SEARCH = 15;

function noteTurn(state: AIPlannerState, message: string): AIPlannerState {
  if (!message) return state;
  return { ...state, conversationNotes: [...state.conversationNotes, message].slice(-MAX_CONVERSATION_NOTES),
    userRequests: [...(state.userRequests ?? []), message].slice(-MAX_CONVERSATION_NOTES) };
}

function chatResult(card: AIChatCard, state: AIPlannerState): AIPlannerResult {
  // No `slot` here on purpose: these suggestions are full user messages, not
  // slot values, so the client must send them back as chat turns.
  return {
    status: "chat",
    message: cardToText(card),
    card,
    state,
    options: card.suggestions,
    multiple: false,
  };
}

function toQuestionStops(stops: AIChatStop[] | undefined, fallback: DatePreviousStop[]): QuestionContextStop[] {
  if (stops?.length) return stops.map(stop => ({
    name: stop.name,
    meta: stop.meta,
    address: stop.address,
    phone: stop.phone,
    mapUrl: stop.mapUrl,
    startTime: stop.startTime,
    durationMinutes: stop.durationMinutes,
    distanceFromPreviousMeters: stop.distanceFromPreviousMeters,
    rating: stop.rating,
    ratingCount: stop.ratingCount,
    dishes: stop.dishes,
    openingHours: stop.openingHours,
    factSourceUrl: stop.factSourceUrl,
    reason: stop.reason,
  }));
  return fallback.map(stop => ({ name: stop.name, meta: stop.category }));
}

function coupleTasteBrief(
  tasteBoard: Awaited<ReturnType<typeof loadTasteBoard>>,
  insight: PreferenceInsight | null,
  avoidFoods: string[],
): CoupleTasteBrief {
  return {
    summary: tasteBoard.compare?.summary ?? insight?.summary ?? "",
    commonTastes: uniqueStrings([
      ...(tasteBoard.compare?.overlaps ?? []),
      ...(insight?.commonTastes ?? []).map(item => item.label),
    ], 8),
    avoidFoods,
  };
}

/**
 * Standalone place recommendation ("성수 파스타 맛집 추천해줘"). Searches Kakao
 * around the area, filters to date-worthy venues of the asked kind, lets the
 * model pick and describe a handful with looked-up facts, and returns them
 * as a chat card the user can tap, extend, or turn into a course.
 */
async function recommendPlacesForChat(input: {
  message: string;
  ask: PlaceAsk;
  state: AIPlannerState;
  conversation?: DateChatTurn[];
  avoidFoods: string[];
  tasteBoard: Awaited<ReturnType<typeof loadTasteBoard>>;
  observeCandidates?: (records: DateCandidateRecord[]) => void;
  /** Supplementary execution may bring rechecked session candidates into the existing selector. */
  seedCandidates?: DiscoverCandidate[];
  skipSearch?: boolean;
  excludedCandidateIds?: string[];
  requireHardEligibility?: boolean;
  sessionFeedbackSignals?: PlaceSessionFeedbackSignal[];
}): Promise<AIPlannerResult> {
  const startedAt = performance.now();
  const area = input.ask.area || selectedAreas(input.state)[0] || "";
  const label = PLACE_KIND_LABEL[input.ask.kind];
  if (!area) {
    const question = slotQuestion("area", input.state);
    const card: AIChatCard = {
      headline: `어느 동네 ${label}을 찾아볼까요?`,
      lines: ["동네나 도시만 말해 주면 그 근처에서 골라 드릴게요."],
      suggestions: question.options.slice(0, 4),
    };
    return clarificationReply("area", { ...input.state, placeAsk: { ...input.ask, area: "" } }, card);
  }
  const ask: PlaceAsk = { ...input.ask, area };
  const continuing = Boolean(input.state.placeAsk && input.state.placeAsk.kind === ask.kind && input.state.placeAsk.area === area && isMoreRequest(input.message));
  const alreadyShown = continuing ? (input.state.seenPlaces ?? input.state.shownPlaces ?? []) : [];
  const requestedAreas = extractAreasFromText(input.message);
  const baseState = withAreas(noteTurn(input.state, input.message), requestedAreas.length
    ? requestedAreas : uniqueStrings([area, ...selectedAreas(input.state)], 3));

  const [{ places: saved }, insight, ...searches] = await Promise.all([
    listPlaces(), loadLatestCoupleInsight(),
    ...(input.skipSearch ? [] : [
      searchKakaoPlacesRemote({ query: area, page: 1 }),
      ...placeSearchPlans(ask).map(plan => searchKakaoPlacesRemote({
      region: plan.region,
      query: plan.query,
      category: plan.category,
      page: plan.page,
      })),
    ]),
  ]);
  const [anchorSearch, ...planSearches] = searches;
  const anchor = anchorSearch?.ok
    ? (anchorSearch.places.find(candidate => candidate.name.replace(/\s/g, "").includes(area.replace(/\s/g, ""))) ?? anchorSearch.places[0])
    : undefined;
  const initialDoneAt = performance.now();
  const allowHarsh = placeAskHarshAllow(input.message, ask, applyTasteHarshAllow(allowsHarshDateMeal(input.message), input.message, input.avoidFoods));
  const filterContext = {
    allowHarsh,
    exclude: uniqueStrings([...input.state.excludedPlaces,
      ...(input.excludedCandidateIds ? [] : alreadyShown)], 100),
    violatesAvoid: (blob: string) => violatesTasteAvoid(blob, input.avoidFoods),
  };
  const excludedIds = new Set(input.excludedCandidateIds ?? []);
  const nearbyInitial = anchor ? filterPlaceCandidates(
    planSearches.flatMap(result => result.ok ? result.places : [])
      .filter(candidate => isDateCourseCandidate(candidate, [])
        && distanceMeters(anchor.coordinates, candidate.coordinates) <= PLACE_SEARCH_RADIUS_METERS
        && !excludedIds.has(dateCandidateKey(candidate))),
    ask,
    filterContext,
  ).length : 0;
  const needGeoSearch = Boolean(anchor && (ask.kind === "restaurant" || ask.kind === "cafe") && nearbyInitial < PLACE_PICK_MIN * 3);
  const geoSearches = needGeoSearch && anchor
    ? await Promise.all([1, 2].map(page => searchKakaoPlacesRemote({
      category: ask.kind === "restaurant" ? "restaurant" : "cafe",
      query: ask.kind === "restaurant" && ask.query !== "맛집" ? ask.query : undefined,
      x: anchor.coordinates[0],
      y: anchor.coordinates[1],
      radius: PLACE_SEARCH_RADIUS_METERS,
      page,
    })))
    : [];
  const geoDoneAt = performance.now();

  const pool: DiscoverCandidate[] = [...(input.seedCandidates ?? [])];
  for (const result of [...planSearches, ...geoSearches]) {
    if (!result.ok) continue;
    for (const candidate of result.places.slice(0, PLACE_RESULTS_PER_SEARCH)) {
      if (!isDateCourseCandidate(candidate, [])) continue;
      pool.push({
        ...candidate,
        searchRegion: area,
        distanceMeters: anchor ? Math.round(distanceMeters(anchor.coordinates, candidate.coordinates)) : candidate.distanceMeters,
      });
    }
  }
  for (const place of input.skipSearch ? [] : saved) {
    if (["dislike", "not_interested"].includes(place.userStatus) || ["dislike", "not_interested"].includes(place.partnerStatus)) continue;
    const candidate = placeToCandidate(place);
    if (!candidate || !matchesPlaceKind(candidate, ask.kind)) continue;
    const meters = anchor ? distanceMeters(anchor.coordinates, candidate.coordinates) : null;
    if (meters != null && meters > PLACE_SEARCH_RADIUS_METERS * 2) continue;
    pool.push({ ...candidate, searchRegion: area, distanceMeters: meters == null ? undefined : Math.round(meters) });
  }

  const hardPool = input.requireHardEligibility
    ? buildDateCandidatePool(pool, baseState, undefined,
      candidate => isDateCourseCandidate(candidate, baseState.requiredPlaces)) : null;
  if (hardPool && input.observeCandidates) {
    try { input.observeCandidates(hardPool.records); }
    catch { /* Session observation is supplemental. */ }
  }
  const hardEligible = hardPool?.eligible ?? pool;
  const filtered = filterPlaceCandidates(hardEligible, ask, filterContext)
    .filter(candidate => !excludedIds.has(dateCandidateKey(candidate)));
  const rankContext = {
    savedPositive: preferredSavedNames(saved),
    savedBoth: bothWantNames(saved),
    recentlyVisited: new Set<string>(),
    commonTastes: coupleTasteBrief(input.tasteBoard, insight, input.avoidFoods).commonTastes,
    activities: [],
    allowHarsh,
  };
  const ranked = rankPlaceCandidates(filtered, ask, rankContext);
  if (ranked.length < 1) {
    const suggestions = nearbyAreaSuggestions(baseState);
    const card: AIChatCard = {
      headline: `${area}에서 ${label}을 더 찾지 못했어요`,
      lines: [
        alreadyShown.length
          ? "이 조건으로는 보여드린 곳이 거의 전부예요. 조건을 조금 바꾸거나 옆 동네로 넓혀 볼까요?"
          : "조건을 조금 바꾸거나 옆 동네로 넓혀 보면 더 나올 거예요.",
      ],
      suggestions: uniqueStrings([`${area} ${label} 추천해줘`, ...suggestions.slice(0, 3)], 4),
    };
    return chatResult(card, { ...baseState, placeAsk: ask });
  }
  const hydrated = await hydrateDateCandidates(ranked, saved);
  const hydratedPool = input.requireHardEligibility
    ? buildDateCandidatePool(hydrated, baseState, undefined,
      candidate => isDateCourseCandidate(candidate, baseState.requiredPlaces)) : null;
  if (input.observeCandidates) {
    try { input.observeCandidates(hydratedPool?.records ?? buildDateCandidatePool(hydrated, baseState).records); }
    catch { /* Candidate session observation must not change place selection. */ }
  }
  const finalCandidates = hydratedPool
    ? filterPlaceCandidates(hydratedPool.eligible, ask, filterContext)
      .filter(candidate => !excludedIds.has(dateCandidateKey(candidate))) : hydrated;
  if (input.requireHardEligibility && !finalCandidates.length) return chatResult({ headline: `${area}에서 ${label}을 더 찾지 못했어요`,
    lines: ["현재 조건에 맞는 장소를 확인하지 못했어요."] }, { ...baseState, placeAsk: ask });
  const hydrateDoneAt = performance.now();
  const picked = await recommendPlacesWithOpenAi({
    message: input.message,
    ask,
    candidates: finalCandidates,
    savedNames: preferredSavedNames(saved),
    bothWant: bothWantNames(saved),
    coupleTaste: coupleTasteBrief(input.tasteBoard, insight, input.avoidFoods),
    conversation: input.conversation,
    alreadyShown,
    skipFactLookup: Boolean(input.skipSearch),
    sessionFeedbackSignals: input.sessionFeedbackSignals,
  });
  if (input.requireHardEligibility) {
    const finalPool = buildDateCandidatePool(picked.candidates, baseState, undefined,
      candidate => isDateCourseCandidate(candidate, baseState.requiredPlaces));
    try { input.observeCandidates?.(finalPool.records); }
    catch { /* Observation cannot authorize a candidate. */ }
    const allowed = filterPlaceCandidates(finalPool.eligible, ask, filterContext)
      .filter(candidate => !excludedIds.has(dateCandidateKey(candidate)));
    const valid = (picked.card.stops ?? []).every(stop => allowed.some(candidate =>
      candidate.name === stop.name && (candidate.roadAddress || candidate.address) === stop.address));
    if (!valid) return chatResult({ headline: `${area} ${label} 추천`,
      lines: ["현재 조건을 다시 확인하니 이 장소들은 추천할 수 없어요."] },
      { ...baseState, placeAsk: ask });
  }
  const pickedDoneAt = performance.now();
  console.info("date_places_pipeline", JSON.stringify({
    kind: ask.kind, searchMs: Math.round(initialDoneAt - startedAt), geoMs: Math.round(geoDoneAt - initialDoneAt),
    hydrateMs: Math.round(hydrateDoneAt - geoDoneAt), selectMs: Math.round(pickedDoneAt - hydrateDoneAt),
    totalMs: Math.round(pickedDoneAt - startedAt), nearbyInitial, geoSearched: needGeoSearch,
    candidateCount: hydrated.length, shownCount: picked.shownPlaces.length, source: picked.source,
  }));
  if (picked.card.stops && picked.card.stops.length < Math.min(PLACE_PICK_MIN, hydrated.length) && !alreadyShown.length) {
    picked.card.lines = [`${picked.card.lines[0] ?? ""} 조건에 딱 맞는 곳이 많지는 않아서 ${picked.card.stops.length}곳만 골랐어요.`.trim()];
  }
  const nextState: AIPlannerState = {
    ...baseState,
    placeAsk: ask,
    shownPlaces: picked.shownPlaces,
    seenPlaces: uniqueStrings([...picked.shownPlaces, ...alreadyShown], MAX_SHOWN_PLACES),
  };
  return chatResult(picked.card, nextState);
}

type RecommendDatePlanInput = {
  currentPlan?: import("@/features/planning/types/plan").AIPlannerReply | null;
  message?: string;
  prompt?: string;
  previousPlaceNames?: string[];
  previousStops?: DatePreviousStop[];
  /** Full stop cards of the course on screen, so questions can be answered from known facts. */
  courseStops?: AIChatStop[];
  /** Stop cards from the last place-recommendation reply. */
  shownStops?: AIChatStop[];
  previousState?: AIPlannerState;
  dateLabel?: string;
  conversation?: DateChatTurn[];
};

async function recommendDatePlanCore(input: RecommendDatePlanInput,
  sessionCapture?: { previous: SessionCandidateContext | null; records: DateCandidateRecord[];
    supplementaryRecords: DateCandidateRecord[];
    supplementaryShown: Array<{ name: string; address?: string }>;
    feedbackEntries: SessionFeedbackEntry[]; turnId: string }):
  Promise<AIPlannerResult | { error: string }> {
  const traceId = randomUUID();
  const traceStarted = performance.now();
  const message = (input.message ?? input.prompt ?? "").trim().slice(0, 800);
  const previousState = input.previousState;
  const previousStops = input.previousStops?.length
    ? input.previousStops
    : (input.previousPlaceNames ?? []).map(name => ({ name, category: "" }));
  const shadowSnapshot: { current: DateTurnShadowResult | null } = { current: null };
  const executionPlanSnapshot: { current: NonNullable<ReturnType<typeof observeDateExecutionPlan>> | null } = { current: null };
  const observedContextSnapshot: { current: DateContext | null } = { current: null };
  const candidateContextSnapshot: { current: DateContext | null } = { current: null };
  const explanationRecordsSnapshot: { current: ReturnType<typeof buildDateCandidatePool>["records"] | null } = { current: null };
  // Read-only turn snapshot. Failures here must not affect the legacy execution path.
  const observeTurn = async (state: AIPlannerState, route: ChatRoute | null, includeInterpretedIntent = false) => {
    if (!message) return null;
    try {
      const currentUnderstanding = buildDateTurnUnderstanding({
        message, today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
        state, currentPlan: input.currentPlan, conversation: input.conversation,
        visiblePlaces: input.shownStops, legacyRoute: route,
        sessionCandidates: sessionCapture?.previous,
        interpretedIntent: includeInterpretedIntent ? toDateIntent(state) : null,
      });
      const context = buildDateContext({
        state, conversation: input.conversation, currentPlan: input.currentPlan,
        currentUnderstanding, effectiveUnderstanding: currentUnderstanding,
        interpreterMode: getDateTurnInterpreterMode(), observedAt: new Date().toISOString(),
        sessionCandidates: sessionCapture?.previous,
      });
      const shadow = await runDateTurnShadow({ message, state, context, conversation: input.conversation,
        currentPlan: input.currentPlan, visiblePlaces: input.shownStops, legacyUnderstanding: currentUnderstanding });
      if (shadow) shadowSnapshot.current = shadow;
      const baseContext = shadow ? buildDateContext({
        state, conversation: input.conversation, currentPlan: input.currentPlan, currentUnderstanding,
        shadowUnderstanding: shadow.shadowUnderstanding, understandingComparison: shadow.comparison,
        effectiveUnderstanding: shadow.effectiveUnderstanding, interpreterMode: shadow.mode,
        semanticSignalDiagnostics: shadow.assist?.semanticSignals,
        uncertainties: shadow.effectiveUnderstanding.ambiguities,
        observations: shadow.observations, observedAt: shadow.observation.timestamp,
        sessionCandidates: sessionCapture?.previous,
      }) : context;
      const execution = prepareDateExecutionPlan({ context: baseContext, route,
        visiblePlaces: input.shownStops, timestamp: new Date().toISOString() });
      if (execution) executionPlanSnapshot.current = execution;
      const observedContext = execution ? { ...baseContext, executionPlan: execution.plan,
        executionPlanComparison: execution.comparison,
        observations: [...baseContext.observations, execution.observation] } : baseContext;
      observedContextSnapshot.current = observedContext;
      if (process.env.NODE_ENV === "development") console.info("date_turn_understanding", JSON.stringify({
        legacyRoute: route?.mode ?? null,
        goals: currentUnderstanding.goals.map(goal => goal.type),
        explicitConstraintKeys: Object.keys(currentUnderstanding.explicitConstraints),
        requestedChanges: currentUnderstanding.requestedChanges.map(change => change.operation),
        unresolvedReferences: currentUnderstanding.references.filter(reference => reference.kind === "unresolved").length,
        confidence: currentUnderstanding.confidence,
        shadowGoals: shadow?.llmUnderstanding.goals.map(goal => goal.type) ?? null,
        shadowConstraintConflicts: shadow?.comparison.constraintConflicts.length ?? null,
        interpreterMode: observedContext.interpreterMode,
        acceptedSemanticSignals: shadow?.assist?.semanticSignals.filter(signal => signal.accepted).length ?? 0,
        rejectedSemanticSignals: shadow?.assist?.semanticSignals.filter(signal => !signal.accepted).length ?? 0,
        semanticRejectionReasons: shadow?.assist?.semanticSignals.filter(signal => signal.rejectionReason)
          .map(signal => signal.rejectionReason) ?? [],
        feedbackCount: observedContext.effectiveUnderstanding?.feedback.length ?? 0,
        acceptedLlmFeedbackCount: shadow?.assist?.acceptedFeedbackCount ?? 0,
        unresolvedFeedbackCount: observedContext.effectiveUnderstanding?.feedback.filter(item =>
          !item.target?.resolvedId && !item.target?.resolvedName).length ?? 0,
        ambiguityCount: observedContext.effectiveUnderstanding?.ambiguities.length ?? 0,
        plannedTaskTypes: observedContext.executionPlan?.tasks.map(task => task.type) ?? [],
        executionPlanCoverage: observedContext.executionPlanComparison?.routeCoverage ?? null,
      }));
      return observedContext.currentUnderstanding;
    } catch (error) {
      if (process.env.NODE_ENV === "development") console.warn("date_turn_understanding_failed",
        error instanceof Error ? error.name : "unknown");
      return null;
    }
  };
  const immediateSituation = message ? chatSituationFromMessage(message) : null;
  if (immediateSituation) {
    const state = previousState ?? emptyDateBrief();
    await observeTurn(state, null);
    const card = await composeDateChat({
      situation: immediateSituation,
      userMessage: message,
      state,
      extras: { currentCourse: previousStops.map(stop => stop.name), conversation: input.conversation },
    });
    return chatResult(card, noteTurn(state, message));
  }
  const currentCourse = previousStops.map(stop => stop.name);
  const [tasteBoard, routed] = await Promise.all([
    loadTasteBoard(),
    message ? routeDateChat({
      message,
      state: previousState,
      hasCourse: currentCourse.length > 0,
      currentCourse,
      currentCategories: previousStops.map(stop => stop.category),
      conversation: input.conversation,
    }) : Promise.resolve(null),
  ]);
  const tasteSeed = tasteBoard.compare?.seed ?? (tasteBoard.you ? seedFromProfile(tasteBoard.you) : null);
  const avoidFoods = tasteSeed?.avoidFoods ?? [];
  const filledPrevious = previousState && tasteSeed ? applyTasteFallback(previousState, tasteSeed) : previousState;
  const taskExecutionObservations: import("./dateObservation").DateObservation[] = [];
  const withLimitedTasks = async (executePrimary: () => AIPlannerResult | Promise<AIPlannerResult>,
    state: AIPlannerState): Promise<AIPlannerResult> => {
    const executionMode = getDateExecutionMode();
    const interpreterMode = shadowSnapshot.current?.mode ?? getDateTurnInterpreterMode();
    const explanationContext = candidateContextSnapshot.current ?? observedContextSnapshot.current;
    const orchestrated = await orchestrateDateTurn({
      executePrimary, legacyRoute: routed, executionMode,
      executionPlan: executionPlanSnapshot.current?.plan ?? null,
      session: sessionCapture,
      observationTargets: [taskExecutionObservations,
        ...(observedContextSnapshot.current ? [observedContextSnapshot.current.observations] : [])],
      taskContext: primary => ({
      plan: executionPlanSnapshot.current!.plan, primary,
      mutation: { currentPlan: input.currentPlan ?? null, route: routed, interpreterMode,
        executionMode, userMessage: message, state,
        understanding: shadowSnapshot.current?.shadowUnderstanding, visiblePlaces: input.shownStops,
        sessionCandidates: sessionCapture?.previous },
      inspection: { route: routed, interpreterMode, executionMode,
        currentPlan: input.currentPlan ?? null, visiblePlaces: input.shownStops ?? [],
        courseStops: input.courseStops ?? [], userMessage: message, state,
        sessionCandidates: sessionCapture?.previous,
        coupleTaste: coupleTasteBrief(tasteBoard, null, avoidFoods) },
      explanation: { route: routed, currentPlan: input.currentPlan ?? null,
        interpreterMode, executionMode, userMessage: message, context: explanationContext,
        candidateRecords: explanationRecordsSnapshot.current ?? undefined,
        semanticHints: semanticPlanningHintsForContext(explanationContext
          ?? { interpreterMode: "off", effectiveUnderstanding: null }) },
      recommendation: { route: routed, interpreterMode, executionMode, state, message,
        sessionCandidates: sessionCapture?.previous, currentPlan: input.currentPlan ?? null,
        visiblePlaces: input.shownStops ?? [], avoidFoods,
        sessionFeedback: sessionCapture?.previous?.feedback,
        currentTurnId: sessionCapture?.turnId,
        observeCandidates: sessionCapture ? records => {
          sessionCapture.supplementaryRecords.push(...records);
        } : undefined,
        recommend: request => recommendPlacesForChat({
          message: request.message, ask: request.ask, state: request.state,
          conversation: input.conversation, avoidFoods, tasteBoard,
          seedCandidates: request.reusable, skipSearch: !request.search,
          excludedCandidateIds: request.excludedCandidateIds, requireHardEligibility: true,
          sessionFeedbackSignals: request.sessionFeedbackSignals,
          observeCandidates: request.observeCandidates,
        }),
      },
      comparison: { route: routed, interpreterMode, executionMode,
        currentPlan: input.currentPlan ?? null, visiblePlaces: input.shownStops ?? [],
        sessionCandidates: sessionCapture?.previous,
        candidateRecords: explanationRecordsSnapshot.current ?? candidateContextSnapshot.current?.candidates.records,
        state, userMessage: message,
        semanticHints: semanticPlanningHintsForContext(explanationContext
          ?? { interpreterMode: "off", effectiveUnderstanding: null }) },
      feedback: { interpreterMode, executionMode, currentPlan: input.currentPlan ?? null,
        visiblePlaces: input.shownStops ?? [], sessionCandidates: sessionCapture?.previous,
        understanding: observedContextSnapshot.current?.effectiveUnderstanding ?? null,
        userMessage: message, turnId: sessionCapture?.turnId ?? traceId },
      }),
    });
    return orchestrated.finalResult;
  };

  // A place request that was waiting for an area resumes once the area chip is picked.
  if (!message && filledPrevious?.placeAsk && !filledPrevious.placeAsk.area && selectedAreas(filledPrevious).length) {
    return recommendPlacesForChat({
      message: `${selectedAreas(filledPrevious)[0]} ${filledPrevious.placeAsk.query} ${PLACE_KIND_LABEL[filledPrevious.placeAsk.kind]} 추천해줘`,
      ask: { ...filledPrevious.placeAsk, area: selectedAreas(filledPrevious)[0] },
      state: filledPrevious,
      conversation: input.conversation,
      avoidFoods,
      observeCandidates: sessionCapture ? records => { sessionCapture.records = records; } : undefined,
      tasteBoard,
    });
  }

  let pickedPlaces: string[] = [];
  let courseEdit: ChatRoute["edit"];
  if (message) {
    const route = routed!;
    const state = filledPrevious ?? emptyDateBrief();
    if (route.mode === "chat") {
      await observeTurn(state, route);
      return withLimitedTasks(async () => {
        const situation = chatSituationFromMessage(message) ?? "unclear";
        const card = await composeDateChat({
          situation, userMessage: message, state,
          extras: { currentCourse, conversation: input.conversation },
        });
        return chatResult(card, noteTurn(state, message));
      }, state);
    }
    if (route.mode === "question") {
      await observeTurn(state, route);
      return withLimitedTasks(async () => {
        const insight = await loadLatestCoupleInsight();
        const card = await answerDateQuestion({
          message, state,
          stops: toQuestionStops(input.courseStops, previousStops),
          shownStops: toQuestionStops(input.shownStops, []),
          coupleTaste: coupleTasteBrief(tasteBoard, insight, avoidFoods),
          conversation: input.conversation,
        });
        return chatResult(card, noteTurn(state, message));
      }, state);
    }
    if (route.mode === "places" && route.placeAsk) {
      await observeTurn(state, route);
      const placeAsk = route.placeAsk;
      const useSessionCandidates = legacyPlacesReuseEnabled({ session: sessionCapture?.previous,
        interpreterMode: getDateTurnInterpreterMode(), executionMode: getDateExecutionMode(),
        plan: executionPlanSnapshot.current?.plan });
      const sessionReuse = useSessionCandidates ? sessionPlaceRecommendationInputs({
        session: sessionCapture!.previous, ask: { ...placeAsk,
          area: placeAsk.area || selectedAreas(state)[0] || "" }, state, message,
        now: new Date().toISOString(), avoidFoods }) : null;
      const reusedIds = new Set(sessionReuse?.reusable.map(dateCandidateKey) ?? []);
      return withLimitedTasks(() => recommendPlacesForChat({
        message,
        ask: placeAsk,
        state,
        conversation: input.conversation,
        avoidFoods,
        observeCandidates: sessionCapture ? records => {
          const freshRecords = sessionReuse ? records.filter(record => !reusedIds.has(record.id)) : records;
          sessionCapture.records = sessionReuse
            ? [...sessionCapture.records, ...freshRecords] : freshRecords;
        } : undefined,
        seedCandidates: sessionReuse?.reusable,
        skipSearch: sessionReuse ? !sessionReuse.search : undefined,
        excludedCandidateIds: sessionReuse?.excludedCandidateIds,
        requireHardEligibility: Boolean(sessionReuse),
        sessionFeedbackSignals: useSessionCandidates
          ? placeSessionFeedbackSignals(sessionCapture?.previous?.feedback, "") : undefined,
        tasteBoard,
      }), state);
    }
    pickedPlaces = route.pickedPlaces ?? [];
    courseEdit = route.edit;
  }

  const unsupported = message && unsupportedCourseRequest(message);
  if (unsupported) {
    await observeTurn(filledPrevious ?? emptyDateBrief(), routed);
    return chatResult({ headline: "", lines: [unsupported] }, noteTurn(filledPrevious ?? emptyDateBrief(), message));
  }

  if (!message && missingSlot(filledPrevious)) {
    const slot = missingSlot(filledPrevious)!;
    const question = slotQuestion(slot, filledPrevious);
    const card = slot === "area"
      ? dateChatCard({ situation: "need_area", userMessage: "", state: filledPrevious! })
      : { headline: "", lines: [question.message], suggestions: question.options };
    return clarificationReply(slot, filledPrevious!, card);
  }

  const interpretation = message
    ? await interpretDateRequest({
      message,
      previousState: filledPrevious,
      previousPlaceNames: previousStops.map(stop => stop.name),
      dateLabel: input.dateLabel,
      conversation: input.conversation,
    })
    : {
      state: { ...filledPrevious!, dateLabel: input.dateLabel || filledPrevious?.dateLabel || null, pendingSlot: missingSlot(filledPrevious) },
      slot: missingSlot(filledPrevious),
      reply: "",
    };
  const intentDone = performance.now();
  const turnUnderstanding = message ? await observeTurn(interpretation.state, routed, true) : null;

  if (courseEdit && input.currentPlan?.items.length && input.currentPlan.items.length === input.currentPlan.recommendations.length) {
    return withLimitedTasks(() => editCurrentCourse(input.currentPlan!, courseEdit!, {
      ...interpretation.state,
      userRequests: [...(filledPrevious?.userRequests ?? []), message].filter(Boolean).slice(-MAX_CONVERSATION_NOTES),
    }), interpretation.state);
  }

  const interpretedRaw = applyCourseDelta({
    message,
    previousStops,
    state: {
      ...interpretation.state,
      // The interpreter rebuilds the brief from scratch; the place-list
      // memory lives outside the brief and must survive the turn.
      shownPlaces: filledPrevious?.shownPlaces,
      seenPlaces: filledPrevious?.seenPlaces,
      placeAsk: filledPrevious?.placeAsk,
      conversationNotes: message
        ? [...interpretation.state.conversationNotes.filter(note => note !== message), message].slice(-MAX_CONVERSATION_NOTES)
        : interpretation.state.conversationNotes,
      userRequests: (interpretation.state.intent === "reset" || !interpretation.state.preserveExistingPlaces
        ? [message]
        : [...(filledPrevious?.userRequests?.length ? filledPrevious.userRequests
          : (input.conversation ?? []).filter(turn => turn.role === "user").map(turn => turn.text).slice(0, -1)), message])
        .filter(Boolean).slice(-MAX_CONVERSATION_NOTES),
      dateLabel: interpretation.state.dateLabel || input.dateLabel || null,
      requiredPlaces: uniqueStrings([
        ...pickedPlaces,
        ...interpretation.state.requiredPlaces.filter(place => !/^(?:방탈출|보드게임|볼링|오락실|만화카페|VR(?:카페|\s*체험)?|실내(?:\s*놀거리)?)$/.test(place)),
      ], 6),
    },
  });
  const interpreted = tasteSeed ? applyTasteFallback(interpretedRaw, tasteSeed) : interpretedRaw;
  const slot = missingSlot(interpreted);
  if (slot) {
    const question = slotQuestion(slot, interpreted);
    const card = slot === "area"
      ? dateChatCard({ situation: "need_area", userMessage: message, state: interpreted })
      : { headline: "", lines: [question.message], suggestions: question.options };
    return clarificationReply(slot, interpreted, card);
  }

  let state = applyDateDefaults(interpreted);
  const selectedRegions = selectedAreas(state);
  if (!selectedRegions.length) {
    return clarificationReply("area", state, dateChatCard({ situation: "need_area", userMessage: message, state }));
  }
  const searchRegions = expandedSearchRegions(state);
  const retainedPlaces = state.preserveExistingPlaces ? previousStops.map(stop => stop.name.trim()).filter(Boolean).slice(0, 12) : [];
  const directQueries = uniqueStrings([...state.requiredPlaces, ...retainedPlaces]).filter(name => !state.excludedPlaces.includes(name));
  const prefetchedKeywords = new Map<string, ReturnType<typeof searchKakaoPlacesRemote>>();
  const keywordSearch = (intent: DateSearchIntent, page: number) => {
    const key = JSON.stringify([intent.region, intent.category, intent.query, page]);
    let pending = prefetchedKeywords.get(key);
    if (!pending) {
      pending = searchKakaoPlacesRemote({ region: intent.region, category: intent.category, query: intent.query, page });
      prefetchedKeywords.set(key, pending);
    }
    return pending;
  };
  // The explicit activity searches are known before the discovery model runs.
  // Reuse these promises if its brief asks for the same query.
  for (const intent of searchIntents(state)) {
    void keywordSearch(intent, 1);
    void keywordSearch(intent, 2);
  }
  const explicitSearchesPromise = Promise.all(directQueries.map(query => searchKakaoPlacesRemote({ query, region: searchRegions.at(-1), page: 1 })));
  const areaSearchesPromise = Promise.all(selectedRegions.map(region => searchKakaoPlacesRemote({ query: region, page: 1 })));
  const leadStartedAt = performance.now();
  let leadDoneAt = leadStartedAt;
  const venueLeadsPromise = discoverVenueLeads(state).then(leads => { leadDoneAt = performance.now(); return leads; });
  // Venue design only needs the brief. Account context can be fetched during
  // that model call instead of extending the critical path afterward.
  const [discoveryBrief, [{ places: saved }, insight, archives]] = await Promise.all([
    designDateDiscovery({ message, state, conversation: input.conversation, taste: tasteBoard.compare?.overlaps ?? [] }),
    Promise.all([listPlaces(), loadLatestCoupleInsight(), listArchivedDatePlans()]),
  ]);
  state.discovery = discoveryBrief;
  const memory = collectDateMemory({ taste: tasteBoard, archives: archives.dates,
    userRequests: state.userRequests ?? [], currentPlaces: previousStops.map(stop => stop.name) });
  state = applyDateMemory(state, memory);
  const discoveryDone = performance.now();
  const radius = areaScopeMeters(state);
  const time = assumedTimeWindow(state);
  const explicitTripWindows = tripLocalWindows(state.userRequests ?? [], courseSize(state).days);
  const condition = {
    dateLabel: state.dateLabel || "날짜 미정",
    startTime: time.startTime,
    endTime: time.endTime,
    budget: state.budgetWon ?? null,
    region: selectedRegions.join(" · "),
    timeSpecified: time.specified || Object.keys(explicitTripWindows).length > 0,
  };
  const recentlyVisited = [...recentPlaceNames(archives.dates)];
  const keywordIntents: DateSearchIntent[] = [...discoveryBrief.queries, ...searchIntents(state)]
    .filter((intent, index, all) => all.findIndex(other => other.region === intent.region && other.query === intent.query && ("category" in other ? other.category : undefined) === ("category" in intent ? intent.category : undefined)) === index)
    .slice(0, 20);
  const geoIntents = activitySearchIntents(state);
  const allowHarsh = applyTasteHarshAllow(allowsHarshDateMeal(message, state.cuisine), message, avoidFoods);
  const searchKeyword = (page: number) => Promise.all(keywordIntents.map(intent => keywordSearch(intent, page)));
  const shortlist = (state.shownPlaces ?? [])
    .filter(name => !directQueries.includes(name) && !state.excludedPlaces.includes(name))
    .slice(0, 6);
  // Editorial lead search is slower than Kakao search. Let it continue while
  // we locate anchors and fetch nearby venues; only resolution needs its result.
  const [explicitSearches, areaSearches, intentSearches, intentSearches2, shortlistSearches] = await Promise.all([
    explicitSearchesPromise,
    areaSearchesPromise,
    searchKeyword(1),
    searchKeyword(2),
    Promise.all(shortlist.map(query => searchKakaoPlacesRemote({ query, region: searchRegions.at(-1), page: 1 }))),
  ]);
  const baseSearchDone = performance.now();

  const unique = new Map<string, DiscoverCandidate>();
  const remember = (candidate: DiscoverCandidate, searchRegion?: string, required = false) => {
    const key = `${candidate.externalSource}:${candidate.externalPlaceId}`;
    if (unique.has(key)) return;
    if (!required && isOffDateVenue(candidate, { allowHarsh, allowKaraoke: state.activities.includes("indoor") })) return;
    unique.set(key, searchRegion ? { ...candidate, searchRegion } : candidate);
  };
  // Keep the exact entities already shown on screen available during edits.
  // Provider search can omit a venue on a later request even though it is a
  // required stop, which previously made add/swap operations collapse.
  for (const place of input.currentPlan?.recommendations ?? []) {
    if (!place.coordinates) continue;
    const [sourcePart, ...externalParts] = place.id.split(":");
    const externalSource = sourcePart === "tourapi" ? "tourapi" : "kakao";
    const externalPlaceId = externalParts.join(":") || place.placeId.replace(/^(?:kakao|tourapi):/, "");
    const label = `${place.category} ${place.reasons.join(" ")}`;
    const category: DiscoverCandidate["category"] = place.activitySlot === "cafe" ? "cafe"
      : place.activitySlot === "meal" ? "restaurant"
      : place.activitySlot === "walk" || place.activitySlot === "nightview" ? "nature"
      : place.activitySlot === "performance" || place.activitySlot === "movie" || place.activitySlot === "exhibit" || place.activitySlot === "indoor" ? "photo"
      : /카페|커피|디저트|베이커리/.test(place.category)
      ? "cafe"
      : /식당|음식|한식|일식|중식|양식|맛집|해물|고기/.test(place.category)
        ? "restaurant"
        : /보드|방탈출|오락|볼링|공연|영화|전시|미술|박물/.test(label)
          ? "photo"
          : /공원|숲|산책|자연/.test(label) ? "nature" : "tourist";
    remember({
      externalSource,
      externalPlaceId,
      name: place.name,
      category,
      categoryLabel: place.category,
      district: place.district,
      address: place.address,
      roadAddress: place.address,
      phone: place.phone,
      mapUrl: place.mapUrl,
      coordinates: place.coordinates,
      detailedCategory: place.category,
      kakaoCategoryGroupCode: category === "restaurant" ? "FD6" : category === "cafe" ? "CE7" : category === "photo" ? "CT1" : undefined,
      rating: place.rating,
      ratingCount: place.ratingCount,
      dishes: place.dishes,
      factSourceUrl: place.factSourceUrl,
      factNote: place.reasons[0],
    }, searchRegions[0], true);
  }
  const ingestKeyword = (results: typeof intentSearches) => {
    for (const [index, result] of results.entries()) {
      if (!result.ok) continue;
      for (const candidate of result.places.slice(0, 15)) remember(candidate, keywordIntents[index]?.region ?? searchRegions[0]);
    }
  };
  for (const result of explicitSearches) {
    if (!result.ok) continue;
    for (const candidate of result.places) remember(candidate, undefined, true);
  }
  // Shops the user just saw in a recommendation list stay eligible for the
  // course even when a slot cap is already full; only the exact shop counts.
  for (const [index, result] of shortlistSearches.entries()) {
    if (!result.ok) continue;
    const wanted = shortlist[index] ?? "";
    for (const candidate of result.places) {
      if (matchesTerm(candidate, wanted)) remember(candidate, searchRegions[0], true);
    }
  }
  ingestKeyword(intentSearches);
  ingestKeyword(intentSearches2);
  const preferredSaved = preferredSavedNames(saved);
  const discovery = discoveryActivities(state);
  for (const place of saved) {
    if (["dislike", "not_interested"].includes(place.userStatus) || ["dislike", "not_interested"].includes(place.partnerStatus)) continue;
    const candidate = placeToCandidate(place);
    if (!candidate) continue;
    const preferred = preferredSaved.has(place.name);
    const wanted = isExclusiveCrawl(state) ? state.activities : discovery;
    if (!preferred && wanted.length && !wanted.some(activity => matchesActivity(candidate, activity))) continue;
    remember(candidate, searchRegions[0], true);
  }

  const locatedAnchors = areaSearches.flatMap((result, index) => {
    if (!result.ok) return [];
    const needle = selectedRegions[index]?.replace(/(?:역|동|구|시)$/, "").replace(/\s/g, "") ?? "";
    const exact = result.places.find(candidate => candidate.name.replace(/\s/g, "").includes(needle));
    const candidate = exact ?? result.places[0];
    return candidate ? [{ candidate, region: selectedRegions[index] }] : [];
  });
  const anchors = locatedAnchors.map(item => item.candidate);
  const ingestGeo = async (page: number, includeFestival: boolean) => {
    if (!anchors.length) return;
    const festivalRadius = Math.max(radius, 4000);
    const geoSearches = await Promise.all([
      ...anchors.flatMap(anchor => geoIntents.map(intent => searchKakaoPlacesRemote({
        category: intent.category,
        query: intent.query,
        x: anchor.coordinates[0],
        y: anchor.coordinates[1],
        radius,
        page,
      }))),
      ...(includeFestival && isTourApiConfigured()
        ? [searchTourPlacesRemote({
          category: "festival",
          region: selectedRegions[0],
          x: anchors[0].coordinates[0],
          y: anchors[0].coordinates[1],
          radius: festivalRadius,
        })]
        : []),
      ...(isTravelPlan(state) && isTourApiConfigured()
        ? [searchTourPlacesRemote({
          category: "tourist", region: selectedRegions[0],
          x: anchors[0].coordinates[0], y: anchors[0].coordinates[1], radius: Math.max(radius, 6000), page,
        })] : []),
    ]);
    for (const result of geoSearches) {
      if (!result.ok) continue;
      for (const candidate of result.places.slice(0, 15)) remember(candidate, selectedRegions[0]);
    }
  };
  const leadResolution = venueLeadsPromise.then(async venueLeads => ({
    venueLeads,
    leadSearches: await Promise.all(venueLeads.map(lead => searchKakaoPlacesRemote({ query: `${lead.name} ${lead.region}`, page: 1 }))),
  }));
  const [, , { venueLeads, leadSearches }] = await Promise.all([
    ingestGeo(1, true), ingestGeo(2, false),
    leadResolution,
  ]);
  const geoLeadDone = performance.now();
  let resolvedLeadCount = 0;
  for (const [index, result] of leadSearches.entries()) {
    if (!result.ok) continue;
    const lead = venueLeads[index];
    const found = result.places.find(candidate => leadMatchesCandidate(lead, candidate));
    if (!found || !isDateCourseCandidate(found, state.requiredPlaces)) continue;
    const key = `${found.externalSource}:${found.externalPlaceId}`;
    const existing = unique.get(key);
    if (existing) unique.set(key, { ...existing, discoveryLeadUrl: lead.sourceUrl });
    else remember({ ...found, discoveryLeadUrl: lead.sourceUrl }, lead.region);
    resolvedLeadCount++;
  }
  if (venueLeads.length) console.info("date_venue_leads", JSON.stringify({ proposed: venueLeads.length, resolved: resolvedLeadCount }));
  const decorate = (candidate: DiscoverCandidate) => {
    const nearestAnchor = locatedAnchors
      .map(anchor => ({ ...anchor, meters: distanceMeters(anchor.candidate.coordinates, candidate.coordinates) }))
      .sort((a, b) => a.meters - b.meters)[0];
    return {
      ...candidate,
      searchRegion: nearestAnchor?.region ?? candidate.searchRegion,
      name: presentCandidateName(candidate.name, state.requiredPlaces),
      distanceMeters: nearestAnchor ? Math.round(nearestAnchor.meters) : candidate.distanceMeters,
    };
  };
  const admit = (candidate: DiscoverCandidate) => {
    const required = state.requiredPlaces.some(name => matchesTerm(candidate, name));
    return isDateCourseCandidate(candidate, state.requiredPlaces)
      && !state.excludedPlaces.some(name => matchesTerm(candidate, name))
      && !candidateFoodConflict(`${candidate.name} ${candidate.detailedCategory ?? ""} ${candidate.dishes ?? ""}`, state.excludedFoods ?? [])
      && !violatesTasteAvoid(`${candidate.name} ${candidate.categoryLabel} ${candidate.detailedCategory ?? ""}`, avoidFoods)
      && (candidate.category !== "festival" || Array.from({ length: courseSize(state).days }, (_, day) =>
        festivalPeriodCoversYmd(candidate.openingHours, tripDayYmd(state, day))).some(Boolean))
      && (required || !isOffDateVenue(candidate, { allowHarsh, allowKaraoke: state.activities.includes("indoor") }));
  };
  let candidatePoolSnapshot: ReturnType<typeof buildDateCandidatePool> | null = null;
  const currentPool = () => {
    const scoped = (anchors.length
      ? [...unique.values()].filter(candidate => state.requiredPlaces.some(name => matchesTerm(candidate, name)) || anchors.some(anchor => {
        const hop = distanceMeters(anchor.coordinates, candidate.coordinates);
        return hop <= (candidate.category === "festival" ? Math.max(radius, 4000) : radius);
      }))
      : [...unique.values()]);
    candidatePoolSnapshot = buildDateCandidatePool(scoped, state, preferredSavedNames(saved), admit);
    if (sessionCapture) sessionCapture.records = candidatePoolSnapshot.records;
    return candidatePoolSnapshot.eligible.map(decorate);
  };
  let pool = currentPool();
  const wantedSlots = discovery;
  const poolSlots = () => new Set(pool.map(candidateActivitySlot));
  const attemptedResearch = new Set(keywordIntents.map(intent => `${intent.region}:${intent.query}`));
  const taskPlan = await runDateTaskPlanner({
    state, regions: selectedRegions, attempted: attemptedResearch,
    canVerifyPerformances: Boolean(process.env.KOPIS_SERVICE_KEY?.trim()),
    canInspectPlaces: true,
    observe: () => ({ candidates: pool,
      missingActivities: missingWantedSlots(poolSlots(), discoveryBrief.requiredActivities) }),
    execute: async calls => {
      await Promise.all(calls.map(async call => {
        if (call.tool === "search_places") {
          const result = await searchKakaoPlacesRemote({ region: call.region, query: call.query, page: 1 });
          if (result.ok) for (const candidate of result.places.slice(0, 15)) remember(candidate, call.region);
          return;
        }
        const venue = pool.find(candidate => dateCandidateKey(candidate) === call.venueId);
        if (!venue) return;
        if (call.tool === "get_place_details") {
          const detailed = (await hydrateDateCandidates([venue], saved))[0];
          const existing = unique.get(call.venueId);
          if (detailed && existing) unique.set(call.venueId, { ...existing, ...detailed });
          return;
        }
        const checked = (await attachKopisPerformances([venue], state.dateLabel, courseSize(state).days))[0];
        if (checked?.performanceEvent) {
          const existing = unique.get(call.venueId);
          if (existing) unique.set(call.venueId, { ...existing, performanceEvent: checked.performanceEvent });
        }
      }));
      pool = currentPool();
    },
  });
  let agentToolCalls = taskPlan.steps.reduce((sum, step) => sum + step.calls.length, 0);
  if (pool.length < 8 || missingWantedSlots(poolSlots(), wantedSlots).length) {
    const extras = await Promise.all(selectedRegions.flatMap(region => (
      rescueSearchQueries(region, wantedSlots).map(query => searchKakaoPlacesRemote({ query, page: 1 }))
    )));
    for (const result of extras) {
      if (!result.ok) continue;
      for (const candidate of result.places) remember(candidate, selectedRegions[0]);
    }
    pool = currentPool();
  }
  if (pool.length < 2) {
    const extras = await Promise.all(selectedRegions.flatMap(region => (
      rescueSearchQueries(region, wantedSlots).map(query => searchKakaoPlacesRemote({ query, page: 2 }))
    )));
    for (const result of extras) {
      if (!result.ok) continue;
      for (const candidate of result.places) remember(candidate, selectedRegions[0]);
    }
    pool = currentPool();
  }
  const poolReady = performance.now();
  const rankContext = {
    savedPositive: preferredSavedNames(saved),
    savedBoth: bothWantNames(saved),
    recentlyVisited: new Set(recentlyVisited),
    commonTastes: [...(tasteBoard.compare?.overlaps ?? []), ...(insight?.commonTastes ?? []).map(item => item.label)].filter(Boolean),
    activities: discoveryBrief.requiredActivities,
    allowHarsh,
    trip: isTravelPlan(state),
  };
  const ranked = applyRanking(pool, toDateRanking(pool, rankContext));
  const onMix = isExclusiveCrawl(state) && state.activities.length
    ? ranked.filter(candidate => fitsWantedActivities(candidate, state.activities))
    : ranked;
  // Rank the complete search pool with branch-verified facts. Truncating first
  // discards sourced cafes and triggers slow web research on weaker venues.
  const storedEvidence = await readVenueEvidence(onMix);
  const evidenceDone = performance.now();
  const evidencePool = onMix.map(candidate => {
    const observations = storedEvidence.get(dateCandidateKey(candidate)) ?? [];
    if (!observations.length) return candidate;
    const evidence = [...new Map([...(candidate.evidence ?? []), ...observations]
      .map(fact => [`${fact.url}:${fact.text}`, fact])).values()];
    return { ...candidate, evidence };
  });
  const catalog = discoveryCatalog(evidencePool, state, rankContext.savedPositive, 72);
  const [hydrated, withPerformances] = await Promise.all([
    hydrateDateCandidates(catalog, saved),
    attachKopisPerformances(catalog, state.dateLabel, courseSize(state).days),
  ]);
  const performanceById = new Map(withPerformances.filter(candidate => candidate.performanceEvent)
    .map(candidate => [`${candidate.externalSource}:${candidate.externalPlaceId}`, candidate.performanceEvent]));
  const candidates = hydrated.map(candidate => ({ ...candidate,
    performanceEvent: performanceById.get(`${candidate.externalSource}:${candidate.externalPlaceId}`) ?? candidate.performanceEvent,
  }));
  const dateContext = buildDateContext({
    state, conversation: input.conversation, tasteBoard, archives: archives.dates, memory,
    currentPlan: input.currentPlan, currentUnderstanding: turnUnderstanding, goals: taskPlan.objectives,
    shadowUnderstanding: shadowSnapshot.current?.shadowUnderstanding,
    effectiveUnderstanding: shadowSnapshot.current?.effectiveUnderstanding ?? turnUnderstanding,
    interpreterMode: shadowSnapshot.current?.mode ?? getDateTurnInterpreterMode(),
    semanticSignalDiagnostics: shadowSnapshot.current?.assist?.semanticSignals,
    uncertainties: shadowSnapshot.current?.effectiveUnderstanding.ambiguities ?? turnUnderstanding?.ambiguities,
    understandingComparison: shadowSnapshot.current?.comparison,
    executionPlan: executionPlanSnapshot.current?.plan,
    executionPlanComparison: executionPlanSnapshot.current?.comparison,
    observations: [...(shadowSnapshot.current?.observations ?? []),
      ...(executionPlanSnapshot.current ? [executionPlanSnapshot.current.observation] : [])],
    candidatePool: candidatePoolSnapshot, observedAt: new Date().toISOString(),
    sessionCandidates: sessionCapture?.previous,
  });
  candidateContextSnapshot.current = dateContext;
  const searchDone = performance.now();
  if (candidates.length < 2) {
    console.info("date_course_pipeline", JSON.stringify({ traceId, outcome: "insufficient_candidates", candidateCount: candidates.length,
      candidateObservations: dateContext.observations.length,
      intentMs: Math.round(intentDone - traceStarted), briefMs: Math.round(discoveryDone - intentDone),
      discoveryMs: Math.round(discoveryDone - traceStarted), searchMs: Math.round(searchDone - discoveryDone) }));
    const suggestions = nearbyAreaSuggestions(state);
    const card = dateChatCard({
      situation: "no_places",
      userMessage: message,
      state,
      extras: { region: condition.region, suggestions },
    });
    return withLimitedTasks(() => ({
      status: "chat",
      message: cardToText(card),
      card,
      state: state.preserveExistingPlaces && input.currentPlan ? input.currentPlan.state : state,
      options: suggestions,
      multiple: false,
      slot: "area",
    }), state);
  }
  const semanticPlanningHints = semanticPlanningHintsForContext(dateContext);
  const proposeCourse = (courseCandidates: DiscoverCandidate[]) => recommendDatePlanWithOpenAi({
    traceId,
    prompt: message || `${condition.region}에서 ${state.activities.join(", ") || "하루"} 데이트`,
    condition,
    candidates: courseCandidates,
    saved,
    state,
    recentlyVisited,
    memory,
    conversation: input.conversation,
    currentCourse: previousStops,
    ...(hasSemanticPlanningHints(semanticPlanningHints) ? { semanticPlanningHints } : {}),
    coupleTaste: {
      summary: tasteBoard.compare?.summary ?? insight?.summary ?? "",
      commonTastes: [
        ...(tasteBoard.compare?.overlaps ?? []).map(label => ({ label })),
        ...(insight?.commonTastes ?? []),
      ],
      youHighlights: tasteBoard.you ? tasteBoard.you.areas.slice(0, 2) : insight?.youHighlights ?? [],
      partnerHighlights: tasteBoard.partner ? tasteBoard.partner.areas.slice(0, 2) : insight?.partnerHighlights ?? [],
      avoidFoods,
    },
  });
  const agentRun = await runDateAgentCourse({
    candidates, propose: proposeCourse, allowResearchRepair: !state.foodAllergy,
    researchAfterFailure: async (issues, existing) => {
      const calls = (await planNextDateResearch({ state, candidates: existing,
        regions: selectedRegions, missing: missingWantedSlots(new Set(existing.map(candidateActivitySlot)), discoveryBrief.requiredActivities),
        attempted: attemptedResearch, verifierIssues: issues,
      })).filter(call => call.tool === "search_places").slice(0, 3);
      calls.forEach(call => attemptedResearch.add(dateResearchCallKey(call)));
      agentToolCalls += calls.length;
      const results = await Promise.all(calls.map(call => searchKakaoPlacesRemote({ region: call.region, query: call.query, page: 1 })));
      for (const [index, result] of results.entries()) {
        if (!result.ok) continue;
        for (const candidate of result.places.slice(0, 15)) remember(candidate, calls[index].region);
      }
      const seen = new Set(existing.map(dateCandidateKey));
      const additions = currentPool().filter(candidate => !seen.has(dateCandidateKey(candidate)));
      if (!additions.length) return [];
      const rankedAdditions = applyRanking(additions, toDateRanking(additions, rankContext));
      const stored = await readVenueEvidence(rankedAdditions);
      const withEvidence = rankedAdditions.map(candidate => {
        const observations = stored.get(dateCandidateKey(candidate)) ?? [];
        return observations.length ? { ...candidate, evidence: [...(candidate.evidence ?? []), ...observations] } : candidate;
      });
      const catalog = discoveryCatalog(withEvidence, state, rankContext.savedPositive, 20);
      const [details, events] = await Promise.all([
        hydrateDateCandidates(catalog, saved),
        attachKopisPerformances(catalog, state.dateLabel, courseSize(state).days),
      ]);
      const eventsById = new Map(events.filter(candidate => candidate.performanceEvent)
        .map(candidate => [dateCandidateKey(candidate), candidate.performanceEvent]));
      return details.map(candidate => ({ ...candidate,
        performanceEvent: eventsById.get(dateCandidateKey(candidate)) ?? candidate.performanceEvent }));
    },
  });
  const recommendation = agentRun.reply;
  if (sessionCapture) {
    try {
      const allRecords = new Map(sessionCapture.records.map(record => [record.id, record]));
      for (const record of buildDateCandidatePool(agentRun.candidates, state).records) {
        const earlier = allRecords.get(record.id);
        allRecords.set(record.id, earlier ? { ...record,
          evidence: [...new Map([...earlier.evidence, ...record.evidence]
            .map(fact => [`${fact.attribute}:${fact.sourceUrl}:${fact.retrievedAt}`, fact])).values()],
          rejectedReasons: [...new Set([...earlier.rejectedReasons, ...record.rejectedReasons])],
        } : record);
      }
      sessionCapture.records = [...allRecords.values()];
    } catch { /* Session history cannot change a recommendation. */ }
  }
  if (executionPlanSnapshot.current?.plan.tasks.some(task => task.type === "explain_recommendation")
    && recommendation.status === "plan") {
    const selectedIds = new Set(recommendation.recommendations.map(place => place.id));
    explanationRecordsSnapshot.current = buildDateCandidatePool(agentRun.candidates.filter(candidate =>
      selectedIds.has(dateCandidateKey(candidate))), state).records;
  }
  if (recommendation.items.length && taskPlan.objectives.some(objective => objective.id === "weather")) {
    const notice = "방문일 실제 날씨는 아직 확인하지 못했어요. 출발 전 예보를 확인하고 비가 오면 실내 대안으로 조정해 주세요.";
    recommendation.message = `${recommendation.message} ${notice}`.trim();
    recommendation.card.lines = [...recommendation.card.lines, notice];
  }
  const designDone = performance.now();
  // Commit an edit only when the complete replacement satisfies the mutation.
  // A failed search must not leak exclusions or missing stops into the next turn.
  const editingExisting = state.preserveExistingPlaces && Boolean(input.currentPlan?.items.length);
  const mutationProblems = editingExisting && input.currentPlan
    ? courseMutationProblems(input.currentPlan, recommendation, state)
    : [];
  console.info("date_course_pipeline", JSON.stringify({ traceId,
    outcome: !recommendation.items.length ? "no_course" : mutationProblems.length ? "mutation_rejected" : recommendation.source,
    candidateCount: agentRun.candidates.length, cachedEvidenceCandidates: evidencePool.filter(candidate => candidate.evidence?.length).length,
    candidateObservations: dateContext.observations.length,
    agentToolCalls,
    agentAttempts: agentRun.attempts, agentRepairCandidates: agentRun.newCandidatesOnRepair,
    verifierIssueCount: agentRun.verifierIssues.length,
    taskPlanStop: taskPlan.stopReason, taskObjectives: taskPlan.objectives.map(objective => objective.id),
    unresolvedTasks: taskPlan.unresolvedActivities,
    stopCount: recommendation.items.length,
    roleCounts: recommendation.recommendations.reduce<Record<string, number>>((counts, place) => {
      const slot = place.activitySlot ?? "unknown";
      counts[slot] = (counts[slot] ?? 0) + 1;
      return counts;
    }, {}),
    addStop: state.addStop, userRequestCount: state.userRequests?.length ?? 0,
    intentMs: Math.round(intentDone - traceStarted), briefMs: Math.round(discoveryDone - intentDone),
    discoveryMs: Math.round(discoveryDone - traceStarted), searchMs: Math.round(searchDone - discoveryDone),
    baseSearchMs: Math.round(baseSearchDone - discoveryDone), leadMs: Math.round(leadDoneAt - leadStartedAt),
    geoLeadMs: Math.round(geoLeadDone - baseSearchDone), rescueMs: Math.round(poolReady - geoLeadDone),
    evidenceMs: Math.round(evidenceDone - poolReady), hydrationMs: Math.round(searchDone - evidenceDone),
    designMs: Math.round(designDone - searchDone), mutationProblemCount: mutationProblems.length,
    modelRejectedCount: recommendation.design?.rejectionReasons?.length ?? 0 }));
  if (!recommendation.items.length || mutationProblems.length) {
    const text = editingExisting
      ? mutationProblems.includes("교체로 동선이 크게 늘어남")
        ? "기존 코스는 그대로 두었어요. 찾은 대체 장소는 이동 거리가 크게 늘어나서 넣지 않았어요. 다른 분위기나 조금 더 넓은 지역을 알려 주시면 다시 찾아볼게요."
        : mutationProblems.includes("새 카페의 공간 근거 부족")
          ? "기존 코스는 그대로 두었어요. 새 카페의 공간 분위기를 확인할 근거가 없어 교체하지 않았어요. 다른 동네까지 넓혀 찾거나 원하시는 카페 이름을 알려 주세요."
        : "기존 코스는 그대로 유지했어요. 요청한 변경을 만족하는 새 장소와 동선을 아직 확보하지 못했어요. 원하는 음식이나 활동을 알려 주시면 그 조건으로 다시 찾아볼게요."
      : recommendation.design?.rejectionReasons?.some(reason => reason.includes("여행 핵심 장소 근거 부족"))
        ? "여행지의 핵심 장소에서 무엇을 경험할 수 있는지 확인할 근거를 확보하지 못했어요. 검증되지 않은 장소로 1박2일 코스를 확정하지 않았어요. 잠시 뒤 다시 조사하거나, 꼭 가고 싶은 장소를 알려 주세요."
        : recommendation.design?.rejectionReasons?.some(reason => reason.includes("알레르기 안전성 미확인"))
          ? "음식 알레르기 안전성을 확인할 자료가 없어 식당을 포함한 코스를 확정하지 않았어요. 이용 가능한 식당을 알려 주시면 그 장소를 기준으로 이어서 짜드릴게요."
        : recommendation.design?.rejectionReasons?.some(reason => reason.includes("실제 보행 경로와 지정한 시간의 충돌"))
          ? "실제 보행 경로로 확인하니 알려주신 시간 안에 이동과 체류를 마치기 어려워요. 종료 시간을 늦추거나 장소를 한 곳 줄여서 다시 짤 수 있어요."
        : "원하신 장소 구성과 동선을 함께 만족하는 코스를 충분히 확인하지 못했어요. 꼭 가고 싶은 곳 한 곳을 정하거나 탐색할 동네를 조금 넓혀 볼까요?";
    return withLimitedTasks(() => chatResult({ headline: "", lines: [text] },
      editingExisting ? input.currentPlan!.state : state), state);
  }
  const completed = await withLimitedTasks(() => recommendation, state);
  dateContext.observations.push(...taskExecutionObservations);
  return completed;
}

/** Existing action and AIPlannerResult contract stay unchanged. */
export async function recommendDatePlan(input: RecommendDatePlanInput):
  Promise<AIPlannerResult | { error: string }> {
  return recommendDatePlanCore(input);
}

/** The editor carries a bounded read model beside the unchanged planner result. */
export async function recommendDatePlanWithSession(input: RecommendDatePlanInput & {
  planningSessionId: string; sessionCandidates?: SessionCandidateContext | null;
}): Promise<{ result: AIPlannerResult | { error: string }; sessionCandidates: SessionCandidateContext }> {
  const sessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(input.planningSessionId) ? input.planningSessionId : randomUUID();
  const previous = verifiedSessionCandidates(input.sessionCandidates, sessionId);
  const capture = { previous, records: [] as DateCandidateRecord[],
    supplementaryRecords: [] as DateCandidateRecord[],
    supplementaryShown: [] as Array<{ name: string; address?: string }>,
    feedbackEntries: [] as SessionFeedbackEntry[],
    turnId: `${sessionId}:${(previous?.turnCount ?? 0) + 1}` };
  const result = await recommendDatePlanCore(input, capture);
  if ("error" in result) return { result, sessionCandidates: previous
    ?? sealSessionCandidates(mergeSessionCandidates(null, [], { sessionId,
      observedAt: new Date().toISOString(), turnId: `${sessionId}:0` })) };
  try {
    const observedAt = new Date().toISOString();
    const resetSession = input.previousState?.intent === "reset"
      || result.status === "plan" && /^새(?:로운)?\s*(?:데이트|여행)\s*(?:계획|코스)/
        .test((input.message ?? "").trim());
    const capturedRecords = [...capture.records, ...capture.supplementaryRecords];
    const next = mergeSessionCandidates(previous, capturedRecords, {
      sessionId, observedAt,
      turnId: `${sessionId}:${(previous?.turnCount ?? 0) + 1}`,
      shownPlaces: [...sessionShownPlaces(result), ...capture.supplementaryShown],
      previousPlan: resetSession ? null : input.currentPlan,
      currentPlan: result.status === "plan" ? result : resetSession ? null : input.currentPlan,
      reset: resetSession,
    });
    next.feedback = mergeSessionFeedback(resetSession ? null : previous?.feedback,
      resetSession ? [] : capture.feedbackEntries);
    const observation = candidateSessionObservation(previous, next, capturedRecords, observedAt);
    if (process.env.NODE_ENV === "development") console.info("date_candidate_session", JSON.stringify(observation.data));
    return { result, sessionCandidates: sealSessionCandidates(next) };
  } catch {
    // Session history is supplemental; it cannot fail the legacy result.
    return { result, sessionCandidates: previous ?? sealSessionCandidates(mergeSessionCandidates(null, [], {
      sessionId, observedAt: new Date().toISOString(),
      turnId: `${sessionId}:0` })) };
  }
}

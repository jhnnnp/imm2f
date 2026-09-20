"use server";

import { createHash } from "node:crypto";
import { getAppSession } from "@/features/auth/session";
import { listPlaces } from "@/features/places/actions";
import { analyzePreferencesWithOpenAi, type PreferenceInsight } from "@/lib/openai/analyzePreferences";
import { getOpenAiModel } from "@/lib/openai/env";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { proposePlanEditsWithOpenAi } from "@/lib/openai/editPlan";
import { generatePlanOptionsWithOpenAi } from "@/lib/openai/generatePlan";
import { recommendDatePlanWithOpenAi } from "@/lib/openai/recommendDatePlan";
import { interpretDateRequest } from "@/lib/openai/interpretDateRequest";
import { loadTasteBoard } from "@/features/taste/actions";
import { applyTasteFallback, applyTasteHarshAllow, seedFromProfile, violatesTasteAvoid } from "@/features/taste/compare";
import { applyRanking } from "@/lib/openai/rank";
import { searchKakaoPlacesRemote } from "@/lib/kakao/local";
import { searchTourPlacesRemote } from "@/lib/tourapi/client";
import { isTourApiConfigured } from "@/lib/tourapi/env";
import { festivalPeriodCoversYmd } from "@/lib/tourapi/festivalSchedule";
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
  planDayYmd,
  activitySearchIntents,
  searchIntents,
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
} from "@/features/ai/dateBrief";
import { allowsHarshDateMeal, applyCourseDelta, bothWantNames, candidateActivitySlot, diversifyDateCatalog, isOffDateVenue, preferredSavedNames, recentPlaceNames, toDateRanking } from "@/features/ai/dateCourse";
import { chatSituationFromMessage, composeDateChat, dateChatCard, cardToText } from "@/lib/openai/composeDateChat";
import { hydrateDateCandidates } from "@/lib/places/detailCache";
import { routeDateChat } from "@/lib/openai/routeDateChat";
import { editCurrentCourse } from "./editCurrentCourse";
import type { ChatRoute } from "./chatRoute";
import { recommendPlacesWithOpenAi } from "@/lib/openai/recommendPlaces";
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
  return { ...state, conversationNotes: [...state.conversationNotes, message].slice(-MAX_CONVERSATION_NOTES) };
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
}): Promise<AIPlannerResult> {
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
  const baseState = withAreas(noteTurn(input.state, input.message), uniqueStrings([area, ...selectedAreas(input.state)], 3));

  const [{ places: saved }, insight, anchorSearch, ...planSearches] = await Promise.all([
    listPlaces(),
    loadLatestCoupleInsight(),
    searchKakaoPlacesRemote({ query: area, page: 1 }),
    ...placeSearchPlans(ask).map(plan => searchKakaoPlacesRemote({
      region: plan.region,
      query: plan.query,
      category: plan.category,
      page: plan.page,
    })),
  ]);
  const anchor = anchorSearch.ok
    ? (anchorSearch.places.find(candidate => candidate.name.replace(/\s/g, "").includes(area.replace(/\s/g, ""))) ?? anchorSearch.places[0])
    : undefined;
  const geoSearches = anchor && (ask.kind === "restaurant" || ask.kind === "cafe")
    ? await Promise.all([1, 2].map(page => searchKakaoPlacesRemote({
      category: ask.kind === "restaurant" ? "restaurant" : "cafe",
      query: ask.kind === "restaurant" && ask.query !== "맛집" ? ask.query : undefined,
      x: anchor.coordinates[0],
      y: anchor.coordinates[1],
      radius: PLACE_SEARCH_RADIUS_METERS,
      page,
    })))
    : [];

  const pool: DiscoverCandidate[] = [];
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
  for (const place of saved) {
    if (["dislike", "not_interested"].includes(place.userStatus) || ["dislike", "not_interested"].includes(place.partnerStatus)) continue;
    const candidate = placeToCandidate(place);
    if (!candidate || !matchesPlaceKind(candidate, ask.kind)) continue;
    const meters = anchor ? distanceMeters(anchor.coordinates, candidate.coordinates) : null;
    if (meters != null && meters > PLACE_SEARCH_RADIUS_METERS * 2) continue;
    pool.push({ ...candidate, searchRegion: area, distanceMeters: meters == null ? undefined : Math.round(meters) });
  }

  const allowHarsh = placeAskHarshAllow(input.message, ask, applyTasteHarshAllow(allowsHarshDateMeal(input.message), input.message, input.avoidFoods));
  const filtered = filterPlaceCandidates(pool, ask, {
    allowHarsh,
    exclude: uniqueStrings([...input.state.excludedPlaces, ...alreadyShown], 20),
    violatesAvoid: blob => violatesTasteAvoid(blob, input.avoidFoods),
  });
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
  const picked = await recommendPlacesWithOpenAi({
    message: input.message,
    ask,
    candidates: hydrated,
    savedNames: preferredSavedNames(saved),
    bothWant: bothWantNames(saved),
    coupleTaste: coupleTasteBrief(input.tasteBoard, insight, input.avoidFoods),
    conversation: input.conversation,
    alreadyShown,
  });
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

export async function recommendDatePlan(input: {
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
}): Promise<AIPlannerResult | { error: string }> {
  const message = (input.message ?? input.prompt ?? "").trim().slice(0, 800);
  const previousState = input.previousState;
  const previousStops = input.previousStops?.length
    ? input.previousStops
    : (input.previousPlaceNames ?? []).map(name => ({ name, category: "" }));
  const tasteBoard = await loadTasteBoard();
  const tasteSeed = tasteBoard.compare?.seed ?? (tasteBoard.you ? seedFromProfile(tasteBoard.you) : null);
  const avoidFoods = tasteSeed?.avoidFoods ?? [];
  const filledPrevious = previousState && tasteSeed ? applyTasteFallback(previousState, tasteSeed) : previousState;

  // A place request that was waiting for an area resumes once the area chip is picked.
  if (!message && filledPrevious?.placeAsk && !filledPrevious.placeAsk.area && selectedAreas(filledPrevious).length) {
    return recommendPlacesForChat({
      message: `${selectedAreas(filledPrevious)[0]} ${filledPrevious.placeAsk.query} ${PLACE_KIND_LABEL[filledPrevious.placeAsk.kind]} 추천해줘`,
      ask: { ...filledPrevious.placeAsk, area: selectedAreas(filledPrevious)[0] },
      state: filledPrevious,
      conversation: input.conversation,
      avoidFoods,
      tasteBoard,
    });
  }

  let pickedPlaces: string[] = [];
  let courseEdit: ChatRoute["edit"];
  if (message) {
    const currentCourse = previousStops.map(stop => stop.name);
    const route = await routeDateChat({
      message,
      state: filledPrevious,
      hasCourse: currentCourse.length > 0,
      currentCourse,
      currentCategories: previousStops.map(stop => stop.category),
      conversation: input.conversation,
    });
    const state = filledPrevious ?? emptyDateBrief();
    if (route.mode === "chat") {
      const situation = chatSituationFromMessage(message) ?? "small_talk";
      const card = await composeDateChat({
        situation,
        userMessage: message,
        state,
        extras: { currentCourse, conversation: input.conversation },
      });
      return chatResult(card, noteTurn(state, message));
    }
    if (route.mode === "question") {
      const insight = await loadLatestCoupleInsight();
      const card = await answerDateQuestion({
        message,
        state,
        stops: toQuestionStops(input.courseStops, previousStops),
        shownStops: toQuestionStops(input.shownStops, []),
        coupleTaste: coupleTasteBrief(tasteBoard, insight, avoidFoods),
        conversation: input.conversation,
      });
      return chatResult(card, noteTurn(state, message));
    }
    if (route.mode === "places" && route.placeAsk) {
      return recommendPlacesForChat({
        message,
        ask: route.placeAsk,
        state,
        conversation: input.conversation,
        avoidFoods,
        tasteBoard,
      });
    }
    pickedPlaces = route.pickedPlaces ?? [];
    courseEdit = route.edit;
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

  if (courseEdit && input.currentPlan?.items.length && input.currentPlan.items.length === input.currentPlan.recommendations.length) {
    return editCurrentCourse(input.currentPlan, courseEdit, interpretation.state);
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
      dateLabel: interpretation.state.dateLabel || input.dateLabel || null,
      requiredPlaces: uniqueStrings([
        ...pickedPlaces,
        ...interpretation.state.requiredPlaces.filter(place => !/^(?:방탈출|보드게임|볼링|오락실|만화카페|VR(?:카페|\s*체험)?|실내(?:\s*놀거리)?)$/.test(place)),
      ], 6),
    },
  });
  const interpreted = tasteSeed ? applyTasteFallback(interpretedRaw, tasteSeed) : interpretedRaw;
  const slot = missingSlot(interpreted);
  const situation = message ? chatSituationFromMessage(message) : null;
  if (situation) {
    const card = dateChatCard({ situation, userMessage: message, state: interpreted });
    if (slot) return clarificationReply(slot, interpreted, card);
    return { status: "chat", message: cardToText(card), card, state: interpreted, options: card.suggestions, multiple: false };
  }
  if (slot) {
    const question = slotQuestion(slot, interpreted);
    const card = slot === "area"
      ? dateChatCard({ situation: "need_area", userMessage: message, state: interpreted })
      : { headline: "", lines: [question.message], suggestions: question.options };
    return clarificationReply(slot, interpreted, card);
  }

  const state = applyDateDefaults(interpreted);

  const selectedRegions = selectedAreas(state);
  const searchRegions = expandedSearchRegions(state);
  const radius = areaScopeMeters(state);
  const time = assumedTimeWindow(state);
  const condition = {
    dateLabel: state.dateLabel || "날짜 미정",
    startTime: time.startTime,
    endTime: time.endTime,
    budget: state.budgetWon ?? null,
    region: selectedRegions.join(" · "),
    timeSpecified: time.specified,
  };
  if (!condition.region) {
    return clarificationReply("area", state, dateChatCard({ situation: "need_area", userMessage: message, state }));
  }

  const [{ places: saved }, insight, archives] = await Promise.all([
    listPlaces(),
    loadLatestCoupleInsight(),
    listArchivedDatePlans(),
  ]);
  const recentlyVisited = [...recentPlaceNames(archives.dates)];
  const retainedPlaces = state.preserveExistingPlaces ? previousStops.map(stop => stop.name.trim()).filter(Boolean).slice(0, 5) : [];
  const directQueries = uniqueStrings([...state.requiredPlaces, ...retainedPlaces]).filter(name => !state.excludedPlaces.includes(name));
  const keywordIntents = searchIntents(state);
  const geoIntents = activitySearchIntents(state);
  const allowHarsh = applyTasteHarshAllow(allowsHarshDateMeal(message, state.cuisine), message, avoidFoods);
  const searchKeyword = (page: number) => Promise.all(keywordIntents.map(intent => searchKakaoPlacesRemote({
    region: intent.region,
    category: intent.category,
    query: intent.query,
    page,
  })));
  const shortlist = (state.shownPlaces ?? [])
    .filter(name => !directQueries.includes(name) && !state.excludedPlaces.includes(name))
    .slice(0, 6);
  const [explicitSearches, areaSearches, intentSearches, intentSearches2, shortlistSearches] = await Promise.all([
    Promise.all(directQueries.map(query => searchKakaoPlacesRemote({ query, region: searchRegions.at(-1), page: 1 }))),
    Promise.all(selectedRegions.map(region => searchKakaoPlacesRemote({ query: region, page: 1 }))),
    searchKeyword(1),
    searchKeyword(2),
    Promise.all(shortlist.map(query => searchKakaoPlacesRemote({ query, region: searchRegions.at(-1), page: 1 }))),
  ]);

  const unique = new Map<string, Extract<(typeof explicitSearches)[number], { ok: true }>["places"][number]>();
  const slotIngest = new Map<string, number>();
  const remember = (candidate: Extract<(typeof explicitSearches)[number], { ok: true }>["places"][number], searchRegion?: string, required = false) => {
    const key = `${candidate.externalSource}:${candidate.externalPlaceId}`;
    if (unique.has(key)) return;
    if (!required && isOffDateVenue(candidate, { allowHarsh, allowKaraoke: state.activities.includes("indoor") })) return;
    const slot = candidateActivitySlot(candidate);
    const cap = slot === "cafe" ? 8 : 12;
    const count = slotIngest.get(slot) ?? 0;
    if (!required && count >= cap) return;
    slotIngest.set(slot, count + 1);
    unique.set(key, searchRegion ? { ...candidate, searchRegion } : candidate);
  };
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
    if (["dislike", "not_interested"].includes(place.userStatus) && ["dislike", "not_interested"].includes(place.partnerStatus)) continue;
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
    ]);
    for (const result of geoSearches) {
      if (!result.ok) continue;
      for (const candidate of result.places.slice(0, 15)) remember(candidate, selectedRegions[0]);
    }
  };
  await Promise.all([ingestGeo(1, true), ingestGeo(2, false)]);
  const decorate = (candidate: Extract<(typeof explicitSearches)[number], { ok: true }>["places"][number]) => {
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
  const admit = (candidate: Extract<(typeof explicitSearches)[number], { ok: true }>["places"][number]) => {
    const required = state.requiredPlaces.some(name => candidate.name.includes(name) || name.includes(candidate.name));
    return isDateCourseCandidate(candidate, state.requiredPlaces)
      && !state.excludedPlaces.some(name => candidate.name.includes(name) || name.includes(candidate.name))
      && !violatesTasteAvoid(`${candidate.name} ${candidate.categoryLabel} ${candidate.detailedCategory ?? ""}`, avoidFoods)
      && (candidate.category !== "festival" || festivalPeriodCoversYmd(candidate.openingHours, planDayYmd(state)))
      && (required || !isOffDateVenue(candidate, { allowHarsh, allowKaraoke: state.activities.includes("indoor") }));
  };
  const currentPool = () => {
    const scoped = (anchors.length
      ? [...unique.values()].filter(candidate => anchors.some(anchor => {
        const hop = distanceMeters(anchor.coordinates, candidate.coordinates);
        return hop <= (candidate.category === "festival" ? Math.max(radius, 4000) : radius);
      }))
      : [...unique.values()])
      .filter(admit)
      .map(decorate);
    return scoped.length >= 2 ? scoped : [...unique.values()].filter(admit).map(decorate);
  };
  let pool = currentPool();
  const wantedSlots = discovery;
  const poolSlots = () => new Set(pool.map(candidateActivitySlot));
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
  const rankContext = {
    savedPositive: preferredSavedNames(saved),
    savedBoth: bothWantNames(saved),
    recentlyVisited: new Set(recentlyVisited),
    commonTastes: [...(tasteBoard.compare?.overlaps ?? []), ...(insight?.commonTastes ?? []).map(item => item.label)].filter(Boolean),
    activities: dateSpine(state),
    allowHarsh,
    trip: isTravelPlan(state),
  };
  const ranked = applyRanking(pool, toDateRanking(pool, rankContext));
  const onMix = isExclusiveCrawl(state) && state.activities.length
    ? ranked.filter(candidate => fitsWantedActivities(candidate, state.activities))
    : ranked;
  const catalog = diversifyDateCatalog(onMix.length >= 8 ? onMix : ranked, 40);
  const candidates = await hydrateDateCandidates(catalog, saved);
  if (candidates.length < 2) {
    const suggestions = nearbyAreaSuggestions(state);
    const card = dateChatCard({
      situation: "no_places",
      userMessage: message,
      state,
      extras: { region: condition.region, suggestions },
    });
    return {
      status: "chat",
      message: cardToText(card),
      card,
      state,
      options: suggestions,
      multiple: false,
      slot: "area",
    };
  }
  const recommendation = await recommendDatePlanWithOpenAi({
    prompt: message || `${condition.region}에서 ${state.activities.join(", ") || "하루"} 데이트`,
    condition,
    candidates,
    saved,
    state,
    recentlyVisited,
    conversation: input.conversation,
    currentCourse: previousStops,
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
  if (!recommendation.items.length) {
    const text = "이동과 관람 시간을 넣으면 요청한 시간 안에 코스를 만들기 어려워요. 시간을 늘리거나 원하는 장소를 줄여 볼까요?";
    return chatResult({ headline: "", lines: [text] }, state);
  }
  return recommendation;
}

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
  missingSlot,
  nearbyAreaSuggestions,
  planDayYmd,
  activitySearchIntents,
  searchIntents,
  selectedAreas,
  slotQuestion,
  uniqueStrings,
} from "@/features/ai/dateBrief";
import { allowsHarshDateMeal, applyCourseDelta, diversifyDateCatalog, isOffDateVenue, preferredSavedNames, recentPlaceNames, toDateRanking } from "@/features/ai/dateCourse";
import { chatSituationFromMessage, dateChatCard, cardToText } from "@/lib/openai/composeDateChat";
import type { AIChatCard, AIPlannerClarification, AIPlannerResult, AIPlannerState, DateChatTurn, DateIntakeSlot, DatePreviousStop, PlanChange, PlanItem, PlanKind, PlanOption } from "@/features/planning/types/plan";
import type { Place } from "@/features/places/types/place";

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

export async function recommendDatePlan(input: {
  message?: string;
  prompt?: string;
  previousPlaceNames?: string[];
  previousStops?: DatePreviousStop[];
  previousState?: AIPlannerState;
  dateLabel?: string;
  conversation?: DateChatTurn[];
}): Promise<AIPlannerResult | { error: string }> {
  const message = (input.message ?? input.prompt ?? "").trim().slice(0, 800);
  const previousState = input.previousState;
  const previousStops = input.previousStops?.length
    ? input.previousStops
    : (input.previousPlaceNames ?? []).map(name => ({ name, category: "" }));
  if (!message && missingSlot(previousState)) {
    const slot = missingSlot(previousState)!;
    const question = slotQuestion(slot, previousState);
    const card = slot === "area"
      ? dateChatCard({ situation: "need_area", userMessage: "", state: previousState! })
      : { headline: "", lines: [question.message], suggestions: question.options };
    return clarificationReply(slot, previousState!, card);
  }

  const interpretation = message
    ? await interpretDateRequest({
      message,
      previousState,
      previousPlaceNames: previousStops.map(stop => stop.name),
      dateLabel: input.dateLabel,
      conversation: input.conversation,
    })
    : { state: { ...previousState!, dateLabel: input.dateLabel || previousState?.dateLabel || null, pendingSlot: missingSlot(previousState) }, slot: missingSlot(previousState), reply: "" };

  const interpreted = applyCourseDelta({
    message,
    previousStops,
    state: {
      ...interpretation.state,
      dateLabel: interpretation.state.dateLabel || input.dateLabel || null,
      requiredPlaces: interpretation.state.requiredPlaces.filter(place => !/^(?:방탈출|보드게임|볼링|오락실|만화카페|VR(?:카페|\s*체험)?|실내(?:\s*놀거리)?)$/.test(place)),
    },
  });
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
    budget: null,
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
  const allowHarsh = allowsHarshDateMeal(message, state.cuisine);
  const searchKeyword = (page: number) => Promise.all(keywordIntents.map(intent => searchKakaoPlacesRemote({
    region: intent.region,
    category: intent.category,
    query: intent.query,
    page,
  })));
  const [explicitSearches, areaSearches, intentSearches] = await Promise.all([
    Promise.all(directQueries.map(query => searchKakaoPlacesRemote({ query, region: searchRegions.at(-1), page: 1 }))),
    Promise.all(selectedRegions.map(region => searchKakaoPlacesRemote({ query: region, page: 1 }))),
    searchKeyword(1),
  ]);

  const unique = new Map<string, Extract<(typeof explicitSearches)[number], { ok: true }>["places"][number]>();
  const remember = (candidate: Extract<(typeof explicitSearches)[number], { ok: true }>["places"][number], searchRegion?: string) => {
    unique.set(`${candidate.externalSource}:${candidate.externalPlaceId}`, searchRegion ? { ...candidate, searchRegion } : candidate);
  };
  const ingestKeyword = (results: typeof intentSearches) => {
    for (const [index, result] of results.entries()) {
      if (!result.ok) continue;
      for (const candidate of result.places.slice(0, 15)) remember(candidate, keywordIntents[index]?.region ?? searchRegions[0]);
    }
  };
  for (const result of explicitSearches) {
    if (!result.ok) continue;
    for (const candidate of result.places) remember(candidate);
  }
  ingestKeyword(intentSearches);
  for (const place of saved) {
    if (["dislike", "not_interested"].includes(place.userStatus) && ["dislike", "not_interested"].includes(place.partnerStatus)) continue;
    const candidate = placeToCandidate(place);
    if (!candidate) continue;
    if (state.activities.length && !state.activities.some(activity => matchesActivity(candidate, activity))) continue;
    remember(candidate, searchRegions[0]);
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
  await ingestGeo(1, true);
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
  if (pool.length < 18) {
    const extraPages = await Promise.all([searchKeyword(2), ingestGeo(2, false)]);
    ingestKeyword(extraPages[0]);
    pool = currentPool();
  }
  if (pool.length < 2) {
    const extras = await Promise.all(selectedRegions.flatMap(region => [
      searchKakaoPlacesRemote({ query: `${region} 카페`, page: 1 }),
      searchKakaoPlacesRemote({ query: `${region} 맛집`, page: 1 }),
      searchKakaoPlacesRemote({ query: `${region} 공원`, page: 1 }),
    ]));
    for (const result of extras) {
      if (!result.ok) continue;
      for (const candidate of result.places) remember(candidate, selectedRegions[0]);
    }
    pool = currentPool();
  }
  const rankContext = {
    savedPositive: preferredSavedNames(saved),
    recentlyVisited: new Set(recentlyVisited),
    commonTastes: (insight?.commonTastes ?? []).map(item => item.label).filter(Boolean),
    activities: state.activities,
    allowHarsh,
  };
  const candidates = diversifyDateCatalog(applyRanking(pool, toDateRanking(pool, rankContext)), 40);
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
  return recommendDatePlanWithOpenAi({
    prompt: message || `${condition.region}에서 ${state.activities.join(", ") || "하루"} 데이트`,
    condition,
    candidates,
    saved,
    state,
    recentlyVisited,
    conversation: input.conversation,
    coupleTaste: insight ? {
      summary: insight.summary,
      commonTastes: insight.commonTastes,
      youHighlights: insight.youHighlights,
      partnerHighlights: insight.partnerHighlights,
    } : null,
  });
}

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
import { searchKakaoPlacesRemote } from "@/lib/kakao/local";
import { isDateCourseCandidate } from "@/lib/kakao/dateCandidate";
import { distanceMeters } from "@/features/places/geo";
import type { AIPlanCondition, AIPlannerResult, AIPlannerState } from "@/features/planning/types/plan";
import type { PlaceCategoryId } from "@/features/places/types/place";
import type { PlanChange, PlanItem, PlanKind, PlanOption } from "@/features/planning/types/plan";
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

function extractRegion(text: string) {
  const knownRegion = [...text.matchAll(/성수|홍대|연남|잠실|한남|을지로|익선동|서울숲|강남|건대입구|뚝섬/g)].at(-1)?.[0];
  const suffixedRegion = [...text.matchAll(/([가-힣]{2,12}?(?:역|동|구|로|길|시))(?=\s|에서|근처|주변|으로|$)/g)].at(-1)?.[1];
  const conversationalRegion = [...text.matchAll(/([가-힣]{2,12}?)(?=\s*(?:데이트|코스|주변|근처))/g)]
    .map(match => match[1])
    .filter(value => !["주변", "근처", "조용한", "즐거운", "데이트"].includes(value))
    .at(-1);
  return knownRegion ?? suffixedRegion ?? conversationalRegion ?? "";
}

function extractRegions(text: string) {
  const known = [...text.matchAll(/성수|홍대|연남|잠실|한남|을지로|익선동|서울숲|강남|건대입구|뚝섬/g)].map(match => match[0]);
  const suffixed = [...text.matchAll(/([가-힣]{2,12}?(?:역|동|구|시))(?=\s|에서|근처|주변|으로|가서|$)/g)].map(match => match[1]);
  return [...new Set([...known, ...suffixed])].slice(0, 3);
}

function inferCondition(prompt: string, fallbackPrompt = ""): AIPlanCondition {
  const timeRange = prompt.match(/(\d{1,2})(?::(\d{2}))?\s*(?:시|:)?\s*(?:부터|~|〜|-)\s*(\d{1,2})(?::(\d{2}))?/);
  const singleTime = prompt.match(/(?:오후\s*)?(\d{1,2})\s*시/);
  const startHour = timeRange ? Number(timeRange[1]) : singleTime ? Number(singleTime[1]) + (prompt.includes("오후") && Number(singleTime[1]) < 12 ? 12 : 0) : 14;
  const startMinute = timeRange?.[2] ? Number(timeRange[2]) : 0;
  const endHour = timeRange ? Number(timeRange[3]) : 21;
  const endMinute = timeRange?.[4] ? Number(timeRange[4]) : 0;
  const budgetMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(만|천)?\s*원/);
  const budget = budgetMatch ? Math.round(Number(budgetMatch[1]) * (budgetMatch[2] === "만" ? 10000 : budgetMatch[2] === "천" ? 1000 : 1)) : null;
  const region = extractRegion(prompt) || extractRegion(fallbackPrompt);
  const dateLabel = prompt.match(/이번\s*주말|이번\s*(?:주\s*)?[월화수목금토일]요일|다음\s*(?:주\s*)?[월화수목금토일]요일/)?.[0] ?? "날짜 미정";
  return {
    dateLabel,
    startTime: `${String(Math.min(23, startHour)).padStart(2, "0")}:${String(Math.min(59, startMinute)).padStart(2, "0")}`,
    endTime: `${String(Math.min(23, endHour)).padStart(2, "0")}:${String(Math.min(59, endMinute)).padStart(2, "0")}`,
    budget,
    region,
  };
}

function extractExplicitPlaces(prompt: string) {
  return [...prompt.matchAll(/([가-힣A-Za-z0-9]{2,18}?(?:공원|미술관|박물관|전시관|시장|식당|카페|역))(?=\s|에서|으로|가고|들(?:러|렀)|도|$)/g)]
    .map(match => match[1])
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 3);
}

function presentCandidateName(name: string, requiredPlaces: string[]) {
  const park = requiredPlaces.find(place => place.endsWith("공원") && name.replace(/\s/g, "").includes(place.replace(/\s/g, "")));
  if (!park || !name.includes("진출입로")) return name;
  const access = name.match(/(옥수|금호)[가-힣]*(?:나들목|경사로)/)?.[0];
  return access ? `${park} ${access}` : park;
}

export async function recommendDatePlan(input: { prompt: string; latestPrompt?: string; previousPlaceNames?: string[]; previousState?: AIPlannerState }): Promise<AIPlannerResult | { error: string }> {
  const prompt = input.prompt.trim().slice(0, 800);
  const latestPrompt = (input.latestPrompt ?? input.prompt).trim().slice(0, 400);
  if (prompt.length < 2) return { error: "원하는 지역이나 데이트를 조금 더 자세히 말해 주세요." };
  const { places: saved } = await listPlaces();
  const inferred = inferCondition(latestPrompt, prompt);
  const interpretation = await interpretDateRequest({
    message: latestPrompt,
    fallbackRegion: inferred.region,
    previousState: input.previousState,
    previousPlaceNames: input.previousPlaceNames ?? [],
  });
  const mentionedRegions = extractRegions(latestPrompt);
  const state = {
    ...interpretation.state,
    regions: [...new Set([...(interpretation.state.regions ?? []), ...mentionedRegions])].slice(0, 3),
    requiredPlaces: interpretation.state.requiredPlaces.filter(place => !/^(?:방탈출|보드게임|볼링|오락실|만화카페|VR(?:카페|\s*체험)?|실내 놀거리)$/.test(place)),
  };
  const searchRegions = state.regions.length ? state.regions : [state.region || inferred.region].filter(Boolean);
  const condition = { ...inferred, region: searchRegions.join(" · ") || state.region || inferred.region };
  if (!condition.region) return { error: "지역을 찾지 못했어요. 역·동 이름을 포함해 주세요. 예: 왕십리역, 성수동, 잠실" };
  const latestPlaces = extractExplicitPlaces(latestPrompt);
  const hasActivityBetweenPlaces = /카페|커피|디저트|저녁|점심|아침|식사|밥|산책|전시|영화|공연/.test(latestPrompt);
  const routeQuestion = input.previousState && latestPlaces.length >= 2 && !hasActivityBetweenPlaces
    ? `${latestPlaces.at(-1)}에는 카페나 저녁 식사 후에 갈까요, 아니면 바로 이동할까요?`
    : "";
  const clarifyingQuestion = routeQuestion || interpretation.clarifyingQuestion;
  if (clarifyingQuestion) {
    const routeOptions = ["카페 후 이동", "저녁 식사 후 이동", "바로 이동"];
    const activityOptions = ["카페", "식사", "산책", "전시", "실내 놀거리", "야경"];
    const indoorPlayOptions = ["방탈출", "보드게임", "볼링", "오락실", "만화카페", "VR 체험"];
    const cuisineOptions = ["한식", "일식", "중식", "양식", "상관없음"];
    const asksCuisine = /어떤.*(?:음식|식당)|음식점|무엇을\s*먹|메뉴/.test(clarifyingQuestion);
    const asksIndoorPlay = /실내|놀거리|방탈출|보드게임|볼링|오락실|만화카페|VR/.test(clarifyingQuestion)
      && state.preferredCategories.includes("실내 놀거리");
    return {
      status: "clarification",
      message: clarifyingQuestion,
      state: { ...state, pendingQuestion: clarifyingQuestion },
      options: routeQuestion ? routeOptions : asksCuisine ? cuisineOptions : asksIndoorPlay ? indoorPlayOptions : activityOptions,
      multiple: !routeQuestion && !asksCuisine,
    };
  }

  const categories: PlaceCategoryId[] = ["cafe", "restaurant", "nature", "photo", "book"];
  const explicitPlaces = [...new Set([...state.requiredPlaces, ...extractExplicitPlaces(latestPrompt)])];
  const retainedPlaces = state.preserveExistingPlaces ? (input.previousPlaceNames ?? []).map(name => name.trim()).filter(Boolean).slice(0, 5) : [];
  const directQueries = [...new Set([...explicitPlaces, ...retainedPlaces])].filter(name => !state.excludedPlaces.includes(name));
  const wantsPlay = /놀거리|놀고|놀러|방탈출|볼링|보드게임|게임/.test(prompt) || state.preferredCategories.includes("실내 놀거리");
  const playQueries = ["방탈출", "볼링", "보드게임", "오락실", "만화카페", "VR카페"];
  const activityQueries = wantsPlay
    ? searchRegions.slice(-1).flatMap(region => playQueries.map(query => searchKakaoPlacesRemote({ region, query, page: 1 })))
    : [];
  const [explicitSearches, areaSearches, categorySearches, activitySearches] = await Promise.all([
    Promise.all(directQueries.map(query => searchKakaoPlacesRemote({ query, region: searchRegions.at(-1), page: 1 }))),
    Promise.all(searchRegions.map(region => searchKakaoPlacesRemote({ query: region, page: 1 }))),
    Promise.all(categories.flatMap(category => searchRegions.map(region => searchKakaoPlacesRemote({ region, category, page: 1 })))),
    Promise.all(activityQueries),
  ]);
  const searches = [...explicitSearches, ...categorySearches, ...activitySearches];
  const unique = new Map<string, Extract<(typeof searches)[number], { ok: true }>["places"][number]>();
  for (const result of explicitSearches) {
    if (!result.ok) continue;
    for (const candidate of result.places) unique.set(`${candidate.externalSource}:${candidate.externalPlaceId}`, candidate);
  }
  for (const result of activitySearches) {
    if (!result.ok) continue;
    for (const candidate of result.places.slice(0, 3)) unique.set(`${candidate.externalSource}:${candidate.externalPlaceId}`, { ...candidate, searchRegion: searchRegions.at(-1) });
  }
  for (const [index, result] of categorySearches.entries()) {
    if (!result.ok) continue;
    const searchRegion = searchRegions[index % searchRegions.length];
    for (const candidate of result.places.slice(0, 3)) unique.set(`${candidate.externalSource}:${candidate.externalPlaceId}`, { ...candidate, searchRegion });
  }
  const locatedAnchors = areaSearches.flatMap((result, index) => {
    if (!result.ok) return [];
    const needle = searchRegions[index]?.replace(/(?:역|동|구|시)$/, "").replace(/\s/g, "") ?? "";
    const exact = result.places.find(candidate => candidate.name.replace(/\s/g, "").includes(needle));
    const candidate = exact ?? result.places[0];
    return candidate ? [{ candidate, region: searchRegions[index] }] : [];
  });
  const anchors = locatedAnchors.map(item => item.candidate);
  const geographicallyScoped = (anchors.length
    ? [...unique.values()].filter(candidate => anchors.some(anchor => distanceMeters(anchor.coordinates, candidate.coordinates) <= 6000))
    : [...unique.values()])
    .filter(candidate => isDateCourseCandidate(candidate, state.requiredPlaces))
    .filter(candidate => !state.excludedPlaces.some(name => candidate.name.includes(name) || name.includes(candidate.name)))
    .filter(candidate => !state.avoidedCategories.some(category => `${candidate.categoryLabel} ${candidate.detailedCategory ?? ""}`.includes(category)))
    .map(candidate => {
      const nearestAnchor = locatedAnchors
        .map(anchor => ({ ...anchor, meters: distanceMeters(anchor.candidate.coordinates, candidate.coordinates) }))
        .sort((a, b) => a.meters - b.meters)[0];
      return {
        ...candidate,
        searchRegion: nearestAnchor?.region ?? candidate.searchRegion,
        name: presentCandidateName(candidate.name, state.requiredPlaces),
      };
    });
  const candidates = geographicallyScoped.slice(0, 30);
  if (candidates.length < 2) {
    return { error: `${condition.region} 주변 후보를 충분히 찾지 못했어요. 지역명이나 요청을 조금 바꿔 주세요.` };
  }
  return recommendDatePlanWithOpenAi({
    prompt: `${prompt}\n가장 최근 요청: ${latestPrompt}`,
    condition,
    candidates,
    saved,
    state,
  });
}

import { blocksCourse, type PlanningIssueCode } from "@/features/ai/planningPolicy";
import type { DiscoverCandidate, Place } from "@/features/places/types/place";
import type { AIPlanCondition, AIPlaceRecommendation, AIPlannerReply, AIPlannerState, DateChatTurn, DatePreviousStop, PlanItem } from "@/features/planning/types/plan";
import { discoverPlaceId } from "@/features/places/discover";
import { courseSize, extractCuisine, isTravelPlan, matchesActivity, matchesCuisine } from "@/features/ai/dateBrief";
import {
  assignStartTimes, bothWantNames, candidateActivitySlot, courseSuggestions, dateCandidateKey,
  dateCategoryLabel, defaultDuration, pickCourseMessage,
  preferredSavedNames, travelGapMinutes, type DateCourseRow,
} from "@/features/ai/dateCourse";
import { completeJson } from "./client";
import { enrichDateVenues } from "./enrichDateVenues";
import { buildFallbackCourse, courseSelectionScore, discoveryCatalog, evaluateCourse, evaluatePreparedCourse, feasibleCourseSeeds, hasCafeSpaceEvidence, hasRequestedVenueEvidence, parseCourseProposals, planningStopGuidance, usefulVenueEvidence, wantsCafeAtmosphere, type CourseEvaluation } from "@/features/ai/courseDesign";
import { isOpenAiConfigured } from "./env";
import { distanceMeters } from "@/features/places/geo";
import { fetchFootRoute, type FootLeg, type FootRoute } from "@/lib/routing/footRoute";
import { retrieveDatePlaybook } from "./datePlaybook";
import { tripLocalWindows } from "@/features/ai/planningSupport";
import { toDateIntent } from "@/features/ai/dateIntent";
import type { DateMemoryContext } from "@/features/ai/dateMemory";
import { verifyDateItinerary } from "@/features/ai/dateVerifier";
import { buildCandidateGraph } from "@/features/ai/candidateGraph";
import { affectedRepairDays, preservesUnchangedDays, repairAffectedStop } from "@/features/ai/targetedCourseRepair";
import { hasSemanticPlanningHints, type SemanticPlanningHints } from "@/features/ai/semanticPlanningHints";
import { itineraryOrderMatchesItems } from "@/features/trip/components/dayRoute";
import type { ExperiencePlan } from "@/features/ai/experiencePlan";
import type { ResearchPlan } from "@/features/ai/researchPlan";
import type { CandidateExplorationPreferences } from "@/features/ai/candidateExploration";
export { routeLegsFitSchedule } from "@/features/ai/dateVerifier";

function hopBands(candidate: DiscoverCandidate, pool: DiscoverCandidate[]) {
  const others = pool
    .filter(other => dateCandidateKey(other) !== dateCandidateKey(candidate))
    .map(other => ({
      id: dateCandidateKey(other),
      meters: Math.round(distanceMeters(candidate.coordinates, other.coordinates)),
    }))
    .sort((a, b) => a.meters - b.meters);
  const take = (min: number, max: number, limit: number) => others.filter(item => item.meters >= min && item.meters < max).slice(0, limit);
  return {
    sameBlock: take(0, 150, 3),
    walk: take(150, 1000, 5),
    stretch: take(1000, 2500, 4),
  };
}

export async function footRouteForDays(rows: DateCourseRow[], byId: Map<string, DiscoverCandidate>, days: number,
  maxDailyMeters: number): Promise<FootRoute | null> {
  const groups = Array.from({ length: days }, (_, day) => rows.filter(row => (row.day_index ?? 0) === day));
  const routes = await Promise.all(groups.map(async group => {
    if (group.length < 2) return { provider: "osm_foot" as const, meters: 0, seconds: 0, legs: [] };
    const coordinates = group.map(row => byId.get(String(row.id ?? ""))?.coordinates)
      .filter((value): value is [number, number] => Boolean(value));
    return coordinates.length === group.length ? fetchFootRoute(coordinates) : null;
  }));
  if (routes.some(route => !route || route.meters > maxDailyMeters)) return null;
  const valid = routes as FootRoute[];
  return { provider: "osm_foot", meters: valid.reduce((sum, route) => sum + route.meters, 0),
    seconds: valid.reduce((sum, route) => sum + route.seconds, 0),
    legs: valid.flatMap((route, day) => day < valid.length - 1
      ? [...route.legs, { meters: 0, seconds: 0 }] : route.legs) };
}

function parseClock(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(raw)) return null;
  const [hour, minute] = raw.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTime(value: unknown, fallback: string) {
  return parseClock(value) ?? fallback;
}

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour * 60 + minute + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function conciseVenueReason(text: string) {
  if (text.length <= 175) return text;
  const sentence = text.match(/^.{35,175}?[.!?](?=\s|$)/)?.[0];
  return sentence ?? `${text.slice(0, 155).replace(/\s+\S*$/, "").trim()}…`;
}

function buildReply(
  rows: DateCourseRow[],
  candidates: DiscoverCandidate[],
  condition: AIPlanCondition,
  message: string,
  source: AIPlannerReply["source"],
  state: AIPlannerState,
  saved: Place[],
  walkingLegs?: FootLeg[],
): AIPlannerReply {
  const byId = new Map(candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  const recommendations: AIPlaceRecommendation[] = [];
  const items: PlanItem[] = [];
  const seen = new Set<string>();
  const savedById = new Map(saved.filter(place => place.externalSource && place.externalPlaceId)
    .map(place => [`${place.externalSource}:${place.externalPlaceId}`, place]));
  const maxStops = Math.max(rows.length, courseSize(state).max, state.discovery?.maxStops ?? 0, state.requiredPlaces.length);

  for (const row of rows) {
    const id = String(row.id ?? "");
    const candidate = byId.get(id);
    if (!candidate || seen.has(id) || recommendations.length >= maxStops) continue;
    const savedMatch = savedById.get(id);
    const prefers = Boolean(savedMatch && (["want", "must_visit", "revisit"].includes(savedMatch.userStatus)
      || ["want", "must_visit", "revisit"].includes(savedMatch.partnerStatus)));
    const bothWant = Boolean(savedMatch && ["want", "must_visit", "revisit"].includes(savedMatch.userStatus)
      && ["want", "must_visit", "revisit"].includes(savedMatch.partnerStatus));
    seen.add(id);
    const durationMinutes = clamp(row.duration_minutes, 30, 180, defaultDuration(candidate, state.pace));
    const previousItem = items.at(-1)?.dayIndex === Number(row.day_index ?? 0) ? items.at(-1) : undefined;
    const previousRec = previousItem ? recommendations.at(-1) : undefined;
    const gap = travelGapMinutes(previousRec?.coordinates, candidate.coordinates);
    const earliest = previousItem ? addMinutes(previousItem.startTime, previousItem.durationMinutes + gap) : null;
    const startTime = parseTime(row.start_time, earliest ?? condition.startTime);
    const placeId = discoverPlaceId(candidate.externalSource, candidate.externalPlaceId);
    const meters = previousRec?.coordinates && candidate.coordinates
      ? Math.round(walkingLegs?.[recommendations.length - 1]?.meters ?? distanceMeters(previousRec.coordinates, candidate.coordinates))
      : null;
    const evidence = usefulVenueEvidence(candidate, state);
    // A category or a short distance is already visible elsewhere on the card.
    // Do not recycle it as a supposed venue-specific recommendation reason.
    const event = candidate.performanceEvent;
    const slot = candidateActivitySlot(candidate);
    const fit = slot === "cafe" && wantsCafeAtmosphere(state) && hasCafeSpaceEvidence(candidate)
      ? "예쁜 카페를 원하셔서 공간 특성이 확인된 곳을 골랐어요. "
      : slot === "meal" && state.cuisine && state.cuisine !== "any"
        && extractCuisine((state.userRequests ?? []).join(" ")) === state.cuisine
        && matchesCuisine(candidate, state.cuisine)
        ? `원하신 ${state.cuisine} 식사에 맞는 곳이에요. ` : "";
    const reason = event ? `KOPIS에는 ${event.dateYmd.slice(4, 6)}월 ${event.dateYmd.slice(6, 8)}일 ${event.showtimes.join("·")}에 ‘${event.title}’ 공연이 등록돼 있어요. 휴연·좌석·예매 가능 여부는 다시 확인해 주세요.`
      : evidence ? `${fit}${evidence.verification === "search_report" ? "온라인 자료 참고: " : ""}${conciseVenueReason(evidence.text)}`
      : (bothWant ? "두 분이 가고 싶다고 저장한 장소예요."
        : prefers ? "저장해 둔 장소예요."
          : wantsCafeAtmosphere(state) && candidate.category === "cafe" ? "공간 분위기는 아직 확인하지 못했어요."
            : slot === "meal" ? "메뉴 특징은 아직 확인하지 못했어요." : "이 장소의 방문 경험을 설명할 근거는 아직 확인하지 못했어요.");
    recommendations.push({
      id,
      placeId,
      name: candidate.name,
      activitySlot: candidateActivitySlot(candidate),
      category: dateCategoryLabel(candidate),
      district: candidate.district,
      address: candidate.roadAddress || candidate.address,
      phone: candidate.phone,
      mapUrl: candidate.mapUrl,
      coordinates: candidate.coordinates,
      durationMinutes,
      expectedCost: 0,
      reasons: [reason],
      isSaved: prefers,
      distanceFromPreviousMeters: meters,
      rating: candidate.rating,
      ratingCount: candidate.ratingCount,
      dishes: candidate.dishes,
      factSourceUrl: event?.sourceUrl || evidence?.url || candidate.factSourceUrl,
    });
    items.push({
      id: `ai-recommend-${candidate.externalSource}-${candidate.externalPlaceId}`,
      placeId,
      placeName: candidate.name,
      category: dateCategoryLabel(candidate),
      startTime,
      durationMinutes,
      expectedCost: 0,
      order: items.length,
      memo: reason,
      dayIndex: Math.max(0, Number(row.day_index ?? 0)),
      coordinates: candidate.coordinates,
    });
  }

  const size = courseSize(state);
  const region = condition.region || "오늘";
  const festivalRec = recommendations.find(place => byId.get(place.id)?.category === "festival");
  const festivalMeta = festivalRec ? byId.get(festivalRec.id) : undefined;
  const headline = size.days > 1
    ? `${region} ${size.days - 1}박${size.days}일`
    : festivalRec
      ? `${region} · ${festivalRec.name}`
      : `${region} ${recommendations.length}곳`;
  const talk = pickCourseMessage(message, recommendations, region);
  const courseLine = festivalMeta?.openingHours
    ? `${talk} · ${festivalMeta.openingHours}`
    : talk;
  const line = [courseLine, state.budgetWon ? `두 분 합계 ${state.budgetWon.toLocaleString("ko-KR")}원 예산을 기준으로 골랐어요. 메뉴·입장료가 모두 확인된 것은 아니라 예산 안이라고 확정할 수는 없어요.` : ""].filter(Boolean).join(" ");

  return {
    status: "plan",
    message: line,
    card: {
      headline,
      lines: [line],
      routeBasis: walkingLegs ? "walking" : "straight_line",
      stops: recommendations.map((place, index) => ({
        name: place.name,
        meta: `${place.category} · ${place.district}`,
        reason: place.reasons[0],
        mapUrl: place.mapUrl,
        isSaved: place.isSaved,
        phone: place.phone,
        address: place.address,
        coordinates: place.coordinates,
        dayIndex: items[index]?.dayIndex ?? 0,
        distanceFromPreviousMeters: place.distanceFromPreviousMeters,
        startTime: items[index]?.startTime,
        durationMinutes: place.durationMinutes,
        image: byId.get(place.id)?.image || savedById.get(place.id)?.image,
        openingHours: byId.get(place.id)?.openingHours,
        source: byId.get(place.id)?.externalSource,
        rating: place.rating,
        ratingCount: place.ratingCount,
        dishes: place.dishes,
        factSourceUrl: place.factSourceUrl,
      })),
      suggestions: courseSuggestions(state, recommendations.map(place => ({ name: place.name, category: place.category }))),
    },
    condition,
    recommendations,
    items,
    candidateCount: candidates.length,
    source,
    state,
  };
}

const DESIGN_PROMPT = [
  "You are an expert Korean date curator. Design coherent, enjoyable courses from the supplied real venues. Return JSON only.",
  "The research brief contains the user's taste, possible concepts, travel mode and explicit requirements. Do not force meal-cafe-walk. Every stop must contribute a different worthwhile experience unless this is an explicit themed tour.",
  "dateIntent.hardConstraints are mandatory. dateIntent.preferences, inferredPreferences and memorySuggestions guide ranking only; inferred confidence lowers their weight. Check excludedFoods against known menu facts and never treat an unknown menu as proof of safety.",
  "Produce three meaningfully different complete courses, not the same course reordered. Prefer one memorable anchor with complementary nearby venues. A restaurant should fit the requested dish/cuisine; a cafe needs a sourced reason to visit; a landmark should offer a real experience, not just fill a slot.",
  "Use venue-specific observations for food, architecture, atmosphere and highlights only when they distinguish the exact branch. Missing observations mean unknown, not bad. Never invent facts, ratings, popularity, beauty, opening hours or prices. Provider IDs bind candidate identities; source URLs alone do not prove every statement. User-saved venues are useful preferences, not mandatory winners.",
  "Read the CURRENT message and conversation. For a swap keep every keepPlace, exclude the old venue, and replace only that experience. For an addition preserve existing stops and add one. Follow requested activity order and do not reintroduce rejected venues. An area change starts a new geographic course unless the user explicitly connects both areas.",
  "Evaluate full-route cohesion: avoid backtracking, unnecessary detours, repeating the same experience, and geographically disconnected picks. Coordinates and straight-line neighbor distances are provided. They are not actual walking routes. Prefer compact clusters for walking; driving trips can cover a wider area.",
  "Dates are about the quality of venues, not filling every hour. Let arrival/departure windows and requested pace determine the number of stops, including one stop on a short travel day when feasible. Treat target.min as a day-coverage guide, not a mandatory venue quota. Respect explicit keepPlaces and cover every travel day. Do not add or remove stops merely to pad time.",
  "All selected IDs must exist in candidates. Each day_index must be 0..days-1. Include every requiredActivity and keepPlace. Never include excludedPlaces. Theme is a short Korean statement of the concept, not an unsupported claim about a venue.",
  "selectedAnchorIds are the user's chosen provider entities and must all appear by exact ID. Interest categories used during exploration are not mandatory itinerary activities. sameComplexGroups identify venues backed by provider names and addresses; place related stops on one day rather than revisiting the same complex on different days.",
  "If experiencePlan, researchNeeds or explorationPreferences are supplied, use them to design the trip's day rhythm, search-supported experiences and pace. Their interests and research priorities are soft planning context; only dateIntent.hardConstraints, selectedAnchorIds and explicit keepPlaces are mandatory. Do not claim an unsupported venue quality merely because it appears in a preference.",
  "Design the course yourself from candidates and return exact provider IDs. The validator checks venue identity, day coverage, schedule, route and user anchors after your proposal. Search-linked observations have not been independently fact-checked.",
  "planningPlaybook is curated advice on how to compare experiences. It is not evidence that any named venue is open, beautiful, tasty, or holding an event. User constraints and provider-verified facts always take precedence.",
  'Schema: {"courses":[{"theme":"short Korean course concept","selected":[{"id":"candidate ID","day_index":0,"duration_minutes":60}]}]}. No prose outside JSON.',
].join(" ");

const SEMANTIC_COURSE_PROMPT = [
  "semanticPlanningHints are approved current-turn wishes for the overall experience, not venue facts or hard requirements. Respect dateIntent.hardConstraints, keepPlaces, exclusions, budget, candidate eligibility, schedule and route feasibility first.",
  "For pace=relaxed, avoid unnecessary stops, overly packed sequencing and repeated long moves; allow natural time at each stop. For novelty=high, compare visitedRecently and currentCourse with supported alternatives within candidates and avoid repetitive combinations; never drop a required place or favor an unsuitable venue just because its name sounds unusual.",
  "For activityLevel=high, favor active experiences only where the supplied candidates support them. For atmosphere, crowdPreference and noisePreference, use branch-specific observations only when provided. A missing observation is unknown and neutral, never proof of a match or conflict.",
  "Session feedback describes a reaction in this turn, not a permanent trait or a fact about any other candidate. Negative noise or crowd feedback can guide the experience only when a candidate has matching branch-specific evidence; positive aesthetic feedback can guide atmosphere only when sourced. Never invent venue properties to satisfy a semantic wish. Every selected ID must still come from candidates and pass all existing checks.",
].join(" ");

/** The no-hint path retains the exact existing proposal messages. */
export function courseProposalMessages(payload: Record<string, unknown>, hints?: SemanticPlanningHints) {
  const enabled = hints && hasSemanticPlanningHints(hints);
  return [
    { role: "system" as const, content: enabled ? `${DESIGN_PROMPT} ${SEMANTIC_COURSE_PROMPT}` : DESIGN_PROMPT },
    { role: "user" as const, content: JSON.stringify(enabled ? { ...payload, semanticPlanningHints: hints } : payload) },
  ];
}

export async function recommendDatePlanWithOpenAi(input: {
  traceId?: string;
  memory?: DateMemoryContext;
  prompt: string;
  condition: AIPlanCondition;
  candidates: DiscoverCandidate[];
  /** Server-verified provider IDs selected by the user, never model-inferred names. */
  anchorCandidateIds?: string[];
  saved: Place[];
  state: AIPlannerState;
  coupleTaste?: { summary: string; commonTastes: Array<{ label: string }>; youHighlights: string[]; partnerHighlights: string[]; avoidFoods?: string[] } | null;
  recentlyVisited?: string[];
  conversation?: DateChatTurn[];
  currentCourse?: DatePreviousStop[];
  semanticPlanningHints?: SemanticPlanningHints;
  /** ResearchPlan has already performed bounded quality research for this pool. */
  researchPlanActive?: boolean;
  experiencePlan?: ExperiencePlan | null;
  researchPlan?: ResearchPlan | null;
  explorationPreferences?: CandidateExplorationPreferences;
}): Promise<AIPlannerReply> {
  const startedAt = performance.now();
  const saved = preferredSavedNames(input.saved);
  const anchorIds = [...new Set(input.anchorCandidateIds ?? [])];
  const pool = [...input.candidates.filter(candidate => anchorIds.includes(dateCandidateKey(candidate))),
    ...discoveryCatalog(input.candidates, input.state, saved, 54)
      .filter(candidate => !anchorIds.includes(dateCandidateKey(candidate)))];
  const candidateGraph = buildCandidateGraph(pool);
  const complexGroups = new Map<string, Set<string>>();
  for (const relation of candidateGraph.relations) {
    const members = complexGroups.get(relation.complexKey) ?? new Set<string>();
    relation.candidateIds.forEach(id => members.add(id));
    complexGroups.set(relation.complexKey, members);
  }
  const days = courseSize(input.state).days;
  // Draft from the already cached/verified facts while fresh research runs.
  // Every proposed course is re-evaluated against the researched pool below.
  const catalog = pool.map(candidate => ({
    id: dateCandidateKey(candidate), name: candidate.name,
    category: candidate.detailedCategory || dateCategoryLabel(candidate),
    address: candidate.roadAddress || candidate.address, coordinates: candidate.coordinates,
    saved: saved.has(candidate.name), bothWant: bothWantNames(input.saved).has(candidate.name),
    visitedRecently: input.recentlyVisited?.includes(candidate.name) ?? false,
    observations: candidate.evidence ?? [], performanceEvent: candidate.performanceEvent ?? null,
    knownMenu: candidate.factSourceUrl ? candidate.dishes : undefined,
    sourceUrl: candidate.factSourceUrl,
    neighbors: hopBands(candidate, pool),
  }));
  const payload = {
    latestMessage: input.prompt.slice(0, 800), recentTurns: (input.conversation ?? []).slice(-10),
    brief: input.state.discovery, dateIntent: toDateIntent(input.state), areas: input.state.areas,
    days, target: planningStopGuidance(input.state),
    keepPlaces: input.state.requiredPlaces, excludedPlaces: input.state.excludedPlaces,
    selectedAnchorIds: anchorIds,
    sameComplexGroups: [...complexGroups].slice(0, 20).map(([complex, ids]) =>
      ({ complex, ids: [...ids], evidence: candidateGraph.relations.find(item => item.complexKey === complex)
        ?.evidence.slice(0, 3).map(item => item.text) ?? [] })),
    currentCourse: input.currentCourse, pinOrder: input.state.pinOrder,
    cuisine: input.state.cuisine, addStop: input.state.addStop,
    budgetWon: input.state.budgetWon, walkingPreference: input.state.walkingPreference,
    couple: input.coupleTaste, memory: input.memory, candidates: catalog,
    explorationPreferences: input.explorationPreferences ? {
      interests: input.explorationPreferences.activities,
      cafeQualities: input.explorationPreferences.cafeQualities,
      cuisines: input.explorationPreferences.cuisines,
      shoppingKinds: input.explorationPreferences.shoppingKinds,
      cultureKinds: input.explorationPreferences.cultureKinds,
      additionalDetails: input.explorationPreferences.additionalDetails,
      pace: input.explorationPreferences.pace,
    } : undefined,
    experiencePlan: input.experiencePlan ? {
      objective: input.experiencePlan.objective,
      overallPace: input.experiencePlan.overallPace,
      strategy: input.experiencePlan.tripStrategy,
      days: input.experiencePlan.days.map(day => ({ dayIndex: day.dayIndex, purpose: day.purpose,
        density: day.density, geographicFocus: day.geographicFocus,
        experiences: day.experienceBlocks.map(block => ({ purpose: block.purpose,
          primaryExperience: block.primaryExperience, visitContext: block.visitContext,
          supportingNeeds: block.supportingNeeds })) })),
      qualitativeNeeds: input.experiencePlan.qualitativeNeeds,
    } : undefined,
    researchNeeds: input.researchPlan?.needs.map(need => ({ dayIndex: need.dayIndex,
      kind: need.kind, purpose: need.purpose, category: need.category,
      geographicFocus: need.geographicFocus, qualities: need.qualities })) ?? undefined,
  };
  let researchDoneAt = startedAt;
  let modelDoneAt = startedAt;
  const researchPromise = (input.researchPlanActive ? Promise.resolve(pool)
    : enrichDateVenues(pool, input.state, undefined, isTravelPlan(input.state) ? "background" : "interactive")).then(value => {
    researchDoneAt = performance.now();
    return value;
  });
  const modelPromise = isOpenAiConfigured() && pool.length >= 2
    ? (async () => {
      const [selection, editing, response] = await Promise.all([
        retrieveDatePlaybook(input.prompt, input.state, "selection", isTravelPlan(input.state) ? 11 : 8, input.saved.length ? ["personalized"] : []),
        input.state.intent === "modify" ? retrieveDatePlaybook(input.prompt, input.state, "editing", isTravelPlan(input.state) ? 3 : 2) : Promise.resolve([]),
        retrieveDatePlaybook(input.prompt, input.state, "response", isTravelPlan(input.state) ? 4 : 3),
      ]);
      return completeJson<{ courses?: unknown }>({
        messages: courseProposalMessages({ ...payload, planningPlaybook: [...selection, ...editing, ...response] }, input.semanticPlanningHints),
        reasoningEffort: "low", temperature: 0.2,
        maxTokens: Math.min(5800, 2400 + Math.max(0, days - 3) * 750),
        timeoutMs: isTravelPlan(input.state) ? 22000 + Math.max(0, days - 3) * 2500 : 16000,
      });
    })().then(value => { modelDoneAt = performance.now(); return value; })
    : Promise.resolve(null);
  const [grounded, modelResult] = await Promise.all([researchPromise, modelPromise]);
  const groundedGraph = buildCandidateGraph(grounded);
  const groundedConstraints = { anchorIds, candidateGraph: groundedGraph };
  const seeds = feasibleCourseSeeds(grounded, input.state, saved, groundedConstraints);
  const seedDoneAt = performance.now();
  const rejectionReasons = new Set<string>();
  const observedIssueCodes = new Set<PlanningIssueCode>();
  const failedCourses: CourseEvaluation[] = [];
  if (!seeds.length) {
    const fallbackEvaluation = evaluateCourse(buildFallbackCourse(grounded, input.state, saved, groundedConstraints),
      grounded, input.state, saved, groundedConstraints);
    fallbackEvaluation.hardIssues.forEach(issue => rejectionReasons.add(issue.message));
    fallbackEvaluation.issues.forEach(issue => observedIssueCodes.add(issue.code));
    if (fallbackEvaluation.hardIssues.length) failedCourses.push(fallbackEvaluation);
  }
  let considered = 0;
  let winner: CourseEvaluation | undefined;
  let feasibleModels: CourseEvaluation[] = [];
  const rank = (raw: unknown) => {
    const proposals = parseCourseProposals(raw, days);
    considered += proposals.length;
    if (!proposals.length) rejectionReasons.add("모델이 유효한 코스 구조를 반환하지 않음");
    const groundedIds = new Set(grounded.map(dateCandidateKey));
    return proposals.flatMap(proposal => {
      if (proposal.rows.some(row => !row.id || !groundedIds.has(row.id))) {
        rejectionReasons.add("모델이 확인되지 않은 장소를 제안함");
        return [];
      }
      // Keep the model's exact day and stop order. Validation must not silently optimize it.
      const evaluated = evaluatePreparedCourse(proposal, proposal.rows, grounded, input.state, saved, groundedConstraints);
      evaluated.hardIssues.forEach(issue => rejectionReasons.add(issue.message));
      evaluated.issues.forEach(issue => observedIssueCodes.add(issue.code));
      if (evaluated.hardIssues.length) failedCourses.push(evaluated);
      return [evaluated];
    }).sort((a, b) => a.hardIssues.length - b.hardIssues.length || b.score - a.score);
  };
  if (isOpenAiConfigured() && grounded.length >= 2) {
    let evaluated = rank(modelResult?.courses);
    winner = evaluated.find(course => !blocksCourse(course.issues, "model_proposal"));
    if (!winner && evaluated.length && !input.state.foodAllergy) {
      // One bounded repair based on concrete failures; never silently replace selected venues.
      const base = evaluated[0];
      const affectedDays = base ? affectedRepairDays(base, groundedConstraints) : new Set<number>();
      const repaired = await completeJson<{ courses?: unknown }>({
        messages: courseProposalMessages({ ...payload, rejected: evaluated.map(course => ({ selected: course.rows,
          problems: course.hardIssues.map(issue => issue.message), warnings: course.softIssues.map(issue => issue.message) })),
          lockedDayRows: base?.rows.filter(row => !affectedDays.has(row.day_index ?? 0)) ?? [],
          affectedDays: [...affectedDays],
          instruction: "Repair hard failures only. Keep selectedAnchorIds. If affectedDays is nonempty, preserve lockedDayRows exactly, including order and duration; change only affected days. Group stops in the same named complex on one day. Return two complete courses." }, input.semanticPlanningHints),
        reasoningEffort: "low", temperature: 0.2, maxTokens: 1800, timeoutMs: 10000,
      });
      evaluated = rank(repaired?.courses).filter(course => !base || !affectedDays.size
        || preservesUnchangedDays(base.rows, course.rows, affectedDays));
      winner = evaluated.find(course => !blocksCourse(course.issues, "model_proposal"));
    }
    feasibleModels = evaluated.filter(course => !blocksCourse(course.issues, "model_proposal"));
  }
  let degraded = !winner;
  type RankedOption = { course: CourseEvaluation; deterministicSeed: boolean };
  const bySequence = new Map<string, RankedOption>();
  for (const course of feasibleModels) {
    const key = course.rows.map(row => `${row.day_index}:${row.id}`).join("|");
    bySequence.set(key, { course, deterministicSeed: false });
  }
  for (const course of seeds) {
    const key = course.rows.map(row => `${row.day_index}:${row.id}`).join("|");
    if (!bySequence.has(key)) bySequence.set(key, { course, deterministicSeed: true });
  }
  for (const failed of failedCourses.slice(0, 3)) {
    const repaired = repairAffectedStop(failed, grounded, input.state, saved, groundedConstraints);
    if (!repaired) continue;
    const key = repaired.rows.map(row => `${row.day_index}:${row.id}`).join("|");
    if (!bySequence.has(key)) bySequence.set(key, { course: repaired, deterministicSeed: true });
  }
  const stableKey = (option: RankedOption) => option.course.rows.map(row => `${row.day_index}:${row.id}`).join("|");
  const rankedOptions = [...bySequence.values()].sort((a, b) =>
    Number(a.deterministicSeed) - Number(b.deterministicSeed)
    || courseSelectionScore(b.course) - courseSelectionScore(a.course)
    || stableKey(a).localeCompare(stableKey(b)));
  winner = rankedOptions[0]?.course;
  degraded = rankedOptions[0]?.deterministicSeed ?? true;
  let walkingRoute: FootRoute | null = null;
  const routeOptions = rankedOptions.slice(0, 5);
  const wantsWalkingRoute = days === 1 && !isTravelPlan(input.state) && input.state.discovery?.transport !== "drive"
    || input.state.discovery?.transport === "walk";
  if (wantsWalkingRoute) {
    const byId = new Map(grounded.map(candidate => [dateCandidateKey(candidate), candidate]));
    const inspectRoutes = async (options: RankedOption[]) => Promise.all(options.map(async option => {
      const route = await footRouteForDays(option.course.rows, byId, days, 50_000);
      const verification = verifyDateItinerary({ course: option.course, candidates: grounded,
        state: input.state, condition: input.condition, route });
      return { ...option, route, verification };
    }));
    const inspected = await inspectRoutes(routeOptions);
    let valid = inspected.filter((item): item is RankedOption & { route: FootRoute; verification: ReturnType<typeof verifyDateItinerary> } =>
      Boolean(item.route && item.verification.passed));
    if (!valid.length && inspected.some(item => item.route) && isOpenAiConfigured() && !input.state.foodAllergy) {
      const base = inspected[0];
      const affectedDays = new Set(base.verification.hardIssues.flatMap(issue =>
        issue.scope.dayIndex == null ? [] : [issue.scope.dayIndex]));
      const repaired = await completeJson<{ courses?: unknown }>({
        messages: courseProposalMessages({ ...payload,
          rejected: inspected.map(item => ({ selected: item.course.rows,
            problems: item.verification.issues.length ? item.verification.issues : ["실제 보행 경로 미확인"],
            actualWalkMeters: item.route?.meters ?? null,
            actualWalkSeconds: item.route?.seconds ?? null })),
          affectedDays: [...affectedDays],
          lockedDayRows: base.course.rows.filter(row => !affectedDays.has(row.day_index ?? 0)),
          instruction: "The route verifier rejected the checked course. Repair only affectedDays; keep lockedDayRows exactly unchanged and keep every selectedAnchorId. Return two complete courses." }, input.semanticPlanningHints),
        reasoningEffort: "low", temperature: 0.2, maxTokens: 1800, timeoutMs: 10000,
      });
      const repairedOptions = rank(repaired?.courses).filter(course => !blocksCourse(course.issues, "model_proposal")
        && (!affectedDays.size || preservesUnchangedDays(base.course.rows, course.rows, affectedDays)))
        .map(course => ({ course, deterministicSeed: false }));
      valid = (await inspectRoutes(repairedOptions.slice(0, 3))).filter((item): item is RankedOption & { route: FootRoute; verification: ReturnType<typeof verifyDateItinerary> } =>
        Boolean(item.route && item.verification.passed));
      if (valid.length) rejectionReasons.add("실제 경로 검증 후 코스를 다시 계획함");
    }
    valid.sort((a, b) => Number(a.deterministicSeed) - Number(b.deterministicSeed)
      || courseSelectionScore(b.course, b.route.meters)
      - courseSelectionScore(a.course, a.route.meters) || stableKey(a).localeCompare(stableKey(b)));
    if (valid.length) {
      winner = valid[0].course;
      walkingRoute = valid[0].route;
      if (!valid[0].deterministicSeed) degraded = false;
    }
    else if (inspected.some(item => item.route)) {
      winner = undefined;
      degraded = true;
      inspected.flatMap(item => item.verification.issues).forEach(reason => rejectionReasons.add(reason));
      rejectionReasons.add("실제 보행 경로 검증을 통과한 코스 없음");
    }
  }
  const selectionDoneAt = performance.now();
  let rows = winner ? assignStartTimes(winner.rows, grounded, input.state, input.condition.startTime) : [];
  let reply = buildReply(rows, grounded, input.condition, "", degraded ? "fallback" : "openai", input.state, input.saved, walkingRoute?.legs);
  if (rows.length && !itineraryOrderMatchesItems(rows, reply.items)) {
    rejectionReasons.add("날짜별 지도 순서와 일정이 일치하지 않음");
    reply = buildReply([], grounded, input.condition, "", "fallback", input.state, input.saved);
    rows = [];
    winner = undefined;
    degraded = true;
  }
  const requested = input.state.discovery?.requiredActivities ?? input.state.activities;
  const activityNames: Record<string, string> = { meal: "식사", cafe: "카페", performance: "공연장", movie: "영화", exhibit: "전시", walk: "산책", indoor: "실내 활동", nightview: "야경" };
  const focus = [...new Set([...(input.state.discovery?.activityOrder ?? []), ...requested])]
    .slice(0, 3).map(activity => activityNames[activity] ?? activity).join("·");
  const actualRoles = reply.recommendations.map(place => {
    const candidate = grounded.find(item => dateCandidateKey(item) === place.id);
    if (isTravelPlan(input.state) && candidate?.category === "tourist") return "관광";
    if (isTravelPlan(input.state) && candidate?.category === "nature") return "자연·산책";
    return activityNames[place.activitySlot ?? ""] ?? place.category;
  });
  const opening = !reply.items.length
    ? "조건과 장소 근거를 함께 만족하는 코스를 아직 찾지 못했어요."
    : actualRoles.length > 1
    ? `${input.condition.region}에서 ${actualRoles.join(" → ")} 순서로 ${reply.items.length}곳을 골랐어요.`
    : focus ? `${focus} 경험을 담은 ${reply.items.length}곳을 골랐어요.`
      : `${input.condition.region}에서 이어갈 ${reply.items.length}곳을 골랐어요.`;
  const qualifiers = [
    degraded && winner ? "AI가 제안한 코스는 조건 검증을 통과하지 못해, 검색된 장소로 구성한 대안을 보여드려요." : "",
    wantsCafeAtmosphere(input.state) && winner?.rows.some(row => {
      const candidate = grounded.find(item => dateCandidateKey(item) === row.id);
      return candidate && candidateActivitySlot(candidate) === "cafe" && !hasCafeSpaceEvidence(candidate);
    }) ? "요청하신 카페의 공간 분위기는 확인하지 못했어요. 가까운 카페를 임시로 넣었으니 상세 사진을 확인해 주세요." : "",
    winner?.rows.some(row => grounded.some(candidate => dateCandidateKey(candidate) === row.id && matchesActivity(candidate, "performance") && !candidate.performanceEvent))
      ? "공연장은 장소만 확인했어요. 방문일의 공연·좌석·예매 가능 여부는 장소 정보에서 확인해 주세요." : "",
    input.state.budgetWon ? `두 분 합계 ${input.state.budgetWon.toLocaleString("ko-KR")}원 예산은 메뉴와 입장료 확인이 더 필요해요.` : "",
    (input.state.excludedFoods?.length ?? 0) > 0 && rows.some(row => grounded.some(candidate =>
      dateCandidateKey(candidate) === row.id && candidateActivitySlot(candidate) === "meal"))
      ? `${input.state.excludedFoods!.join("·")} 제외 조건을 반영했지만, 주문 전 재료와 조리 방식을 식당에 확인해 주세요.` : "",
    days > 1 ? Object.keys(tripLocalWindows(input.state.userRequests ?? [], days)).length
      ? "알려주신 현지 도착·출발 시각은 일정 창에 반영했어요. 숙소 이동과 왕복 교통편은 아직 검증되지 않았고, 나머지 시각은 추정이에요."
      : "숙소와 도착·귀가 교통편은 아직 반영되지 않았어요. 숙소 위치와 교통 시간을 정하면 일자별 동선을 다시 맞춰야 해요." : "",
    isTravelPlan(input.state) && !walkingRoute ? "여행지 사이 이동은 직선거리와 이동 수단별 추정으로 검토했어요. 실제 도로·환승 시간은 확인이 필요해요." : "",
    !isTravelPlan(input.state) && wantsWalkingRoute && !walkingRoute && winner
      ? "보행 경로 공급자가 응답하지 않아 이동 시간은 실제 경로로 확인하지 못했어요." : "",
  ].filter(Boolean);
  reply.message = [opening, ...qualifiers].join(" ");
  reply.card.lines = [opening, ...qualifiers];
  reply.card.headline = input.condition.region + (days > 1 ? ` ${days - 1}박${days}일` : ` ${reply.items.length}곳`);
  if (!input.condition.timeSpecified) reply.card.stops = reply.card.stops?.map(stop => ({ ...stop, startTime: undefined, durationMinutes: undefined }));
  reply.design = {
    theme: winner?.theme ?? "", alternativesConsidered: considered, routeBasis: walkingRoute ? "walking" : "straight_line",
    totalDistanceMeters: Math.round(walkingRoute?.meters ?? winner?.meters ?? 0), evidenceCount: winner?.evidenceCount ?? 0, degraded,
    scoreBreakdown: winner?.scoreBreakdown ? { ...winner.scoreBreakdown,
      route: winner.scoreBreakdown.route - Math.max(0, (walkingRoute?.meters ?? winner.meters) - winner.meters) / 350 } : undefined,
    evidenceCoverage: { supportedStops: winner?.evidenceCount ?? 0, totalStops: rows.length,
      missingPlaceIds: rows.filter(row => {
        const candidate = grounded.find(place => dateCandidateKey(place) === row.id);
        return !candidate || !hasRequestedVenueEvidence(candidate, input.state);
      }).map(row => row.id!).filter(Boolean) },
    rejectionReasons: [...rejectionReasons],
  };
  console.info("date_course_design", JSON.stringify({ traceId: input.traceId,
    planningPolicyVersion: "p1-a",
    observedIssueCodes: [...observedIssueCodes],
    selectedIssueCodes: winner?.issues.map(issue => issue.code) ?? [],
    selectedSoftIssueCount: winner?.softIssues.length ?? 0,
    selectedHardIssueCount: winner?.hardIssues.length ?? 0,
    selectedTransformationStages: winner?.transformations.map(change => change.stage) ?? [],
    researchedCandidates: grounded.filter(candidate => candidate.evidence?.length).length,
    catalogCount: grounded.length, anchorCount: anchorIds.length,
    complexGroupCount: complexGroups.size, complexRelationCount: groundedGraph.relations.length,
    targetedRepairCandidateCount: failedCourses.filter(course => course.hardIssues.some(issue =>
      issue.code === "repeated_complex_day" || issue.code === "confirmed_closed")).length,
    seedCount: seeds.length, modelProposalCount: considered, degraded,
    semanticHintDimensions: input.semanticPlanningHints && hasSemanticPlanningHints(input.semanticPlanningHints)
      ? Object.keys(input.semanticPlanningHints) : [],
    semanticPlanningHints: process.env.NODE_ENV === "development" ? input.semanticPlanningHints ?? {} : undefined,
    researchMs: Math.round(researchDoneAt - startedAt), modelMs: Math.round(modelDoneAt - startedAt),
    parallelDesignMs: Math.round(seedDoneAt - startedAt), seedMs: Math.round(seedDoneAt - Math.max(researchDoneAt, modelDoneAt)),
    selectionMs: Math.round(selectionDoneAt - seedDoneAt) }));
  return reply;
}

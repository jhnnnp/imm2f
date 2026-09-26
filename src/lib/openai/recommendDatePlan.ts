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
import { buildFallbackCourse, courseSelectionScore, discoveryCatalog, evaluateCourse, feasibleCourseSeeds, hasCafeSpaceEvidence, hasRequestedVenueEvidence, parseCourseProposals, usefulVenueEvidence, wantsCafeAtmosphere, type CourseEvaluation } from "@/features/ai/courseDesign";
import { isOpenAiConfigured } from "./env";
import { distanceMeters } from "@/features/places/geo";
import { fetchFootRoute, type FootLeg, type FootRoute } from "@/lib/routing/footRoute";
import { retrieveDatePlaybook } from "./datePlaybook";
import { tripLocalWindows } from "@/features/ai/planningSupport";
import { toDateIntent } from "@/features/ai/dateIntent";
import type { DateMemoryContext } from "@/features/ai/dateMemory";
import { verifyDateItinerary } from "@/features/ai/dateVerifier";
import { hasSemanticPlanningHints, type SemanticPlanningHints } from "@/features/ai/semanticPlanningHints";
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
    if (group.length < 2) return null;
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
  const maxStops = Math.max(courseSize(state).max, state.discovery?.maxStops ?? 0, state.requiredPlaces.length);

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
  "Dates are about the quality of venues, not filling every hour. Select two to four meaningful stops for a local date, typically three to four per travel day. Respect explicit keepPlaces and target bounds. Cover every travel day. Do not add or remove stops merely to pad time.",
  "All selected IDs must exist in candidates. Each day_index must be 0..days-1. Include every requiredActivity and keepPlace. Never include excludedPlaces. Theme is a short Korean statement of the concept, not an unsupported claim about a venue.",
  "feasibleAlternatives are already checked against venue and straight-line distance constraints. You may select one using seedId instead of selected, and supply a thoughtful Korean theme based on its sourced observations. Search-linked observations have not been independently fact-checked. Prefer the alternative that best matches the couple, not merely the shortest route.",
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
  saved: Place[];
  state: AIPlannerState;
  coupleTaste?: { summary: string; commonTastes: Array<{ label: string }>; youHighlights: string[]; partnerHighlights: string[]; avoidFoods?: string[] } | null;
  recentlyVisited?: string[];
  conversation?: DateChatTurn[];
  currentCourse?: DatePreviousStop[];
  semanticPlanningHints?: SemanticPlanningHints;
}): Promise<AIPlannerReply> {
  const startedAt = performance.now();
  const saved = preferredSavedNames(input.saved);
  const pool = discoveryCatalog(input.candidates, input.state, saved, 54);
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
  const draftSeeds = feasibleCourseSeeds(pool, input.state, saved);
  const payload = {
    latestMessage: input.prompt.slice(0, 800), recentTurns: (input.conversation ?? []).slice(-10),
    brief: input.state.discovery, dateIntent: toDateIntent(input.state), areas: input.state.areas,
    days, target: input.state.discovery ? { min: input.state.discovery.minStops, max: input.state.discovery.maxStops } : courseSize(input.state),
    keepPlaces: input.state.requiredPlaces, excludedPlaces: input.state.excludedPlaces,
    currentCourse: input.currentCourse, pinOrder: input.state.pinOrder,
    cuisine: input.state.cuisine, addStop: input.state.addStop,
    budgetWon: input.state.budgetWon, walkingPreference: input.state.walkingPreference,
    couple: input.coupleTaste, memory: input.memory, candidates: catalog,
    feasibleAlternatives: draftSeeds.map((course, index) => ({ seedId: index, selected: course.rows, straightLineMeters: Math.round(course.meters) })),
  };
  let researchDoneAt = startedAt;
  let modelDoneAt = startedAt;
  const researchPromise = enrichDateVenues(pool, input.state, undefined, isTravelPlan(input.state) ? "background" : "interactive").then(value => {
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
        reasoningEffort: "low", temperature: 0.2, maxTokens: 2400, timeoutMs: isTravelPlan(input.state) ? 22000 : 16000,
      });
    })().then(value => { modelDoneAt = performance.now(); return value; })
    : Promise.resolve(null);
  const [grounded, modelResult] = await Promise.all([researchPromise, modelPromise]);
  const seeds = feasibleCourseSeeds(grounded, input.state, saved);
  const seedDoneAt = performance.now();
  const rejectionReasons = new Set<string>();
  if (!seeds.length && isTravelPlan(input.state)) {
    evaluateCourse(buildFallbackCourse(grounded, input.state, saved), grounded, input.state, saved)
      .problems.forEach(problem => rejectionReasons.add(problem));
  }
  let considered = 0;
  let winner: CourseEvaluation | undefined;
  let feasibleModels: CourseEvaluation[] = [];
  const rank = (raw: unknown) => {
    const resolved = Array.isArray(raw) ? raw.map(value => {
      if (!value || typeof value !== "object") return value;
      const seed = Number.isInteger(value.seedId) ? draftSeeds[value.seedId] : undefined;
      return seed ? { ...value, selected: seed.rows } : value;
    }) : raw;
    const proposals = parseCourseProposals(resolved, days);
    considered += proposals.length;
    if (!proposals.length) rejectionReasons.add("모델이 유효한 코스 구조를 반환하지 않음");
    return proposals.map(proposal => {
      const evaluated = evaluateCourse(proposal, grounded, input.state, saved);
      evaluated.problems.forEach(problem => rejectionReasons.add(problem));
      return evaluated;
    }).sort((a, b) => a.problems.length - b.problems.length || b.score - a.score);
  };
  if (isOpenAiConfigured() && grounded.length >= 2) {
    let evaluated = rank(modelResult?.courses);
    winner = evaluated.find(course => course.problems.length === 0);
    if (!winner && evaluated.length && !input.state.foodAllergy && !(isTravelPlan(input.state)
      && [...rejectionReasons].some(reason => reason.includes("여행 핵심 장소 근거 부족")))) {
      // One bounded repair based on concrete failures; never silently replace selected venues.
      const repaired = await completeJson<{ courses?: unknown }>({
        messages: courseProposalMessages({ ...payload, rejected: evaluated.map(course => ({ selected: course.rows, problems: course.problems })), instruction: "Repair these exact constraint failures. Return two feasible complete courses." }, input.semanticPlanningHints),
        reasoningEffort: "low", temperature: 0.2, maxTokens: 1800, timeoutMs: 10000,
      });
      evaluated = rank(repaired?.courses);
      winner = evaluated.find(course => course.problems.length === 0);
    }
    feasibleModels = evaluated.filter(course => course.problems.length === 0);
  }
  let degraded = !winner;
  type RankedOption = { course: CourseEvaluation; deterministicSeed: boolean };
  const bySequence = new Map<string, RankedOption>();
  for (const course of seeds) bySequence.set(course.rows.map(row => `${row.day_index}:${row.id}`).join("|"), { course, deterministicSeed: true });
  for (const course of feasibleModels) {
    const key = course.rows.map(row => `${row.day_index}:${row.id}`).join("|");
    if (!bySequence.has(key)) bySequence.set(key, { course, deterministicSeed: false });
  }
  const stableKey = (option: RankedOption) => option.course.rows.map(row => `${row.day_index}:${row.id}`).join("|");
  const rankedOptions = [...bySequence.values()].sort((a, b) =>
    courseSelectionScore(b.course, undefined, b.deterministicSeed) - courseSelectionScore(a.course, undefined, a.deterministicSeed)
    || stableKey(a).localeCompare(stableKey(b)));
  winner = rankedOptions[0]?.course;
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
      const repaired = await completeJson<{ courses?: unknown }>({
        messages: courseProposalMessages({ ...payload,
          rejected: inspected.map(item => ({ selected: item.course.rows,
            problems: item.verification.issues.length ? item.verification.issues : ["실제 보행 경로 미확인"],
            actualWalkMeters: item.route?.meters ?? null,
            actualWalkSeconds: item.route?.seconds ?? null })),
          instruction: "The route verifier rejected every checked course. Plan a DIFFERENT compact course using the candidate IDs. Keep all hard constraints. Return two complete courses." }, input.semanticPlanningHints),
        reasoningEffort: "low", temperature: 0.2, maxTokens: 1800, timeoutMs: 10000,
      });
      const repairedOptions = rank(repaired?.courses).filter(course => course.problems.length === 0)
        .map(course => ({ course, deterministicSeed: false }));
      valid = (await inspectRoutes(repairedOptions.slice(0, 3))).filter((item): item is RankedOption & { route: FootRoute; verification: ReturnType<typeof verifyDateItinerary> } =>
        Boolean(item.route && item.verification.passed));
      if (valid.length) rejectionReasons.add("실제 경로 검증 후 코스를 다시 계획함");
    }
    valid.sort((a, b) => courseSelectionScore(b.course, b.route.meters, b.deterministicSeed)
      - courseSelectionScore(a.course, a.route.meters, a.deterministicSeed) || stableKey(a).localeCompare(stableKey(b)));
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
  const rows = winner ? assignStartTimes(winner.rows, grounded, input.state, input.condition.startTime) : [];
  const reply = buildReply(rows, grounded, input.condition, "", degraded ? "fallback" : "openai", input.state, input.saved, walkingRoute?.legs);
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
    researchedCandidates: grounded.filter(candidate => candidate.evidence?.length).length,
    catalogCount: grounded.length, seedCount: seeds.length, modelProposalCount: considered, degraded,
    semanticHintDimensions: input.semanticPlanningHints && hasSemanticPlanningHints(input.semanticPlanningHints)
      ? Object.keys(input.semanticPlanningHints) : [],
    semanticPlanningHints: process.env.NODE_ENV === "development" ? input.semanticPlanningHints ?? {} : undefined,
    researchMs: Math.round(researchDoneAt - startedAt), modelMs: Math.round(modelDoneAt - startedAt),
    parallelDesignMs: Math.round(seedDoneAt - startedAt), seedMs: Math.round(seedDoneAt - Math.max(researchDoneAt, modelDoneAt)),
    selectionMs: Math.round(selectionDoneAt - seedDoneAt) }));
  return reply;
}

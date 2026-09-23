import type { DiscoverCandidate, Place } from "@/features/places/types/place";
import type { AIPlanCondition, AIPlaceRecommendation, AIPlannerReply, AIPlannerState, DateChatTurn, DatePreviousStop, PlanItem } from "@/features/planning/types/plan";
import { discoverPlaceId } from "@/features/places/discover";
import { courseSize, matchesActivity } from "@/features/ai/dateBrief";
import {
  assignStartTimes, bothWantNames, candidateActivitySlot, courseSuggestions, dateCandidateKey,
  dateCategoryLabel, defaultDuration, pickCourseMessage,
  preferredSavedNames, travelGapMinutes, type DateCourseRow,
} from "@/features/ai/dateCourse";
import { completeJson } from "./client";
import { enrichDateVenues } from "./enrichDateVenues";
import { discoveryCatalog, evaluateCourse, feasibleCourseSeeds, hasCafeSpaceEvidence, parseCourseProposals, usefulVenueEvidence, wantsCafeAtmosphere, type CourseEvaluation } from "@/features/ai/courseDesign";
import { isOpenAiConfigured } from "./env";
import { distanceMeters } from "@/features/places/geo";

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

function buildReply(
  rows: DateCourseRow[],
  candidates: DiscoverCandidate[],
  condition: AIPlanCondition,
  message: string,
  source: AIPlannerReply["source"],
  state: AIPlannerState,
  saved: Place[],
): AIPlannerReply {
  const byId = new Map(candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  const recommendations: AIPlaceRecommendation[] = [];
  const items: PlanItem[] = [];
  const seen = new Set<string>();
  const preferred = preferredSavedNames(saved);
  const bothWant = bothWantNames(saved);
  const maxStops = Math.max(courseSize(state).max, state.discovery?.maxStops ?? 0, state.requiredPlaces.length);

  for (const row of rows) {
    const id = String(row.id ?? "");
    const candidate = byId.get(id);
    if (!candidate || seen.has(id) || recommendations.length >= maxStops) continue;
    seen.add(id);
    const durationMinutes = clamp(row.duration_minutes, 30, 180, defaultDuration(candidate, state.pace));
    const previousItem = items.at(-1)?.dayIndex === Number(row.day_index ?? 0) ? items.at(-1) : undefined;
    const previousRec = previousItem ? recommendations.at(-1) : undefined;
    const gap = travelGapMinutes(previousRec?.coordinates, candidate.coordinates);
    const earliest = previousItem ? addMinutes(previousItem.startTime, previousItem.durationMinutes + gap) : null;
    const startTime = parseTime(row.start_time, earliest ?? condition.startTime);
    const placeId = discoverPlaceId(candidate.externalSource, candidate.externalPlaceId);
    const meters = previousRec?.coordinates && candidate.coordinates
      ? Math.round(distanceMeters(previousRec.coordinates, candidate.coordinates))
      : null;
    const evidence = usefulVenueEvidence(candidate, state);
    // A category or a short distance is already visible elsewhere on the card.
    // Do not recycle it as a supposed venue-specific recommendation reason.
    const reason = evidence ? `${evidence.verification === "search_report" ? "온라인 자료 참고: " : ""}${evidence.text}`
      : (bothWant.has(candidate.name) ? "두 분이 가고 싶다고 저장한 장소예요."
        : preferred.has(candidate.name) ? "저장해 둔 장소예요."
          : wantsCafeAtmosphere(state) && candidate.category === "cafe" ? "공간 분위기는 아직 확인하지 못했어요." : "");
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
      isSaved: preferred.has(candidate.name),
      distanceFromPreviousMeters: meters,
      rating: candidate.rating,
      ratingCount: candidate.ratingCount,
      dishes: candidate.dishes,
      factSourceUrl: evidence?.url || candidate.factSourceUrl,
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
        image: byId.get(place.id)?.image || saved.find(item => item.name === place.name)?.image,
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
  "Produce three meaningfully different complete courses, not the same course reordered. Prefer one memorable anchor with complementary nearby venues. A restaurant should fit the requested dish/cuisine; a cafe needs a sourced reason to visit; a landmark should offer a real experience, not just fill a slot.",
  "Use venue-specific observations for food, architecture, atmosphere and highlights only when they distinguish the exact branch. Missing observations mean unknown, not bad. Never invent facts, ratings, popularity, beauty, opening hours or prices. Provider IDs bind candidate identities; source URLs alone do not prove every statement. User-saved venues are useful preferences, not mandatory winners.",
  "Read the CURRENT message and conversation. For a swap keep every keepPlace, exclude the old venue, and replace only that experience. For an addition preserve existing stops and add one. Follow requested activity order and do not reintroduce rejected venues. An area change starts a new geographic course unless the user explicitly connects both areas.",
  "Evaluate full-route cohesion: avoid backtracking, unnecessary detours, repeating the same experience, and geographically disconnected picks. Coordinates and straight-line neighbor distances are provided. They are not actual walking routes. Prefer compact clusters for walking; driving trips can cover a wider area.",
  "Dates are about the quality of venues, not filling every hour. Select two to four meaningful stops for a local date, typically three to four per travel day. Respect explicit keepPlaces and target bounds. Cover every travel day. Do not add or remove stops merely to pad time.",
  "All selected IDs must exist in candidates. Each day_index must be 0..days-1. Include every requiredActivity and keepPlace. Never include excludedPlaces. Theme is a short Korean statement of the concept, not an unsupported claim about a venue.",
  "feasibleAlternatives are already checked against venue and straight-line distance constraints. You may select one using seedId instead of selected, and supply a thoughtful Korean theme based on its sourced observations. Search-linked observations have not been independently fact-checked. Prefer the alternative that best matches the couple, not merely the shortest route.",
  'Schema: {"courses":[{"theme":"short Korean course concept","selected":[{"id":"candidate ID","day_index":0,"duration_minutes":60}]}]}. No prose outside JSON.',
].join(" ");

export async function recommendDatePlanWithOpenAi(input: {
  traceId?: string;
  prompt: string;
  condition: AIPlanCondition;
  candidates: DiscoverCandidate[];
  saved: Place[];
  state: AIPlannerState;
  coupleTaste?: { summary: string; commonTastes: Array<{ label: string }>; youHighlights: string[]; partnerHighlights: string[]; avoidFoods?: string[] } | null;
  recentlyVisited?: string[];
  conversation?: DateChatTurn[];
  currentCourse?: DatePreviousStop[];
}): Promise<AIPlannerReply> {
  const startedAt = performance.now();
  const saved = preferredSavedNames(input.saved);
  const pool = discoveryCatalog(input.candidates, input.state, saved, 54);
  const grounded = await enrichDateVenues(pool, input.state);
  const researchDoneAt = performance.now();
  const days = courseSize(input.state).days;
  const catalog = grounded.map(candidate => ({
    id: dateCandidateKey(candidate), name: candidate.name,
    category: candidate.detailedCategory || dateCategoryLabel(candidate),
    address: candidate.roadAddress || candidate.address, coordinates: candidate.coordinates,
    saved: saved.has(candidate.name), bothWant: bothWantNames(input.saved).has(candidate.name),
    visitedRecently: input.recentlyVisited?.includes(candidate.name) ?? false,
    observations: candidate.evidence ?? [],
    knownMenu: candidate.factSourceUrl ? candidate.dishes : undefined,
    sourceUrl: candidate.factSourceUrl,
    neighbors: hopBands(candidate, grounded),
  }));
  const seeds = feasibleCourseSeeds(grounded, input.state, saved);
  const seedDoneAt = performance.now();
  const payload = {
    latestMessage: input.prompt.slice(0, 800), recentTurns: (input.conversation ?? []).slice(-10),
    brief: input.state.discovery, areas: input.state.areas,
    days, target: input.state.discovery ? { min: input.state.discovery.minStops, max: input.state.discovery.maxStops } : courseSize(input.state),
    keepPlaces: input.state.requiredPlaces, excludedPlaces: input.state.excludedPlaces,
    currentCourse: input.currentCourse, pinOrder: input.state.pinOrder,
    cuisine: input.state.cuisine, addStop: input.state.addStop,
    budgetWon: input.state.budgetWon, walkingPreference: input.state.walkingPreference,
    couple: input.coupleTaste, candidates: catalog,
    feasibleAlternatives: seeds.map((course, index) => ({ seedId: index, selected: course.rows, straightLineMeters: Math.round(course.meters) })),
  };
  const rejectionReasons = new Set<string>();
  let considered = 0;
  let winner: CourseEvaluation | undefined;
  const rank = (raw: unknown) => {
    const resolved = Array.isArray(raw) ? raw.map(value => {
      if (!value || typeof value !== "object") return value;
      const seed = Number.isInteger(value.seedId) ? seeds[value.seedId] : undefined;
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
    const result = await completeJson<{ courses?: unknown }>({
      messages: [{ role: "system", content: DESIGN_PROMPT }, { role: "user", content: JSON.stringify(payload) }],
      reasoningEffort: "medium", temperature: 0.4, maxTokens: 3200, timeoutMs: 40000,
    });
    let evaluated = rank(result?.courses);
    winner = evaluated.find(course => course.problems.length === 0);
    if (!winner) {
      // One bounded repair based on concrete failures; never silently replace selected venues.
      const repaired = await completeJson<{ courses?: unknown }>({
        messages: [{ role: "system", content: DESIGN_PROMPT }, { role: "user", content: JSON.stringify({ ...payload, rejected: evaluated.map(course => ({ selected: course.rows, problems: course.problems })), instruction: "Repair these exact constraint failures. Return two feasible complete courses." }) }],
        reasoningEffort: "low", temperature: 0.2, maxTokens: 2400, timeoutMs: 20000,
      });
      evaluated = rank(repaired?.courses);
      winner = evaluated.find(course => course.problems.length === 0);
    }
  }
  const degraded = !winner;
  const selectionDoneAt = performance.now();
  if (!winner) {
    winner = seeds[0];
  }
  const rows = winner ? assignStartTimes(winner.rows, grounded, input.state, input.condition.startTime) : [];
  const reply = buildReply(rows, grounded, input.condition, "", degraded ? "fallback" : "openai", input.state, input.saved);
  const requested = input.state.discovery?.requiredActivities ?? input.state.activities;
  const activityNames: Record<string, string> = { meal: "식사", cafe: "카페", performance: "공연장", movie: "영화", exhibit: "전시", walk: "산책", indoor: "실내 활동", nightview: "야경" };
  const focus = [...new Set([...(input.state.discovery?.activityOrder ?? []), ...requested])]
    .slice(0, 3).map(activity => activityNames[activity] ?? activity).join("·");
  const opening = focus
    ? input.state.discovery?.activityOrder?.length && input.state.discovery.activityOrder.length >= 2
      ? `${focus} 순서로 ${reply.items.length}곳을 골랐어요.`
      : `${focus} 경험을 담은 ${reply.items.length}곳을 골랐어요.`
    : `${input.condition.region}에서 이어갈 ${reply.items.length}곳을 골랐어요.`;
  const qualifiers = [
    degraded && winner ? "AI가 제안한 코스는 조건 검증을 통과하지 못해, 검색된 장소로 구성한 대안을 보여드려요." : "",
    wantsCafeAtmosphere(input.state) && winner?.rows.some(row => {
      const candidate = grounded.find(item => dateCandidateKey(item) === row.id);
      return candidate && candidateActivitySlot(candidate) === "cafe" && !hasCafeSpaceEvidence(candidate);
    }) ? "요청하신 카페의 공간 분위기는 확인하지 못했어요. 가까운 카페를 임시로 넣었으니 상세 사진을 확인해 주세요." : "",
    winner?.rows.some(row => grounded.some(candidate => dateCandidateKey(candidate) === row.id && matchesActivity(candidate, "performance")))
      ? "공연장은 장소만 확인했어요. 방문일의 공연·좌석·예매 가능 여부는 장소 정보에서 확인해 주세요." : "",
    input.state.budgetWon ? `두 분 합계 ${input.state.budgetWon.toLocaleString("ko-KR")}원 예산은 메뉴와 입장료 확인이 더 필요해요.` : "",
  ].filter(Boolean);
  reply.message = [opening, ...qualifiers].join(" ");
  reply.card.lines = [opening, ...qualifiers];
  reply.card.headline = input.condition.region + (days > 1 ? ` ${days - 1}박${days}일` : ` ${reply.items.length}곳`);
  if (!input.condition.timeSpecified) reply.card.stops = reply.card.stops?.map(stop => ({ ...stop, startTime: undefined, durationMinutes: undefined }));
  reply.design = {
    theme: winner?.theme ?? "", alternativesConsidered: considered, routeBasis: "straight_line",
    totalDistanceMeters: Math.round(winner?.meters ?? 0), evidenceCount: winner?.evidenceCount ?? 0, degraded,
    rejectionReasons: [...rejectionReasons],
  };
  console.info("date_course_design", JSON.stringify({ traceId: input.traceId,
    researchedCandidates: grounded.filter(candidate => candidate.evidence?.length).length,
    catalogCount: grounded.length, seedCount: seeds.length, modelProposalCount: considered, degraded,
    researchMs: Math.round(researchDoneAt - startedAt), seedMs: Math.round(seedDoneAt - researchDoneAt),
    selectionMs: Math.round(selectionDoneAt - seedDoneAt) }));
  return reply;
}

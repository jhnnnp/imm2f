import type { DiscoverCandidate, Place } from "@/features/places/types/place";
import type { AIPlanCondition, AIPlaceRecommendation, AIPlannerReply, AIPlannerState, DateChatTurn, PlanItem } from "@/features/planning/types/plan";
import { discoverPlaceId } from "@/features/places/discover";
import { courseSize, matchesActivity } from "@/features/ai/dateBrief";
import {
  allowsHarshDateMeal,
  categoryLeaf,
  courseSuggestions,
  dateCandidateKey,
  defaultDuration,
  groundedStopReason,
  heuristicRows,
  preferredSavedNames,
  travelGapMinutes,
  validateModelRows,
  type DateCourseRow,
  type DateRankContext,
} from "@/features/ai/dateCourse";
import { completeJson } from "./client";
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

function minutesOf(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
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

function preferenceSummary(saved: Place[]) {
  const category = new Map<string, { positive: number; negative: number }>();
  for (const place of saved) {
    const row = category.get(place.categoryLabel) ?? { positive: 0, negative: 0 };
    const statuses = [place.userStatus, place.partnerStatus];
    row.positive += statuses.filter(status => ["want", "must_visit", "revisit", "visited"].includes(status)).length;
    row.negative += statuses.filter(status => ["dislike", "not_interested"].includes(status)).length;
    category.set(place.categoryLabel, row);
  }
  return [...category.entries()]
    .sort((a, b) => (b[1].positive - b[1].negative) - (a[1].positive - a[1].negative))
    .map(([name, score]) => `${name}: 선호 ${score.positive}, 비선호 ${score.negative}`)
    .join(" / ") || "아직 충분한 취향 기록이 없음";
}

function savedHistory(saved: Place[]) {
  return saved.slice(0, 40).map(place => ({
    name: place.name,
    category: place.categoryLabel,
    district: place.district,
    userStatus: place.userStatus,
    partnerStatus: place.partnerStatus,
  }));
}

function honestMessage(region: string, count: number, meters: number) {
  const length = meters < 1000 ? `직선 ${meters}m` : `직선 ${(meters / 1000).toFixed(1)}km`;
  return `${region} ${count}곳 · ${length}`;
}

function buildReply(
  rows: DateCourseRow[],
  candidates: DiscoverCandidate[],
  condition: AIPlanCondition,
  _message: string,
  source: AIPlannerReply["source"],
  state: AIPlannerState,
  saved: Place[],
): AIPlannerReply {
  const byId = new Map(candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  const recommendations: AIPlaceRecommendation[] = [];
  const items: PlanItem[] = [];
  const seen = new Set<string>();
  const savedNames = new Set(saved.map(place => place.name));
  const maxStops = courseSize(state).max;

  for (const row of rows) {
    const id = String(row.id ?? "");
    const candidate = byId.get(id);
    if (!candidate || seen.has(id) || recommendations.length >= maxStops) continue;
    seen.add(id);
    const durationMinutes = clamp(row.duration_minutes, 30, 180, defaultDuration(candidate, state.pace));
    const previousItem = items.at(-1);
    const previousRec = recommendations.at(-1);
    const gap = travelGapMinutes(previousRec?.coordinates, candidate.coordinates);
    const earliest = previousItem ? addMinutes(previousItem.startTime, previousItem.durationMinutes + gap) : null;
    const suggested = parseClock(row.start_time);
    const startTime = !earliest
      ? parseTime(row.start_time, condition.startTime)
      : suggested && minutesOf(suggested) >= minutesOf(earliest)
        ? suggested
        : earliest;
    const placeId = discoverPlaceId(candidate.externalSource, candidate.externalPlaceId);
    const meters = previousRec?.coordinates && candidate.coordinates
      ? Math.round(distanceMeters(previousRec.coordinates, candidate.coordinates))
      : null;
    const reason = groundedStopReason({
      candidate,
      previous: previousRec ? byId.get(previousRec.id) ?? null : null,
      meters,
      saved: savedNames.has(candidate.name),
    });
    recommendations.push({
      id,
      placeId,
      name: candidate.name,
      category: candidate.categoryLabel,
      district: candidate.district,
      address: candidate.roadAddress || candidate.address,
      phone: candidate.phone,
      mapUrl: candidate.mapUrl,
      coordinates: candidate.coordinates,
      durationMinutes,
      expectedCost: 0,
      reasons: [reason],
      isSaved: savedNames.has(candidate.name),
      distanceFromPreviousMeters: meters,
    });
    items.push({
      id: `ai-recommend-${candidate.externalSource}-${candidate.externalPlaceId}`,
      placeId,
      placeName: candidate.name,
      category: candidate.categoryLabel,
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
  const routeMeters = recommendations.reduce((sum, place) => sum + (place.distanceFromPreviousMeters ?? 0), 0);
  const region = condition.region || "오늘";
  const festivalRec = recommendations.find(place => byId.get(place.id)?.category === "festival");
  const festivalMeta = festivalRec ? byId.get(festivalRec.id) : undefined;
  const headline = size.days > 1
    ? `${region} ${size.days - 1}박${size.days}일`
    : festivalRec
      ? `${region} · ${festivalRec.name}`
      : `${region} ${recommendations.length}곳`;
  const line = festivalMeta?.openingHours
    ? `${honestMessage(region, recommendations.length, routeMeters)} · ${festivalMeta.openingHours}`
    : honestMessage(region, recommendations.length, routeMeters);

  return {
    status: "plan",
    message: line,
    card: {
      headline,
      lines: [line],
      stops: recommendations.map((place, index) => ({
        name: place.name,
        meta: `${categoryLeaf(byId.get(place.id)?.detailedCategory, place.category)} · ${place.district}`,
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

const DATE_CURATOR_PROMPT = [
  "You are a Korean couple date-course curator. Design a realistic day from Kakao candidates only.",
  "Hard rules:",
  "- Every selected.id must exist in candidates.",
  "- Never invent travel times, prices, opening hours, ratings, menus, photos, food types, or ids.",
  "- A reason may only restate Kakao detailedCategory, walking-distance hops, saved=true, or why this id beats a neighbor. If you are unsure, omit the flourish.",
  "- Do not call a pizzeria 한식. Do not call a gallery a cafe. Do not call a gallery 야경.",
  "- Empty activities still need a mixed day: at most one exhibit or festival per day, and include a cafe or a meal when those candidates exist. Two exhibits in a row is a failure.",
  "- Prefer a currently-running festival (category festival, openingHours set) over a generic gallery when hops stay walkable.",
  "- At most one festival per day. Do not fill the rest of the day with a second festival.",
  "- Never pick 사주/타로/점집 even if Kakao tags them as cafes.",
  "- Unless latestMessage asks for 회/포차/고기/술, do not pick hoe houses, pocha, hof, BBQ-only, convenience stores, or karaoke.",
  "- For an unspecified meal prefer pasta, brunch, bakery, or a sit-down Korean restaurant over the nearest raw-fish shop.",
  "- Do not add a restaurant unless activities includes meal or activities is empty.",
  "- Do not add indoor entertainment unless activities includes indoor or activities is empty.",
  "- Include every requiredPlaces name when a matching candidate exists.",
  "- If keepPlaces is non-empty, keep those venues in the same relative order and change only what latestMessage asked. If latestMessage asks to redo or stay only in named pockets, you may replace keepPlaces.",
  "- Never claim the route meets a budget.",
  "Design:",
  "- targetStops.min to targetStops.max is the legal size. Two stops only for evening/night dates. Afternoon and daytrip need at least 3.",
  "- Consecutive stops should usually be hops.walk (250-900m). Do not stack sameBlock. Do not send the couple to 남산타워, 롯데타워, or another gu for an 을지로 date.",
  "- nearby: include one neighboring pocket when candidates exist (을지로+청계천/익선동/충무로, 성수+서울숲).",
  "- Set start_time and duration_minutes. Reset start_time on each new day_index.",
  "Message: one factual Korean sentence under 80 characters. No vibe adjectives. No place names.",
  "Return JSON: {message:string,selected:[{id,start_time:'HH:MM',duration_minutes:30-180,day_index:0,expected_cost:0,reasons:[1 concise Korean string]}]}",
].join(" ");

export async function recommendDatePlanWithOpenAi(input: {
  prompt: string;
  condition: AIPlanCondition;
  candidates: DiscoverCandidate[];
  saved: Place[];
  state: AIPlannerState;
  coupleTaste?: { summary: string; commonTastes: Array<{ label: string }>; youHighlights: string[]; partnerHighlights: string[] } | null;
  recentlyVisited?: string[];
  conversation?: DateChatTurn[];
}): Promise<AIPlannerReply> {
  const rankContext: DateRankContext = {
    savedPositive: preferredSavedNames(input.saved),
    recentlyVisited: new Set(input.recentlyVisited ?? []),
    commonTastes: (input.coupleTaste?.commonTastes ?? []).map(item => item.label).filter(Boolean),
    activities: input.state.activities,
    allowHarsh: allowsHarshDateMeal(input.prompt, input.state.cuisine),
  };
  const fallback = () => buildReply(
    heuristicRows(input.candidates, input.condition.startTime, input.state, input.saved),
    input.candidates,
    input.condition,
    "",
    "fallback",
    input.state,
    input.saved,
  );
  if (!isOpenAiConfigured()) return fallback();

  const savedNames = preferredSavedNames(input.saved);
  const candidateCatalog = input.candidates.slice(0, 30).map(candidate => ({
    id: dateCandidateKey(candidate),
    name: candidate.name,
    category: candidate.categoryLabel,
    detailedCategory: candidate.detailedCategory,
    district: candidate.district,
    address: candidate.roadAddress || candidate.address,
    searchRegion: candidate.searchRegion,
    saved: savedNames.has(candidate.name),
    recentlyVisited: rankContext.recentlyVisited.has(candidate.name),
    fitsActivities: input.state.activities.filter(activity => matchesActivity(candidate, activity)),
    coordinates: candidate.coordinates,
    hops: hopBands(candidate, input.candidates),
  }));

  try {
    const parsed = await completeJson<{ message?: string; selected?: DateCourseRow[] }>({
      temperature: 0.2,
      maxTokens: 2500,
      reasoningEffort: "low",
      messages: [
        { role: "system", content: DATE_CURATOR_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            task: "Design one realistic date or trip from these candidates. You choose the venues, order, stay length, day_index, and the reason each stop exists.",
            targetStops: courseSize(input.state),
            stay: { kind: input.state.stayKind, nights: input.state.nights },
            latestMessage: input.prompt.slice(0, 800),
            recentTurns: (input.conversation ?? []).slice(-8),
            brief: {
              activities: input.state.activities,
              areas: input.state.areas,
              areaScope: input.state.areaScope,
              requiredPlaces: input.state.requiredPlaces,
              keepPlaces: input.state.preserveExistingPlaces ? input.state.requiredPlaces : [],
              excludedPlaces: input.state.excludedPlaces,
              cuisine: input.state.cuisine,
              indoorPlay: input.state.indoorPlay,
              stayKind: input.state.stayKind,
              nights: input.state.nights,
              timeWindow: input.state.timeWindow,
              pace: input.state.pace,
              notes: input.state.conversationNotes.slice(-6),
            },
            timeWindow: {
              id: input.state.timeWindow,
              start: input.condition.startTime,
              end: input.condition.endTime,
              specified: input.condition.timeSpecified,
              dateLabel: input.condition.dateLabel,
            },
            coupleTaste: input.coupleTaste ?? { summary: preferenceSummary(input.saved) },
            recentlyVisited: input.recentlyVisited ?? [],
            savedHistory: savedHistory(input.saved),
            candidates: candidateCatalog,
          }),
        },
      ],
    });
    if (!parsed) return fallback();
    const rows = validateModelRows(parsed.selected ?? [], input.candidates, input.state);
    const reply = buildReply(rows, input.candidates, input.condition, parsed.message ?? "", "openai", input.state, input.saved);
    return reply.items.length >= Math.min(2, courseSize(input.state).min) ? reply : fallback();
  } catch {
    return fallback();
  }
}

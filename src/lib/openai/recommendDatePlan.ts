import type { DiscoverCandidate, Place } from "@/features/places/types/place";
import type { AIPlanCondition, AIPlaceRecommendation, AIPlannerReply, AIPlannerState, DateChatTurn, DatePreviousStop, PlanItem } from "@/features/planning/types/plan";
import { discoverPlaceId } from "@/features/places/discover";
import { courseSize, dateSpine, isExclusiveCrawl, isTravelPlan } from "@/features/ai/dateBrief";
import {
  allowsHarshDateMeal,
  bothWantNames,
  candidateActivitySlot,
  courseSuggestions,
  dateCandidateKey,
  dateCategoryLabel,
  defaultDuration,
  diversifyDateCatalog,
  groundedStopReason,
  heuristicRows,
  pickCourseMessage,
  preferredSavedNames,
  rankDateCandidates,
  scoreDateCandidate,
  travelGapMinutes,
  validateModelRows,
  type DateCourseRow,
  type DateRankContext,
} from "@/features/ai/dateCourse";
import { completeJson, completeJsonWithWebSearch } from "./client";
import { applyPlaceWebFacts, publicPlaceFactLine, sanitizePlaceWebFacts } from "./placeWebFacts";
import { writePlaceDetailCache } from "@/lib/places/detailCache";
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
  const maxStops = courseSize(state).max;

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
      saved: preferred.has(candidate.name),
      bothWant: bothWant.has(candidate.name),
    });
    recommendations.push({
      id,
      placeId,
      name: candidate.name,
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
      factSourceUrl: candidate.factSourceUrl,
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
        reason: publicPlaceFactLine(place) || place.reasons[0],
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

const PLACE_FACTS_PROMPT = [
  "You look up public facts for Korean shops. You have web_search. Korea location is set.",
  "For each candidate, search separately: '{name} {address or district} 네이버지도' or 카카오맵.",
  "Copy only from a result that is clearly the same shop: star rating as shown, review count as shown, a short menu/food noun for restaurants and cafes.",
  "Never invent a rating. Never round a missing count to 50 or 100. If there is no number, omit rating.",
  "Never copy shop A's food onto shop B. Never use 전시/산책로/자연경관/분위기/식사 as food.",
  "sourceUrl must be the page you used (place.map.kakao.com/ID or map.naver.com/...). Not https://map.kakao.com/ with no place path.",
  "After searching, return JSON only: {facts:[{id,rating,ratingCount,food,sourceUrl}]}",
].join(" ");

const DATE_CURATOR_PROMPT = [
  "You are the date-course judge in a live Korean chat with a couple.",
  "Read latestMessage as their turn and recentTurns as the conversation. currentCourse is what you already proposed. You pick shops from candidates[]. You do not invent shops.",
  "",
  "TABLE",
  "- Every selected.id must be a candidate.id.",
  "- Columns: leaf, address, slot, hops, saved, bothWant, recentlyVisited, coupleScore, rating, ratingCount, food, factSourceUrl.",
  "- coupleScore is a saved/distance/taste hint. It is not stars.",
  "- rating/food/factSourceUrl are search copies. Missing facts ≠ bad and ≠ 0점. Do not invent them. Put used facts in facts[] (copy from the row).",
  "",
  "HOW TO CHOOSE (in this order)",
  "1. The user's latest turn. Follow its meaning, including paraphrases and chips like 일정추가/카페변경. Do not wait for a keyword list.",
  "2. Hard constraints: requiredPlaces, excludedPlaces, cuisine if set, brief.spine as the day's skeleton, brief.anchorActivities as must-include, brief.exclusiveCrawl, brief.addStop. brief.shortlist are shops the user just saw and liked in this chat: include at least one of them when it fits the slot.",
  "3. Couple data: bothWant > saved > not recentlyVisited.",
  "4. Public facts: when two shops share a slot, prefer a sourced rating and more reviews.",
  "5. Walk: consecutive hops.walk (250-900m) on a neighborhood date. Do not stack sameBlock. No 남산/롯데타워 on an 을지로 date.",
  "6. Mix: follow brief.spine. That is eat, linger, then one more nearby thing when the situation has a third slot. Named activities are anchors inside the spine, not the whole day. 카페 in the brief means include a cafe, not four cafes. Do not apply meal+walk+tourism to every date. Do not fill the day with one slot.",
  "7. Only if exclusiveCrawl is true (카페 투어 / 맛집 투어) may you stay inside brief.anchorActivities. Even then, two cafes is a tour. Never four of the same slot.",
  "",
  "HARD RULES",
  "- Never invent ids, travel times, prices, hours, photos, menus, or ratings.",
  "- A reason may only restate Kakao leaf, saved=true, bothWant, or copied facts. Never 맛집. No vibe.",
  "- Do not call a pizzeria 한식. Do not call a gallery a cafe.",
  "- Trip: real attractions/nature/markets plus meals when they fit. Hops 2-8km allowed. Not a cafe crawl.",
  "- At most two cafes and two sit-down meals per day. At most two galleries unless they asked for an exhibit tour (then three). Prefer brief.spine over repeating one slot.",
  "- Never pick 사주/타로/점집/분식/패스트푸드/테마카페. Never pick takeout coffee chains 메가MGC/메가커피/컴포즈/빽다방/더벤티. Independent cafes, bakeries, dessert shops, tearooms, and sit-down chains (스타벅스/투썸/커피빈/이디야) are allowed. Do not force 스타벅스 or 투썸 when a neighborhood cafe exists.",
  "- Unless latestMessage asks for 회/포차/술, skip hoe houses, pocha, hof.",
  "- Prefer a sit-down meal near 12:00 or 18:00 when the day includes one. A second meal may sit later. Do not invent a 15:00 lunch if a noon slot exists.",
  "- Keep currentCourse / keepPlaces in relative order only when addStop, a swap, or a drop asked for it. If latestMessage asks to reshape (조금 다르게, 다른 코스, 다시 추천), pick a new set from candidates.",
  "- If they want another stop (addStop true, or the turn means add/also eat/longer day/일정추가): keep every keepPlaces stop and append one new id. Returning the same set is wrong.",
  "- Never claim a budget.",
  "",
  "SIZE: targetStops.min..max is a range. Evening/night is 2-3. Afternoon neighborhood is 2-4. First dates stay closer to 3.",
  "Set start_time and duration_minutes. Reset start_time on each new day_index.",
  "MESSAGE: 2-3 warm Korean 해요체 sentences, under 280 characters, like a friend who knows the neighborhood. Name EVERY chosen stop in walking order and give each one concrete hook from its row (leaf category, copied food or rating, saved/bothWant, the walk between). If brief.shortlist is non-empty and you used one, say so. No emoji. Never add facts that are not in the row.",
  "reasons[0] per stop: one short Korean phrase from the row (e.g. 파스타 · 4.4점, 둘이 저장한 곳, 앞에서 300m). Not 맛집, not vibe.",
  "Return JSON: {message,facts:[{id,rating,ratingCount,food,sourceUrl,note}],selected:[{id,start_time:'HH:MM',duration_minutes:30-180,day_index:0,expected_cost:0,reasons:[1 concise Korean string]}]}",
].join(" ");

export async function recommendDatePlanWithOpenAi(input: {
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
  const rankContext: DateRankContext = {
    savedPositive: preferredSavedNames(input.saved),
    savedBoth: bothWantNames(input.saved),
    recentlyVisited: new Set(input.recentlyVisited ?? []),
    commonTastes: (input.coupleTaste?.commonTastes ?? []).map(item => item.label).filter(Boolean),
    activities: dateSpine(input.state),
    allowHarsh: allowsHarshDateMeal(input.prompt, input.state.cuisine),
    trip: isTravelPlan(input.state),
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
  const bothWant = bothWantNames(input.saved);
  const locked = input.state.activities;
  const ranked = rankDateCandidates(input.candidates, rankContext);
  const savedFirst: DiscoverCandidate[] = [];
  const used = new Set<string>();
  for (const candidate of ranked) {
    if (!savedNames.has(candidate.name)) continue;
    used.add(dateCandidateKey(candidate));
    savedFirst.push(candidate);
  }
  const rest = ranked.filter(candidate => !used.has(dateCandidateKey(candidate)));
  const catalog = [...savedFirst, ...diversifyDateCatalog(rest, Math.max(0, 32 - savedFirst.length))].slice(0, 36);
  const candidateCatalog = catalog.map(candidate => {
    const id = dateCandidateKey(candidate);
    return {
      id,
      name: candidate.name,
      leaf: candidate.detailedCategory || dateCategoryLabel(candidate),
      category: dateCategoryLabel(candidate),
      district: candidate.district,
      address: candidate.roadAddress || candidate.address,
      mapUrl: candidate.mapUrl,
      saved: savedNames.has(candidate.name),
      bothWant: bothWant.has(candidate.name),
      recentlyVisited: rankContext.recentlyVisited.has(candidate.name),
      slot: candidateActivitySlot(candidate),
      coupleScore: scoreDateCandidate(candidate, rankContext),
      hops: hopBands(candidate, catalog),
      rating: candidate.rating ?? null,
      ratingCount: candidate.ratingCount ?? null,
      food: candidate.dishes || null,
      factSourceUrl: candidate.factSourceUrl || null,
    };
  });
  const allowedIds = new Set(candidateCatalog.map(candidate => candidate.id));
  // Restaurants and cafes are where the couple compares options, so those
  // rows get the public-fact lookup first; saved shops always qualify.
  const lookup = candidateCatalog
    .filter(row => row.saved || row.bothWant || row.rating == null)
    .sort((a, b) => (
      Number(b.saved) - Number(a.saved)
      || Number(b.slot === "meal" || b.slot === "cafe") - Number(a.slot === "meal" || a.slot === "cafe")
      || b.coupleScore - a.coupleScore
    ))
    .slice(0, 12);
  let facts = sanitizePlaceWebFacts([], allowedIds);
  try {
    const searched = lookup.length
      ? await completeJsonWithWebSearch<{ facts?: unknown }>({
        instructions: PLACE_FACTS_PROMPT,
        payload: {
          candidates: lookup.map(row => ({
            id: row.id,
            name: row.name,
            district: row.district,
            address: row.address,
            slot: row.slot,
          })),
        },
        maxTokens: 1600,
        timeoutMs: 40000,
        requireSearch: true,
      })
      : null;
    facts = sanitizePlaceWebFacts(searched?.facts, allowedIds);
  } catch {
    facts = [];
  }
  const groundedPool = applyPlaceWebFacts(input.candidates, facts);
  const groundedCatalog = applyPlaceWebFacts(catalog, facts);
  if (facts.length) void writePlaceDetailCache(groundedCatalog);
  const factById = new Map(groundedCatalog.map(candidate => [dateCandidateKey(candidate), candidate]));
  const judged = candidateCatalog.map(row => {
    const live = factById.get(row.id);
    return {
      ...row,
      rating: live?.rating ?? row.rating,
      ratingCount: live?.ratingCount ?? row.ratingCount,
      food: live?.dishes || row.food,
      factSourceUrl: live?.factSourceUrl || row.factSourceUrl,
    };
  });

  const curatorPayload = {
    task: "Select a course from the verified table. You cannot search or create new facts. Follow the user's constraints and current course edits.",
    targetStops: courseSize(input.state),
    stay: { kind: input.state.stayKind, nights: input.state.nights, trip: isTravelPlan(input.state) },
    latestMessage: input.prompt.slice(0, 800),
    recentTurns: (input.conversation ?? []).slice(-8),
    currentCourse: (input.currentCourse ?? []).slice(0, 8),
    brief: {
      activitiesLocked: false,
      exclusiveCrawl: isExclusiveCrawl(input.state),
      spine: dateSpine(input.state),
      anchorActivities: locked,
      addStop: input.state.addStop,
      areas: input.state.areas,
      areaScope: input.state.areaScope,
      requiredPlaces: input.state.requiredPlaces,
      shortlist: (input.state.shownPlaces ?? []).slice(0, 6),
      keepPlaces: input.state.preserveExistingPlaces
        ? (input.state.pinOrder.length ? input.state.pinOrder : input.state.requiredPlaces)
        : [],
      excludedPlaces: input.state.excludedPlaces,
      cuisine: input.state.cuisine,
      indoorPlay: input.state.indoorPlay,
      stayKind: input.state.stayKind,
      nights: input.state.nights,
      timeWindow: input.state.timeWindow,
      pace: input.state.pace,
      budgetWon: input.state.budgetWon ?? null,
      walkingPreference: input.state.walkingPreference ?? null,
      notes: input.state.conversationNotes.slice(-6),
    },
    timeWindow: {
      id: input.state.timeWindow,
      start: input.condition.startTime,
      end: input.condition.endTime,
      specified: input.condition.timeSpecified,
      dateLabel: input.condition.dateLabel,
    },
    couple: {
      summary: input.coupleTaste?.summary || preferenceSummary(input.saved),
      commonTastes: (input.coupleTaste?.commonTastes ?? []).map(item => item.label).filter(Boolean),
      youHighlights: input.coupleTaste?.youHighlights ?? [],
      partnerHighlights: input.coupleTaste?.partnerHighlights ?? [],
      avoidFoods: input.coupleTaste?.avoidFoods ?? [],
      recentlyVisited: input.recentlyVisited ?? [],
      savedHistory: savedHistory(input.saved),
    },
    candidates: judged,
  };

  try {
    const parsed = await completeJson<{ message?: string; selected?: DateCourseRow[]; facts?: unknown }>({
      temperature: 0.3,
      maxTokens: 2500,
      reasoningEffort: "low",
      timeoutMs: 45000,
      messages: [
        { role: "system", content: DATE_CURATOR_PROMPT },
        { role: "user", content: JSON.stringify(curatorPayload) },
      ],
    });
    if (!parsed) return fallback();
    // The curator has no search tool. It must not overwrite verified facts.
    const grounded = groundedPool;
    const rows = validateModelRows(parsed.selected ?? [], grounded, input.state);
    const reply = buildReply(rows, grounded, input.condition, parsed.message ?? "", "openai", input.state, input.saved);
    return reply.items.length >= Math.min(2, courseSize(input.state).min) ? reply : fallback();
  } catch {
    return fallback();
  }
}

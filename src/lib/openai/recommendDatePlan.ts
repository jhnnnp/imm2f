import type { DiscoverCandidate, Place } from "@/features/places/types/place";
import type { AIPlanCondition, AIPlaceRecommendation, AIPlannerReply, AIPlannerState, PlanItem } from "@/features/planning/types/plan";
import { discoverPlaceId } from "@/features/places/discover";
import { getOpenAiApiKey, getOpenAiModel, isOpenAiConfigured } from "./env";

type SelectedRow = {
  id?: string;
  start_time?: string;
  duration_minutes?: number;
  expected_cost?: number;
  reasons?: string[];
};

type ModelPayload = { message?: string; selected?: SelectedRow[] };

function candidateKey(item: DiscoverCandidate) {
  return `${item.externalSource}:${item.externalPlaceId}`;
}

function parseTime(value: unknown, fallback: string) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(raw)) return fallback;
  const [hour, minute] = raw.split(":").map(Number);
  if (hour > 23 || minute > 59) return fallback;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour * 60 + minute + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function distanceMeters(from: [number, number], to: [number, number]) {
  const radians = (degree: number) => degree * Math.PI / 180;
  const earth = 6371000;
  const deltaLat = radians(to[1] - from[1]);
  const deltaLng = radians(to[0] - from[0]);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(from[1])) * Math.cos(radians(to[1])) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
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

function matchesTerm(candidate: DiscoverCandidate, term: string) {
  const candidateName = candidate.name.replace(/\s/g, "");
  const normalized = term.replace(/\s/g, "");
  return candidateName.includes(normalized) || normalized.includes(candidateName);
}

function matchesCategory(candidate: DiscoverCandidate, category: string) {
  const details = `${candidate.categoryLabel} ${candidate.detailedCategory ?? ""}`;
  if (category === "실내 놀거리") return /볼링장|방탈출|보드게임|보드카페|오락실|만화카페|노래방|VR카페|실내테마파크/.test(details);
  if (category === "한식" || category === "일식" || category === "중식" || category === "양식") return details.includes(category);
  return details.includes(category);
}

function semanticPlaceKey(candidate: DiscoverCandidate) {
  const compact = candidate.name.replace(/\s/g, "");
  if ((candidate.kakaoCategoryGroupCode === "SW8" || candidate.categoryLabel.includes("지하철")) && compact.includes("역")) {
    return `station:${compact.replace(/\d+호선$|경의중앙선$|수인분당선$|경춘선$/g, "")}`;
  }
  if (compact.includes("한강공원")) return `park:${compact.match(/한강공원(?:옥수|금호)?/)?.[0] ?? "한강공원"}`;
  return candidateKey(candidate);
}

function heuristicRows(candidates: DiscoverCandidate[], condition: AIPlanCondition, saved: Place[], state: AIPlannerState): SelectedRow[] {
  const visitedNames = new Set(saved.filter(place => place.userStatus === "visited" || place.partnerStatus === "visited").map(place => place.name));
  const categoryOrder = ["카페", "음식점", "문화", "관광", "자연", "책방"];
  const sorted = [...candidates].sort((a, b) => {
    const requiredA = state.requiredPlaces.some(term => matchesTerm(a, term)) ? 100 : 0;
    const requiredB = state.requiredPlaces.some(term => matchesTerm(b, term)) ? 100 : 0;
    const freshA = visitedNames.has(a.name) ? 0 : 20;
    const freshB = visitedNames.has(b.name) ? 0 : 20;
    return (requiredB + freshB + Math.max(0, 10 - categoryOrder.indexOf(b.categoryLabel))) - (requiredA + freshA + Math.max(0, 10 - categoryOrder.indexOf(a.categoryLabel)));
  });
  const selected: DiscoverCandidate[] = [];
  const usedCategories = new Set<string>();
  for (const candidate of sorted) {
    if (selected.length >= 5) break;
    if (usedCategories.has(candidate.categoryLabel) && selected.length < 3) continue;
    selected.push(candidate);
    usedCategories.add(candidate.categoryLabel);
  }
  let cursor = Number(condition.startTime.slice(0, 2)) * 60 + Number(condition.startTime.slice(3));
  return selected.map((candidate, index) => {
    const start = `${String(Math.floor(cursor / 60) % 24).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`;
    const duration = candidate.category === "cafe" ? 80 : candidate.category === "restaurant" ? 70 : 90;
    cursor += duration;
    return {
      id: candidateKey(candidate),
      start_time: start,
      duration_minutes: duration,
      expected_cost: 0,
      reasons: [
        index === 0 ? `${condition.region || "원하는 지역"}에서 시작하기 좋은 곳이에요.` : "앞뒤 장소와 한 흐름으로 묶기 좋아요.",
        visitedNames.has(candidate.name) ? "다시 가고 싶은 기록을 반영했어요." : "둘의 방문 기록에 없는 새로운 후보예요.",
      ],
    };
  });
}

function buildReply(
  rows: SelectedRow[],
  candidates: DiscoverCandidate[],
  condition: AIPlanCondition,
  message: string,
  source: AIPlannerReply["source"],
  state: AIPlannerState,
): AIPlannerReply {
  const byId = new Map(candidates.map(candidate => [candidateKey(candidate), candidate]));
  const recommendations: AIPlaceRecommendation[] = [];
  const items: PlanItem[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const id = String(row.id ?? "");
    const candidate = byId.get(id);
    if (!candidate || seen.has(id) || recommendations.length >= 5) continue;
    seen.add(id);
    const isTransit = `${candidate.categoryLabel} ${candidate.detailedCategory ?? ""}`.includes("지하철") || candidate.name.endsWith("역");
    const durationMinutes = clamp(row.duration_minutes, isTransit ? 10 : 30, 180, isTransit ? 15 : 70);
    const expectedCost = 0;
    const previousItem = items.at(-1);
    const startTime = previousItem
      ? addMinutes(previousItem.startTime, previousItem.durationMinutes)
      : parseTime(row.start_time, condition.startTime);
    const placeId = discoverPlaceId(candidate.externalSource, candidate.externalPlaceId);
    const proposedReasons = (row.reasons ?? []).map(reason => String(reason).trim().slice(0, 90)).filter(Boolean).slice(0, 3);
    const contradictsCategory = candidate.category !== "restaurant" && proposedReasons.some(reason => /한식|일식|중식|양식|식사|맛있는 음식|맛집/.test(reason));
    const reasons = contradictsCategory ? ["요청한 활동과 동선에 맞는 장소예요.", "주변 장소와 자연스럽게 이어져요."] : proposedReasons;
    const previous = recommendations.at(-1);
    recommendations.push({
      id,
      placeId,
      name: candidate.name,
      category: candidate.categoryLabel,
      district: candidate.district,
      address: candidate.roadAddress || candidate.address,
      mapUrl: candidate.mapUrl,
      coordinates: candidate.coordinates,
      durationMinutes,
      expectedCost,
      reasons: reasons.length ? reasons : ["두 사람의 조건과 동선을 함께 고려한 후보예요."],
      isSaved: false,
      distanceFromPreviousMeters: previous?.coordinates && candidate.coordinates
        ? distanceMeters(previous.coordinates, candidate.coordinates)
        : null,
    });
    items.push({
      id: `ai-recommend-${candidate.externalSource}-${candidate.externalPlaceId}`,
      placeId,
      placeName: candidate.name,
      category: candidate.categoryLabel,
      startTime,
      durationMinutes,
      expectedCost,
      order: items.length,
      memo: reasons[0] ?? "AI 추천 장소",
      dayIndex: 0,
      coordinates: candidate.coordinates,
    });
  }

  return {
    status: "plan",
    message: message.trim().slice(0, 240) || `${condition.region || "원하는 지역"}에서 이동이 자연스러운 데이트 코스를 골라봤어요.`,
    condition,
    recommendations,
    items,
    candidateCount: candidates.length,
    source,
    state,
  };
}

function validateAndRepairRows(rows: SelectedRow[], candidates: DiscoverCandidate[], state: AIPlannerState) {
  const byId = new Map(candidates.map(candidate => [candidateKey(candidate), candidate]));
  const conversation = state.conversationNotes.join(" ");
  const seenPlaces = new Set<string>();
  const cleaned = rows.filter(row => {
    const candidate = byId.get(String(row.id ?? ""));
    if (!candidate || state.excludedPlaces.some(term => matchesTerm(candidate, term))) return false;
    const key = semanticPlaceKey(candidate);
    if (seenPlaces.has(key)) return false;
    seenPlaces.add(key);
    return true;
  });
  const requiredRows: SelectedRow[] = [];
  const cuisine = ["한식", "일식", "중식", "양식"].find(item => conversation.includes(item));
  const mealRegion = state.regions.find(region => {
    const start = conversation.indexOf(`${region}에서`);
    if (start < 0) return false;
    return /한식|일식|중식|양식|저녁|점심|식사|밥|먹/.test(conversation.slice(start, start + 40));
  });
  if (/(?:저녁|점심|아침|식사|밥|먹)/.test(conversation)) {
    const meal = candidates.find(candidate => candidate.category === "restaurant"
      && (!cuisine || matchesCategory(candidate, cuisine))
      && (!mealRegion || candidate.searchRegion === mealRegion));
    if (meal) requiredRows.push({ id: candidateKey(meal), reasons: [cuisine ? `${cuisine} 요청을 반영했어요.` : "식사 요청을 반영했어요.", "다음 활동으로 이동하기 좋은 곳이에요."] });
  }
  const requestedPlayTypes = [
    conversation.includes("방탈출") ? "방탈출" : "",
    conversation.includes("보드게임") ? "보드게임|보드카페" : "",
    conversation.includes("볼링") ? "볼링장" : "",
    conversation.includes("오락실") ? "오락실" : "",
  ].filter(Boolean);
  if (!requestedPlayTypes.length && /놀거리|놀고|놀러|실내/.test(conversation)) requestedPlayTypes.push("볼링장|방탈출|보드게임|보드카페|오락실|만화카페");
  for (const pattern of requestedPlayTypes.slice(0, 2)) {
    const match = candidates.find(candidate => new RegExp(pattern).test(`${candidate.name} ${candidate.detailedCategory ?? ""}`));
    if (match && !requiredRows.some(row => row.id === candidateKey(match))) requiredRows.push({ id: candidateKey(match), reasons: ["원하는 실내 활동을 반영했어요.", "주변 동선과 자연스럽게 이어져요."] });
  }
  for (const term of state.requiredPlaces) {
    const match = candidates.find(candidate => matchesTerm(candidate, term));
    if (!match) continue;
    const id = candidateKey(match);
    const existing = cleaned.find(row => row.id === id);
    requiredRows.push(existing ?? { id, duration_minutes: match.category === "nature" ? 90 : 30, reasons: [`요청한 ${term}을 반영했어요.`, "동선 안에서 이어지도록 배치했어요."] });
  }
  for (const category of state.preferredCategories) {
    const alreadyCovered = [...requiredRows, ...cleaned].some(row => {
      const candidate = byId.get(String(row.id ?? ""));
      return candidate && matchesCategory(candidate, category);
    });
    if (alreadyCovered) continue;
    const preferredCuisine = state.preferredCategories.find(item => ["한식", "일식", "중식", "양식"].includes(item));
    const match = category === "음식점" && preferredCuisine
      ? candidates.find(candidate => candidate.category === "restaurant" && matchesCategory(candidate, preferredCuisine))
      : candidates.find(candidate => matchesCategory(candidate, category));
    if (match) requiredRows.push({ id: candidateKey(match), duration_minutes: match.category === "restaurant" ? 90 : 60, reasons: [`요청한 ${category} 코스를 반영했어요.`, "가까운 후보 중에서 골랐어요."] });
  }
  const requiredIds = new Set(requiredRows.map(row => row.id));
  const requiredPlaceKeys = new Set(requiredRows.map(row => byId.get(String(row.id ?? ""))).filter((candidate): candidate is DiscoverCandidate => Boolean(candidate)).map(semanticPlaceKey));
  const remaining = cleaned.filter(row => {
    if (requiredIds.has(row.id)) return false;
    const candidate = byId.get(String(row.id ?? ""));
    return !candidate || !requiredPlaceKeys.has(semanticPlaceKey(candidate));
  });
  const ordered = [...requiredRows];
  while (remaining.length && ordered.length < 5) {
    const previous = byId.get(String(ordered.at(-1)?.id ?? ""));
    if (!previous) {
      ordered.push(remaining.shift()!);
      continue;
    }
    remaining.sort((a, b) => {
      const candidateA = byId.get(String(a.id ?? ""));
      const candidateB = byId.get(String(b.id ?? ""));
      return (candidateA ? distanceMeters(previous.coordinates, candidateA.coordinates) : Number.MAX_SAFE_INTEGER)
        - (candidateB ? distanceMeters(previous.coordinates, candidateB.coordinates) : Number.MAX_SAFE_INTEGER);
    });
    const next = remaining.shift()!;
    const nextCandidate = byId.get(String(next.id ?? ""));
    if (nextCandidate && distanceMeters(previous.coordinates, nextCandidate.coordinates) > 1000) continue;
    ordered.push(next);
  }
  if (ordered.length < 2) {
    for (const candidate of candidates) {
      const id = candidateKey(candidate);
      if (ordered.some(row => row.id === id)) continue;
      ordered.push({ id, duration_minutes: candidate.category === "restaurant" ? 90 : 60, reasons: ["전체 코스의 균형을 위해 추가했어요."] });
      if (ordered.length >= 2) break;
    }
  }
  if (/(?:저녁|점심|아침|식사|밥).*한강공원/.test(conversation)) {
    const mealIndex = ordered.findIndex(row => byId.get(String(row.id ?? ""))?.category === "restaurant");
    const parkIndex = ordered.findIndex(row => byId.get(String(row.id ?? ""))?.name.includes("한강공원"));
    if (mealIndex >= 0 && parkIndex >= 0 && mealIndex > parkIndex) {
      const [meal] = ordered.splice(mealIndex, 1);
      const nextParkIndex = ordered.findIndex(row => byId.get(String(row.id ?? ""))?.name.includes("한강공원"));
      ordered.splice(nextParkIndex, 0, meal);
    }
  }
  if (/(?:저녁|점심|아침|식사|밥|먹).*놀/.test(conversation)) {
    const mealIndex = ordered.findIndex(row => byId.get(String(row.id ?? ""))?.category === "restaurant");
    const playIndex = ordered.findIndex(row => {
      const candidate = byId.get(String(row.id ?? ""));
      return candidate ? matchesCategory(candidate, "실내 놀거리") : false;
    });
    if (mealIndex >= 0 && playIndex >= 0 && mealIndex > playIndex) {
      const [meal] = ordered.splice(mealIndex, 1);
      const nextPlayIndex = ordered.findIndex(row => {
        const candidate = byId.get(String(row.id ?? ""));
        return candidate ? matchesCategory(candidate, "실내 놀거리") : false;
      });
      ordered.splice(nextPlayIndex, 0, meal);
    }
  }
  const maxPlay = requestedPlayTypes.length > 1 ? 2 : requestedPlayTypes.length ? 1 : 2;
  let playCount = 0;
  let restaurantCount = 0;
  return ordered.filter(row => {
    const candidate = byId.get(String(row.id ?? ""));
    if (!candidate) return false;
    if (candidate.category === "restaurant") {
      restaurantCount += 1;
      if (restaurantCount > 1) return false;
    }
    if (matchesCategory(candidate, "실내 놀거리")) {
      playCount += 1;
      if (playCount > maxPlay) return false;
    }
    return true;
  }).slice(0, 5);
}

export async function recommendDatePlanWithOpenAi(input: {
  prompt: string;
  condition: AIPlanCondition;
  candidates: DiscoverCandidate[];
  saved: Place[];
  state: AIPlannerState;
}): Promise<AIPlannerReply> {
  const fallback = () => buildReply(
    heuristicRows(input.candidates, input.condition, input.saved, input.state),
    input.candidates,
    input.condition,
    "둘의 취향과 요청을 기준으로, 이동이 자연스러운 순서로 골라봤어요.",
    "fallback",
    input.state,
  );
  if (!isOpenAiConfigured()) return fallback();

  const candidateCatalog = input.candidates.slice(0, 30).map(candidate => ({
    id: candidateKey(candidate),
    name: candidate.name,
    category: candidate.categoryLabel,
    detailedCategory: candidate.detailedCategory,
    district: candidate.district,
    address: candidate.roadAddress || candidate.address,
    searchRegion: candidate.searchRegion,
    coordinates: candidate.coordinates,
    nearbyWithin1km: input.candidates
      .filter(other => candidateKey(other) !== candidateKey(candidate) && distanceMeters(candidate.coordinates, other.coordinates) <= 1000)
      .sort((a, b) => distanceMeters(candidate.coordinates, a.coordinates) - distanceMeters(candidate.coordinates, b.coordinates))
      .slice(0, 5)
      .map(other => ({ id: candidateKey(other), meters: distanceMeters(candidate.coordinates, other.coordinates) })),
  }));

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${getOpenAiApiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOpenAiModel(),
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are a Korean date-planning assistant.",
              "Choose 2-5 places ONLY from the supplied candidates and arrange a realistic route.",
              "First identify the user's core intent and required stops. These are anchors, not a rule that every stop must be in one neighborhood.",
              "A date may connect multiple neighborhoods, for example eating in Seongsu and doing an activity near Konkuk University, or walking from Seoul Forest to Ttukseom Hangang Park.",
              "You may add 0-2 complementary places the user did not explicitly request when they are within about 1km of an anchor or route stop and genuinely improve the date flow.",
              "Do not add filler merely to increase the place count. Prefer two strong stops over three repetitive stops, and avoid returning to an earlier neighborhood without a clear reason.",
              "Use nearbyWithin1km to recognize natural additions and coordinates to avoid backtracking.",
              "Respect the region, available time window, saved preference history, and the user's latest natural-language request.",
              "Budget is only a soft preference because candidate prices are unavailable; never claim the route meets a budget.",
              "Do not invent travel times, prices, opening hours, places, or ids. Use coordinates only to favor nearby places.",
              "The latest request overrides earlier requests. If the user directly names a station, park, or landmark and a matching candidate exists, include it in the selected route.",
              "Avoid places marked visited when fresh alternatives exist; prefer categories both people like.",
              "Return JSON: {message:string,selected:[{id,start_time:'HH:MM',duration_minutes:30-180,expected_cost:number,reasons:[2-3 concise Korean strings]}]}.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              request: input.prompt.slice(0, 800),
              conditions: input.condition,
              plannerState: input.state,
              inferredCouplePreferences: preferenceSummary(input.saved),
              savedHistory: savedHistory(input.saved),
              candidates: candidateCatalog,
            }),
          },
        ],
      }),
    });
    if (!response.ok) return fallback();
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as ModelPayload;
    const rows = validateAndRepairRows(parsed.selected ?? [], input.candidates, input.state);
    const reply = buildReply(rows, input.candidates, input.condition, parsed.message ?? "", "openai", input.state);
    return reply.items.length >= 2 ? reply : fallback();
  } catch {
    return fallback();
  }
}

import type { DiscoverCandidate, Place } from "@/features/places/types/place";
import { distanceMeters } from "@/features/places/geo";
import type { RankedCandidate } from "@/lib/openai/rank";
import type { AIPlannerState, DateActivityId } from "@/features/planning/types/plan";
import {
  courseSize,
  dateSpine,
  extractAreasFromText,
  isAdditiveRequest,
  isExclusiveCrawl,
  isTravelPlan,
  matchesActivity,
  matchesCuisine,
  matchesIndoorType,
  matchesTerm,
  assumedTimeWindow,
  selectedAreas,
  uniqueStrings,
  withAreas,
} from "@/features/ai/dateBrief";

export type DateCourseRow = {
  id?: string;
  start_time?: string;
  duration_minutes?: number;
  expected_cost?: number;
  reasons?: string[];
  day_index?: number;
};

export type DatePreviousStop = {
  name: string;
  category: string;
};

export type HarshMealAllow = {
  hoe: boolean;
  meat: boolean;
  bar: boolean;
};

export type DateRankContext = {
  savedPositive: Set<string>;
  savedBoth?: Set<string>;
  recentlyVisited: Set<string>;
  commonTastes: string[];
  activities: DateActivityId[];
  allowHarsh?: HarshMealAllow;
  trip?: boolean;
};

const HARSH_HOE = /회집|횟집|활어회|수산시장/;
const HARSH_MEAT = /막창|대창|닭발|족발|보쌈/;
const HARSH_BAR = /포차|호프|주점|실내포차/;
const HARSH_OTHER = /편의점|마트|슈퍼마켓|PC방|피시방|모텔|여관|병원|의원|약국|부동산|주차장|주유소|사주|타로|점집|신점|운세|철학관|작명/;
const DATE_JUNK = /분식|패스트푸드|패스트\s*푸드|도시락|김밥|컵밥|맥도날드|롯데리아|버거킹|맘스터치|서브웨이|노브랜드버거|\bKFC\b|테마카페|룸카페/;
const TAKEOUT_COFFEE = /메가\s*MGC|메가MGC|메가커피|컴포즈\s*커피|컴포즈커피|\bCompose\s*Coffee\b|빽다방|Paik'?s\s*Coffee|더\s*벤티|더벤티|The\s*Venti/i;
const STRONG_DATE = /베이커리|브런치|파스타|이탈리|양식|한식|일식|중식|레스토랑|다이닝|와인|디저트|티룸|갤러리|전시|공원|루프탑|북카페|한옥|전망|미술관|박물관|수목원|계곡|호수|시장|관광|고깃집/;
const ACTIVITY_SLOT_ORDER: Array<DateActivityId | "other"> = ["meal", "walk", "exhibit", "indoor", "nightview", "other", "cafe"];

export function venueBlob(candidate: DiscoverCandidate) {
  return `${candidate.name} ${candidate.categoryLabel} ${candidate.detailedCategory ?? ""}`;
}

export function allowsHarshDateMeal(message: string, cuisine: AIPlannerState["cuisine"] = null): HarshMealAllow {
  return {
    hoe: /회집|횟집|회\s*먹|활어|사시미|모둠회/.test(message),
    meat: /고깃집|삼겹|곱창|갈비|한우|고기\s*먹/.test(message) || cuisine === "한식",
    bar: /포차|호프|술집|맥주|소주|막걸리|이자카야/.test(message),
  };
}

export function isOffDateVenue(candidate: DiscoverCandidate, ctx?: { allowHarsh?: HarshMealAllow; allowKaraoke?: boolean }) {
  const blob = venueBlob(candidate);
  if (HARSH_OTHER.test(blob) || DATE_JUNK.test(blob) || TAKEOUT_COFFEE.test(blob)) return true;
  if (!ctx?.allowKaraoke && /노래방|코인노래/.test(blob)) return true;
  const allow = ctx?.allowHarsh ?? { hoe: false, meat: false, bar: false };
  if (!allow.hoe && HARSH_HOE.test(blob)) return true;
  if (!allow.meat && HARSH_MEAT.test(blob)) return true;
  if (!allow.bar && HARSH_BAR.test(blob)) return true;
  return false;
}

export function dateVenueBonus(candidate: DiscoverCandidate) {
  const blob = venueBlob(candidate);
  let bonus = 0;
  if (STRONG_DATE.test(blob)) bonus += 8;
  if (candidate.phone) bonus += 2;
  if (candidate.image) bonus += 6;
  return bonus;
}

export function candidateActivitySlot(candidate: DiscoverCandidate): DateActivityId | "other" {
  return ACTIVITY_SLOT_ORDER.find(slot => slot !== "other" && matchesActivity(candidate, slot)) ?? "other";
}

function slotPriority(slot: DateActivityId | "other") {
  const index = ACTIVITY_SLOT_ORDER.indexOf(slot);
  return index === -1 ? ACTIVITY_SLOT_ORDER.length : index;
}

export function dateCandidateKey(item: { externalSource?: string; externalPlaceId: string }) {
  return `${item.externalSource === "tourapi" ? "tourapi" : "kakao"}:${item.externalPlaceId}`;
}

export function semanticPlaceKey(candidate: DiscoverCandidate) {
  const compact = candidate.name.replace(/\s/g, "");
  if ((candidate.kakaoCategoryGroupCode === "SW8" || candidate.categoryLabel.includes("지하철")) && compact.includes("역")) {
    return `station:${compact.replace(/\d+호선$|경의중앙선$|수인분당선$|경춘선$/g, "")}`;
  }
  if (compact.includes("한강공원")) return `park:${compact.match(/한강공원(?:옥수|금호)?/)?.[0] ?? "한강공원"}`;
  return dateCandidateKey(candidate);
}

export function preferredSavedNames(saved: Place[]) {
  return new Set(saved.filter(place => (
    ["want", "must_visit", "revisit"].includes(place.userStatus)
    || ["want", "must_visit", "revisit"].includes(place.partnerStatus)
  )).map(place => place.name));
}

export function bothWantNames(saved: Place[]) {
  return new Set(saved.filter(place => (
    ["want", "must_visit", "revisit"].includes(place.userStatus)
    && ["want", "must_visit", "revisit"].includes(place.partnerStatus)
  )).map(place => place.name));
}

export function recentPlaceNames(entries: Array<{ items?: Array<{ placeName?: string }> }>, limit = 8) {
  return new Set(
    entries.slice(0, limit).flatMap(entry => (entry.items ?? []).map(item => String(item.placeName ?? "").trim())).filter(Boolean),
  );
}

export function isSwapRequest(message: string) {
  return /바꿔|교체|변경|다른\s*(?:카페|식당|맛집|곳)|만\s*바꿔|대신/.test(message);
}

export function isRedoRequest(message: string) {
  return /다시\s*짜|처음부터|새로|에서만|그쪽으로만|전부\s*바꿔|리셋/.test(message);
}

export function isSoftReroll(message: string) {
  return /조금\s*다르게|다른\s*(?:코스|일정)|다시\s*추천|코스\s*(?:바꿔|변경)/.test(message);
}

const PLACE_ALIASES = [
  ["남산", "서울타워", "n서울", "엔서울"],
  ["청계", "청계천"],
  ["익선", "익선동"],
];

export function placeMentionedInText(message: string, name: string) {
  const msg = message.replace(/\s/g, "").toLowerCase();
  const compact = name.replace(/\s/g, "").toLowerCase();
  if (compact.length >= 2 && msg.includes(compact)) return true;
  if (compact.length >= 5 && msg.includes(compact.slice(0, 4))) return true;
  return PLACE_ALIASES.some(group => (
    group.some(token => msg.includes(token.toLowerCase()))
    && group.some(token => compact.includes(token.toLowerCase()))
  ));
}

export function categoryLeaf(detailed: string | undefined, fallback = "") {
  const parts = (detailed ?? "").split(">").map(part => part.trim()).filter(Boolean);
  const generic = new Set(["음식점", "관광명소", "문화시설", "여행", "서비스,산업", "맛집"]);
  const useful = parts.filter(part => !generic.has(part) && part !== "맛집");
  if (useful.length >= 2) return useful.slice(-2).join(" · ");
  const leaf = useful[0] || parts.filter(part => part !== "맛집").at(-1) || fallback;
  return leaf === "맛집" ? "음식점" : leaf;
}

export function dateCategoryLabel(candidate: DiscoverCandidate) {
  const leaf = categoryLeaf(candidate.detailedCategory, "");
  if (leaf) return leaf;
  if (candidate.category === "restaurant" || candidate.categoryLabel === "맛집") return "음식점";
  return candidate.categoryLabel;
}

export function claimContradictsPlace(reason: string, candidate: DiscoverCandidate) {
  const details = `${candidate.name} ${candidate.categoryLabel} ${candidate.detailedCategory ?? ""}`;
  if (/한식/.test(reason) && !matchesCuisine(candidate, "한식")) return true;
  if (/일식/.test(reason) && !matchesCuisine(candidate, "일식")) return true;
  if (/중식/.test(reason) && !matchesCuisine(candidate, "중식")) return true;
  if (/(?:양식|피자|파스타)/.test(reason) && !/(?:양식|피자|파스타|브런치|스테이크)/.test(details)) return true;
  if (/(?:커피|카페)/.test(reason) && !matchesActivity(candidate, "cafe")) return true;
  if (/(?:야경|전망대)/.test(reason) && !matchesActivity(candidate, "nightview")) return true;
  if (/(?:산책|공원)/.test(reason) && !matchesActivity(candidate, "walk")) return true;
  if (/(?:전시|갤러리|미술관)/.test(reason) && !matchesActivity(candidate, "exhibit")) return true;
  return false;
}

export function groundedStopReason(input: {
  candidate: DiscoverCandidate;
  previous?: DiscoverCandidate | null;
  meters?: number | null;
  saved?: boolean;
  bothWant?: boolean;
}) {
  if (input.candidate.category === "festival" && input.candidate.openingHours) {
    return `진행 중 · ${input.candidate.openingHours}`;
  }
  const leaf = dateCategoryLabel(input.candidate);
  if (input.bothWant) return leaf ? `둘이 가고 싶다고 한 곳 · ${leaf}` : "둘이 가고 싶다고 한 곳";
  if (input.saved) return leaf ? `저장한 곳 · ${leaf}` : "저장한 곳";
  if (leaf) return leaf;
  if (input.previous && input.meters != null) {
    if (input.meters < 80) return `${input.previous.name} 바로 옆`;
    if (input.meters < 1000) return `앞에서 ${input.meters}m`;
    return `앞에서 ${(input.meters / 1000).toFixed(1)}km`;
  }
  return "";
}

function slotCapPerDay(state: AIPlannerState, slot: DateActivityId): number {
  if (slot === "meal") return 2;
  if (slot === "cafe") return 2;
  if (slot === "exhibit") return isExclusiveCrawl(state) ? 3 : 2;
  return 2;
}

function festivalCapPerDay() {
  return 1;
}

export function stopMatchesActivity(stop: DatePreviousStop, activity: DateActivityId) {
  const blob = `${stop.name} ${stop.category}`;
  if (activity === "cafe") return /카페|디저트|커피/.test(blob);
  if (activity === "meal") return /맛집|식당|음식|한식|일식|중식|양식/.test(blob);
  if (activity === "walk") return /공원|산책|한강|숲|청계천|자연/.test(blob);
  if (activity === "exhibit") return /전시|미술관|박물관|갤러리|문화/.test(blob);
  if (activity === "indoor") return /볼링|방탈출|보드|오락|만화|VR|노래방/.test(blob);
  return /야경|전망|루프탑/.test(blob);
}

export function applyCourseDelta(input: {
  message: string;
  state: AIPlannerState;
  previousStops: DatePreviousStop[];
}): AIPlannerState {
  const { message, previousStops } = input;
  if (!previousStops.length) return input.state;
  const names = previousStops.map(stop => stop.name);
  const instead = message.match(/(.+?)\s*대신\s+(.+)/);
  if (instead) {
    const from = names.find(name => instead[1].includes(name) || name.includes(instead[1].trim()));
    const to = instead[2].replace(/으로|로|줘|요/g, "").trim();
    if (from) {
      return {
        ...input.state,
        intent: "modify",
        pinOrder: names,
        preserveExistingPlaces: true,
        excludedPlaces: uniqueStrings([...input.state.excludedPlaces, from], 8),
        requiredPlaces: uniqueStrings([...names.filter(name => name !== from), to, ...input.state.requiredPlaces], 8),
      };
    }
  }

  if (isSwapRequest(message)) {
    const targets = (["cafe", "meal", "walk", "exhibit", "indoor", "nightview"] as const)
      .filter(activity => stopMatchesActivity({ name: message, category: message }, activity) || (
        activity === "cafe" && /카페/.test(message)
      ) || (
        activity === "meal" && /식당|맛집|식사/.test(message)
      ));
    const toExclude = previousStops
      .filter(stop => (targets.length ? targets.some(activity => stopMatchesActivity(stop, activity)) : false))
      .map(stop => stop.name);
    const exclude = toExclude.length ? toExclude : names.slice(0, 1);
    const keep = names.filter(name => !exclude.includes(name));
    return {
      ...input.state,
      intent: "modify",
      pinOrder: names,
      preserveExistingPlaces: true,
      excludedPlaces: uniqueStrings([...input.state.excludedPlaces, ...exclude], 8),
      requiredPlaces: uniqueStrings([...keep, ...input.state.requiredPlaces.filter(place => !exclude.includes(place))], 8),
    };
  }

  if (/빼|제외|삭제|빼줘|말고/.test(message) && names.length) {
    const mentioned = names.filter(name => placeMentionedInText(message, name));
    const addedAreas = extractAreasFromText(message);
    const redo = isRedoRequest(message);
    const exclude = mentioned.length ? mentioned : (redo || addedAreas.length ? [] : names.slice(-1));
    const kept = names.filter(name => !exclude.includes(name));
    const nextAreas = uniqueStrings([...selectedAreas(input.state), ...addedAreas], 3);
    const nextState = addedAreas.length ? withAreas(input.state, nextAreas) : input.state;
    return {
      ...nextState,
      intent: redo ? "create" : "remove",
      pinOrder: redo ? [] : names,
      preserveExistingPlaces: !redo,
      excludedPlaces: uniqueStrings([...input.state.excludedPlaces, ...exclude], 8),
      requiredPlaces: redo ? [] : uniqueStrings(kept, 8),
    };
  }

  if (isRedoRequest(message) || isSoftReroll(message)) {
    const addedAreas = extractAreasFromText(message);
    const nextAreas = uniqueStrings([...selectedAreas(input.state), ...addedAreas], 3);
    const nextState = addedAreas.length ? withAreas(input.state, nextAreas) : input.state;
    return {
      ...nextState,
      intent: "create",
      pinOrder: [],
      preserveExistingPlaces: false,
      addStop: false,
      requiredPlaces: [],
    };
  }

  const keepCourse = input.state.addStop
    || isAdditiveRequest(message)
    || /여유|천천히|알차게|짧게/.test(message);
  if (keepCourse && input.state.intent !== "reset") {
    return {
      ...input.state,
      pinOrder: names,
      preserveExistingPlaces: true,
      requiredPlaces: uniqueStrings([...names.filter(name => !input.state.excludedPlaces.includes(name)), ...input.state.requiredPlaces], 8),
    };
  }
  return input.state;
}

export function defaultDuration(candidate: DiscoverCandidate, pace: AIPlannerState["pace"] = "balanced") {
  let minutes = 70;
  if (candidate.category === "festival") minutes = 90;
  else if (candidate.category === "cafe") minutes = 60;
  else if (candidate.category === "restaurant") minutes = 80;
  else if (candidate.category === "nature") minutes = 50;
  else if (matchesActivity(candidate, "indoor")) minutes = 90;
  else if (matchesActivity(candidate, "exhibit")) minutes = 70;
  if (pace === "relaxed") minutes = Math.round(minutes * 1.2);
  if (pace === "active") minutes = Math.round(minutes * 0.85);
  return Math.max(40, Math.min(150, minutes));
}

export function travelGapMinutes(from: [number, number] | null | undefined, to: [number, number] | null | undefined) {
  if (!from || !to) return 0;
  const hop = distanceMeters(from, to);
  if (hop < 120) return 0;
  return Math.min(25, Math.max(8, Math.round(hop / 80)));
}

function clockMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function formatClock(total: number) {
  const wrapped = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

export function mealAnchorMinutes(state: AIPlannerState, dayStart: string) {
  if (state.timeWindow === "night") return [19 * 60];
  if (state.timeWindow === "evening") return [18 * 60];
  const startHour = Number(dayStart.slice(0, 2));
  if (state.stayKind === "overnight" || state.stayKind === "daytrip" || startHour <= 11) return [12 * 60, 18 * 60];
  return [18 * 60];
}

export function assignStartTimes(
  rows: DateCourseRow[],
  candidates: DiscoverCandidate[],
  state: AIPlannerState,
  dayStart = assumedTimeWindow(state).startTime,
): DateCourseRow[] {
  const byId = new Map(candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  const anchors = mealAnchorMinutes(state, dayStart);
  let cursor = clockMinutes(dayStart);
  let meals = 0;
  let lastDay = 0;
  return rows.map((row, index) => {
    const day = Number(row.day_index ?? 0);
    if (index === 0 || day !== lastDay) {
      cursor = clockMinutes(dayStart);
      meals = 0;
    }
    lastDay = day;
    const candidate = byId.get(String(row.id ?? ""));
    if (candidate && matchesActivity(candidate, "meal")) {
      cursor = Math.max(cursor, anchors[Math.min(meals, anchors.length - 1)]);
      meals += 1;
    }
    const duration = row.duration_minutes ?? (candidate ? defaultDuration(candidate, state.pace) : 70);
    const previous = index > 0 && Number(rows[index - 1]?.day_index ?? 0) === day
      ? byId.get(String(rows[index - 1]?.id ?? ""))
      : undefined;
    const start = formatClock(cursor);
    cursor += duration + travelGapMinutes(previous?.coordinates, candidate?.coordinates);
    return { ...row, start_time: start, duration_minutes: duration };
  });
}

export function preferredHopScore(meters: number, trip = false) {
  if (trip) {
    if (meters < 80) return 0;
    if (meters < 1500) return 8;
    if (meters < 4000) return 12;
    if (meters < 8000) return 6;
    if (meters < 15000) return 2;
    return 0;
  }
  if (meters < 80) return 0;
  if (meters < 250) return 5;
  if (meters < 1000) return 12;
  if (meters < 1800) return 8;
  if (meters < 2800) return 3;
  return 0;
}

export function proximityToAreaScore(meters: number) {
  if (meters <= 80) return 2;
  if (meters <= 400) return 7;
  if (meters <= 1500) return 10;
  if (meters <= 2500) return 6;
  if (meters <= 4000) return 2;
  return 0;
}

export function diversifyDateCatalog(candidates: DiscoverCandidate[], limit = 30) {
  const bands: DiscoverCandidate[][] = [[], [], []];
  for (const candidate of candidates) {
    const meters = candidate.distanceMeters ?? 0;
    const band = meters < 350 ? 0 : meters < 1500 ? 1 : 2;
    bands[band].push(candidate);
  }
  const order = [bands[1], bands[0], bands[2]];
  const picked: DiscoverCandidate[] = [];
  const used = new Set<string>();
  const slotCount = new Map<string, number>();
  const takeFrom = (bucket: DiscoverCandidate[]) => {
    let bestIndex = -1;
    let bestCount = Infinity;
    let bestSlotRank = Infinity;
    for (let index = 0; index < bucket.length; index += 1) {
      const next = bucket[index];
      if (used.has(dateCandidateKey(next))) continue;
      const slot = candidateActivitySlot(next);
      const count = slotCount.get(slot) ?? 0;
      const rank = slotPriority(slot);
      if (count < bestCount || (count === bestCount && rank < bestSlotRank)) {
        bestCount = count;
        bestSlotRank = rank;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) return false;
    const next = bucket.splice(bestIndex, 1)[0];
    used.add(dateCandidateKey(next));
    const slot = candidateActivitySlot(next);
    slotCount.set(slot, (slotCount.get(slot) ?? 0) + 1);
    picked.push(next);
    return true;
  };
  while (picked.length < limit) {
    let added = false;
    for (const bucket of order) {
      if (picked.length >= limit) break;
      if (takeFrom(bucket)) added = true;
    }
    if (!added) break;
  }
  return picked;
}

export function scoreDateCandidate(candidate: DiscoverCandidate, ctx: DateRankContext) {
  let score = 0;
  if (candidate.category === "festival") score += candidate.image ? 24 : 16;
  if (ctx.savedPositive.has(candidate.name)) score += 40;
  if (ctx.recentlyVisited.has(candidate.name)) score -= 35;
  if (isOffDateVenue(candidate, { allowHarsh: ctx.allowHarsh, allowKaraoke: ctx.activities.includes("indoor") })) score -= 48;
  else score += dateVenueBonus(candidate);
  const details = venueBlob(candidate);
  for (const taste of ctx.commonTastes) {
    if (taste && details.includes(taste)) score += 12;
  }
  if (candidate.distanceMeters != null) score += proximityToAreaScore(candidate.distanceMeters);
  if (ctx.trip && (candidate.category === "tourist" || candidate.category === "nature" || candidate.category === "festival")) score += 12;
  if (ctx.savedBoth?.has(candidate.name)) score += 12;
  if (ctx.activities.length) {
    if (ctx.activities.some(activity => matchesActivity(candidate, activity))) score += 8;
    else score -= 12;
  }
  return score;
}

export function rankDateCandidates(candidates: DiscoverCandidate[], ctx: DateRankContext) {
  return [...candidates].sort((a, b) => scoreDateCandidate(b, ctx) - scoreDateCandidate(a, ctx) || a.name.localeCompare(b.name));
}

export function toDateRanking(candidates: DiscoverCandidate[], ctx: DateRankContext): RankedCandidate[] {
  return rankDateCandidates(candidates, ctx).map(candidate => {
    const score = scoreDateCandidate(candidate, ctx);
    const fit = Math.max(0, Math.min(100, Math.round(50 + score)));
    const reason = ctx.savedPositive.has(candidate.name)
      ? "둘이 저장해 둔 곳이라 우선했어요."
      : ctx.recentlyVisited.has(candidate.name)
        ? "최근에 다녀온 곳이라 뒤로 미뤘어요."
        : ctx.commonTastes.find(taste => `${candidate.categoryLabel} ${candidate.detailedCategory ?? ""} ${candidate.name}`.includes(taste))
          ? "우리 공통 취향과 맞물려요."
          : "";
    return {
      externalSource: candidate.externalSource,
      externalPlaceId: candidate.externalPlaceId,
      userFit: fit,
      partnerFit: fit,
      reason,
    };
  });
}

export function orderByRoute(selected: DiscoverCandidate[], state: AIPlannerState) {
  if (selected.length <= 1) return selected;
  const remaining = [...selected];
  const trip = isTravelPlan(state);
  const startIndex = state.timeWindow === "night" || state.timeWindow === "evening"
    ? remaining.findIndex(candidate => matchesActivity(candidate, "meal"))
    : remaining.findIndex(candidate => !matchesActivity(candidate, "meal"));
  const ordered: DiscoverCandidate[] = [remaining.splice(Math.max(0, startIndex), 1)[0]];
  while (remaining.length) {
    const previous = ordered.at(-1)!;
    remaining.sort((a, b) => {
      const hopA = distanceMeters(previous.coordinates, a.coordinates);
      const hopB = distanceMeters(previous.coordinates, b.coordinates);
      return preferredHopScore(hopB, trip) - preferredHopScore(hopA, trip) || hopA - hopB;
    });
    ordered.push(remaining.shift()!);
  }
  return ordered;
}

function pickByActivities(
  candidates: DiscoverCandidate[],
  state: AIPlannerState,
  wanted: DateActivityId[],
) {
  const picked: DiscoverCandidate[] = [];
  const used = new Set<string>();
  const size = courseSize(state);
  const take = (candidate: DiscoverCandidate | undefined) => {
    if (!candidate) return;
    const key = semanticPlaceKey(candidate);
    if (used.has(key)) return;
    used.add(key);
    picked.push(candidate);
  };
  const slots: DateActivityId[] = wanted.length ? wanted : [];
  for (const place of state.requiredPlaces) take(candidates.find(candidate => matchesTerm(candidate, place)));
  if (slots.includes("exhibit")) take(candidates.find(candidate => candidate.category === "festival"));
  const rounds = Math.max(1, size.days);
  for (let round = 0; round < rounds; round += 1) {
    for (const activity of slots) {
      if (picked.length >= size.max) break;
      if (activity === "meal") {
        take(candidates.find(candidate => matchesActivity(candidate, "meal") && matchesCuisine(candidate, state.cuisine) && !used.has(semanticPlaceKey(candidate))));
      }
      if (activity === "indoor") {
        take(candidates.find(candidate => matchesIndoorType(candidate, state.indoorPlay) && !used.has(semanticPlaceKey(candidate))));
      }
      take(candidates.find(candidate => matchesActivity(candidate, activity) && !used.has(semanticPlaceKey(candidate))));
    }
  }
  for (const candidate of candidates) {
    if (picked.length >= size.max) break;
    const slot = candidateActivitySlot(candidate);
    const usedCount = picked.filter(item => candidateActivitySlot(item) === slot).length;
    if (isExclusiveCrawl(state) && slots.length) {
      if (slot === "cafe" && !slots.includes("cafe")) continue;
      if (slot !== "other" && !slots.includes(slot)) continue;
    }
    if (slot !== "other" && usedCount >= slotCapPerDay(state, slot)) continue;
    take(candidate);
  }
  return picked;
}

export function pickCoverage(candidates: DiscoverCandidate[], state: AIPlannerState, savedNames = new Set<string>()) {
  const ranked = [...candidates].sort((a, b) => Number(savedNames.has(b.name)) - Number(savedNames.has(a.name)));
  return pickByActivities(ranked, state, dateSpine(state));
}

export function courseOrderMessage(stops: Array<{ name: string }>, region: string) {
  const names = stops.map(stop => stop.name.trim()).filter(Boolean);
  if (names.length < 2) return `${region} ${names.length}곳`;
  if (names.length === 2) return `${region}에서 ${names[0]} 다음에 ${names[1]} 순으로 이어가요.`;
  return `${region}에서 ${names[0]} 다음에 ${names[1]}, 이어서 ${names[2]} 순으로 이어가요.`;
}

export function pickCourseMessage(modelMessage: string, stops: Array<{ name: string }>, region: string) {
  const talk = courseOrderMessage(stops, region);
  const model = modelMessage.trim();
  const first = stops[0]?.name;
  const last = stops.at(-1)?.name;
  if (model.length >= 12 && first && last && model.includes(first) && model.includes(last)) {
    return model.slice(0, 140);
  }
  return talk;
}

export function curatorSlotCatalog(
  candidates: DiscoverCandidate[],
  wanted: DateActivityId[],
  savedNames = new Set<string>(),
  perSlot = 5,
) {
  const picked: DiscoverCandidate[] = [];
  const used = new Set<string>();
  const take = (candidate: DiscoverCandidate) => {
    const key = dateCandidateKey(candidate);
    if (used.has(key)) return false;
    used.add(key);
    picked.push(candidate);
    return true;
  };
  for (const candidate of candidates) {
    if (savedNames.has(candidate.name)) take(candidate);
  }
  const slots = wanted.length ? wanted : [...new Set(
    candidates.map(candidate => candidateActivitySlot(candidate)).filter((slot): slot is DateActivityId => slot !== "other"),
  )];
  for (const slot of slots) {
    let count = 0;
    for (const candidate of candidates) {
      if (count >= perSlot) break;
      if (!matchesActivity(candidate, slot)) continue;
      if (used.has(dateCandidateKey(candidate))) {
        count += 1;
        continue;
      }
      if (take(candidate)) count += 1;
    }
  }
  return picked;
}

export function heuristicRows(
  candidates: DiscoverCandidate[],
  startTime: string,
  state: AIPlannerState,
  saved: Place[] = [],
): DateCourseRow[] {
  const coverage = pickCoverage(candidates, state, preferredSavedNames(saved));
  if (coverage.length < 2) {
    const extra = candidates.find(candidate => !coverage.some(item => semanticPlaceKey(item) === semanticPlaceKey(candidate)));
    if (extra) coverage.push(extra);
  }
  const selected = orderByRoute(coverage, state).slice(0, courseSize(state).max);
  const days = courseSize(state).days;
  const perDay = Math.max(2, Math.ceil(selected.length / days));
  const rows = selected.map((candidate, index) => {
    const dayIndex = Math.min(days - 1, Math.floor(index / perDay));
    return {
      id: dateCandidateKey(candidate),
      duration_minutes: defaultDuration(candidate, state.pace),
      expected_cost: 0,
      day_index: dayIndex,
      reasons: [
        preferredSavedNames(saved).has(candidate.name) ? "저장한 곳" : dateCategoryLabel(candidate),
      ].filter(Boolean),
    };
  });
  return assignStartTimes(rows, candidates, state, startTime);
}

function spineFillCandidate(
  candidates: DiscoverCandidate[],
  next: DateCourseRow[],
  state: AIPlannerState,
  slot: DateActivityId,
  candidateOf: (row: DateCourseRow) => DiscoverCandidate | undefined,
  allowHarsh: HarshMealAllow,
) {
  const previous = candidateOf(next.at(-1) ?? { id: "" });
  const size = courseSize(state);
  return [...candidates]
    .sort((a, b) => {
      if (!previous) return 0;
      const hopA = distanceMeters(previous.coordinates, a.coordinates);
      const hopB = distanceMeters(previous.coordinates, b.coordinates);
      return preferredHopScore(hopB, isTravelPlan(state)) - preferredHopScore(hopA, isTravelPlan(state)) || hopA - hopB;
    })
    .find(candidate => {
      if (!matchesActivity(candidate, slot)) return false;
      if (next.some(row => row.id === dateCandidateKey(candidate))) return false;
      if (state.excludedPlaces.some(term => matchesTerm(candidate, term))) return false;
      if (isOffDateVenue(candidate, { allowHarsh, allowKaraoke: state.activities.includes("indoor") })) return false;
      const day = Math.min(size.days - 1, Math.floor(next.length / Math.max(2, Math.ceil(size.min / size.days))));
      if (candidate.category === "festival") {
        const count = next.filter(row => {
          const current = candidateOf(row);
          return current && Number(row.day_index ?? 0) === day && current.category === "festival";
        }).length;
        if (count >= festivalCapPerDay()) return false;
      }
      const usedSlot = candidateActivitySlot(candidate);
      if (usedSlot !== "other") {
        const count = next.filter(row => {
          const current = candidateOf(row);
          return current && Number(row.day_index ?? 0) === day && candidateActivitySlot(current) === usedSlot;
        }).length;
        if (count >= slotCapPerDay(state, usedSlot)) return false;
      }
      return true;
    });
}

function ensureDateSpine(
  next: DateCourseRow[],
  candidates: DiscoverCandidate[],
  state: AIPlannerState,
  candidateOf: (row: DateCourseRow) => DiscoverCandidate | undefined,
  allowHarsh: HarshMealAllow,
) {
  const size = courseSize(state);
  for (const slot of dateSpine(state)) {
    if (next.some(row => {
      const candidate = candidateOf(row);
      return Boolean(candidate && matchesActivity(candidate, slot));
    })) continue;
    const extra = spineFillCandidate(candidates, next, state, slot, candidateOf, allowHarsh);
    if (!extra) continue;
    const row: DateCourseRow = {
      id: dateCandidateKey(extra),
      duration_minutes: defaultDuration(extra, state.pace),
      day_index: Math.min(size.days - 1, Math.floor(next.length / Math.max(2, Math.ceil(size.min / size.days)))),
      reasons: ["동선에 맞춰 한 곳을 더 이었어요."],
    };
    if (next.length < size.max) {
      next.push(row);
      continue;
    }
    const counts = new Map<string, number>();
    for (const item of next) {
      const candidate = candidateOf(item);
      if (!candidate) continue;
      const used = candidateActivitySlot(candidate);
      counts.set(used, (counts.get(used) ?? 0) + 1);
    }
    let replaceAt = -1;
    for (let index = next.length - 1; index >= 0; index -= 1) {
      const candidate = candidateOf(next[index]);
      if (!candidate) continue;
      if (state.requiredPlaces.some(place => matchesTerm(candidate, place))) continue;
      const used = candidateActivitySlot(candidate);
      if ((counts.get(used) ?? 0) > 1) {
        replaceAt = index;
        break;
      }
    }
    if (replaceAt >= 0) next[replaceAt] = row;
  }
  return next.slice(0, size.max);
}

export function validateModelRows(
  rows: DateCourseRow[],
  candidates: DiscoverCandidate[],
  state: AIPlannerState,
): DateCourseRow[] {
  const byId = new Map(candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  const seen = new Set<string>();
  const selected: DateCourseRow[] = [];

  const candidateOf = (row: DateCourseRow) => byId.get(String(row.id ?? ""));
  const allowHarsh = allowsHarshDateMeal(state.conversationNotes.join(" "), state.cuisine);
  const wanted = dateSpine(state);
  const keep = (row: DateCourseRow, at?: number) => {
    const candidate = candidateOf(row);
    if (!candidate) return;
    const requiredPlace = state.requiredPlaces.some(place => matchesTerm(candidate, place));
    if (!requiredPlace && isOffDateVenue(candidate, { allowHarsh, allowKaraoke: state.activities.includes("indoor") })) return;
    const key = semanticPlaceKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    const next = { ...row, id: dateCandidateKey(candidate) };
    if (at == null || at >= selected.length) selected.push(next);
    else selected.splice(at, 0, next);
  };

  for (const row of rows) {
    const candidate = candidateOf(row);
    if (!candidate || state.excludedPlaces.some(term => matchesTerm(candidate, term))) continue;
    const requiredPlace = state.requiredPlaces.some(place => matchesTerm(candidate, place));
    if (!requiredPlace && isOffDateVenue(candidate, { allowHarsh, allowKaraoke: state.activities.includes("indoor") })) continue;
    if (isExclusiveCrawl(state) && wanted.length && !requiredPlace && !wanted.some(activity => matchesActivity(candidate, activity))) continue;
    keep(row);
  }

  if (wanted.includes("meal") && state.cuisine && state.cuisine !== "any") {
    const mealIndex = selected.findIndex(row => {
      const candidate = candidateOf(row);
      return Boolean(candidate && matchesActivity(candidate, "meal"));
    });
    const meal = mealIndex >= 0 ? candidateOf(selected[mealIndex]) : undefined;
    if (meal && !matchesCuisine(meal, state.cuisine)) {
      const match = candidates.find(candidate => matchesActivity(candidate, "meal") && matchesCuisine(candidate, state.cuisine) && !seen.has(semanticPlaceKey(candidate)));
      if (match) {
        seen.delete(semanticPlaceKey(meal));
        seen.add(semanticPlaceKey(match));
        selected[mealIndex] = { ...selected[mealIndex], id: dateCandidateKey(match) };
      }
    }
  }

  const present = () => selected.map(candidateOf).filter((item): item is DiscoverCandidate => Boolean(item));
  for (const place of state.requiredPlaces) {
    if (present().some(candidate => matchesTerm(candidate, place))) continue;
    const found = candidates.find(candidate => matchesTerm(candidate, place));
    if (found) keep({ id: dateCandidateKey(found), duration_minutes: defaultDuration(found, state.pace), reasons: ["꼭 들르고 싶다고 한 장소를 코스에 넣었어요."] }, 0);
  }

  const size = courseSize(state);
  const slotCountByDay = new Map<string, number>();
  const festivalsByDay = new Map<number, number>();
  const bump = (key: string) => {
    const count = (slotCountByDay.get(key) ?? 0) + 1;
    slotCountByDay.set(key, count);
    return count;
  };
  const limited = selected.filter(row => {
    const candidate = candidateOf(row);
    if (!candidate) return false;
    const day = Number(row.day_index ?? 0);
    const requiredPlace = state.requiredPlaces.some(place => matchesTerm(candidate, place));
    if (requiredPlace) return true;
    if (candidate.category === "festival") {
      const count = (festivalsByDay.get(day) ?? 0) + 1;
      festivalsByDay.set(day, count);
      if (count > festivalCapPerDay()) return false;
    }
    const slot = candidateActivitySlot(candidate);
    if (slot === "other") return true;
    return bump(`${day}:${slot}`) <= slotCapPerDay(state, slot);
  });
  const next = limited.slice(0, size.max);
  while (next.length < size.min) {
    const fillPriority = wanted.filter(activity => !next.some(row => {
        const candidate = candidateOf(row);
        return candidate && matchesActivity(candidate, activity);
      }));
    const previous = candidateOf(next.at(-1) ?? { id: "" });
    const extra = [...candidates]
      .sort((a, b) => {
        const rank = (candidate: DiscoverCandidate) => {
          const missing = fillPriority.findIndex(activity => matchesActivity(candidate, activity));
          return missing === -1 ? fillPriority.length + 1 : missing;
        };
        const byNeed = rank(a) - rank(b);
        if (byNeed) return byNeed;
        if (!previous) return 0;
        const hopA = distanceMeters(previous.coordinates, a.coordinates);
        const hopB = distanceMeters(previous.coordinates, b.coordinates);
        return preferredHopScore(hopB, isTravelPlan(state)) - preferredHopScore(hopA, isTravelPlan(state)) || hopA - hopB;
      })
      .find(candidate => {
        if (next.some(row => row.id === dateCandidateKey(candidate))) return false;
        if (state.excludedPlaces.some(term => matchesTerm(candidate, term))) return false;
        if (isOffDateVenue(candidate, { allowHarsh, allowKaraoke: state.activities.includes("indoor") })) return false;
        if (isExclusiveCrawl(state) && wanted.length && !wanted.some(activity => matchesActivity(candidate, activity))) return false;
        const day = Math.min(size.days - 1, Math.floor(next.length / Math.max(2, Math.ceil(size.min / size.days))));
        if (candidate.category === "festival") {
          const count = next.filter(row => {
            const current = candidateOf(row);
            return current && Number(row.day_index ?? 0) === day && current.category === "festival";
          }).length;
          if (count >= festivalCapPerDay()) return false;
        }
        const slot = candidateActivitySlot(candidate);
        if (slot !== "other") {
          const count = next.filter(row => {
            const current = candidateOf(row);
            return current && Number(row.day_index ?? 0) === day && candidateActivitySlot(current) === slot;
          }).length;
          if (count >= slotCapPerDay(state, slot)) return false;
        }
        return true;
      });
    if (!extra) break;
    const dayIndex = Math.min(size.days - 1, Math.floor(next.length / Math.max(2, Math.ceil(size.min / size.days))));
    next.push({
      id: dateCandidateKey(extra),
      duration_minutes: defaultDuration(extra, state.pace),
      day_index: dayIndex,
      reasons: ["하루 길이에 맞춰 걸어갈 곳을 하나 더 이었어요."],
    });
  }
  const filled = ensureDateSpine(next, candidates, state, candidateOf, allowHarsh);
  const shaped = spreadConsecutiveStops(capLongHops(filled, candidates, state.requiredPlaces, isTravelPlan(state) ? 8000 : 1400), candidates, state.requiredPlaces);
  return assignStartTimes(honorPinOrder(shaped, candidates, state).slice(0, size.max), candidates, state);
}

export function honorPinOrder(
  rows: DateCourseRow[],
  candidates: DiscoverCandidate[],
  state: AIPlannerState,
): DateCourseRow[] {
  if (!state.preserveExistingPlaces || state.pinOrder.length < 2) return rows;
  const byId = new Map(candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  const used = new Set<string>();
  const take = (candidate: DiscoverCandidate | undefined) => {
    if (!candidate) return null;
    const id = dateCandidateKey(candidate);
    if (used.has(id)) return null;
    used.add(id);
    const existing = rows.find(row => String(row.id ?? "") === id);
    return existing ?? {
      id,
      duration_minutes: defaultDuration(candidate, state.pace),
      day_index: 0,
      reasons: [],
    };
  };
  const next: DateCourseRow[] = [];
  for (const name of state.pinOrder) {
    const excluded = state.excludedPlaces.some(term => name.includes(term) || term.includes(name));
    if (!excluded) {
      const kept = take(candidates.find(candidate => matchesTerm(candidate, name)));
      if (kept) next.push(kept);
      continue;
    }
    const original = candidates.find(candidate => matchesTerm(candidate, name));
    const activity = original
      ? (["cafe", "meal", "walk", "exhibit", "indoor", "nightview"] as const).find(item => matchesActivity(original, item))
      : undefined;
    const replacement = rows
      .map(row => byId.get(String(row.id ?? "")))
      .find(candidate => (
        candidate
        && !used.has(dateCandidateKey(candidate))
        && (!activity || matchesActivity(candidate, activity) || candidate.category === "festival")
      ));
    const row = take(replacement);
    if (row) next.push(row);
  }
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id || used.has(id)) continue;
    const extra = take(byId.get(id));
    if (extra) next.push({ ...extra, ...row, id: extra.id });
  }
  return next.length >= 2 ? next : rows;
}

export function capLongHops(
  rows: DateCourseRow[],
  candidates: DiscoverCandidate[],
  requiredPlaces: string[] = [],
  maxHop = 1400,
) {
  const byId = new Map(candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  const used = new Set(rows.map(row => String(row.id ?? "")).filter(Boolean));
  const next = rows.map(row => ({ ...row }));
  for (let index = 1; index < next.length; index += 1) {
    const previous = byId.get(String(next[index - 1]?.id ?? ""));
    const current = byId.get(String(next[index]?.id ?? ""));
    if (!previous || !current) continue;
    if (requiredPlaces.some(place => matchesTerm(current, place))) continue;
    const hop = distanceMeters(previous.coordinates, current.coordinates);
    if (hop <= maxHop) continue;
    const currentSlot = candidateActivitySlot(current);
    const replacement = candidates.find(candidate => {
      const key = dateCandidateKey(candidate);
      if (used.has(key)) return false;
      if (candidateActivitySlot(candidate) !== currentSlot) return false;
      const meters = distanceMeters(previous.coordinates, candidate.coordinates);
      return meters >= 180 && meters <= maxHop;
    }) ?? candidates.find(candidate => {
      const key = dateCandidateKey(candidate);
      if (used.has(key)) return false;
      if (candidateActivitySlot(candidate) === "cafe" && currentSlot !== "cafe") return false;
      const meters = distanceMeters(previous.coordinates, candidate.coordinates);
      return meters >= 180 && meters <= maxHop;
    });
    if (!replacement) continue;
    used.delete(dateCandidateKey(current));
    used.add(dateCandidateKey(replacement));
    next[index] = { ...next[index], id: dateCandidateKey(replacement) };
  }
  return next;
}

export function spreadConsecutiveStops(
  rows: DateCourseRow[],
  candidates: DiscoverCandidate[],
  requiredPlaces: string[] = [],
) {
  const byId = new Map(candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  const used = new Set(rows.map(row => String(row.id ?? "")).filter(Boolean));
  const next = rows.map(row => ({ ...row }));
  for (let index = 1; index < next.length; index += 1) {
    const previous = byId.get(String(next[index - 1]?.id ?? ""));
    const current = byId.get(String(next[index]?.id ?? ""));
    if (!previous || !current) continue;
    if (requiredPlaces.some(place => matchesTerm(current, place))) continue;
    const hop = distanceMeters(previous.coordinates, current.coordinates);
    if (hop >= 120) continue;
    const replacement = candidates.find(candidate => {
      const key = dateCandidateKey(candidate);
      if (used.has(key)) return false;
      if (candidate.category !== current.category) return false;
      const meters = distanceMeters(previous.coordinates, candidate.coordinates);
      return meters >= 180 && meters <= 1400;
    });
    if (!replacement) continue;
    used.delete(dateCandidateKey(current));
    used.add(dateCandidateKey(replacement));
    next[index] = { ...next[index], id: dateCandidateKey(replacement) };
  }
  return next;
}

export const COURSE_QUICK_ACTIONS = ["식당변경", "카페변경", "일정추가", "일정제외"] as const;

export type CourseQuickAction = (typeof COURSE_QUICK_ACTIONS)[number];

export function isCourseQuickAction(label: string): label is CourseQuickAction {
  return (COURSE_QUICK_ACTIONS as readonly string[]).includes(label);
}

export function courseQuickReplyMessage(label: string) {
  if (label === "식당변경") return "식당 변경 해줘";
  if (label === "카페변경") return "카페 변경 해줘";
  if (label === "일정추가") return "한 곳 더 추가해줘";
  if (label === "일정제외") return "한 곳 빼줘";
  return null;
}

export function courseSuggestions(_state: AIPlannerState, _stops: Array<{ name: string; category: string }>) {
  return [...COURSE_QUICK_ACTIONS];
}

export function tasteReason(candidate: DiscoverCandidate, ctx: DateRankContext, fallback: string) {
  if (ctx.savedPositive.has(candidate.name)) return "둘이 저장해 둔 곳이라 골랐어요.";
  const taste = ctx.commonTastes.find(label => `${candidate.categoryLabel} ${candidate.detailedCategory ?? ""} ${candidate.name}`.includes(label));
  if (taste) return `${taste} 취향이랑 잘 맞아요.`;
  return fallback;
}

import type { DiscoverCandidate, Place } from "@/features/places/types/place";
import { distanceMeters } from "@/features/places/geo";
import type { RankedCandidate } from "@/lib/openai/rank";
import type { AIPlannerState, DateActivityId } from "@/features/planning/types/plan";
import {
  courseSize,
  extractAreasFromText,
  extractPlacesFromText,
  isAdditiveRequest,
  matchesActivity,
  matchesCuisine,
  matchesIndoorType,
  matchesTerm,
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
  recentlyVisited: Set<string>;
  commonTastes: string[];
  activities: DateActivityId[];
  allowHarsh?: HarshMealAllow;
};

const HARSH_HOE = /회집|횟집|활어회|수산시장/;
const HARSH_MEAT = /고깃집|삼겹살|곱창|막창|대창|닭발|족발|보쌈/;
const HARSH_BAR = /포차|호프|주점|실내포차/;
const HARSH_OTHER = /편의점|마트|슈퍼마켓|PC방|피시방|모텔|여관|병원|의원|약국|부동산|주차장|주유소|사주|타로|점집|신점|운세|철학관|작명/;
const STRONG_DATE = /카페|베이커리|브런치|파스타|이탈리|양식|와인|디저트|티룸|갤러리|전시|공원|루프탑|북카페/;

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
  if (HARSH_OTHER.test(blob)) return true;
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
  if (candidate.category === "cafe" || candidate.kakaoCategoryGroupCode === "CE7") bonus += 8;
  if (STRONG_DATE.test(blob)) bonus += 8;
  if (candidate.phone) bonus += 2;
  if (candidate.image) bonus += 6;
  return bonus;
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
  const generic = new Set(["음식점", "관광명소", "문화시설", "여행", "서비스,산업"]);
  const useful = parts.filter(part => !generic.has(part));
  if (useful.length >= 2) return useful.slice(-2).join(" · ");
  return useful[0] || parts.at(-1) || fallback;
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
}) {
  if (input.candidate.category === "festival" && input.candidate.openingHours) {
    return `진행 중 · ${input.candidate.openingHours}`;
  }
  if (input.saved) return "저장한 곳";
  if (input.previous && input.meters != null) {
    if (input.meters < 80) return `${input.previous.name} 바로 옆`;
    if (input.meters < 1000) return `앞에서 ${input.meters}m`;
    return `앞에서 ${(input.meters / 1000).toFixed(1)}km`;
  }
  return "";
}

function exhibitCap(state: AIPlannerState) {
  if (state.activities.length === 1 && state.activities[0] === "exhibit") return 3;
  if (state.activities.includes("exhibit")) return 2;
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

  if (isRedoRequest(message)) {
    const addedAreas = extractAreasFromText(message);
    const nextAreas = uniqueStrings([...selectedAreas(input.state), ...addedAreas], 3);
    const nextState = addedAreas.length ? withAreas(input.state, nextAreas) : input.state;
    return {
      ...nextState,
      pinOrder: [],
      preserveExistingPlaces: false,
      requiredPlaces: [],
    };
  }

  const keepCourse = isAdditiveRequest(message)
    || extractPlacesFromText(message).length > 0
    || /여유|알차게|천천히|오래|한 곳 빼/.test(message);
  if (input.state.preserveExistingPlaces && keepCourse) {
    return {
      ...input.state,
      pinOrder: names,
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

export function preferredHopScore(meters: number) {
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
  while (picked.length < limit) {
    let added = false;
    for (const bucket of order) {
      if (picked.length >= limit) break;
      while (bucket.length) {
        const next = bucket.shift()!;
        const key = dateCandidateKey(next);
        if (used.has(key)) continue;
        used.add(key);
        picked.push(next);
        added = true;
        break;
      }
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
  if (ctx.activities.length && ctx.activities.some(activity => matchesActivity(candidate, activity))) score += 8;
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
  const startIndex = state.timeWindow === "night"
    ? remaining.findIndex(candidate => matchesActivity(candidate, "meal"))
    : 0;
  const ordered: DiscoverCandidate[] = [remaining.splice(Math.max(0, startIndex), 1)[0]];
  while (remaining.length) {
    const previous = ordered.at(-1)!;
    remaining.sort((a, b) => {
      const hopA = distanceMeters(previous.coordinates, a.coordinates);
      const hopB = distanceMeters(previous.coordinates, b.coordinates);
      return preferredHopScore(hopB) - preferredHopScore(hopA) || hopA - hopB;
    });
    ordered.push(remaining.shift()!);
  }
  return ordered;
}

function pickOpenDay(candidates: DiscoverCandidate[], required: string[], limit: number) {
  const picked: DiscoverCandidate[] = [];
  const used = new Set<string>();
  const usedCategory = new Set<string>();
  const take = (candidate: DiscoverCandidate | undefined) => {
    if (!candidate) return;
    const key = semanticPlaceKey(candidate);
    if (used.has(key)) return;
    used.add(key);
    usedCategory.add(candidate.category);
    picked.push(candidate);
  };
  for (const place of required) take(candidates.find(candidate => matchesTerm(candidate, place)));
  take(candidates.find(candidate => candidate.category === "festival"));
  for (const candidate of candidates) {
    if (picked.length >= limit) break;
    if (usedCategory.has(candidate.category) && picked.length < Math.min(3, limit)) continue;
    take(candidate);
  }
  for (const candidate of candidates) {
    if (picked.length >= limit) break;
    take(candidate);
  }
  return picked;
}

export function pickCoverage(candidates: DiscoverCandidate[], state: AIPlannerState, savedNames = new Set<string>()) {
  const ranked = [...candidates].sort((a, b) => Number(savedNames.has(b.name)) - Number(savedNames.has(a.name)));
  const limit = courseSize(state).max;
  if (!state.activities.length) return pickOpenDay(ranked, state.requiredPlaces, limit);

  const picked: DiscoverCandidate[] = [];
  const used = new Set<string>();
  const take = (candidate: DiscoverCandidate | undefined) => {
    if (!candidate) return;
    const key = semanticPlaceKey(candidate);
    if (used.has(key)) return;
    used.add(key);
    picked.push(candidate);
  };
  for (const place of state.requiredPlaces) take(ranked.find(candidate => matchesTerm(candidate, place)));
  for (const activity of state.activities) {
    if (picked.some(candidate => matchesActivity(candidate, activity))) continue;
    if (activity === "meal") {
      take(ranked.find(candidate => matchesActivity(candidate, "meal") && matchesCuisine(candidate, state.cuisine)));
    }
    if (activity === "exhibit") {
      take(ranked.find(candidate => candidate.category === "festival"));
    }
    if (activity === "indoor") {
      take(ranked.find(candidate => matchesIndoorType(candidate, state.indoorPlay) && !used.has(semanticPlaceKey(candidate))));
    }
    take(ranked.find(candidate => matchesActivity(candidate, activity) && !used.has(semanticPlaceKey(candidate))));
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
  let cursor = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
  return selected.map((candidate, index) => {
    const dayIndex = Math.min(days - 1, Math.floor(index / perDay));
    if (index > 0 && dayIndex !== Math.min(days - 1, Math.floor((index - 1) / perDay))) {
      cursor = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
    }
    const start = `${String(Math.floor(cursor / 60) % 24).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`;
    const duration = defaultDuration(candidate, state.pace);
    const previous = selected[index - 1];
    cursor += duration + travelGapMinutes(previous?.coordinates, candidate.coordinates);
    return {
      id: dateCandidateKey(candidate),
      start_time: start,
      duration_minutes: duration,
      expected_cost: 0,
      day_index: dayIndex,
      reasons: [
        index === 0 ? "하루의 시작으로 두기 좋은 거리예요." : "앞에서 이어지는 동선으로 골랐어요.",
        preferredSavedNames(saved).has(candidate.name) ? "둘이 저장해 둔 곳이라 넣었어요." : "실제 장소 좌표 기준으로 이어 봤어요.",
      ],
    };
  });
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
    if (state.activities.length && matchesActivity(candidate, "meal") && !state.activities.includes("meal") && !requiredPlace) continue;
    if (state.activities.length && matchesActivity(candidate, "indoor") && !state.activities.includes("indoor") && !requiredPlace) continue;
    keep(row);
  }

  if (state.activities.includes("meal") && state.cuisine && state.cuisine !== "any") {
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
  const restaurantsPerDay = size.days > 1 || state.stayKind === "daytrip" ? 2 : 1;
  const restaurantsByDay = new Map<number, number>();
  const exhibitsByDay = new Map<number, number>();
  const festivalsByDay = new Map<number, number>();
  const maxExhibits = exhibitCap(state);
  const mealOnly = state.activities.length === 1 && state.activities[0] === "meal";
  const limited = selected.filter(row => {
    const candidate = candidateOf(row);
    if (!candidate) return false;
    const day = Number(row.day_index ?? 0);
    const requiredPlace = state.requiredPlaces.some(place => matchesTerm(candidate, place));
    if (candidate.category === "festival" && !requiredPlace) {
      const count = (festivalsByDay.get(day) ?? 0) + 1;
      festivalsByDay.set(day, count);
      if (count > 1) return false;
    }
    if (!mealOnly && matchesActivity(candidate, "meal")) {
      const count = (restaurantsByDay.get(day) ?? 0) + 1;
      restaurantsByDay.set(day, count);
      if (count > restaurantsPerDay) return false;
    }
    if (matchesActivity(candidate, "exhibit") && !requiredPlace) {
      const count = (exhibitsByDay.get(day) ?? 0) + 1;
      exhibitsByDay.set(day, count);
      if (count > maxExhibits) return false;
    }
    return true;
  });
  const next = limited.slice(0, size.max);
  while (next.length < size.min) {
    const fillPriority = !state.activities.length
      ? (["cafe", "meal", "walk", "exhibit"] as const).filter(activity => !next.some(row => {
        const candidate = candidateOf(row);
        return candidate && matchesActivity(candidate, activity);
      }))
      : [];
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
        return preferredHopScore(hopB) - preferredHopScore(hopA) || hopA - hopB;
      })
      .find(candidate => {
        if (next.some(row => row.id === dateCandidateKey(candidate))) return false;
        if (state.excludedPlaces.some(term => matchesTerm(candidate, term))) return false;
        if (isOffDateVenue(candidate, { allowHarsh, allowKaraoke: state.activities.includes("indoor") })) return false;
        if (state.activities.length && matchesActivity(candidate, "meal") && !state.activities.includes("meal")) return false;
        if (state.activities.length && matchesActivity(candidate, "indoor") && !state.activities.includes("indoor")) return false;
        if (matchesActivity(candidate, "exhibit")) {
          const day = Math.min(size.days - 1, Math.floor(next.length / Math.max(2, Math.ceil(size.min / size.days))));
          const count = next.filter(row => {
            const current = candidateOf(row);
            return current && Number(row.day_index ?? 0) === day && matchesActivity(current, "exhibit");
          }).length;
          if (count >= maxExhibits) return false;
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
  const shaped = spreadConsecutiveStops(capLongHops(next, candidates, state.requiredPlaces), candidates, state.requiredPlaces);
  return honorPinOrder(shaped, candidates, state);
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
  return next.length >= 2 ? next : rows;
}

export function capLongHops(
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
    if (hop <= 1400) continue;
    const replacement = candidates.find(candidate => {
      const key = dateCandidateKey(candidate);
      if (used.has(key)) return false;
      if (candidate.category !== current.category) return false;
      const meters = distanceMeters(previous.coordinates, candidate.coordinates);
      return meters >= 180 && meters <= 1400;
    }) ?? candidates.find(candidate => {
      const key = dateCandidateKey(candidate);
      if (used.has(key)) return false;
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

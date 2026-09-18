import type { DiscoverCandidate, PlaceCategoryId } from "@/features/places/types/place";
import type { AIChatCard, AIChatStop, PlaceAsk, PlaceAskKind } from "@/features/planning/types/plan";
import { PLACE_KIND_LABEL } from "@/features/ai/chatRoute";
import { extractCuisine, matchesActivity, matchesCuisine, matchesTerm, uniqueStrings } from "@/features/ai/dateBrief";
import {
  dateCandidateKey,
  dateCategoryLabel,
  groundedStopReason,
  isOffDateVenue,
  scoreDateCandidate,
  venueBlob,
  type DateRankContext,
  type HarshMealAllow,
} from "@/features/ai/dateCourse";
import { publicPlaceFactLine } from "@/lib/openai/placeWebFacts";

export const PLACE_PICK_MIN = 3;
export const PLACE_PICK_MAX = 5;
export const PLACE_CATALOG_SIZE = 14;
const WHY_MAX_CHARS = 140;
const INTRO_MAX_CHARS = 260;

export type PlaceSearchPlan = {
  region: string;
  query?: string;
  category?: PlaceCategoryId;
  page: number;
};

export type PlacePick = {
  id: string;
  why: string;
  rating?: number;
  ratingCount?: number;
  food?: string;
  sourceUrl?: string;
};

const BAR_ASK = /술집|와인|칵테일|이자카야|맥주|펍|포차|하이볼|사케|위스키|막걸리|전통주|한잔/;

function splitQuery(query: string) {
  return uniqueStrings(query.split(/\s+/), 3).filter(word => !/^(?:맛집|카페|술집|디저트|전시|놀거리|명소)$/.test(word));
}

/** Kakao searches that together cover one place request. Accuracy-sorted keyword first, then a second page. */
export function placeSearchPlans(ask: PlaceAsk): PlaceSearchPlan[] {
  const words = splitQuery(ask.query);
  const plans: PlaceSearchPlan[] = [];
  const push = (plan: Omit<PlaceSearchPlan, "region">) => plans.push({ region: ask.area, ...plan });
  if (ask.kind === "restaurant") {
    if (words.length) {
      push({ query: words.join(" "), category: "restaurant", page: 1 });
      push({ query: words.join(" "), category: "restaurant", page: 2 });
      push({ query: `${words[0]} 맛집`, category: "restaurant", page: 1 });
    } else {
      push({ category: "restaurant", page: 1 });
      push({ category: "restaurant", page: 2 });
      push({ query: "데이트 맛집", category: "restaurant", page: 1 });
    }
  } else if (ask.kind === "cafe") {
    push({ query: words.length ? `${words.join(" ")} 카페` : undefined, category: "cafe", page: 1 });
    push({ category: "cafe", page: 2 });
    if (!words.length) push({ query: "디저트 카페", category: "cafe", page: 1 });
  } else if (ask.kind === "dessert") {
    push({ query: words.length ? words.join(" ") : "디저트", page: 1 });
    push({ query: "베이커리", category: "cafe", page: 1 });
  } else if (ask.kind === "bar") {
    push({ query: words.length ? words.join(" ") : "와인바", page: 1 });
    push({ query: words.length ? `${words[0]} 바` : "칵테일바", page: 1 });
    push({ query: "술집", page: 1 });
  } else if (ask.kind === "exhibit") {
    push({ query: words.length ? words.join(" ") : "전시", page: 1 });
    push({ query: "갤러리", page: 1 });
    push({ query: "미술관", page: 1 });
  } else if (ask.kind === "activity") {
    push({ query: words.length ? words.join(" ") : "방탈출", page: 1 });
    if (!words.length) {
      push({ query: "보드게임카페", page: 1 });
      push({ query: "공방 체험", page: 1 });
    }
  } else {
    push({ query: words.length ? words.join(" ") : "명소", page: 1 });
    push({ query: "가볼만한곳", page: 1 });
    push({ category: "tourist", page: 1 });
  }
  return plans;
}

export function placeAskHarshAllow(message: string, ask: PlaceAsk, base: HarshMealAllow): HarshMealAllow {
  const blob = `${message} ${ask.query}`;
  return {
    hoe: base.hoe || /회|횟집|활어|사시미|모둠회/.test(blob),
    meat: base.meat || /고기|삼겹|곱창|갈비|한우|막창|대창|족발|보쌈|닭발/.test(blob),
    bar: base.bar || ask.kind === "bar" || BAR_ASK.test(blob),
  };
}

export function matchesPlaceKind(candidate: DiscoverCandidate, kind: PlaceAskKind) {
  const blob = venueBlob(candidate);
  if (kind === "restaurant") return matchesActivity(candidate, "meal");
  if (kind === "cafe") return matchesActivity(candidate, "cafe") || /베이커리|디저트|빵/.test(blob);
  if (kind === "dessert") return matchesActivity(candidate, "cafe") || /베이커리|디저트|빵|케이크|아이스크림|젤라또|마카롱|도넛|와플/.test(blob);
  if (kind === "bar") return /주점|술집|바|이자카야|와인|칵테일|펍|호프|포차|맥주|하이볼|위스키|사케|막걸리|전통주/.test(blob) || matchesActivity(candidate, "meal");
  if (kind === "exhibit") return matchesActivity(candidate, "exhibit") || /팝업|공연|극장|영화/.test(blob);
  if (kind === "activity") return matchesActivity(candidate, "indoor") || /공방|체험|클래스|피크닉|공원|산책|야경|전망|루프탑/.test(blob) || matchesActivity(candidate, "walk");
  return true;
}

function queryMatchBonus(candidate: DiscoverCandidate, ask: PlaceAsk) {
  const blob = venueBlob(candidate).replace(/\s/g, "");
  let bonus = 0;
  for (const word of splitQuery(ask.query)) {
    if (blob.includes(word.replace(/\s/g, ""))) {
      bonus += 18;
      continue;
    }
    // 파스타 → 양식, 초밥 → 일식: a dish word still favours its cuisine.
    const cuisine = extractCuisine(word);
    if (cuisine && cuisine !== "any" && matchesCuisine(candidate, cuisine)) bonus += 12;
  }
  return bonus;
}

export function scorePlaceCandidate(candidate: DiscoverCandidate, ask: PlaceAsk, ctx: DateRankContext) {
  let score = scoreDateCandidate(candidate, { ...ctx, activities: [] });
  score += queryMatchBonus(candidate, ask);
  if (matchesPlaceKind(candidate, ask.kind)) score += 10;
  else score -= 30;
  if (candidate.rating != null) score += Math.min(12, Math.round(candidate.rating * 2));
  if (candidate.ratingCount) score += Math.min(8, Math.round(Math.log10(candidate.ratingCount) * 3));
  return score;
}

export function filterPlaceCandidates(
  candidates: DiscoverCandidate[],
  ask: PlaceAsk,
  ctx: { allowHarsh: HarshMealAllow; exclude: string[]; violatesAvoid: (blob: string) => boolean },
) {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = dateCandidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    if (!matchesPlaceKind(candidate, ask.kind)) return false;
    if (ctx.exclude.some(name => matchesTerm(candidate, name))) return false;
    if (isOffDateVenue(candidate, { allowHarsh: ctx.allowHarsh, allowKaraoke: ask.kind === "activity" })) return false;
    if (ctx.violatesAvoid(venueBlob(candidate))) return false;
    return true;
  });
}

export function rankPlaceCandidates(candidates: DiscoverCandidate[], ask: PlaceAsk, ctx: DateRankContext, limit = PLACE_CATALOG_SIZE) {
  return [...candidates]
    .sort((a, b) => scorePlaceCandidate(b, ask, ctx) - scorePlaceCandidate(a, ask, ctx) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function cleanText(value: unknown, max: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function sanitizePlacePicks(raw: unknown, allowedIds: Set<string>): PlacePick[] {
  const rows = Array.isArray(raw) ? raw : [];
  const picks: PlacePick[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const id = cleanText(item.id, 80);
    if (!id || !allowedIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    const rating = Number(item.rating);
    const count = Number(item.ratingCount);
    const sourceUrl = cleanText(item.sourceUrl, 300);
    const pick: PlacePick = { id, why: cleanText(item.why, WHY_MAX_CHARS) };
    if (Number.isFinite(rating) && rating > 0 && rating <= 5 && /^https?:\/\//.test(sourceUrl)) {
      pick.rating = Math.round(rating * 10) / 10;
      if (Number.isFinite(count) && count >= 1) pick.ratingCount = Math.round(count);
    }
    const food = cleanText(item.food, 40);
    if (food && !/^(?:음식|메뉴|식사|카페|커피|디저트|분위기)$/.test(food)) pick.food = food;
    if (/^https?:\/\//.test(sourceUrl)) pick.sourceUrl = sourceUrl;
    picks.push(pick);
    if (picks.length >= PLACE_PICK_MAX) break;
  }
  return picks;
}

export function placeFollowUpSuggestions(ask: PlaceAsk) {
  const next = ask.kind === "cafe" || ask.kind === "dessert"
    ? "근처 식당도 추천해줘"
    : ask.kind === "bar"
      ? "먼저 갈 식당도 추천해줘"
      : "근처 카페도 추천해줘";
  return ["이 중에서 코스 짜줘", "다른 곳 더 보여줘", next];
}

export function fallbackPlaceIntro(ask: PlaceAsk, count: number) {
  const label = PLACE_KIND_LABEL[ask.kind];
  const topic = splitQuery(ask.query).join(", ");
  const head = topic ? `${ask.area}에서 ${topic}로 찾아보니` : `${ask.area} ${label} 중에서`;
  return `${head} 이런 곳 ${count}군데가 눈에 띄어요. 카카오맵 후기도 함께 확인해 보시고, 마음에 드는 곳이 있으면 그 집을 넣어서 코스를 짜 드릴게요.`;
}

export function placeHeadline(ask: PlaceAsk) {
  const topic = splitQuery(ask.query).join(" · ");
  return topic ? `${ask.area} ${topic}` : `${ask.area} ${PLACE_KIND_LABEL[ask.kind]} 추천`;
}

export function placeStop(candidate: DiscoverCandidate, why: string, saved: boolean): AIChatStop {
  const factLine = publicPlaceFactLine(candidate);
  return {
    name: candidate.name,
    meta: `${dateCategoryLabel(candidate)} · ${candidate.district}`,
    reason: why || factLine || groundedStopReason({ candidate, saved }),
    mapUrl: candidate.mapUrl,
    isSaved: saved,
    phone: candidate.phone,
    address: candidate.roadAddress || candidate.address,
    coordinates: candidate.coordinates,
    image: candidate.image,
    openingHours: candidate.openingHours,
    source: candidate.externalSource,
    rating: candidate.rating,
    ratingCount: candidate.ratingCount,
    dishes: candidate.dishes,
    factSourceUrl: candidate.factSourceUrl,
  };
}

export function buildPlaceCard(input: {
  ask: PlaceAsk;
  picks: Array<{ candidate: DiscoverCandidate; why: string }>;
  intro: string;
  savedNames: Set<string>;
}): AIChatCard {
  const intro = cleanText(input.intro, INTRO_MAX_CHARS) || fallbackPlaceIntro(input.ask, input.picks.length);
  return {
    headline: placeHeadline(input.ask),
    lines: [intro],
    stops: input.picks.map(pick => placeStop(pick.candidate, pick.why, input.savedNames.has(pick.candidate.name))),
    suggestions: placeFollowUpSuggestions(input.ask),
  };
}

/** Heuristic selection when the model is unavailable: top ranked, one per brand. */
export function heuristicPlacePicks(ranked: DiscoverCandidate[], limit = 4) {
  const picked: DiscoverCandidate[] = [];
  const brands = new Set<string>();
  for (const candidate of ranked) {
    const brand = candidate.name.replace(/\s.*$/, "");
    if (brands.has(brand)) continue;
    brands.add(brand);
    picked.push(candidate);
    if (picked.length >= limit) break;
  }
  return picked;
}

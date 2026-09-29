import type { AIPlannerState, DateActivityId } from "@/features/planning/types/plan";
import type { DiscoverCandidate, PlaceCategoryId } from "@/features/places/types/place";
import type { ExperiencePlan } from "./experiencePlan";
import type { ResearchNeed, ResearchPlan } from "./researchPlan";
import { dateCandidateKey } from "./dateCourse";
import { researchEvidenceFresh } from "./researchPlan";
import { distanceMeters } from "@/features/places/geo";
import { classifyKakaoPlace, classifyPlaceExperiences } from "@/lib/kakao/placeClassification";
import type { SessionCandidateContext } from "./sessionCandidates";
import type { DateCandidateRecord } from "./dateCandidatePool";

export const MAX_EXPLORATION_CANDIDATES = 8;
export type ExplorationActivity = "beach" | "culture" | "shopping" | "meal" | "cafe"
  | "nightview" | "experience" | "nature";
export type PreferenceProvenance = "user_selected" | "explicit_text" | "inferred" | "legacy_default";
type CafeQuality = "aesthetic" | "view" | "spacious" | "traditional" | "dessert";
type ShoppingKind = "outlet" | "department" | "market" | "select_shop";
type CultureKind = "art_museum" | "museum" | "media_art" | "exhibit";
type PreferenceKey = ExplorationActivity | "cuisine" | "pace" | "shoppingKind" | "cultureKind" | "additionalDetails"
  | `cafe:${CafeQuality}`;
export type CandidateExplorationPreferences = {
  activities: ExplorationActivity[];
  cafeQualities: CafeQuality[];
  cuisines: string[];
  shoppingKinds: ShoppingKind[];
  cultureKinds: CultureKind[];
  additionalDetails: string;
  pace: "relaxed" | "balanced" | "active";
  provenance: Partial<Record<PreferenceKey, PreferenceProvenance>>;
};
export type ExplorationCard = { candidateId: string; name: string; area: string;
  category: string; image?: string; mapUrl: string; address: string; badges: string[];
  reason: string; factLabel: string; evidenceUrls: string[]; groupId?: ExplorationActivity };
export type CandidateGroup = { id: ExplorationActivity; title: string; description: string;
  needIds: string[]; cards: ExplorationCard[]; availableCount: number };
/** Ephemeral retrieval evidence for ranking. It is not a venue fact or a popularity score. */
export type ExplorationRetrievalSignal = { matchedQueries: number; primaryRank?: number; bestRank: number };
const MAX_LOCAL_SHOPPING_DISTANCE_METERS = 2000;
export type CandidateExplorationState = { experiencePlan: ExperiencePlan | null;
  researchPlan: ResearchPlan; groups: CandidateGroup[]; selectedCandidateIds: string[];
  rejectedCandidateIds: string[]; shownCandidateIds: string[] };
export type ItineraryPlanningInput = { experiencePlan: ExperiencePlan | null;
  researchPlan: ResearchPlan; selectedCandidateIds: string[]; rejectedCandidateIds: string[];
  /** Existing signed session candidate snapshot, not a new candidate source of truth. */
  candidatePool: SessionCandidateContext | null };

export const EXPLORATION_ACTIVITIES: Array<{ id: ExplorationActivity; label: string }> = [
  { id: "beach", label: "바다/산책" }, { id: "culture", label: "전시/문화" },
  { id: "shopping", label: "쇼핑" }, { id: "meal", label: "맛집" },
  { id: "cafe", label: "카페" }, { id: "nightview", label: "야경" },
  { id: "experience", label: "체험" }, { id: "nature", label: "자연/휴식" },
];
export const CAFE_CHOICES = [
  { value: "aesthetic", label: "공간이 예쁜 곳" }, { value: "dessert", label: "디저트" },
  { value: "traditional", label: "한옥/전통" }, { value: "view", label: "전망 좋은 곳" },
  { value: "spacious", label: "좌석이 넉넉한 곳" },
] as const;
export const CUISINE_CHOICES = ["한식", "양식", "일식", "중식", "고기", "해산물", "면/국수"] as const;
export const SHOPPING_CHOICES = [
  { value: "outlet", label: "아울렛" }, { value: "department", label: "백화점" },
  { value: "market", label: "시장" }, { value: "select_shop", label: "소품샵/편집샵" },
] as const;
export const CULTURE_CHOICES = [
  { value: "art_museum", label: "미술관" }, { value: "museum", label: "박물관" },
  { value: "media_art", label: "미디어아트" }, { value: "exhibit", label: "전시" },
] as const;

const activityCategory: Record<ExplorationActivity, PlaceCategoryId> = {
  beach: "nature", culture: "photo", shopping: "tourist", meal: "restaurant",
  cafe: "cafe", nightview: "tourist", experience: "photo", nature: "nature",
};
const activityQuery: Record<ExplorationActivity, string> = {
  beach: "해수욕장", culture: "전시", shopping: "쇼핑", meal: "식당",
  cafe: "카페", nightview: "야경 전망대", experience: "체험", nature: "공원",
};
const explorationAlternates: Partial<Record<ExplorationActivity, string[]>> = {
  nightview: ["야경 명소", "전망대", "전망 공원"],
  beach: ["해변", "해안 산책로"],
  nature: ["수목원", "자연휴양림"],
};

export function explorationSearchQueries(id: ExplorationActivity, primary: string, area?: string) {
  const localShopping = id === "shopping" && area && !isBroadExplorationArea(area)
    ? [`${area.replace(/역$/, "")}역 상가`] : [];
  const shopping = id !== "shopping" ? [] : /소품샵|편집샵/.test(primary)
    ? ["소품샵", "편집샵"] : /아울렛|아웃렛/.test(primary)
      ? ["아울렛", "상설할인매장"] : /백화점/.test(primary)
        ? ["백화점"] : /시장/.test(primary)
          ? ["시장", "상점가"]
          : ["쇼핑몰", "백화점", "아울렛", "시장", "소품샵", "편집샵"];
  return [...new Set([primary, ...localShopping, ...shopping, ...(explorationAlternates[id] ?? [])])];
}

const BROAD_EXPLORATION_AREAS = new Set(["서울", "부산", "인천", "대구", "대전", "광주", "울산", "세종", "제주"]);
export const isBroadExplorationArea = (area: string) => BROAD_EXPLORATION_AREAS.has(area) || /시$|도$|광역시$|특별시$/.test(area);
export function explorationGroupMatch(candidate: DiscoverCandidate, id: ExplorationActivity,
  fromNeedSearch = false) {
  const experienceSignals = classifyPlaceExperiences(candidate);
  if (id === "shopping") {
    const classification = classifyKakaoPlace({ name: candidate.name,
      detailedCategory: candidate.detailedCategory, groupCode: candidate.kakaoCategoryGroupCode });
    return candidate.category === "tourist" && classification.visitable && Boolean(classification.shoppingKind);
  }
  if (id === "nightview") return ["tourist", "nature", "photo"].includes(candidate.category)
    && (experienceSignals.some(signal => signal.kind === "nightview") || fromNeedSearch);
  if (id === "beach") return ["nature", "tourist"].includes(candidate.category)
    && (experienceSignals.some(signal => signal.kind === "coast") || fromNeedSearch);
  if (id === "nature") return ["nature", "tourist"].includes(candidate.category)
    && (experienceSignals.some(signal => signal.kind === "nature") || fromNeedSearch);
  return candidate.category === activityCategory[id];
}
const qualityEvidence: Record<string, string[]> = {
  aesthetic: ["space", "interior", "architecture"], view: ["view", "terrace", "window"],
  spacious: ["space", "seating"], traditional: ["architecture", "interior"],
  dessert: ["menu"], quiet: ["noise", "crowd"], atmosphere: ["space", "interior", "ambience"],
  value_for_money: ["menu", "price"], local_feel: [],
};
const qualityLabel: Record<string, string> = { aesthetic: "예쁜 공간", view: "전망 근거",
  spacious: "넓은 공간", traditional: "전통 공간", dessert: "디저트", quiet: "조용함",
  atmosphere: "분위기", value_for_money: "가격 근거" };

export function initialExplorationPreferences(message: string, state: AIPlannerState): CandidateExplorationPreferences {
  const activities: ExplorationActivity[] = [];
  const add = (id: ExplorationActivity) => { if (!activities.includes(id)) activities.push(id); };
  const explicit = `${message} ${(state.userRequests ?? []).join(" ")}`;
  if (/바다|해변|해수욕|산책/.test(explicit)) add("beach");
  if (/전시|미술관|박물관|문화/.test(explicit)) add("culture");
  if (/쇼핑|아울렛|백화점|시장|소품샵/.test(explicit)) add("shopping");
  if (/맛집|식사|식당|먹|파스타|국밥|해산물|회/.test(explicit)) add("meal");
  if (/카페|커피|디저트/.test(explicit)) add("cafe");
  if (/야경|밤바다/.test(explicit)) add("nightview");
  if (/체험|공방|액티비티/.test(explicit)) add("experience");
  if (/자연|휴식|숲|공원/.test(explicit)) add("nature");
  const cafeQualities: CandidateExplorationPreferences["cafeQualities"] = [];
  if (/예쁜|이쁜|감성/.test(explicit)) cafeQualities.push("aesthetic");
  if (/오션뷰|전망|뷰\s*좋/.test(explicit)) cafeQualities.push("view");
  if (/대형|넓은/.test(explicit)) cafeQualities.push("spacious");
  if (/한옥|전통/.test(explicit)) cafeQualities.push("traditional");
  if (/디저트|케이크/.test(explicit)) cafeQualities.push("dessert");
  const cuisines = ["돼지국밥", "파스타", "해산물", "회", ...CUISINE_CHOICES]
    .filter(cuisine => cuisine === "회" ? /(?:^|\s)회(?:\s|$)/.test(explicit) : explicit.includes(cuisine));
  if (!cuisines.length && state.cuisine && state.cuisine !== "any") cuisines.push(state.cuisine);
  const shoppingKinds = SHOPPING_CHOICES.filter(option =>
    (option.value === "outlet" ? /아울렛|아웃렛/ : option.value === "department" ? /백화점/
      : option.value === "market" ? /시장|마켓/ : /소품샵|편집샵/).test(explicit)).map(option => option.value);
  const cultureKinds = CULTURE_CHOICES.filter(option =>
    (option.value === "art_museum" ? /미술관/ : option.value === "museum" ? /박물관/
      : option.value === "media_art" ? /미디어아트/ : /전시/).test(explicit)).map(option => option.value);
  const pace = /여유롭|느긋|쉬엄쉬엄/.test(explicit) ? "relaxed"
    : /많이 둘러|활동적|빡빡/.test(explicit) ? "active" : state.pace;
  return { activities, cafeQualities, cuisines: [...new Set(cuisines)], shoppingKinds, cultureKinds,
    additionalDetails: "", pace,
    provenance: Object.fromEntries([...activities.map(id => [id, "explicit_text"]),
      ...cafeQualities.map(quality => [`cafe:${quality}`, "explicit_text"]),
      ...(cuisines.length ? [["cuisine", /돼지국밥|파스타|해산물|(?:^|\s)회(?:\s|$)|한식|양식|일식|중식/.test(explicit)
        ? "explicit_text" : "inferred"]] : []),
      ...(shoppingKinds.length ? [["shoppingKind", "explicit_text"]] : []),
      ...(cultureKinds.length ? [["cultureKind", "explicit_text"]] : []),
      ...(pace !== "balanced" ? [["pace", "explicit_text"]] : [])]) as CandidateExplorationPreferences["provenance"] };
}

export function validExplorationPreferences(value: CandidateExplorationPreferences): boolean {
  const ids = new Set(EXPLORATION_ACTIVITIES.map(item => item.id));
  const validList = <T>(items: T[], allowed: readonly T[]) => Array.isArray(items)
    && items.length <= allowed.length && new Set(items).size === items.length
    && items.every(item => allowed.includes(item));
  return Array.isArray(value.activities) && value.activities.length <= ids.size
    && value.activities.every(id => ids.has(id)) && new Set(value.activities).size === value.activities.length
    && validList(value.cafeQualities, CAFE_CHOICES.map(option => option.value))
    && Array.isArray(value.cuisines) && value.cuisines.length <= 8
    && new Set(value.cuisines).size === value.cuisines.length
    && value.cuisines.every(item => typeof item === "string" && item.length <= 40)
    && validList(value.shoppingKinds, SHOPPING_CHOICES.map(item => item.value))
    && validList(value.cultureKinds, CULTURE_CHOICES.map(item => item.value))
    && typeof value.additionalDetails === "string" && value.additionalDetails.length <= 160
    && ["relaxed", "balanced", "active"].includes(value.pace);
}

export function explorationPrompt(message: string, preferences: CandidateExplorationPreferences) {
  const labels = preferences.activities.map(id => EXPLORATION_ACTIVITIES.find(item => item.id === id)?.label).filter(Boolean);
  const cafe = preferences.activities.includes("cafe") ? preferences.cafeQualities
    .map(q => CAFE_CHOICES.find(item => item.value === q)?.label).filter(Boolean) : [];
  // Phrase checked qualities as explicit user choices so P2's narrow input
  // parser retains them instead of dropping them as a generic "cafe" category.
  const cafePhrases: Record<CandidateExplorationPreferences["cafeQualities"][number], string> = {
    aesthetic: "예쁜 카페", view: "전망 좋은 카페", spacious: "좌석이 넉넉한 카페",
    traditional: "한옥 카페", dessert: "디저트 카페",
  };
  const explicitCafe = preferences.activities.includes("cafe")
    ? preferences.cafeQualities.map(quality => cafePhrases[quality]) : [];
  const cuisine = preferences.activities.includes("meal") ? preferences.cuisines : [];
  const shopping = preferences.activities.includes("shopping") ? preferences.shoppingKinds
    .map(kind => SHOPPING_CHOICES.find(item => item.value === kind)?.label).filter(Boolean) : [];
  const culture = preferences.activities.includes("culture") ? preferences.cultureKinds
    .map(kind => CULTURE_CHOICES.find(item => item.value === kind)?.label).filter(Boolean) : [];
  const pace = preferences.pace === "relaxed" ? "여유롭게" : preferences.pace === "active" ? "많이 둘러보기" : "적당히";
  return `${message.slice(0, 350)}\n추가 선호: ${preferences.additionalDetails.slice(0, 160)}.
사용자가 선택한 활동: ${labels.join(", ")}. 카페 조건: ${cafe.join(", ")}.
선택한 카페 경험: ${explicitCafe.join(", ")}. 식사 종류(복수 선택은 대안): ${cuisine.join(", ")}. 쇼핑 종류: ${shopping.join(", ")}. 문화 종류: ${culture.join(", ")}. 일정 스타일: ${pace}.`.slice(0, 1000);
}

/** Only explicitly chosen categories become exploration groups; P2 may add supporting needs. */
export function explorationResearchPlan(plan: ResearchPlan | null, preferences: CandidateExplorationPreferences,
  area: string): ResearchPlan {
  const needs: ResearchNeed[] = preferences.activities.map(id => {
    const category = activityCategory[id];
    const base = plan?.needs.find(need => need.kind === "venue" && need.category === category);
    const qualities = id === "cafe" ? preferences.cafeQualities : [];
    const qualityList = [...new Set([...(base?.qualities ?? []), ...qualities])];
    const query = id === "meal" && preferences.cuisines.length === 1 && preferences.cuisines[0] !== "지역 음식"
      ? `${preferences.cuisines[0]} 식당` : id === "shopping" && preferences.shoppingKinds.length === 1
        ? `${SHOPPING_CHOICES.find(item => item.value === preferences.shoppingKinds[0])?.label ?? "쇼핑"}`
        : id === "culture" && preferences.cultureKinds.length === 1
          ? `${CULTURE_CHOICES.find(item => item.value === preferences.cultureKinds[0])?.label ?? "전시"}`
          : activityQuery[id];
    return { id: `explore-${id}`, kind: "venue", purpose: `${query} 방문 경험`, category,
      // Exploration groups cover the requested area as a whole. A single P2 day
      // focus must not silently constrain every category to that district.
      geographicFocus: area, qualities: qualityList,
      evidenceNeeded: [...new Set(qualityList.flatMap(q => qualityEvidence[q] ?? []))],
      supportingRole: "primary", priority: "required" };
  });
  for (const need of [...needs]) if (need.evidenceNeeded.length)
    needs.push({ ...need, id: `${need.id}-evidence`, kind: "evidence", priority: "important" });
  const research = { needs, unresolved: [], source: plan?.source ?? "legacy_fallback" } as ResearchPlan;
  const detail = preferences.additionalDetails.trim();
  if (!detail) return research;
  const named = preferences.activities.filter(id => {
    const terms: Record<ExplorationActivity, RegExp> = {
      cafe: /카페|커피|디저트/, meal: /식당|맛집|음식|식사|밥/, shopping: /쇼핑|가게|시장/,
      culture: /전시|문화|미술|박물관/, beach: /바다|해변|산책/, nightview: /야경/,
      experience: /체험|공방/, nature: /자연|공원|숲|휴식/ };
    return terms[id].test(detail);
  });
  const target = named.length ? named : preferences.activities.length === 1 ? preferences.activities : [];
  return target.reduce((current, id) => refineExplorationNeed(current, id, detail), research);
}

export function refineExplorationNeed(plan: ResearchPlan, groupId: ExplorationActivity, text: string): ResearchPlan {
  const next = plan.needs.map(need => ({ ...need, qualities: [...need.qualities], evidenceNeeded: [...need.evidenceNeeded] }));
  const words = text.toLowerCase();
  const additions: string[] = [];
  if (/바다|오션뷰|전망|뷰/.test(words)) additions.push("view");
  if (/예쁜|이쁜|감성/.test(words)) additions.push("aesthetic");
  if (/조용|한적/.test(words)) additions.push("quiet");
  if (/덜 비싼|저렴|가성비/.test(words)) additions.push("value_for_money");
  if (/현지 느낌|로컬/.test(words)) additions.push("local_feel");
  if (/분위기/.test(words)) additions.push("atmosphere");
  for (const need of next.filter(item => item.id === `explore-${groupId}` || item.id === `explore-${groupId}-evidence`)) {
    need.qualities = [...new Set([...need.qualities, ...additions])];
    need.evidenceNeeded = [...new Set(need.qualities.flatMap(q => qualityEvidence[q] ?? []))];
  }
  return { ...plan, needs: next };
}

/** A generic follow-up belongs to the last group the user touched, if known. */
export function refinementGroupForMessage(groups: CandidateGroup[], message: string,
  activeGroup: ExplorationActivity | null): ExplorationActivity | null {
  const named: ExplorationActivity | null = /카페|커피|디저트/.test(message) ? "cafe"
    : /식당|맛집|음식|밥|해산물|파스타/.test(message) ? "meal"
      : /바다|해변|해수욕|산책/.test(message) ? "beach"
        : /전시|미술관|박물관/.test(message) ? "culture"
          : /쇼핑|아울렛|백화점|시장/.test(message) ? "shopping"
            : /야경/.test(message) ? "nightview"
              : /체험|공방/.test(message) ? "experience"
                : /공원|숲|자연/.test(message) ? "nature" : null;
  if (named) return groups.some(group => group.id === named) ? named : null;
  if (activeGroup && groups.some(group => group.id === activeGroup)) return activeGroup;
  return groups.length === 1 ? groups[0].id : null;
}

const liveEvidence = (candidate: DiscoverCandidate) => (candidate.evidence ?? []).filter(fact =>
  (!fact.venueId || fact.venueId === dateCandidateKey(candidate)) && researchEvidenceFresh(fact));

/** Only a checked source or provider identity metadata may describe a card. */
export function candidateCardFact(candidate: DiscoverCandidate, need?: ResearchNeed): { label: string; text: string } {
  const checkedFacts = liveEvidence(candidate).filter(fact => fact.verification === "source_checked" && fact.text.trim());
  const checked = need?.evidenceNeeded
    .map(attribute => checkedFacts.find(fact => fact.attribute === attribute)).find(Boolean)
    ?? checkedFacts[0];
  if (checked) return { label: "확인된 정보", text: checked.text.replace(/\s+/g, " ").trim().slice(0, 120) };
  const reported = liveEvidence(candidate).find(fact => fact.verification === "search_report"
    && fact.sourceExcerpt?.trim() && fact.sourceVenueName?.trim() && fact.sourceAddress?.trim()
    && fact.url.startsWith("https://") && fact.text.trim());
  if (reported) return { label: "검색 자료 · 확인 필요",
    text: reported.text.replace(/\s+/g, " ").trim().slice(0, 120) };
  const providerType = candidate.detailedCategory?.split(/\s*>\s*/).at(-1)?.trim();
  if (providerType && providerType !== candidate.categoryLabel && providerType !== candidate.name)
    return { label: "장소 유형", text: providerType.slice(0, 64) };
  const namedTypes: Array<[string, RegExp]> = [
    ["해안 산책로", /해안.*산책로|해변.*산책로/], ["해수욕장", /해수욕장/],
    ["미술관", /미술관/], ["박물관", /박물관/], ["갤러리", /갤러리/],
    ["전시관", /전시관|전시장/], ["공원", /공원/], ["시장", /시장/],
  ];
  const named = namedTypes.find(([, pattern]) => pattern.test(candidate.name));
  if (named) return { label: "장소 유형", text: named[0] };
  return { label: "제공된 분류", text: candidate.categoryLabel || "장소 상세 정보 확인 전" };
}
export function candidateQualityBadges(candidate: DiscoverCandidate, need: ResearchNeed): string[] {
  const facts = liveEvidence(candidate).filter(fact => fact.verification === "source_checked");
  return need.qualities.flatMap(quality => {
    if (quality === "value_for_money" || quality === "local_feel") return [];
    const supported = (qualityEvidence[quality] ?? []).some(attribute => facts.some(fact => {
      const text = `${fact.attribute} ${fact.text}`.toLowerCase();
      const contrary = quality === "quiet" ? /시끄럽|붐비(?!지\s*않)|소음이\s*심/
        : quality === "spacious" ? /좁(?!지\s*않)/
          : quality === "view" ? /전망\s*없|뷰\s*없|바다(?:가)?\s*안\s*보/
            : null;
      if (contrary?.test(text)) return false;
      if (quality === "view") return /오션뷰|바다\s*전망|전망이\s*좋|탁\s*트인\s*전망|sea view|ocean view/.test(text);
      if (quality === "traditional") return /한옥|전통|architecture|건축/.test(text);
      if (quality === "spacious") return /넓|대형|넉넉한\s*좌석|spacious/.test(text);
      if (quality === "aesthetic") return /예쁜|이쁜|아름다운|감각적|감성적|멋진\s*인테리어/.test(text);
      if (quality === "quiet") return /조용|한적|고요|quiet/.test(text);
      if (quality === "atmosphere") return /분위기\s*좋|아늑|멋진\s*공간|romantic/.test(text);
      if (quality === "dessert") return /디저트|케이크|베이커리|마카롱/.test(text);
      return text.includes(attribute);
    }));
    return supported && qualityLabel[quality] ? [qualityLabel[quality]] : [];
  }).slice(0, 3);
}

function cuisineMatches(candidate: DiscoverCandidate, cuisines: string[]) {
  if (!cuisines.length || cuisines.includes("지역 음식")) return true;
  const text = `${candidate.name} ${candidate.detailedCategory ?? ""} ${candidate.dishes ?? ""}
    ${(candidate.evidence ?? []).filter(fact => fact.attribute === "menu" && researchEvidenceFresh(fact))
      .map(fact => fact.text).join(" ")}`;
  const terms: Record<string, RegExp> = { 한식: /한식|국밥|백반|한정식|갈비|찌개|불고기/,
    양식: /양식|파스타|피자|스테이크|이탈리안|브런치/, 일식: /일식|초밥|스시|라멘|돈카츠|우동/,
    중식: /중식|중국집|짜장|짬뽕|마라|딤섬/, 고기: /고기|삼겹|갈비|한우|소고기|바비큐/,
    해산물: /해산물|해물|횟집|회센터|생선|조개|새우|굴|씨푸드/,
    "면/국수": /면|국수|라멘|우동|파스타|냉면|칼국수/ };
  return cuisines.some(cuisine => (terms[cuisine]
    ?? new RegExp(cuisine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).test(text));
}

function subtypeMatches(candidate: DiscoverCandidate, id: ExplorationActivity,
  preferences: CandidateExplorationPreferences) {
  const text = `${candidate.name} ${candidate.detailedCategory ?? ""} ${candidate.categoryLabel}`;
  const culture: Record<CultureKind, RegExp> = {
    art_museum: /미술관|갤러리|아트센터/i, museum: /박물관|뮤지엄/i,
    media_art: /미디어아트|미디어\s*전시|몰입형\s*전시/i, exhibit: /전시|갤러리|미술관/i };
  return id === "shopping" && preferences.shoppingKinds.length
    ? preferences.shoppingKinds.includes(classifyKakaoPlace({ name: candidate.name,
      detailedCategory: candidate.detailedCategory, groupCode: candidate.kakaoCategoryGroupCode }).shoppingKind as ShoppingKind)
    : id === "culture" && preferences.cultureKinds.length
      ? preferences.cultureKinds.some(kind => culture[kind].test(text)) : true;
}

function matchStrength(candidate: DiscoverCandidate, id: ExplorationActivity) {
  const text = `${candidate.name} ${candidate.detailedCategory ?? ""} ${candidate.categoryLabel}`;
  const experienceKind = id === "beach" ? "coast" : id === "nightview" ? "nightview"
    : id === "nature" ? "nature" : null;
  if (experienceKind) return classifyPlaceExperiences(candidate)
    .some(signal => signal.kind === experienceKind) ? 2 : 1;
  if (id === "culture") return /전시|미술관|박물관|갤러리|뮤지엄|미디어아트/.test(text) ? 2 : 1;
  if (id === "experience") return /체험|공방|액티비티|방탈출|놀이/.test(text) ? 2 : 1;
  return 2;
}

export function groupExplorationCandidates(input: { plan: ResearchPlan; preferences: CandidateExplorationPreferences;
  candidates: DiscoverCandidate[]; session: SessionCandidateContext | null; shownIds?: string[];
  rejectedIds?: string[]; records?: DateCandidateRecord[];
  candidateIdsByGroup?: Partial<Record<ExplorationActivity, string[]>>;
  retrievalSignalsByGroup?: Partial<Record<ExplorationActivity, Record<string, ExplorationRetrievalSignal>>>;
  searchCenter?: [number, number] | null }): CandidateGroup[] {
  const hidden = new Set([...(input.session?.shownCandidateIds ?? []), ...(input.session?.selectedCandidateIds ?? []),
    ...(input.session?.rejectedCandidateIds ?? []), ...(input.shownIds ?? []), ...(input.rejectedIds ?? [])]);
  const baseScores = new Map((input.records ?? []).map(record => [record.id,
    Object.values(record.scores).reduce((sum, value) => sum + value, 0)]));
  const assigned = new Set<string>();
  return input.preferences.activities.map(id => {
    const need = input.plan.needs.find(item => item.id === `explore-${id}`)!;
    const fromNeed = new Set(input.candidateIdsByGroup?.[id] ?? []);
    // Pool records retain existing session candidates, then provider response order.
    // Use this only when a more precise per-query retrieval signal is unavailable.
    const sourceOrder = new Map((input.candidateIdsByGroup?.[id] ?? []).map((key, index) => [key, index]));
    const retrievalSignals = input.retrievalSignalsByGroup?.[id] ?? {};
    const seen = new Set<string>();
    const ranked = input.candidates.filter(item => !hidden.has(dateCandidateKey(item))
      && !assigned.has(dateCandidateKey(item))
      && (!input.candidateIdsByGroup || fromNeed.has(dateCandidateKey(item)))
      && explorationGroupMatch(item, id, fromNeed.has(dateCandidateKey(item))))
      .filter(item => {
        if (id !== "shopping" || !need.geographicFocus || isBroadExplorationArea(need.geographicFocus)) return true;
        return input.searchCenter
          ? distanceMeters(input.searchCenter, item.coordinates) <= MAX_LOCAL_SHOPPING_DISTANCE_METERS
          : `${item.name} ${item.district} ${item.address} ${item.roadAddress}`.includes(need.geographicFocus);
      })
      .filter(item => id !== "meal" || cuisineMatches(item, input.preferences.cuisines))
      .filter(item => subtypeMatches(item, id, input.preferences))
      .map(item => ({ item, badges: candidateQualityBadges(item, need),
        focusFit: need.geographicFocus && `${item.district} ${item.address}`.includes(need.geographicFocus) ? 1 : 0,
        nameFit: need.geographicFocus && !isBroadExplorationArea(need.geographicFocus)
          && item.name.includes(need.geographicFocus) ? 1 : 0,
        nearbyMeters: id === "shopping" && input.searchCenter
          ? distanceMeters(input.searchCenter, item.coordinates) : Number.MAX_SAFE_INTEGER,
        matchStrength: matchStrength(item, id),
        retrieval: retrievalSignals[dateCandidateKey(item)],
        sourceOrder: sourceOrder.get(dateCandidateKey(item)) ?? Number.MAX_SAFE_INTEGER,
        shoppingFit: id === "shopping" && classifyKakaoPlace({ name: item.name,
          detailedCategory: item.detailedCategory, groupCode: item.kakaoCategoryGroupCode }).shoppingKind ? 1 : 0,
        baseScore: baseScores.get(dateCandidateKey(item)) ?? 0 }))
      .sort((a, b) => b.nameFit - a.nameFit || a.nearbyMeters - b.nearbyMeters || b.shoppingFit - a.shoppingFit
        || b.focusFit - a.focusFit || b.badges.length - a.badges.length
        || b.matchStrength - a.matchStrength
        || (b.retrieval?.matchedQueries ?? 0) - (a.retrieval?.matchedQueries ?? 0)
        || (a.retrieval?.primaryRank ?? Number.MAX_SAFE_INTEGER) - (b.retrieval?.primaryRank ?? Number.MAX_SAFE_INTEGER)
        || (a.retrieval?.bestRank ?? Number.MAX_SAFE_INTEGER) - (b.retrieval?.bestRank ?? Number.MAX_SAFE_INTEGER)
        || liveEvidence(b.item).length - liveEvidence(a.item).length || b.baseScore - a.baseScore
        || a.sourceOrder - b.sourceOrder
        || a.item.name.localeCompare(b.item.name))
      .filter(({ item }) => {
        const key = `${item.name.replace(/\s/g, "").toLowerCase()}|${item.address.replace(/\s/g, "").toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const cards = ranked.slice(0, MAX_EXPLORATION_CANDIDATES).map(({ item, badges }) => {
      assigned.add(dateCandidateKey(item));
      const fact = candidateCardFact(item, need);
      return ({
      candidateId: dateCandidateKey(item), name: item.name, area: item.district, groupId: id,
      category: item.categoryLabel, image: item.image, mapUrl: item.mapUrl,
      address: item.address || item.roadAddress, badges,
      reason: fact.text, factLabel: fact.label,
      evidenceUrls: liveEvidence(item).filter(fact => fact.verification === "source_checked"
        || fact.verification === "search_report" && Boolean(fact.sourceExcerpt?.trim()
          && fact.sourceVenueName?.trim() && fact.sourceAddress?.trim()))
        .map(fact => fact.url).slice(0, 3),
    }); });
    const label = EXPLORATION_ACTIVITIES.find(item => item.id === id)?.label ?? id;
    return { id, title: id === "cafe" && input.preferences.cafeQualities.length
      ? `${input.preferences.cafeQualities.map(q => CAFE_CHOICES.find(item => item.value === q)?.label).filter(Boolean).join(" · ")} 카페`
      : id === "meal" && input.preferences.cuisines.length === 1
        ? `${input.preferences.cuisines[0]} 맛집` : label,
      description: id === "nightview"
        ? "전망 장소 후보예요. 야간 개방과 실제 야경은 상세 정보에서 확인해 주세요."
        : need.qualities.length ? cards.some(card => card.badges.length)
        ? "확인된 근거가 있는 속성만 배지로 표시했어요."
        : "요청한 분위기와 속성은 아직 확인되지 않았어요. 장소 정보를 살펴보세요."
        : "지역과 장소 종류가 맞는 후보예요. 방문 가능 시간은 상세 정보에서 확인해 주세요.", needIds: [need.id], cards, availableCount: ranked.length };
  });
}

export function explorationStateForActivities(state: AIPlannerState,
  preferences: CandidateExplorationPreferences): AIPlannerState {
  const mappings: Partial<Record<ExplorationActivity, DateActivityId>> = {
    cafe: "cafe", meal: "meal", culture: "exhibit", nightview: "nightview", beach: "walk" };
  const mapped = [...new Set([...(state.explicitPlanningSelections?.activities ?? []),
    ...preferences.activities.flatMap(id => mappings[id] ? [mappings[id]!] : [])])];
  // A category chosen for candidate discovery is an interest, not an
  // itinerary requirement. Preserve only constraints already explicit in
  // the user's request; selected places become anchors at the handoff.
  return { ...state, activities: mapped, pace: preferences.pace };
}

export function retainExplorationChoices<T extends { candidateId: string }>(input: {
  selectedCards: T[]; rejectedIds: string[];
  groupById: Record<string, ExplorationActivity>;
  activities: ExplorationActivity[];
}) {
  const allowed = new Set(input.activities);
  const keep = (id: string) => {
    const group = input.groupById[id];
    return Boolean(group && allowed.has(group));
  };
  return { selectedCards: input.selectedCards.filter(card => keep(card.candidateId)),
    rejectedIds: input.rejectedIds.filter(keep) };
}

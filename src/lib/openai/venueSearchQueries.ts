import type { AIPlannerState, DateActivityId, DateChatTurn } from "@/features/planning/types/plan";
import type { PlaceCategoryId } from "@/features/places/types/place";
import { explicitlyDislikedActivities } from "@/features/ai/dateActivityExclusions";
import { candidateFoodConflict } from "@/features/ai/dateIntent";
import { extractActivitiesFromText, isExclusiveCrawl, isTravelPlan, selectedAreas, uniqueStrings } from "@/features/ai/dateBrief";
import type { CouplePersonalizationContext } from "@/features/ai/couplePersonalization";

type SearchQuery = { region: string; query: string };
type SearchCue = { id: string; match: RegExp; query: string; family?: "food" | "space"; activity?: DateActivityId };
const CUES: SearchCue[] = [
  { id: "pasta", match: /파스타|이탈리안|이탈리아\s*음식/, query: "파스타", family: "food", activity: "meal" },
  { id: "sushi", match: /초밥|스시/, query: "초밥", family: "food", activity: "meal" },
  { id: "ramen", match: /라멘/, query: "라멘", family: "food", activity: "meal" },
  { id: "pizza", match: /피자/, query: "피자", family: "food", activity: "meal" },
  { id: "brunch", match: /브런치/, query: "브런치", family: "food", activity: "meal" },
  { id: "korean", match: /한식|한정식/, query: "한식", family: "food", activity: "meal" },
  { id: "japanese", match: /일식|일본\s*음식/, query: "일식", family: "food", activity: "meal" },
  { id: "chinese", match: /중식|중국\s*음식|딤섬/, query: "중식", family: "food", activity: "meal" },
  { id: "western", match: /양식|스테이크/, query: "양식 레스토랑", family: "food", activity: "meal" },
  { id: "vegan", match: /비건|채식/, query: "비건 식당", family: "food", activity: "meal" },
  { id: "quiet", match: /조용|한적/, query: "조용한 카페", family: "space", activity: "cafe" },
  { id: "conversation", match: /대화|이야기|얘기/, query: "티룸", family: "space", activity: "cafe" },
  { id: "garden", match: /정원/, query: "정원 카페", family: "space", activity: "cafe" },
  { id: "hanok", match: /한옥/, query: "한옥 카페", family: "space", activity: "cafe" },
  { id: "ocean", match: /오션\s*뷰|바다\s*(?:뷰|전망)|바다가?\s*보이/, query: "오션뷰 카페", family: "space", activity: "cafe" },
  { id: "river", match: /리버\s*뷰|한강\s*뷰|강이?\s*보이/, query: "리버뷰 카페", family: "space", activity: "cafe" },
  { id: "terrace", match: /테라스/, query: "테라스 카페", family: "space", activity: "cafe" },
  { id: "rooftop", match: /루프\s*탑/, query: "루프탑 카페", family: "space", activity: "cafe" },
  { id: "roastery", match: /로스터리|로스팅|스페셜티/, query: "로스터리 카페", family: "space", activity: "cafe" },
  { id: "dessert", match: /디저트|케이크|베이커리/, query: "디저트 카페", activity: "cafe" },
  { id: "book", match: /독립\s*서점|책방|서점/, query: "독립서점" },
  { id: "craft", match: /공방|원데이\s*클래스|도자기|향수\s*만들/, query: "공방 체험", activity: "indoor" },
  { id: "exhibit", match: /전시|갤러리|미술관|박물관/, query: "전시 미술관", activity: "exhibit" },
  { id: "walk", match: /산책|공원|숲길/, query: "산책 공원", activity: "walk" },
  { id: "movie", match: /영화|시네마/, query: "영화관", activity: "movie" },
  { id: "performance", match: /공연|연극|뮤지컬/, query: "공연장", activity: "performance" },
  { id: "escape", match: /방탈출/, query: "방탈출", activity: "indoor" },
  { id: "board", match: /보드게임/, query: "보드게임카페", activity: "indoor" },
  { id: "indoor", match: /실내|우천|비\s*(?:가\s*)?오/, query: "실내 전시", activity: "exhibit" },
  { id: "night", match: /야경|전망대/, query: "야경 전망대", activity: "nightview" },
  { id: "meal", match: /식당|식사|맛집|레스토랑/, query: "식당", activity: "meal" },
  { id: "cafe", match: /카페|커피|티룸/, query: "카페", activity: "cafe" },
];
const BY_ID = new Map(CUES.map(cue => [cue.id, cue]));
const rejectedAfter = /^\s*(?:(?:한|하게|히|하고|하기|하는|은|는|을|를|이|가|도|만|카페|식당|곳|공간|분위기|거|건)\s*){0,5}(?:말고|아니고|아닌|아니라|싫|별로|빼|제외|피하|안\s*(?:가|먹|좋아)|필요\s*없|원하지\s*않)/;
const positiveAfter = /^\s*(?:(?:은|는|을|를|이|가|도)\s*)?(?:싫지\s*않|안\s*좋아하는\s*(?:건|것은)?\s*아니|상관\s*없|괜찮)/;

function cueMentions(text: string) {
  return CUES.flatMap(cue => [...text.matchAll(new RegExp(cue.match.source, "g"))].map(match => {
    const tail = text.slice(match.index + match[0].length).split(/[,.;!?\n]/)[0];
    const before = text.slice(0, match.index).slice(-8);
    const rejected = !positiveAfter.test(tail) && (rejectedAfter.test(tail)
      || /(?:^|\s)(?:안|못)\s*$/.test(before));
    return { cue, position: match.index, length: match[0].length, rejected };
  })).sort((a, b) => a.position - b.position);
}

/** Convert source-search prose to a useful keyword phrase. Custom short nouns
 * and branch names are preserved; the caller retains provider identity and
 * regional scope separately. This does not assert any venue has these traits. */
export function normalizeProviderSearchQuery(query: string, category?: PlaceCategoryId) {
  const value = query.normalize("NFKC").replace(/[\n\r\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return category === "restaurant" ? "식당" : category === "cafe" ? "카페" : "명소";
  const prose = value.length > 28 || /방문\s*경험|하기\s*좋|하고\s*싶|할\s*수\s*있|즐길\s*수|찾아|추천|위한|중심의/.test(value);
  if (!prose) return value.slice(0, 45);
  const mentions = cueMentions(value).filter(mention => !mention.rejected);
  const foods = mentions.filter(mention => mention.cue.family === "food");
  if (category === "restaurant" || foods.length && category !== "cafe") {
    const terms = uniqueStrings(foods.map(mention => mention.cue.query), 2);
    if (terms.length) return terms.join(" ");
    if (category === "restaurant" && mentions.some(mention => mention.cue.id === "quiet")) return "조용한 레스토랑";
  }
  const themed = mentions.filter(mention => !["food", undefined].includes(mention.cue.family)
    && (category === "cafe" || !category));
  if (themed.length) {
    const preferred = themed.find(mention => !["conversation", "quiet"].includes(mention.cue.id)) ?? themed[0];
    return preferred.cue.query;
  }
  const activity = mentions.find(mention => mention.cue.family !== "food");
  if (activity) return activity.cue.query;
  // Remove known task suffixes, never guess at an unknown business name.
  return value.replace(/\s*(?:방문\s*경험|방문|추천|검색|찾기|찾아\s*줘|알려\s*줘|가고\s*싶.*|위주의?\s*(?:곳|장소)).*$/, "")
    .replace(/\s+/g, " ").trim().slice(0, 45) || value.slice(0, 45);
}

const SLOT_QUERY: Record<DateActivityId, string> = {
  meal: "식당", cafe: "카페", walk: "산책 공원", exhibit: "미술관", movie: "영화관",
  performance: "공연장", indoor: "공방 체험", nightview: "야경 전망대",
};

export function buildVenueSearchBrief(input: {
  message: string; state: AIPlannerState; taste: string[]; conversation?: DateChatTurn[];
  couplePersonalization?: CouplePersonalizationContext;
  modelQueries?: SearchQuery[]; limit?: number;
}): { queries: SearchQuery[]; priorities: string[]; rejectedTerms: string[] } {
  const areas = selectedAreas(input.state);
  const limit = Math.min(8, Math.max(areas.length, input.limit ?? Math.max(4, areas.length * 3)));
  const active = new Map<string, SearchCue>();
  const rejected = new Set<string>();
  const rejectedActivities = new Set<DateActivityId>();
  const userTexts = [...(input.state.userRequests ?? []), ...(input.conversation ?? [])
    .filter(turn => turn.role === "user").map(turn => turn.text), input.message].slice(-30);
  for (const text of userTexts) {
    for (const activity of explicitlyDislikedActivities(text)) rejectedActivities.add(activity);
    const mentions = cueMentions(text);
    const positiveFoods = mentions.filter(mention => !mention.rejected && mention.cue.family === "food");
    // A newer single cuisine choice supersedes an older one unless the user
    // explicitly adds it as another option. Keep repeated turns in order.
    if (new Set(positiveFoods.map(mention => mention.cue.id)).size === 1
      && !positiveFoods.some(mention => /^\s*(?:도|까지|와|과)(?:\s|$|먹|가|해|추천|함께)/.test(text.slice(mention.position + mention.length)))
      && !/추가|함께|둘\s*다|모두|겸/.test(text)) {
      for (const old of active.values()) if (old.family === "food" && old.id !== positiveFoods[0].cue.id) active.delete(old.id);
    }
    for (const mention of mentions) {
      const { cue } = mention;
      if (mention.rejected) { active.delete(cue.id); rejected.add(cue.id); continue; }
      // A correction replaces older choices in its own semantic family only.
      const prefix = text.slice(0, mention.position);
      if (cue.family && /대신|말고|아니고|아니라|바꿔|바꾸|이번에는|이번엔/.test(prefix)) {
        for (const old of active.values()) if (old.family === cue.family && old.id !== cue.id) {
          active.delete(old.id); rejected.add(old.id);
        }
      }
      active.delete(cue.id); active.set(cue.id, cue); rejected.delete(cue.id);
      // A space/weather cue is not permission to restore an activity that the
      // user just rejected ("카페 빼고 정원 산책", "전시 말고 실내 공방").
      if (cue.activity && cue.family !== "space" && cue.id !== "indoor") rejectedActivities.delete(cue.activity);
    }
  }
  const explicit = [...active.values()];
  const explicitFood = explicit.some(cue => cue.family === "food");
  const desiredSlots = (input.state.activities.length ? input.state.activities : extractActivitiesFromText(input.message))
    .filter(activity => !rejectedActivities.has(activity));
  const exclusive = isExclusiveCrawl(input.state) || isExclusiveCrawl(input.message);
  const indoorOnly = cueMentions(input.message).some(mention => mention.cue.id === "indoor" && !mention.rejected);
  const slotAllowed = (cue: SearchCue) => {
    const activity = cue.family === "space" && desiredSlots.length === 1 && desiredSlots[0] === "meal"
      ? "meal" : cue.activity;
    return !activity || !rejectedActivities.has(activity)
      && (!exclusive || !desiredSlots.length || desiredSlots.includes(activity));
  };
  const foodAllowed = (query: string) => !candidateFoodConflict(query, input.state.excludedFoods ?? []);
  const allowedQuery = (query: string) => foodAllowed(query) && !(indoorOnly && /산책|공원|숲길|해변|야경\s*전망대/.test(query)) && !cueMentions(query)
    .some(({ cue }) => rejected.has(cue.id) || !slotAllowed(cue)
      || explicitFood && cue.family === "food" && !active.has(cue.id));
  const queryFor = (cue: SearchCue) => desiredSlots.length === 1 && desiredSlots[0] === "meal" && cue.family === "space"
    ? cue.id === "conversation" ? "레스토랑" : cue.query.replace(/카페$/, "레스토랑") : cue.query;
  const focused = uniqueStrings(explicit.filter(slotAllowed)
    .sort((a, b) => Number(["meal", "cafe"].includes(a.id)) - Number(["meal", "cafe"].includes(b.id)))
    .map(queryFor).filter(foodAllowed), 8);

  // Profile signals may expand research, never establish hard activities. They
  // are considered after direct wording, and only within an exclusive tour.
  const shared = input.couplePersonalization?.shared;
  const sharedTexts = desiredSlots.length || explicit.length ? [] : [
    ...(shared?.activities ?? []).map(activity => SLOT_QUERY[activity]), ...(shared?.cuisines ?? []),
    ...(shared?.crowd === "quiet" ? ["조용한 카페"] : []),
    ...(shared?.setting === "indoor" ? ["실내 전시"] : shared?.setting === "outdoor" ? ["산책 공원"] : []),
  ];
  const softTexts = [...input.taste, ...sharedTexts, ...(input.state.preferences?.vibe ?? []),
    ...(input.state.inferredPreferences ?? []).filter(item => item.confidence >= 0.65).map(item => item.value)];
  const soft = uniqueStrings(softTexts.flatMap(text => cueMentions(text)
    .filter(mention => !mention.rejected).map(mention => mention.cue))
    .filter(cue => !active.has(cue.id) && slotAllowed(cue) && !rejected.has(cue.id))
    .map(cue => cue.query).filter(allowedQuery), 5);
  if (input.state.preferences?.crowdTolerance != null && input.state.preferences.crowdTolerance < 0.35
    && allowedQuery("조용한 카페")) soft.push("조용한 카페");
  if ((input.state.preferences?.novelty ?? 0) >= 0.7 && !focused.length) soft.push("공방 체험", "독립서점");
  if ((input.state.preferences?.scenicPreference ?? 0) >= 0.7 && !focused.length) soft.push("전망 카페");
  if (!explicitFood && input.state.cuisine && input.state.cuisine !== "any" && allowedQuery(`${input.state.cuisine} 식당`))
    focused.unshift(`${input.state.cuisine} 식당`);
  const defaults = desiredSlots.length ? desiredSlots.map(slot => SLOT_QUERY[slot])
    : isTravelPlan(input.state) ? ["지역 관광명소", "전통시장", "문화시설"]
      : ["독립서점", "전시 미술관", "공방 체험"];
  const broad = desiredSlots.length ? desiredSlots.map(slot => SLOT_QUERY[slot])
    : focused.some(query => /카페|티룸/.test(query)) ? ["카페"] : ["가볼만한곳"];
  const model = (input.modelQueries ?? []).filter(row => areas.includes(row.region))
    .map(row => ({ region: row.region, query: normalizeProviderSearchQuery(row.query) })).filter(row => allowedQuery(row.query));
  const queries: SearchQuery[] = [];
  const seen = new Set<string>();
  const add = (row: SearchQuery) => {
    const key = `${row.region}:${row.query.replace(/\s/g, "")}`;
    if (queries.length >= limit || seen.has(key) || !allowedQuery(row.query)) return;
    seen.add(key); queries.push(row);
  };
  // Cover each destination before spending remaining queries on alternatives.
  const preferred = uniqueStrings([...focused, ...soft.filter(allowedQuery)], 10);
  const fallbackQueries = defaults.filter(allowedQuery);
  for (const region of areas) add({ region, query: preferred[0] ?? model.find(row => row.region === region)?.query
    ?? fallbackQueries[0] ?? broad[0] });
  for (const query of preferred.slice(1, Math.max(2, Math.ceil(limit / Math.max(1, areas.length)) - 1)))
    for (const region of areas) add({ region, query });
  // Reserve one broad source search per destination so qualitative terms,
  // which are not guaranteed to occur in a POI title, cannot empty the pool.
  for (const region of areas) add({ region, query: broad.find(allowedQuery) ?? "가볼만한곳" });
  for (const row of model) add(row);
  for (const query of preferred) for (const region of areas) add({ region, query });
  for (const query of fallbackQueries) for (const region of areas) add({ region, query });
  return { queries, priorities: uniqueStrings(explicit.map(cue => cue.query), 8),
    rejectedTerms: [...rejected].map(id => BY_ID.get(id)!.query) };
}

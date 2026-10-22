import type { AIPlannerState, DateActivityId, DateChatTurn } from "@/features/planning/types/plan";
import { selectedAreas, uniqueStrings, isTravelPlan, isExclusiveCrawl, courseSize, extractActivitiesFromText } from "@/features/ai/dateBrief";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";
import { DATE_PLAYBOOK, datePlaybookTags, selectDatePlaybook } from "./datePlaybook";
import { explicitlyDislikedActivities, toDateIntent } from "@/features/ai/dateIntent";
import { buildVenueSearchBrief } from "./venueSearchQueries";
import type { CouplePersonalizationContext } from "@/features/ai/couplePersonalization";

type Discovery = NonNullable<AIPlannerState["discovery"]>;
const activities = new Set<DateActivityId>(["meal", "cafe", "walk", "exhibit", "movie", "performance", "indoor", "nightview"]);
const list = (value: unknown, limit: number) => uniqueStrings(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map(v => v.slice(0, 100)) : [], limit);

const ORDER_TERMS: Array<[DateActivityId, RegExp]> = [
  ["meal", /저녁\s*(?:먹|식사)|점심\s*(?:먹|식사)|아침\s*(?:먹|식사)|식사|밥\s*먹|파스타|맛집/g],
  ["cafe", /카페|커피|디저트|베이커리/g],
  ["performance", /공연장|공연|연극|뮤지컬|콘서트/g],
  ["movie", /영화|시네마|CGV|메가박스/g],
  ["exhibit", /전시|미술관|갤러리|박물관/g],
  ["walk", /산책|공원|숲길|걷/g],
  ["indoor", /보드게임|방탈출|볼링|오락실|놀거리/g],
  ["nightview", /야경|전망대/g],
];

/** A multi-stop sequence in the user's own wording outranks model reordering. */
export function requestedActivityOrder(message: string, required: DateActivityId[]) {
  return ORDER_TERMS.flatMap(([slot, pattern]) => {
    if (!required.includes(slot)) return [];
    const match = new RegExp(pattern.source).exec(message);
    return match ? [{ slot, position: match.index }] : [];
  }).sort((a, b) => a.position - b.position).map(item => item.slot);
}

type Transport = Discovery["transport"];
const TRANSPORT_TERMS = /(?:자차|자동차|차량|렌터카|렌트카|운전|도보|걸어서|걸어\s*다니|대중교통|지하철|버스)(?=$|[\s,.!?;]|로|으로|는|은|를|을|가|이|만|도|여행|위주|해|하)|(?<![가-힣])차로/g;
const rejectedTransport = /^(?:(?:로|으로|는|은|을|를|이|가|도|만)\s*)*(?:말고|말아|말자|아니|없|없이|싫|불가|안\s*(?:가|갈|타|탈|이용|이동|운전)|못\s*(?:가|갈|타|탈|이용|이동|운전)|(?:이용|이동|운전|타)(?:하지|지)\s*않|(?:가|타|이동하|이용하|운전하|걷|다니)(?:는|기|긴|지)[가-힣\s]{0,5}(?:싫|않))/;

/** Only user-authored transport choices establish the fast-path mode.
 * Parking, a walk attraction, proximity to a station, and assistant suggestions
 * are not choices. Later corrections supersede earlier raw user requests. */
export function explicitDiscoveryTransport(input: { message: string; userRequests?: string[];
  conversation?: DateChatTurn[]; previous?: Transport }): Transport {
  let selected: Transport | undefined = input.previous;
  const texts = [...(input.userRequests ?? []), ...(input.conversation ?? [])
    .filter(turn => turn.role === "user").map(turn => turn.text), input.message];
  for (const text of texts) {
    const normalized = text.normalize("NFKC");
    for (const clause of normalized.match(/[^,.!?;\n]+[,.!?;\n]?/g) ?? []) {
      // An option being discussed is not an instruction to change transport.
      if (/또는|혹은|둘\s*중|고민|갈지|탈지/.test(clause)
        || /\?|어때|가능(?:해|할까)|갈까|할까/.test(clause)
          && !/갈게|가자|가고\s*싶|다닐게|이동할게|짜\s*줘|만들어\s*줘|추천해\s*줘/.test(clause)) continue;
      const choices: Transport[] = [];
      for (const match of clause.matchAll(TRANSPORT_TERMS)) {
        const term = match[0];
        const mode: Transport = /도보|걸어/.test(term) ? "walk"
          : /대중교통|지하철|버스/.test(term) ? "transit" : "drive";
        const after = clause.slice(match.index + term.length).trimStart();
        const before = clause.slice(0, match.index).slice(-12);
        if (rejectedTransport.test(after) || /(?:^|\s)(?:안|못)\s*$/.test(before)) {
          if (selected === mode) selected = undefined;
          continue;
        }
        const chosen = clause.trim().replace(/[,.!?;]$/, "") === term
          || /차로|걸어서|걸어\s*다니/.test(term)
          || /^(?:(?:는|은|를|을|이|가)\s*)*(?:로|으로|타고|탈게|탈래|타자|이동|다니|여행|위주|만|이용)/.test(after)
          || term === "운전" && /^(?:해|하|할게|할래)/.test(after);
        // Merely owning a car or liking a bus is not a request to use it.
        if (!chosen) continue;
        choices.push(mode);
      }
      const distinct = [...new Set(choices)];
      if (distinct.length === 1) selected = distinct[0];
      // Mixed alternatives need context that this three-mode contract cannot
      // express; retain the previous mode until a clear correction is given.
      else if (distinct.length > 1 && /대신|말고|아니고|바꿔|바꾸|바꿀|변경|이번|이제|했는데|였는데|하지만/.test(clause)) selected = choices.at(-1);
    }
  }
  return selected ?? "transit";
}

/** Plan the research before venue selection. A cuisine/category is not a complete date brief. */
export async function designDateDiscovery(input: { message: string; state: AIPlannerState; conversation?: DateChatTurn[]; taste: string[];
  couplePersonalization?: CouplePersonalizationContext;
  /** Exploration already supplies verified candidates; retain its brief without another model pass. */
  useExistingBrief?: boolean }): Promise<Discovery> {
  const areas = selectedAreas(input.state);
  const previous = input.state.discovery;
  const trip = isTravelPlan(input.state);
  const rejectedActivities = explicitlyDislikedActivities(input.message);
  const explicitActivities = extractActivitiesFromText(input.message).filter(activity => !rejectedActivities.includes(activity));
  // The model may suggest discovery themes, but only the user's interpreted
  // activities may become hard requirements.
  const lockedActivities = input.state.activities.length ? input.state.activities : explicitActivities;
  const userOrder = requestedActivityOrder(input.message, lockedActivities);
  const retainedOrder = input.state.preserveExistingPlaces
    ? (previous?.activityOrder ?? []).filter(activity => activities.has(activity) && lockedActivities.includes(activity)) : [];
  const size = courseSize(input.state);
  const pinnedCount = input.state.preserveExistingPlaces ? input.state.pinOrder.length : 0;
  const swapping = input.state.intent === "modify" && input.state.pinOrder.some(name => input.state.excludedPlaces.includes(name));
  const additionCount = pinnedCount && (input.state.addStop || swapping) ? pinnedCount + (input.state.addStop ? 1 : 0) : 0;
  const queryLimit = Math.min(8, Math.max(4, areas.length * 3));
  const searchBrief = buildVenueSearchBrief({ ...input, limit: queryLimit });
  const transport = explicitDiscoveryTransport({ message: input.message,
    userRequests: input.state.userRequests, conversation: input.conversation, previous: previous?.transport });
  const fallback: Discovery = {
    themes: searchBrief.priorities.length ? [`${searchBrief.priorities.slice(0, 3).join(" · ")} 중심의 코스`]
      : previous?.themes ?? [trip ? "지역의 문화와 풍경을 탐색하는 코스" : "관심 있는 공간과 동네 경험을 탐색하는 코스"],
    priorities: searchBrief.priorities, queries: searchBrief.queries,
    transport,
    requiredActivities: [...new Set(lockedActivities)],
    activityOrder: userOrder.length >= 2 ? userOrder : retainedOrder,
    minStops: additionCount || size.min,
    maxStops: additionCount || size.max,
  };
  if (input.useExistingBrief || !isOpenAiConfigured()) return fallback;
  const playbook = selectDatePlaybook(DATE_PLAYBOOK, datePlaybookTags(input.message, input.state), "discovery", trip ? 6 : 4)
    .map(({ id, title, guidance, example }) => ({ id, title, guidance, example }));
  const raw = await completeJson<Record<string, unknown>>({
    timeoutMs: 8000, maxTokens: 1000, reasoningEffort: "low", temperature: 0.3, retryOnTruncation: false,
    messages: [
      { role: "system", content: [
        "Design a venue discovery brief for a Korean couple's date. You do not pick venues or write the itinerary yet. Return JSON.",
        'Schema: {themes:[string],priorities:[string],queries:[{region:string,query:string}],transport:"walk|drive|transit",requiredActivities:["meal|cafe|walk|exhibit|movie|performance|indoor|nightview"],activityOrder:[],minStops:number,maxStops:number}. For overnight trips honor the supplied minimum and allow 3-4 stops on a full day.',
        "Choose 1-2 concise course concepts that fit the user's intent: food destination with a distinctive cafe, architecture and local streets, an exhibition and dessert, regional food and scenery, etc. Never impose the same meal-cafe-walk template.",
        `queries: at most ${queryLimit} short complementary Kakao keyword searches (not sentences), covering every supplied area. Retain the user's exact dish and aesthetic preferences: 파스타, 한옥 카페, 정원 카페, 로스터리, 오션뷰, 독립서점, 공방, 미술관. Include one broad search for coverage. Use ONLY the supplied areas as region. Never invent shop names.`,
        "priorities: concrete requested qualities, not generic positivity. requiredActivities: only explicit user requirements, not suggestions you invented. '걷는 거 적게' does NOT require a walk attraction. activityOrder: only an order the user explicitly asks for. An omitted preference is not a prohibition.",
        "Use dateIntent.objective and preferences to propose search themes, including implicit conversation, novelty, photo or quiet-place needs. Treat inferredPreferences as soft hints weighted by confidence. Keep hardConstraints authoritative.",
        "Honor latest corrections and previous brief. For a local date choose 2-4 worthwhile stops, never maximize count. For a trip allow 3-4 per day. Explicit cafe/food/exhibit tours may repeat the requested kind; otherwise diversify experiences. Do not add food to a cafe-only request.",
        "Transport comes from explicit wording, otherwise retain prior mode or allow transit. Choose walk only when the user explicitly wants a walkable course. Recommend places and a coherent visiting order. Do not ask for, assign or optimize start/end clocks, stay durations or budgets. Qualitative evening/night-view interests may guide venue choice without creating a timetable.",
      ].join(" ") },
      { role: "user", content: JSON.stringify({ latestMessage: input.message, areas, trip, exclusiveTour: isExclusiveCrawl(input.state), days: input.state.nights + 1, previous, state: input.state, dateIntent: toDateIntent(input.state), taste: input.taste.slice(0, 10), couplePersonalization: input.couplePersonalization,
        sourceSearchBrief: searchBrief, recentTurns: (input.conversation ?? []).slice(-6),
        planningPlaybook: playbook, playbookScope: "검색 전략과 비교 관점만 제공하며 장소·행사 사실이나 사용자 하드 제약을 만들지 않음" }) },
    ],
  });
  if (!raw) return fallback;
  const seen = new Set<string>();
  const modelQueries = (Array.isArray(raw.queries) ? raw.queries : []).flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    if (typeof row.region !== "string" || !areas.includes(row.region) || typeof row.query !== "string") return [];
    const query = row.query.trim().slice(0, 45);
    const key = `${row.region}:${query}`;
    if (query.length < 2 || seen.has(key)) return [];
    seen.add(key);
    return [{ region: row.region, query }];
  }).slice(0, queryLimit);
  const min = additionCount || Math.max(size.min, (typeof raw.minStops === "number" && Number.isFinite(raw.minStops) ? Math.max(2, Math.min(8, Math.round(raw.minStops))) : fallback.minStops));
  const max = Math.max(min, additionCount || (typeof raw.maxStops === "number" && Number.isFinite(raw.maxStops) ? Math.max(min, Math.min(size.max, Math.round(raw.maxStops))) : fallback.maxStops));
  const groundedSearchBrief = buildVenueSearchBrief({ ...input, modelQueries, limit: queryLimit });
  return {
    themes: list(raw.themes, 3).length ? list(raw.themes, 3) : fallback.themes,
    priorities: uniqueStrings([...groundedSearchBrief.priorities, ...list(raw.priorities, 8)
      .filter(priority => !groundedSearchBrief.rejectedTerms.some(term => priority.includes(term.replace(/카페|식당|레스토랑/g, "").trim())))], 8),
    queries: groundedSearchBrief.queries,
    transport: fallback.transport,
    requiredActivities: fallback.requiredActivities,
    activityOrder: userOrder.length >= 2 ? userOrder : retainedOrder,
    minStops: min, maxStops: max,
  };
}

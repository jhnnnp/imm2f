import type { AIPlannerState, DateActivityId, DateChatTurn } from "@/features/planning/types/plan";
import { selectedAreas, uniqueStrings, isTravelPlan, isExclusiveCrawl, courseSize, extractActivitiesFromText } from "@/features/ai/dateBrief";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";

type Discovery = NonNullable<AIPlannerState["discovery"]>;
const activities = new Set<DateActivityId>(["meal", "cafe", "walk", "exhibit", "movie", "performance", "indoor", "nightview"]);
const list = (value: unknown, limit: number) => uniqueStrings(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map(v => v.slice(0, 100)) : [], limit);
const activityList = (value: unknown) => list(value, 6).filter((v): v is DateActivityId => activities.has(v as DateActivityId));

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

/** Plan the research before venue selection. A cuisine/category is not a complete date brief. */
export async function designDateDiscovery(input: { message: string; state: AIPlannerState; conversation?: DateChatTurn[]; taste: string[] }): Promise<Discovery> {
  const areas = selectedAreas(input.state);
  const previous = input.state.discovery;
  const trip = isTravelPlan(input.state);
  const explicitActivities = extractActivitiesFromText(input.message);
  // The model may suggest discovery themes, but only the user's interpreted
  // activities may become hard requirements.
  const lockedActivities = input.state.activities.length ? input.state.activities : explicitActivities;
  const userOrder = requestedActivityOrder(input.message, lockedActivities);
  const size = courseSize(input.state);
  const pinnedCount = input.state.preserveExistingPlaces ? input.state.pinOrder.length : 0;
  const swapping = input.state.intent === "modify" && input.state.pinOrder.some(name => input.state.excludedPlaces.includes(name));
  const additionCount = pinnedCount && (input.state.addStop || swapping) ? Math.min(12, pinnedCount + (input.state.addStop ? 1 : 0)) : 0;
  const defaults = trip ? ["대표 관광명소", "지역 음식 맛집", "전망 좋은 카페", "산책 명소"] : ["데이트 레스토랑", "디저트 카페", "독립서점", "전시 갤러리", "가볼만한곳"];
  const queries = areas.flatMap(region => defaults.map(query => ({ region, query })));
  const fallback: Discovery = {
    themes: previous?.themes ?? [trip ? "지역의 음식과 풍경을 함께 즐기는 코스" : "식사와 공간, 동네의 볼거리를 함께 즐기는 코스"],
    priorities: previous?.priorities ?? [], queries: queries.slice(0, 12),
    transport: previous?.transport ?? "transit",
    requiredActivities: [...new Set(lockedActivities)],
    activityOrder: userOrder.length >= 2 ? userOrder : previous?.activityOrder ?? [],
    minStops: additionCount || size.min,
    maxStops: additionCount || size.max,
  };
  if (!isOpenAiConfigured()) return fallback;
  const raw = await completeJson<Record<string, unknown>>({
    timeoutMs: 15000, maxTokens: 1800, reasoningEffort: "low", temperature: 0.3,
    messages: [
      { role: "system", content: [
        "Design a venue discovery brief for a Korean couple's date. You do not pick venues or write the itinerary yet. Return JSON.",
        'Schema: {themes:[string],priorities:[string],queries:[{region:string,query:string}],transport:"walk|drive|transit",requiredActivities:["meal|cafe|walk|exhibit|movie|performance|indoor|nightview"],activityOrder:[],minStops:2,maxStops:4}.',
        "Invent 2-3 meaningfully different course concepts that fit the user's intent: food destination with a distinctive cafe, architecture and local streets, an exhibition and dessert, regional food and scenery, etc. Never impose the same meal-cafe-walk template.",
        "queries: 6-12 short complementary Kakao keyword searches (not sentences). Retain the user's exact dish and aesthetic preferences: 파스타, 한옥 카페, 정원 카페, 로스터리, 오션뷰, 독립서점, 공방, 미술관. Include 1-2 broad searches for coverage. Use ONLY the supplied areas as region. Never invent shop names.",
        "priorities: concrete requested qualities, not generic positivity. requiredActivities: only explicit user requirements, not suggestions you invented. '걷는 거 적게' does NOT require a walk attraction. activityOrder: only an order the user explicitly asks for. An omitted preference is not a prohibition.",
        "Honor latest corrections and previous brief. For a local date choose 2-4 worthwhile stops, never maximize count. For a trip allow 3-4 per day. Explicit cafe/food/exhibit tours may repeat the requested kind; otherwise diversify experiences. Do not add food to a cafe-only request.",
        "Transport comes from explicit wording, otherwise retain prior mode or allow transit. Choose walk only when the user explicitly wants a walkable course. Exact times are optional. Focus on venue appeal and coherent geography.",
      ].join(" ") },
      { role: "user", content: JSON.stringify({ latestMessage: input.message, areas, trip, exclusiveTour: isExclusiveCrawl(input.state), days: input.state.nights + 1, previous, state: input.state, taste: input.taste.slice(0, 10), recentTurns: (input.conversation ?? []).slice(-6) }) },
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
  }).slice(0, 12);
  const min = additionCount || (typeof raw.minStops === "number" && Number.isFinite(raw.minStops) ? Math.max(2, Math.min(8, Math.round(raw.minStops))) : fallback.minStops);
  const max = Math.max(min, additionCount || (typeof raw.maxStops === "number" && Number.isFinite(raw.maxStops) ? Math.max(min, Math.min(12, Math.round(raw.maxStops))) : fallback.maxStops));
  return {
    themes: list(raw.themes, 3).length ? list(raw.themes, 3) : fallback.themes,
    priorities: list(raw.priorities, 8), queries: modelQueries.length ? modelQueries : fallback.queries,
    transport: raw.transport === "drive" || raw.transport === "transit" || raw.transport === "walk" ? raw.transport : fallback.transport,
    requiredActivities: fallback.requiredActivities,
    activityOrder: userOrder.length >= 2 ? userOrder : previous?.activityOrder?.length ? previous.activityOrder : activityList(raw.activityOrder),
    minStops: min, maxStops: max,
  };
}

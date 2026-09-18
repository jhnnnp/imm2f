import type { AIChatCard, AIChatStop, AIPlannerState, DateChatTurn } from "@/features/planning/types/plan";
import { selectedAreas, uniqueStrings } from "@/features/ai/dateBrief";
import { completeJson, completeJsonWithWebSearch } from "./client";
import { isOpenAiConfigured } from "./env";

export type QuestionContextStop = Pick<AIChatStop, "name" | "meta" | "address" | "phone" | "mapUrl" | "startTime" | "durationMinutes" | "distanceFromPreviousMeters" | "rating" | "ratingCount" | "dishes" | "openingHours" | "factSourceUrl" | "reason">;

const REPLY_MAX_CHARS = 600;
const NEEDS_LOOKUP = /주차|영업|몇\s*시|언제|휴무|브레이크|예약|웨이팅|줄|가격|얼마|비싸|저렴|메뉴|시그니처|대표|콜키지|애견|반려|노키즈|룸|단체|와이파이|콘센트|주류|유아|휠체어/;

const QUESTION_PROMPT = [
  "You are the couple's date planner inside the ONLY US app, chatting in Korean 해요체 like a thoughtful friend.",
  "Answer the user's question directly using the context: the current course (stops with any known facts), the brief, and the couple's tastes. If the question is about one stop, talk about that stop. Answer only what was asked; do not enumerate unrelated unknowns.",
  "If you do not know something (hours, parking, prices, waiting) and no fact is provided, say plainly 아직 확인이 안 됐어요 and point to the map link or offer to look it up. Never invent hours, prices, ratings, or menus. Never mention 'provided information'; speak as yourself.",
  "Practical date advice (rain, budget framing, order of stops, what to do first) is welcome when grounded in the stops you have.",
  "Keep it to 2-5 sentences in 해요체 (never 반말), no emoji, no bullet lists, no markdown. Then propose up to 3 follow-up chips, each under 16 Korean characters, written as the user would type them (e.g. 카페 변경 해줘, 영업시간 알려줘).",
  "Return JSON only: {\"reply\":string,\"suggestions\":[string]}",
].join(" ");

const LOOKUP_PROMPT = [
  "You are the couple's date planner inside the ONLY US app, chatting in Korean 해요체 like a thoughtful friend. You have web_search and Korea location is set.",
  "The user asks something practical about a specific shop in focusStops (hours, parking, reservations, waiting, prices, menu, pet-friendly). Search at least twice: '{name} {address}' and '{name} {district} 네이버 플레이스' (or 카카오맵), then answer from what you actually find for that exact shop.",
  "Answer only the detail that was asked; do not list other unknowns. Say what you found and where (네이버 플레이스, 카카오맵). If that detail is not shown anywhere, say plainly 아직 확인이 안 됐어요 and suggest calling the shop or checking the map link. Never guess hours, prices, or ratings. Never mention 'provided information' or the data you were given; speak as yourself.",
  "2-5 sentences in 해요체, no emoji, no bullet lists, no markdown links inside reply; put the page you used in sourceUrl only. Then propose up to 3 follow-up chips, each under 16 Korean characters, written as the user would type them (e.g. 주차 돼?, 영업시간 알려줘).",
  "Return one raw JSON object only: {\"reply\":string,\"suggestions\":[string],\"sourceUrl\":string}",
].join(" ");

/** Web-search answers arrive with inline markdown citations; the card shows the source on its own line instead. */
function cleanReply(value: unknown) {
  return String(value ?? "")
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+([.,!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim()
    .slice(0, REPLY_MAX_CHARS);
}

function cleanSourceUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^https?:\/\//.test(raw)) return "";
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return "";
  }
}

const SUGGESTION_MAX_CHARS = 18;

/** Chips must stay tappable one-liners; long model sentences fall back to defaults. */
function cleanSuggestions(value: unknown, fallback: string[]) {
  const rows = Array.isArray(value) ? value : [];
  const cleaned = uniqueStrings(
    rows.map(row => String(row ?? "").replace(/[.!?]\s*$/, "").trim()).filter(row => row.length <= SUGGESTION_MAX_CHARS),
    3,
  );
  return cleaned.length ? cleaned : fallback;
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function mentionedStops(message: string, stops: QuestionContextStop[]) {
  const msg = message.replace(/\s/g, "").toLowerCase();
  const byName = stops.filter(stop => {
    const compact = stop.name.replace(/\s/g, "").toLowerCase();
    return compact.length >= 2 && (msg.includes(compact) || (compact.length >= 5 && msg.includes(compact.slice(0, 4))));
  });
  const ordinal = /첫\s*(?:번째|째)|처음|1번/.test(message) ? stops[0]
    : /두\s*(?:번째|째)|2번/.test(message) ? stops[1]
      : /세\s*(?:번째|째)|3번/.test(message) ? stops[2]
        : /네\s*(?:번째|째)|4번/.test(message) ? stops[3]
          : /마지막/.test(message) ? stops.at(-1)
            : undefined;
  const byKind = /식당|밥집|레스토랑/.test(message) ? stops.find(stop => /음식|식당|한식|일식|중식|양식|맛집/.test(stop.meta))
    : /카페/.test(message) ? stops.find(stop => /카페|디저트|커피/.test(stop.meta))
      : undefined;
  return uniqueStrings([...byName, ordinal, byKind].map(stop => stop?.name), 3)
    .map(name => stops.find(stop => stop.name === name))
    .filter((stop): stop is QuestionContextStop => Boolean(stop));
}

export function fallbackQuestionCard(message: string, stops: QuestionContextStop[], state: AIPlannerState): AIChatCard {
  const focus = mentionedStops(message, stops)[0] ?? stops[0];
  const area = selectedAreas(state).join(" · ");
  if (focus) {
    const bits = [
      focus.address ? `주소는 ${focus.address}` : "",
      focus.phone ? `전화는 ${focus.phone}` : "",
      focus.openingHours ? `이용시간은 ${focus.openingHours}` : "",
      focus.rating != null ? `평점은 ${focus.rating}점${focus.ratingCount ? ` (후기 ${focus.ratingCount}개)` : ""}` : "",
    ].filter(Boolean);
    return {
      headline: focus.name,
      lines: [
        bits.length
          ? `${bits.join(", ")}이에요. 주차나 영업시간처럼 지금 확인되지 않은 부분은 카드의 카카오맵 보기에서 바로 볼 수 있어요.`
          : "이 부분은 아직 확인된 정보가 없어요. 카드의 카카오맵 보기에서 영업시간과 후기를 바로 확인할 수 있어요.",
      ],
      suggestions: ["카페 변경 해줘", "다른 곳 더 보여줘", "이 코스 담기"],
    };
  }
  return {
    headline: "",
    lines: [
      area
        ? `${area} 기준으로 이어가고 있어요. 어느 곳이 궁금한지, 아니면 새로 찾아볼지 말해 주세요.`
        : "아직 정해진 코스가 없어요. 동네를 말해 주면 식당이나 카페부터 찾아볼게요.",
    ],
    suggestions: area ? ["코스 짜줘", "식당 추천해줘", "카페 추천해줘"] : ["성수 파스타 맛집 추천해줘", "을지로 저녁 데이트 코스 짜줘"],
  };
}

export async function answerDateQuestion(input: {
  message: string;
  state: AIPlannerState;
  stops: QuestionContextStop[];
  shownStops?: QuestionContextStop[];
  coupleTaste: { summary: string; commonTastes: string[]; avoidFoods: string[] };
  conversation?: DateChatTurn[];
}): Promise<AIChatCard> {
  const allStops = [...input.stops, ...(input.shownStops ?? [])];
  const fallback = () => fallbackQuestionCard(input.message, allStops, input.state);
  if (!isOpenAiConfigured()) return fallback();
  const focus = mentionedStops(input.message, allStops);
  const lookup = NEEDS_LOOKUP.test(input.message) && focus.length > 0;
  const payload = {
    latestMessage: input.message.slice(0, 500),
    recentTurns: (input.conversation ?? []).slice(-8),
    brief: {
      areas: selectedAreas(input.state),
      activities: input.state.activities,
      stayKind: input.state.stayKind,
      timeWindow: input.state.timeWindow,
      cuisine: input.state.cuisine,
      dateLabel: input.state.dateLabel,
      notes: input.state.conversationNotes.slice(-4),
    },
    focusStops: focus,
    currentCourse: input.stops,
    lastShownPlaces: (input.shownStops ?? []).slice(0, 6),
    couple: input.coupleTaste,
  };
  const defaultChips = input.stops.length ? ["카페 변경 해줘", "한 곳 더 추가해줘", "이 코스 담기"] : ["코스 짜줘", "다른 곳 더 보여줘"];
  try {
    if (lookup) {
      const searched = await completeJsonWithWebSearch<{ reply?: unknown; suggestions?: unknown; sourceUrl?: unknown }>({
        instructions: LOOKUP_PROMPT,
        payload,
        maxTokens: 1200,
        timeoutMs: 40000,
        requireSearch: true,
      });
      const reply = cleanReply(searched?.reply);
      if (reply) {
        const source = sourceLabel(cleanSourceUrl(searched?.sourceUrl));
        return {
          headline: focus[0]?.name ?? "",
          lines: [reply, ...(source ? [`출처: ${source}`] : [])],
          suggestions: cleanSuggestions(searched?.suggestions, defaultChips),
        };
      }
    }
    const parsed = await completeJson<{ reply?: unknown; suggestions?: unknown }>({
      temperature: 0.5,
      maxTokens: 700,
      reasoningEffort: "low",
      timeoutMs: 20000,
      messages: [
        { role: "system", content: QUESTION_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });
    const reply = cleanReply(parsed?.reply);
    if (!reply) return fallback();
    return {
      headline: focus.length === 1 ? focus[0].name : "",
      lines: [reply],
      suggestions: cleanSuggestions(parsed?.suggestions, defaultChips),
    };
  } catch {
    return fallback();
  }
}

import type { AIChatCard, AIChatStop, AIPlannerState, DateChatTurn } from "@/features/planning/types/plan";
import { selectedAreas, uniqueStrings } from "@/features/ai/dateBrief";
import { completeJson, completeJsonWithWebSearch } from "./client";
import { isOpenAiConfigured } from "./env";
import { looksPolite } from "./composeDateChat";

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
  return (typeof value === "string" ? value : "")
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

function choiceExplanation(stop: QuestionContextStop, state: AIPlannerState) {
  const reason = stop.reason?.trim() ?? "";
  if (reason && !/^\d(?:\.\d)?점(?:\s*·.*)?$/.test(reason)) return reason;
  const area = state.placeAsk?.area || selectedAreas(state)[0] || "해당 동네";
  const role = /카페|커피|디저트/.test(stop.meta) ? "카페" : /식당|음식|한식|일식|중식|양식/.test(stop.meta) ? "식당" : "장소";
  return `${area}에서 ${role} 후보로 찾았고, 현재 확인된 정보는 ${reason || stop.meta}예요. 이곳만의 경험을 뒷받침할 근거는 아직 충분하지 않아요.`;
}

/** Reuse facts already attached to the exact venue without a slower, less reliable model call. */
function knownQuestionCard(message: string, stop: QuestionContextStop, state: AIPlannerState): AIChatCard | null {
  if (/비교|차이|둘\s*중|더\s*(?:좋|나)|바뀌|변경|주차|예약|웨이팅|가격|얼마|비싸|저렴|애견|반려|휠체어|콜키지/.test(message)) return null;
  const asks = [
    { pattern: /왜\s*(?:골랐|추천)|고른\s*이유|추천한\s*이유/, value: true, text: choiceExplanation(stop, state) },
    { pattern: /주소|어디에\s*있|위치/, value: stop.address, text: stop.address ? `주소는 ${stop.address}예요.` : "" },
    { pattern: /전화|연락처/, value: stop.phone, text: stop.phone ? `연락처는 ${stop.phone}예요.` : "" },
    { pattern: /메뉴|시그니처|대표\s*음식/, value: stop.dishes, text: stop.dishes ? `확인된 메뉴는 ${stop.dishes}예요. 방문 전 메뉴판을 다시 확인해 주세요.` : "" },
    { pattern: /영업|휴무|몇\s*시|브레이크\s*타임/, value: stop.openingHours, text: stop.openingHours ? `기록된 영업 정보는 ${stop.openingHours}예요. 방문 전 최신 정보를 확인해 주세요.` : "" },
  ].filter(item => item.pattern.test(message));
  return asks.length === 1 && asks[0].value && asks[0].text
    ? { headline: stop.name, lines: [asks[0].text], suggestions: [] }
    : null;
}

export function resolveQuestionFocus(message: string, stops: QuestionContextStop[]) {
  const compact = (text: string) => text.replace(/\s/g, "").toLowerCase();
  const msg = compact(message);
  const numbers = [...message.matchAll(/(?<!\d)(\d{1,2})\s*번/g)].map(match => Number(match[1]) - 1);
  const ordinals = [/첫\s*(?:번째|째)|처음/, /두\s*(?:번째|째)/, /세\s*(?:번째|째)/, /네\s*(?:번째|째)/, /다섯\s*번째/];
  ordinals.forEach((pattern, index) => { if (pattern.test(message)) numbers.push(index); });
  if (/마지막/.test(message)) numbers.push(stops.length - 1);
  // An explicit number outranks a category: "2번 카페" is one stop.
  if (numbers.length) return {
    stops: [...new Set(numbers)].filter(index => index >= 0 && index < stops.length).map(index => stops[index]),
    invalid: numbers.some(index => index < 0 || index >= stops.length),
    explicit: true,
  };
  const named = stops.filter(stop => compact(stop.name).length >= 2 && msg.includes(compact(stop.name)));
  // A branch name containing a landmark is not a second reference to that landmark.
  const exact = named.filter(stop => !named.some(other => other !== stop && compact(other.name).includes(compact(stop.name)) && compact(other.name) !== compact(stop.name)));
  if (exact.length) return { stops: exact, invalid: false, explicit: true };
  const category = /식당|밥집|레스토랑/.test(message) ? /음식|식당|한식|일식|중식|양식|맛집/
    : /카페/.test(message) ? /카페|디저트|커피/
      : /공연장/.test(message) ? /공연|연극|뮤지컬/ : null;
  const matching = category ? stops.filter(stop => category.test(stop.meta)
    && (!/카페/.test(message) || !/보드|만화|방탈출/.test(stop.meta + stop.name))) : [];
  return { stops: matching, invalid: false, explicit: Boolean(category) };
}

export function fallbackQuestionCard(message: string, stops: QuestionContextStop[], state: AIPlannerState, target?: QuestionContextStop): AIChatCard {
  const resolved = resolveQuestionFocus(message, stops);
  const focus = target ?? (resolved.stops.length === 1 ? resolved.stops[0] : !resolved.explicit && stops.length === 1 ? stops[0] : undefined);
  const area = selectedAreas(state).join(" · ");
  if (!target && (resolved.invalid || (resolved.explicit && !focus) || (!resolved.explicit && !focus && NEEDS_LOOKUP.test(message)))) {
    return {
      headline: "어느 장소가 궁금하세요?",
      lines: [resolved.invalid ? "말씀하신 번호에 해당하는 장소가 없어요. 장소 이름이나 표시된 번호를 알려 주세요." : "장소 이름이나 번호를 알려 주시면 그곳에 대해 답해 드릴게요."],
      suggestions: [],
    };
  }
  if (focus) {
    let answer = "질문하신 내용은 아직 확인하지 못했어요. 장소 상세에서 확인하거나 다른 질문을 해 주세요.";
    if (/왜|이유/.test(message)) answer = choiceExplanation(focus, state);
    else if (/영업|휴무|몇\s*시|언제|브레이크/.test(message)) answer = focus.openingHours
      ? `확보한 이용시간 정보는 ${focus.openingHours}예요. 방문 전 최신 영업 여부를 확인해 주세요.` : "영업시간과 휴무일은 아직 확인하지 못했어요. 방문 전에 장소 상세나 매장에 확인해 주세요.";
    else if (/메뉴|시그니처|대표/.test(message)) answer = focus.dishes ? `확인된 메뉴는 ${focus.dishes}예요.` : "대표 메뉴는 아직 확인하지 못했어요.";
    else if (/주소|어디에|위치/.test(message)) answer = focus.address ? `주소는 ${focus.address}예요.` : "정확한 주소는 아직 확인하지 못했어요.";
    else if (/전화|연락처/.test(message)) answer = focus.phone ? `연락처는 ${focus.phone}예요.` : "매장 연락처는 아직 확인하지 못했어요.";
    else if (/주차/.test(message)) answer = "주차 가능 여부는 아직 확인하지 못했어요. 매장에 주차장 위치와 이용 조건을 확인해 주세요.";
    else if (/예약/.test(message)) answer = "예약 가능 여부는 아직 확인하지 못했어요. 매장 예약 안내를 확인해 주세요.";
    return { headline: focus.name, lines: [answer], suggestions: [] };
  }
  return {
    headline: "",
    lines: [area ? `${area}에서 어떤 부분이 궁금하세요? 장소 이름이나 질문을 조금 더 구체적으로 알려 주세요.` : "가고 싶은 동네나 궁금한 데이트 상황을 말해 주세요."],
    suggestions: [],
  };
}

export async function answerDateQuestion(input: {
  message: string;
  state: AIPlannerState;
  stops: QuestionContextStop[];
  shownStops?: QuestionContextStop[];
  coupleTaste: { summary: string; commonTastes: string[]; avoidFoods: string[] };
  conversation?: DateChatTurn[];
  /** Optional tighter budget for a supplementary, failure-isolated lookup. */
  lookupTimeoutMs?: number;
}): Promise<AIChatCard> {
  const visible = input.shownStops?.length && !/코스|일정/.test(input.message) ? input.shownStops : input.stops;
  let resolved = resolveQuestionFocus(input.message, visible);
  if (!resolved.explicit) {
    const named = resolveQuestionFocus(input.message, [...input.stops, ...(input.shownStops ?? [])]);
    if (named.explicit) resolved = named;
  }
  if (!resolved.explicit && /거기|그곳|그\s*카페|그\s*식당/.test(input.message)) {
    for (const turn of [...(input.conversation ?? [])].reverse()) {
      if (turn.role !== "user" || turn.text === input.message) continue;
      const previous = resolveQuestionFocus(turn.text, visible);
      if (previous.explicit) { resolved = previous; break; }
    }
  }
  const focus = resolved.stops.length ? resolved.stops : !resolved.explicit && visible.length === 1 ? visible : [];
  const fallback = () => fallbackQuestionCard(input.message, visible, input.state, focus.length === 1 ? focus[0] : undefined);
  const comparison = /비교|차이|둘|어느|어디가|뭐가/.test(input.message);
  if (resolved.invalid || (resolved.explicit && !focus.length) || (NEEDS_LOOKUP.test(input.message) && focus.length !== 1 && !comparison)) {
    return { headline: "어느 장소가 궁금하세요?", lines: [resolved.invalid ? "말씀하신 번호에 해당하는 장소가 없어요. 표시된 번호나 장소 이름을 알려 주세요." : "장소 이름이나 번호를 알려 주시면 그곳에 대해 확인할게요."], suggestions: [] };
  }
  if (comparison && focus.length > 1 && NEEDS_LOOKUP.test(input.message)) {
    const menu = /메뉴|시그니처|대표/.test(input.message);
    const hours = /영업|휴무|몇\s*시|언제|브레이크/.test(input.message);
    const other = /주차|예약|웨이팅|가격|얼마|비싸|저렴|애견|반려|휠체어|콜키지/.test(input.message);
    const facts = menu && !hours && !other ? focus.map(stop => stop.dishes)
      : hours && !menu && !other ? focus.map(stop => stop.openingHours) : [];
    if (facts.length === focus.length && facts.every(Boolean)) {
      return {
        headline: "장소 비교",
        lines: focus.map((stop, index) => `${stop.name}: ${facts[index]}${hours ? " (방문 전 최신 정보 확인 필요)" : ""}`),
        suggestions: [],
      };
    }
    return { headline: "아직 비교하기 어려워요", lines: ["두 장소의 해당 정보를 모두 확인하지 못했어요. 각 장소의 상세 정보에서 최신 내용을 확인해 주세요."], suggestions: [] };
  }
  if (focus.length === 1) {
    const known = knownQuestionCard(input.message, focus[0], input.state);
    if (known) return known;
  }
  if (!isOpenAiConfigured()) return fallback();
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
  const defaultChips = input.stops.length ? ["카페 변경 해줘", "한 곳 더 추가해줘"] : ["코스 짜줘", "다른 곳 더 보여줘"];
  try {
    if (lookup) {
      let searchedSources: string[] = [];
      const searched = await completeJsonWithWebSearch<{ reply?: unknown; suggestions?: unknown; sourceUrl?: unknown }>({
        instructions: LOOKUP_PROMPT,
        payload,
        maxTokens: 1200,
        timeoutMs: input.lookupTimeoutMs ?? 40000,
        requireSearch: true,
        onSources: urls => { searchedSources = urls; },
      });
      const reply = cleanReply(searched?.reply);
      const sourceUrl = cleanSourceUrl(searched?.sourceUrl);
      const citedBySearch = searchedSources.some(url => cleanSourceUrl(url) === sourceUrl);
      if (reply && looksPolite(reply) && sourceUrl && citedBySearch) {
        return {
          headline: focus[0]?.name ?? "",
          lines: [reply],
          sources: [{ label: sourceLabel(sourceUrl), url: sourceUrl }],
          suggestions: cleanSuggestions(searched?.suggestions, defaultChips),
        };
      }
      return fallback();
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
    if (!reply || !looksPolite(reply)) return fallback();
    return {
      headline: focus.length === 1 ? focus[0].name : "",
      lines: [reply],
      suggestions: cleanSuggestions(parsed?.suggestions, defaultChips),
    };
  } catch {
    return fallback();
  }
}

import type { AIChatCard, AIChatStop, AIPlannerState, DateChatTurn } from "@/features/planning/types/plan";
import { selectedAreas } from "@/features/ai/dateBrief";
import { completeJson, completeJsonWithWebSearch } from "./client";
import { isOpenAiConfigured } from "./env";
import { dateChatReplySchema, looksPolite } from "./composeDateChat";
import { claimsUnperformedAction, cleanChatSuggestions } from "./chatPresentation";

export type QuestionContextStop = Pick<AIChatStop, "name" | "meta" | "address" | "phone" | "mapUrl" | "startTime" | "durationMinutes" | "distanceFromPreviousMeters" | "rating" | "ratingCount" | "dishes" | "openingHours" | "factSourceUrl" | "reason">;

const REPLY_MAX_CHARS = 2400;
const NEEDS_LOOKUP = /주차|영업|몇\s*시|언제|휴무|브레이크|예약|웨이팅|줄|가격|얼마|비싸|저렴|메뉴|시그니처|대표|콜키지|애견|반려|노키즈|룸|단체|와이파이|콘센트|주류|유아|휠체어|혼잡|붐비|사람\s*(?:많|적|없)|좌석|대기/;

const QUESTION_PROMPT = [
  "You are the couple's date planner inside the ONLY US app, chatting in Korean 해요체 like a thoughtful friend.",
  "Answer the user's question directly using the context: the current course (stops with any known facts), the brief, and the couple's tastes. If the question is about one stop, talk about that stop. Answer only what was asked; do not enumerate unrelated unknowns.",
  "If you do not know something (hours, parking, prices, waiting) and no fact is provided, say plainly 아직 확인이 안 됐어요 and point to the map link or offer to look it up. Never invent hours, prices, ratings, or menus. Never mention 'provided information'; speak as yourself.",
  "Practical date advice (rain, order of stops, what to do first) is welcome when grounded in the stops you have. The service does not manage a date budget; never claim a cost limit has been checked or ask the user to enter menu costs.",
  "Use recentTurns to resolve pronouns and follow-up questions. Explain the recommendation against the user's actual objective and preferences, with concrete evidence and trade-offs. A rating or a category alone does not prove atmosphere, quality or suitability. Distinguish a supported fact from a reasonable planning suggestion. Do not describe two venues as nearby unless distance, address or other supplied evidence supports it. Never infer a place is quiet from a missing crowd report or from '조용하지 않다'.",
  "Answer proportionately in 해요체 (never 반말): one sentence for a simple fact, several short paragraphs for a nuanced comparison. State a preference or conclusion first when evidence permits it, then explain what supports it and what remains unknown. No emoji, headings or markdown. Then propose up to 3 relevant follow-up chips, each under 16 Korean characters, written as the user would type them (e.g. 카페 변경 해줘, 영업시간 알려줘).",
  "Return JSON only: {\"reply\":string,\"suggestions\":[string]}",
].join(" ");

const LOOKUP_PROMPT = [
  "You are the couple's date planner inside the ONLY US app, chatting in Korean 해요체 like a thoughtful friend. You have web_search and Korea location is set.",
  "The user asks something practical about the shop or shops in focusStops (hours, parking, reservations, waiting, prices, menu, pet-friendly). Search for each requested shop using its name and exact address/district; disambiguate branches before using any fact. Prefer the shop's official notice, official booking page, 네이버 플레이스 or 카카오맵. Search only for the requested detail and answer from what you actually find for that exact shop.",
  "Answer only the detail that was asked; do not list other unknowns. Say what you found and where (네이버 플레이스, 카카오맵). If that detail is not shown anywhere, say plainly 아직 확인이 안 됐어요 and suggest calling the shop or checking the map link. Never guess hours, prices, or ratings. Never mention 'provided information' or the data you were given; speak as yourself.",
  "For a comparison, check every requested venue independently, identify the useful difference and conclude only as far as evidence allows. Missing information is unknown, not a negative fact. A price or hours claim needs a source for that exact branch. Explain partial findings instead of refusing the whole comparison when only one detail is unknown. Respect current date, visit date and user preferences; never guarantee real-time waiting or availability.",
  "Respond naturally in 해요체, no emoji or markdown links inside reply; put every page used in sourceUrls. Then propose up to 3 relevant follow-up chips, each under 16 Korean characters, written as the user would type them (e.g. 주차 돼?, 영업시간 알려줘).",
  "Return one raw JSON object only: {\"reply\":string,\"suggestions\":[string],\"sourceUrls\":[string]}. Every URL must be a page actually returned by web_search, never a guessed link.",
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
    .trim();
}

function cleanSourceUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^https?:\/\//.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (url.username || url.password) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return "";
  }
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
function scheduleQuestion(message: string): "start" | "duration" | null {
  if (/영업|오픈|마감|휴무|브레이크|주차|예약|메뉴|가격|(?:몇\s*시|언제).{0,12}(?:열|닫)/.test(message)) return null;
  if (/(?:체류|머무|머물|이용|배정).{0,12}(?:시간|분|얼마)|(?:얼마나|몇\s*분).{0,12}(?:있|머무|머물|보내)/.test(message)) return "duration";
  if (/(?:몇\s*시|언제).{0,12}(?:가|갈|도착|시작|방문)|(?:방문|도착|시작)\s*(?:시간|시각)|몇\s*시(?:야|예요|인가|지|에요|\s*\?)/.test(message)) return "start";
  return null;
}

function scheduleQuestionCard(message: string, stop: QuestionContextStop): AIChatCard | null {
  const question = scheduleQuestion(message);
  if (!question) return null;
  const knownTime = typeof stop.startTime === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(stop.startTime);
  const knownDuration = Number.isFinite(stop.durationMinutes) && Number(stop.durationMinutes) > 0;
  const text = question === "start"
    ? knownTime ? `현재 코스에서 ${stop.startTime}에 방문하도록 잡혀 있어요. 매장 영업시간과는 별도의 일정이에요.` : "아직 방문 시간을 정하지 않았어요. 원하는 시작 시간을 알려 주시면 코스 시간을 맞출 수 있어요."
    : knownDuration ? `현재 코스에는 ${stop.durationMinutes}분 머무르도록 잡혀 있어요. 실제 이용 시간은 현장 상황에 따라 달라질 수 있어요.` : "이 장소에 머무를 시간은 아직 정하지 않았어요.";
  return { headline: stop.name, lines: [text], suggestions: [] };
}

function knownQuestionCard(message: string, stop: QuestionContextStop, state: AIPlannerState): AIChatCard | null {
  const scheduled = scheduleQuestionCard(message, stop);
  if (scheduled) return scheduled;
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
  const numbers = [...message.matchAll(/(?<!\d)(\d+)\s*번/g)].map(match => Number(match[1]) - 1);
  const ordinals = [/첫\s*(?:번째|째)|처음\s*(?:장소|곳|거|코스)/, /두\s*(?:번째|째)/, /세\s*(?:번째|째)/, /네\s*(?:번째|째)/, /다섯\s*번째/];
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
  const categories = [
    { mentioned: /식당|밥집|레스토랑/.test(message), pattern: /음식|식당|한식|일식|중식|양식|맛집/ },
    { mentioned: /카페/.test(message), pattern: /카페|디저트|커피/ },
    { mentioned: /공연장/.test(message), pattern: /공연|연극|뮤지컬/ },
  ].filter(category => category.mentioned);
  const matching = stops.filter(stop => categories.some(category => category.pattern.test(stop.meta)
    && (category.pattern.source !== "카페|디저트|커피" || !/보드|만화|방탈출/.test(stop.meta + stop.name))));
  return { stops: matching, invalid: false, explicit: categories.length > 0 };
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
    const scheduled = scheduleQuestionCard(message, focus);
    if (scheduled) return scheduled;
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
  const visible = input.shownStops?.length && !/코스|일정/.test(input.message) && !scheduleQuestion(input.message) ? input.shownStops : input.stops;
  const identity = (stop: QuestionContextStop) => [stop.name, stop.address ?? "", stop.mapUrl ?? ""].join("\u001f");
  const visibleIdentities = new Set(visible.map(identity));
  // Distinct branches may share a display name. Keep their facts separate and
  // give the list currently visible to the user priority for pronoun references.
  const allStops = [...visible, ...input.stops, ...(input.shownStops ?? [])]
    .filter((stop, index, all) => all.findIndex(other => identity(other) === identity(stop)) === index);
  let resolved = resolveQuestionFocus(input.message, visible);
  if (!resolved.explicit) {
    const named = resolveQuestionFocus(input.message, allStops);
    if (named.explicit) resolved = named;
  }
  if (!resolved.invalid && resolved.stops.length !== 1 && /거기|그곳|그\s*카페|그\s*식당|그\s*장소/.test(input.message)) {
    for (const turn of [...(input.conversation ?? [])].reverse()) {
      if (turn.text === input.message) continue;
      // Assistant turns can introduce the focus, but their longer lists do
      // not select one venue. Resolve names across both lists and ordinals
      // against the list currently shown to the user.
      const names = allStops.filter(stop => turn.text.replace(/\s/g, "").includes(stop.name.replace(/\s/g, "")));
      const exactNames = names.filter(stop => !names.some(other => other !== stop
        && other.name.replace(/\s/g, "") !== stop.name.replace(/\s/g, "")
        && other.name.replace(/\s/g, "").includes(stop.name.replace(/\s/g, ""))));
      const currentlyShown = exactNames.filter(stop => visibleIdentities.has(identity(stop)));
      const referenced = currentlyShown.length ? currentlyShown : exactNames;
      const previous = referenced.length === 1 ? { stops: referenced, explicit: true, invalid: false }
        : turn.role === "user" ? resolveQuestionFocus(turn.text, visible) : null;
      if (previous?.explicit && !previous.invalid && previous.stops.length === 1) { resolved = previous; break; }
    }
  }
  const comparison = /비교|차이|둘\s*중|두\s*(?:곳|장소|카페|식당)|어느|어디가|뭐가/.test(input.message);
  const allVisible = /후보들|이\s*장소들|각\s*(?:장소|카페|식당)|모두|전부/.test(input.message);
  const focus = resolved.stops.length ? resolved.stops
    : !resolved.explicit && (visible.length === 1 || comparison || allVisible) ? visible : [];
  if (!resolved.explicit && /코스|일정/.test(input.message) && scheduleQuestion(input.message) === "start" && input.stops.length) {
    return scheduleQuestionCard(input.message, input.stops[0])!;
  }
  const fallback = (): AIChatCard => {
    if (focus.length > 1 && (comparison || allVisible)) {
      const menu = /메뉴|시그니처|대표/.test(input.message);
      const hours = /영업|휴무|몇\s*시|언제|브레이크/.test(input.message);
      const other = /주차|예약|웨이팅|가격|얼마|비싸|저렴|애견|반려|휠체어|콜키지/.test(input.message);
      return {
        headline: "장소 비교",
        lines: focus.map(stop => {
          const fact = menu && !hours && !other ? stop.dishes : hours && !menu && !other ? stop.openingHours : undefined;
          return fact ? `${stop.name}: ${fact}예요. 방문 전 최신 정보를 확인해 주세요.`
            : `${stop.name}: 질문하신 정보를 아직 확인하지 못했어요.`;
        }),
        suggestions: [],
      };
    }
    return fallbackQuestionCard(input.message, visible, input.state, focus.length === 1 ? focus[0] : undefined);
  };
  if (resolved.invalid || (resolved.explicit && !focus.length) || (NEEDS_LOOKUP.test(input.message) && focus.length !== 1 && !comparison && !allVisible)) {
    return { headline: "어느 장소가 궁금하세요?", lines: [resolved.invalid ? "말씀하신 번호에 해당하는 장소가 없어요. 표시된 번호나 장소 이름을 알려 주세요." : "장소 이름이나 번호를 알려 주시면 그곳에 대해 확인할게요."], suggestions: [] };
  }
  if (focus.length === 1) {
    const known = knownQuestionCard(input.message, focus[0], input.state);
    // Straight factual reads need no generative step. Reasons and advice do:
    // they must consider the goal, tastes and trade-offs across turns.
    if (known && (!isOpenAiConfigured() || !/왜|이유/.test(input.message))) return known;
  }
  if (!isOpenAiConfigured()) return fallback();
  const singleKnownFact = focus.length === 1 && Boolean(knownQuestionCard(input.message, focus[0], input.state));
  const lookup = NEEDS_LOOKUP.test(input.message) && focus.length > 0 && !singleKnownFact;
  const payload = {
    latestMessage: input.message.slice(0, 2000),
    recentTurns: (input.conversation ?? []).slice(-12),
    brief: {
      objective: input.state.objective,
      preferences: input.state.preferences,
      inferredPreferences: input.state.inferredPreferences,
      excludedFoods: input.state.excludedFoods,
      areas: selectedAreas(input.state),
      activities: input.state.activities,
      stayKind: input.state.stayKind,
      timeWindow: input.state.timeWindow,
      cuisine: input.state.cuisine,
      dateLabel: input.state.dateLabel,
      notes: input.state.conversationNotes.slice(-8),
    },
    focusStops: focus,
    currentCourse: input.stops,
    lastShownPlaces: input.shownStops ?? [],
    couple: input.coupleTaste,
  };
  const defaultChips = input.stops.length ? ["카페 변경 해줘", "한 곳 더 추가해줘"] : ["코스 짜줘", "다른 곳 더 보여줘"];
  try {
    if (lookup) {
      let searchedSources: string[] = [];
      const searched = await completeJsonWithWebSearch<{ reply?: unknown; suggestions?: unknown; sourceUrl?: unknown; sourceUrls?: unknown }>({
        instructions: LOOKUP_PROMPT,
        payload,
        maxTokens: 1800,
        timeoutMs: input.lookupTimeoutMs ?? 40000,
        requireSearch: true,
        onSources: urls => { searchedSources = urls; },
      });
      const reply = cleanReply(searched?.reply);
      const sourceUrls = [...new Set((Array.isArray(searched?.sourceUrls) ? searched.sourceUrls : [searched?.sourceUrl])
        .filter((url): url is string => typeof url === "string").map(cleanSourceUrl).filter(Boolean))];
      const actualSources = new Set(searchedSources.map(cleanSourceUrl).filter(Boolean));
      const citedBySearch = sourceUrls.length > 0 && sourceUrls.every(url => actualSources.has(url));
      if (reply && reply.length <= REPLY_MAX_CHARS && looksPolite(reply) && !claimsUnperformedAction(reply, true, allStops.length > 0) && citedBySearch) {
        return {
          headline: focus.length === 1 ? focus[0].name : "장소 비교",
          lines: reply.split(/\n\s*\n/).filter(Boolean),
          sources: sourceUrls.slice(0, 8).map(url => ({ label: sourceLabel(url), url })),
          suggestions: cleanChatSuggestions(searched?.suggestions, defaultChips),
        };
      }
      return fallback();
    }
    const parsed = await completeJson<{ reply?: unknown; suggestions?: unknown }>({
      jsonSchema: { name: "date_question_reply_v2", strict: true, schema: dateChatReplySchema },
      temperature: 0.5,
      maxTokens: 1500,
      reasoningEffort: "medium",
      timeoutMs: 30000,
      messages: [
        { role: "system", content: QUESTION_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });
    const reply = cleanReply(parsed?.reply);
    if (!reply || reply.length > REPLY_MAX_CHARS || !looksPolite(reply) || claimsUnperformedAction(reply, false, allStops.length > 0)) return fallback();
    return {
      headline: focus.length === 1 ? focus[0].name : "",
      lines: reply.split(/\n\s*\n/).filter(Boolean),
      suggestions: cleanChatSuggestions(parsed?.suggestions, defaultChips),
    };
  } catch {
    return fallback();
  }
}

import type { AIChatCard, AIPlannerState, DateChatTurn, DateIntakeSlot } from "@/features/planning/types/plan";
import { DATE_AREA_OPTIONS, selectedAreas } from "@/features/ai/dateBrief";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";

export type DateChatSituation =
  | "need_area"
  | "no_places"
  | "greeting"
  | "thanks"
  | "capability"
  | "feedback"
  | "unclear"
  | "small_talk";

function lastNote(state: AIPlannerState) {
  return state.conversationNotes.at(-1) ?? "";
}

function isTravelVibe(text: string) {
  return /여행|떠나|놀러|어디\s*가|여행지/.test(text);
}

export function cardToText(card: AIChatCard) {
  return [card.headline, ...card.lines].filter(Boolean).join(" ");
}

export function dateChatCard(input: {
  situation: DateChatSituation;
  userMessage: string;
  state: AIPlannerState;
  extras?: { region?: string; suggestions?: string[]; currentCourse?: string[] };
}): AIChatCard {
  const region = input.extras?.region || selectedAreas(input.state).join(" · ");
  const nearby = input.extras?.suggestions?.slice(0, 4) ?? [];
  const travel = isTravelVibe(`${input.userMessage} ${lastNote(input.state)}`);
  const currentStops = (input.extras?.currentCourse ?? input.state.requiredPlaces).slice(0, 2);

  if (input.situation === "need_area") {
    return {
      headline: travel ? "어디로 떠날까요?" : "어디로 갈까요?",
      lines: travel
        ? ["도시나 동네만 말해 주세요."]
        : ["가고 싶은 동네를 말해 주세요."],
      suggestions: travel ? ["제주", "부산", "군산", "성수"] : [...DATE_AREA_OPTIONS].slice(0, 4),
    };
  }
  if (input.situation === "no_places") {
    return {
      headline: `${region || "그 근처"}에서 장소를 더 찾지 못했습니다`,
      lines: ["다른 동네로 바꾸거나, 카페나 식당만 다시 찾아 달라고 해 주세요."],
      suggestions: nearby.length ? nearby : ["제주", "부산", "전주", "성수"],
    };
  }
  if (input.situation === "greeting") {
    return {
      headline: "안녕하세요",
      lines: ["동네를 말해 주면 코스를 짜고, 식당이나 카페만 골라 달라고 해도 돼요. 예: 성수 파스타 맛집 추천해줘."],
      suggestions: ["성수 파스타 맛집 추천해줘", "을지로 저녁 데이트 코스 짜줘", "비 오는 날 홍대 실내 데이트"],
    };
  }
  if (input.situation === "thanks") {
    return {
      headline: "도움이 됐다니 다행이에요",
      lines: currentStops.length
        ? [`${currentStops.join(", ")}는 유지합니다. 바꿀 곳만 말해 주세요.`]
        : ["다음에도 가고 싶은 곳이나 궁금한 점을 편하게 말해 주세요."],
      suggestions: [],
    };
  }
  if (input.situation === "capability") {
    return {
      headline: "데이트 코스를 짭니다",
      lines: ["동네를 말하면 하루를 이어 드리고, 식당이나 카페만 추천해 달라고 해도 됩니다. 만든 뒤에는 카페 변경 해줘처럼 말로 고칠 수 있고, 주차나 예약 같은 질문도 답합니다."],
      suggestions: ["성수 파스타 맛집 추천해줘", "파스타 먹고 성수 걷고 싶어"],
    };
  }
  if (input.situation === "feedback") {
    const shownPlaces = input.state.shownPlaces ?? [];
    return {
      headline: "어떤 점이 아쉬웠나요?",
      lines: currentStops.length
        ? ["말씀해 주신 부분만 고치고 나머지 장소는 유지할게요. 장소 선택, 동선, 식사·카페 중 가장 아쉬운 점을 알려 주세요."]
        : shownPlaces.length ? ["추천 장소 중 무엇이 아쉬웠나요? 다른 후보나 원하는 분위기를 말해 주세요."]
          : ["원하신 데이트와 다른 부분을 알려 주세요. 장소, 분위기, 동선 중 무엇부터 바꿀까요?"],
      suggestions: currentStops.length ? ["장소를 다시 골라줘", "동선을 고쳐줘", "식당을 바꿔줘"]
        : shownPlaces.length ? ["다른 곳 더 보여줘", "카페 추천해줘"] : [],
    };
  }
  if (input.situation === "unclear") {
    return {
      headline: currentStops.length ? "무엇을 바꿔 드릴까요?" : "어떤 데이트를 원하세요?",
      lines: currentStops.length
        ? ["현재 코스는 그대로 두었어요. 바꿀 장소나 원하는 경험을 한 가지만 말해 주세요."]
        : ["동네와 하고 싶은 일 한 가지만 말해 주세요. 예: 성수에서 저녁 먹고 카페 가고 싶어."],
      suggestions: currentStops.length ? ["식당 바꿔줘", "카페 추천해줘", "한 곳 추가해줘"] : ["성수에서 저녁 데이트", "홍대 카페 추천해줘"],
    };
  }
  return {
    headline: region ? `${region} 기준으로 이어갑니다` : "어디로 갈까요?",
    lines: region
      ? ["추가하거나 빼고 싶은 곳만 말해 주세요."]
      : ["가고 싶은 동네를 말해 주세요."],
    suggestions: region ? ["카페 변경 해줘", "더 여유롭게", "다른 동네로"] : [...DATE_AREA_OPTIONS].slice(0, 4),
  };
}

export function chatSituationFromMessage(message: string): DateChatSituation | null {
  const text = message.trim();
  if (!text) return null;
  if (/^(안녕|안녕하세요|헬로|하이|hello|hi)[\s!?~]*$/i.test(text)) return "greeting";
  if (/^(?:고마워(?:요)?|감사(?:해요|합니다)?|땡큐|thanks?|thank you)[\s.!?~]*$/i.test(text)) return "thanks";
  if (/별로|마음에\s*안\s*들|아쉬워|대충|동선이\s*이상|추천이\s*이상|너무\s*(?:비싸|멀어|빡세|뻔해)|예산\s*초과/.test(text)
    && !/추천\s*해|찾아|골라|바꿔|변경|교체|추가|제외|빼|다시\s*짜|고쳐|수정/.test(text)) return "feedback";
  const capability = /(?:너는\s*누구|자기소개|뭐(?:를)?\s*할\s*수\s*있|어떻게\s*(?:쓰|사용)|도움말|기능\s*알려)/.test(text);
  const planning = /동네|카페|식당|맛집|데이트|여행|코스|짜|을지|성수|홍대|제주|부산|소개해/.test(text);
  if (capability && !planning && text.length <= 32) return "capability";
  // "네" and "응" may confirm the preceding assistant turn; let the context router decide.
  if (/^(?:ㅋ{2,}|ㅎ{2,}|🙂|😊)$/.test(text)) return "small_talk";
  return null;
}

export function fallbackDateChat(input: {
  situation: DateChatSituation;
  userMessage: string;
  state: AIPlannerState;
  extras?: { region?: string; suggestions?: string[]; currentCourse?: string[] };
}) {
  return cardToText(dateChatCard(input));
}

const CHAT_PROMPT = [
  "You are the couple's date planner inside the ONLY US app. Reply in polite Korean 해요체 only (~해요, ~드릴게요, ~볼까요). Never 반말 such as 안녕!, ~할게, ~어때. 1-3 sentences, no emoji, no bullet lists, no markdown.",
  "You can: build a date or trip course for a neighborhood, recommend restaurants/cafes/bars/exhibits in an area, answer questions about the places you suggested, and edit a course by chat (카페 변경 해줘, 한 곳 더 추가해줘, 한 곳 빼줘).",
  "If the user greets or asks what you do, answer briefly and invite them with one example request they could type (e.g. 성수 파스타 맛집 추천해줘) that fits their context (areas, currentCourse). If they thank you, acknowledge and offer the natural next step.",
  "You have not searched anything yet: never name a specific shop, cafe, restaurant, or exhibition unless it appears in currentCourse or shownPlaces.",
  "Read recentTurns and brief before replying. Answer the latest meaning, not a canned greeting. Do not ask for an area or preference already known. For feedback, acknowledge the specific problem they named; ask at most one focused question only if needed. For ambiguous replies, explain what needs clarifying in the existing conversation. Never claim a course was changed, a booking made, or a search completed: this turn does none of those actions. A thank-you may simply close the conversation with no follow-up question or chips.",
  "Then give up to 3 chips, each under 16 Korean characters, written as the user would type them (e.g. 성수 카페 추천해줘).",
  "Return JSON only: {\"reply\":string,\"suggestions\":[string]}",
].join(" ");

const LLM_CHAT_SITUATIONS = new Set<DateChatSituation>(["greeting", "thanks", "capability", "small_talk", "feedback", "unclear"]);

/** Small models drift into 반말; a reply that does not end politely falls back to the card. */
export function looksPolite(text: string) {
  const sentences = text.split(/(?<=[.!?~])\s+|\n+/).map(part => part.trim()).filter(Boolean);
  if (!sentences.length) return false;
  return sentences.every(sentence => /(?:요|니다|세요|까요|게요|죠|시죠|십니까|나요|어요|에요)[.!?~]*$/.test(sentence));
}

function claimsActionAlreadyTaken(text: string) {
  return /(?:바꿨|변경했|추가했|삭제했|예약했|결제했|저장했|담았|검색했|찾았|추천해\s*드렸)어요/.test(text);
}

export async function composeDateChat(input: {
  situation: DateChatSituation;
  userMessage: string;
  state: AIPlannerState;
  extras?: { region?: string; suggestions?: string[]; currentCourse?: string[]; conversation?: DateChatTurn[] };
  slot?: DateIntakeSlot | null;
}): Promise<AIChatCard> {
  const card = dateChatCard(input);
  if (!LLM_CHAT_SITUATIONS.has(input.situation) || !isOpenAiConfigured()) return card;
  try {
    const parsed = await completeJson<{ reply?: unknown; suggestions?: unknown }>({
      temperature: 0.6,
      maxTokens: 400,
      reasoningEffort: "low",
      timeoutMs: 15000,
      messages: [
        { role: "system", content: CHAT_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            latestMessage: input.userMessage.slice(0, 300),
            situation: input.situation,
            recentTurns: (input.extras?.conversation ?? []).slice(-6),
            areas: selectedAreas(input.state),
            brief: { activities: input.state.activities, cuisine: input.state.cuisine, budgetWon: input.state.budgetWon, walkingPreference: input.state.walkingPreference, notes: input.state.conversationNotes.slice(-4) },
            currentCourse: (input.extras?.currentCourse ?? []).slice(0, 6),
            shownPlaces: (input.state.shownPlaces ?? []).slice(0, 6),
          }),
        },
      ],
    });
    const reply = typeof parsed?.reply === "string" ? parsed.reply.replace(/[*_`#]/g, "").trim().slice(0, 400) : "";
    if (!reply || !looksPolite(reply) || claimsActionAlreadyTaken(reply)) return card;
    const suggestions = Array.isArray(parsed?.suggestions)
      ? [...new Set(parsed.suggestions.map(item => String(item ?? "").replace(/[.!?]\s*$/, "").trim()).filter(item => item && item.length <= 18))].slice(0, 3)
      : [];
    const safeSuggestions = input.situation === "feedback" || input.situation === "unclear" || input.situation === "thanks"
      ? card.suggestions : Array.isArray(parsed?.suggestions) ? suggestions : card.suggestions;
    return { headline: "", lines: reply.split(/\n\s*\n/).filter(Boolean), suggestions: safeSuggestions };
  } catch {
    return card;
  }
}

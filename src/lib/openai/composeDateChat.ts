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
  extras?: { region?: string; suggestions?: string[] };
}): AIChatCard {
  const region = input.extras?.region || selectedAreas(input.state).join(" · ");
  const nearby = input.extras?.suggestions?.slice(0, 4) ?? [];
  const travel = isTravelVibe(`${input.userMessage} ${lastNote(input.state)}`);
  const currentStops = input.state.requiredPlaces.slice(0, 2);

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
      headline: "알겠습니다",
      lines: currentStops.length
        ? [`${currentStops.join(", ")}는 유지합니다. 바꿀 곳만 말해 주세요.`]
        : ["일정에 담거나, 바꿀 곳만 이어서 말해 주세요."],
      suggestions: currentStops.length ? ["카페 변경 해줘", "더 여유롭게", "한 곳 빼줘"] : ["카페 변경 해줘", "더 여유롭게", "다른 동네로"],
    };
  }
  if (input.situation === "capability") {
    return {
      headline: "데이트 코스를 짭니다",
      lines: ["동네를 말하면 하루를 이어 드리고, 식당이나 카페만 추천해 달라고 해도 됩니다. 만든 뒤에는 카페 변경 해줘처럼 말로 고칠 수 있고, 주차나 예약 같은 질문도 답합니다."],
      suggestions: ["성수 파스타 맛집 추천해줘", "파스타 먹고 성수 걷고 싶어"],
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
  if (/고마워|감사|땡큐|thank/i.test(text) && !/빼|추가|바꿔|변경|말고|다시|코스|짜/.test(text)) return "thanks";
  const capability = /(?:너는\s*누구|자기소개|뭐(?:를)?\s*할\s*수\s*있|어떻게\s*(?:쓰|사용)|도움말|기능\s*알려)/.test(text);
  const planning = /동네|카페|식당|맛집|데이트|여행|코스|짜|을지|성수|홍대|제주|부산|소개해/.test(text);
  if (capability && !planning && text.length <= 32) return "capability";
  if (text.length <= 2 && !/[가-힣A-Za-z]{2,}/.test(text)) return "small_talk";
  return null;
}

export function fallbackDateChat(input: {
  situation: DateChatSituation;
  userMessage: string;
  state: AIPlannerState;
  extras?: { region?: string; suggestions?: string[] };
}) {
  return cardToText(dateChatCard(input));
}

const CHAT_PROMPT = [
  "You are the couple's date planner inside the ONLY US app. Reply in polite Korean 해요체 only (~해요, ~드릴게요, ~볼까요). Never 반말 such as 안녕!, ~할게, ~어때. 1-3 sentences, no emoji, no bullet lists, no markdown.",
  "You can: build a date or trip course for a neighborhood, recommend restaurants/cafes/bars/exhibits in an area, answer questions about the places you suggested, and edit a course by chat (카페 변경 해줘, 한 곳 더 추가해줘, 한 곳 빼줘).",
  "If the user greets or asks what you do, answer briefly and invite them with one example request they could type (e.g. 성수 파스타 맛집 추천해줘) that fits their context (areas, currentCourse). If they thank you, acknowledge and offer the natural next step.",
  "You have not searched anything yet: never name a specific shop, cafe, restaurant, or exhibition unless it appears in currentCourse or shownPlaces.",
  "Then give up to 3 chips, each under 16 Korean characters, written as the user would type them (e.g. 성수 카페 추천해줘).",
  "Return JSON only: {\"reply\":string,\"suggestions\":[string]}",
].join(" ");

const LLM_CHAT_SITUATIONS = new Set<DateChatSituation>(["greeting", "thanks", "capability", "small_talk"]);

/** Small models drift into 반말; a reply that does not end politely falls back to the card. */
export function looksPolite(text: string) {
  const sentences = text.split(/(?<=[.!?~])\s+|\n+/).map(part => part.trim()).filter(Boolean);
  if (!sentences.length) return false;
  return sentences.every(sentence => /(?:요|니다|세요|까요|게요|죠|시죠|십니까|나요|어요|에요)[.!?~]*$/.test(sentence));
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
            currentCourse: (input.extras?.currentCourse ?? []).slice(0, 6),
            shownPlaces: (input.state.shownPlaces ?? []).slice(0, 6),
          }),
        },
      ],
    });
    const reply = String(parsed?.reply ?? "").replace(/[*_`#]/g, "").trim().slice(0, 400);
    if (!reply || !looksPolite(reply)) return card;
    const suggestions = Array.isArray(parsed?.suggestions)
      ? [...new Set(parsed.suggestions.map(item => String(item ?? "").replace(/[.!?]\s*$/, "").trim()).filter(item => item && item.length <= 18))].slice(0, 3)
      : [];
    return { headline: "", lines: [reply], suggestions: suggestions.length ? suggestions : card.suggestions };
  } catch {
    return card;
  }
}

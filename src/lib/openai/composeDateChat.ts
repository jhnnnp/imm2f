import type { AIChatCard, AIPlannerState, DateIntakeSlot } from "@/features/planning/types/plan";
import { DATE_AREA_OPTIONS, selectedAreas } from "@/features/ai/dateBrief";

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
      lines: ["가고 싶은 동네를 말해 주세요. 예: 을지로에서 오후부터 데이트하고 싶어."],
      suggestions: ["성수에서 데이트하고 싶어", "제주에서 하루 보내고 싶어", "비 오는 날 실내 데이트"],
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
      lines: ["동네를 말하면 하루를 이어 드립니다. 만든 뒤에는 카페 변경 해줘처럼 말로 고칠 수 있습니다."],
      suggestions: ["성수에서 데이트하고 싶어", "파스타 먹고 성수 걷고 싶어"],
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

export async function composeDateChat(input: {
  situation: DateChatSituation;
  userMessage: string;
  state: AIPlannerState;
  extras?: { region?: string; suggestions?: string[] };
  slot?: DateIntakeSlot | null;
}) {
  return dateChatCard(input);
}

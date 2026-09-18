import type { AIPlannerState, DateChatTurn, PlaceAskKind } from "@/features/planning/types/plan";
import { detectPlaceKind, placeQueryFromMessage, routeDateChatLocally, type ChatMode, type ChatRoute } from "@/features/ai/chatRoute";
import { extractAreasFromText, selectedAreas, uniqueStrings } from "@/features/ai/dateBrief";
import { chatSituationFromMessage } from "./composeDateChat";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";

type RouterPayload = {
  mode?: string;
  area?: string | null;
  placeKind?: string | null;
  query?: string | null;
  pickedPlaces?: string[];
};

const MODES = new Set<ChatMode>(["course", "places", "question", "chat"]);
const KINDS = new Set<PlaceAskKind>(["restaurant", "cafe", "bar", "dessert", "exhibit", "activity", "spot"]);

const ROUTER_PROMPT = [
  "You triage one turn of a Korean couple-date chat. Decide what the user wants right now. Return JSON only.",
  '{"mode":"course|places|question|chat","area":null,"placeKind":null,"query":null,"pickedPlaces":[]}',
  "course: they want a whole date/trip itinerary built, rebuilt, or edited (add/swap/drop a stop, change pace, different course).",
  "places: they want a list of specific venues of one kind (restaurants, cafes, bars, dessert, exhibitions, activities, spots) — recommend/알려줘/어디가 좋아/먹을 데. Not a full day.",
  "question: they ask about the current course, a listed place, logistics (주차, 예약, 웨이팅, 영업시간, 예산, 거리, 비 오면), or want advice/comparison.",
  "chat: greeting, thanks, small talk, asking what you can do.",
  "area: only a city or neighborhood written in latestMessage, else null. placeKind: restaurant|cafe|bar|dessert|exhibit|activity|spot or null.",
  "query: the dish/cuisine/vibe words the user used for a places request (파스타, 한식, 와인, 조용한), else null.",
  "pickedPlaces: names from shownPlaces the user is choosing (by name or 1번/2번), else [].",
  "When currentCourse is non-empty and the message edits it, mode is course. When shownPlaces is non-empty and the message asks for more of the same, mode is places.",
].join(" ");

/**
 * LLM-assisted intent routing. The local rules decide clear cases on their
 * own; the model only breaks ties, and its answer is checked against the
 * message so a hallucinated area or mode can not leak into the plan.
 */
export async function routeDateChat(input: {
  message: string;
  state?: AIPlannerState;
  hasCourse: boolean;
  currentCourse: string[];
  conversation?: DateChatTurn[];
}): Promise<ChatRoute> {
  const local = routeDateChatLocally({
    message: input.message,
    state: input.state,
    hasCourse: input.hasCourse,
    chatSituation: chatSituationFromMessage(input.message),
  });
  if (local.confident || !isOpenAiConfigured()) return local;
  try {
    const parsed = await completeJson<RouterPayload>({
      temperature: 0,
      maxTokens: 300,
      reasoningEffort: "low",
      timeoutMs: 12000,
      messages: [
        { role: "system", content: ROUTER_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            latestMessage: input.message,
            recentTurns: (input.conversation ?? []).slice(-6),
            currentCourse: input.currentCourse.slice(0, 8),
            shownPlaces: input.state?.shownPlaces ?? [],
            knownAreas: input.state ? selectedAreas(input.state) : [],
          }),
        },
      ],
    });
    if (!parsed) return local;
    const mode = MODES.has(parsed.mode as ChatMode) ? parsed.mode as ChatMode : local.mode;
    if (mode === "places") {
      const kind = KINDS.has(parsed.placeKind as PlaceAskKind)
        ? parsed.placeKind as PlaceAskKind
        : detectPlaceKind(input.message) ?? input.state?.placeAsk?.kind ?? "spot";
      const written = extractAreasFromText(input.message);
      const area = written[0] || (parsed.area && input.message.includes(parsed.area) ? parsed.area : "");
      const fallbackArea = area || input.state?.placeAsk?.area || (input.state ? selectedAreas(input.state)[0] : "") || "";
      const query = String(parsed.query ?? "").trim();
      return {
        mode,
        confident: true,
        placeAsk: {
          kind,
          query: query && input.message.includes(query) ? query : placeQueryFromMessage(input.message, kind),
          area: fallbackArea,
        },
      };
    }
    if (mode === "course") {
      const shown = input.state?.shownPlaces ?? [];
      const picked = uniqueStrings((parsed.pickedPlaces ?? []).filter(name => shown.includes(name)), 4);
      return { mode, confident: true, pickedPlaces: picked.length ? picked : local.pickedPlaces };
    }
    return { mode, confident: true };
  } catch {
    return local;
  }
}

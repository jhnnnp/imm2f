import type { AIPlannerState, DateChatTurn, PlaceAskKind } from "@/features/planning/types/plan";
import { detectPlaceKind, placeQueryFromMessage, routeDateChatLocally, type ChatMode, type ChatRoute } from "@/features/ai/chatRoute";
import { extractAreasFromText, selectedAreas, uniqueStrings } from "@/features/ai/dateBrief";
import { chatSituationFromMessage } from "./composeDateChat";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";

type RouterPayload = {
  edit?: { kind?: string; indices?: unknown };
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
  '{"mode":"course|places|question|chat","area":null,"placeKind":null,"query":null,"pickedPlaces":[],"edit":null}',
  "course: they want a whole date/trip itinerary built, rebuilt, or edited (add/swap/drop a stop, change pace, different course).",
  "places: they want a list of specific venues of one kind (restaurants, cafes, bars, dessert, exhibitions, activities, spots) — recommend/알려줘/어디가 좋아/먹을 데. Not a full day.",
  "question: they ask about the current course, a listed place, logistics (주차, 예약, 웨이팅, 영업시간, 예산, 거리, 비 오면), or want advice/comparison.",
  "chat: greeting, thanks, small talk, asking what you can do.",
  "area: only a city or neighborhood written in latestMessage, else null. placeKind: restaurant|cafe|bar|dessert|exhibit|activity|spot or null.",
  "query: the dish/cuisine/vibe words the user used for a places request (파스타, 한식, 와인, 조용한), else null.",
  "pickedPlaces: names from shownPlaces the user is choosing (by name or 1번/2번), else [].",
  "When currentCourse is non-empty and the message edits it, mode is course. When shownPlaces is non-empty and the message asks for more of the same, mode is places.",
  "An actual instruction outranks greetings, thanks, question marks, and complaints. '왜 6시부터야? 2시부터 7시까지 시간만 고쳐줘' is course, never question. '고마워, 카페도 추천해줘' is places.",
  "For edits that require NO new venue, return edit: {kind:'retime'|'remove'|'reorder',indices:[]}. retime changes only hours/durations/pace and preserves every place; remove indices are the exact 1-based currentCourse positions to remove; reorder indices are ALL currentCourse positions in the requested new order. Resolve ordinal and category references from currentCourse. For a swap, addition or fresh course, edit is null. Never remove extra stops. Never remove every stop without an explicit request.",
  "Consult recentTurns. A brief area answer resumes pendingPlaceAsk. '거기 말고 다른 데', '응 그렇게 해줘', '카페는 마지막에' refer to previous answers. A place comparison or parking question does not edit a course. If an edit target cannot be determined, mode question so the assistant asks which place.",
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
  currentCategories?: string[];
  conversation?: DateChatTurn[];
}): Promise<ChatRoute> {
  const local = routeDateChatLocally({
    message: input.message,
    state: input.state,
    hasCourse: input.hasCourse,
    chatSituation: chatSituationFromMessage(input.message),
  });
  if (!isOpenAiConfigured()) return local;
  try {
    const parsed = await completeJson<RouterPayload>({
      temperature: 0,
      maxTokens: 700,
      reasoningEffort: "low",
      timeoutMs: 12000,
      messages: [
        { role: "system", content: ROUTER_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            latestMessage: input.message,
            recentTurns: (input.conversation ?? []).slice(-6),
            currentCourse: input.currentCourse.slice(0, 12).map((name, index) => ({ index: index + 1, name, category: input.currentCategories?.[index] })),
            pendingPlaceAsk: input.state?.placeAsk,
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
          query: query && `${input.message} ${input.state?.placeAsk?.query ?? ""}`.includes(query) ? query : local.placeAsk?.query || placeQueryFromMessage(input.message, kind),
          area: fallbackArea,
        },
      };
    }
    if (mode === "course") {
      const shown = input.state?.shownPlaces ?? [];
      const picked = uniqueStrings((Array.isArray(parsed.pickedPlaces) ? parsed.pickedPlaces : []).filter(name => shown.includes(name)), 4);
      const indices = Array.isArray(parsed.edit?.indices) ? [...new Set(parsed.edit.indices.filter((n): n is number => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= input.currentCourse.length))] : [];
      const kind = parsed.edit?.kind;
      const edit = input.hasCourse && (kind === "retime" || (kind === "remove" && indices.length > 0) || (kind === "reorder" && indices.length === input.currentCourse.length))
        ? { kind, indices } as NonNullable<ChatRoute["edit"]> : undefined;
      return { mode, confident: true, pickedPlaces: picked.length ? picked : local.pickedPlaces, edit };
    }
    return { mode, confident: true };
  } catch {
    return local;
  }
}

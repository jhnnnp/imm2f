import type { AIPlannerState } from "@/features/planning/types/plan";
import { getOpenAiApiKey, getOpenAiModel, isOpenAiConfigured } from "./env";

type IntentPayload = Partial<AIPlannerState> & {
  addPlaces?: string[];
  removePlaces?: string[];
  replaceRegion?: string;
  clarifyingQuestion?: string;
  conversationNote?: string;
  shouldGenerate?: boolean;
};

const EMPTY_STATE: AIPlannerState = {
  region: "",
  regions: [],
  requiredPlaces: [],
  excludedPlaces: [],
  preferredCategories: [],
  avoidedCategories: [],
  pace: "balanced",
  preserveExistingPlaces: true,
  intent: "create",
  pendingQuestion: null,
  conversationNotes: [],
};

function strings(value: unknown, max = 8) {
  return Array.isArray(value)
    ? [...new Set(value.map(item => String(item).trim()).filter(Boolean))].slice(0, max)
    : [];
}

function fallbackPatch(message: string, previous?: AIPlannerState): IntentPayload {
  const placeTerms = [...message.matchAll(/([가-힣A-Za-z0-9]{2,18}?(?:공원|미술관|박물관|전시관|시장|식당|카페|역))(?=\s|에서|으로|가고|들(?:러|렀)|빼|제외|도|$)/g)].map(match => match[1]);
  const removing = /빼|제외|삭제|가지\s*마/.test(message);
  const explicitAdd = /들러|경유|가고\s*싶|포함|추가|넣어/.test(message);
  const addedPlaces = explicitAdd ? placeTerms : placeTerms.filter(place => !place.endsWith("역"));
  const categories = ["카페", "맛집", "음식점", "전시", "산책", "공원", "야경"].filter(category => message.includes(category));
  if (/저녁|점심|아침|식사|밥/.test(message) && !categories.includes("음식점")) categories.push("음식점");
  for (const cuisine of ["한식", "일식", "중식", "양식"]) {
    if (message.includes(cuisine) && !categories.includes(cuisine)) categories.push(cuisine);
  }
  if (/놀거리|놀고|놀러|방탈출|볼링|보드게임|오락실|만화카페|VR|게임/.test(message) && !categories.includes("실내 놀거리")) categories.push("실내 놀거리");
  const regionOnly = !previous && placeTerms.length <= 1 && categories.length === 0
    && /(?:역|동|구|시)(?:\s*(?:근처|주변))?\s*$/.test(message.trim());
  const hasBridgeActivity = /카페|커피|디저트|저녁|점심|아침|식사|밥|산책|전시|영화|공연/.test(message);
  const addsSeveralWaypoints = Boolean(previous) && addedPlaces.length >= 2 && !hasBridgeActivity;
  const clarifyingQuestion = regionOnly
    ? `${placeTerms[0] ?? "그 지역"}에서 카페, 식사, 산책 중 어떤 데이트를 하고 싶나요?`
    : addsSeveralWaypoints
      ? `${addedPlaces.at(-1)}에는 카페나 저녁 식사 후에 갈까요, 아니면 바로 이동할까요?`
      : undefined;
  return {
    intent: removing ? "remove" : "modify",
    addPlaces: removing ? [] : addedPlaces,
    removePlaces: removing ? placeTerms : [],
    preferredCategories: /빼|제외/.test(message) ? [] : categories,
    avoidedCategories: /빼|제외/.test(message) ? categories : [],
    pace: /여유|천천히|오래/.test(message) ? "relaxed" : /많이|알차게|활동/.test(message) ? "active" : "balanced",
    preserveExistingPlaces: !/처음부터|새로|전부\s*바꿔|리셋/.test(message),
    clarifyingQuestion,
    shouldGenerate: !clarifyingQuestion,
    conversationNote: message,
  };
}

function mergeState(previous: AIPlannerState | undefined, patch: IntentPayload, fallbackRegion: string): AIPlannerState {
  const base = previous ?? EMPTY_STATE;
  const intent = ["create", "modify", "remove", "reset", "clarify"].includes(String(patch.intent))
    ? patch.intent as AIPlannerState["intent"]
    : previous ? "modify" : "create";
  const reset = intent === "reset" || patch.preserveExistingPlaces === false;
  const add = strings(patch.addPlaces);
  const remove = strings(patch.removePlaces);
  const required = [...new Set([...(reset ? [] : base.requiredPlaces), ...add])].filter(name => !remove.includes(name));
  const excluded = [...new Set([...(reset ? [] : base.excludedPlaces), ...remove])].filter(name => !add.includes(name));
  const region = [patch.replaceRegion, reset || !previous ? patch.region : "", reset || !previous ? fallbackRegion : "", base.region]
    .map(value => typeof value === "string" ? value.trim() : "")
    .find(Boolean) ?? "";
  return {
    region,
    regions: strings(patch.regions).length
      ? [...new Set([...(reset ? [] : base.regions), ...strings(patch.regions)])].slice(0, 3)
      : base.regions.length ? base.regions : region ? [region] : [],
    requiredPlaces: required,
    excludedPlaces: excluded,
    preferredCategories: [...new Set([...(reset ? [] : base.preferredCategories), ...strings(patch.preferredCategories)])].filter(item => !strings(patch.avoidedCategories).includes(item)),
    avoidedCategories: [...new Set([...(reset ? [] : base.avoidedCategories), ...strings(patch.avoidedCategories)])].filter(item => !strings(patch.preferredCategories).includes(item)),
    pace: patch.pace === "relaxed" || patch.pace === "active" ? patch.pace : base.pace,
    preserveExistingPlaces: patch.preserveExistingPlaces !== false,
    intent,
    pendingQuestion: String(patch.clarifyingQuestion ?? "").trim() || null,
    conversationNotes: [...(reset ? [] : base.conversationNotes), String(patch.conversationNote ?? "").trim()].filter(Boolean).slice(-12),
  };
}

export async function interpretDateRequest(input: {
  message: string;
  fallbackRegion: string;
  previousState?: AIPlannerState;
  previousPlaceNames: string[];
}) {
  const localPatch = fallbackPatch(input.message, input.previousState);
  const toResult = (patch: IntentPayload) => {
    const question = String(patch.clarifyingQuestion ?? localPatch.clarifyingQuestion ?? "").trim();
    const answeredPendingQuestion = Boolean(input.previousState?.pendingQuestion) && !localPatch.clarifyingQuestion;
    const normalizedPatch = {
      ...patch,
      addPlaces: [...new Set([...strings(patch.addPlaces), ...strings(localPatch.addPlaces)])],
      removePlaces: [...new Set([...strings(patch.removePlaces), ...strings(localPatch.removePlaces)])],
      preferredCategories: [...new Set([...strings(patch.preferredCategories), ...strings(localPatch.preferredCategories)])],
      avoidedCategories: [...new Set([...strings(patch.avoidedCategories), ...strings(localPatch.avoidedCategories)])],
      conversationNote: patch.conversationNote || input.message,
      clarifyingQuestion: answeredPendingQuestion ? "" : question,
    };
    return {
      state: mergeState(input.previousState, normalizedPatch, input.fallbackRegion),
      clarifyingQuestion: answeredPendingQuestion ? "" : question,
    };
  };
  const fallback = () => toResult(localPatch);
  if (!isOpenAiConfigured()) return fallback();
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${getOpenAiApiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOpenAiModel(),
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Extract ONLY the change expressed by the latest Korean date-planning message.",
              "Do not restate unchanged previous state in addPlaces or removePlaces.",
              "A directly named station, park, museum, market, restaurant, or cafe is a place constraint.",
              "A station used only with 'near/around' describes the search region, not addPlaces. A station with 'stop by/via/include/add' belongs in addPlaces.",
              "Map meal/dinner/lunch/food requests to preferredCategories=['음식점']; coffee/dessert requests to ['카페']; walking/outdoors to ['공원'].",
              "Words like add/stop by/go to mean addPlaces. Words like remove/exclude mean removePlaces.",
              "If the user asks to start over, intent=reset and preserveExistingPlaces=false.",
              "Do not generate a plan when an important choice is ambiguous. Ask exactly one short Korean follow-up question instead.",
              "Examples that require clarification: a region without an activity; adding several waypoints without saying what should happen before or between them.",
              "If the latest message answers the previous pending question, incorporate that answer and set clarifyingQuestion to an empty string.",
              "Different neighborhoods may be combined in one date. Extract every explicitly named neighborhood or station into regions instead of replacing the first region.",
              "Return JSON with intent(create|modify|remove|reset|clarify), replaceRegion, regions, addPlaces, removePlaces, preferredCategories, avoidedCategories, pace(relaxed|balanced|active), preserveExistingPlaces, clarifyingQuestion, shouldGenerate, conversationNote.",
            ].join(" "),
          },
          { role: "user", content: JSON.stringify({ previousState: input.previousState ?? EMPTY_STATE, pendingQuestion: input.previousState?.pendingQuestion, currentPlaces: input.previousPlaceNames, latestMessage: input.message }) },
        ],
      }),
    });
    if (!response.ok) return fallback();
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const patch = JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as IntentPayload;
    return toResult(patch);
  } catch {
    return fallback();
  }
}

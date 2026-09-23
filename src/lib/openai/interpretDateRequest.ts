import type { AIPlannerState, DateAreaScope, DateChatTurn, DateCuisineChoice, DateIntakeSlot, DateStayKind, DateTimeWindow } from "@/features/planning/types/plan";
import {
  asAreaScope,
  asCuisineChoice,
  asTimeWindow,
  canonicalizeArea,
  DATE_LANDMARKS,
  emptyDateBrief,
  extractActivitiesFromText,
  extractAreaScope,
  extractAreasFromText,
  extractCuisine,
  extractIndoorPlay,
  extractPlacesFromText,
  extractStay,
  extractTimeWindow,
  groundedAreas,
  groundedActivities,
  isDateActivityId,
  missingSlot,
  uniqueActivities,
  uniqueStrings,
  withAreas,
  withTimeWindow,
} from "@/features/ai/dateBrief";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";
import { chatSituationFromMessage } from "./composeDateChat";
import { explicitDateConstraints } from "@/features/ai/dateConstraints";

export type IntentPayload = {
  intent?: AIPlannerState["intent"];
  addActivities?: string[];
  removeActivities?: string[];
  addAreas?: string[];
  removeAreas?: string[];
  addPlaces?: string[];
  removePlaces?: string[];
  cuisine?: DateCuisineChoice | null;
  indoorPlay?: string | null;
  areaScope?: DateAreaScope | null;
  timeWindow?: DateTimeWindow | null;
  stayKind?: DateStayKind | null;
  nights?: number | null;
  pace?: AIPlannerState["pace"] | null;
  startTime?: string | null;
  endTime?: string | null;
  preserveExistingPlaces?: boolean;
    conversationNote?: string;
  addStop?: boolean;
  askSlot?: DateIntakeSlot | null;
  reply?: string;
};

function asQuestionSlot(value: unknown): DateIntakeSlot | null {
  return value === "area" ? value : null;
}

function asTime(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(raw)) return null;
  const [hour, minute] = raw.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function fallbackPatch(message: string): IntentPayload {
  const removing = /빼|제외|삭제|가지\s*마/.test(message);
  const named = extractActivitiesFromText(message);
  const areas = extractAreasFromText(message);
  const places = extractPlacesFromText(message);
  const adding = /들러|경유|가고\s*싶|포함|추가|넣어|갈\s*수|있나/.test(message);
  const stay = extractStay(message);
  const timeWindow = extractTimeWindow(message);
  return {
    intent: removing ? "remove" : adding ? "modify" : /처음부터|새로|전부\s*바꿔|리셋/.test(message) ? "reset" : undefined,
    addActivities: removing ? [] : named,
    removeActivities: removing ? named : [],
    addAreas: areas,
    addPlaces: removing ? [] : places,
    removePlaces: removing ? places : [],
    cuisine: extractCuisine(message),
    indoorPlay: extractIndoorPlay(message),
    areaScope: extractAreaScope(message),
    timeWindow,
    stayKind: stay?.stayKind ?? null,
    nights: stay?.nights ?? null,
    pace: /여유|천천히|오래/.test(message) ? "relaxed" : /많이|알차게|활동/.test(message) ? "active" : null,
    preserveExistingPlaces: !/처음부터|새로|전부\s*바꿔|리셋|조금\s*다르게|다른\s*(?:코스|일정)|다시\s*추천/.test(message),
    addStop: adding && !removing,
    conversationNote: message,
  };
}

export function mergeDateState(previous: AIPlannerState | undefined, patch: IntentPayload, dateLabel?: string): AIPlannerState {
  const base = previous ?? emptyDateBrief();
  const intent = ["create", "modify", "remove", "reset", "clarify"].includes(String(patch.intent))
    ? patch.intent as AIPlannerState["intent"]
    : previous ? "modify" : "create";
  const reset = intent === "reset" || patch.preserveExistingPlaces === false;
  const addActivities = uniqueActivities(patch.addActivities ?? []);
  const removeActivities = uniqueActivities(patch.removeActivities ?? []);
  const activities = uniqueActivities([...(reset ? [] : base.activities), ...addActivities].filter(id => !removeActivities.includes(id)));
  const addAreas = uniqueStrings((patch.addAreas ?? []).map(canonicalizeArea), 3);
  const removeAreas = uniqueStrings((patch.removeAreas ?? []).map(canonicalizeArea), 3);
  const areas = uniqueStrings([...(reset ? [] : base.areas), ...addAreas].filter(area => !removeAreas.includes(area)), 3);
  const addPlaces = uniqueStrings(patch.addPlaces ?? [], 6).filter(place => {
    if (isDateActivityId(place)) return false;
    if (DATE_LANDMARKS.some(landmark => landmark === place)) return true;
    return !areas.includes(place);
  });
  const removePlaces = uniqueStrings(patch.removePlaces ?? [], 4);
  const requiredPlaces = uniqueStrings([...(reset ? [] : base.requiredPlaces), ...addPlaces].filter(place => !removePlaces.includes(place)), 6);
  const indoorPlay = patch.indoorPlay?.trim() || (reset ? null : base.indoorPlay);
  const timeWindow = asTimeWindow(patch.timeWindow) ?? (reset ? null : base.timeWindow);
  const timed = timeWindow && timeWindow !== base.timeWindow ? withTimeWindow(base, timeWindow) : base;
  const stayKind = patch.stayKind === "date" || patch.stayKind === "daytrip" || patch.stayKind === "overnight"
    ? patch.stayKind
    : (reset ? null : base.stayKind);
  const nights = stayKind === "overnight"
    ? Math.max(1, Math.min(2, Number(patch.nights ?? (reset ? 1 : base.nights)) || 1))
    : 0;
  const areaScope = asAreaScope(patch.areaScope) ?? (reset ? null : base.areaScope);
  const located = withAreas({ ...base, areaScope }, areas);
  return {
    intakeFocusDone: base.intakeFocusDone,
    discovery: reset ? undefined : base.discovery,
    budgetWon: base.budgetWon,
    walkingPreference: base.walkingPreference,
    activities,
    areas: located.areas,
    region: located.region,
    regions: located.regions,
    areaScope: located.areaScope,
    requiredPlaces,
    excludedPlaces: uniqueStrings([...(reset ? [] : base.excludedPlaces), ...removePlaces].filter(place => !addPlaces.includes(place)), 8),
    cuisine: asCuisineChoice(patch.cuisine) ?? (reset ? null : base.cuisine),
    indoorPlay: indoorPlay || null,
    pace: patch.pace === "relaxed" || patch.pace === "active" || patch.pace === "balanced" ? patch.pace : base.pace,
    stayKind,
    nights,
    timeWindow: timeWindow ?? timed.timeWindow,
    startTime: patch.startTime === undefined ? timed.startTime : asTime(patch.startTime) ?? timed.startTime,
    endTime: patch.endTime === undefined ? timed.endTime : asTime(patch.endTime) ?? timed.endTime,
    dateLabel: base.dateLabel || dateLabel || null,
    pinOrder: reset ? [] : uniqueStrings(base.pinOrder, 8),
    preserveExistingPlaces: patch.preserveExistingPlaces !== false,
    addStop: patch.addStop === true,
    intent,
    pendingSlot: missingSlot({
      ...base,
      activities,
      areas: located.areas,
      regions: located.regions,
      areaScope: located.areaScope,
      cuisine: asCuisineChoice(patch.cuisine) ?? (reset ? null : base.cuisine),
      indoorPlay: indoorPlay || null,
      stayKind,
      nights,
      timeWindow: timeWindow ?? timed.timeWindow,
      startTime: patch.startTime === undefined ? timed.startTime : asTime(patch.startTime) ?? timed.startTime,
    }),
    conversationNotes: [...(reset ? [] : base.conversationNotes), String(patch.conversationNote ?? "").trim()].filter(Boolean).slice(-12),
    userRequests: reset ? [] : base.userRequests,
  };
}

function usableReply(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || /^false$/i.test(text) || text.length < 8) return "";
  return text.slice(0, 500);
}

export function applyInterpretPatch(input: {
  message: string;
  previousState?: AIPlannerState;
  dateLabel?: string;
  patch: IntentPayload;
}) {
  const merged = mergeDateState(input.previousState, input.patch, input.dateLabel);
  const areas = groundedAreas(input.message, input.previousState, merged.areas);
  const activities = groundedActivities(input.message, input.previousState, merged.activities, merged);
  const state = withAreas({ ...merged, ...explicitDateConstraints(input.message, input.previousState), activities, pendingSlot: null }, areas);
  const next = { ...state, pendingSlot: missingSlot(state) };
  return { state: next, slot: missingSlot(next), reply: usableReply(input.patch.reply) };
}

export function shouldSkipDateNlu(message: string) {
  return Boolean(chatSituationFromMessage(message)) && !/추천|코스|일정|추가|바꿔|변경|빼|제외|대신|짜줘|가고|갈래|먹고|카페|식당/.test(message);
}

export function shouldUseLocalInterpret(message: string, _previous?: AIPlannerState) {
  return shouldSkipDateNlu(message);
}

export async function interpretDateRequest(input: {
  message: string;
  previousState?: AIPlannerState;
  previousPlaceNames: string[];
  dateLabel?: string;
  conversation?: DateChatTurn[];
}) {
  const localPatch = fallbackPatch(input.message);
  const fallback = () => applyInterpretPatch({
    message: input.message,
    previousState: input.previousState,
    dateLabel: input.dateLabel,
    patch: localPatch,
  });
  if (!isOpenAiConfigured() || shouldUseLocalInterpret(input.message, input.previousState)) return fallback();
  try {
    const patch = await completeJson<IntentPayload>({
      temperature: 0,
      maxTokens: 1200,
      reasoningEffort: "low",
      messages: [
        {
          role: "system",
          content: [
            "You read an ongoing Korean couple-date chat. Extract constraints from THIS turn. You do not design the course.",
            "Return JSON only:",
            '{"intent":"create|modify|remove|reset|clarify","addActivities":[],"removeActivities":[],"addAreas":[],"removeAreas":[],"addPlaces":[],"removePlaces":[],"addStop":false,"cuisine":null,"indoorPlay":null,"areaScope":null,"timeWindow":null,"stayKind":null,"nights":null,"pace":null,"startTime":null,"endTime":null,"preserveExistingPlaces":true,"conversationNote":"short Korean restatement of the latest user meaning","askSlot":null,"reply":""}',
            "latestMessage is the user's actual turn. recentTurns is the chat. currentPlaces is the course already on screen. Interpret meaning, not keywords. Chip labels like 일정추가, 카페변경, 식당변경, 일정제외 are user turns too.",
            "Never invent a city or neighborhood the user did not write. addAreas may only contain names that appear in latestMessage.",
            "From 여행가고싶어, 데이트하고싶어, 놀러가고싶어 with no place: addAreas:[], askSlot:\"area\", intent:\"clarify\", reply asking where to go. Do not copy example cities into addAreas.",
            "From 군산 여행 가려고 하는데 일정 짜줘: addAreas:[\"군산\"], stayKind null unless nights were said, reply empty. From 군산 1박2일: addAreas:[\"군산\"], stayKind:\"overnight\", nights:1.",
            "When the user names a place but not activities, addActivities must be []. Do not guess cafe+walk+exhibit. Do not guess meal+walk+tourism. The course judge chooses the mix from real shops.",
            "If they named activities, use only those. 성수에서 전시 보고 싶어 → addActivities:[\"exhibit\"]. 성수 카페 투어 → [\"cafe\"]. 파스타 먹고 성수 걷고 싶어 → [\"meal\",\"walk\"].",
            "From 성수에서 데이트하고 싶어 / 성수 갈래: addAreas:[\"성수\"], stayKind:\"date\", nights:0, addActivities:[].",
            "From 포천 여행 짜줘: addAreas:[\"포천\"], stayKind null unless nights were said, addActivities:[]. Not a cafe crawl.",
            "stayKind: 데이트→date, 당일치기/하루만→daytrip, 1박2일/2박3일/여행+박→overnight. Bare 여행 with no nights leaves stayKind null so the app can ask.",
            "If the user names a destination, never askSlot area. Time only if they mentioned when, not because they said 저녁 먹고 싶어.",
            "askSlot may be area only when no city or neighborhood can be inferred. Never ask activity, cuisine, scope, or indoor.",
            "reply is empty whenever a course can be generated. When asking where to go, one polite 해요체 sentence. No emoji, no 반말, no vibe adjectives.",
            "If the user only greets, thanks you, or asks what you can do, intent:\"clarify\" and put the answer in reply. Do not set intent clarify when addAreas is non-empty.",
            "If the user named activities, use only those. If they did not, addActivities:[]. Never default a mix.",
            "Cuisine: 파스타/피자/브런치/스테이크→양식; 라멘/스시/초밥/오마카세→일식; 국밥/고기/갈비→한식.",
            "When currentPlaces is non-empty, this is a follow-up. Keep addAreas empty unless they named a new neighborhood.",
            "If they want the day longer, another venue, also eat/drink/walk/see something, 일정추가, 추가해줘, or any paraphrase of adding: intent modify, preserveExistingPlaces true, addStop true. addPlaces only if they named a venue; otherwise addPlaces [].",
            "If they want one stop swapped (카페변경, 식당 바꿔, 이 카페 말고): intent modify, preserveExistingPlaces true, addStop false, removePlaces the matching currentPlaces name.",
            "If they want a stop dropped (일정제외, 빼줘): intent remove, preserveExistingPlaces true, addStop false, removePlaces that stop or the last currentPlaces item.",
            "If they want a slower/fuller pace without a new venue: preserveExistingPlaces true, addStop false, set pace.",
            "If they want a different course without keeping the shops (조금 다르게, 다른 코스, 다시 추천): preserveExistingPlaces false, addStop false, intent create.",
            "If they replace the destination, removeAreas must contain prior areas being replaced and preserveExistingPlaces false. If they explicitly ask to combine both areas, preserve them. Never carry old venue pins into a different destination.",
            "If they want the course rebuilt from scratch: preserveExistingPlaces false, addStop false, intent reset or create.",
            "conversationNote restates their meaning in short Korean. Do not rewrite it into a canned command.",
            "areaScope only if the user mentioned range. Time only if they mentioned when, not because they said 저녁 먹고 싶어. Cuisine only if they mentioned food type.",
            "Never return clarifyingQuestion. Never return the boolean or string false.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            currentBrief: input.previousState ?? emptyDateBrief(),
            currentPlaces: input.previousPlaceNames,
            recentTurns: (input.conversation ?? []).slice(-8),
            latestMessage: input.message,
          }),
        },
      ],
    });
    if (!patch) return fallback();
    return applyInterpretPatch({
      message: input.message,
      previousState: input.previousState,
      dateLabel: input.dateLabel,
      patch: { ...patch, askSlot: asQuestionSlot(patch.askSlot) },
    });
  } catch {
    return fallback();
  }
}
